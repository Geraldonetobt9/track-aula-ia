# Configuracoes (Settings)

> **Modulo:** `packages/backend/src/modules/integrations/` (company-costs), `packages/backend/src/modules/stripe/` (billing), `packages/backend/src/modules/account/` (profile, email, password, tax_id) | **Pagina:** `src/pages/Settings.tsx`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

A pagina de Configuracoes permite ao usuario gerenciar suas informacoes pessoais, visualizar detalhes do plano atual e configurar custos da empresa que serao utilizados no calculo de faturamento liquido e metricas financeiras. Ela centraliza todas as preferencias do usuario em uma unica pagina organizada por abas.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar `/settings` | Link "Configuracoes" no menu lateral do DashboardLayout |
| Menu do usuario | Acesso via icone de configuracoes no cabecalho |

### 2.2 Fluxo de UI

1. O usuario acessa `/settings` pela sidebar.
2. A pagina exibe 3 abas: **Perfil**, **Plano** e **Custos**.
3. A aba **Perfil** e selecionada por padrao.

**Aba Perfil (unificada):**

A aba "Perfil" e a unica pagina de edicao de dados da conta. A aba "Seguranca"
foi removida em maio/2026 e seu conteudo (alterar senha) foi incorporado aqui.

Cada item aparece em modo leitura. Clicar em **Editar** abre o formulario inline
do item. Apenas um item edita por vez.

Items editaveis:
- **Nome**: `PATCH /api/me/profile`
- **E-mail**: `PATCH /api/me/email` (sincroniza com Supabase Auth + Stripe)
- **Documento (CPF/CNPJ)**: `PATCH /api/me/tax-id` (sincroniza com Stripe)
- **Senha**: `PATCH /api/me/password` (sincroniza com Supabase Auth)

Fluxo especial — troca de e-mail:
1. Usuario digita novo e-mail e clica Salvar.
2. Modal de confirmacao mostra transicao `<email atual>` → `<email novo>` e avisa deslogamento.
3. Confirmar dispara `PATCH /api/me/email`. O backend atualiza Supabase Auth, profile, Stripe (best-effort) e revoga sessoes.
4. Frontend faz logout e redireciona para `/login?email_changed=1`.
5. Banner verde no login: "Seu e-mail foi alterado. Use o novo endereco."

**Aba Plano:**
1. Hero `CurrentPlanCard` + `PlanUsageCard` lado a lado (ja documentado em `11-plans-and-limits/stripe-integration.md`).
2. **`PaymentMethodsCard`** — lista os cartoes salvos no Stripe customer; cada linha mostra bandeira + final + validade + badge "Padrao". Acoes: "Definir como padrao", "Remover" (icone lixeira com confirmacao), "Adicionar cartao" (redireciona para Stripe Billing Portal `flow_data.type=payment_method_update`). So aparece se o usuario ja tem `stripe_customer_id` (`usage.subscription.has_stripe_customer === true`).
3. **`InvoicesCard`** — tabela com as 12 faturas mais recentes (data, periodo, status, valor, links "Ver" e "PDF"). So aparece se ha `stripe_customer_id`.
4. `PlanCards` (grid de 4 planos) abaixo das duas cards de billing.
5. Free sem assinatura previa nao ve cards de billing — nao ha cliente Stripe ainda.

