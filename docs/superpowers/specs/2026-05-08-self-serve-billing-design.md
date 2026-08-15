# Self-serve billing: cancelamento, gestão de cartão e modelo de upgrade

> **Data:** 2026-05-08
> **Módulos afetados:** `packages/backend/src/modules/stripe/`, `packages/frontend/src/components/PlanTab/`
> **Status:** Design aprovado — pronto pra plano de implementação

---

## 1. Problema

Hoje o usuário precisa sair do app pra duas operações comuns:

1. **Adicionar cartão novo** — abre popup com Billing Portal da Stripe.
2. **Cancelar assinatura** — não tem botão dedicado; vai pro Customer Portal via "Gerenciar assinatura".

Além disso, o modelo de cobrança em **upgrade de plano** é proporcional (Stripe `proration_behavior: 'create_prorations'`) — calcula diff baseada no tempo restante do ciclo. O modelo desejado é mais simples e mais intuitivo: cobrar a diferença cheia entre planos no momento do upgrade, manter a data de cobrança original, próximo ciclo já no preço novo cheio.

Referência de mercado: VTurb. No histórico de fatura deles, um usuário no Basic (R$ 97) que faz dois upgrades no mesmo ciclo paga R$ 200 (Pro − Basic) + R$ 300 (Scale − Pro) e mantém a data de renovação no dia 25.

## 2. Escopo

### Muda

1. **Cancelamento in-app** — botão dedicado no `CurrentPlanCard`, abre `AlertDialog` de confirmação, agenda cancel pro fim do ciclo (`cancel_at_period_end=true`).
2. **Adicionar cartão in-app** — modal com Stripe Elements (`PaymentElement`) atrelado a um SetupIntent. Substitui o popup do Billing Portal.
3. **Modelo de cobrança no upgrade** — passa de proration pra **diferença cheia entre planos**, cobrada na hora via invoice avulsa. Data do ciclo é preservada.

### Não muda

- Primeiro checkout (Free → primeiro plano pago) continua via `checkout.stripe.com`.
- Remover cartão e definir cartão como padrão (já são in-app).
- Reativação de assinatura cancelada (já é in-app).
- Downgrade — continua sendo "agendado pro fim do ciclo, sem cobrança/crédito".
- Overage metered (acumula no ciclo, fatura no fim).
- Customer Portal continua disponível como fallback ("Gerenciar assinatura"), mas não é mais o caminho principal pras operações listadas acima.

### Princípios

- Stripe é a fonte da verdade. Toda mudança passa por webhook pra refletir em `subscriptions`.
- Webhooks idempotentes via `stripe_webhook_events` (já existe).
- Faturas geradas pelo upgrade aparecem no "Histórico de faturas" — com PDF, número e link Stripe, igual às faturas recorrentes.
- Cartões são tokens da Stripe — nunca tocamos no PAN.

## 3. Arquitetura

### 3.1 Diagrama de UI

```
Settings → aba Plano
├── CurrentPlanCard
│   └── + botão "Cancelar assinatura" → CancelSubscriptionDialog (NOVO)
│
├── PaymentMethodsCard
│   └── botão "Adicionar cartão" → AddCardDialog (NOVO, Stripe Elements)
│
└── PlanCards
    └── PlanSwitchDialog
        ├── upgrade   → "Diferença a pagar agora: R$ X" (mudou)
        └── downgrade → "Vai virar plano Y em DD/MM" (mantém)
```

### 3.2 Endpoints backend

