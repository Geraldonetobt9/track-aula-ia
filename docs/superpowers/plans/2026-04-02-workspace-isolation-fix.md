# Workspace Isolation Fix — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ensure every data query in the system is scoped to the active workspace, so switching workspaces shows only that workspace's data.

**Architecture:** Add `workspace_id` filtering to all backend queries that currently only filter by `user_id`. Update frontend hooks that don't send `workspace_id` to include it from `WorkspaceContext`. No schema changes needed — all tables already have `workspace_id` columns.

**Tech Stack:** NestJS backend (TypeScript), React frontend (TypeScript), Supabase PostgreSQL

---

## Task 1: Fix Facebook connections — backend accepts and filters by workspace_id

**Files:**
- Modify: `packages/backend/src/modules/facebook/facebook.controller.ts:149-153`
- Modify: `packages/backend/src/modules/facebook/facebook.service.ts:29-36`

- [ ] **Step 1: Add workspace_id query param to controller**

In `facebook.controller.ts`, change the `getConnections` method:

```typescript
@Get('connections')
@UseGuards(AuthGuard)
async getConnections(
  @CurrentUser('id') userId: string,
  @Query('workspace_id') workspaceId?: string,
) {
  return this.facebook.getConnections(userId, workspaceId);
}
```

- [ ] **Step 2: Add workspace_id filter to service**

In `facebook.service.ts`, change the `getConnections` method signature and query:

```typescript
async getConnections(userId: string, workspaceId?: string) {
  const client = this.supabase.getClient();

  let query = client
    .from('facebook_connections')
    .select('id, user_id, ad_account_id, account_name, account_status, facebook_user_id, facebook_user_name, is_valid, is_active, last_validated_at, created_at, updated_at')
    .eq('user_id', userId);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query.order('account_name', { ascending: true });
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/facebook/facebook.controller.ts packages/backend/src/modules/facebook/facebook.service.ts
git commit -m "fix(facebook): filter connections by workspace_id"
```

---

## Task 2: Fix metrics — getActiveConnectionIds scoped to workspace

**Files:**
- Modify: `packages/backend/src/modules/metrics/metrics.service.ts:37-47`

The `getActiveConnectionIds` private method is used by `getDashboardData`, `getCampaigns`, `getAdSets`, `getAds`, and `getDailyAdSpend`. Fixing it here fixes all downstream callers in this service.

- [ ] **Step 1: Add workspace_id param to getActiveConnectionIds**

```typescript
private async getActiveConnectionIds(userId: string, workspaceId?: string): Promise<string[]> {
  const client = this.supabase.getClient();
  let query = client
    .from('facebook_connections')
    .select('id')
    .eq('user_id', userId)
    .eq('is_active', true);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);
  return (data || []).map((c) => c.id);
}
```

- [ ] **Step 2: Pass workspace_id from all callers**

Update every call to `getActiveConnectionIds` in this file to pass `filters.workspace_id`:

- Line 51 (getDashboardData): `await this.getActiveConnectionIds(userId, filters.workspace_id);`
- Line 146 (getCampaigns): `await this.getActiveConnectionIds(userId, filters.workspace_id);`
- Line 218 (getAdSets): `await this.getActiveConnectionIds(userId, filters.workspace_id);`
- Line 294 (getAds): `await this.getActiveConnectionIds(userId, filters.workspace_id);`
- Line 370 (getDailyAdSpend): `await this.getActiveConnectionIds(userId, filters.workspace_id);`

- [ ] **Step 3: Add workspace_id filter to metadata queries**

In `getCampaigns` (line 188-193), add workspace_id filter:

```typescript
let campQuery = client
  .from('campaigns')
  .select('id, user_id, facebook_campaign_id, name, status, objective, date_start, date_end, daily_budget, lifetime_budget, synced_at, created_at, updated_at, facebook_connection_id')
  .eq('user_id', userId)
  .in('id', campaignIds)
  .order('name', { ascending: true });

if (filters.workspace_id) {
  campQuery = campQuery.eq('workspace_id', filters.workspace_id);
}

const { data: campaigns, error: campError } = await campQuery;
```

