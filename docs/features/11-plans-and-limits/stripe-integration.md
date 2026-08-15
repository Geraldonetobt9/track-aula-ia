# Integracao com Stripe

> **Modulo:** `packages/backend/src/modules/stripe/` | **Script:** `packages/backend/scripts/stripe-sync.ts`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

Integracao completa com Stripe para cobranca das assinaturas dos planos pagos (Pro, Starter, Enterprise) com overage via Meter Events e self-service via Customer Portal. Free e Unlimited nao possuem produto Stripe (Free e entrada permanente sem cartao; Unlimited e admin-grant).

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto | Descricao |
|---|---|
| Settings > aba Plano | Hero do plano atual + card compacto de uso do ciclo em layout 2 colunas (desktop), com grid de 4 cards de plano abaixo (Free/Pro/Starter/Enterprise). Card do plano atual destacado com borda lime; card popular (Starter) com badge "Mais popular". |
| Hero do plano atual (qualquer plano) | Chip "Plano atual" + nome/preco + status chip (Ativa / Cancelamento agendado / Pagamento pendente) + "Proxima cobranca" + botao de acao (Gerenciar assinatura / Reativar assinatura) |
| Card de uso do ciclo | 5 metricas (vendas, workspaces, contas de anuncio, integracoes, regras) com mini-barra + label "used/limit", alertas de blocked/overage no rodape |
| Grid de planos | Cada card: nome, tagline, preco grande, overage, features com checks, botao contextual (Fazer upgrade / Fazer downgrade / Plano atual / Alteracao agendada) |
| Webhook Stripe | `POST /api/stripe/webhook` recebe eventos da Stripe |

### 2.2 Fluxo de Checkout

1. User Free clica "Fazer upgrade {Plano}" → frontend chama `POST /api/stripe/checkout { planId }`.
2. Backend resolve/cria Stripe customer lazy (usa email, name, cpf de profiles).
3. Backend cria Checkout Session com 2 line items: preco base fixo + preco metered (overage).
4. Redirect para `checkout.stripe.com` — user paga com cartao.
5. Stripe redireciona para `/settings?tab=plan&status=success&session_id=xxx`.
6. Em paralelo, webhook `customer.subscription.created` dispara:
   - Backend popula `stripe_subscription_id`, `stripe_customer_id` em `subscriptions`.
   - Chama `SubscriptionsService.applyPlanChange(userId, planId, { periodStart, periodEnd })`.
7. `CheckoutReturnHandler` no frontend mostra toast e invalida query `plan-usage`.

### 2.3 Fluxo de mudança de plano

User pago vai em Settings → grid de planos → clica "Trocar plano":

1. Dialog (`PlanSwitchDialog`) chama `POST /api/stripe/preview-change` e exibe:
   - **Upgrade:** "Diferença a pagar agora: R$ X" + "Próxima cobrança: R$ Y em DD/MM".
   - **Downgrade:** "Vai virar plano X em DD/MM" (sem cobrança imediata).
2. Confirmação chama `POST /api/stripe/checkout` com o `planId` do alvo.
3. Backend (`changeExistingPlan`):
   - **Upgrade:** (a) calcula overage do ciclo sob o NOVO plano (`max(0, total_sales_no_ciclo − new_plan.max_sales_monthly) × new_plan.overage_price_cents`); (b) cria 2 invoice items: diff (`target.unit_amount − current.unit_amount`) + overage settle (se > 0); (c) finalize → pay; (d) marca `usage_overage.settled_at` + `settled_by_invoice_id` pras rows do ciclo (impede o cron de re-tentar meter events); (e) `subscriptions.update` com `proration_behavior: 'none'`. Falha de cobrança → 402 + rollback de AMBOS invoice items.
   - **Downgrade:** `subscriptions.update` com `proration_behavior: 'none'`.
4. Stripe dispara `customer.subscription.updated` → backend chama `applyPlanChange` (path inalterado).
5. UI reflete via `usePlanUsage` → `subscription.next_billing_date`, `cancel_at_period_end`, `scheduled_plan`.