| Método | Rota | Status | O que faz |
|---|---|---|---|
| `POST` | `/stripe/setup-intent` | **NOVO** | Cria SetupIntent atrelado ao customer. Retorna `client_secret`. |
| `POST` | `/stripe/payment-methods/attach` | **NOVO** | Recebe `paymentMethodId` (já confirmado pelo Elements no front). Valida ownership, anexa ao customer (idempotente — `confirmSetup` já anexa) e marca como default se for o primeiro PM ou se `setAsDefault=true`. |
| `POST` | `/stripe/cancel` | **NOVO** | `cancel_at_period_end=true` na subscription. Idempotente. |
| `POST` | `/stripe/preview-change` | **ALTERADO** | Retorna `kind: 'upgrade' \| 'downgrade' \| 'same'` + `chargeNowCents` (diff cheio em upgrade, 0 em downgrade) + `nextChargeCents` + `effectiveDate`. |
| `POST` | `/stripe/checkout` (path de "trocar plano de sub existente") | **ALTERADO** | Em upgrade: invoice item de diff → invoice → finalize → pay → só então `subscriptions.update` com `proration_behavior: 'none'`. Em downgrade: `subscriptions.update` direto com `proration_behavior: 'none'`. |
| `POST` | `/stripe/payment-methods/setup-portal` | **REMOVIDO** | Substituído pelo SetupIntent + Elements. |

### 3.3 Services backend

- `StripeBillingService` ganha `createSetupIntent` e `attachPaymentMethod`. Perde `createUpdatePaymentMethodPortalSession`.
- `StripeCheckoutService.changeExistingPlan` é reescrito (seção 5).
- `StripeCheckoutService` ganha `cancelSubscription`.

### 3.4 Frontend

- Dependências novas: `@stripe/stripe-js` e `@stripe/react-stripe-js`.
- Env nova: `VITE_STRIPE_PUBLISHABLE_KEY` (chave publicável é segura no client).
- `loadStripe(...)` é lazy — só carrega quando o `AddCardDialog` abre. Bundle inicial não muda. `manualChunks` separa `stripe-js` em chunk próprio.

### 3.5 Webhooks

Sem mudanças. `customer.subscription.updated` já dispara em todos os casos (cancel, upgrade, downgrade). `payment_method.attached` continua sendo só log.

## 4. Frontend: fluxos novos

### 4.1 Adicionar cartão (`AddCardDialog`)

```
[Botão "Adicionar cartão"]
        ↓
   Abre modal
        ↓
useMutation: POST /stripe/setup-intent → { clientSecret }
        ↓
Renderiza <Elements stripe={stripePromise} options={{ clientSecret }}>
   <PaymentElement />
   <Button "Salvar cartão">
        ↓
On submit:
   stripe.confirmSetup({ elements, redirect: 'if_required' })
   ↓ se 3DS: Stripe abre challenge no iframe
   ↓ retorna { setupIntent.payment_method }
        ↓
POST /stripe/payment-methods/attach { paymentMethodId, setAsDefault }
        ↓
Invalida ['stripe', 'payment-methods'] → fecha modal → toast "Cartão adicionado"
```

- Aparência via `appearance: { theme: 'night' }` + variáveis CSS pra puxar lime/dark do tema.
- Validação acontece dentro do iframe da Stripe.
- Erros vêm do `confirmSetup` — exibe inline no modal.

### 4.2 Cancelar assinatura (`CancelSubscriptionDialog`)

Botão entra dentro do `CurrentPlanCard`, ao lado de "Gerenciar assinatura".

```
[Cancelar assinatura] (variant="outline", text-destructive)
        ↓
AlertDialog:
   Título: "Cancelar sua assinatura?"
   Descrição:
     "Sua assinatura {plano} continua ativa até {next_billing_date}.
      Depois dessa data, sua conta volta pro plano Grátis automaticamente.
      Você pode reativar a qualquer momento antes do encerramento."
   [Voltar] [Sim, cancelar]
        ↓
POST /stripe/cancel
        ↓
Invalida ['plan-usage'] → toast "Cancelamento agendado para DD/MM"
        ↓
Card re-renderiza com chip "Cancelamento agendado" + botão "Reativar" (já existe)
```

- Sem retenção/pesquisa de motivo.
- Aparece só se `isPaid && !isCanceling && plan !== 'unlimited'`.
- "Gerenciar assinatura" → Customer Portal continua como fallback.

