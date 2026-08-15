# Integration Commission Flag Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to choose per-integration whether to record the gross sale amount or the producer's net commission as the sale `amount`.

**Architecture:** Add `use_commission_value` boolean column to `checkout_integrations` (default `false`). Each webhook processor reads this flag and conditionally extracts the producer's net value from the platform-specific commission field. Frontend adds a radio group to the integration config modal.

**Tech Stack:** Supabase migration (SQL), NestJS (DTO + processors), React (modal + hook)

---

### Task 1: Database Migration

**Files:**
- Create: `supabase/migrations/20260407000003_integration_commission_flag.sql`

- [ ] **Step 1: Create migration file**

```sql
-- Add use_commission_value flag to checkout_integrations
-- When true, webhook processors record the producer's net commission instead of the gross sale amount
ALTER TABLE public.checkout_integrations
ADD COLUMN use_commission_value BOOLEAN NOT NULL DEFAULT false;
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260407000003_integration_commission_flag.sql
git commit -m "feat(db): add use_commission_value column to checkout_integrations"
```

---

### Task 2: Backend DTO + Integration Service Select

**Files:**
- Modify: `packages/backend/src/modules/integrations/dto/save-checkout.dto.ts`
- Modify: `packages/backend/src/modules/integrations/integrations.service.ts`

- [ ] **Step 1: Add field to DTO**

In `save-checkout.dto.ts`, add after the `is_active` field:

```typescript
@IsOptional()
@IsBoolean()
use_commission_value?: boolean;
```

- [ ] **Step 2: Add `use_commission_value` to the select in `listCheckoutIntegrations`**

In `integrations.service.ts` line 15, update the select string to include `use_commission_value`:

```typescript
let query = db.from('checkout_integrations').select('id, user_id, platform, webhook_secret, is_active, last_webhook_at, created_at, updated_at, webhook_url, api_token, use_commission_value').eq('user_id', userId);
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/integrations/dto/save-checkout.dto.ts packages/backend/src/modules/integrations/integrations.service.ts
git commit -m "feat(backend): add use_commission_value to DTO and integration list query"
```

---

