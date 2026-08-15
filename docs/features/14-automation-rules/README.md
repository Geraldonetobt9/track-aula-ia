# Feature 14: Automation Rules

## Objective

Allow users to create automated rules per workspace that monitor live Facebook Ads metrics and execute actions (activate, pause, increase budget, decrease budget) on Facebook Ads entities (campaigns, ad sets, ads) when conditions are met. Rules run on a configurable schedule, with all metric data fetched live from the Facebook Marketing API.

---

## Data Model

### Table: `automation_rules`

The primary rule definition table. One row per rule per workspace.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `workspace_id` | uuid | FK → `workspaces(id)` ON DELETE CASCADE |
| `name` | text | Human-readable rule name |
| `is_active` | boolean | Whether the rule is enabled (default: false) |
| `connection_id` | uuid | Optional FK → `facebook_connections(id)` ON DELETE SET NULL |
| `target_entity` | text | Entity type: `'campaign'`, `'adset'`, or `'ad'` |
| `target_status` | text | Filter by entity status: `'active'`, `'paused'`, or `'any'` |
| `name_filter` | text | Optional substring filter on entity name |
| `action_type` | text | Action: `'activate'`, `'pause'`, `'increase_budget'`, `'decrease_budget'` |
| `budget_adjustment` | jsonb | `{ type: 'percent' \| 'fixed', value: number }` — only used for budget actions |
| `evaluation_period` | text | Metric window: `'today'`, `'yesterday'`, `'last_7d'`, `'last_30d'`, `'custom'` |
| `custom_start_date` | date | Used when `evaluation_period = 'custom'` |
| `frequency_minutes` | integer | Run interval: 10, 15, 30, 60, 120, 180, 360, or 1440 |
| `daily_run_time` | time | Optional wall-clock time for daily (1440 min) rules |
| `last_executed_at` | timestamptz | Timestamp of last execution |
| `created_at` | timestamptz | Creation timestamp |
| `updated_at` | timestamptz | Last update timestamp |

**Constraints:**
- `target_entity` IN `('campaign', 'adset', 'ad')`
- `target_status` IN `('active', 'paused', 'any')`
- `action_type` IN `('activate', 'pause', 'increase_budget', 'decrease_budget')`
- `evaluation_period` IN `('today', 'yesterday', 'last_7d', 'last_30d', 'custom')`
- `frequency_minutes` IN `(10, 15, 30, 60, 120, 180, 360, 1440)`

### Table: `automation_rule_conditions`

Conditions that must ALL be true (AND logic) for the rule to trigger.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `rule_id` | uuid | FK → `automation_rules(id)` ON DELETE CASCADE |
| `metric` | text | Metric to evaluate (see Metrics section below) |
| `operator` | text | `'gt'`, `'lt'`, `'gte'`, `'lte'` |
| `value` | numeric | Threshold value |

**Constraints:**
- `metric` IN `('spend', 'cpa', 'roi', 'roas', 'profit', 'profit_margin', 'cpc', 'ctr', 'cpm', 'impressions', 'clicks', 'conversions')`
- `operator` IN `('gt', 'lt', 'gte', 'lte')`

### Table: `automation_rule_executions`

Append-only audit log of each rule execution attempt.

| Column | Type | Description |
|---|---|---|
| `id` | uuid | Primary key |
| `rule_id` | uuid | FK → `automation_rules(id)` ON DELETE CASCADE |
| `workspace_id` | uuid | FK → `workspaces(id)` ON DELETE CASCADE — for fast per-workspace queries |
| `entity_facebook_id` | text | Facebook entity ID that was acted upon |
| `entity_name` | text | Human-readable entity name at time of execution |
| `action_taken` | text | The action that was executed |
| `metrics_snapshot` | jsonb | Metric values at the time of evaluation |
| `status` | text | `'success'` or `'error'` |
| `error_message` | text | Populated when `status = 'error'` |
| `executed_at` | timestamptz | Execution timestamp (default: now()) |

**Constraint:** `status` IN `('success', 'error')`

### `plan_rules` alteration

The `plan_rules` table has an added column:

| Column | Type | Description |
|---|---|---|
| `max_active_rules` | integer | Maximum active rules allowed. `NULL` = unlimited (enterprise). Default: 0 |

**Plan limits:**
| Plan | `max_active_rules` |
|---|---|
| free | 0 |
| starter | 3 |
| pro | 7 |
| enterprise | NULL (unlimited) |

### Indexes

