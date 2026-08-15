# Robust Facebook Ad ID Extraction in Webhooks

**Status**: Design approved, ready for implementation plan
**Date**: 2026-04-16
**Scope**: Backend — webhook attribution layer

## Problem

Checkout platforms (Hotmart, Kiwify, Kirvano, Perfect Pay, Ticto, PayT, Cakto, Balaclava, Guru, CartPanda, GGCheckout, Hubla, Lastlink) send webhooks with Facebook ad tracking info scattered across multiple fields: `xcod`, `src`, `sck`, `utm_term`, `utm_content`, `utm_medium`, `utm_campaign`. The current parser splits those fields by position and expects canonical separators (`|`, `/`).

In practice, producers build checkout links with a variety of broken formats:

- `hQwK21wXxR` used instead of `|` (seen in Hotmart and Cakto payloads).
- `::` followed by encoded `fbclid` session data (seen in Ticto, Perfect Pay, Cakto).
- Ad IDs glued to text — e.g. `120242561654030467hQwK21wXxRInstagram_Feed`.

Today these sales fall to "orgânica" (no attribution) even when the ad ID is clearly present in the payload. Producers usually will not fix their funnels, so the system must be tolerant to malformed tracking strings.

## Goal

Extract the Facebook ad ID from any payload regardless of separator or position, then look it up in `ads.facebook_ad_id` for that user. If a match exists, attribute the sale to the ad (and implicitly to its ad set and campaign via the DB relationships). If no match, the sale stays orgânica.

## Non-goals

- No retroactive rematch of past sales (only applies to new webhooks).
- No attribution at ad set or campaign level when the ad match fails — the sale is orgânica in that case. Ad-level precision is the only useful attribution signal for this product.
- No duplicate-ad detection (scenario where a user manually hardcoded the same ad ID into a duplicated Facebook ad). That is a UTM-tracking limitation out of scope here — a CAPI-based attribution would be a separate initiative.
- No DB constraint or tie-breaker work for the (very rare) case where the `ads` table has two rows with the same `(user_id, facebook_ad_id)`. If it happens, `.limit(1)` picks one non-deterministically; accepted risk.

## Design

### Extraction: one regex over all tracking fields

Facebook ad IDs observed across every real payload in `docs/webhook-payloads/` share a stable format: **numeric, 15–18 digits, starting with `120`** (examples: `120242561654030467`, `120240476103090092`, `120236181571540300`, `120237588708440278`).

A single helper in `WebhooksService` concatenates all tracking fields into a haystack string and runs:

```
/\b120\d{12,15}\b/g
```

The word boundary isolates the numeric candidate even when glued to surrounding text. Duplicate candidates are deduplicated via `Set`.

Fields scanned (any subset may be `null`/absent):

```
xcod, src, sck, utm_term, utm_content, utm_medium, utm_campaign, utm_id, ad_id
```

### Matching: single query against `ads`

With the deduplicated candidate list, one query resolves the attribution:

```sql
SELECT id, ad_set_id, ad_sets.campaign_id
FROM ads
INNER JOIN ad_sets ON ads.ad_set_id = ad_sets.id
WHERE ads.user_id = $1
  AND ads.facebook_ad_id IN ($2, $3, ...)
LIMIT 1
```

If a row returns, the sale is updated with `ad_internal_id`, `ad_set_id`, `campaign_id`. The ad set and campaign values come from the DB join, never from the webhook — guaranteeing consistency with Facebook's hierarchy as stored locally.

If no row returns, the sale remains orgânica: `ad_internal_id`, `ad_set_id`, `campaign_id` stay `null`.

### Why this is robust

- **Separator-agnostic**: the regex matches the number wherever it appears. `hQwK21wXxR`, `::`, spaces, slashes, no separator at all — all fine.
- **Position-agnostic**: no more reliance on `xcod` field order. The ID is found whether it shows up in `xcod` or `utm_term` or both.
- **Zero false positives from format**: the `120` prefix plus length constraint plus word boundary rejects fbclids (alphanumeric), phone numbers (shorter), timestamps (different prefix), and any arbitrary numeric string not matching the Facebook pattern.
- **Zero false positives from DB**: a candidate only wins if it exists in `ads.facebook_ad_id` for the right user. An accidental match from an unrelated numeric string in the payload does not attribute unless that number happens to be a real ad belonging to that user.

## Code changes

### `packages/backend/src/modules/webhooks/webhooks.service.ts`

**Add**:

```ts
extractFacebookAdIdCandidates(tracking: Record<string, string | null | undefined>): string[] {
  const haystack = Object.values(tracking).filter(Boolean).join(' ');
  const matches = haystack.match(/\b120\d{12,15}\b/g) || [];
  return [...new Set(matches)];
}

async matchSaleToAd(userId: string, candidates: string[]): Promise<MatchResult> {
  if (candidates.length === 0) return { campaign_id: null, ad_set_id: null, ad_internal_id: null };

  const { data } = await this.supabase.getClient()
    .from('ads')
    .select(`id, ad_set_id, ad_sets!inner(campaign_id)`)
    .eq('user_id', userId)
    .in('facebook_ad_id', candidates)
    .limit(1)
    .maybeSingle();

  if (!data) return { campaign_id: null, ad_set_id: null, ad_internal_id: null };

  return {
    ad_internal_id: data.id,
    ad_set_id: data.ad_set_id,
    campaign_id: (data.ad_sets as any).campaign_id,
  };
}
```

**Remove**:

- `extractAdId()`
- `extractNumericAdId()`
- `matchSaleToAds()` — the full function is deleted. `matchSaleToAd()` (new, singular) is its replacement.

**Adapt**: `matchAndUpdateSale()` to take `candidates: string[]` as the tracking input (replacing the `{ adId, utmCampaign, utmContent, utmTerm, adSetFbId, campaignFbId }` shape). Call sites pass the array from `extractFacebookAdIdCandidates()`.

### Processors

Every processor in `packages/backend/src/modules/webhooks/processors/` is updated at its attribution call site:

```ts
const candidates = this.webhooksService.extractFacebookAdIdCandidates({
  xcod, src, sck,
  utm_term, utm_content, utm_medium, utm_campaign,
  utm_id, ad_id,
});

this.webhooksService.matchAndUpdateSale(saleId, userId, candidates);
```

Each processor wires the object from its own payload shape (Hotmart from `purchase.origin`, Kiwify from `TrackingParameters`, Cakto from root + `sck`, etc.).

Files touched:

- `hotmart.processor.ts`
- `kiwify.processor.ts`
- `kirvano.processor.ts`
- `perfectpay.processor.ts`
- `ticto.processor.ts`
- `payt.processor.ts`
- `cakto.processor.ts`
- `guru.processor.ts`
- `cartpanda.processor.ts`
- `ggcheckout.processor.ts`
- `hubla.processor.ts`
- `balaclava.processor.ts`
- `lastlink.processor.ts`

What does *not* change in the processors: UTM string extraction (`utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`) continues to populate the `sales.utm_*` columns for reporting purposes. `parseXcod()` in `hotmart.processor.ts` stays for string extraction but loses its ad-id responsibility.

### Tests

`packages/backend/src/modules/webhooks/__tests__/webhooks.service.spec.ts` adds unit coverage for the extractor using the real payloads in `docs/webhook-payloads/`:

- Hotmart `xcod` with `hQwK21wXxR` corruption → returns 3 candidates.
- Cakto with corrupted `sck` but clean `utm_term` → returns candidates.
- Kirvano with clean numeric UTMs → returns 3 candidates.
- Guru with organic UTMs (`bio_link_ne`, `ig`) → returns empty array.
- Payload carrying `fbclid` / `_fbc` → does not emit fbclid values as candidates.

## Behavior change summary

| Scenario | Before | After |
|---|---|---|
| Hotmart `xcod` with `hQwK21wXxR` | orgânica | ad matched when ID exists in `ads` |
| Cakto `sck` with `hQwK21wXxR` but `utm_term` clean | already worked via `utm_term`, still works | same |
| Kirvano clean UTMs | ad matched | ad matched |
| No ad ID in payload (Guru bio link) | orgânica | orgânica |
| Ad ID present but not in `ads` (sync lag, producer's ID not imported) | orgânica | orgânica |
| Ad ID matches → old cascade falls through to `utm_campaign ilike` | occasionally attributes to wrong campaign | attributes to the correct ad |
| No ad ID match but `utm_campaign` equals a `facebook_campaign_id` | attributes at campaign level (no ad) | orgânica |
| No ad ID match but `utm_campaign` is a substring of a campaign name | attributes at campaign level via ilike (risky) | orgânica |

The last two rows are intentional regressions — the old ilike-by-name and campaign-id-only fallbacks were imprecise enough to be net-harmful; dropping them is part of this design.

## Rollout

- Single PR covering the service changes, all 13 processor updates, and the test suite.
- No DB migration.
- No feature flag.
- Monitoring: Discord logger already reports `adMatched` per sale — watch the rate before/after deploy.
