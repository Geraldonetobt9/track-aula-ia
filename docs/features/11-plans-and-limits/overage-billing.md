# Overage Billing (Cobranca por Excesso de Vendas)

> **Modulo:** `packages/backend/src/modules/plan-limits/` | `packages/backend/src/modules/sales/`
> **Ultima atualizacao:** 2026-04-17
> **Status:** Aprovado

---

## 1. Proposito

A tabela `usage_overage` registra uma linha por cada venda aprovada que excedeu o `max_sales_monthly` do plano corrente em um ciclo de assinatura. Esse registro e a base para cobranca posterior via Stripe Meter Events (fase futura). O mecanismo distingue planos por comportamento: o plano Free bloqueia vendas excedentes (campo `blocked_by_limit = true` na venda), enquanto planos pagos (Pro, Starter, Enterprise) continuam processando normalmente e acumulam linhas em `usage_overage` para cobranca.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Webhook de qualquer checkout (14 plataformas) | `SalesService.upsertFromWebhook` verifica aceitacao antes de persistir |
| Settings > Plano (`PlanUsageCard`) | Exibe `overage.count` e `overage.totalCents` do ciclo corrente |

### 2.2 Fluxo de Registro de Overage

1. Webhook chega e `SalesService.upsertFromWebhook` processa a venda normalmente.
2. Apos upsert da venda com `status = 'approved'`, chama `PlanLimitsService.checkSaleAcceptance(userId)`.
3. Se a resposta e `{ overage: true, pricePerSaleCents }`, insere linha em `usage_overage` com o `sale_id`, `subscription_id`, `period_start`, `period_end` e `price_cents = pricePerSaleCents`.
4. Se a resposta e `{ blocked_by_limit: true }` (Free), atualiza a venda: `blocked_by_limit = true`. Nenhuma linha e inserida em `usage_overage`.
5. Se a resposta e `{ blocked_by_limit: false, overage: false }`, nada alem da venda normal e feito.

> O webhook sempre retorna HTTP 200 imediatamente — o processamento de overage/bloqueio ocorre de forma sincrona dentro do mesmo request, mas nao bloqueia a resposta ao checkout.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Leitura do proprio overage | Usuario autenticado (RLS SELECT policy) |
| Insercao de overage | Somente service role (backend NestJS) |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Free bloqueia; pagos registram overage | `overage_price_cents = 0` | `blocked_by_limit = true` na venda; sem linha em `usage_overage` |
| RN-02 | Plano pago acumula overage | `overage_price_cents > 0` e `sales_count >= max_sales_monthly` | Venda processada normalmente + linha em `usage_overage` |
| RN-03 | Idempotencia por `sale_id` | Webhook retentado | `UNIQUE INDEX uq_usage_overage_sale` impede duplicata silenciosamente |
| RN-04 | Preco e fixado no momento da insercao | `price_cents` copia `plan_rules.overage_price_cents` | Mudanca futura de preco do plano nao afeta registros historicos |
| RN-05 | Periodo e copiado da subscription | `period_start`, `period_end` | Registro historicamente correto mesmo apos renovacao de ciclo |

### 3.1 Precos por Plano

| Plano | Overage por venda | Comportamento |
|---|---|---|
| free | 0 ¢ | Bloqueia — nao gera linha em `usage_overage` |
| pro | 14 ¢ | Registra linha em `usage_overage` |
| starter | 12 ¢ | Registra linha em `usage_overage` |
| enterprise | 7 ¢ | Registra linha em `usage_overage` |
| unlimited | 0 ¢ | Limite ilimitado — nunca atinge overage |

---

## 4. Modelo de Dados

### 4.1 Tabela Principal: `usage_overage`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | — | Referencia `auth.users(id)`. ON DELETE CASCADE |
| subscription_id | UUID | Nao | — | Referencia `subscriptions(id)`. ON DELETE CASCADE |
| sale_id | UUID | Nao | — | Referencia `sales(id)`. ON DELETE CASCADE. UNIQUE |
| period_start | TIMESTAMPTZ | Nao | — | Inicio do ciclo onde o overage ocorreu |
| period_end | TIMESTAMPTZ | Nao | — | Fim do ciclo onde o overage ocorreu |
| price_cents | INTEGER | Nao | — | Centavos cobrados por essa venda excedente |
| reported_to_stripe_at | TIMESTAMPTZ | Sim | NULL | Populado por `StripeOverageService.sendMeterEvent` apos envio bem-sucedido |
| stripe_usage_record_id | TEXT | Sim | NULL | Igual ao `overageId` (usado como idempotency key no Stripe); populado junto com `reported_to_stripe_at` |
| created_at | TIMESTAMPTZ | Nao | now() | — |

### 4.2 Indexes

| Index | Colunas | Tipo | Motivo |
|---|---|---|---|
| `uq_usage_overage_sale` | `sale_id` | UNIQUE | Idempotencia — impede duplicata por reentrega de webhook |
| `idx_usage_overage_user_period` | `(user_id, period_start, period_end)` | B-tree | Query de uso por usuario e ciclo (`getOverageTotals`) |
| `idx_usage_overage_unreported` | `subscription_id WHERE reported_to_stripe_at IS NULL` | Partial B-tree | Job futuro de reporting — escaneia apenas registros pendentes |

### 4.3 Relacionamentos

```
usage_overage.user_id         -> auth.users(id)      ON DELETE CASCADE
usage_overage.subscription_id -> subscriptions(id)   ON DELETE CASCADE
usage_overage.sale_id         -> sales(id)           ON DELETE CASCADE
```

### 4.4 RLS

