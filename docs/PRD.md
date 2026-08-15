> **AVISO: Este documento esta desatualizado.** Foi criado durante a fase inicial do projeto quando a arquitetura usava Supabase Edge Functions e dois projetos Supabase separados. A arquitetura atual usa NestJS + Fastify com um unico Supabase. Consulte `docs/features/README.md` para a documentacao atualizada.

# PRD - Sentinela (Legado)

## Product Requirements Document
### Plataforma SaaS de Rastreamento Avançado de Facebook Ads

**Versão:** 3.0  
**Data:** 2026-02-18  
**Status:** Em Produção

---

## 1. Visão Geral do Produto

### 1.1 Nome do Produto
**Sentinela** (anteriormente Sentinel / AdsTracker Pro)

### 1.2 Descrição
O Sentinela é uma plataforma SaaS voltada para gestores de tráfego e infoprodutores brasileiros. Permite rastrear, analisar e otimizar campanhas de Facebook Ads cruzando métricas de anúncios com dados reais de vendas provenientes de 9 plataformas de checkout integradas via webhooks.

### 1.3 Problema Resolvido
- Dificuldade em calcular ROI real das campanhas de Facebook Ads
- Falta de integração entre dados de anúncios e vendas reais
- Métricas de conversão do Facebook não refletem vendas confirmadas
- Necessidade de análise manual cruzando múltiplas plataformas
- Dados de gasto fragmentados por dia sem consolidação temporal
- Gestores com múltiplos negócios precisam separar dados por contexto

### 1.4 Proposta de Valor
- Visão unificada de investimento em ads vs faturamento real
- Cálculo automático de ROI, ROAS e CPA com dados reais de vendas
- Dois modelos de atribuição: Last Click (vendas reais) e Meta (pixel)
- Navegação hierárquica (Campanha → Conjunto → Anúncio) com métricas em cada nível
- Sincronização automática com Facebook Ads API (manual + agendada)
- Integração com 9 checkouts brasileiros via webhook
- Globo 3D interativo de vendas por região geográfica
- Funil de conversão visual (Link Clicks → Landing Page Views → Checkouts → Vendas)
- Painel admin completo para gestão de usuários, planos e monitoramento
- Custos da empresa configuráveis (% ou fixo) para cálculo de lucro líquido
- **Múltiplas contas de anúncios** (Business Manager) por usuário
- **Áreas de trabalho (Workspaces)** para separar dados por negócio/produto
- **Impersonificação de usuários** pelo admin para suporte técnico
- **Encriptação de credenciais** sensíveis (AES) no banco de dados

---

## 2. Stack Técnica

### 2.1 Frontend
| Tecnologia | Versão | Uso |
|------------|--------|-----|
| React | 18.3.1 | Framework UI |
| TypeScript | 5.x | Tipagem estática |
| Vite | 5.x | Build tool |
| Tailwind CSS | 3.x | Estilização |
| shadcn/ui | latest | Componentes UI |
| React Router DOM | 6.30.1 | Roteamento SPA |
| TanStack Query | 5.83.0 | Cache e estado servidor |
| Recharts | 2.15.4 | Gráficos (LineChart, BarChart) |
| date-fns | 3.6.0 | Manipulação de datas |
| Lucide React | 0.462.0 | Ícones |
| topojson-client + world-atlas | 3.1.0 / 2.0.2 | Globo 3D de vendas |
| Framer Motion | — | Animações (via tailwindcss-animate) |

### 2.2 Backend (Lovable Cloud / Supabase)
| Tecnologia | Uso |
|------------|-----|
| Supabase | Backend as a Service |
| PostgreSQL | Banco de dados (dual: Lovable Cloud + Externo) |
| Supabase Auth | Autenticação (email/senha) |
| Edge Functions (Deno) | Serverless functions (22 funções) |
| Row Level Security (RLS) | Segurança de dados por usuário |

### 2.3 Integrações Externas
| Plataforma | Status | Tipo | Edge Function |
|------------|--------|------|---------------|
| Facebook Graph API v22.0 | ✅ Implementado | REST API | `fetch-meta-insights` |
| Hotmart | ✅ Implementado | Webhook | `webhook-hotmart` |
| Kiwify | ✅ Implementado | Webhook | `webhook-kiwify` |
| Kirvano | ✅ Implementado | Webhook | `webhook-kirvano` |
| Guru Digital | ✅ Implementado | Webhook | `webhook-guru` |
| Perfect Pay | ✅ Implementado | Webhook | `webhook-perfectpay` |
| Ticto | ✅ Implementado | Webhook | `webhook-ticto` |
| PayT | ✅ Implementado | Webhook | `webhook-payt` |
| Cakto | ✅ Implementado | Webhook | `webhook-cakto` |
| Balaclava | ✅ Implementado | Webhook | `webhook-balaclava` |

---

## 3. Arquitetura do Sistema

### 3.1 Diagrama de Arquitetura