```sql
-- Fast workspace + active status lookup (used in scheduler and list endpoint)
CREATE INDEX idx_automation_rules_workspace_active
  ON public.automation_rules (workspace_id, is_active);

-- Partial index for scheduler: only active rules, sorted by last execution
CREATE INDEX idx_automation_rules_active_last_executed
  ON public.automation_rules (is_active, last_executed_at)
  WHERE is_active = true;

-- Conditions join
CREATE INDEX idx_automation_rule_conditions_rule_id
  ON public.automation_rule_conditions (rule_id);

-- History queries per rule (cursor-based pagination)
CREATE INDEX idx_automation_rule_executions_rule_date
  ON public.automation_rule_executions (rule_id, executed_at DESC);

-- History queries per workspace
CREATE INDEX idx_automation_rule_executions_workspace_date
  ON public.automation_rule_executions (workspace_id, executed_at DESC);

-- BRIN on append-only executions table
CREATE INDEX idx_automation_rule_executions_executed_at_brin
  ON public.automation_rule_executions USING BRIN (executed_at);
```

### RLS Policies

All three tables have RLS enabled. Policies are scoped to the authenticated user's own workspaces using cached `auth.uid()` subqueries.

---

## API Endpoints

All endpoints require a valid JWT in the `Authorization` header. All are under the `/automation-rules` prefix.

### GET `/automation-rules`

List all rules for a workspace.

**Query params:**
- `workspace_id` (required) — UUID of the workspace

**Response:** Array of `AutomationRule` objects with nested `conditions`.

Only the fields needed by the UI are returned: `id, name, is_active, connection_id, target_entity, target_status, name_filter, action_type, budget_adjustment, evaluation_period, custom_start_date, frequency_minutes, daily_run_time, last_executed_at, conditions`. Internal columns (`workspace_id`, `created_at`, `updated_at`) are never sent to the client.

---

### POST `/automation-rules`

Create a new rule.

**Body:** `CreateRuleDto`
```typescript
{
  workspace_id: string;        // UUID
  name: string;
  connection_id?: string;      // UUID
  target_entity: 'campaign' | 'adset' | 'ad';
  target_status: 'active' | 'paused' | 'any';
  name_filter?: string;
  action_type: 'activate' | 'pause' | 'increase_budget' | 'decrease_budget';
  budget_adjustment?: {
    type: 'percent' | 'fixed';
    value: number;
  };
  evaluation_period: 'today' | 'yesterday' | 'last_7d' | 'last_30d' | 'custom';
  custom_start_date?: string;  // ISO date
  frequency_minutes: 10 | 15 | 30 | 60 | 120 | 180 | 360 | 1440;
  daily_run_time?: string;     // HH:MM format
  conditions: Array<{
    metric: string;
    operator: 'gt' | 'lt' | 'gte' | 'lte';
    value: number;
  }>;
}
```

**Response:** Created `AutomationRule` object.

**Business rule:** Validates against `max_active_rules` plan limit if `is_active` is true.

---

### PATCH `/automation-rules/:id`

Update an existing rule (partial update).

**Body:** `UpdateRuleDto` — same fields as `CreateRuleDto`, all optional.

**Response:** Updated `AutomationRule` object.

---

### DELETE `/automation-rules/:id`

Delete a rule and all its conditions and execution history (cascade).

**Response:** `{ success: true }`

---

### PATCH `/automation-rules/:id/toggle`

Toggle `is_active` on a rule.

**Response:** Updated rule with flipped `is_active`.

**Business rule:** Checks plan limit before activating. Returns `403` if activating would exceed `max_active_rules`.

---

### GET `/automation-rules/:id/history`

Paginated execution history for a rule (cursor-based).

**Query params:**
- `cursor` (optional) — ISO timestamp; returns executions older than this value
- `limit` (optional, default 20, max 100) — page size

**Response:**
```typescript
{
  items: AutomationRuleExecution[];  // fields: id, entity_facebook_id, entity_name, action_taken, metrics_snapshot, status, error_message, executed_at
  nextCursor: string | null;  // executed_at of the last item, or null if no more pages
}
```

`rule_id` is omitted from each item because it is already known from the URL path.

---

## Frontend Components

### Page: `Rules` (`/rules`)

Route: `/rules`
File: `packages/frontend/src/pages/Rules.tsx`

Displays the workspace's automation rules. Shows a plan-limit banner when the user has reached their active rule cap. Contains the "New Rule" button that opens `RuleFormModal`.

---

### `RulesList`

File: `packages/frontend/src/components/rules/RulesList.tsx`

Renders the list of `RuleCard` components. Handles empty state with a call-to-action.

---

### `RuleCard`

File: `packages/frontend/src/components/rules/RuleCard.tsx`

Displays a single rule with:
- Rule name and status badge
- Target entity, action type, evaluation period
- Toggle switch for activating/pausing
- Edit and delete actions
- Button to open `RuleHistoryDrawer`

---

### `RuleFormModal`

File: `packages/frontend/src/components/rules/RuleFormModal.tsx`

