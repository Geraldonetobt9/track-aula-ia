# Banco de dados

Fonte única de verdade do schema. Qualquer mudança nas migrations tem que ser refletida aqui.

## O que mudou em relação ao dashboard antigo

| Antes | Agora |
|---|---|
| `workspaces` + `profiles` + `user_roles` | `app_users` (lista de quem pode entrar) |
| `plan_rules`, `subscriptions`, `usage_overage`, `stripe_webhook_events` | removidas — não há mais cobrança |
| `welcome_emails_sent` | removida |
| `facebook_connections` (token repetido em cada conta) | `meta_credentials` (um token) + `ad_accounts` |
| `daily_ad_spend` | `ad_insights_daily` |
| métricas duplicadas em `campaigns`/`ad_sets`/`ads` | só em `ad_insights_daily` |
| segredos misturados com dados normais | `checkout_secrets` e `meta_credentials` isolados |
| `sync_schedules` (uma por workspace) | `sync_state` (uma linha) |
| `workspace_id` + `user_id` em toda tabela | nenhuma das duas |

**25 tabelas → 20**, e sem nenhuma coluna de multi-tenancy.

## Tabelas

### Identidade e configuração

| Tabela | Linhas | Papel |
|---|---|---|
| `app_users` | uma por pessoa | Quem tem acesso. `is_active = false` corta o acesso sem apagar a conta. |
| `app_settings` | exatamente 1 | Imposto sobre gasto de ads, fuso, moeda. |

### Meta Ads

| Tabela | Papel |
|---|---|
| `meta_credentials` | O access token colado pelo cliente, cifrado. **Sem policy de RLS.** |
| `ad_accounts` | Contas descobertas via `/me/adaccounts`. `is_active` marca quais sincronizar. |
| `campaigns` → `ad_sets` → `ads` | Hierarquia. Só estrutura, sem números. |
| `ad_insights_daily` | Todos os números do Meta, um registro por dia por anúncio. |

`cpc`, `cpm` e `ctr` não são armazenados: derivam de `spend`, `clicks` e `impressions`. Guardá-los criava divergência quando um lado era re-sincronizado e o outro não.

### Vendas

| Tabela | Papel |
|---|---|
| `checkout_integrations` | As 16 plataformas. Dados não sensíveis. |
| `checkout_secrets` | `webhook_secret` e `api_token`. **Sem policy de RLS.** |
| `sales` | As vendas, já atribuídas a campanha/conjunto/anúncio. |
| `webhook_queue` | O webhook responde 200 na hora e processa depois. **Sem policy de RLS.** |

### Financeiro, automação e sincronização

| Tabela | Papel |
|---|---|
| `company_costs` | Custos recorrentes, percentuais ou fixos. |
| `financial_entries` | Lançamentos manuais por mês (`expense`, `revenue`, `tax`). |
| `automation_rules` + `_conditions` + `_executions` | Regras que pausam/ajustam campanhas. |
| `sync_state` + `sync_logs` | Agendamento e histórico da sincronização. |
| `processing_jobs` | Trabalho assíncrono com barra de progresso. |

## Segurança

Três camadas, e cada uma sozinha já barra o vazamento:

**1. Sem cadastro público.** Não existe página de registro, e o signup por e-mail fica desligado no painel do Supabase. A única forma de criar uma conta é o admin usar Authentication → Add user. O trigger `register_new_user()` então registra a pessoa em `app_users` automaticamente.

Se algum dia o signup for reaberto, é uma linha só a mudar: inserir com `is_active = false` e liberar cada um à mão.

**2. RLS em todas as 20 tabelas.** O usuário logado tem **somente leitura**, e só passa se `is_allowed_user()` for verdadeiro. Nenhuma tabela tem policy de escrita: qualquer `INSERT`/`UPDATE`/`DELETE` vindo do navegador é rejeitado. Toda escrita passa pelo backend, que usa a `service_role` depois de validar o token.

**3. Segredos fora de alcance.** `meta_credentials`, `checkout_secrets` e `webhook_queue` têm RLS ligado e **nenhuma policy**. Sem policy, ninguém lê — nem a chave anon, nem o usuário logado. Só a `service_role`, que roda apenas no servidor. Os grants de `anon` e `authenticated` também foram revogados por cima disso.

O token do Meta e os tokens de API dos checkouts ainda são cifrados com AES-256-GCM antes de entrar no banco (chave em `ENCRYPTION_KEY`), então um dump do banco também não os entrega.

As funções de agregação (`dashboard_metrics`, `sales_summary`, ...) são concedidas **apenas à `service_role`**. Não recebem mais `p_user_id`: todos os usuários enxergam os mesmos dados, não há de quem separar.

## Índices

O que orienta a escolha:

- **Parciais** onde a consulta sempre filtra o mesmo subconjunto: `idx_sales_approved` cobre o dashboard, que só soma vendas aprovadas.
- **BRIN** em colunas que só crescem em ordem (`sold_at`, `date`, `created_at`) — cerca de 10x menor que B-tree e suficiente para varredura por período.
- **Únicos** como alvo de upsert: `idx_insights_day_ad (date, facebook_ad_id)` faz re-sincronizar um dia sobrescrever em vez de duplicar; `idx_sales_external` dá idempotência ao webhook.

## Como aplicar

Em um projeto Supabase **novo e vazio**, rode os arquivos de `supabase/migrations/` na ordem numérica. Cada um é independente e a ordem importa (os FKs seguem a numeração).

Pelo SQL Editor do painel: abra cada arquivo, cole, execute — do `0001` ao `0010`.

Pelo CLI:

```bash
supabase link --project-ref SEU_REF
supabase db push
```

Depois de aplicar, confira em **Database → Tables** que as 20 tabelas existem e que a coluna *RLS enabled* está marcada em todas.
