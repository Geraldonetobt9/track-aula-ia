# Sentinela - Checklist de QA Manual

> Roteiro para validar ponta-a-ponta todos os fluxos que dependem de planos, Stripe e signup. Use em **Stripe Test Mode** antes de qualquer deploy pra produção.

**Ultima atualizacao:** 2026-04-20

---

## Indice

1. [Pre-requisitos](#1-pre-requisitos)
2. [Comandos uteis de inspecao](#2-comandos-uteis-de-inspecao)
3. [Cenarios de signup](#3-cenarios-de-signup)
4. [Cenarios de login](#4-cenarios-de-login)
5. [Cenarios de limite do Free](#5-cenarios-de-limite-do-free)
6. [Cenarios de upgrade Free -> Pro](#6-cenarios-de-upgrade-free--pro)
7. [Cenarios de troca de plano pago](#7-cenarios-de-troca-de-plano-pago)
8. [Cenarios de downgrade](#8-cenarios-de-downgrade)
9. [Cenarios de cancelamento](#9-cenarios-de-cancelamento)
10. [Cenarios de overage (vendas extras)](#10-cenarios-de-overage-vendas-extras)
11. [Cenarios de falha de pagamento](#11-cenarios-de-falha-de-pagamento)
12. [Cenarios criticos de borda](#12-cenarios-criticos-de-borda)
13. [Cenarios administrativos](#13-cenarios-administrativos)
14. [Checklist final antes de producao](#14-checklist-final-antes-de-producao)

---

## 1. Pre-requisitos

### 1.1 Ambiente local rodando

Em 3 terminais separados:

**Terminal 1 — Backend:**
```bash
npm run dev:backend
# Deve mostrar: "Backend running on http://localhost:3001"
```

**Terminal 2 — Frontend:**
```bash
npm run dev:frontend
# Deve mostrar: "Local: http://localhost:5173"
```

**Terminal 3 — Stripe CLI forwarding webhooks:**
```bash
stripe listen --forward-to http://localhost:3001/api/stripe/webhook
# Copia o `whsec_...` que aparece e confirma que esta no .env do backend
```

### 1.2 Env vars obrigatorias (`packages/backend/.env`)

```
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
SUPABASE_URL=https://...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
SUPABASE_ANON_KEY=eyJ...
FRONTEND_URL=http://localhost:5173
```

### 1.3 Supabase migrations aplicadas

Confirme no SQL Editor que todas estas migrations foram executadas:

```sql
SELECT version FROM supabase_migrations.schema_migrations
WHERE version >= '20260417100000'
ORDER BY version;
```

Espere ver pelo menos:
- `20260417100000_plan_rules_add_overage_price`
- `20260417100001_create_subscriptions_table`
- `20260417100002_backfill_subscriptions`
- `20260417100003_create_usage_overage_table`
- `20260417100004_sales_add_blocked_by_limit`
- `20260417100005_workspaces_add_archive_columns`
- `20260417100006_rename_plan_rules_columns`
- `20260417100007_seed_plan_rules_values`
- `20260417300000_drop_plan_rules_dead_columns`
- `20260419100000_plan_rules_add_stripe_columns`
- `20260419100001_create_stripe_webhook_events`
- `20260420100000_profiles_add_cnpj_and_signup_trigger`

### 1.4 Stripe Dashboard (Test Mode)

- [ ] Produtos criados: Sentinela Pro / Starter / Enterprise (cada um com preco base + metered)
- [ ] Customer Portal configurado: subscription_update + cancel + payment_method + invoice_history ativos
- [ ] Settings -> Subscriptions -> Failed payment retries: **2 attempts, then cancel**
- [ ] Webhook endpoint registrado com os 6 eventos:
    `checkout.session.completed, customer.subscription.created, customer.subscription.updated, customer.subscription.deleted, invoice.paid, invoice.payment_failed`

### 1.5 Cartoes de teste Stripe

| Cartao | Comportamento |
|---|---|
| `4242 4242 4242 4242` | Sempre aprovado |
| `4000 0000 0000 0341` | Attach OK, cobranca recorrente falha (pra testar payment_failed) |
| `4000 0000 0000 9995` | Cartao recusado na primeira cobranca |
| `4000 0027 6000 3184` | Requer 3D Secure |
| Data qualquer futura | ex: `12/30`, CVV `123` |

### 1.6 CPFs/CNPJs validos para testes

**CPFs com checksum valido:**
- `529.982.247-25`
- `123.456.789-09`
- `111.444.777-35`
- `987.654.321-00`

**CNPJs com checksum valido:**
- `11.222.333/0001-81`
- `11.444.777/0001-61`

**Documentos invalidos (pra testar rejeicao):**
- CPF: `123.456.789-10` (checksum errado)
- CPF: `111.111.111-11` (todos iguais)
- CNPJ: `11.222.333/0001-99` (checksum errado)

---

## 2. Comandos uteis de inspecao

### 2.1 Consulta DB (Supabase SQL Editor)

```sql
-- Plano atual do usuario
SELECT p.email, pr.plan, s.stripe_customer_id, s.stripe_subscription_id,
       s.current_period_end, s.cancel_at_period_end, s.scheduled_plan_id
FROM profiles p
JOIN subscriptions s ON s.user_id = p.user_id
JOIN plan_rules pr ON pr.id = s.plan_id
WHERE p.email = 'SEU_EMAIL_DE_TESTE';

-- Uso do ciclo atual (vendas aprovadas e bloqueadas)
SELECT
  count(*) FILTER (WHERE status='approved' AND blocked_by_limit=false) AS approved,
  count(*) FILTER (WHERE status='approved' AND blocked_by_limit=true)  AS blocked,
  count(*) FILTER (WHERE status='refunded') AS refunded
FROM sales WHERE user_id = 'USER_ID_AQUI'
AND sold_at >= (SELECT current_period_start FROM subscriptions WHERE user_id='USER_ID_AQUI');

-- Overage registrado
SELECT period_start, price_cents, reported_to_stripe_at, stripe_usage_record_id, created_at
FROM usage_overage
WHERE user_id = 'USER_ID_AQUI'
ORDER BY created_at DESC;

-- Webhooks recentes processados
SELECT id, type, processed_at
FROM stripe_webhook_events
ORDER BY processed_at DESC LIMIT 20;

-- Workspaces (ativos + arquivados)
SELECT id, name, archived_at, archived_by_system
FROM workspaces
WHERE user_id = 'USER_ID_AQUI'
ORDER BY archived_at NULLS FIRST;
```

### 2.2 Consulta Stripe (via Dashboard ou CLI)

```bash
# Lista customers recentes
stripe customers list --limit 5

# Detalhes de uma subscription
stripe subscriptions retrieve sub_XXXX

# Lista meter events de um customer
stripe billing meter_events list --event_name sentinela_approved_sales_pro
```

### 2.3 Consulta uso via UI

Logado como user no frontend: `Configuracoes` -> aba `Plano` -> ver o card "Uso do plano" com barras de progresso.

### 2.4 Consulta uso via API direto

```bash
# Com access_token de um user logado
TOKEN="seu_jwt_aqui"
curl -s http://localhost:3001/api/plan-limits/usage -H "Authorization: Bearer $TOKEN" | jq
```

---

## 3. Cenarios de signup

### 3.1 Signup com CPF — happy path

**Passos:**
1. Abrir `http://localhost:5173/login`
2. Clicar na aba **"Criar conta"**
3. Preencher:
   - Nome: `Joao Silva`
   - Email: `joao.teste+cpf@example.com`
   - Tipo de documento: **CPF**
   - Documento: `529.982.247-25` (mascara aplica automaticamente)
   - Senha: `MinhaSenh@123`
   - Confirmar senha: `MinhaSenh@123`
   - Marcar checkbox de termos
4. Clicar **"Criar conta"**

**Resultado esperado:**
- Toast "Conta criada!" verde
- Redireciona para aba "Entrar" com email pre-preenchido
- No DB:
  - `auth.users` tem um novo row
  - `profiles` tem `cpf='52998224725'`, `cnpj=null`, `name='Joao Silva'`, `plan_id` apontando pra `free`
  - `subscriptions` tem 1 row com `plan='free'`, `status='active'`, `current_period_end ≈ now + 30 dias`, `stripe_customer_id=null`
  - `workspaces` tem 1 row com `name='Principal'`, `archived_at=null`
  - `user_roles` tem `role='user'`

### 3.2 Signup com CNPJ — happy path

**Passos:** igual ao 3.1 mas selecionando **CNPJ** e usando `11.222.333/0001-81`.

**Resultado esperado:**
- `profiles.cnpj='11222333000181'`, `profiles.cpf=null`.

### 3.3 Validacao: email invalido

**Passos:** preencher email `nao-eh-email`, resto OK, clicar Criar conta.

**Resultado esperado:** toast vermelho "E-mail invalido", submissao bloqueada.

### 3.4 Validacao: senha menor que 8 caracteres

**Passos:** senha `abc123`.
**Resultado esperado:** toast "Senha precisa ter no minimo 8 caracteres".

### 3.5 Validacao: senhas nao coincidem

**Passos:** senha `Senha12345`, confirmacao `Senha54321`.
**Resultado esperado:** erro inline "Senhas nao coincidem", submissao bloqueada.

### 3.6 Validacao: CPF invalido (checksum)

**Passos:** CPF `123.456.789-10`, resto OK.
**Resultado esperado:** erro inline "CPF invalido", submissao bloqueada (validado client-side antes do POST).

### 3.7 Validacao: CNPJ invalido (checksum)

**Passos:** CNPJ `11.222.333/0001-99`.
**Resultado esperado:** "CNPJ invalido", submissao bloqueada.

### 3.8 Validacao: termos nao aceitos

**Passos:** preencher tudo valido mas NAO marcar checkbox.
**Resultado esperado:** erro inline "Voce precisa aceitar os termos de uso", submissao bloqueada.

### 3.9 Duplicate email

**Passos:** criar user A com email `abc@example.com`. Tentar criar user B com mesmo email (outro CPF).
**Resultado esperado:** toast vermelho "Este email ja esta cadastrado".

### 3.10 Duplicate CPF

**Passos:** criar user A com CPF `529.982.247-25`. Tentar criar user B com email diferente mas mesmo CPF.
**Resultado esperado:** toast vermelho "Este CPF ja esta cadastrado".

### 3.11 Duplicate CNPJ

**Passos:** criar user A com CNPJ `11.222.333/0001-81`. Tentar criar user B com mesmo CNPJ.
**Resultado esperado:** toast vermelho "Este CNPJ ja esta cadastrado".

---

## 4. Cenarios de login

### 4.1 Login com user recem-criado

**Passos:** na aba "Entrar", digitar email+senha cadastrados em 3.1.
**Resultado esperado:** toast "Login realizado!", redireciona pra `/dashboard`.

### 4.2 Login com senha errada

**Passos:** email correto, senha `qualquercoisa`.
**Resultado esperado:** toast "E-mail ou senha incorretos."

### 4.3 Login com email nao cadastrado

**Passos:** `naoexiste@example.com`, qualquer senha.
**Resultado esperado:** toast "E-mail ou senha incorretos."

### 4.4 Logout

**Passos:** logado, clicar avatar -> Sair.
**Resultado esperado:** redireciona pra `/login`, sessao limpa.

---

## 5. Cenarios de limite do Free

Todos assumem usuario recem-criado em plano **Free** (30 vendas/mes, 1 workspace, 1 ad_account, 1 integracao, 0 regras, sem overage).

### 5.1 Free so permite 1 workspace

**Passos:**
1. Logado, ir pra `Configuracoes` ou selector de workspace.
2. Usuario ja tem "Principal" (criado no signup).
3. Tentar criar novo workspace: clicar "Criar workspace".

**Resultado esperado:**
- Botao "Criar workspace" deve estar **desabilitado** com tooltip informando limite.
- Se forcar via API direta: HTTP 402 com body `{ resource: 'workspace', current: 1, limit: 1, plan: 'free' }`.
- Modal global `PlanLimitModal` abre sugerindo upgrade.

### 5.2 Free bloqueia 2a integracao de checkout

**Passos:**
1. Ir em `Integracoes` e cadastrar a primeira (ex: Kiwify).
2. Tentar cadastrar uma segunda (ex: Hotmart).

**Resultado esperado:** modal de upgrade dispara, integracao nao e criada.

### 5.3 Free bloqueia 2a ad account ativa

**Passos:**
1. Conectar Facebook Ads; aparecer N ad_accounts.
2. Ativar 1 (toggle vira verde).
3. Tentar ativar uma 2a.

**Resultado esperado:** toggle desabilitado. Se forcar via API: 402.

### 5.4 Free nao permite regras ativas

**Passos:** criar uma `automation_rule` (usuario pode criar N, mas ativar nenhuma).

**Resultado esperado:** toggle "Ativar" desabilitado. Limite da Free e **0 regras ativas**.

### 5.5 Free recebe a 30a venda aprovada normalmente

**Passos:** Via webhook (ou inserindo diretamente na DB pra simular), fazer chegar 30 vendas `status='approved'` no ciclo atual.

**Resultado esperado:**
- Todas as 30 sao persistidas com `blocked_by_limit=false`.
- Dashboard mostra 30 vendas aprovadas.
- `GET /api/plan-limits/usage` -> `sales.used=30, limit=30, blocked=0`.

### 5.6 Free BLOQUEIA a 31a venda aprovada

**Passos:** com 30 vendas ja aprovadas, fazer chegar a 31a via webhook de uma plataforma (pode simular curlando o webhook).

**Resultado esperado:**
- Venda 31 **persiste** com `blocked_by_limit=true`.
- NAO aparece em metricas (dashboard mostra 30, nao 31).
- `GET /api/plan-limits/usage` -> `sales.used=30, limit=30, blocked=1`.
- Card amber no Configuracoes > Plano: "1 venda bloqueada este ciclo. Faca upgrade para recupera-la."

### 5.7 Free nao cria customer Stripe

**Passos:** sem nunca ter clicado em upgrade.

**Resultado esperado:** `subscriptions.stripe_customer_id IS NULL`. O customer so e criado no primeiro upgrade.

---

## 6. Cenarios de upgrade Free -> Pro

### 6.1 Happy path — upgrade Free para Pro via Checkout

**Passos:**
1. User Free vai em `Configuracoes` -> aba **Plano**.
2. Ver card "Plano atual: Free" + 3 cards de upgrade (Pro/Starter/Enterprise).
3. Clicar **"Fazer upgrade"** no card Pro.
4. Redireciona pra `checkout.stripe.com/...` (URL Stripe Hosted Checkout).
5. Preencher:
   - Email: pre-preenchido
   - Cartao: `4242 4242 4242 4242`
   - Validade: `12/30`, CVV: `123`
   - Nome: qualquer
6. Clicar "Assinar por R$ 59,90/mes".

**Resultado esperado:**
- Redireciona pra `http://localhost:5173/settings?tab=plan&status=success&session_id=cs_xxx`.
- Toast "Pagamento confirmado, atualizando sua assinatura..."
- Apos alguns segundos, toast "Plano atualizado!"
- UI reflete Pro: card "Plano atual: Pro R$ 59,90/mes. Proxima cobranca: DD/MM".
- No DB:
  - `subscriptions.stripe_customer_id` populado
  - `subscriptions.stripe_subscription_id` populado
  - `subscriptions.plan_id` agora = Pro
  - `subscriptions.current_period_start/end` vindos do evento Stripe
  - `profiles.plan_id` = Pro
- Terminal 3 (stripe listen) mostra eventos: `checkout.session.completed`, `customer.subscription.created`, `invoice.paid`.
- Terminal 1 (backend) mostra: `Handling customer.subscription.created (id: evt_xxx)`.
- `stripe_webhook_events` ganha rows pra esses eventos.

### 6.2 Stripe customer tem CPF registrado como br_cpf

**Verificacao (apos 6.1):** no Stripe Dashboard, abrir o customer -> ver `Tax IDs` com `br_cpf` e o CPF formatado.

### 6.3 Stripe customer CNPJ tem br_cnpj

**Passos:** criar user em 3.2 (CNPJ), fazer upgrade Pro.
**Resultado esperado:** customer Stripe com `Tax ID: br_cnpj, 11.222.333/0001-81, Brazil`.

### 6.4 Checkout cancelado pelo user

**Passos:** iniciar checkout mas clicar **voltar** no browser / fechar a aba / clicar "voltar ao site" no Stripe.
**Resultado esperado:**
- Redireciona pra `/settings?tab=plan&status=cancel`.
- Toast cinza "Checkout cancelado, nenhuma cobranca realizada."
- DB NAO muda (continua Free, `stripe_customer_id=null`).

### 6.5 Cartao recusado no checkout

**Passos:** iniciar checkout, usar `4000 0000 0000 9995` (saldo insuficiente).
**Resultado esperado:**
- Stripe mostra erro inline "Your card has insufficient funds".
- Usuario pode tentar outro cartao ou desistir.
- Se desistir: nada muda no DB.
- Se tentar com cartao bom: segue 6.1.

### 6.6 Upgrade direto pra Starter (sem passar por Pro)

**Passos:** user Free clica upgrade no card **Starter** (R$ 119,90).
**Resultado esperado:** mesmo fluxo 6.1 mas plano final = Starter (2500 vendas/mes, R$ 0,12 overage).

### 6.7 Upgrade direto pra Enterprise

**Passos:** user Free clica upgrade no card **Enterprise** (R$ 199,90).
**Resultado esperado:** plano final Enterprise (5000 vendas/mes, R$ 0,07 overage, limites infinitos em workspaces/ad_accounts/integracoes/regras).

### 6.8 Limites do plano sao liberados imediatamente apos upgrade

**Passos:** apos 6.1 (user em Pro), tentar criar 2o, 3o workspace. Tentar cadastrar 2a, 3a integracao.
**Resultado esperado:**
- Ate 3 workspaces, 3 integracoes, 3 ad_accounts ativas, 3 regras ativas — todos permitidos.
- 4o workspace bloqueado (402).

---

## 7. Cenarios de troca de plano pago

### 7.1 Upgrade Pro -> Starter (imediato com proration)

**Passos:**
1. User em Pro.
2. `Configuracoes` -> aba Plano -> clicar **"Gerenciar assinatura"**.
3. Redireciona pra Stripe Customer Portal.
4. No Portal: clicar "Atualizar plano" -> selecionar **Starter** -> confirmar.
5. Voltar pro nosso site.

**Resultado esperado:**
- Stripe cobra proration (valor proporcional ao tempo restante do ciclo).
- Webhook `customer.subscription.updated` chega.
- Backend detecta price change -> chama `applyPlanChange(userId, starterPlanId, { periodStart, periodEnd })`.
- DB: `subscriptions.plan_id` vira Starter, `current_period_*` atualiza.
- UI reflete: "Plano atual: Starter R$ 119,90".
- Limites expandem automaticamente (7 workspaces, 2500 vendas/mes, etc.).

### 7.2 Upgrade Starter -> Enterprise (mid-cycle)

**Passos:** similar ao 7.1 com Enterprise.
**Resultado esperado:** plano vira Enterprise, proration cobrada, limites ficam ilimitados.

### 7.3 Upgrade com cartao expirado no arquivo

**Passos:** cartao salvo no portal ja expirou. Tentar upgrade.
**Resultado esperado:** Stripe pede atualizacao do cartao antes de completar; user atualiza -> upgrade continua.

---

## 8. Cenarios de downgrade

### 8.1 Downgrade Pro -> Starter agendado (fim do ciclo)

**Passos:**
1. User em Pro.
2. Portal -> "Atualizar plano" -> **Starter** -> Stripe pode oferecer "efetivar agora" ou "no fim do ciclo".
3. Escolher **"no fim do ciclo"** (comportamento padrao).

**Resultado esperado:**
- Webhook `customer.subscription.updated` chega com `pending_update` ou schedule.
- Backend popula `subscriptions.scheduled_plan_id=Starter` e `scheduled_changes_at=current_period_end`.
- UI mostra aviso: "Seu plano vira Starter em DD/MM."
- Limites **continuam os de Pro** ate a virada.

### 8.2 Downgrade Pro -> Free (via cancel + recadastro no free)

Nao ha caminho direto Pro -> Free no Portal (Free nao e um produto Stripe). Usuario clica **"Cancelar assinatura"** no Portal. Ver cenarios de cancelamento (Secao 9).

### 8.3 Na virada do ciclo, downgrade ativa + auto-trim

**Passos:** user em Pro com **4 workspaces, 4 integracoes ativas, 4 ad_accounts ativas, 4 regras ativas** (maximo permitido em Pro e 3 de cada — user deve ter entrado em Pro vindo de Starter/Enterprise), downgrade agendado pra Free. Esperar virada do ciclo.

**Alternativa rapida pra testar:** cancelar no Portal e avancar tempo manualmente via Stripe Dashboard: `Subscriptions -> o sub -> Actions -> Advance to next payment cycle`.

**Resultado esperado:**
- Webhook `customer.subscription.deleted` (ou `updated` com plano novo) chega.
- `applyPlanChange(userId, freePlanId, { periodStart, periodEnd })` executa:
  - **Auto-trim:** arquiva 3 workspaces (mantem 1 — o de maior receita), desativa 3 ad_accounts/integracoes/regras (mantem 1 — o mais relevante por heuristica).
- DB:
  - `workspaces` excedentes ficam com `archived_at=now(), archived_by_system=true`.
  - `facebook_connections`, `checkout_integrations`, `automation_rules` excedentes ficam com `is_active=false`.
  - `subscriptions.plan_id=free`, `stripe_subscription_id=null`, `cancel_at_period_end=false`.
- UI `WorkspaceSwitcher`: mostra workspaces arquivados em grupo separado com cadeado.

---

## 9. Cenarios de cancelamento

### 9.1 Cancel agendado (cancel_at_period_end)

**Passos:**
1. User em Pro -> Portal -> **"Cancelar assinatura"**.
2. Stripe mostra "Cancelamento efetivado em DD/MM (fim do ciclo)".
3. Voltar pro nosso site.

**Resultado esperado:**
- Webhook `customer.subscription.updated` com `cancel_at_period_end=true`.
- Backend marca `subscriptions.cancel_at_period_end=true`.
- UI mostra card amber: "Assinatura cancelada. Vai virar Free em DD/MM."
- Botao "Reativar" aparece.
- **Limites de Pro continuam ativos** ate a virada.

### 9.2 Reativacao antes da virada

**Passos:** depois de 9.1, clicar **"Reativar"** -> Portal -> "Renovar assinatura".

**Resultado esperado:**
- Webhook `customer.subscription.updated` com `cancel_at_period_end=false`.
- Backend limpa o flag.
- UI volta ao estado normal de Pro.
- Proxima cobranca na data original.

### 9.3 Cancel efetivado (virada do ciclo)

**Passos:** apos 9.1, avancar tempo no Stripe ate passar o `current_period_end`.

**Resultado esperado:**
- Stripe dispara `customer.subscription.deleted`.
- Backend chama `applyPlanChange(userId, freePlanId)`:
  - Auto-trim dos recursos excedentes.
  - `subscriptions.plan_id=free`, `stripe_subscription_id=null`.
- User vira Free, com auto-trim conforme 8.3.

### 9.4 Cancel imediato (via Dashboard admin)

**Passos:** admin cancela a subscription diretamente no Stripe Dashboard (ou via `stripe subscriptions cancel sub_xxx`).

**Resultado esperado:** mesmo comportamento do 9.3 (subscription.deleted dispara).

---

## 10. Cenarios de overage (vendas extras)

### 10.1 Pro recebe a 1001a venda -> gera overage

**Passos:**
1. User em Pro com 1000 vendas aprovadas no ciclo atual.
2. Chegar webhook de venda #1001 de uma plataforma (ex: Kiwify).

**Resultado esperado:**
- Venda persiste com `blocked_by_limit=false` (plano pago nao bloqueia).
- **Uma linha em `usage_overage`** criada com:
  - `price_cents=14` (Pro)
  - `period_start/end` do ciclo atual
  - `sale_id` = id da venda
- Meter event **enviado pra Stripe** em tempo real:
  - Terminal 1 (backend): log `Handling ... overage ...`
  - `usage_overage.reported_to_stripe_at` fica populado
  - Stripe Dashboard -> Meters -> `sentinela_approved_sales_pro` mostra +1 event

### 10.2 Multiplas vendas extras no mesmo ciclo

**Passos:** continuar o teste 10.1 ate 1010 vendas aprovadas.
**Resultado esperado:** 10 linhas em `usage_overage`, 10 meter events recebidos pela Stripe.

### 10.3 Invoice no proximo ciclo cobra base + overage

**Passos:** apos 10.2, avancar tempo ate o fim do ciclo. Stripe gera nova invoice.

**Resultado esperado:**
- Invoice tem 2 line items:
  - Pro base: R$ 59,90
  - Metered (1000 eventos acima do limite — 10 no nosso caso): 10 × R$ 0,14 = R$ 1,40
- Total cobrado: R$ 61,30
- Webhook `invoice.paid` dispara, backend loga.

### 10.4 Starter com overage de R$ 0,12

**Passos:** repetir 10.1 em plano Starter. Venda #2501.
**Resultado esperado:** `usage_overage.price_cents=12`.

### 10.5 Enterprise com overage de R$ 0,07

**Passos:** plano Enterprise. Venda #5001.
**Resultado esperado:** `usage_overage.price_cents=7`.

### 10.6 Reconciliation cron recupera meter events falhos

**Passos:** simular falha: temporariamente desligar a internet antes de uma venda chegar (ou mockar erro). A venda cria `usage_overage` mas `reported_to_stripe_at` fica null.

**Resultado esperado:**
- A cada 6h, cron `StripeOverageReconciliationCron` roda.
- Query: `usage_overage WHERE reported_to_stripe_at IS NULL AND created_at < now()-1h`.
- Para cada row, retenta `stripeOverage.sendMeterEvent`.
- Se sucesso: `reported_to_stripe_at` preenchido.

### 10.7 Idempotencia de meter event

**Passos:** forcar dois envios do mesmo `usage_overage` (ex: cron rodando logo apos insercao + hot path).
**Resultado esperado:** Stripe retorna 400 "event already exists" no segundo; codigo catcha silenciosamente; nao cobra 2x.

### 10.8 Unlimited nao gera overage

**Passos:** admin coloca user em Unlimited (ver Secao 13). Venda acima de qualquer limite.
**Resultado esperado:** `usage_overage` nao ganha nenhuma row. Plano Unlimited tem `max_sales_monthly=-1`.

---

## 11. Cenarios de falha de pagamento

### 11.1 Cartao falha na renovacao — 1a tentativa

**Passos:**
1. User em Pro com cartao `4000 0000 0000 0341` (passa no checkout mas falha recorrente).
2. Avancar tempo no Stripe ate o fim do ciclo e renovacao.

**Resultado esperado:**
- Stripe tenta cobrar, falha.
- Webhook `invoice.payment_failed` dispara.
- Backend loga no Discord via `logApiError` com `attemptCount=1`.
- **Subscription continua ativa**, status fica `past_due`.
- User ainda tem acesso ao Pro.

### 11.2 Retry 1 (3 dias depois)

**Passos:** avancar 3 dias no Stripe.
**Resultado esperado:**
- Stripe tenta cobrar de novo, falha.
- Webhook `invoice.payment_failed` com `attemptCount=2`.
- Backend loga.
- Subscription continua ativa.

### 11.3 Retry 2 falha -> subscription cancelada

**Passos:** avancar +7 dias (total ~10 dias desde 11.1).
**Resultado esperado:**
- Stripe tenta cobrar, falha (attempt 3).
- Webhook `invoice.payment_failed` com `attemptCount=3`.
- Stripe cancela a subscription (config: 2 retries then cancel).
- Webhook `customer.subscription.deleted` dispara.
- Backend chama `applyPlanChange(userId, freePlanId)`:
  - Auto-trim dos recursos excedentes.
  - `subscriptions.stripe_subscription_id=null`.
- User vira Free.

### 11.4 User atualiza cartao entre retries -> cobranca bem-sucedida

**Passos:** apos 11.1, user vai no Portal e atualiza o cartao pra `4242 4242 4242 4242`.
**Resultado esperado:**
- Stripe tenta cobrar com novo cartao na proxima retry (ou imediatamente se user clicar "Pay now").
- Sucesso: `invoice.paid` dispara.
- Subscription volta pra `active`.
- Nenhum downgrade.

---

## 12. Cenarios criticos de borda

### 12.1 **CRITICO:** Upgrade libera vendas bloqueadas (Free -> Pro)

Este e o cenario que voce pediu especificamente na Fase 1.

**Passos:**
1. User Free com 30 vendas aprovadas + 50 vendas **bloqueadas** (`blocked_by_limit=true`) acumuladas no ciclo.
2. Clicar upgrade pra Pro (fluxo 6.1).

**Resultado esperado apos o webhook processar:**
- Todas as 50 vendas com `blocked_by_limit=true` dos **ultimos 30 dias** viram `blocked_by_limit=false`.
- **NENHUMA linha de `usage_overage`** e criada retroativamente — sistema nao cobra essas 50 vendas como overage.
- Dashboard agora mostra 80 vendas aprovadas totais.
- Proxima venda aprovada do ciclo atual conta contra o limite Pro (1000) normalmente.
- So vendas **ACIMA** das 1000 vao gerar overage daqui pra frente.

### 12.2 Upgrade entre pagos nao libera nada

**Passos:** user Pro (sem blocked) -> upgrade pra Starter.
**Resultado esperado:** vendas com `blocked_by_limit=true` continuariam (mas nao ha nenhuma, porque Pro nao bloqueia). Comportamento: nada de novo, so aplica plan change.

### 12.3 Downgrade preserva historico de vendas

**Passos:** user Pro com 500 vendas -> downgrade pra Free no fim do ciclo.
**Resultado esperado:**
- `sales` rows **NAO** sao apagadas.
- `subscriptions` vira Free, novo ciclo reseta contador.
- No DB, ainda ve-se os 500 vendas passadas do ciclo Pro.
- No ciclo Free novo, contador comeca em 0. A 31a venda futura **sera bloqueada** (limite Free e 30).

### 12.4 Webhook duplicado nao reprocessa

**Passos:** reenviar o mesmo webhook duas vezes via `stripe events resend evt_xxx`.
**Resultado esperado:**
- Primeira chegada: processa normal, `stripe_webhook_events` ganha row.
- Segunda chegada: `INSERT ON CONFLICT DO NOTHING` — backend detecta duplicate, loga "Duplicate webhook event ... skipping", retorna 200.
- `applyPlanChange` nao roda 2x.

### 12.5 Concurrent signups com mesmo email

**Passos:** disparar 2 POST `/api/auth/signup` simultaneos com mesmo email.
**Resultado esperado:** um vira 201, o outro vira 409. `auth.users` tem exatamente 1 row.

### 12.6 User deleta cartao via Portal

**Passos:** user no Portal -> "Remover metodo de pagamento".
**Resultado esperado:**
- Stripe nao permite remover se e o unico metodo e ha assinatura ativa.
- Se user cancelar antes, pode remover.

### 12.7 Refund de venda ja reportada pra Stripe

**Passos:** venda aprovada #1001 gerou overage e meter event. Webhook de refund chega (`status='refunded'`).
**Resultado esperado:**
- Venda fica `status='refunded'`.
- `usage_overage` **permanece** (nao ha undo de meter event na Stripe hoje).
- User e cobrado pela venda mesmo refunded. **Conhecido e documentado — fora de escopo.**

### 12.8 Workspace arquivado e inacessivel

**Passos:** apos auto-trim em downgrade, tentar acessar workspace arquivado.
**Resultado esperado:**
- `WorkspaceSwitcher` mostra o workspace em grupo "Arquivados" com cadeado.
- Clicar no item: desabilitado, redireciona para billing.

---

## 13. Cenarios administrativos

### 13.1 Admin altera plano do user

**Passos:**
1. Logado como admin, ir em `/admin/users`.
2. Selecionar um user.
3. Mudar plano pra "unlimited".

**Resultado esperado:**
- `AdminService.updateUser` chama `SubscriptionsService.applyPlanChange`.
- `subscriptions.plan_id=unlimited`.
- **Sem fluxo Stripe** (Unlimited nao e produto Stripe — admin grant).
- Limites do usuario viram ilimitados.
- Apos novo ciclo, vendas sem limite, sem overage.

### 13.2 Admin edita CPF/CNPJ de um user

**Passos:** `/admin/users/USER_ID` -> editar CPF ou adicionar CNPJ.
**Resultado esperado:**
- Validacao no backend rejeita CPF/CNPJ invalidos.
- Uniqueness check: nao permite colocar CPF ja em uso.
- Ao salvar, `profiles.cpf` ou `profiles.cnpj` atualiza.

### 13.3 Admin cria user manualmente

**Passos:** `/admin/users/new` -> preencher nome, email, senha, CPF ou CNPJ, plano inicial.
**Resultado esperado:**
- `auth.users` row criado via admin API.
- Trigger popula profile + workspace + subscription.
- Se plano != Free: `applyPlanChange` aplica e auto-trim nao faz nada (usuario novo nao tem excedentes).

### 13.4 Admin reseta password

**Passos:** `/admin/users/USER_ID` -> "Resetar senha" -> informar nova senha.
**Resultado esperado:** user consegue logar com nova senha.

### 13.5 Admin edita regras de um plano

**Passos:** `/admin/plans` -> editar campo `max_sales_monthly` de Pro pra 1500.
**Resultado esperado:**
- `plan_rules.max_sales_monthly` atualiza.
- Usuarios em Pro agora tem 1500 vendas/mes sem overage (comeca a contar a partir deste momento; retroativamente nao mexe).

### 13.6 Admin edita preco de overage

**Passos:** `/admin/plans` -> editar `overage_price_cents` de Pro de 14 pra 20.
**Resultado esperado:**
- DB atualiza.
- **AVISO:** Stripe price nao e atualizado automaticamente (requer re-provisionar via `stripe-sync.ts`). Vendas novas usam o valor atual do DB ao inserir em `usage_overage`. Inconsistencia possivel se admin mexer aqui sem sincronizar. Recomendado: rodar `stripe:sync` apos editar.

---

## 14. Checklist final antes de producao

### 14.1 Dados de teste limpos

- [ ] Todos os test customers Stripe deletados (test mode): Dashboard -> Customers -> filtrar por email `*@example.com`, deletar.
- [ ] Test subscriptions canceladas.
- [ ] Test meter events — nao ha como deletar na Stripe, mas fica em test mode isolado de live.

### 14.2 Stripe Live Mode configurado

- [ ] Rodar `STRIPE_SECRET_KEY=sk_live_... npm run stripe:sync` — cria produtos/precos/meters em live.
- [ ] Configurar Customer Portal em live mode (o script faz isso, validar).
- [ ] Dashboard live -> Settings -> Subscriptions -> retries = 2 then cancel.
- [ ] Webhook endpoint registrado em live com `whsec_live_...`.

### 14.3 Env vars em producao (Render)

- [ ] `STRIPE_SECRET_KEY=sk_live_...`
- [ ] `STRIPE_WEBHOOK_SECRET=whsec_live_...`
- [ ] `FRONTEND_URL=https://app.sentinela.com.br` (ou dominio real)
- [ ] `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` apontando pra projeto Supabase de producao.

### 14.4 Smoke test em producao (cuidado — usa cartao real!)

Apos deploy, repetir cenarios 3.1, 4.1, 6.1 em producao com:
- Cartao Stripe test `4242...` (Stripe nao cobra em test mode mesmo em live — mas VERIFICAR toggle do dashboard esta em live).
- OU: cartao real proprio com valor baixo (R$ 59,90 Pro) e cancelar imediatamente depois.

### 14.5 Monitoring habilitado

- [ ] Logs do backend visiveis (Render dashboard).
- [ ] Webhooks Stripe sendo recebidos (Stripe Dashboard -> Developers -> Webhooks -> ver tentativas).
- [ ] Nenhum 5xx em `/api/stripe/webhook`.
- [ ] Discord logs fluindo (se configurado).

### 14.6 Documentacao publica (se aplicavel)

- [ ] Pagina `/terms` e `/privacy` existem (referenciadas no signup).
- [ ] Email suporte configurado.

---

## Apendice A: Fluxograma resumido

```
Signup (Free) -> Dashboard / Configuracoes
                 |
                 +-> Upgrade (via Checkout)
                 |       |
                 |       +-> customer.subscription.created
                 |       +-> applyPlanChange -> plano novo ativo
                 |
                 +-> Gerenciar assinatura (via Portal)
                        |
                        +-> Trocar plano -> customer.subscription.updated
                        +-> Cancelar -> cancel_at_period_end=true
                        +-> Reativar -> cancel_at_period_end=false

Venda aprovada -> upsertFromWebhook
                  |
                  +-> Free > 30 -> blocked_by_limit=true
                  +-> Pago > limit -> usage_overage + meter event

Fim do ciclo:
  - Scheduled downgrade -> subscription.updated -> applyPlanChange + auto-trim
  - Payment fail (2 retries) -> subscription.deleted -> vira Free + auto-trim
  - Renova OK -> invoice.paid, proximo ciclo
```

---

## Apendice B: Como cancelar o teste e voltar ao zero

Depois de rodar os cenarios e quiser limpar tudo pra recomecar:

```bash
# Delete all test users via Supabase admin API
node -e '
const { createClient } = require("@supabase/supabase-js");
const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);
(async () => {
  const { data } = await sb.auth.admin.listUsers();
  for (const u of data.users) {
    if (u.email?.includes("teste") || u.email?.includes("example.com")) {
      await sb.auth.admin.deleteUser(u.id);
      console.log("deleted", u.email);
    }
  }
})();
'

# Delete all Stripe test customers
stripe customers list --limit 100 --live=false | jq -r '.data[] | select(.email | test("teste|example.com")) | .id' | while read c; do
  stripe customers delete "$c"
done
```

---

## Apendice C: Script automatizado

Pra rodar os cenarios 3-5, 9-10 automatizados:

```bash
cd packages/backend
set -a; source .env; set +a
npx ts-node scripts/signup-smoke-test.ts
# Roda 10 cenarios com 45 asserts contra backend + Stripe test mode
```

Pra rodar os cenarios Stripe end-to-end (setup, lifecycle, meter events):

```bash
npx ts-node scripts/stripe-scenarios.ts
# Valida 32 asserts sobre Stripe configurado
```

Pra rodar cenarios realistas com webhooks reais:

```bash
npx ts-node scripts/stripe-real-scenarios.ts
# 26 asserts com webhooks live via Stripe CLI
```

**Total automatizado:** ~100 asserts cobrindo >90% dos cenarios acima. Os cenarios **manuais obrigatorios** sao os que envolvem:
- Browser (UI signup form, Checkout redirect, Portal redirect)
- Avanco temporal (payment failure retries, ciclo de renovacao)
- Interacao com cartao real em producao