```
┌─────────────────────────────────────────────────────────────────────┐
│                         FRONTEND (React + Vite)                      │
├─────────────────────────────────────────────────────────────────────┤
│  Pages              │  Components         │  Hooks                │
│  ─────────          │  ──────────          │  ─────               │
│  Login              │  DashboardLayout     │  useAuth             │
│  Register           │  Sidebar             │  useCampaigns        │
│  ForgotPassword     │  Header              │  useAdSets           │
│  ResetPassword      │  ProtectedRoute      │  useAds              │
│  Onboarding         │  ExpiredAccessModal  │  useMetaCampaigns    │
│  Dashboard          │  SyncButton          │  useMetaAdSets       │
│  Campaigns          │  DateRangeFilter     │  useMetaAds          │
│  Sales              │  CampaignsTable      │  useSales            │
│  Integrations       │  AdSetsTable         │  useFacebookSync     │
│  Settings           │  AdsTable            │  useFacebookConnection│
│  Terms / Privacy    │  TopAdsChart         │  useDashboardMetrics │
│  Admin (Dashboard,  │  ConversionFunnel    │  useSalesByRegion    │
│   Users, Plans,     │  SalesGlobe          │  useTopAds           │
│   UserDetail)       │  ProductSalesChart   │  useCampaignsFunnel  │
│                     │  SaleDetailsDrawer   │  useMetaCampaignsFunnel│
│                     │  UtmContentChart     │  useCompanyCosts     │
│                     │  CheckoutIntegrations│  useAccessControl    │
│                     │  FacebookConnectionForm│ useSyncSchedule    │
│                     │  SyncScheduleSection │  useBudgetUpdate     │
│                     │  AccountSwitcher     │  usePlanRules        │
│                     │  WorkspaceSwitcher   │  useAdminUsers       │
│                     │  WorkspaceSync       │  useAdminDashboard   │
│                     │  Admin components    │  useAdminUserDetail  │
│                     │                      │  useCheckoutIntegrations│
│                     │                      │  useWorkspaces       │
│                     │                      │  useSupabase         │
│  Contexts           │                      │  useMetaInsights     │
│  ───────            │                      │                      │
│  AuthContext        │                      │                      │
│  RefetchContext     │                      │                      │
│  ImpersonationContext│                     │                      │
│  ActiveConnectionContext│                  │                      │
│  WorkspaceContext   │                      │                      │
└─────────────────────┴──────────────────────┴──────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    EDGE FUNCTIONS (Deno / Lovable Cloud)              │
├─────────────────────────────────────────────────────────────────────┤
│  fetch-meta-insights       → Sync Facebook Ads (validate/sync/insights)│
│  auto-sync                 → Sincronização automática agendada         │
│  update-budget             → Altera orçamento de campanhas via API     │
│  update-campaign-status    → Altera status de campanhas via API        │
│  rematch-sales             → Re-atribui vendas a campanhas/ads         │
│  manage-facebook-connection→ CRUD de conexões Facebook (multi-conta)   │
│  manage-workspaces         → CRUD de áreas de trabalho                 │
│  manage-plan-rules         → CRUD de regras de planos                  │
│  admin-users               → CRUD de usuários (admin)                  │
│  admin-proxy               → Proxy para impersonificação               │
│  send-welcome-email        → Email de boas-vindas                      │
│  webhook-n8n-profiles      → Sync de perfis via N8N                    │
│  webhook-hotmart           → Recebe eventos de vendas da Hotmart       │
│  webhook-kiwify            → Recebe eventos de vendas da Kiwify        │
│  webhook-kirvano           → Recebe eventos de vendas da Kirvano       │
│  webhook-guru              → Recebe eventos de vendas do Guru Digital   │
│  webhook-perfectpay        → Recebe eventos de vendas da Perfect Pay   │
│  webhook-ticto             → Recebe eventos de vendas da Ticto         │
│  webhook-payt              → Recebe eventos de vendas da PayT          │
│  webhook-cakto             → Recebe eventos de vendas da Cakto         │
│  webhook-balaclava         → Recebe eventos de vendas da Balaclava     │
│  _shared/match-sale-to-ads.ts → Lógica de atribuição venda → anúncio  │
│  _shared/ddd-to-state.ts     → Mapeamento DDD → estado brasileiro     │
│  _shared/normalize-state.ts  → Normalização de nomes de estados       │
│  _shared/encryption.ts       → Encriptação/decriptação AES            │
│  _shared/extract-webhook-token.ts → Extração de tokens de webhooks    │
│  _shared/currency.ts         → Conversão e formatação de moedas       │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BANCOS DE DADOS (PostgreSQL)                    │
├─────────────────────────────────────────────────────────────────────┤
│  Supabase Externo (Produção)  │  Lovable Cloud                     │
│  ────────────────────────     │  ────────────                      │
│  profiles                     │  plan_rules                        │
│  user_roles                   │  company_costs                     │
│  campaigns                    │  workspaces                        │
│  ad_sets                      │  workspace_connections             │
│  ads                          │  workspace_checkout_integrations   │
│  sales                        │  welcome_emails_sent               │
│  daily_ad_spend               │                                    │
│  facebook_connections         │                                    │
│  checkout_integrations        │                                    │
│  sync_schedules               │                                    │
│  sync_logs                    │                                    │
│  processing_jobs              │                                    │
└───────────────────────────────┴────────────────────────────────────┘
```

### 3.2 Fluxo de Dados

```
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│  Facebook    │      │  Checkouts   │      │   Usuário    │
│  Graph API   │      │  (9 webhooks)│      │   (Browser)  │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                      │
       ▼                     ▼                      ▼
┌──────────────┐      ┌──────────────┐      ┌──────────────┐
│ Edge Function│      │ Edge Function│      │   React App  │
│ fetch-meta   │      │ webhook-*    │      │ (Supabase SDK│
│ auto-sync    │      │ + match-sale │      │  direto)     │
└──────┬───────┘      └──────┬───────┘      └──────┬───────┘
       │                     │                      │
       └──────────┬──────────┘                      │
                  ▼                                 │
           ┌──────────────┐                         │
           │   Supabase   │◄────────────────────────┘
           │  PostgreSQL  │
           │  (Ext + LC)  │
           └──────────────┘
```

### 3.3 Arquitetura Dual de Banco de Dados
O sistema utiliza dois bancos de dados Supabase:
- **Supabase Externo** (`src/integrations/supabase/db.ts`): Banco de produção com dados de usuários, campanhas, vendas e conexões Facebook. Autenticação centralizada aqui.
- **Lovable Cloud** (`src/integrations/supabase/client.ts`): Banco gerenciado automaticamente para tabelas de configuração (plan_rules, workspaces, company_costs).

O hook `useSupabase()` abstrai a seleção do cliente, retornando o cliente proxied quando o admin está impersonando um usuário.

---

## 4. Banco de Dados

### 4.1 Tabelas no Supabase Externo