### 4.3 Upgrade redesenhado (`PlanSwitchDialog`)

Copy nova:

```
Atual:                                    Novo:
"A troca é imediata e a diferença         "A troca é imediata. Você paga a diferença
proporcional aparece na próxima fatura."  do plano agora e mantém sua data de cobrança."

Ajuste proporcional agora     R$ 26,66    Diferença a pagar agora       R$ 110,00
─────────────────────────                ─────────────────────────
Próxima fatura · 20 mai. 2026 R$ 146,56   Próxima cobrança · 20 mai.    R$ 210,00
```

Em downgrade, copy diferente:

```
"Sua troca para o plano {plano menor} foi agendada.
 Você continua no {plano atual} até {next_billing_date} e migra automaticamente
 nessa data, sem cobrança extra."
```

DTO `PlanChangePreview` é reescrito (seção 5.1).

## 5. Backend: o coração da mudança

### 5.1 DTO de preview (alterado)

```ts
type PlanChangePreview = {
  kind: 'upgrade' | 'downgrade' | 'same';
  currentPlan: string;
  targetPlan: string;
  // upgrade: diff cheio. downgrade: 0.
  chargeNowCents: number;
  // upgrade: preço cheio do novo plano. downgrade: preço cheio do plano menor.
  nextChargeCents: number;
  // current_period_end (data de renovação atual, preservada)
  effectiveDate: string; // ISO
  currency: string;
};
```

Classificação `upgrade` / `downgrade` vem da comparação dos `unit_amount` dos `stripe_price_id_base` (lido do Stripe na hora). Não dá pra confiar em hierarquia hardcoded de slugs porque admin pode alterar preços.

### 5.2 Algoritmo do upgrade (`changeExistingPlan` reescrito)

Ordem **cobra → troca**: a sub só é atualizada se a cobrança da diff foi paga.

```
INPUT: userId, targetPlanId, stripe_subscription_id

1. Lê current_sub do Stripe (preços base + metered atuais).
2. Lê current_price_base.unit_amount e target_price_base.unit_amount.
3. diff_cents = target_unit_amount - current_unit_amount
4. SE diff_cents <= 0 → DOWNGRADE (5.3)
5. SE diff_cents > 0 → UPGRADE:
   a. Pré-condições:
      - customer tem default payment method → senão 400 ("adicione um cartão antes")
      - sub.status !== 'past_due' → senão 400 ("resolva a fatura aberta")
      - SE sub.cancel_at_period_end === true → reativa primeiro:
          stripe.subscriptions.update(sub_id, { cancel_at_period_end: false })
   b. Cria invoice item:
      stripe.invoiceItems.create({
        customer,
        amount: diff_cents,
        currency: 'brl',
        description: 'Upgrade Plano X → Plano Y',
        metadata: { kind: 'plan_upgrade_diff', user_id, from_plan, to_plan }
      })
   c. Cria invoice avulsa:
      invoice = stripe.invoices.create({
        customer,
        auto_advance: false,
        collection_method: 'charge_automatically',
        pending_invoice_items_behavior: 'include',
        metadata: { kind: 'plan_upgrade_diff', user_id, target_plan_id }
      },
      { idempotencyKey: `upgrade:${user_id}:${target_plan_id}:${sub.current_period_end}` })
   d. invoice.finalizeInvoice → invoice.pay
   e. SE pagamento falha → 402 Payment Required:
      - deleta invoice item órfão
      - subscription NÃO é tocada (usuário continua no plano antigo)
      - mensagem inclui declineCode quando disponível
   f. SE pagamento sucesso → troca itens da subscription:
      stripe.subscriptions.update(sub_id, {
        items: [base_target, metered_target],
        proration_behavior: 'none'
        // billing_cycle_anchor não é passado → preserva data atual
      })
6. webhook customer.subscription.updated → applyPlanChange (path inalterado).
```