**Cancelamento:** botão dedicado no `CurrentPlanCard` chama `POST /api/stripe/cancel` (`cancel_at_period_end=true`). Customer Portal continua disponível ("Gerenciar assinatura") como fallback.

**Adicionar/remover cartão:** UI in-app (`PaymentMethodsCard` + `AddCardDialog` com Stripe Elements). Customer Portal não é mais o caminho padrão.

### 2.4 Permissoes

| Acao | Permissao |
|---|---|
| `POST /api/stripe/checkout` | JWT (usuario autenticado) |
| `POST /api/stripe/portal` | JWT (usuario autenticado) |
| `POST /api/stripe/webhook` | Stripe signature (sem auth JWT) |

---

## 3. Regras de Negocio

| # | Regra | Resultado |
|---|---|---|
| RN-01 | Planos pagos: Pro (R$ 59,90), Starter (R$ 119,90), Enterprise (R$ 199,90) | Valores cobrados mensalmente |
| RN-02 | Overage por venda extra: Pro R$ 0,14 / Starter R$ 0,12 / Enterprise R$ 0,07 | Cobrado no fim do ciclo via meter events |
| RN-03 | So cartao de credito | Pix/Boleto fora de escopo |
| RN-04 | Free nao tem cartao | Sem Stripe customer ate primeiro upgrade |
| RN-05 | Unlimited nao esta no Stripe | Admin-grant via `applyPlanChange` direto |
| RN-06 | Upgrade cobra diferença cheia entre planos no momento da troca; downgrade agendado pro fim do ciclo, sem cobrança/crédito | Modelo simples e previsível: total no ciclo = preço do plano mais alto utilizado |
| RN-09 | No upgrade, overage do ciclo é re-avaliado sob o novo plano e cobrado como invoice item extra (Solução B). Rows de `usage_overage` ficam `settled` pra evitar cobrança dupla via meter events | Usuário que excedeu limite do plano antigo paga overage no preço/limite do novo plano. Ex: 2600 vendas em Pro (limite 1000) + upgrade pra Starter (limite 2500) = 100 vendas × R$ 0,12 = R$ 12,00 settled na invoice da diff |
| RN-07 | 2 retentativas de cobranca, depois cancela | Configurado no Stripe Dashboard |
| RN-08 | Idempotencia de webhooks | Via tabela `stripe_webhook_events` (PK = event.id) |

---

## 4. Modelo de Dados

### 4.1 Colunas novas em `plan_rules`

| Coluna | Tipo | Descricao |
|---|---|---|
| `stripe_product_id` | text | Product ID do Stripe |
| `stripe_price_id_base` | text | Price ID do preco fixo mensal |
| `stripe_price_id_metered` | text | Price ID do preco metered pro overage |
| `stripe_meter_event_name` | text | Nome do meter event a enviar |

Todas NULL para Free e Unlimited.

### 4.2 Tabela `stripe_webhook_events`

```sql
CREATE TABLE public.stripe_webhook_events (
  id text PRIMARY KEY,   -- Stripe event ID
  type text NOT NULL,
  processed_at timestamptz NOT NULL DEFAULT now(),
  data jsonb
);
```

Idempotency guard: `INSERT ... ON CONFLICT (id) DO NOTHING` garante que mesmo evento nao e processado 2x.

### 4.3 Colunas relevantes (pre-existentes)

| Tabela | Coluna | Populado por |
|---|---|---|
| `subscriptions` | `stripe_customer_id` | Checkout (lazy, no 1o upgrade) |
| `subscriptions` | `stripe_subscription_id` | `customer.subscription.created` |
| `subscriptions` | `cancel_at_period_end` | `customer.subscription.updated` |
| `subscriptions` | `scheduled_plan_id` | `customer.subscription.updated` (downgrade agendado) |
| `subscriptions` | `scheduled_changes_at` | `customer.subscription.updated` (downgrade agendado) |
| `usage_overage` | `reported_to_stripe_at` | `StripeOverageService.sendMeterEvent` |
| `usage_overage` | `stripe_usage_record_id` | `StripeOverageService.sendMeterEvent` (igual ao overageId) |

---

## 5. API / Backend

### 5.1 Endpoints