In `getAdSets` (line 260-265), add workspace_id filter:

```typescript
let metaQuery = client
  .from('ad_sets')
  .select('id, user_id, campaign_id, facebook_adset_id, name, status, date_start, date_end, daily_budget, lifetime_budget, synced_at, created_at, updated_at, facebook_connection_id')
  .eq('user_id', userId)
  .in('id', adSetIds)
  .order('name', { ascending: true });

if (filters.workspace_id) {
  metaQuery = metaQuery.eq('workspace_id', filters.workspace_id);
}

if (filters.campaign_id) {
  metaQuery = metaQuery.eq('campaign_id', filters.campaign_id);
}

const { data: adSets, error: asError } = await metaQuery;
```

In `getAds` (line 336-341), add workspace_id filter:

```typescript
let metaQuery = client
  .from('ads')
  .select('id, user_id, ad_set_id, facebook_ad_id, name, status, date_start, date_end, synced_at, created_at, updated_at, facebook_connection_id')
  .eq('user_id', userId)
  .in('id', adIds)
  .order('name', { ascending: true });

if (filters.workspace_id) {
  metaQuery = metaQuery.eq('workspace_id', filters.workspace_id);
}

if (filters.ad_set_id) {
  metaQuery = metaQuery.eq('ad_set_id', filters.ad_set_id);
}

const { data: ads, error: adError } = await metaQuery;
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/metrics/metrics.service.ts
git commit -m "fix(metrics): scope all queries to workspace_id"
```

---

## Task 3: Fix live-metrics — getActiveConnections scoped to workspace

**Files:**
- Modify: `packages/backend/src/modules/metrics/live-metrics.service.ts:600-615`

The `getActiveConnections` private method is used by `getCampaigns`, `getAdSets`, `getAds`, `getDailyAdSpend`, and `getDashboardData` in the live-metrics service. These methods already receive `filters` with `workspace_id` but don't pass it to `getActiveConnections`.

- [ ] **Step 1: Add workspace_id param to getActiveConnections**

```typescript
private async getActiveConnections(userId: string, workspaceId?: string): Promise<ActiveConnection[]> {
  const client = this.supabase.getClient();
  let query = client
    .from('facebook_connections')
    .select('id, access_token, ad_account_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .eq('is_valid', true);

  if (workspaceId) {
    query = query.eq('workspace_id', workspaceId);
  }

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const connections = (data || []).map((c) => ({
    id: c.id,
    access_token: this.encryption.decryptIfNeeded(c.access_token),
    ad_account_id: c.ad_account_id.startsWith('act_') ? c.ad_account_id : `act_${c.ad_account_id}`,
  }));
```

- [ ] **Step 2: Pass workspace_id from all callers**

Update every call to `getActiveConnections` in this file:

- `getCampaigns` (line 74): `await this.getActiveConnections(userId, filters.workspace_id);`
- `getAdSets` (line 175): `await this.getActiveConnections(userId, filters.workspace_id);`
- `getAds` (line 263): `await this.getActiveConnections(userId, filters.workspace_id);`
- `getDashboardData` (line 333): `await this.getActiveConnections(userId, filters.workspace_id);`
- `getDailyAdSpend` (line 379): `await this.getActiveConnections(userId, filters.workspace_id);`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/metrics/live-metrics.service.ts
git commit -m "fix(live-metrics): scope Facebook connections to workspace_id"
```

---

## Task 4: Fix metrics controller — pass workspace_id to getSyncSchedules

**Files:**
- Modify: `packages/backend/src/modules/metrics/metrics.controller.ts:120-123`

- [ ] **Step 1: Add workspace_id query param**

```typescript
@Get('sync-schedules')
getSyncSchedules(
  @CurrentUser('id') userId: string,
  @Query('workspace_id') workspaceId?: string,
) {
  return this.metricsService.getSyncSchedules(userId, workspaceId);
}
```

Note: `metricsService.getSyncSchedules` already accepts an optional `workspaceId` parameter — the controller just wasn't passing it.

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/modules/metrics/metrics.controller.ts
git commit -m "fix(metrics): pass workspace_id to getSyncSchedules endpoint"
```

