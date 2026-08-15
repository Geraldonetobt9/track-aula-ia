# Detalhe do Usuario (Admin User Detail)

> **Modulo:** `packages/backend/src/modules/admin/admin.service.ts` | **Pagina:** `src/pages/admin/AdminUserDetail.tsx`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

Tela de **suporte** para um usuario especifico. Foco em diagnostico de integracoes, plano e regras de automacao — **nao** em performance de tráfego (campanhas/conjuntos/anúncios sairam dessa tela; quem precisa disso usa "Acessar Dashboard" e impersona o usuario).

A tela e otimizada para responder rapido: "Esse usuario tem o checkout configurado? Qual o token? O Facebook esta valido? Quais contas de anúncio? Que plano paga? Tem regra de automacao? Rodou?"

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Tabela de usuarios admin (`/admin/users`) | Clicar em uma linha |
| Tabela de usuarios recentes no dashboard admin | Clicar no nome |

### 2.2 Estrutura da pagina

1. **Header**: avatar, nome, email, badges (role + plano), "desde MMM yyyy", "ultimo login ha X". Botoes: `Acessar Dashboard` (impersona), `Editar`, `Tornar/Remover Admin`, `Excluir`.
2. **Saude da conta** (4 cards):
   - Vendas aprovadas (count)
   - Faturamento total (SUM amount, vendas approved + nao bloqueadas por limite)
   - Conexoes Facebook (count + quantas validas)
   - Checkouts (ativos / total configurados)
3. **Plano & Assinatura**: badge do plano atual + status no Stripe (active / trialing / past_due / canceled / paused), periodo atual (start → end), avisos de cancelamento agendado e troca de plano agendada, IDs do Stripe.
4. **Facebook Ads**:
   - Resumo de sync (status, intervalo, ultima sync, mensagem de erro).
   - Tabela com **uma linha por conta de anuncio** (`facebook_connections`): ad_account_id, account_name, usuario FB, status no FB (mapeado: 1=Ativa, 2=Desativada, etc), token valido?, conta ativa internamente?, ultima validacao, expiracao do token.
5. **Checkouts configurados**: cards (1 por integracao). Mostra plataforma, nome, status, ultimo webhook, flag de comissao. **Tokens mascarados por padrao** (`••••••••abc1`); botao **Conferir** revela `webhook_url`, `webhook_secret` e `api_token` em texto puro via endpoint dedicado.
6. **Regras de Automacao**: tabela com nome, workspace, ativa, alvo (campaign/adset/ad + status), acao, periodo de avaliacao, frequencia, contagem de condicoes, ultima execucao (✅/❌, ha X tempo, acao tomada, erro se houver).

**Removido** desta tela: campanhas, conjuntos, anuncios, ROI, ROAS, total_spend, graficos, vendas recentes, sync_logs, abas. Para esses dados o admin impersona o usuario.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar detalhe | role admin |
| Editar dados | role admin |
| Excluir | role admin (e nao pode ser a propria conta) |
| Conferir credenciais de checkout | role admin |
| Impersonar | role admin |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Busca por user_id | RPC `admin_user_detail(p_user_id)` em `profiles` | Retorna jsonb completo. Se profile null: `NotFoundException` "User not found" |
| RN-02 | Role do usuario | `LEFT JOIN user_roles` no RPC | Default `user` (`COALESCE(ur.role::text, 'user')`) |
| RN-03 | Ultimo login | `LEFT JOIN auth.users` (RPC e SECURITY DEFINER) | `last_sign_in_at` direto, sem chamada extra à Admin API |
| RN-04 | Faturamento (saude) | `SUM(amount)` em `sales` aprovadas e nao bloqueadas | Calculado em SQL (corrige cap de 1000 linhas do PostgREST) |
| RN-05 | Contas de anuncio | `jsonb_agg` de `facebook_connections WHERE user_id` | 1 linha por conta — usuario pode ter N |
| RN-06 | Status FB consolidado (header) | `bool_or(is_valid)` sobre as conexoes | true se alguma valida |
| RN-07 | Sync summary | `sync_schedules WHERE sync_type='facebook_ads' ORDER BY last_sync_at DESC LIMIT 1` | Resumo do ultimo sync de Facebook Ads |
| RN-08 | Checkouts so configurados | `checkout_integrations WHERE user_id` | Sem padding de plataformas hardcoded |
| RN-09 | Tokens mascarados | `mask_secret(s)` no RPC | `••••••••` + `right(s, 4)` se length > 4; bullets puros se ≤ 4; null se vazio |
| RN-10 | Conferir credencial | `GET /admin/users/:id/checkout-integrations/:iid/credentials` | Retorna webhook_url, webhook_secret, api_token em texto puro. Validacao dupla: id da integracao **+** user_id |
| RN-11 | Subscription Stripe | `LEFT JOIN subscriptions s LEFT JOIN plan_rules spr ON spr.id = s.scheduled_plan_id` | null se usuario nao tem subscription |
| RN-12 | Cancelamento agendado | `subscription.cancel_at_period_end = true` | Aviso destrutivo na UI com data do `current_period_end` |
| RN-13 | Plano agendado | `subscription.scheduled_plan IS NOT NULL` | Mostra "Próximo plano: X em DD/MM/YYYY" |
| RN-14 | Regras + ultima execucao | `automation_rules` JOIN `workspaces` filtrado por `user_id`, com LATERAL para `automation_rule_executions ORDER BY executed_at DESC LIMIT 1` | Cada regra carrega `last_execution` (null se nunca rodou) |
| RN-15 | Ordem das regras | `ORDER BY is_active DESC, last_executed_at DESC NULLS LAST, created_at DESC` | Ativas e que rodaram aparecem primeiro |