**Por que `proration_behavior: 'none'`:** garante que a Stripe não emita ajuste algum no próximo invoice. A diff sai 100% via invoice item separada, paga na hora.

**Por que invoice avulsa em vez de PaymentIntent direto:** a fatura aparece em "Histórico de faturas" com PDF, número, link Stripe — igual ao histórico do VTurb que serviu de referência (R$ 200, R$ 300 listadas).

**Por que ordem "cobra → troca":** se cobrança falhar, sub não é tocada — mais simples e mais seguro do que "troca → cobra → reverte".

**Por que reativar `cancel_at_period_end` antes de cobrar:** usuário com cancelamento agendado clicando em upgrade quer claramente continuar — descartar o agendamento de cancel evita estado inconsistente onde ele paga diff de upgrade e ainda perde acesso na renovação.

### 5.3 Algoritmo do downgrade

Mesmo path de hoje, sem proration:

```
stripe.subscriptions.update(sub_id, {
  items: [base_target, metered_target],
  proration_behavior: 'none',
  // billing_cycle_anchor não é passado → preserva data atual
})
```

`proration_behavior: 'none'` significa que a Stripe não emite cobrança nem crédito agora; a próxima fatura sai pelo preço do plano menor na data de renovação atual.

> **Risco a validar na implementação:** Stripe troca os itens imediatamente. Se isso resultar em qualquer cobrança/crédito antes da renovação por algum efeito não documentado, plano B é usar `subscription_schedules` pra agendar a troca exatamente na data de renovação. Validar em test mode antes de mexer em copy ou em `scheduled_plan` no backend.

### 5.4 Cancelamento (`cancelSubscription`)

```
POST /stripe/cancel:
  - lê sub.stripe_subscription_id
  - rejeita 400 se plan === 'unlimited' ou sem subscription
  - SE já está cancel_at_period_end=true → 200 idempotente:
      { canceled_at: ISO, ends_at: ISO, already_scheduled: true }
  - stripe.subscriptions.update(sub_id, { cancel_at_period_end: true })
  - retorna { canceled_at: ISO, ends_at: ISO, already_scheduled: false }
    // ends_at = current_period_end
```

Webhook `customer.subscription.updated` chega com `cancel_at_period_end=true` e popula a coluna em `subscriptions`. `CurrentPlanCard` já trata esse estado hoje (chip "Cancelamento agendado" + botão Reativar).

### 5.5 Adicionar cartão

```
POST /stripe/setup-intent:
  - resolve customer (mesma lógica de checkout: profile/CPF/CNPJ)
  - SE for usuário Free sem customer Stripe ainda → 400
    "primeiro assine um plano pago" (fluxo de adicionar cartão é só pra clientes pagos)
  - stripe.setupIntents.create({
      customer,
      payment_method_types: ['card'],
      usage: 'off_session',           // pra cobranças recorrentes futuras
      metadata: { user_id }
    })
  - retorna { client_secret }

POST /stripe/payment-methods/attach { paymentMethodId, setAsDefault?: boolean }:
  - assertPaymentMethodOwnedBy(paymentMethodId, customer) [já existe]
  - SE setAsDefault === true OR for o primeiro PM do customer:
      stripe.customers.update(customer, {
        invoice_settings: { default_payment_method: paymentMethodId }
      })
  - retorna { success: true, is_default }
```

Detalhe: `confirmSetup` da Stripe Elements já anexa o PaymentMethod ao customer automaticamente. O endpoint `/attach` continua sendo necessário pra (1) marcar `setAsDefault`, (2) ter um ponto de validação server-side.

## 6. Edge cases