| Método | Path | Auth | Descrição |
|---|---|---|---|
| POST | `/api/stripe/checkout` | JWT | Cria Checkout Session (signup) ou troca plano de subscription existente (upgrade ou downgrade). |
| POST | `/api/stripe/portal` | JWT | Cria Portal Session (gerenciamento geral, fallback). |
| POST | `/api/stripe/reactivate` | JWT | Cancela `cancel_at_period_end` em assinatura agendada para cancelar. |
| POST | `/api/stripe/cancel` | JWT | Marca `cancel_at_period_end=true` na subscription. Idempotente. Retorna `ends_at`. |
| POST | `/api/stripe/preview-change` | JWT | Preview de troca de plano. Retorna `{ kind, chargeNowCents, nextChargeCents, effectiveDate, currency }`. |
| POST | `/api/stripe/setup-intent` | JWT | Cria SetupIntent atrelado ao customer. Retorna `client_secret` pra frontend usar com Stripe Elements. |
| POST | `/api/stripe/payment-methods/attach` | JWT | Anexa um PaymentMethod (já confirmado pelo Elements no front) ao customer e marca como default se for o primeiro PM ou se `setAsDefault=true`. |
| GET  | `/api/stripe/invoices` | JWT | Lista as 12 últimas faturas — inclui faturas avulsas de upgrade. |
| GET  | `/api/stripe/payment-methods` | JWT | Lista cartões + `default_payment_method_id`. |
| POST | `/api/stripe/payment-methods/:id/default` | JWT | Marca cartão como padrão. Valida ownership. |
| DELETE | `/api/stripe/payment-methods/:id` | JWT | Remove cartão. Valida ownership. |
| POST | `/api/stripe/webhook` | Stripe signature | Handler de webhooks. |

### 5.2 Eventos webhook tratados

| Evento | Acao |
|---|---|
| `checkout.session.completed` | Apenas log |
| `customer.subscription.created` | Popula `stripe_subscription_id` + `stripe_customer_id`; chama `applyPlanChange` com datas reais |
| `customer.subscription.updated` | Detecta plan change / `cancel_at_period_end` / reactivation / downgrade agendado |
| `customer.subscription.deleted` | Converte user pro Free + auto-trim |
| `invoice.paid` | Apenas log |
| `invoice.payment_failed` | Log no Discord com `{ userId, invoiceId, amount, attemptCount }` |

### 5.3 Services

| Service | Responsabilidade |
|---|---|
| `StripeService` | Wrapper thin sobre SDK (`getClient()`). |
| `StripeCheckoutService` | `createCheckoutSession`, `createPortalSession`, `previewPlanChange`, `reactivateSubscription`, **`cancelSubscription`**. `changeExistingPlan` cobra diff cheio em upgrade (invoice item + invoice avulsa) antes de trocar a sub; downgrade usa `proration_behavior: 'none'`. |
| `StripeBillingService` | `listInvoices`, `listPaymentMethods`, `setDefaultPaymentMethod`, `detachPaymentMethod`, **`createSetupIntent`**, **`attachPaymentMethod`**. Valida ownership de PMs antes de mutar. |
| `StripeWebhookService` | Idempotência + dispatch por event.type. |
| `StripeOverageService` | Envia meter events com idempotência via `identifier=overageId`. |
| `StripeOverageReconciliationCron` | Retry de meter events falhos a cada 6h. |
| `StripeSignatureGuard` | Valida assinatura de webhook. |

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Arquivo | Função |
|---|---|
| `src/pages/Settings.tsx` (aba Plano) | Renderiza `CheckoutReturnHandler` + grid 2-col (`CurrentPlanCard` + `PlanUsageCard`) + grid 2-col (`PaymentMethodsCard` + `InvoicesCard`) + `PlanCards`. |
| `src/components/PlanTab/CurrentPlanCard.tsx` | Hero do plano atual com botões "Gerenciar assinatura", "Cancelar assinatura" e (quando agendado) "Reativar". |
| `src/components/PlanTab/PlanCards.tsx` | Grid de planos. Botões contextuais por slug. |
| `src/components/PlanTab/PlanSwitchDialog.tsx` | Dialog de troca: em upgrade mostra "Diferença a pagar agora"; em downgrade mostra "Vai virar plano X em DD/MM". |
| `src/components/PlanTab/PaymentMethodsCard.tsx` | Lista cartões + "Adicionar cartão" abre `AddCardDialog`. |
| `src/components/PlanTab/AddCardDialog.tsx` | Modal com Stripe Elements (PaymentElement) + SetupIntent → `confirmSetup` → `attach`. |
| `src/components/PlanTab/CancelSubscriptionDialog.tsx` | AlertDialog de confirmação de cancel; chama `POST /stripe/cancel`. |
| `src/components/PlanTab/InvoicesCard.tsx` | Tabela de faturas — inclui invoices avulsas de upgrade. |
| `src/components/PlanUsageCard.tsx` | Card compacto com 5 métricas. |
| `src/components/CheckoutReturnHandler.tsx` | Lê `?status=success/cancel` na URL. |