---

## 4. Modelo de Dados

### 4.1 Tabelas Consultadas (todas via RPC `admin_user_detail`)

| Tabela | Dados Extraidos |
|---|---|
| `profiles` | name, email, avatar_url, cpf, subscription_start/end, created_at |
| `plan_rules` (via `profiles.plan_id` e via `subscriptions.scheduled_plan_id`) | nome do plano atual e agendado |
| `user_roles` | role |
| `auth.users` | last_sign_in_at |
| `subscriptions` | status, periodo, cancel_at_period_end, IDs do Stripe, scheduled_plan_id, scheduled_changes_at |
| `sales` (aggregate) | sales_count + total_revenue (approved + nao bloqueado) |
| `facebook_connections` | linha por conta de anuncio |
| `sync_schedules` | resumo do facebook_ads sync |
| `checkout_integrations` | linha por integracao + tokens mascarados |
| `workspaces` | nome (para mostrar adjacente as regras) |
| `automation_rules` | regras dos workspaces do usuario |
| `automation_rule_conditions` | count por regra |
| `automation_rule_executions` | ultima execucao por regra (LATERAL) |

### 4.2 Endpoint separado de credenciais

| Tabela | Acesso |
|---|---|
| `checkout_integrations` | SELECT direto via service: filtro duplo `id = :iid AND user_id = :userId` |

### 4.3 Mascaramento

`public.mask_secret(text)` retorna:
- `NULL` se input null/vazio
- `'••••' + right(s, length(s))` (so bullets) se `length(s) ≤ 4`
- `'••••••••' + right(s, 4)` caso contrario

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/admin/users/:userId` | JWT + Admin | RPC `admin_user_detail` |
| GET | `/api/admin/users/:userId/checkout-integrations/:integrationId/credentials` | JWT + Admin | Retorna tokens em texto puro |
| PATCH | `/api/admin/users/:userId` | JWT + Admin | Atualiza nome/plano/role/cpf/subscription |
| DELETE | `/api/admin/users/:userId` | JWT + Admin | Exclui (CASCADE) |
| POST | `/api/admin/users/:userId/force-sync` | JWT + Admin | Agenda sync |

### 5.2 Logica do Service

**AdminService.getUserDetail(userId)**

```ts
async getUserDetail(userId: string) {
  const { data, error } = await this.supabase.getClient()
    .rpc('admin_user_detail', { p_user_id: userId });
  if (error) throw new BadRequestException(`[admin_user_detail] ${error.message}`);
  if (!data?.profile) throw new NotFoundException('User not found');
  return data;
}
```

Migracao: `supabase/migrations/20260502130000_admin_user_detail_rpc.sql`. Funcao `STABLE SECURITY DEFINER`, EXECUTE so para `service_role`.

**AdminService.getCheckoutCredentials(userId, integrationId)**

```ts
SELECT webhook_url, webhook_secret, api_token
FROM checkout_integrations
WHERE id = :integrationId AND user_id = :userId
```

Lança `NotFoundException` se a integracao nao pertencer ao usuario (proteção contra IDOR).

**Retorno do GET /admin/users/:id (resumo):**

```typescript
{
  profile: {
    user_id, name, email, avatar_url, cpf,
    subscription_start, subscription_end, created_at,
    last_sign_in_at, role, plan
  },
  subscription: {                       // ou null
    status, current_period_start, current_period_end,
    cancel_at_period_end, stripe_customer_id, stripe_subscription_id,
    scheduled_plan, scheduled_changes_at
  },
  health: { sales_count, total_revenue },
  facebook: {
    connections_count,
    connections: [{ id, ad_account_id, account_name, account_status,
                    is_valid, is_active, facebook_user_id, facebook_user_name,
                    last_validated_at, token_expires_at, created_at }],
    sync: { is_active, interval_minutes, last_sync_at,
            last_sync_status, last_sync_error } | null
  },
  checkouts: [{ id, platform, name, is_active, use_commission_value,
                last_webhook_at, created_at, webhook_url,
                webhook_secret_masked, api_token_masked,
                has_webhook_secret, has_api_token }],
  automation_rules: [{ id, workspace_id, workspace_name, name, is_active,
                       target_entity, target_status, action_type,
                       evaluation_period, frequency_minutes, conditions_count,
                       last_executed_at, last_execution }]
}
```

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| AdminUserDetail | `src/pages/admin/AdminUserDetail.tsx` | Orquestra a tela; sem tabs |
| HealthCard | inline | 4 cards de saude |
| SubscriptionCard | inline | Card de plano + Stripe |
| FacebookSection | inline | Sync + tabela de contas |
| CheckoutsSection / CheckoutCard | inline | Cards com Conferir |
| AutomationRulesSection | inline | Tabela de regras + ultima execucao |
| EditUserModal / DeleteUserDialog | reuso | Adaptador monta `AdminUser` parcial a partir de `detail.profile` |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useAdminUserDetail` | `src/hooks/useAdminUserDetail.ts` | `{ user, loading, error, refetch }` (`AdminUserDetail`) |
| `useCheckoutCredentials` | `src/hooks/useCheckoutCredentials.ts` | TanStack Query com `enabled: false` + `refetch()` manual |
| `useAdminUsers` | `src/hooks/useAdminUsers.ts` | Reuso para `updateUser`, `deleteUser` |
| `useImpersonation` | `src/contexts/ImpersonationContext` | `startImpersonation(user_id, name)` |

