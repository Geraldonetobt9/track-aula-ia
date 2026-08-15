# Security & Performance Improvements — Design Spec

**Date**: 2026-03-30
**Status**: Approved
**Scope**: Preventive hardening — no incidents reported, no business logic changes

## Context

Sentinela handles hundreds of active users, thousands of daily webhook events, and ~15K rows in the sales table. The system works correctly today, but an audit identified security vulnerabilities and performance gaps that should be addressed before the system scales further.

**Constraint**: All improvements must preserve existing business logic and API contracts. No feature changes.

---

## Approach: Security-First, Performance-Layered

Five sequential phases, each independently testable and deployable:

1. **Security Critical** — auth, validation, access control
2. **Security Medium** — rate limiting, headers, health check
3. **Performance Backend** — queries, caching, async webhooks
4. **Performance Frontend** — staleTime, debounce, memoization, chunks
5. **Performance Database** — indexes, BRIN, cursor pagination

---

## Phase 1 — Security Critical

### 1.1 Input Validation with DTOs + class-validator

**Problem**: No controller validates input. All accept raw `@Body() body: any`. The admin `proxyQuery` endpoint accepts arbitrary table/column names.

**Solution**:
- Install `class-validator` and `class-transformer`
- Configure global `ValidationPipe` in `main.ts` with `whitelist: true, forbidNonWhitelisted: true`
- Create DTOs for every controller endpoint using decorators (`@IsString()`, `@IsUUID()`, `@IsEnum()`, etc.)
- The `proxyQuery` DTO must use `@IsIn([...allowedTables])` to whitelist permitted tables

**Files affected**:
- `packages/backend/src/main.ts` — add global pipe
- All controllers in `packages/backend/src/modules/*/` — add DTO types to parameters
- New `dto/` directories inside each module

### 1.2 Workspace Ownership Validation

**Problem**: `removeConnection()`, `removeCheckout()`, and `setProducts()` in `workspaces.service.ts` accept workspace IDs without verifying the requesting user owns that workspace. Any authenticated user can delete another user's connections.

**Solution**:
- Extract `userId` from the auth guard (already available via `@CurrentUser()` or `req.user`)
- Pass `userId` to all destructive service methods
- Add ownership check at the start of each method:
  ```typescript
  const ws = await this.supabase.getClient()
    .from('workspaces')
    .select('id')
    .eq('id', workspaceId)
    .eq('user_id', userId)
    .maybeSingle();
  if (!ws.data) throw new ForbiddenException('Workspace not found');
  ```

**Files affected**:
- `packages/backend/src/modules/workspaces/workspaces.controller.ts` — pass userId
- `packages/backend/src/modules/workspaces/workspaces.service.ts` — add ownership checks

### 1.3 Admin Proxy Query Whitelist

**Problem**: `admin.service.ts` `proxyQuery()` accepts any table name and column selection from the client, enabling data exfiltration if admin credentials are compromised.

**Solution**:
- Define a constant `ALLOWED_PROXY_TABLES` with explicit table→columns mapping
- Validate every query against this whitelist before execution
- Reject queries to unlisted tables or columns with 400

**Files affected**:
- `packages/backend/src/modules/admin/admin.service.ts` — add whitelist validation
- New DTO for proxy query input validation

### 1.4 Webhook Auth Hardening

**Problem**: `extract-webhook-token.ts` accepts auth tokens via query parameters (`?key=` and `?token=`), which are logged in server access logs, cached by proxies, and visible in browser history.

**Solution**:
- Remove query parameter fallback from `extract-webhook-token.ts`
- Accept tokens only via headers: `Authorization: Bearer <token>` or `X-Webhook-Token: <token>`
- Update webhook documentation (WEBHOOKS.md) to reflect the change
- Note: This is a breaking change for any integrations using query params — coordinate with users

**Files affected**:
- `packages/backend/src/modules/webhooks/extract-webhook-token.ts`
- `WEBHOOKS.md`

---

## Phase 2 — Security Medium

