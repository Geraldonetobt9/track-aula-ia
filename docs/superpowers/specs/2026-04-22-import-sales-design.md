# Import Sales (Retroactive Sales Upload) — Design Spec

**Date:** 2026-04-22
**Status:** Approved (pending user review of this spec)
**Owner:** Matheus Valois
**Scope v1:** Hotmart only

---

## 1. Purpose

Allow a workspace user to upload a CSV or XLSX export of past Hotmart sales so the system records them retroactively, links them to existing Facebook ads via the UTM/xcod field (same logic as webhooks), prevents duplicates against sales already ingested via webhook, and explicitly excludes these imported sales from the plan-limit sales count.

**Motivating use case:** A user signs up today. The webhook integration only captures sales from signup onward; everything before is invisible. Import fills that gap. Plan pricing, however, is based on live webhook volume — so retroactive imports must not count toward the monthly cap.

## 2. Non-goals (v1)

- Other checkout platforms (Kiwify, Kirvano, Guru, Perfect Pay, Ticto, PayT, Cakto, Balaclava). Architecture is plugin-friendly but only Hotmart ships in v1.
- Asynchronous job tracking with a `sales_import_jobs` table. Processing is synchronous from the user's perspective — they stay on a blocking loading screen.
- Re-matching previously imported sales when new ads sync later from Facebook.
- Manual one-off sale entry.
- Importing statuses other than `Aprovado` (refunded/canceled/pending rows are skipped).

## 3. Behavior for the user

### Entry point

`/sales` page → new "Importar Vendas" button in the page header, next to the existing refresh button.

### UI flow (modal state machine)

```
[closed] → idle → previewing → preview-ready → importing → done
                ↘ error                      ↘ error
```

- **idle:** dropzone accepts `.csv` or `.xlsx` up to 5 MB. Help text mentions the 5.000-row limit and that only "Aprovado" sales are imported.
- **previewing:** small spinner while `POST /sales/import/preview` runs.
- **preview-ready:** summary counts + dropdown of active Hotmart integrations + preview of first 5 rows. User selects integration and clicks "Confirmar (N)".
- **importing:** full-modal blocking loader with message "Processando N vendas… Não feche esta janela." Close button is hidden; `onOpenChange` ignored.
- **done:** final report (imported / skipped_duplicates / skipped_non_approved / skipped_invalid). If there were invalid rows, an expandable accordion shows up to 5 examples with their reason.
- **error:** any step can transition to an error state with a human-readable message and a "Tentar outro arquivo" / "Voltar" button.

### Permissions

- Workspace-scoped: user must be a member of the active workspace.
- At least one active Hotmart `checkout_integration` must exist in the workspace; otherwise the dropzone step shows a CTA to `/settings/integrations`.

## 4. Business rules