### 6.3 Comportamento do botao "Conferir"

- Toggle: clique 1 chama `useCheckoutCredentials.refetch()` → mostra valores reais; clique 2 volta ao mascarado.
- `staleTime: 0`, `gcTime: 30s`. Recarregar a pagina volta tudo a mascarado.
- Botao so aparece se a integracao tem `has_webhook_secret` ou `has_api_token`.
- Falha mostra mensagem inline; nao quebra a tela.

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| AdminUsers | Navegacao | Acessado pela listagem |
| ImpersonationContext | Acao | `Acessar Dashboard` |
| useAdminUsers | Acoes | Update / delete via mutations existentes |
| Stripe (subscriptions) | Leitura | Status, IDs e periodo |
| automation_rules + executions | Leitura | Diagnostico de regras |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Usuario nao encontrado | RPC retorna `{ profile: null }` → service lança `NotFoundException` "User not found" |
| Sem subscription Stripe | Card mostra "Sem subscription Stripe" |
| Sem conta Facebook | Tabela exibe "Nenhuma conta de anúncios conectada" |
| Sem checkout configurado | Bloco mostra "Nenhuma integração de checkout configurada" |
| Sem regras | Bloco mostra "Nenhuma regra criada" |
| Token nunca cadastrado | Linha mostra "não cadastrado" e o botão Conferir só aparece se há ao menos uma credencial |
| Falha ao conferir | Mensagem inline; mascaras permanecem |
| account_status do FB desconhecido | Fallback `Status N` |

---

## 9. Checklist de Testes

- [ ] Header: badges de role/plano + ultimo login formatado
- [ ] Cards de saude com 0 vendas, 0 conexões, 0 checkouts
- [ ] Subscription Stripe nos estados: active, trialing, past_due, canceled, paused
- [ ] cancel_at_period_end = true → aviso destrutivo
- [ ] scheduled_plan presente → linha de "Próximo plano"
- [ ] Usuario com 0, 1 e ≥2 contas Facebook
- [ ] account_status mapeado (1 = Ativa, 2 = Desativada, outros = Status N)
- [ ] Checkouts: tokens mascarados por padrao
- [ ] Botao Conferir busca credenciais e revela em texto puro
- [ ] Toggle volta para mascarado sem segundo network call
- [ ] Falha no GET de credentials mostra mensagem inline
- [ ] Regras: ordenacao (ativas primeiro, depois por last_executed_at)
- [ ] Ultima execucao: status correto, mensagem de erro quando aplicavel
- [ ] Tela 404 para userId inexistente
- [ ] Acoes Editar/Excluir/Toggle Admin/Acessar Dashboard ainda funcionam

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Auditoria de "Conferir" | Nao ha log de quais credenciais foram reveladas e por qual admin. Util para conformidade |
| Q02 | Edicao de email | Email continua read-only no `EditUserModal` |
| Q03 | Historico de mudancas | Nao registramos quem editou plano/role e quando |
| Q04 | Refresh manual de subscription | Quando o Stripe fica fora de sync, nao ha botao para forcar reconciliacao a partir desta tela |