#### 4.1.1 profiles
Informações de perfil dos usuários.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Referência ao auth.users |
| name | text | Yes | - | Nome do usuário |
| email | text | Yes | - | Email do usuário |
| cpf | text | Yes | - | CPF do usuário |
| avatar_url | text | Yes | - | URL do avatar |
| plan | text | Yes | 'starter' | Plano: free, starter, pro, enterprise, unlimited |
| active | boolean | Yes | true | Conta ativa |
| subscription_start | timestamptz | Yes | - | Início da assinatura |
| subscription_end | timestamptz | Yes | - | Fim da assinatura |
| created_at | timestamptz | No | now() | Data de criação |
| updated_at | timestamptz | No | now() | Última atualização |

**Constraint:** `profiles_plan_check` — plano deve ser: free, starter, pro, enterprise, unlimited.

#### 4.1.2 user_roles
Sistema de controle de acesso baseado em roles (RBAC).

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Referência ao auth.users |
| role | app_role | No | 'user' | Enum: admin, user |
| created_at | timestamptz | No | now() | Data de criação |

#### 4.1.3 campaigns
Campanhas sincronizadas do Facebook Ads (apenas OUTCOME_SALES).

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária interna |
| user_id | uuid | No | - | Proprietário |
| facebook_campaign_id | text | Yes | - | ID original do Facebook |
| facebook_connection_id | text | Yes | - | FK para facebook_connections |
| name | text | No | - | Nome da campanha |
| status | text | Yes | 'active' | active, paused |
| objective | text | Yes | - | Objetivo (OUTCOME_SALES) |
| spend | numeric | Yes | 0 | Gasto total (lifetime) |
| impressions | integer | Yes | 0 | Total de impressões |
| clicks | integer | Yes | 0 | Total de cliques |
| conversions | integer | Yes | 0 | Conversões reportadas pelo pixel |
| cpc | numeric | Yes | 0 | Custo por clique |
| cpm | numeric | Yes | 0 | Custo por mil impressões |
| ctr | numeric | Yes | 0 | Click-through rate |
| daily_budget | numeric | Yes | - | Orçamento diário |
| lifetime_budget | numeric | Yes | - | Orçamento total |
| date_start | date | Yes | - | Início do período |
| date_end | date | Yes | - | Fim do período |
| synced_at | timestamptz | Yes | - | Última sincronização |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

#### 4.1.4 ad_sets
Conjuntos de anúncios vinculados às campanhas.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária interna |
| campaign_id | uuid | No | - | FK para campaigns |
| user_id | uuid | No | - | Proprietário |
| facebook_adset_id | text | Yes | - | ID original do Facebook |
| name | text | No | - | Nome do conjunto |
| status | text | Yes | 'active' | active, paused |
| spend | numeric | Yes | 0 | Gasto total |
| impressions | integer | Yes | 0 | Impressões |
| clicks | integer | Yes | 0 | Cliques |
| conversions | integer | Yes | 0 | Conversões |
| cpc | numeric | Yes | 0 | CPC |
| cpm | numeric | Yes | 0 | CPM |
| ctr | numeric | Yes | 0 | CTR |
| date_start | date | Yes | - | Início |
| date_end | date | Yes | - | Fim |
| synced_at | timestamptz | Yes | - | Última sincronização |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

#### 4.1.5 ads
Anúncios individuais vinculados aos conjuntos.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária interna |
| ad_set_id | uuid | No | - | FK para ad_sets |
| user_id | uuid | No | - | Proprietário |
| facebook_ad_id | text | Yes | - | ID original do Facebook |
| name | text | No | - | Nome do anúncio |
| status | text | Yes | 'active' | active, paused |
| spend | numeric | Yes | 0 | Gasto total |
| impressions | integer | Yes | 0 | Impressões |
| clicks | integer | Yes | 0 | Cliques |
| conversions | integer | Yes | 0 | Conversões |
| cpc | numeric | Yes | 0 | CPC |
| cpm | numeric | Yes | 0 | CPM |
| ctr | numeric | Yes | 0 | CTR |
| date_start | date | Yes | - | Início |
| date_end | date | Yes | - | Fim |
| synced_at | timestamptz | Yes | - | Última sync |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

#### 4.1.6 daily_ad_spend
Gasto diário por campanha/adset/ad para cálculos com filtro de período.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| campaign_id | uuid | No | - | FK para campaigns |
| facebook_adset_id | text | Yes | null | ID do adset |
| facebook_ad_id | text | Yes | null | ID do ad |
| facebook_connection_id | text | Yes | null | ID da conexão Facebook |
| date | date | No | - | Data do gasto |
| spend | numeric | No | 0 | Gasto do dia |
| impressions | integer | Yes | 0 | Impressões do dia |
| clicks | integer | Yes | 0 | Cliques do dia |
| link_clicks | integer | Yes | 0 | Link clicks do dia |
| cpc | numeric | Yes | 0 | CPC do dia |
| cpm | numeric | Yes | 0 | CPM do dia |
| ctr | numeric | Yes | 0 | CTR do dia |

**Constraint:** Unicidade em (campaign_id, facebook_ad_id, date). Limpeza prévia por connection_id + período antes de insert para evitar colisões multi-conta.

#### 4.1.7 sales
Vendas registradas via webhooks.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| campaign_id | uuid | Yes | - | FK para campaigns |
| ad_set_id | uuid | Yes | - | FK para ad_sets |
| ad_internal_id | uuid | Yes | - | FK para ads |
| checkout_integration_id | uuid | Yes | - | Origem da venda |
| checkout_platform | text | Yes | - | Plataforma de checkout |
| amount | numeric | No | - | Valor da venda |
| product_name | text | Yes | - | Nome do produto |
| customer_name | text | Yes | - | Nome do cliente |
| customer_email | text | Yes | - | Email do cliente |
| customer_phone | text | Yes | - | Telefone |
| customer_document | text | Yes | - | Documento |
| status | text | Yes | 'approved' | approved, pending, refunded, chargeback |
| payment_method | text | Yes | - | Método de pagamento |
| currency | text | Yes | 'BRL' | Moeda |
| utm_source | text | Yes | - | Origem UTM |
| utm_medium | text | Yes | - | Meio UTM |
| utm_campaign | text | Yes | - | Campanha UTM |
| utm_content | text | Yes | - | Conteúdo UTM (ad set) |
| utm_term | text | Yes | - | Termo UTM (ad) |
| ad_id | text | Yes | - | ID do anúncio da UTM |
| external_id | text | Yes | - | ID externo (checkout) |
| state | text | Yes | - | Estado do comprador |
| sold_at | timestamptz | No | now() | Data da venda |
| created_at | timestamptz | No | now() | Criação |