---

## Task 5: Fix automation rules — add ownership validation on mutations

**Files:**
- Modify: `packages/backend/src/modules/automation-rules/automation-rules.service.ts:89-139`

The `updateRule`, `deleteRule`, and `toggleRule` methods only filter by `rule.id` without validating that the rule belongs to the user's workspace. Since the service uses `service_role` key (bypasses RLS), this is a security gap.

- [ ] **Step 1: Add ownership check helper**

Add this private method at the end of the class (before the closing brace):

```typescript
private async verifyRuleOwnership(client: any, ruleId: string, userId: string): Promise<void> {
  const { data, error } = await client
    .from('automation_rules')
    .select('id, workspace_id')
    .eq('id', ruleId)
    .single();

  if (error || !data) throw new NotFoundException('Rule not found');

  const { data: workspace } = await client
    .from('workspaces')
    .select('id')
    .eq('id', data.workspace_id)
    .eq('owner_id', userId)
    .maybeSingle();

  if (!workspace) throw new ForbiddenException('Access denied');
}
```

- [ ] **Step 2: Add ownership check to updateRule**

At the start of `updateRule` (line 90, after `const client`), add:

```typescript
await this.verifyRuleOwnership(client, ruleId, userId);
```

- [ ] **Step 3: Add ownership check to deleteRule**

At the start of `deleteRule` (line 116, after `const client`), add:

```typescript
await this.verifyRuleOwnership(client, ruleId, userId);
```

- [ ] **Step 4: Add ownership check to toggleRule**

At the start of `toggleRule` (line 123, after `const client`), add:

```typescript
await this.verifyRuleOwnership(client, ruleId, userId);
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/automation-rules/automation-rules.service.ts
git commit -m "fix(automation-rules): validate workspace ownership on mutations"
```

---

## Task 6: Fix automation rules history — validate rule ownership

**Files:**
- Modify: `packages/backend/src/modules/automation-rules/automation-rules.controller.ts:42-63`

- [ ] **Step 1: Add ownership validation to getHistory**

The `getHistory` method in the controller queries `automation_rule_executions` by `rule_id` without checking the user owns that rule. Add a workspace ownership check before querying:

```typescript
@Get(':id/history')
async getHistory(
  @CurrentUser('id') userId: string,
  @Param('id') ruleId: string,
  @Query('cursor') cursor?: string,
  @Query('limit') limit?: string,
) {
  const client = this.supabase.getClient();

  // Verify user owns the rule's workspace
  const { data: rule, error: ruleError } = await client
    .from('automation_rules')
    .select('id, workspace_id')
    .eq('id', ruleId)
    .single();
  if (ruleError || !rule) throw new NotFoundException('Rule not found');

  const { data: workspace } = await client
    .from('workspaces')
    .select('id')
    .eq('id', rule.workspace_id)
    .eq('owner_id', userId)
    .maybeSingle();
  if (!workspace) throw new ForbiddenException('Access denied');

  const pageSize = Math.min(parseInt(limit || '20', 10), 100);
  let query = client
    .from('automation_rule_executions')
    .select('id, rule_id, entity_facebook_id, entity_name, action_taken, metrics_snapshot, status, error_message, executed_at')
    .eq('rule_id', ruleId)
    .order('executed_at', { ascending: false })
    .limit(pageSize);
  if (cursor) query = query.lt('executed_at', cursor);
  const { data, error } = await query;
  if (error) throw error;
  const items = data || [];
  const nextCursor = items.length === pageSize ? items[items.length - 1].executed_at : null;
  return { items, nextCursor };
}
```

Add the missing imports at the top of the file:

```typescript
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards, NotFoundException, ForbiddenException } from '@nestjs/common';
```

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/modules/automation-rules/automation-rules.controller.ts
git commit -m "fix(automation-rules): validate ownership before returning history"
```

---

## Task 7: Fix frontend — useSales.fetchAdSpend sends workspace_id

**Files:**
- Modify: `packages/frontend/src/hooks/useSales.ts:94-111`

- [ ] **Step 1: Add workspace_id to fetchAdSpend params**

The hook already imports `useWorkspaceContext` and has `activeWorkspaceId`. Just add it to the params in `fetchAdSpend`:

```typescript
const fetchAdSpend = async (fromDate?: string, toDate?: string): Promise<number> => {
  if (!effectiveId) return 0;

  try {
    const params = new URLSearchParams();
    if (fromDate) params.set('from', fromDate);
    if (toDate) params.set('to', toDate);
    if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
    if (isImpersonating && target) {
      params.set('target_user_id', target.userId);
    }

    const data = await api.get<{ total_spend: number }>(`/metrics/daily-spend?${params}`);
    return data?.total_spend || 0;
  } catch (err) {
    console.error('Error fetching ad spend:', err);
    return 0;
  }
};
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/hooks/useSales.ts
git commit -m "fix(frontend): send workspace_id in fetchAdSpend"
```

---

## Task 8: Fix frontend — useSyncSchedule sends workspace_id

**Files:**
- Modify: `packages/frontend/src/hooks/useSyncSchedule.ts`

- [ ] **Step 1: Import WorkspaceContext and add workspace_id to queries**

Add the import at the top:

```typescript
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
```

Inside the `useSyncSchedule` function, add after `const queryClient = useQueryClient();`:

```typescript
const { activeWorkspaceId } = useWorkspaceContext();
```

Update the schedule query (queryKey and queryFn):

```typescript
const { data: schedule, isLoading: loadingSchedule, refetch: refetchSchedule } = useQuery({
  queryKey: ['sync-schedule', user?.id, activeWorkspaceId],
  queryFn: async () => {
    if (!user?.id) return null;
    const params = new URLSearchParams();
    if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
    const data = await api.get<SyncSchedule[]>(`/integrations/sync-schedules?${params}`);
    const fbSchedule = (data || []).find(s => s.sync_type === 'facebook_ads');
    return fbSchedule || null;
  },
  enabled: !!user?.id,
  refetchInterval: (query) => {
    const data = query.state.data as SyncSchedule | null;
    return data?.last_sync_status === 'running' ? 5000 : 30000;
  },
  refetchIntervalInBackground: false,
  staleTime: 0,
});
```

Update the logs query:

```typescript
const { data: logs = [], isLoading: loadingLogs, refetch: refetchLogs } = useQuery({
  queryKey: ['sync-logs', user?.id, activeWorkspaceId],
  queryFn: async () => {
    if (!user?.id) return [];
    const params = new URLSearchParams({ sync_type: 'facebook_ads', limit: '20' });
    if (activeWorkspaceId) params.set('workspace_id', activeWorkspaceId);
    return api.get<SyncLog[]>(`/integrations/sync-logs?${params}`);
  },
  enabled: !!user?.id,
  staleTime: 0,
});
```

Update the `createSchedule` callback to include workspace_id:

```typescript
const createSchedule = useCallback(async (_userId: string) => {
  try {
    await api.post('/integrations/sync-schedules', {
      sync_type: 'facebook_ads',
      interval_minutes: 30,
      is_active: true,
      workspace_id: activeWorkspaceId || undefined,
    });
    queryClient.invalidateQueries({ queryKey: ['sync-schedule'] });
  } catch (err) {
    console.error('Error creating schedule:', err);
  }
}, [queryClient, activeWorkspaceId]);
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/hooks/useSyncSchedule.ts
git commit -m "fix(frontend): send workspace_id in sync schedule queries"
```

---

## Task 9: Smoke test and final commit

- [ ] **Step 1: Run the build to catch type errors**

```bash
cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npm run build
```

Expected: Build passes for both frontend and backend.

- [ ] **Step 2: Run existing tests**

```bash
npm run test
```

Expected: All existing tests pass.

- [ ] **Step 3: Push to remote**

```bash
git push
```