Modal dialog for creating and editing rules. Composes `ConditionBuilder` and `BudgetConfig`. Contains full form validation.

---

### `ConditionBuilder`

File: `packages/frontend/src/components/rules/ConditionBuilder.tsx`

Sub-component of `RuleFormModal`. Allows users to add, edit, and remove metric conditions. Each condition has a metric selector, operator selector, and numeric threshold input.

---

### `BudgetConfig`

File: `packages/frontend/src/components/rules/BudgetConfig.tsx`

Sub-component of `RuleFormModal`. Shown only when `action_type` is `increase_budget` or `decrease_budget`. Configures the adjustment type (`percent` or `fixed`) and value.

---

### `RuleHistoryDrawer`

File: `packages/frontend/src/components/rules/RuleHistoryDrawer.tsx`

Slide-in drawer showing the execution history for a single rule. Uses cursor-based infinite scroll via `useRuleHistory`.

---

### Hooks

| Hook | File | Description |
|---|---|---|
| `useAutomationRules` | `hooks/useAutomationRules.ts` | CRUD operations and list query for automation rules |
| `useRuleHistory` | `hooks/useRuleHistory.ts` | Cursor-paginated execution history for a rule |
| `usePlanRules` | `hooks/usePlanRules.ts` | Fetches the current workspace's plan limits |

**TanStack Query `staleTime`:**
- Rules list: 30 seconds
- Plan rules: 5 minutes
- Rule history: 30 seconds

---

## Business Rules

### Plan Limits

Active rule counts (only `is_active = true` rows count against the limit):

| Plan | Max Active Rules |
|---|---|
| free | 0 |
| starter | 3 |
| pro | 7 |
| enterprise | unlimited |

The backend enforces the limit on both `POST /automation-rules` (when creating an active rule) and `PATCH /:id/toggle` (when activating). Returns HTTP `403` with `{ message: 'Plan limit reached' }` if exceeded.

### Condition Evaluation

All conditions on a rule use **AND logic** — every condition must be satisfied for the rule to fire. A rule with no conditions never fires.

### Scheduling

The `RuleSchedulerService` runs a `setInterval` check every minute. For each active rule it determines whether the rule is due to run based on `frequency_minutes` and `last_executed_at`. Rules with `frequency_minutes = 1440` (daily) additionally respect the optional `daily_run_time` field, interpreted in the **`America/Sao_Paulo` timezone**.

**Frequency options (minutes):**
`10`, `15`, `30`, `60`, `120`, `180`, `360`, `1440`

### Advisory Lock (Deduplication)

Before executing a rule, the `RuleExecutorService` acquires a PostgreSQL advisory lock using the rule's ID. This prevents duplicate execution when multiple backend instances are running concurrently (e.g., under horizontal scaling on Render). If the lock cannot be acquired, the rule is skipped for that cycle.

### Metrics (Live Data)

Metrics are fetched live from the Facebook Marketing API via `LiveMetricsService`. They are **not** read from the local database. Supported metrics:

| Metric | Description |
|---|---|
| `spend` | Total amount spent |
| `cpa` | Cost per acquisition (spend / conversions) |
| `roi` | Return on investment ((revenue − spend) / spend) |
| `roas` | Return on ad spend (revenue / spend) |
| `profit` | Net profit (revenue − spend − costs) |
| `profit_margin` | Profit as a percentage of revenue |
| `cpc` | Cost per click |
| `ctr` | Click-through rate (%) |
| `cpm` | Cost per thousand impressions |
| `impressions` | Total impressions |
| `clicks` | Total clicks |
| `conversions` | Total conversion events |

### Actions

| Action | Description |
|---|---|
| `activate` | Sets entity status to ACTIVE via Facebook API |
| `pause` | Sets entity status to PAUSED via Facebook API |
| `increase_budget` | Increases daily/lifetime budget by a fixed amount or percentage |
| `decrease_budget` | Decreases daily/lifetime budget by a fixed amount or percentage |

Budget adjustments support safety limits: a minimum floor prevents budgets from being reduced to zero or below a configured threshold.

### Notifications

After each rule execution cycle, `RuleNotifierService` sends a Discord webhook notification summarizing the actions taken. Notifications are sent only when at least one action was executed in the cycle. The Discord webhook URL is configured per workspace (or globally via environment variable).

### Execution Audit

Every entity acted upon creates a row in `automation_rule_executions`, recording:
- The entity ID and name at the time of execution
- The exact action taken
- A snapshot of all metric values used in the evaluation
- Success or failure status

---

## Migration Reference

- **Migration file:** `supabase/migrations/20260401000008_automation_rules.sql`
- **plan_rules alteration:** Adds `max_active_rules integer DEFAULT 0` column; updates seeded plan rows to set 3 (starter), 7 (pro), NULL (enterprise).