#### 4.1.8 facebook_connections
Credenciais da API do Facebook Ads por usuário. **Suporta múltiplas conexões por usuário** (sem constraint de unicidade em user_id).

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| app_id | text | No | - | App ID (encriptado AES) |
| app_secret | text | No | - | App Secret (encriptado AES) |
| access_token | text | No | - | Token de acesso (encriptado AES) |
| ad_account_id | text | No | - | ID da conta (act_XXXXX) |
| is_valid | boolean | Yes | false | Credenciais válidas |
| last_validated_at | timestamptz | Yes | - | Última validação |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

#### 4.1.9 checkout_integrations
Integrações com plataformas de checkout.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| platform | text | No | - | hotmart, kiwify, kirvano, guru, perfectpay, ticto, payt, cakto, balaclava |
| webhook_secret | text | Yes | - | Secret para validar webhooks |
| is_active | boolean | Yes | true | Integração ativa |
| last_webhook_at | timestamptz | Yes | - | Último webhook recebido |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

#### 4.1.10 sync_schedules
Agendamento de sincronização automática.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| is_active | boolean | Yes | false | Agendamento ativo |
| interval_minutes | integer | No | 60 | Intervalo em minutos |
| last_sync_at | timestamptz | Yes | - | Última execução |
| last_sync_status | text | Yes | - | Status da última sync |
| last_sync_error | text | Yes | - | Erro da última sync |

#### 4.1.11 sync_logs
Log de cada execução de sincronização.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| started_at | timestamptz | No | now() | Início |
| duration_ms | integer | Yes | - | Duração em ms |
| status | text | No | - | success, error |
| campaigns_synced | integer | Yes | 0 | Campanhas sincronizadas |
| ad_sets_synced | integer | Yes | 0 | Conjuntos sincronizados |
| ads_synced | integer | Yes | 0 | Anúncios sincronizados |
| error_message | text | Yes | - | Mensagem de erro |

#### 4.1.12 processing_jobs
Controle de jobs de processamento assíncrono (sync Facebook).

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| status | text | No | - | pending, processing, completed, error |
| progress | integer | Yes | 0 | Percentual de progresso |
| result | jsonb | Yes | - | Resultado do processamento |
| error_message | text | Yes | - | Mensagem de erro |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

### 4.2 Tabelas no Lovable Cloud

#### 4.2.1 plan_rules
Regras e limites por plano.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| plan | text | No | - | free, starter, pro, enterprise, unlimited |
| max_campaigns | integer | No | -1 | Limite de campanhas (-1 = ilimitado) |
| max_sales | integer | No | -1 | Limite de vendas |
| max_checkout_integrations | integer | No | 1 | Limite de integrações |
| max_ad_accounts | integer | No | 1 | Limite de contas de anúncio |
| max_workspaces | integer | No | 1 | Limite de áreas de trabalho |
| sync_interval_minutes | integer | No | 60 | Intervalo mínimo de sync |
| feature_sales_globe | boolean | No | false | Globo de vendas |
| feature_advanced_reports | boolean | No | false | Relatórios avançados |
| feature_conversion_funnel | boolean | No | false | Funil de conversão |
| feature_auto_sync | boolean | No | false | Sync automático |
| feature_api_access | boolean | No | false | Acesso à API |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

**Limites por plano:**
| Plano | Ad Accounts | Workspaces | Checkout Integrations |
|-------|-------------|------------|-----------------------|
| free | 1 | 1 | 1 |
| starter | 1 | 2 | 2 |
| pro | 2 | 5 | 5 |
| enterprise | 3 | 10 | 10 |
| unlimited | -1 (∞) | -1 (∞) | -1 (∞) |

#### 4.2.2 workspaces (Áreas de Trabalho)
Áreas de trabalho para separar dados por negócio/produto.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| name | text | No | - | Nome da área |
| created_at | timestamptz | No | now() | Criação |
| updated_at | timestamptz | No | now() | Atualização |

#### 4.2.3 workspace_connections
Vínculo entre áreas de trabalho e conexões Facebook.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| workspace_id | uuid | No | - | FK para workspaces |
| facebook_connection_id | text | No | - | ID da conexão Facebook |
| created_at | timestamptz | No | now() | Criação |

#### 4.2.4 workspace_checkout_integrations
Vínculo entre áreas de trabalho e integrações de checkout.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| workspace_id | uuid | No | - | FK para workspaces |
| checkout_integration_id | text | No | - | ID da integração |
| created_at | timestamptz | No | now() | Criação |

#### 4.2.5 company_costs
Custos da empresa configuráveis pelo usuário.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| user_id | uuid | No | - | Proprietário |
| name | text | No | - | Nome do custo |
| type | text | No | - | percentage ou fixed |
| value | numeric | No | - | Valor (% ou R$) |
| created_at | timestamptz | No | now() | Criação |

#### 4.2.6 welcome_emails_sent
Registro de emails de boas-vindas enviados.

| Coluna | Tipo | Nullable | Default | Descrição |
|--------|------|----------|---------|-----------|
| id | uuid | No | gen_random_uuid() | Chave primária |
| email | text | No | - | Email do destinatário |
| sent_at | timestamptz | No | now() | Data de envio |

---

## 5. Row Level Security (RLS)

### 5.1 Políticas por Tabela (Supabase Externo)

#### profiles
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can view their own profile | SELECT | auth.uid() = user_id |
| Users can update their own profile | UPDATE | auth.uid() = user_id |
| Admins can view all profiles | SELECT | has_role(auth.uid(), 'admin') |

#### user_roles
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can view their own roles | SELECT | auth.uid() = user_id |
| Admins can view all roles | SELECT | has_role(auth.uid(), 'admin') |
| Admins can manage roles | ALL | has_role(auth.uid(), 'admin') |