### Task 3: Update Webhook Processors — Hotmart

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/hotmart.processor.ts`

The Hotmart processor is the most complex because it handles currency conversion. The integration query is at line 91. Currently selects `id, user_id, workspace_id, is_active`.

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 93 from:
```typescript
.select('id, user_id, workspace_id, is_active')
```
to:
```typescript
.select('id, user_id, workspace_id, is_active, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic after amount calculation**

After line 175 (after the currency conversion block, before `const externalId`), add logic to override amount if `use_commission_value` is true:

```typescript
// If user chose to record commission (net) value instead of sale (gross) value
if (integration.use_commission_value) {
  const producerCommission = (payload.data?.commissions || []).find(
    (c: any) => c.source === 'PRODUCER',
  );
  if (producerCommission) {
    const producerValue = Number(producerCommission.value || 0);
    if (producerValue > 0) {
      // If foreign currency, convert using the producer's own conversion rate or fallback
      if (originalCurrency !== 'BRL' && producerCommission.currency_conversion?.converted_value) {
        amount = Number(producerCommission.currency_conversion.converted_value);
      } else if (originalCurrency !== 'BRL' && exchangeRateUsed !== 1.0) {
        amount = convertToBRL(producerValue, exchangeRateUsed);
      } else {
        amount = producerValue;
      }
      this.logger.log(`[Hotmart] Using commission value: ${amount} (producer commission)`);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/hotmart.processor.ts
git commit -m "feat(webhooks): hotmart processor supports use_commission_value flag"
```

---

### Task 4: Update Webhook Processors — Kiwify

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/kiwify.processor.ts`

Kiwify fetches all active integrations and matches by HMAC signature. The select is at line 60. Commission value is in `commissions.my_commission` (centavos).

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 60 from:
```typescript
.select('id, user_id, workspace_id, webhook_secret')
```
to:
```typescript
.select('id, user_id, workspace_id, webhook_secret, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic after amount parsing**

After line 256 (`this.logger.log('Parsed amount: ' + amount);`), add:

```typescript
// If user chose to record commission (net) value
if (matchedIntegration.use_commission_value) {
  const myCommission = commissions?.my_commission;
  if (myCommission) {
    const commissionNum = typeof myCommission === 'string'
      ? Number(myCommission.replace(/\./g, '').replace(',', '.'))
      : Number(myCommission);
    const parsed = Number.isInteger(commissionNum) && commissionNum >= 100
      ? commissionNum / 100
      : commissionNum;
    if (parsed > 0) {
      amount = parsed;
      this.logger.log('Using commission value: ' + amount);
    }
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/kiwify.processor.ts
git commit -m "feat(webhooks): kiwify processor supports use_commission_value flag"
```

---

### Task 5: Update Webhook Processors — Kirvano

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/kirvano.processor.ts`

Integration select at line 41. Commission value is `body.commission` or `body.fiscal?.commission` (top-level, in reais).

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 42 from:
```typescript
.select('id, user_id, workspace_id, webhook_secret')
```
to:
```typescript
.select('id, user_id, workspace_id, webhook_secret, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic after amount calculation**

After line 145 (`const amount = sale.amount || sale.value || body.amount || 0;`), add:

```typescript
// If user chose to record commission (net) value
if (integration.use_commission_value) {
  const commissionValue = Number(body.commission || body.fiscal?.commission || 0);
  if (commissionValue > 0) {
    this.logger.log(`[Kirvano] Using commission value: ${commissionValue}`);
    // Override amount below when building saleData
  }
}
const finalAmount = integration.use_commission_value
  ? (Number(body.commission || body.fiscal?.commission || 0) || Number(amount))
  : Number(amount);
```

Then update line 172 in saleData from `amount: Number(amount)` to `amount: finalAmount`.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/kirvano.processor.ts
git commit -m "feat(webhooks): kirvano processor supports use_commission_value flag"
```

---

### Task 6: Update Webhook Processors — Guru

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/guru.processor.ts`

Integration select at line 69. Commission value is `payment.net`.

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 70 from:
```typescript
.select('id, user_id, workspace_id, is_active, webhook_secret')
```
to:
```typescript
.select('id, user_id, workspace_id, is_active, webhook_secret, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic**

Change line 189 from:
```typescript
const amount = Number(payment.total || 0);
```
to:
```typescript
const grossAmount = Number(payment.total || 0);
const amount = integration.use_commission_value && Number(payment.net || 0) > 0
  ? Number(payment.net)
  : grossAmount;
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/guru.processor.ts
git commit -m "feat(webhooks): guru processor supports use_commission_value flag"
```

---

### Task 7: Update Webhook Processors — PerfectPay

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/perfectpay.processor.ts`

Integration select at line 57. Commission value is found by filtering `payload.commission[]` array for `affiliation_type_enum_key === 'producer'`.

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 58 from:
```typescript
.select('id, user_id, workspace_id, is_active')
```
to:
```typescript
.select('id, user_id, workspace_id, is_active, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic in saleData**

Before the `saleData` object (around line 112), add:

```typescript
let finalAmount = payload.sale_amount;
if (integration.use_commission_value) {
  const producerEntry = (payload.commission || []).find(
    (c: any) => c.affiliation_type_enum_key === 'producer',
  );
  if (producerEntry && Number(producerEntry.commission_amount) > 0) {
    finalAmount = Number(producerEntry.commission_amount);
    this.logger.log(`[PerfectPay] Using commission value: ${finalAmount}`);
  }
}
```

Then change `amount: payload.sale_amount` to `amount: finalAmount` in the saleData object on line 116.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/perfectpay.processor.ts
git commit -m "feat(webhooks): perfectpay processor supports use_commission_value flag"
```

---

### Task 8: Update Webhook Processors — TicTo

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/ticto.processor.ts`

Integration select at line 54. Commission value is `producer.amount` (in centavos, divide by 100).

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 55 from:
```typescript
.select('id, user_id, workspace_id, is_active')
```
to:
```typescript
.select('id, user_id, workspace_id, is_active, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic**

Change line 91 from:
```typescript
const amount = (order.paid_amount || item.amount || 0) / 100;
```
to:
```typescript
const grossAmount = (order.paid_amount || item.amount || 0) / 100;
const amount = integration.use_commission_value && Number(producer.amount || 0) > 0
  ? Number(producer.amount) / 100
  : grossAmount;
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/ticto.processor.ts
git commit -m "feat(webhooks): ticto processor supports use_commission_value flag"
```

---

### Task 9: Update Webhook Processors — PayT

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/payt.processor.ts`

Integration select at line 88. Commission value is found by filtering `payload.commission[]` for `type === 'producer'`, field `amount` in centavos.

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 89 from:
```typescript
.select('id, user_id, workspace_id, is_active')
```
to:
```typescript
.select('id, user_id, workspace_id, is_active, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic**

After line 141 (`const amount = amountInCents / 100;`), replace with:

```typescript
const grossAmount = amountInCents / 100;
let amount = grossAmount;
if (integration.use_commission_value) {
  const producerEntry = (payload.commission || []).find(
    (c: any) => c.type === 'producer',
  );
  if (producerEntry && Number(producerEntry.amount) > 0) {
    amount = Number(producerEntry.amount) / 100;
    this.logger.log(`[PayT] Using commission value: ${amount}`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/payt.processor.ts
git commit -m "feat(webhooks): payt processor supports use_commission_value flag"
```

---

### Task 10: Update Webhook Processors — Cakto

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/cakto.processor.ts`

Integration select at line 57. Commission value is found by filtering `data.commissions[]` for `type === 'producer'`, field `totalAmount`.

- [ ] **Step 1: Add `use_commission_value` to integration select**

Change line 58 from:
```typescript
.select('id, user_id, workspace_id, is_active')
```
to:
```typescript
.select('id, user_id, workspace_id, is_active, use_commission_value')
```

- [ ] **Step 2: Apply commission value logic**

After the amount calculation (lines 97-100), replace with:

```typescript
const grossAmount =
  typeof data.amount === 'number'
    ? data.amount
    : parseFloat(data.amount) || 0;
let amount = grossAmount;
if (integration.use_commission_value) {
  const producerEntry = (data.commissions || []).find(
    (c: any) => c.type === 'producer',
  );
  if (producerEntry && Number(producerEntry.totalAmount) > 0) {
    amount = Number(producerEntry.totalAmount);
    this.logger.log(`[Cakto] Using commission value: ${amount}`);
  }
}
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/cakto.processor.ts
git commit -m "feat(webhooks): cakto processor supports use_commission_value flag"
```

---

### Task 11: Update Webhook Processors — Balaclava, Hubla, GGCheckout

These 3 platforms don't have documented commission field mappings. Add `use_commission_value` to their integration selects for consistency, but don't extract commission values (fallback to gross).

**Files:**
- Modify: `packages/backend/src/modules/webhooks/processors/balaclava.processor.ts`
- Modify: `packages/backend/src/modules/webhooks/processors/hubla.processor.ts`
- Modify: `packages/backend/src/modules/webhooks/processors/ggcheckout.processor.ts`

- [ ] **Step 1: Add `use_commission_value` to all three integration selects**

**balaclava.processor.ts** line 79: change `.select('id, user_id, workspace_id, is_active')` to `.select('id, user_id, workspace_id, is_active, use_commission_value')`

**hubla.processor.ts** line 59: change `.select('id, user_id, workspace_id, is_active')` to `.select('id, user_id, workspace_id, is_active, use_commission_value')`

**ggcheckout.processor.ts** line 63: change `.select('id, user_id, workspace_id, is_active')` to `.select('id, user_id, workspace_id, is_active, use_commission_value')`

- [ ] **Step 2: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/balaclava.processor.ts packages/backend/src/modules/webhooks/processors/hubla.processor.ts packages/backend/src/modules/webhooks/processors/ggcheckout.processor.ts
git commit -m "feat(webhooks): add use_commission_value to balaclava, hubla, ggcheckout selects"
```

---

### Task 12: Frontend — Update Types and Hook

**Files:**
- Modify: `packages/frontend/src/types/checkout.ts`
- Modify: `packages/frontend/src/hooks/useCheckoutIntegrations.ts`

- [ ] **Step 1: Add field to CheckoutIntegration interface**

In `checkout.ts`, add to the `CheckoutIntegration` interface after `is_active`:

```typescript
use_commission_value: boolean;
```

- [ ] **Step 2: Update saveIntegration to accept and pass the flag**

In `useCheckoutIntegrations.ts`, change the `saveIntegration` signature from:

```typescript
const saveIntegration = async (platform: CheckoutPlatform, token: string): Promise<boolean> => {
```
to:
```typescript
const saveIntegration = async (platform: CheckoutPlatform, token: string, useCommissionValue?: boolean): Promise<boolean> => {
```

And in the `api.post` call body (line 81-85), add the field:

```typescript
await api.post('/integrations/checkout', {
  platform,
  webhook_url: webhookUrl,
  webhook_secret: token.trim(),
  workspace_id: activeWorkspaceId || undefined,
  use_commission_value: useCommissionValue ?? false,
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/types/checkout.ts packages/frontend/src/hooks/useCheckoutIntegrations.ts
git commit -m "feat(frontend): add use_commission_value to types and hook"
```

---

### Task 13: Frontend — Update CheckoutConfigModal with Radio Group

**Files:**
- Modify: `packages/frontend/src/components/integrations/CheckoutConfigModal.tsx`

- [ ] **Step 1: Add state and update props**

Add `useCommissionValue` state and update the `onSave` prop type:

Change `onSave` in the interface from:
```typescript
onSave: (token: string) => Promise<boolean>;
```
to:
```typescript
onSave: (token: string, useCommissionValue: boolean) => Promise<boolean>;
```

Add state after `const [token, setToken] = useState('');`:
```typescript
const [useCommissionValue, setUseCommissionValue] = useState(false);
```

Update the `useEffect` (line 51-54) to also reset the commission flag:
```typescript
useEffect(() => {
  if (open) {
    setToken(integration?.webhook_secret || '');
    setUseCommissionValue(integration?.use_commission_value ?? false);
  }
}, [open, integration?.webhook_secret, integration?.use_commission_value]);
```

Update `handleSave` to pass the flag:
```typescript
const handleSave = async () => {
  const success = await onSave(token, useCommissionValue);
  if (success) {
    onOpenChange(false);
  }
};
```

- [ ] **Step 2: Add radio group UI after the Active Toggle section**

After the Active Toggle section (after line 154 `</div>`), add the radio group. Insert before the Instructions section:

```tsx
{/* Value Type Selection */}
<div className="space-y-3">
  <Label>Valor a registrar</Label>
  <div className="space-y-2">
    <label className="flex items-center gap-3 rounded-lg border border-white/5 p-3 cursor-pointer hover:bg-white/[0.02] transition-colors">
      <input
        type="radio"
        name="valueType"
        checked={!useCommissionValue}
        onChange={() => setUseCommissionValue(false)}
        className="accent-primary"
      />
      <div>
        <p className="text-sm font-medium">Valor da venda</p>
        <p className="text-xs text-muted-foreground">Registra o valor bruto da venda (padrão)</p>
      </div>
    </label>
    <label className="flex items-center gap-3 rounded-lg border border-white/5 p-3 cursor-pointer hover:bg-white/[0.02] transition-colors">
      <input
        type="radio"
        name="valueType"
        checked={useCommissionValue}
        onChange={() => setUseCommissionValue(true)}
        className="accent-primary"
      />
      <div>
        <p className="text-sm font-medium">Valor da comissão</p>
        <p className="text-xs text-muted-foreground">Registra o valor líquido que você recebe após taxas da plataforma</p>
      </div>
    </label>
  </div>
</div>
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/integrations/CheckoutConfigModal.tsx
git commit -m "feat(frontend): add value type radio group to checkout config modal"
```

---

### Task 14: Frontend — Update CheckoutIntegrationsSection to pass new onSave signature

**Files:**
- Modify: `packages/frontend/src/components/integrations/CheckoutIntegrationsSection.tsx`

- [ ] **Step 1: Update the onSave callback**

Find where `onSave` is passed to `CheckoutConfigModal`. Update the callback to pass the `useCommissionValue` parameter through to `saveIntegration`:

Change from:
```typescript
onSave={(token) => saveIntegration(selectedPlatform, token)}
```
to:
```typescript
onSave={(token, useCommissionValue) => saveIntegration(selectedPlatform, token, useCommissionValue)}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/integrations/CheckoutIntegrationsSection.tsx
git commit -m "feat(frontend): pass useCommissionValue through to saveIntegration"
```

---

### Task 15: Update Documentation

**Files:**
- Modify: `SQL_DATABASE.md`
- Modify: `docs/features/` (relevant integration docs)

- [ ] **Step 1: Update SQL_DATABASE.md**

Add `use_commission_value BOOLEAN NOT NULL DEFAULT false` to the `checkout_integrations` table documentation.

- [ ] **Step 2: Commit**

```bash
git add SQL_DATABASE.md
git commit -m "docs: add use_commission_value to SQL_DATABASE.md"
```