### 6.2 Hooks

| Hook | Dado / Mutation |
|---|---|
| `usePlanUsage` | `usage.subscription.{ status, next_billing_date, cancel_at_period_end, scheduled_plan, has_stripe_customer }`. |
| `useStripeCheckout` | `POST /api/stripe/checkout` (signup) ou troca de plano. |
| `useStripePortal` | `POST /api/stripe/portal` (fallback). |
| `useStripeReactivate` | `POST /api/stripe/reactivate`. |
| `useStripeCancel` | `POST /api/stripe/cancel` + invalida `plan-usage`. |
| `useStripeSetupIntent` | `POST /api/stripe/setup-intent` → `clientSecret`. |
| `useAttachPaymentMethod` | `POST /api/stripe/payment-methods/attach` + invalida cache de PMs. |
| `useInvoices` | `GET /api/stripe/invoices`. |
| `usePaymentMethods` | `GET /api/stripe/payment-methods`. |
| `useSetDefaultPaymentMethod` | `POST /api/stripe/payment-methods/:id/default`. |
| `useDetachPaymentMethod` | `DELETE /api/stripe/payment-methods/:id`. |

### 6.3 Gerenciamento de Estado

- Cache key TanStack Query: `['plan-usage']` invalidado apos retorno do Checkout e pelo `CheckoutReturnHandler`.
- Polling com backoff (2/4/6s, max 3 tentativas) ate `has_stripe_customer = true`.

### 6.4 Cenarios de UI

| Cenario | UI |
|---|---|
| Plano Free | Card "Plano atual: Free". 3 cards Pro/Starter/Enterprise com preco + botao "Fazer upgrade" |
| Plano pago ativo | Card "Plano atual: {plan} — R$ X/mes. Proxima cobranca: {date}". Botao "Gerenciar assinatura" |
| Plano pago + `cancel_at_period_end=true` | Aviso amber: "Assinatura cancelada. Vai virar Free em {date}." Botao "Reativar" → Portal |
| Plano pago + `scheduled_plan_id` preenchido | Aviso: "Seu plano vira {scheduled} em {date}." Botao "Gerenciar" → Portal |
| Plano Unlimited | Card estatico "Plano Unlimited — gerenciado pelo suporte" |

---

## 7. Setup Script

`packages/backend/scripts/stripe-sync.ts` — idempotente. Rodar via:

```bash
STRIPE_SECRET_KEY=sk_test_... npm run stripe:sync --workspace=@sentinel/backend
```

Provisiona (por plano: Pro, Starter, Enterprise):
1. **Meter** — `sentinela_approved_sales_{slug}` (sum, default value 1).
2. **Product** — `"Sentinela {Plano}"` com `metadata.plan_slug`.
3. **Price base** — fixo mensal em BRL; nao edita existente (cria novo + arquiva se preco mudou).
4. **Price metered** — por venda excedente, vinculado ao meter.
5. **UPDATE `plan_rules`** com os 4 IDs + nome do meter event.
6. **Customer Portal configuration** — full access: update/cancel/payment/invoices (upsert).

Atualiza `plan_rules` com os Stripe IDs. Rodar em test mode e live mode separadamente.

---

## 8. Env Vars