#### campaigns, ad_sets, ads, daily_ad_spend
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can CRUD their own | ALL | auth.uid() = user_id |

#### sales
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can view their own sales | SELECT | auth.uid() = user_id |
| Users can create their own sales | INSERT | auth.uid() = user_id |
| Users can update their own sales | UPDATE | auth.uid() = user_id |
| Service role can insert | INSERT | via service_role key (webhooks) |

#### facebook_connections, checkout_integrations, sync_schedules, sync_logs
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can CRUD their own | ALL | auth.uid() = user_id |

### 5.2 Políticas por Tabela (Lovable Cloud)

#### workspaces
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can CRUD their own | SELECT/INSERT/UPDATE/DELETE | auth.uid() = user_id |

#### workspace_connections, workspace_checkout_integrations
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can manage via workspace ownership | ALL | EXISTS (SELECT 1 FROM workspaces WHERE id = workspace_id AND user_id = auth.uid()) |

#### plan_rules
| Política | Comando | Expressão |
|----------|---------|-----------|
| Authenticated users can read | SELECT | auth.role() = 'authenticated' |
| Admins can manage | ALL | jwt role = 'admin' |

#### company_costs
| Política | Comando | Expressão |
|----------|---------|-----------|
| Users can CRUD their own | ALL | auth.uid() = user_id |

### 5.3 Função de Verificação de Role

```sql
CREATE OR REPLACE FUNCTION public.has_role(_user_id uuid, _role app_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role = _role
  )
$$;
```

---

## 6. Edge Functions

### 6.1 fetch-meta-insights
**Propósito:** Integração principal com Facebook Graph API v22.0

| Action | Descrição |
|--------|-----------|
| validate | Valida credenciais da conexão Facebook |
| insights | Busca métricas agregadas do período |
| campaigns | Lista campanhas |
| sync | Sincronização completa: campanhas → ad sets → ads + daily_ad_spend |
| check_job | Verifica status de job de processamento assíncrono |

**Comportamento do Sync:**
1. Busca campanhas dos últimos 30 dias
2. Filtra apenas `objective = 'OUTCOME_SALES'`
3. Para cada campanha, busca ad sets e ads
4. Grava gastos diários na tabela `daily_ad_spend` (com limpeza prévia por connection_id)
5. Upsert de todos os dados hierárquicos
6. Grava `facebook_connection_id` em cada campanha para isolamento multi-conta

### 6.2 manage-facebook-connection
**Propósito:** CRUD completo de conexões Facebook com suporte a múltiplas contas

| Action | Descrição |
|--------|-----------|
| save | Cria/atualiza conexão com encriptação AES |
| get | Lista conexões do usuário (ad_account_id mascarado) |
| delete | Remove conexão específica ou todas |
| validate | Valida credenciais via Graph API |
| list-accounts | Lista contas de anúncio disponíveis para um token |
| list-accounts-from-connection | Lista contas usando token de conexão existente |
| save-multiple | Salva múltiplas contas em lote (seleção de BM) |
| update-token | Atualiza token de acesso de conexão existente |
| migrate | Migra credenciais plain-text para formato encriptado |

**Suporta `target_user_id`** para impersonificação pelo admin.

### 6.3 manage-workspaces
**Propósito:** CRUD de áreas de trabalho

| Action | Descrição |
|--------|-----------|
| list | Lista áreas do usuário |
| create | Cria nova área (verifica limite do plano) |
| update | Renomeia área |
| delete | Remove área e suas associações |

**Suporta `target_user_id`** para impersonificação pelo admin.

### 6.4 admin-proxy
**Propósito:** Proxy para impersonificação de usuários pelo admin. Recebe queries do `proxied-client` e executa com `service_role` no Supabase externo, contornando RLS. Suporta operações fluentes e paginação via `.range()`.

### 6.5 auto-sync
Sincronização automática agendada. Verifica `sync_schedules` e executa sync para usuários com agendamento ativo.

### 6.6 update-budget
Altera orçamento (daily ou lifetime) de campanhas diretamente via Facebook API.

### 6.7 update-campaign-status
Altera status (ACTIVE/PAUSED) de campanhas via Facebook API.

### 6.8 rematch-sales
Re-executa a lógica de atribuição `match-sale-to-ads` para vendas existentes, atualizando `campaign_id`, `ad_set_id` e `ad_internal_id`.

### 6.9 admin-users
CRUD de usuários para o painel admin. Suporta criação, edição, exclusão e listagem paginada com filtros. Retorna status agregado de conexões Facebook (suporta múltiplas conexões por usuário).

### 6.10 manage-plan-rules
CRUD de regras de planos. Permite admin editar limites e features por plano.

### 6.11 send-welcome-email
Envia email de boas-vindas para novos usuários registrados.

### 6.12 webhook-n8n-profiles
Sync de perfis de usuários via N8N (integração externa).

### 6.13 Webhooks de Checkout (9 funções)
Cada webhook recebe eventos de venda da respectiva plataforma e:
1. Identifica o usuário pelo `checkout_integration_id` ou `webhook_secret`
2. Normaliza os dados do evento (produto, valor, status, UTMs, dados do cliente)
3. Executa `match-sale-to-ads` para atribuir a venda ao anúncio correto
4. Insere na tabela `sales`

| Webhook | Plataforma |
|---------|------------|
| webhook-hotmart | Hotmart |
| webhook-kiwify | Kiwify |
| webhook-kirvano | Kirvano |
| webhook-guru | Guru Digital |
| webhook-perfectpay | Perfect Pay |
| webhook-ticto | Ticto |
| webhook-payt | PayT |
| webhook-cakto | Cakto |
| webhook-balaclava | Balaclava |

### 6.14 Módulos Compartilhados (_shared/)

| Módulo | Descrição |
|--------|-----------|
| match-sale-to-ads.ts | Atribuição de vendas a anúncios via UTMs |
| ddd-to-state.ts | Mapeamento DDD → estado brasileiro |
| normalize-state.ts | Normalização de nomes de estados |
| encryption.ts | Encriptação/decriptação AES para credenciais |
| extract-webhook-token.ts | Extração de tokens de webhooks |
| currency.ts | Conversão e formatação de moedas |