### 2.1 Rate Limiting

**Problem**: Auth and API endpoints have no rate limiting, enabling brute force attacks.

**Solution**:
- Install `@nestjs/throttler`
- Configure `ThrottlerModule.forRoot()` in `app.module.ts` with default limit (60 req/min)
- Add `ThrottlerGuard` as global guard
- **`@SkipThrottle()` on `WebhooksController`** — webhook platforms (Hotmart, Kiwify, etc.) send events for all users from a shared IP pool. Rate limiting by IP would reject legitimate webhooks during high-volume periods (e.g., 200+ sales/min). Webhook security relies on token authentication, not rate limiting.
- Stricter limits on auth endpoints (login, register, forgot-password): 10 req/min per IP via `@Throttle()` to prevent brute force
- `@SkipThrottle()` on health check endpoint

**Files affected**:
- `packages/backend/src/app.module.ts` — import ThrottlerModule
- `packages/backend/src/main.ts` — add global ThrottlerGuard
- `packages/backend/src/modules/webhooks/webhooks.controller.ts` — `@SkipThrottle()`

### 2.2 Security Headers

**Problem**: No security headers configured on backend responses.

**Solution**:
- Register Fastify hook in `main.ts` via `app.getHttpAdapter().getInstance().addHook('onSend', ...)`:
  - `X-Content-Type-Options: nosniff`
  - `X-Frame-Options: DENY`
  - `X-XSS-Protection: 1; mode=block`
  - `Strict-Transport-Security: max-age=31536000; includeSubDomains`
  - `X-Permitted-Cross-Domain-Policies: none`

**Files affected**:
- `packages/backend/src/main.ts`

### 2.3 Health Check Endpoint

**Problem**: No health check endpoint exists. Render needs one to detect unhealthy instances.

**Solution**:
- Create `HealthModule` with controller at `GET /health` (public, no auth)
- Response: `{ status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() }`
- Include lightweight DB check: `SELECT 1` via Supabase client
- Must respond within 5 seconds

**Files affected**:
- New: `packages/backend/src/modules/health/health.module.ts`
- New: `packages/backend/src/modules/health/health.controller.ts`
- `packages/backend/src/app.module.ts` — import HealthModule

### 2.4 Remove Hardcoded Supabase Anon Key

**Problem**: `client.ts` has the Supabase anon key hardcoded as fallback.

**Solution**:
- Remove the hardcoded fallback
- Throw an error if `VITE_SUPABASE_ANON_KEY` env var is not set
- Update `.env.example` with a comment explaining the key is required

**Files affected**:
- `packages/frontend/src/integrations/supabase/client.ts`
- `packages/frontend/.env.example`

---

## Phase 3 — Performance Backend

### 3.1 Replace `select('*')` with Explicit Columns

**Problem**: 10+ service methods use `select('*')`, fetching all columns including unused ones.

**Solution**:
- Audit each `select('*')` call and determine the minimum columns needed
- Replace with explicit column lists
- Exception: `select('*', { count: 'exact', head: true })` is acceptable (count-only queries)

**Files affected**:
- `packages/backend/src/modules/metrics/metrics.service.ts` (lines 36, 55, 109, 135)
- `packages/backend/src/modules/sales/sales.service.ts` (lines 21, 56)
- `packages/backend/src/modules/admin/admin.service.ts` (multiple)
- `packages/backend/src/modules/integrations/integrations.service.ts` (lines 11, 46, 68, 89)
- `packages/backend/src/modules/plans/plans.service.ts` (lines 26, 37)
- `packages/backend/src/modules/facebook/sync.service.ts` (lines 40, 75)
- `packages/backend/src/modules/webhooks/webhook-queue.service.ts` (line 28)

### 3.2 Resolve N+1 Queries in Admin

**Problem**: `admin.service.ts` `getStats()` and `listUsers()` make 2-4 queries per user inside `Promise.all(users.map(...))`.