- `ALTER TABLE usage_overage ENABLE ROW LEVEL SECURITY`
- Policy `"Users can read own overage"` TO authenticated USING `(SELECT auth.uid()) = user_id`.

---

## 5. API / Backend

### 5.1 Endpoints

O overage nao tem endpoint proprio. E exposto via:

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/plan-limits/usage` | JWT | Campo `overage: { count, totalCents }` do ciclo corrente |

### 5.2 Logica do Service

**`PlanLimitsService.checkSaleAcceptance(userId)`** retorna um dos tres `SaleDecision`:

```ts
// Dentro do limite — processa normal
{ allowed: true; blocked_by_limit: false; overage: false; subscriptionId; periodStart; periodEnd }

// Plano pago acima do limite — registra overage
{ allowed: true; blocked_by_limit: false; overage: true; pricePerSaleCents: number; subscriptionId; periodStart; periodEnd }

// Free acima do limite — bloqueia a venda
{ allowed: true; blocked_by_limit: true; overage: false; subscriptionId; periodStart; periodEnd }
```

**`SalesService.upsertFromWebhook`** (simplificado):

```
1. Upsert da venda na tabela sales
2. decision = await checkSaleAcceptance(userId)
3. if decision.blocked_by_limit: UPDATE sales SET blocked_by_limit=true WHERE id=...
4. if decision.overage:
     INSERT INTO usage_overage ...
     stripeOverage.sendMeterEvent({ overageId }).catch(logger)  // fire-and-forget
```

### Reporting para Stripe Meter Events

Quando `SalesService.upsertFromWebhook` insere em `usage_overage`, dispara fire-and-forget:

```typescript
this.stripeOverage
  .sendMeterEvent({ overageId })
  .catch((err) => this.logger.warn(...));
```

`StripeOverageService.sendMeterEvent`:
1. Busca o overage row com contexto do user (`stripe_customer_id`) e plano (`stripe_meter_event_name`).
2. Chama `stripe.billing.meterEvents.create` com `identifier=overageId` (idempotente via Stripe).
3. Atualiza `usage_overage.reported_to_stripe_at` e `stripe_usage_record_id`.

### Reconciliation

`StripeOverageReconciliationCron` roda a cada 6h, busca overages com `reported_to_stripe_at IS NULL` e `created_at < now() - 1h`, retenta. Alerta Discord via `DiscordLoggerService.logApiError` se mais de 100 pendentes.

**`PlanLimitsService.getOverageTotals(userId, period)`** — agrupa linhas de `usage_overage` por periodo e retorna `{ count, totalCents }` para o `UsageSnapshot`.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Arquivo | Como usa overage |
|---|---|
| `src/components/PlanUsageCard.tsx` | Exibe "X vendas excedentes — R$ Y,YY acumulados" usando `usage.overage` |

### 6.2 Hooks

| Hook | Dado de Overage |
|---|---|
| `usePlanUsage` | `usage.overage.{ count, totalCents }` |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| `PlanLimitsService` | Service | Determina se a venda e overage via `checkSaleAcceptance` |
| `SalesService` | Service | Insere linha em `usage_overage` quando `decision.overage = true` |
| `subscriptions` | Tabela | Fornece `subscription_id`, `period_start`, `period_end` para cada linha |
| `StripeOverageService` | Service (fire-and-forget) | Chamado por `SalesService` apos cada overage inserido; envia meter event ao Stripe e marca `reported_to_stripe_at` |
| `StripeOverageReconciliationCron` | Cron (6h) | Retenta overages com `reported_to_stripe_at IS NULL` mais antigos que 1h; alerta Discord se >100 pendentes |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Webhook retentado para mesma venda | `UNIQUE INDEX uq_usage_overage_sale` impede segundo insert; upsert de sales e idempotente |
| Venda com status nao-approved | `checkSaleAcceptance` conta apenas `status = 'approved'`; vendas reembolsadas nao afetam o contador |
| Mudanca de preco do plano durante ciclo | `price_cents` e snapshoteado no momento da insercao; historico nao muda |
| usuario downgraded de Pro para Free no meio do ciclo | `apply_plan_change` nao cancela linhas ja registradas em `usage_overage`; cobradas normalmente apos Stripe integrar |

---

## 9. Checklist de Testes

- [ ] Venda Pro apos 1.000 aprovadas no ciclo insere linha em `usage_overage` com `price_cents = 14`
- [ ] Venda Free apos 30 aprovadas marca `sales.blocked_by_limit = true` e nao insere em `usage_overage`
- [ ] Webhook retentado nao cria segunda linha em `usage_overage` para o mesmo `sale_id`
- [ ] `GET /api/plan-limits/usage` retorna `overage.count` e `overage.totalCents` corretos
- [ ] Venda dentro do limite nao gera linha em `usage_overage`
- [ ] Venda com status `refunded` nao e contada no `checkSaleAcceptance`
- [ ] `PlanUsageCard` exibe valores de overage corretamente

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Refund model | Venda approved→refunded depois de meter event reportado nao desfaz cobranca (Stripe nao suporta undo de meter event); tratado manualmente caso a caso |
| Q02 | Notificacao de overage ao usuario | Nao ha alerta em tempo real quando overage comeca a ser gerado no ciclo corrente |
| Q03 | Cancelamento de linhas em downgrade | Ao downgrader de Pro para Free, linhas historicas de overage nao sao removidas — comportamento correto (cobradas normalmente ate fim do ciclo pago), mas deve ser documentado para suporte |
| Q04 | Meter event fora da janela de 24h | Stripe ignora meter events enviados apos 24h do fim do ciclo; risco baixo dado o cron de 6h, mas nao ha recuperacao automatica para esse edge case |