---

## 7. Páginas e Funcionalidades

### 7.1 Páginas Públicas

| Rota | Componente | Descrição |
|------|------------|-----------|
| /login | Login | Autenticação email/senha |
| /register | Register | Cadastro de novo usuário |
| /forgot-password | ForgotPassword | Solicita reset de senha |
| /reset-password | ResetPassword | Define nova senha |
| /terms | Terms | Termos de uso |
| /privacy | Privacy | Política de privacidade |

### 7.2 Páginas Protegidas (Autenticado)

| Rota | Componente | Descrição |
|------|------------|-----------|
| / | → /dashboard | Redirect |
| /onboarding | Onboarding | Configuração inicial |
| /dashboard | Dashboard | Visão geral com métricas, gráficos, globo 3D e vendas em tempo real |
| /campaigns | Campaigns | Gestão hierárquica de campanhas com dois modos de atribuição |
| /sales | Sales | Listagem de vendas com filtros, gráficos e drawer de detalhes |
| /integrations | Integrations | Conexão Facebook (multi-conta) e checkout integrations |
| /settings | Settings | Perfil, segurança, plano e custos da empresa |

### 7.3 Páginas Admin (Role admin)

| Rota | Componente | Descrição |
|------|------------|-----------|
| /admin | AdminDashboard | Estatísticas gerais do sistema |
| /admin/users | AdminUsers | Listagem e gestão de usuários |
| /admin/users/:id | AdminUserDetail | Detalhes completos de um usuário |
| /admin/plans | AdminPlans | Configuração de regras por plano |

---

## 8. Funcionalidades Detalhadas

### 8.1 Dashboard (/dashboard)
- **6 cards de métricas**: Faturamento Bruto, Gasto com Ads, Lucro, Vendas Aprovadas, ROAS, CPA
- **Variação percentual** vs período anterior em cada métrica
- **Barra de progresso de receita** (all-time, cross-workspace) com milestones (10k, 100k, 500k, 1M)
- **Gráfico de linhas** Faturamento vs Gasto ao longo do tempo
- **Globo 3D interativo** com vendas por estado/região geográfica
- **Painel de vendas em tempo real** (últimas 9 vendas aprovadas no estilo notificação iOS)
- **Filtro de período** com presets (Hoje, Ontem, 7d, 30d, Mês atual, Mês passado, Custom) — calendário único com seleção de range
- **Sync manual** e **Refresh**
- **Dados filtrados** pela área de trabalho ativa e conta de anúncio selecionada

### 8.2 Campanhas (/campaigns)
- **Dois modos de atribuição**:
  - **Last Click**: vendas reais atribuídas via ad_id das UTMs
  - **Meta**: conversões reportadas pelo pixel do Facebook
- **Navegação hierárquica**: Campanhas → Conjuntos → Anúncios com breadcrumb
- **Tabelas com métricas**: Spend, Impressions, Clicks, CPC, CPM, CTR, Sales, Revenue, ROI, ROAS, CPA
- **Top Ads Chart**: Gráfico de barras dos anúncios com mais vendas
- **Funil de Conversão**: Link Clicks → Landing Page Views → Initiate Checkouts → Sales
- **Filtros**: Busca, Período (hoje/ontem/7d/30d/custom), Status (ativos/pausados)
- **Edição de orçamento** via modal (altera na API do Facebook)
- **Alteração de status** (ACTIVE/PAUSED) diretamente na tabela
- **Dados filtrados** por área de trabalho e conta de anúncio

### 8.3 Vendas (/sales)
- **Cards de métricas**: Total vendas, Faturamento, Ticket médio, ROAS, CPA, Lucro
- **Filtros**: Busca, Checkout platform, Status, Campanha, Período
- **Gráfico de barras** de vendas por produto
- **Gráfico UTM Content** — distribuição de vendas por conteúdo UTM
- **Tabela completa**: Data, Produto, Valor, Campanha, Conjunto, Anúncio, Status, Tipo (Paga/Orgânica)
- **Drawer de detalhes** ao clicar em uma venda (dados do cliente, UTMs, atribuição completa)
- **Paginação** (10 por página)

### 8.4 Integrações (/integrations)
- **Facebook Ads (Multi-conta)**:
  - Formulário para System User Token com seleção em lote de contas de anúncio
  - Botão "Adicionar outra BM" para conectar novas Business Managers
  - Edição de conexões existentes (atualização de token)
  - Validação individual de conexões
  - Auto-vinculação à área de trabalho ativa
- **Checkout Integrations**: Cards para cada plataforma (9) com URL do webhook, toggle ativo/desativo e configuração modal
- **Sync Schedule**: Configuração de sincronização automática (intervalo, ativo/desativo)

### 8.5 Configurações (/settings)
- **Perfil**: Nome, email (readonly), avatar
- **Segurança**: Alteração de senha
- **Plano**: Plano atual, preço, histórico de faturas (mock)
- **Custos**: Custos da empresa (% ou fixo) para desconto do faturamento bruto

### 8.6 Painel Admin
- **Dashboard Admin**: Total de usuários, ativos 30d, novos 7d, conexões Facebook, campanhas, vendas, receita total, distribuição por plano, gráfico de novos usuários, usuários com erros de sync
- **Gestão de Usuários**: Listagem paginada, busca, filtros (plano, role), criação, edição, exclusão
- **Detalhes do Usuário**: Perfil, conexões Facebook (múltiplas), integrações de checkout, campanhas, vendas recentes, logs de sync, ROI/ROAS
- **Impersonificação**: Admin pode navegar como qualquer usuário para suporte técnico
- **Planos**: Edição de regras por plano (limites, features, workspaces)

---

## 9. Áreas de Trabalho (Workspaces)

### 9.1 Conceito
Áreas de trabalho permitem separar dados por negócio ou produto. Cada área possui seu próprio conjunto de conexões Facebook e integrações de checkout.