| Var | Onde | Valor |
|---|---|---|
| `STRIPE_SECRET_KEY` | Backend (Render) | `sk_live_...` prod / `sk_test_...` outros |
| `STRIPE_WEBHOOK_SECRET` | Backend (Render) | `whsec_...` do webhook registrado |
| `FRONTEND_URL` | Backend | `https://app.sentinela.com` |
| `VITE_STRIPE_PUBLISHABLE_KEY` | Frontend (Vercel) | `pk_live_...` em prod / `pk_test_...` em test. Carregada lazy pelo `lib/stripe.ts`. |

---

## 9. Checklist Pos-Setup (manual no Stripe Dashboard)

- [ ] Settings → Subscriptions → "Manage failed payment retries": 2 attempts, then cancel.
- [ ] Developers → Webhooks → Add endpoint com URL `/api/stripe/webhook` e 6 eventos (`checkout.session.completed`, `customer.subscription.created/updated/deleted`, `invoice.paid`, `invoice.payment_failed`).
- [ ] Copy `whsec_...` → env `STRIPE_WEBHOOK_SECRET`.
- [ ] (Opcional) Personalizar branding da Checkout/Portal.

---

## 10. Pontos de Integracao

| Sistema | Tipo |
|---|---|
| `SubscriptionsService.applyPlanChange` | Chamado por webhooks `subscription.created/updated/deleted` |
| `SalesService.upsertFromWebhook` | Dispara `StripeOverageService.sendMeterEvent` fire-and-forget |
| `DiscordLoggerService.logApiError` | Logs de payment failures e reconciliation |
| Customer Portal Stripe | Self-service gerenciado pela Stripe |

---

## 11. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Webhook duplicado | `stripe_webhook_events` PK bloqueia reprocessamento |
| Meter event falha no hot path | Reconciliation cron retenta em 6h |
| Refund de venda ja reportada | Meter event permanece (Stripe nao permite undo); tratado caso a caso fora de escopo |
| Cartao recusa renovacao | 2 retries (config Stripe), depois `subscription.deleted` → Free + auto-trim |
| User cancela e reativa no mesmo ciclo | Portal + webhook `updated` com `cancel_at_period_end=false` |
| Stripe API 500 em `/checkout` | Endpoint retorna 500; frontend exibe erro; user tenta de novo |
| User com plano pago tenta `/checkout` | Backend retorna `{ redirectTo: '/api/stripe/portal' }` (upgrade via Portal) |
| Upgrade com cartão recusado | 402 + rollback do invoice item; sub não muda; toast "Cobrança recusada" com `declineCode` |
| Upgrade sem cartão default | 400 antes de cobrar; UI abre `AddCardDialog` |
| Upgrade quando `cancel_at_period_end=true` | Backend descarta o agendamento de cancel antes de cobrar a diff. Em falha de cobrança, restaura o agendamento. |
| Add card 3DS abandonado | `confirmSetup` retorna error inline; SetupIntent permite retry |
| Race entre `previewPlanChange` e `changeExistingPlan` | Backend re-lê `unit_amount` do Stripe na hora; diff exibida = diff cobrada |
| Upgrade duplo (clique 2x) | `idempotencyKey: upgrade:{user}:{plan}:{period_end}` em `invoices.create` deduplicates |

---

## 12. Testing em Test Mode

Cartoes uteis ([Stripe docs](https://docs.stripe.com/testing)):
- `4242 4242 4242 4242` — sucesso.
- `4000 0000 0000 9995` — saldo insuficiente.
- `4000 0000 0000 0341` — falha na cobranca recorrente.
- `4000 0027 6000 3184` — requer 3DS.

Stripe CLI para webhooks locais:
```bash
stripe listen --forward-to http://localhost:3001/api/stripe/webhook
```

---

## 13. Questoes Abertas

| # | Questao |
|---|---|
| Q01 | Refund model: como lidar com `approved → refunded` de venda ja reportada (credit note? invoice item negativo?) |
| Q02 | Email custom quando cartao falha (hoje Stripe manda default) |
| Q03 | Admin billing UI — hoje admin usa Stripe Dashboard direto |
| Q04 | Stripe Tax + emissao de NF-e |
| Q05 | Planos anuais/semestrais |
