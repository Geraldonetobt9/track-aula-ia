# Background Persist Facebook Data on Metrics Fetch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When the user clicks "Atualizar" and the system fetches campaigns/ad sets/ads from the Facebook API for display, persist that data to the `campaigns`, `ad_sets`, and `ads` database tables in the background — without blocking the response to the user.

**Architecture:** Add a `persistFacebookData()` fire-and-forget method to `LiveMetricsService` that receives the already-fetched Facebook data (campaigns, ad sets, ads) and upserts it into the database. Call it at the end of `getCampaigns()`, `getAdSets()`, and `getAds()` after computing the response but before returning. The method uses the same upsert-by-facebook-id pattern that `insights.service.ts` uses, but without generating UUIDs for new records (uses `randomUUID()`). The response is returned immediately; persistence happens in the background.

**Tech Stack:** NestJS 10, TypeScript strict, Supabase client

---

## File Structure

| Action | File | Responsibility |
|--------|------|---------------|
| Modify | `packages/backend/src/modules/metrics/live-metrics.service.ts` | Add `persistFacebookData()` + call from getCampaigns/getAdSets/getAds |

This is a single-file change. The method is private, fire-and-forget, and uses the same Supabase client already injected.

---

### Task 1: Add `persistFacebookData()` method and wire it into `getCampaigns()`

**Files:**
- Modify: `packages/backend/src/modules/metrics/live-metrics.service.ts`

- [ ] **Step 1: Add the `persistFacebookData` method**

At the bottom of `LiveMetricsService` (before the closing `}` of the class), add the `randomUUID` import at the top of the file and the persist method:

Add import at line 1 area:
```typescript
import { randomUUID } from 'crypto';
```

Add the method before the class closing brace:

```typescript
  // ============================================
  // Private: Persist Facebook data to DB (fire-and-forget)
  // ============================================
  private async persistFacebookData(
    userId: string,
    workspaceId: string | null,
    data: {
      campaigns?: Array<{
        facebook_campaign_id: string;
        ad_account_id: string;
        name: string;
        status: string;
        objective?: string;
        daily_budget?: number | null;
        lifetime_budget?: number | null;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        meta_revenue?: number;
      }>;
      adSets?: Array<{
        facebookAdSetId: string;
        facebookCampaignId: string;
        ad_account_id: string;
        name: string;
        status: string;
        daily_budget?: number | null;
        lifetime_budget?: number | null;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        meta_revenue?: number;
      }>;
      ads?: Array<{
        facebookAdId: string;
        facebookAdSetId: string;
        facebookCampaignId?: string;
        ad_account_id: string;
        name: string;
        status: string;
        spend: number;
        impressions: number;
        clicks: number;
        conversions: number;
        meta_revenue?: number;
      }>;
      connectionId?: string;
      since?: string;
      until?: string;
    },
  ): Promise<void> {
    try {
      const client = this.supabase.getClient();
      const now = new Date().toISOString();

      // --- Campaigns ---
      if (data.campaigns?.length) {
        const { data: existing } = await client
          .from('campaigns')
          .select('id, facebook_campaign_id')
          .eq('user_id', userId);

        const existingMap = new Map<string, string>(
          (existing || []).map((c: any) => [c.facebook_campaign_id, c.id]),
        );

        const rows = data.campaigns.map((c) => ({
          id: existingMap.get(c.facebook_campaign_id) || randomUUID(),
          user_id: userId,
          workspace_id: workspaceId,
          facebook_campaign_id: c.facebook_campaign_id,
          name: c.name,
          status: c.status?.toLowerCase() === 'active' ? 'active' : 'paused',
          objective: c.objective || null,
          daily_budget: c.daily_budget || null,
          lifetime_budget: c.lifetime_budget || null,
          spend: c.spend,
          impressions: c.impressions,
          clicks: c.clicks,
          conversions: c.conversions,
          date_start: data.since || null,
          date_end: data.until || null,
          synced_at: now,
        }));

        const { error } = await client
          .from('campaigns')
          .upsert(rows, { onConflict: 'id' });

        if (error) {
          this.logger.warn(`[persistFacebookData] campaigns upsert error: ${error.message}`);
        } else {
          this.logger.log(`[persistFacebookData] Persisted ${rows.length} campaigns`);
        }
      }

      // --- Ad Sets ---
      if (data.adSets?.length) {
        // Need campaign internal IDs for FK
        const { data: campaignRows } = await client
          .from('campaigns')
          .select('id, facebook_campaign_id')
          .eq('user_id', userId);

        const campaignMap = new Map<string, string>(
          (campaignRows || []).map((c: any) => [c.facebook_campaign_id, c.id]),
        );

        const { data: existingAdSets } = await client
          .from('ad_sets')
          .select('id, facebook_adset_id')
          .eq('user_id', userId);

        const existingMap = new Map<string, string>(
          (existingAdSets || []).map((a: any) => [a.facebook_adset_id, a.id]),
        );

        const rows = data.adSets
          .filter((as) => campaignMap.has(as.facebookCampaignId))
          .map((as) => ({
            id: existingMap.get(as.facebookAdSetId) || randomUUID(),
            user_id: userId,
            workspace_id: workspaceId,
            campaign_id: campaignMap.get(as.facebookCampaignId)!,
            facebook_adset_id: as.facebookAdSetId,
            name: as.name,
            status: as.status?.toLowerCase() === 'active' ? 'active' : 'paused',
            daily_budget: as.daily_budget || null,
            lifetime_budget: as.lifetime_budget || null,
            spend: as.spend,
            impressions: as.impressions,
            clicks: as.clicks,
            conversions: as.conversions,
            date_start: data.since || null,
            date_end: data.until || null,
            synced_at: now,
          }));

        if (rows.length > 0) {
          const { error } = await client
            .from('ad_sets')
            .upsert(rows, { onConflict: 'id' });

          if (error) {
            this.logger.warn(`[persistFacebookData] ad_sets upsert error: ${error.message}`);
          } else {
            this.logger.log(`[persistFacebookData] Persisted ${rows.length} ad sets`);
          }
        }
      }

      // --- Ads ---
      if (data.ads?.length) {
        // Need ad_set internal IDs for FK
        const { data: adSetRows } = await client
          .from('ad_sets')
          .select('id, facebook_adset_id')
          .eq('user_id', userId);

        const adSetMap = new Map<string, string>(
          (adSetRows || []).map((a: any) => [a.facebook_adset_id, a.id]),
        );

        const { data: existingAds } = await client
          .from('ads')
          .select('id, facebook_ad_id')
          .eq('user_id', userId);

        const existingMap = new Map<string, string>(
          (existingAds || []).map((a: any) => [a.facebook_ad_id, a.id]),
        );

        const rows = data.ads
          .filter((ad) => adSetMap.has(ad.facebookAdSetId))
          .map((ad) => ({
            id: existingMap.get(ad.facebookAdId) || randomUUID(),
            user_id: userId,
            workspace_id: workspaceId,
            ad_set_id: adSetMap.get(ad.facebookAdSetId)!,
            facebook_ad_id: ad.facebookAdId,
            name: ad.name,
            status: ad.status?.toLowerCase() === 'active' ? 'active' : 'paused',
            spend: ad.spend,
            impressions: ad.impressions,
            clicks: ad.clicks,
            conversions: ad.conversions,
            date_start: data.since || null,
            date_end: data.until || null,
            synced_at: now,
          }));

        if (rows.length > 0) {
          const { error } = await client
            .from('ads')
            .upsert(rows, { onConflict: 'id' });

          if (error) {
            this.logger.warn(`[persistFacebookData] ads upsert error: ${error.message}`);
          } else {
            this.logger.log(`[persistFacebookData] Persisted ${rows.length} ads`);
          }
        }
      }
    } catch (err: any) {
      this.logger.warn(`[persistFacebookData] Non-blocking error: ${err.message}`);
    }
  }
```

- [ ] **Step 2: Wire into `getCampaigns()`**

In the `getCampaigns()` method, just before the `return result;` line (around line 157), add a fire-and-forget call that persists campaigns AND ads (since both are already fetched):

```typescript
    // Persist to DB in background (fire-and-forget)
    this.persistFacebookData(userId, filters.workspace_id || null, {
      campaigns: fbCampaigns,
      ads: fbAds,
      since,
      until,
    });

    return result;
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/metrics/live-metrics.service.ts
git commit -m "feat(metrics): persist Facebook campaigns and ads to DB on metrics fetch"
```

---

### Task 2: Wire `persistFacebookData` into `getAdSets()` and `getAds()`

**Files:**
- Modify: `packages/backend/src/modules/metrics/live-metrics.service.ts`

- [ ] **Step 1: Wire into `getAdSets()`**

In the `getAdSets()` method, just before `return mapped;` (around line 238), add:

```typescript
    // Persist to DB in background (fire-and-forget)
    this.persistFacebookData(userId, filters.workspace_id || null, {
      adSets: fbAdSets,
      ads: fbAds,
      since,
      until,
    });

    return mapped;
```

- [ ] **Step 2: Wire into `getAds()`**

In the `getAds()` method, just before `return mapped;` (around line 283), add:

```typescript
    // Persist to DB in background (fire-and-forget)
    this.persistFacebookData(userId, filters.workspace_id || null, {
      ads: fbAds,
      since,
      until,
    });

    return mapped;
```