| Cenário | Tratamento |
|---|---|
| Upgrade com diff recusada | 402, sub não muda, toast "Cobrança de R$ X recusada — verifique seu cartão" + `declineCode` quando disponível. |
| Upgrade sem cartão default | 400 antes de tentar cobrar; frontend abre `AddCardDialog` direto. |
| Cartão recusado em `confirmSetup` (3DS, fundos) | Erro inline no modal; `/attach` não é chamado; SetupIntent permite retry. |
| Cancelamento clicado 2x | Idempotente: retorna 200 com `already_scheduled: true`. |
| User remove último cartão e tenta upgrade | Bloqueado em 5.2.a. |
| User com `past_due` tenta upgrade | Bloqueado em 5.2.a. Mensagem aponta pra fatura aberta. |
| User com `cancel_at_period_end=true` tenta upgrade | Backend reativa antes de cobrar (5.2.a). UI exibe na confirmação: "O cancelamento agendado será descartado." |
| Stripe API timeout durante `invoice.pay` | 5xx genérico; nada é alterado local; user retenta — idempotency key na invoice evita duplicação. |
| Webhook `invoice.paid` chega antes de `subscription.updated` | OK — `invoice.paid` só loga; `subscription.updated` é quem chama `applyPlanChange`. Idempotência via `stripe_webhook_events`. |
| 3DS abandonado | `confirmSetup` retorna error; modal fica aberto pra retry. |
| SetupIntent expira (24h) | Modal já fechou; user reabre → backend cria novo SetupIntent (gratuitos). |
| Race entre response do `subscriptions.update` e webhook | Já protegido — `applyPlanChange` é idempotente (mesmo plan_id é no-op). |
| User Free sem customer Stripe abre `AddCardDialog` | Bloqueado: card só aparece se `has_stripe_customer === true`. |
| Plan_rules sem `stripe_price_id_base` | 400 "Plan not available for subscription" (já é o comportamento atual). |
| Race entre `previewPlanChange` e `changeExistingPlan` (admin altera price no meio) | Backend re-lê `unit_amount` na hora de cobrar; diff exibida == diff cobrada. |
| Upgrade duplo (user clica 2x) | Idempotency key em `invoices.create`: `upgrade:${user_id}:${target_plan_id}:${current_period_end}` — Stripe deduplica. |

## 7. Testes

### 7.1 Unit (Jest, backend)

| Service / método | Casos |
|---|---|
| `StripeCheckoutService.previewPlanChange` | Classifica upgrade/downgrade/same; `chargeNowCents` correto; `effectiveDate = current_period_end`; bloqueia `past_due`; bloqueia mesmo plano. |
| `StripeCheckoutService.changeExistingPlan` (upgrade) | Ordem cobra→troca; `subscriptions.update` não é chamado se `invoices.pay` falha; invoice item órfã é deletada em falha; bloqueia sem default PM; reativa `cancel_at_period_end` antes de cobrar. |
| `StripeCheckoutService.changeExistingPlan` (downgrade) | `subscriptions.update` com `proration_behavior: 'none'`; sem invoice item. |
| `StripeCheckoutService.cancelSubscription` | Sucesso com `cancel_at_period_end=true`; idempotente; bloqueia `unlimited` e sem sub. |
| `StripeBillingService.createSetupIntent` | Cria intent com config correta; bloqueia user sem customer Stripe; retorna só `client_secret`. |
| `StripeBillingService.attachPaymentMethod` | Valida ownership; define default em primeiro PM; define default quando `setAsDefault=true`. |

Mock do Stripe SDK via factory já existente em `__tests__/`.

### 7.2 Integration (test mode da Stripe, manual)

| Cenário | Cartão | Esperado |
|---|---|---|
| Upgrade Pro → Starter | `4242 4242 4242 4242` | Invoice avulsa de R$ 60,00 paga; sub trocada; `current_period_end` preservado. |
| Upgrade com 3DS | `4000 0027 6000 3184` | Frontend completa challenge; sub troca. |
| Upgrade com cartão recusado | `4000 0000 0000 0002` | 402; sub não muda; mensagem clara. |
| Add card 3DS | `4000 0027 6000 3184` | Modal completa challenge; cartão aparece na lista. |
| Add card recusado | `4000 0000 0000 9995` | Toast inline; SetupIntent permite retry. |
| Cancel + reativar | `4242 4242 4242 4242` | Sub vira `cancel_at_period_end=true`; reativar limpa o flag. |
| Downgrade Starter → Pro | — | Sub atualizada; sem cobrança/crédito agora; próxima fatura R$ 59,90. |
| Upgrade após remover último cartão | — | 400 "adicione um cartão antes". |