**Aba Custos:**
1. Lista custos existentes da empresa, cada um com nome, tipo (percentual ou fixo) e valor.
2. Cada custo tem botao de remover (icone lixeira).
3. Formulario "Adicionar novo custo" com campos: Nome, Tipo (dropdown: Percentual/Valor Fixo), Valor e botao "Adicionar".
4. Custos sao gerenciados via hook `useCompanyCosts`.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar e editar configuracoes | Qualquer usuario autenticado |
| Alterar plano | Redirecionamento para fluxo de pagamento (nao implementado inline) |
| Gerenciar custos | Proprietario da conta |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Email editavel com confirmacao | Usuario tenta alterar email | Modal de confirmacao mostra transicao, avisa deslogamento, e dispara `PATCH /api/me/email` |
| RN-02 | Validacao de email | Email duplicado (unique constraint) | Erro no backend, embed vermelho no Discord, toast de erro |
| RN-03 | Status do plano | `subscription_end < now` | Badge exibe "Expirado" com cor vermelha |
| RN-04 | Plano ativo | `subscription_end >= now` ou sem data | Badge exibe "Ativo" com cor do plano |
| RN-05 | Botao upgrade | Plano `free` ou expirado | Botao "Fazer Upgrade" e exibido |
| RN-06 | Custo percentual | Tipo = percentage | Exibido como "X% do faturamento" |
| RN-07 | Custo fixo | Tipo = fixed | Exibido como "R$ X.XX fixo" |
| RN-08 | Validacao de custo | Nome ou valor vazio | `handleAddCost` retorna sem acao (validacao silenciosa) |
| RN-09 | Avatar com iniciais | Nome do usuario | Gera iniciais com ate 2 caracteres do nome (ex: "Matheus Valois" -> "MV") |
| RN-10 | Precos dos planos | Mapeamento fixo no frontend | free=Gratis, starter=R$47, pro=R$97, enterprise=R$197, unlimited=Personalizado |

---

## 4. Modelo de Dados

### 4.1 Tabelas Principais

#### `company_costs`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| name | TEXT | Nao | - | Nome do custo (ex: "Taxa Gateway") |
| type | TEXT | Nao | - | Tipo: `percentage` ou `fixed` |
| value | DECIMAL | Nao | - | Valor do custo |
| created_at | TIMESTAMPTZ | Nao | now() | Data de criacao |

### 4.2 Relacionamentos

```
company_costs.user_id -> auth.users(id) ON DELETE CASCADE
```

### 4.3 Constraints e Defaults

- `type` CHECK: deve ser `percentage` ou `fixed`
- RLS habilitado: usuarios so veem/editam seus proprios custos

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| PATCH | `/api/me/profile` | JWT | Atualiza nome do usuario |
| PATCH | `/api/me/email` | JWT | Altera e-mail (revoga sessoes, sincroniza com Auth + Stripe) |
| PATCH | `/api/me/password` | JWT | Altera senha (sincroniza com Auth) |
| PATCH | `/api/me/tax-id` | JWT | Atualiza CPF/CNPJ (sincroniza com Stripe) |
| GET | `/api/integrations/company-costs` | JWT | Lista custos da empresa do usuario |
| POST | `/api/integrations/company-costs` | JWT | Adiciona novo custo |
| DELETE | `/api/integrations/company-costs/:id` | JWT | Remove um custo |
| GET | `/api/stripe/invoices` | JWT | Lista as 12 ultimas faturas do `stripe_customer_id` do usuario (ver `stripe-integration.md`) |
| GET | `/api/stripe/payment-methods` | JWT | Lista cartoes do customer + qual e o `default_payment_method` |
| POST | `/api/stripe/payment-methods/setup-portal` | JWT | Cria Billing Portal Session com `flow_data.type=payment_method_update` para adicionar cartao |
| POST | `/api/stripe/payment-methods/:id/default` | JWT | Define `invoice_settings.default_payment_method` no customer |
| DELETE | `/api/stripe/payment-methods/:id` | JWT | Detacha o cartao do customer (Stripe `paymentMethods.detach`) |

### 5.2 Logica do Service

**PATCH /api/me/profile**
- Recebe `{ name }` no body.
- Atualiza `profiles.name` do usuario autenticado.
- Emite log Discord no canal `accountChanges` (verde se sucesso, vermelho se erro).

**PATCH /api/me/email**
- Recebe `{ email }` no body.
- Valida que email nao e duplicado em `profiles.email`.
- Atualiza `auth.users.email`, `profiles.email` e `stripe.customers.email` (best-effort).
- Revoga todas as sessoes do usuario com `auth.admin.signOut(userId, 'global')`.
- Emite log Discord no canal `accountChanges` com status de sincronizacao Stripe.

**PATCH /api/me/password**
- Recebe `{ password }` no body.
- Atualiza senha em `auth.users` via `auth.admin.updateUserById()`.
- Emite log Discord no canal `accountChanges` (sem exibir a senha).