**Solution**:
- Replace per-user queries with Supabase joins:
  ```typescript
  .select('id, user_id, name, email, facebook_connections(is_valid), sync_schedules(last_sync_error)')
  ```
- For `listUsers()`, batch-fetch related data with `IN` filters instead of per-user queries

**Files affected**:
- `packages/backend/src/modules/admin/admin.service.ts` (lines 145-310)

### 3.3 Async Webhook Processing

**Problem**: Most webhook platforms process synchronously. Only Guru uses the queue pattern.

**Solution**:
- Extend the existing queue pattern (webhook_queue table + cron processor) to all platforms
- Each webhook controller should: validate token → insert into `webhook_queue` → return 200
- The existing `process-webhook-queue` cron handles actual processing
- This is already the architecture for Guru — replicate for Hotmart, Kiwify, Kirvano, PerfectPay, Ticto, PayT, Cakto, Balaclava

**Why `webhook_queue` table instead of Redis + BullMQ?**
At current scale (thousands of webhooks/day), the PostgreSQL table is sufficient. BullMQ adds event-driven processing, native concurrency control, and retry with backoff — but also adds infrastructure cost (~$7-10/mês for Redis on Render) and operational complexity. The table approach is already partially implemented (Guru), has zero extra dependencies, and the cron polling delay (5-10s) is acceptable for this use case. **Revisit when**: volume exceeds tens of thousands/day, cron polling becomes a bottleneck, or sophisticated retry/dead-letter-queue logic is needed.

**Files affected**:
- `packages/backend/src/modules/webhooks/webhooks.controller.ts`
- `packages/backend/src/modules/webhooks/processors/` — all processor files
- `packages/backend/src/modules/webhooks/webhook-queue.service.ts`

### 3.4 Backend In-Memory Cache

**Problem**: Reference data (plans, plan_rules) is fetched from DB on every request despite rarely changing.

**Solution**:
- Implement simple TTL-based Map cache in a `CacheService`
- Cache `plans.list()` and `plans.getRulesForPlan()` with 60s TTL
- Cache workspace configs with 30s TTL
- Invalidate on write operations

**Files affected**:
- New: `packages/backend/src/shared/services/cache.service.ts`
- `packages/backend/src/modules/plans/plans.service.ts` — use cache
- `packages/backend/src/shared/shared.module.ts` — export CacheService

---

## Phase 4 — Performance Frontend

### 4.1 Configure staleTime on All Hooks

**Problem**: 29 of 30 data-fetching hooks have no staleTime, causing refetch on every component mount.

**Solution**:
- Reference data (plans, config): `staleTime: 5 * 60 * 1000` (5 min)
- Dashboard metrics: `staleTime: 60 * 1000` (1 min)
- User data (sales, campaigns): `staleTime: 30 * 1000` (30 sec)
- Real-time (sync status): `staleTime: 0`

**Files affected**: All hooks in `packages/frontend/src/hooks/`

### 4.2 Debounce All Search Inputs

**Problem**: Only AdminUsers has debounced search. Sales and Campaigns fire requests on every keystroke.

**Solution**:
- Create centralized `useDebounce` hook in `packages/frontend/src/hooks/useDebounce.ts`
- Apply to search inputs in Sales.tsx, Campaigns.tsx, and any other filter inputs
- Debounce delay: 300ms

**Files affected**:
- New: `packages/frontend/src/hooks/useDebounce.ts`
- `packages/frontend/src/pages/Sales.tsx`
- `packages/frontend/src/pages/Campaigns.tsx`
- `packages/frontend/src/pages/admin/AdminUsers.tsx` — refactor to use shared hook

### 4.3 Memoization Fixes

**Problem**: Arrays recreated on every render in WorkspaceContext cause unnecessary re-renders downstream. Helper functions inside Dashboard.tsx are recreated on each render.

**Solution**:
- Wrap `activeConnectionIds` in `useMemo` in `WorkspaceContext.tsx`
- Move `parseDateRangeFromParams` and `serializeDateRangeToParams` outside the Dashboard component
- Apply `React.memo` to `MetricCard` component in Dashboard.tsx