Webhooks locais via `stripe listen --forward-to`.

### 7.3 Frontend (Vitest)

| Componente | Casos |
|---|---|
| `AddCardDialog` | Renderiza `<Elements>` só quando `clientSecret` chega; trata error de `confirmSetup`; chama `attach` com `setAsDefault` correto. |
| `CancelSubscriptionDialog` | Mostra data correta; chama mutation; trata erro genérico. |
| `PlanSwitchDialog` | Upgrade: "Diferença a pagar agora" + "Próxima cobrança". Downgrade: "Vai virar plano X em DD/MM" sem campo de cobrança. |

Mock do Stripe.js via stub que resolve `confirmSetup` com payment method fake.

### 7.4 Não testamos

- Iframe da Stripe Elements (responsabilidade da Stripe).
- Webhook signatures (já testado).
- Idempotência de `applyPlanChange` (já testado).

## 8. Migrations, env vars, dependências

### 8.1 Migrations

**Nenhuma.** Schema atual já tem o necessário:

- `subscriptions.stripe_subscription_id`, `cancel_at_period_end`, `stripe_customer_id` — populados.
- `plan_rules.stripe_price_id_base`, `stripe_price_id_metered` — populados.
- `stripe_webhook_events` — idempotência garantida.
- `subscriptions.scheduled_plan_id` continua sendo populada pelo webhook em downgrade.

### 8.2 Env vars

| Var | Onde | Valor |
|---|---|---|
| `VITE_STRIPE_PUBLISHABLE_KEY` | Frontend (Vercel) | `pk_live_...` em prod / `pk_test_...` em test |

`STRIPE_SECRET_KEY` e `STRIPE_WEBHOOK_SECRET` já existem.

### 8.3 Dependências novas (frontend)

```json
{
  "@stripe/stripe-js": "^4.x",
  "@stripe/react-stripe-js": "^3.x"
}
```

`loadStripe(...)` lazy. `manualChunks` separa em chunk próprio.

## 9. Documentação a atualizar

| Doc | O que muda |
|---|---|
| `docs/features/11-plans-and-limits/stripe-integration.md` | Seção 2.3 → reescrever pra "fluxos in-app + Portal como fallback". Seção 5.1 → adicionar `/setup-intent`, `/payment-methods/attach`, `/cancel`; remover `/payment-methods/setup-portal`. Seção 5.3 → atualizar responsabilidades dos services. Seção 6 → trocar "useAddPaymentMethod abre Portal" por "abre AddCardDialog". RN-06 → reescrever: "Upgrade cobra diferença cheia entre planos no momento da troca; downgrade agenda pro fim do ciclo, sem cobrança". Seção 11 → consolidar com seção 6 deste design. |
| `docs/features/11-plans-and-limits/subscriptions.md` | Atualizar fluxo de cancelamento se descrever passagem pelo Portal. |
| `SQL_DATABASE.md` | Sem alteração. |
| `WEBHOOKS.md` | Sem alteração. |

## 10. Itens de risco

1. **Comportamento do downgrade com `proration_behavior: 'none'`** — testar em test mode antes de finalizar copy. Plano B: `subscription_schedules`.
2. **Race de upgrade simultâneo** — mitigado por idempotency key em `invoices.create` derivada de `(user_id, target_plan_id, current_period_end)`.
3. **Stripe `unit_amount` muda entre preview e change** — backend re-lê do Stripe na hora de cobrar.