- [ ] **Step 3: Verify compilation**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 4: Run existing tests**

Run: `cd packages/backend && npx jest src/modules/webhooks/__tests__/webhooks.service.spec.ts --no-coverage`
Expected: All tests pass (our changes don't affect webhook tests)

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/metrics/live-metrics.service.ts
git commit -m "feat(metrics): persist Facebook ad sets and ads to DB on metrics fetch"
```

---

### Task 3: Trigger `rematchSales` after background persist

**Files:**
- Modify: `packages/backend/src/modules/metrics/live-metrics.service.ts`
- Modify: `packages/backend/src/modules/metrics/metrics.module.ts`

Now that we're persisting ads to the DB on every metrics fetch, we should also run `rematchSales()` so any unmatched sales get linked to the freshly-persisted ads. This is the same thing the old sync button did.

- [ ] **Step 1: Import SaleMatcherService in MetricsModule**

In `packages/backend/src/modules/metrics/metrics.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { LiveMetricsService } from './live-metrics.service';
import { FacebookModule } from '../facebook/facebook.module';

@Module({
  imports: [FacebookModule],
  controllers: [MetricsController],
  providers: [MetricsService, LiveMetricsService],
  exports: [MetricsService, LiveMetricsService],
})
export class MetricsModule {}
```

- [ ] **Step 2: Inject SaleMatcherService into LiveMetricsService**

In `live-metrics.service.ts`, add import and inject:

```typescript
import { SaleMatcherService } from '../facebook/sale-matcher.service';
```

Update constructor:

```typescript
  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly saleMatcher: SaleMatcherService,
  ) {}
```

- [ ] **Step 3: Call rematchSales at the end of persistFacebookData**

At the end of `persistFacebookData()`, after all upserts, add:

```typescript
      // Rematch unmatched sales against freshly persisted ads
      if (data.ads?.length) {
        try {
          const result = await this.saleMatcher.rematchSales(userId);
          if (result.rematched > 0) {
            this.logger.log(`[persistFacebookData] Rematched ${result.rematched} sales`);
          }
        } catch (err: any) {
          this.logger.warn(`[persistFacebookData] rematch error: ${err.message}`);
        }
      }
```

Place this inside the outer try block, after the ads upsert section, before the catch.

- [ ] **Step 4: Check if FacebookModule exports SaleMatcherService**

Read `packages/backend/src/modules/facebook/facebook.module.ts` and verify `SaleMatcherService` is in the `exports` array. If not, add it.

- [ ] **Step 5: Verify compilation**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/metrics/live-metrics.service.ts packages/backend/src/modules/metrics/metrics.module.ts
git commit -m "feat(metrics): rematch sales after background Facebook data persist"
```

---

### Task 4: Final verification

- [ ] **Step 1: Verify TypeScript compilation**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: No errors

- [ ] **Step 2: Run tests**

Run: `cd packages/backend && npx jest src/modules/webhooks/__tests__/webhooks.service.spec.ts --no-coverage`
Expected: All tests pass

- [ ] **Step 3: Verify the flow**

Check the complete data flow:
1. User clicks "Atualizar" → frontend calls `/metrics/campaigns`
2. Backend `getCampaigns()` fetches from Facebook API → returns data to user immediately
3. In background: `persistFacebookData()` upserts campaigns + ads to DB
4. In background: `rematchSales()` links unmatched sales to freshly persisted ads
5. Next webhook that arrives → `matchSaleToAds()` finds the ads in the DB → match succeeds

Run: `grep -n "persistFacebookData" packages/backend/src/modules/metrics/live-metrics.service.ts`
Expected: Should appear in `getCampaigns`, `getAdSets`, `getAds`, and the method definition itself.

- [ ] **Step 4: Commit if any cleanup needed**

```bash
git add -A
git commit -m "feat(metrics): complete background Facebook data persistence"
```

---

## Summary

After this plan:

```
User clicks "Atualizar"
    ↓
/metrics/campaigns called
    ↓
Facebook API fetched → response returned to user IMMEDIATELY
    ↓ (background, fire-and-forget)
persistFacebookData() runs:
  1. Upsert campaigns (existing → update, new → insert)
  2. Upsert ad sets (with campaign FK)
  3. Upsert ads (with ad_set FK)
  4. rematchSales() → link unmatched sales
    ↓
DB is up to date for next webhook match
```

**No duplication**: uses the same `existingMap` + `randomUUID()` pattern as `insights.service.ts`. Existing records are matched by `facebook_campaign_id`/`facebook_adset_id`/`facebook_ad_id` and updated. New records get a fresh UUID.

**Non-blocking**: `persistFacebookData()` is called without `await` — the response goes to the user immediately.