1. **BR-01 — Deduplication.** Duplicates are detected by the UNIQUE `(external_id, workspace_id)` already enforced on `sales`. Import never creates a second row for the same `Transação`, whether the first row came from webhook or a previous import.
2. **BR-02 — Status filter.** Only rows with `Status = 'Aprovado'` are imported as `status='approved'`. All other statuses are counted as `skipped_non_approved` and not persisted. Future refund events naturally arrive via webhook and update the existing row.
3. **BR-03 — Plan-limit exclusion.** Sales with `source='import'` are NOT counted toward `plan.max_sales_monthly`. The `PlanLimitsService` count query filters `source='webhook'` explicitly. No webhook sale's counting behavior changes.
4. **BR-04 — Ad matching parity.** Imported sales use the same UTM/xcod parser and the same `matchAndUpdateSale` routine the webhook uses. If the ad does not exist in the workspace (e.g., it predates Facebook sync), the sale is persisted as organic (`campaign_id=NULL`).
5. **BR-05 — Amount in BRL.** The export column `Preço Total Convertido` is the amount Hotmart already converted to BRL; it is stored in `sales.amount` and `sales.currency` is fixed to `'BRL'`. This mirrors the webhook path, which also stores BRL-normalized amounts.
6. **BR-06 — Workspace scoping.** The import writes to the workspace of the caller, using the `integration_id` chosen in the modal for `checkout_integration_id`. The backend verifies the integration belongs to the caller's workspace and to `platform='hotmart'`; otherwise 403.
7. **BR-07 — Volume cap.** Files above 5 MB are rejected at the Fastify multipart boundary. Files with more than 5.000 data rows are rejected at the parse stage, before any insert.
8. **BR-08 — Idempotency under concurrency.** If a webhook arrives for the same transaction during an import, the insert uses `onConflict: (external_id, workspace_id) DO NOTHING`; whichever arrives first wins, the other is a no-op. No duplicate, no error.
9. **BR-09 — Refunds on imported sales.** If a webhook later refunds a sale whose row has `source='import'`, the existing update path sets `status='refunded'` without changing `source`. Imports stay excluded from plan-limit forever — they never counted, they do not start counting.
10. **BR-10 — Synchronous ad matching during import.** For each inserted row, `WebhooksService.matchAndUpdateSale` runs inline before returning the response, so when the user returns to the grid attribution is already present.

## 5. Data model

### New migration

File: `supabase/migrations/20260422100000_sales_source_column.sql` (exact timestamp chosen at implementation time; this is the target slot after the current tail).

```sql
-- 1. Add origin marker on sales
ALTER TABLE public.sales
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'webhook'
    CHECK (source IN ('webhook', 'import', 'manual'));

-- 2. Partial index supporting the plan-limits query
--    (user_id, sold_at DESC) WHERE status='approved' AND blocked_by_limit=false AND source='webhook'
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_planlimits_webhook
  ON public.sales (user_id, sold_at DESC)
  WHERE status = 'approved' AND blocked_by_limit = false AND source = 'webhook';
```

Existing rows get `source='webhook'` via the column default, which is the correct historical value: every row in `sales` today came from a webhook.

`SQL_DATABASE.md` is updated in the same PR to describe the new column and index.

### CSV column mapping

All column indices below refer to the exact schema of the Hotmart export examined:

| CSV column (index) | `sales` field | Transformation |
|---|---|---|
| `Transação` (5) | `external_id` | trim |
| `Status` (19) | `status` | `Aprovado` → `approved`; anything else → skip (`skipped_non_approved`) |
| `Data de Venda` (17) | `sold_at` | parse `dd/MM/yyyy HH:mm:ss` as `America/Sao_Paulo`, convert to UTC |
| `Email` (22) | `customer_email` | lowercase + trim |
| `Nome` (20) | `customer_name` | trim |
| `Documento` (21) | `customer_doc` | trim |
| `DDD` (23) + `Telefone` (24) | `customer_phone` | concat with space when both present |
| `Cidade` (26) | `customer_city` | trim |
| `Estado` (27) | `customer_state` | trim |
| `País` (29) | `customer_country` | "Brasil"→`BR`, "Argentina"→`AR`, basic ISO lookup for common cases, else `NULL` |
| `Nome do Produto` (1) | `product_name` | trim |
| `Preço Total Convertido` (45) | `amount` | parse decimal; must be `> 0` or row is `skipped_invalid` |
| — | `currency` | fixed `'BRL'` |
| `Tipo de Pagamento` (38) | `payment_method` | map to canonical (`CREDIT_CARD`, `PIX`, `BOLETO`, `PAYPAL`, `MERCADO_PAGO`, `APPLE_PAY`, etc.) — same canonical set the webhook stores |
| `Origem` (7) | xcod input | passed through the shared `parseXcod` util → `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `ad_id` |
| — | `checkout_source` | fixed `'hotmart'` |
| — | `checkout_integration_id` | from modal's dropdown |
| — | `source` | fixed `'import'` |
| — | `blocked_by_limit` | fixed `false` |
| — | `metadata` | `{ source_type: 'import', imported_at: ISO, original_filename: string, raw_row: {...} }` |

### Per-row validation

A row is `skipped_invalid` if any of the following fails (response includes a short reason for the first 5):

- `Transação` empty.
- `Data de Venda` unparseable.
- `Preço Total Convertido` missing / not numeric / `<= 0`.
- `Email` empty.

A row is `skipped_non_approved` if `Status != 'Aprovado'`. A row is `skipped_duplicates` if `(external_id, workspace_id)` already exists in `sales`.

### Shared tracking parser

`parseXcod` and `extractAdIdFromValue` are extracted from `packages/backend/src/modules/webhooks/processors/hotmart.processor.ts:445-524` into a new utility module:

```
packages/backend/src/modules/webhooks/processors/hotmart-tracking.util.ts
```

Both `HotmartProcessor` and `SalesImportService` import from this util. The extraction is guarded by a snapshot test committed *before* the refactor, covering the real pipe-delimited formats present in the provided CSV plus degenerate inputs.

## 6. API

### `POST /sales/import/preview`

Parses the uploaded file and returns summary counts without inserting anything. Backend is stateless — the file is discarded after the response.

**Request:**
- `Authorization: Bearer <jwt>` (AuthGuard + WorkspaceMemberGuard)
- `multipart/form-data`:
  - `file`: `.csv` or `.xlsx`, ≤ 5 MB
  - `platform`: `'hotmart'`

**Response 200:**
```ts
{
  total_rows: number,
  to_import: number,           // Aprovado AND not duplicate AND valid
  duplicates: number,
  non_approved: number,
  invalid: number,
  invalid_samples: Array<{ row: number, reason: string }>,  // up to 5
  sample_preview: Array<{                                    // first 5 rows to import
    transaction: string,
    product_name: string,
    customer_email: string,
    amount_brl: number,
    sold_at: string,  // ISO
  }>,
  integrations: Array<{ id: string, name: string }>,
}
```

**Error responses:**
- `400 unsupported_format` — extension not csv/xlsx.
- `400 parse_error` — delimiter detection failed, header malformed.
- `400 unsupported_schema` — required column missing. Body includes `{ missing_column: string }`.
- `400 no_data_rows` — file has only header.
- `400 too_many_rows` — more than 5.000 data rows.
- `413 file_too_large` — > 5 MB (Fastify multipart).
- `422 no_active_integration` — workspace has zero active Hotmart integrations.

### `POST /sales/import`

Parses the file again and persists rows. Runs ad matching synchronously per inserted row before returning.

**Request:**
- `Authorization: Bearer <jwt>` (AuthGuard + WorkspaceMemberGuard)
- `multipart/form-data`:
  - `file`: same file the user previewed
  - `platform`: `'hotmart'`
  - `integration_id`: UUID of a Hotmart integration in the caller's workspace

**Response 200:**
```ts
{
  imported: number,
  skipped_duplicates: number,
  skipped_non_approved: number,
  skipped_invalid: number,
  invalid_samples: Array<{ row: number, reason: string }>,  // up to 5
}
```

**Error responses:** same 4xx catalog as `preview`, plus:
- `403 integration_forbidden` — `integration_id` not found, not active, not Hotmart, or belongs to another workspace.

### Rate limit

Both endpoints use the project's existing `ThrottlerGuard` with a local override: **5 imports per minute per user**. Sufficient for legitimate flows (preview + commit = 2 calls); blocks abuse.

## 7. Service layer

### `SalesImportService` (new)

Location: `packages/backend/src/modules/sales/sales-import.service.ts`

Responsibilities:
1. Parse file into rows.
2. Classify each row: import / duplicate / non_approved / invalid.
3. Upsert imports in chunks of 500 (CLAUDE.md Regra 3 — batch ops, never insert in loop).
4. For each inserted sale, call `WebhooksService.matchAndUpdateSale` inline.
5. Return the report DTO.

Public methods:
```ts
preview(file: Buffer | Readable, filename: string, userId: string, workspaceId: string): Promise<PreviewResponse>
import(file: Buffer | Readable, filename: string, userId: string, workspaceId: string, integrationId: string): Promise<ImportResponse>
```

### `SalesService.upsertManyImported(rows: ImportedSaleInput[])` (new)

Single batched upsert with `onConflict: 'external_id,workspace_id'`, `ignoreDuplicates: true`. Returns inserted rows (subset of input, minus duplicates). Sets `source='import'` and `blocked_by_limit=false` unconditionally on write.

### Parser details

- **CSV:** `csv-parse` (already a common Node dep; add if not present). Options: `delimiter: ';'` (with fallback to `,` on single-column row), `bom: true`, `columns: true`, `skip_empty_lines: true`, `trim: true`.
- **XLSX:** `xlsx` (SheetJS) — reads both legacy `.xls` and OOXML `.xlsx`. We explicitly reject legacy `.xls` (check magic bytes) with a clear message, even though the lib could read it, because Hotmart's current "xls" button returns OOXML.
- Row limit enforced after streaming the header + first 5.001 records; if the 5.001st exists, abort with `too_many_rows` before allocating the full array.

## 8. Plan-limits change

Single diff in `packages/backend/src/modules/plan-limits/plan-limits.service.ts` (the count query around line 145-151):

```diff
  .eq('user_id', userId)
  .eq('status', 'approved')
  .eq('blocked_by_limit', false)