### 9.2 Funcionamento
- Criação, seleção e exclusão no sidebar via `WorkspaceSwitcher`
- Limites por plano (free: 1, starter: 2, pro: 5, enterprise: 10, unlimited: ∞)
- Quando área não possui integrações ou nenhuma está selecionada, exibe estado de onboarding ("Área vazia")
- Associações são tratadas contextualmente (sem switches manuais)

### 9.3 Isolamento de Dados
- Todos os hooks filtram por `activeWorkspaceId`
- Exceção: `RevenueProgressBar` exibe faturamento consolidado cross-workspace
- Durante impersonificação, sync automático é bloqueado

---

## 10. Múltiplas Contas de Anúncios

### 10.1 Conceito
Usuários podem conectar múltiplas contas de anúncios Facebook (Business Managers) conforme limite do plano.

### 10.2 AccountSwitcher
- Componente no sidebar para alternar entre contas
- Opção "Todas as contas" (`activeConnectionId = null`) para visualização agregada
- Referência `showAllRef` impede seleção automática quando visão global é desejada

### 10.3 Fluxo de Conexão
1. Usuário insere System User Token
2. Sistema lista contas de anúncio disponíveis via Graph API
3. Usuário seleciona contas em lote
4. Conexões são salvas com token encriptado e auto-vinculadas à área ativa
5. Botão "Adicionar outra BM" permite conectar fontes adicionais

---

## 11. Impersonificação de Usuários

### 11.1 Conceito
Administradores podem navegar no sistema com a identidade de qualquer usuário para diagnóstico e suporte.

### 11.2 Implementação
- `ImpersonationContext` gerencia estado de impersonificação
- `useSupabase()` retorna `proxied-client` quando impersonando
- `admin-proxy` edge function executa queries com `service_role`, contornando RLS
- Edge functions aceitam `target_user_id` para operações em nome do usuário
- Sync automático é bloqueado durante impersonificação

---

## 12. Modelos de Atribuição

### 12.1 Last Click (Padrão)
- Usa UTMs das vendas para identificar o anúncio (`ad_id` → `facebook_ad_id`)
- Resolve hierarquia: Ad → Ad Set → Campaign
- Agrupa vendas reais por campanha/conjunto/anúncio
- Métricas: vendas aprovadas reais, receita real

### 12.2 Meta (Pixel)
- Usa dados de conversão reportados pelo pixel do Facebook
- Campo `conversions` das tabelas campaigns/ad_sets/ads
- Não depende de UTMs — mostra o que a Meta reporta

---

## 13. Métricas Calculadas

### 13.1 Fórmulas

| Métrica | Fórmula |
|---------|---------|
| Faturamento Bruto | Σ vendas aprovadas (amount) |
| Faturamento Líquido | Bruto - Σ company_costs |
| Lucro | Líquido - Gasto com Ads |
| ROI | ((Líquido - Gasto) / Gasto) × 100 |
| ROAS | Bruto / Gasto |
| CPA | Gasto / Quantidade de vendas |
| CTR | (Link Clicks / Impressões) × 100 |
| CPC | Gasto / Link Clicks |
| CPM | (Gasto / Impressões) × 1000 |

### 13.2 Cálculo de Gasto por Período
Quando há filtro de período, o gasto é recalculado a partir da tabela `daily_ad_spend` em vez de usar o campo `spend` acumulado da campanha.

### 13.3 Variação Percentual
Cada métrica mostra a variação vs o período anterior equivalente (ex: últimos 7 dias vs 7 dias anteriores).

---

## 14. Controle de Acesso

### 14.1 Roles do Sistema
| Role | Descrição |
|------|-----------|
| user | Usuário padrão — acessa Dashboard, Campanhas, Vendas, Integrações, Configurações |
| admin | Administrador — todos os acessos de user + Painel Admin + Impersonificação |

### 14.2 Controle de Assinatura
- `useAccessControl` verifica se o usuário está ativo ou se a assinatura expirou
- Admin sempre tem acesso total
- Usuários inativos com `subscription_end` no passado veem `ExpiredAccessModal`
- Plano `free` tem funcionalidades limitadas (sem globo, sem funil, sem auto-sync)

### 14.3 ProtectedRoute
```typescript
<ProtectedRoute>                    // Requer autenticação
<ProtectedRoute requireAdmin>       // Requer role admin
```

### 14.4 Planos e Limites
| Feature | free | starter | pro | enterprise | unlimited |
|---------|------|---------|-----|------------|-----------|
| Ad Accounts | 1 | 1 | 2 | 3 | ∞ |
| Workspaces | 1 | 2 | 5 | 10 | ∞ |
| Checkout Integrations | 1 | 2 | 5 | 10 | ∞ |
| Globo 3D | ❌ | ✅ | ✅ | ✅ | ✅ |
| Funil de Conversão | ❌ | ❌ | ✅ | ✅ | ✅ |
| Auto-sync | ❌ | ❌ | ✅ | ✅ | ✅ |
| Relatórios Avançados | ❌ | ❌ | ❌ | ✅ | ✅ |
| API Access | ❌ | ❌ | ❌ | ❌ | ✅ |

---

## 15. Sincronização com Facebook

### 15.1 Auto-sync ao Login
Ao montar o `DashboardLayout`, se o usuário tem conexão Facebook válida, `activeConnectionId` definido e não sincronizou nesta sessão, executa sync silencioso automaticamente (1x por sessão via `sessionStorage`). Bloqueado durante impersonificação.

### 15.2 Sync Manual
Botão `SyncButton` disponível no Dashboard e Campanhas.

### 15.3 Sync Agendado
Configurável em Integrações → Sync Schedule. Intervalo mínimo depende do plano.

### 15.4 Sync Multi-conta
Quando "Todas as contas" está selecionado, o sync executa sequencialmente para cada conexão vinculada à área ativa. Cada conexão grava `facebook_connection_id` nas campanhas e `daily_ad_spend` para isolamento.

---

## 16. Encriptação de Credenciais