**Files affected**:
- `packages/frontend/src/contexts/WorkspaceContext.tsx`
- `packages/frontend/src/pages/Dashboard.tsx`

### 4.4 Vite Manual Chunks

**Problem**: All vendor code is in one bundle. Any app code change invalidates the entire vendor cache.

**Solution**:
- Configure `build.rollupOptions.output.manualChunks` in `vite.config.ts`:
  - `vendor-react`: react, react-dom, react-router-dom
  - `vendor-ui`: @radix-ui/*, lucide-react
  - `vendor-charts`: recharts, topojson, world-atlas
  - `vendor-query`: @tanstack/react-query

**Files affected**:
- `packages/frontend/vite.config.ts`

---

## Phase 5 — Performance Database

### 5.1 Add Missing Composite Indexes

**Problem**: Common dashboard queries filter by `(user_id, date)` but lack composite indexes.

**Solution** (new migration file):
```sql
CREATE INDEX CONCURRENTLY idx_sales_user_sold_at
  ON public.sales(user_id, sold_at DESC);

CREATE INDEX CONCURRENTLY idx_daily_ad_spend_user_date_desc
  ON public.daily_ad_spend(user_id, date DESC);

CREATE INDEX CONCURRENTLY idx_profiles_plan_id
  ON public.profiles(plan_id);
```

**Files affected**:
- New migration: `supabase/migrations/YYYYMMDD_performance_indexes.sql`

### 5.2 BRIN Indexes on Append-Only Columns

**Problem**: `webhook_queue.created_at` and `sync_logs.created_at` use B-tree indexes but are append-only (monotonically increasing), making BRIN 10x more space-efficient.

**Solution**:
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_webhook_queue_created;
CREATE INDEX CONCURRENTLY idx_webhook_queue_created_brin
  ON public.webhook_queue USING brin(created_at);

CREATE INDEX CONCURRENTLY idx_sync_logs_created_brin
  ON public.sync_logs USING brin(created_at);
```

**Files affected**:
- Same migration file as 5.1

### 5.3 Cursor-Based Pagination in Admin

**Problem**: `admin.service.ts` `listUsers()` uses `.range(offset, ...)` which degrades as data grows.

**Solution**:
- Replace offset pagination with keyset pagination:
  ```typescript
  .gt('id', cursor).order('id', { ascending: true }).limit(pageSize)
  ```
- Return `nextCursor` (last item's ID) in response for the frontend to use
- Update frontend admin table to use cursor-based navigation

**Files affected**:
- `packages/backend/src/modules/admin/admin.service.ts`
- `packages/backend/src/modules/admin/admin.controller.ts`
- `packages/frontend/src/hooks/useAdminUsers.ts`
- `packages/frontend/src/pages/admin/AdminUsers.tsx`

---

## Out of Scope

These items were identified but excluded from this iteration:

- **Clustering/multi-process** — Render handles scaling at the infrastructure level
- **List virtualization** — Current pagination (20 items/page) mitigates the risk. Revisit when tables exceed 100 visible rows
- **Encryption key derivation upgrade** — Low risk with current threat model
- **Structured logging (Pino/Winston)** — Nice-to-have, not a security or performance blocker
- **Self-hosted fonts** — Google Fonts with `display=swap` is adequate for now
- **Large component splitting** — Code quality improvement, not a security/performance concern

## Risk Assessment

| Phase | Risk | Mitigation |
|-------|------|------------|
| 1 - DTOs | Breaking if clients send extra fields | `whitelist: true` silently strips unknown fields |
| 1 - Webhook auth | Breaking for integrations using query params | Coordinate with users, announce change |
| 3 - Async webhooks | Queue processing delay | Monitor queue depth, adjust cron frequency |
| 5 - Indexes | Lock during creation | `CONCURRENTLY` prevents write blocking |
| 5 - Cursor pagination | Frontend API change | Backward-compatible: support both offset and cursor |