+ .eq('source', 'webhook')
  .gte('sold_at', periodStart)
  .lt('sold_at', periodEnd)
```

The new partial index `idx_sales_planlimits_webhook` exactly matches the predicates, so the query becomes strictly cheaper than today.

## 9. Frontend

### New files

```
packages/frontend/src/
├── components/sales/
│   └── ImportSalesModal.tsx
└── hooks/
    ├── useSalesImportPreview.ts   // useMutation → POST /sales/import/preview
    └── useSalesImportCommit.ts    // useMutation → POST /sales/import
```

### Integration in `Sales.tsx`

Header row (around `Sales.tsx:180-196`) gains an "Importar Vendas" button that opens `ImportSalesModal`. State transitions follow section 3. On `done` close, invalidate `['sales', workspaceId]` so the grid refreshes with the new rows (attribution already populated thanks to synchronous matching).

### Client-side validations (minimal)

Before calling the preview endpoint:
- Extension ∈ `{.csv, .xlsx}`.
- Size ≤ 5 MB.

Any deeper validation is backend-only to keep a single source of truth.

### Blocking the user during commit

The `importing` state hides the close button and passes a no-op `onOpenChange` to Radix's Dialog. The user can only leave by ending the request (which naturally transitions to `done` or `error`).

## 10. Edge cases

| Scenario | Behavior |
|---|---|
| BOM UTF-8 header | `csv-parse` `bom: true` handles it. |
| Ambiguous delimiter (`,` vs `;`) | Try `;` first; if resulting single column, retry with `,`; both fail → 400. |
| Legacy binary `.xls` | Rejected with specific message; not supported. |
| Empty file (only header) | 400 `no_data_rows`. |
| Missing critical column in header | 400 `unsupported_schema` with the missing column name. |
| Webhook arrives for same transaction during import | `onConflict DO NOTHING` — first writer wins. |
| User closes tab during importing | The request is aborted on disconnect via `req.raw.on('close')` — the service checks the abort signal between chunks and stops. Chunks already committed persist. Re-importing is idempotent via dedup. |
| Ads not yet synced for imported period | Sales imported as organic (`campaign_id=NULL`). No retroactive re-match. |
| Later webhook refund on an imported sale | Existing path updates `status='refunded'`; `source` stays `'import'`. Still excluded from limit. |
| User has zero Hotmart integrations | Preview returns 422 with CTA to `/settings/integrations`. |
| User has multiple Hotmart integrations | Dropdown in the modal; required. |
| Hotmart adds a new payment method we don't canonicalize | Store the raw string in `payment_method` as a passthrough; existing behavior of the webhook path. |
| Row exists for a different workspace of the same user | Not a duplicate for current workspace; inserted normally (uniqueness is per workspace). |

## 11. Testing

### Backend (Jest)

1. **Plan-limits exclusion (the headline rule — BR-03).** Insert 5 `source='import'` + 3 `source='webhook'`, all approved, all in current period → count is 3.
2. **Snapshot of `parseXcod` / `extractAdIdFromValue`** over 6+ fixtures extracted from the real CSV plus degenerate inputs, committed before the refactor.
3. **`SalesImportService.parseFile` unit tests** — CSV and XLSX fixtures covering BOM, São Paulo timezone dates, country ISO mapping, skipped_non_approved, skipped_invalid reasons (missing transaction, non-numeric amount, zero amount, missing email).
4. **Integration tests against a real database** — new inserts, mixed with pre-seeded duplicates, cross-workspace, 5.001-row rejection, 6 MB rejection, integration from another workspace rejection.
5. **Sync ad matching** — ad pre-seeded with matching Facebook ID; imported row picks it up.
6. **Auth** — missing token → 401; foreign workspace → 403.

### Frontend (Vitest + Testing Library)

1. Modal state-machine renders each step correctly; transitions on mutation success/error.
2. Client-side validation rejects `.pdf` without calling the API.
3. Zero-integration case shows the CTA and hides the dropzone CTA.
4. During `importing`, close button and overlay click are inert.
5. On `done` close, `queryClient.invalidateQueries(['sales', workspaceId])` is dispatched.

### E2E (optional if a suite exists at implementation time)

One happy-path run with a 10-row CSV covering all buckets (import / duplicate / non_approved / invalid).

## 12. Documentation

- `docs/features/15-import-sales/import-sales.md` — new feature doc from `docs/features/TEMPLATE.md`.
- `docs/features/05-sales/*.md` — cross-reference the two ingestion paths (webhook vs import).
- `docs/features/11-plans-and-limits/*.md` — explicitly state that only `source='webhook'` counts.
- `SQL_DATABASE.md` — new column `source` + new index.
- `docs/webhook-payloads/hotmart-csv-export.csv` + README entry — reference sample (masked) of the import file format. Not a webhook payload, but lives alongside for discoverability.

## 13. Rollout

- **No feature flag.** Low blast radius (opt-in button, idempotent, no impact on webhook path if snapshot test passes).
- **Commit order:**
  1. Migration + `SQL_DATABASE.md`.
  2. `parseXcod` extraction + snapshot tests.
  3. `SalesImportService`, endpoints, guards, plan-limits filter.
  4. Frontend modal + hooks + button.
  5. Feature docs.
- **Monitoring:** structured log on each import with `{ event: 'sales_import', workspace_id, imported, skipped_duplicates, skipped_invalid, duration_ms }`. Reuses existing 4xx/5xx dashboards.

## 14. Open questions / deferred

- **Historical ad re-matching.** If the user imports sales today and the Facebook sync fetches older ads tomorrow, the imported sales won't automatically re-attribute. Out of scope; revisit if users complain.
- **Other platforms.** Kiwify, Kirvano, Guru, Perfect Pay, Ticto, PayT, Cakto, Balaclava. Each ships as its own small PR, reusing the `SalesImportService` skeleton with a new parser + column map.
- **Progress feedback for files close to 5.000 rows.** Current UX is a blocking loader with no percentage. If imports regularly feel too slow (> 10 s), revisit and introduce Server-Sent Events from the commit endpoint.
- **Optional `skipped_non_approved` import.** Some users might want full history. If asked, expose a checkbox in the modal that flips a backend flag; schema already supports all statuses.