**PATCH /api/me/tax-id**
- Recebe `{ tax_id }` no body.
- Valida CPF/CNPJ usando helper `validateTaxId()`.
- Atualiza `profiles.tax_id` e sincroniza com `stripe.customers.taxIds`.
- Emite log Discord no canal `accountChanges` com status de sincronizacao Stripe.

**GET /api/integrations/company-costs**
- Busca todos os registros de `company_costs` onde `user_id` = usuario autenticado.
- Retorna array de custos com `id`, `name`, `type`, `value`.

**POST /api/integrations/company-costs**
- Recebe `{ name, type, value }` no body.
- Insere registro em `company_costs` com `user_id` do token JWT.

**DELETE /api/integrations/company-costs/:id**
- Remove registro por `id`, validando que pertence ao usuario autenticado.

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Settings | `src/pages/Settings.tsx` | Pagina principal com 3 abas |
| Tabs/TabsList/TabsTrigger/TabsContent | `src/components/ui/tabs.tsx` | Componentes de abas (shadcn/ui) |
| Avatar/AvatarFallback | `src/components/ui/avatar.tsx` | Exibicao de avatar com iniciais |
| `ProfileCard` | `src/components/SettingsTab/ProfileCard.tsx` | Card unificado com linhas editaveis de perfil (nome, email, documento, senha) |
| `EditableRow` | `src/components/SettingsTab/EditableRow.tsx` | Componente primitivo para editar um item: modo leitura + formulario inline |
| `ConfirmEmailChangeDialog` | `src/components/SettingsTab/ConfirmEmailChangeDialog.tsx` | Dialog de confirmacao para troca de email com aviso de deslogamento |
| `PaymentMethodsCard` | `src/components/PlanTab/PaymentMethodsCard.tsx` | Lista cartoes Stripe + acoes (definir padrao, remover, adicionar) |
| `InvoicesCard` | `src/components/PlanTab/InvoicesCard.tsx` | Tabela de faturas recentes Stripe |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `usePatchProfile` | `src/hooks/useAccount.ts` | Mutacao `PATCH /api/me/profile` (invalida user cache) |
| `usePatchEmail` | `src/hooks/useAccount.ts` | Mutacao `PATCH /api/me/email` (dispara logout + redirect) |
| `usePatchPassword` | `src/hooks/useAccount.ts` | Mutacao `PATCH /api/me/password` (invalida user cache) |
| `usePatchTaxId` | `src/hooks/useAccount.ts` | Mutacao `PATCH /api/me/tax-id` (invalida user cache) |
| `useCompanyCosts` | `src/hooks/useCompanyCosts.ts` | `{ costs, loading, addCost, removeCost }` |
| `useAuth` | `src/contexts/AuthContext.tsx` | `{ user, updateUser }` |
| `useInvoices` | `src/hooks/useStripeBilling.ts` | TanStack Query: `Invoice[]` (staleTime 60s, `enabled` por `has_stripe_customer`) |
| `usePaymentMethods` | `src/hooks/useStripeBilling.ts` | TanStack Query: `{ default_payment_method_id, payment_methods }` |
| `useAddPaymentMethod` | `src/hooks/useStripeBilling.ts` | Mutacao → redireciona para Stripe Billing Portal |
| `useSetDefaultPaymentMethod` | `src/hooks/useStripeBilling.ts` | Mutacao → invalida cache `['stripe', 'payment-methods']` |
| `useDetachPaymentMethod` | `src/hooks/useStripeBilling.ts` | Mutacao → invalida cache `['stripe', 'payment-methods']` |

**useCompanyCosts:**
- Busca custos via `GET /api/integrations/company-costs` no mount e quando `supabaseUser` muda.
- `addCost(name, type, value)` faz POST e re-busca a lista.
- `removeCost(id)` faz DELETE e re-busca a lista.
- Exibe toasts de sucesso/erro para cada operacao.

### 6.3 Gerenciamento de Estado — Aba Perfil

Cada item (Nome, E-mail, Documento, Senha) usa o componente `EditableRow`:

| Estado | Tipo | Descricao |
|---|---|---|
| `isEditing` | boolean | Indica se a linha está em modo edição |
| `editingValue` | string | Valor temporario enquanto edita |
| `isSaving` | boolean | Indica submissao em andamento |
| `editError` | string \| null | Mensagem de erro de validacao (frontend) |

EditableRow gerencia estado local. Mutations (`usePatchProfile`, `usePatchEmail`, etc.) disparam via TanStack Query.

### 6.4 Gerenciamento de Estado — Aba Custos

| Estado | Tipo | Descricao |
|---|---|---|
| `newCostName` | string | Nome do novo custo |
| `newCostType` | 'percentage' ou 'fixed' | Tipo do novo custo |
| `newCostValue` | string | Valor do novo custo |
| `costs` | CompanyCost[] | Lista de custos carregada pelo hook |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| AuthContext | Contexto | Fornece dados do usuario logado e funcao `updateUser` |
| useCompanyCosts | Hook | Gerencia CRUD de custos da empresa |
| DiscordLogger | Servico Backend | Emite logs de mudancas de perfil em tempo real |
| Financial page | Consumidor | Custos configurados aqui sao usados nos calculos de faturamento liquido |
| Dashboard | Consumidor | Metricas de lucro consideram custos da empresa |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Email duplicado | Toast de erro "Este e-mail ja esta em uso"; embed vermelho no Discord |
| Nome ou valor de custo vazio | `handleAddCost` retorna silenciosamente sem acao |
| Erro ao buscar custos | `console.error` no hook; UI exibe lista vazia |
| Erro ao adicionar custo | Toast "Nao foi possivel adicionar o custo" com variant destructive |
| Erro ao remover custo | Toast "Nao foi possivel remover o custo" com variant destructive |
| Plano sem subscription_end | Data de validade nao e exibida |
| Plano desconhecido | Fallback para dados do plano `free` |
| Usuario sem nome | Avatar exibe "U" como fallback |
| CPF/CNPJ invalido | Toast de erro + destacar campo com feedback visual |
| Stripe sync falha (best-effort) | Badge `⚠️ Stripe pendente` no embed verde, sem considerar como erro |

---

## 9. Checklist de Testes

**Aba Perfil (unificada):**
- [ ] Verificar que abas sao 3: Perfil, Plano, Custos (Seguranca removida)
- [ ] Testar edicao de nome e sucesso com toast verde
- [ ] Testar edicao de email com modal de confirmacao
- [ ] Confirmar que apos troca de email frontend faz logout + redirect /login?email_changed=1
- [ ] Verificar banner verde "Seu e-mail foi alterado" no login
- [ ] Testar edicao de CPF/CNPJ com validacao
- [ ] Testar edicao de senha (nunca exibir valor em logs/toasts)
- [ ] Verificar que apenas 1 item pode estar em edicao por vez
- [ ] Testar botao Cancelar interrompe edicao
- [ ] Verificar embed verde no Discord para cada acao bem-sucedida
- [ ] Verificar embed vermelho no Discord para erros
- [ ] Confirmar que sincronizacao Stripe exibe badge ⚠️ pendente se falhar

**Aba Plano:**
- [ ] Verificar exibicao correta do plano atual e preco
- [ ] Testar badge de status: "Ativo" vs "Expirado"
- [ ] Verificar exibicao da data de validade formatada em pt-BR
- [ ] Testar botao "Fazer Upgrade" aparece para plano free e expirado

**Aba Custos:**
- [ ] Testar adicao de custo percentual
- [ ] Testar adicao de custo fixo
- [ ] Testar remocao de custo
- [ ] Verificar que lista de custos atualiza apos adicionar/remover
- [ ] Testar validacao: nao adicionar custo sem nome ou valor

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Upload de avatar | Botao "Alterar foto" existe mas nao implementa upload real. Necessario integrar com storage (Supabase Storage ou S3) |
| Q02 | Validacao de senha forte | Nao ha validacao de complexidade de senha (minimo de caracteres, caracteres especiais, etc.) |
| Q03 | Fluxo de upgrade | Botao "Fazer Upgrade" nao possui fluxo de pagamento integrado |
| Q04 | Limite de custos | Nao ha limite maximo de custos que o usuario pode adicionar |