### 16.1 Módulo `_shared/encryption.ts`
- Encriptação AES para campos sensíveis: `app_id`, `app_secret`, `access_token`
- Formato encriptado: `iv:ciphertext` (separador `:`)
- `decryptIfNeeded` detecta automaticamente se o valor já está encriptado
- Chave de encriptação armazenada como secret `ENCRYPTION_KEY`

### 16.2 Migração
Action `migrate` no `manage-facebook-connection` converte credenciais plain-text existentes para formato encriptado.

---

## 17. Contexts do React

| Context | Descrição |
|---------|-----------|
| AuthContext | Estado de autenticação, login/logout, dados do usuário e role |
| RefetchContext | Funções de refetch compartilhadas entre componentes |
| ImpersonationContext | Estado de impersonificação (admin → usuário alvo) |
| ActiveConnectionContext | Conta de anúncio ativa (ou null para "todas") |
| WorkspaceContext | Área de trabalho ativa |

---

## 18. Fluxos de Usuário

### 18.1 Onboarding
```
Register → Email Verification → Login → Onboarding → Dashboard
```

### 18.2 Fluxo Completo de Uso
```
1. Criar Área de Trabalho (automático na primeira vez)
2. Configurar Conexão Facebook (Integrações) — selecionar contas de BM
3. Sincronizar Campanhas
4. Configurar Webhook de Checkout (Integrações)
5. Vendas chegam automaticamente via webhook
6. Vendas são atribuídas a anúncios automaticamente
7. Visualizar métricas no Dashboard
8. Analisar campanhas hierarquicamente
9. Gerenciar orçamentos e status de campanhas
10. Alternar entre áreas de trabalho para diferentes negócios
```

### 18.3 Navegação Hierárquica
```
/campaigns
    ├── Lista de Campanhas
    │         │ (clique)
    │         ▼
    ├── Breadcrumb: Campanhas > [Nome Campanha]
    │   Lista de Conjuntos filtrados
    │         │ (clique)
    │         ▼
    └── Breadcrumb: Campanhas > [Nome Campanha] > [Nome Conjunto]
        Lista de Anúncios filtrados
```

---

## 19. Triggers e Functions do Banco

### 19.1 handle_new_user
Trigger após criação de usuário em auth.users:
- Cria profile com nome e email
- Atribui role 'user' padrão

### 19.2 update_updated_at_column
Trigger `BEFORE UPDATE` que atualiza `updated_at = now()` automaticamente.

---

## 20. Design System

### 20.1 Tema
- **Background**: Dark (#0a0a0a)
- **Foreground**: White (#fafafa)
- **Primary (Verde Sentinela)**: HSL 68 99% 55% → `#d1fe17` / RGB(209, 254, 23)
- **Muted text**: `#a1a4a5`
- **Cards**: Glass morphism com bordas `white/5` e backgrounds `white/[0.03]`
- **Sidebar**: Glass sidebar com blur, colapsável

### 20.2 Tipografia
- Font: System default (sans-serif)
- Headings: `text-xl font-semibold text-white`
- Subtitles: `text-sm text-[#a1a4a5]/70`
- Labels: `text-xs font-medium uppercase tracking-wider text-[#a1a4a5]`

### 20.3 Animações
- Entry animation: `animate-sentinel-in`
- Loading: Skeleton components
- Sync: `animate-spin` no ícone RefreshCw

---

## 21. Secrets e Variáveis de Ambiente

### 21.1 Variáveis Automáticas (Lovable Cloud)
| Variável | Descrição |
|----------|-----------|
| VITE_SUPABASE_URL | URL do projeto Lovable Cloud |
| VITE_SUPABASE_PUBLISHABLE_KEY | Chave pública Lovable Cloud |
| VITE_SUPABASE_PROJECT_ID | ID do projeto Lovable Cloud |
| SUPABASE_URL | URL interna (Edge Functions) |
| SUPABASE_SERVICE_ROLE_KEY | Chave de serviço Lovable Cloud |

### 21.2 Secrets Configurados (Edge Functions)
| Secret | Descrição |
|--------|-----------|
| EXTERNAL_SUPABASE_URL | URL do Supabase externo |
| EXTERNAL_SUPABASE_ANON_KEY | Chave anon do Supabase externo |
| EXTERNAL_SUPABASE_SERVICE_ROLE_KEY | Chave service_role do Supabase externo |
| ENCRYPTION_KEY | Chave AES para encriptação de credenciais |

### 21.3 Credenciais por Usuário (Banco)
Armazenadas nas tabelas `facebook_connections` (encriptadas) e `checkout_integrations`, protegidas por RLS.

---

## 22. Considerações de Segurança

- **RLS em todas as tabelas** — cada usuário só acessa seus próprios dados
- **Roles separadas** de profiles (previne privilege escalation)
- **Function `has_role`** com `SECURITY DEFINER` para evitar recursão RLS
- **Credenciais Facebook encriptadas** com AES no banco, nunca expostas no frontend
- **Ad account IDs mascarados** nas respostas da API (act_****XXXX)
- **Webhooks** validados por `webhook_secret` quando disponível
- **Edge Functions** usam `service_role_key` para operações administrativas
- **Access tokens** do Facebook nunca retornados em queries públicas
- **Senhas** gerenciadas pelo Supabase Auth (bcrypt)
- **Sessões JWT** com refresh automático
- **Impersonificação** restrita a role admin com validação em cada edge function
- **Proxy admin** contorna RLS apenas para operações autorizadas

---

## 23. Conexão com Supabase Externo

O projeto utiliza um cliente Supabase dual:
- **Lovable Cloud** (`src/integrations/supabase/client.ts`): Projeto gerenciado automaticamente — plan_rules, workspaces, company_costs
- **Supabase Externo** (`src/integrations/supabase/db.ts`): Projeto `picgyetvkjymfrgsjozt` — profiles, campaigns, sales, facebook_connections, etc.

O cliente principal usado pela aplicação é o **externo** (`db.ts`), que aponta para o projeto de produção.

O hook `useSupabase()` retorna o cliente apropriado:
- Normal: retorna `supabase` (externo)
- Impersonando: retorna `proxiedClient` (via admin-proxy)

---

*Documento atualizado em 2026-02-18. Versão 3.0*
