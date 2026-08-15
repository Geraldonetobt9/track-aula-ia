> **AVISO: Este documento esta desatualizado.** Refere-se a arquitetura anterior com Supabase Edge Functions (Deno) e dois projetos Supabase separados (externo + Lovable Cloud). A arquitetura atual usa NestJS + Fastify com um unico Supabase. Consulte `docs/features/README.md` para a documentacao atualizada.

# Sentinela — Documentação Técnica Completa v3.0 (Legado)

**Versão:** 3.0
**Data:** 2026-02-18
**Status:** Desatualizado — mantido como referencia historica

---

## ÍNDICE

1. [Mapa de Páginas e Rotas](#1-mapa-de-páginas-e-rotas)
2. [Frontend Detalhado — Componentes por Página](#2-frontend-detalhado)
3. [Fluxos de Usuário](#3-fluxos-de-usuário)
4. [Níveis de Acesso](#4-níveis-de-acesso)
5. [Hooks — Catálogo Completo](#5-hooks)
6. [Contexts — Estado Global](#6-contexts)
7. [Banco de Dados — Schema Completo](#7-banco-de-dados)
8. [Edge Functions — API Backend](#8-edge-functions)

---

## 1. Mapa de Páginas e Rotas

### 1.1 Árvore de Rotas (App.tsx)

```
BrowserRouter
├── /                        → Navigate(/dashboard)
├── /login                   → Login             [público]
├── /register                → Register          [público]
├── /forgot-password         → ForgotPassword     [público]
├── /reset-password          → ResetPassword      [público]
├── /terms                   → Terms             [público]
├── /privacy                 → Privacy           [público]
├── /onboarding              → Onboarding        [ProtectedRoute]
├── /dashboard               → Dashboard         [ProtectedRoute]
├── /campaigns               → Campaigns         [ProtectedRoute]
├── /sales                   → Sales             [ProtectedRoute]
├── /integrations            → Integrations      [ProtectedRoute]
├── /settings                → Settings          [ProtectedRoute]
├── /admin                   → AdminLayout       [ProtectedRoute requireAdmin]
│   ├── index                → AdminDashboard
│   ├── users                → AdminUsers
│   ├── users/:id            → AdminUserDetail
│   └── plans                → AdminPlans
└── *                        → NotFound
```

### 1.2 Hierarquia de Providers (App.tsx)

```
QueryClientProvider
└── AuthProvider
    └── ImpersonationProvider
        └── WorkspaceProvider
            └── ActiveConnectionProvider
                └── RefetchProvider
                    └── TooltipProvider
                        └── BrowserRouter
```

---

## 2. Frontend Detalhado

### 2.1 Páginas Públicas

#### `/login` — Login.tsx
- **Layout:** Tela centralizada com background ambient (blur verde + branco)
- **Componentes:**
  - Logo Sentinela (`sentinela-logo.png`)
  - Subtítulo: "Acesse seu painel de controle"
  - Form `liquid-glass rounded-2xl`:
    - Input email (required)
    - Input password com toggle show/hide (`Eye`/`EyeOff`)
    - Link "Esqueci minha senha" → `/forgot-password`
    - Button "Entrar" (loading state com `Loader2`)
  - Link "Criar conta" → `/register`
- **Lógica:**
  - `useAuth().login(email, password)` → retorna `{ success, isAdmin }`
  - Se admin → navega `/admin`; senão → `/dashboard`
  - Toast de sucesso/erro

#### `/register` — Register.tsx
- **Layout:** Mesmo background ambient do Login
- **Componentes:**
  - Logo + subtítulo "Comece seu teste grátis de 7 dias"
  - Form `liquid-glass`:
    - Input nome completo
    - Input email
    - Input senha (minLength 6)
    - Input confirmar senha
    - Checkbox aceitar Termos de Uso + Política de Privacidade
    - Button "Criar conta"
  - Link "Já tem conta?" → `/login`
- **Lógica:**
  - Validação de senhas iguais e termos aceitos
  - `useAuth().register(name, email, password)`
  - `localStorage.set('adsTracker_needsOnboarding', 'true')`
  - Fire-and-forget: `send-welcome-email` via Cloud
  - Navega → `/onboarding`

#### `/forgot-password` — ForgotPassword.tsx
- Input email + button "Enviar link de redefinição"
- `useAuth().resetPassword(email)` → email com link para `/reset-password`

#### `/reset-password` — ResetPassword.tsx
- Inputs nova senha + confirmar
- Processa token da URL para redefinir senha

#### `/terms` — Terms.tsx / `/privacy` — Privacy.tsx
- Páginas estáticas de conteúdo legal

---

### 2.2 Páginas Protegidas

#### `/onboarding` — Onboarding.tsx
- **Layout:** Tela full-screen sem sidebar, wizard de 3 passos
- **Progress bar:** Círculos 1-2-3 com linhas conectoras
- **Step 1 — Conectar Facebook:**
  - Ícone Facebook azul
  - Input Access Token (type password)
  - Input Ad Account ID (placeholder `act_123456789`)
  - Button "Salvar Credenciais" (bg azul Facebook)
  - Após salvar: ícone ✅ CheckCircle verde
  - Hook: `useFacebookConnection`
- **Step 2 — Configurar Checkout:**
  - Select com opções: Hotmart, Kiwify, Kirvano
  - Exibe URL do webhook + botão copiar
- **Step 3 — Verificar Conexões:**
  - Card Facebook → Badge "Conectado"
  - Card Checkout → Badge "Ativo"
  - Mensagem 🎉 "Tudo pronto!"
- **Navegação:** Botões Voltar/Próximo; Step 3 → "Ir para Dashboard"
- **Validação:** Step 1 requer `isConfigured`; Step 2 requer checkout selecionado

---

#### `/dashboard` — Dashboard.tsx (583 linhas)

**Estrutura da página:**

```
DashboardLayout
└── div.space-y-6.animate-sentinel-in
    ├── WorkspaceSwitcher (variant="inline")
    ├── Header
    │   ├── "Bem vindo, {nome}"
    │   ├── Badge "Sem dados" (se vazio)
    │   ├── RevenueProgressBar (cross-workspace)
    │   ├── DateRangeFilter
    │   ├── SyncButton
    │   └── Button Refresh
    ├── [Empty State: "Crie sua primeira área" / "Área vazia"]
    └── Grid [1fr 0.28fr]
        ├── Left Column
        │   ├── Metrics Grid (3x2)
        │   │   ├── Faturamento Bruto (DollarSign)
        │   │   ├── Gasto com Ads (BarChart3)
        │   │   ├── Lucro (TrendingUp) — verde se positivo
        │   │   ├── Vendas Aprovadas (ShoppingCart)
        │   │   ├── ROAS (Target)
        │   │   └── CPA (Target)
        │   ├── LineChart (Faturamento vs Gasto)
        │   └── SalesGlobe (globo 3D interativo)
        └── Right Column
            └── RealtimeSalesPanel (últimas 9 vendas estilo iOS)
```

**Componentes internos:**

| Componente | Descrição |
|-----------|-----------|
| `MetricCard` | Card com título, valor, variação %, ícone. Loading via Skeleton |
| `RevenueProgressBar` | Barra de progresso all-time cross-workspace. Milestones: 0, 10k, 100k, 500k, 1M. Gradient verde Sentinela. Consulta diretamente `supabase.from('sales')` sem filtro de workspace |
| `RealtimeSalesPanel` | Lista vertical de vendas aprovadas (max 9). Estilo notificação iOS: ícone `$`, nome produto, hora, valor verde. Usa `useSales()` |

**Hooks utilizados:**
- `useDashboardMetrics(dateRange)` → metrics, chartData, campaigns, loading, refetch
- `useSales()` → sales, loading (para painel real-time)
- `useSalesByRegion(dateRange)` → regions (para globo 3D)
- `useAuth()` → user.name
- `useWorkspaceContext()` → activeWorkspaceId, workspaces, activeConnectionIds, activeCheckoutIds

**Filtro de período (DateRangeFilter):**
- Presets: Hoje, Ontem, 7 dias, 30 dias, Mês atual, Mês passado, Personalizado
- Personalizado: calendário único com seleção de range (start → end)
- Período sincronizado na URL via `useSearchParams` (parâmetros: `period`, `from`, `to`)

**Estados vazios:**
- Sem workspace → "Crie sua primeira área"
- Sem conexões → "Área vazia" + botão "Ir para Integrações"

---

#### `/campaigns` — Campaigns.tsx (476 linhas)

**Estrutura:**

```
DashboardLayout
└── div.space-y-6
    ├── Header (título dinâmico + contagem + SyncButton + Refresh)
    ├── Breadcrumb Navigation (se drill-down ativo)
    ├── Filters Card
    │   ├── Search Input
    │   ├── Period Select (today/yesterday/7d/30d/custom)
    │   ├── Custom Date Popover (Calendar mode="range")
    │   └── Status Select (all/active/paused)
    ├── Attribution Tabs (Last Click / Meta)
    ├── TopAdsChart (gráfico de barras)
    ├── ConversionFunnel (funnel visual)
    └── Data Table Card
        ├── CampaignsTable (view: campaigns)
        ├── AdSetsTable (view: adsets)
        └── AdsTable (view: ads)
```

**Navegação hierárquica (drill-down):**
- Estado: `selectedCampaign`, `selectedAdSet`
- `currentView` = 'campaigns' | 'adsets' | 'ads'
- Breadcrumb: Campanhas > [Nome Campanha] > [Nome Conjunto]
- Click campanha → mostra ad sets filtrados
- Click ad set → mostra ads filtrados

**Modos de atribuição (tabs):**
- **Last Click:** hooks `useCampaigns`, `useAdSets`, `useAds`, `useTopAds`, `useCampaignsFunnel`
- **Meta:** hooks `useMetaCampaigns`, `useMetaAdSets`, `useMetaAds`, `useMetaCampaignsFunnel`

**Colunas das tabelas:**
- Campanhas: Nome, Status, Spend, Impressions, Clicks, CPC, CPM, CTR, Sales, Revenue, ROI, ROAS, CPA, Orçamento (editável), Status (editável)
- Ad Sets: Nome, Status, Spend, Impressions, Clicks, CPC, CPM, CTR, Sales, Revenue, ROI, ROAS, CPA
- Ads: Nome, Status, Spend, Impressions, Clicks, CPC, CPM, CTR, Sales, Revenue, ROI, ROAS, CPA

**Componentes especiais:**
- `BudgetEditModal` — edita orçamento via Facebook API (`update-budget`)
- `StatusSelect` — altera ACTIVE/PAUSED via Facebook API (`update-campaign-status`)
- `TopAdsChart` — BarChart (Recharts) com top 10 anúncios por vendas
- `ConversionFunnel` — Funnel visual: Link Clicks → Landing Page Views → Initiate Checkouts → Sales

**Estados vazios:**
- Sem workspace/conexões → "Área vazia"
- Sem dados → Badge "Sem dados"

---

#### `/sales` — Sales.tsx (360 linhas)

**Estrutura:**

```
DashboardLayout
└── div.space-y-6
    ├── Header + Refresh
    ├── SalesMetricsCards (6 cards)
    ├── SalesFilters
    ├── ProductSalesChart (barras por produto)
    ├── UtmContentChart (barras por UTM content)
    ├── Sales Table
    │   ├── Colunas: Data, Produto, Valor, Campanha, Conjunto, Anúncio, Status, Atribuição
    │   └── Paginação (10/página)
    └── SaleDetailsDrawer (drawer lateral)
```

**SalesMetricsCards (6 cards):**
- Total vendas, Faturamento, Ticket médio, ROAS, CPA, Lucro
- Calculados via `calculateSalesMetrics(filteredSales, adSpend)`

**SalesFilters:**
- Search (produto, cliente, email, campanha)
- Select checkout platform (all, manual, hotmart, kiwify, etc.)
- Select status (all, approved, pending, refunded)
- Select campanha (all, organic, campanhas do usuário)
- DateRange picker com presets

**Tabela — lógica de exibição:**
- Campanha: se `utm_source === 'organico'` → "Orgânico"; senão `campaign_name` ou `utm_campaign`
- Conjunto: `ad_set_name` ou `utm_content`
- Anúncio: `ad_name` ou `utm_term`
- Status: Badge colorido (verde=Aprovada, cinza=Pendente, neutro=Reembolsada)
- Atribuição: Badge "Paga" ou "Orgânica" (verde)

**SaleDetailsDrawer:**
- Drawer lateral (Sheet) com detalhes completos:
  - Dados do cliente (nome, email, telefone, documento)
  - UTMs completos (source, medium, campaign, content, term, ad_id)
  - Atribuição (campanha, conjunto, anúncio)
  - Plataforma de checkout, método de pagamento, moeda

---

#### `/integrations` — Integrations.tsx (46 linhas)

**Estrutura:**

```
DashboardLayout
└── div.space-y-8
    ├── Header
    ├── [Empty State: "Nenhuma área criada"]
    ├── FacebookConnectionForm
    ├── Separator
    └── CheckoutIntegrationsSection
```

**FacebookConnectionForm (componente complexo):**
- Lista conexões existentes com ad_account_id mascarado (act_****XXXX)
- Badge de status: ✅ Válida / ❌ Inválida / ⏳ Não validada
- Botão "Validar" por conexão
- Botão "Editar" → modal para atualizar token ou listar contas da BM
- Botão "Excluir" conexão
- Botão "Adicionar outra BM" → formulário de System User Token
  - Input Access Token
  - "Buscar Contas" → lista contas de anúncio disponíveis
  - Checkbox de seleção em lote
  - "Salvar Contas Selecionadas"
- Auto-vinculação à workspace ativa

**CheckoutIntegrationsSection:**
- Grid de cards (9 plataformas): Hotmart, Kiwify, Kirvano, Guru, Perfect Pay, Ticto, PayT, Cakto, Balaclava
- Cada card:
  - Logo da plataforma
  - Toggle ativo/desativo
  - Botão "Configurar" → `CheckoutConfigModal`
- **CheckoutConfigModal:**
  - URL do webhook (copiável)
  - Campo webhook secret (opcional)
  - Último webhook recebido (timestamp)

**SyncScheduleSection:**
- Toggle sincronização automática
- Select intervalo (dependente do plano)
- Status última sync

---

#### `/settings` — Settings.tsx (321 linhas)

**Tabs:**

| Tab | Conteúdo |
|-----|----------|
| **Perfil** | Avatar (iniciais), Input nome, Input email (disabled), Button "Salvar alterações" |
| **Segurança** | Input senha atual, nova, confirmar. Button "Alterar senha" |
| **Plano** | Card plano atual (nome, preço, status, data expiração). Button "Fazer Upgrade" se free/expirado |
| **Custos** | Lista custos existentes (nome, tipo %, valor). Formulário para adicionar (nome, tipo select, valor input). Button "Adicionar" |

**Planos disponíveis:**
| Plano | Preço | Cor badge |
|-------|-------|-----------|
| Free | Grátis | bg-muted |
| Starter | R$ 47/mês | bg-blue-500/20 |
| Pro | R$ 97/mês | bg-primary/20 |
| Enterprise | R$ 197/mês | bg-amber-500/20 |
| Unlimited | Personalizado | bg-purple-500/20 |

---

### 2.3 Páginas Admin

#### `/admin` — AdminDashboard.tsx (226 linhas)

**Componentes:**
- `AdminStatsCards` — Cards: Total usuários, Ativos 30d, Novos 7d, Conexões Facebook, Campanhas totais, Vendas totais, Receita total
- `BarChart` — Novos usuários últimos 30 dias
- `PieChart` — Distribuição por plano (donut chart com inner radius)
- `Table` — Últimos 10 usuários registrados (nome, email, plano, data, Facebook status 🟢🔴⚫)
- `Table` — Usuários com erros de sync (nome, email, erro truncado, data)
- Click em linha → navega `/admin/users/:user_id`

#### `/admin/users` — AdminUsers.tsx (179 linhas)

**Componentes:**
- `UserFilters` — Search (debounce 300ms), Select plano, Select role, Select Facebook status, Button "Criar Usuário"
- `UsersTable` — Tabela paginada (20/página) com ações: Edit, Delete, Toggle Admin, Force Sync
- `CreateUserModal` — Form: nome, email, senha, plano, role
- `EditUserModal` — Form: nome, email, plano, ativo, subscription dates
- `DeleteUserDialog` — Confirmação de exclusão

#### `/admin/users/:id` — AdminUserDetail.tsx

**Seções:**
- Perfil do usuário (nome, email, plano, datas)
- Conexões Facebook (lista com status e ad_account_id)
- Integrações de checkout
- Campanhas do usuário
- Vendas recentes
- Logs de sincronização
- Botão "Impersonar" → ativa `ImpersonationContext`

#### `/admin/plans` — AdminPlans.tsx

- Tabela editável com regras por plano
- Campos: max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts, max_workspaces, sync_interval_minutes
- Features toggle: globe, reports, funnel, auto_sync, api_access
- Salva via `manage-plan-rules` edge function

---

### 2.4 Componentes de Layout

#### `DashboardLayout.tsx` (104 linhas)

```
div.min-h-screen.bg-background
├── WorkspaceSync (componente invisível que carrega workspaces)
├── ExpiredAccessModal (bloqueia acesso se subscription expirada)
├── [Impersonation Banner] (fixed top, amber, "Visualizando como: {nome}" + Sair)
├── [Mobile Overlay] (backdrop blur black/60)
├── Sidebar (fixed left, w-64 ou w-16 colapsado)
└── Main Content (pl-64 ou pl-16)
    ├── Mobile Header (sticky, h-14, hamburger + logo)
    └── main.p-4 (children)
```

**Auto-sync ao login:**
- Condições: não impersonando, connections > 0, isConfigured, isValid, não synced nesta sessão
- `sessionStorage.set('sentinel_auto_synced', 'true')`
- `syncData({ silent: true })`

#### `Sidebar.tsx` (131 linhas)

```
aside.glass-sidebar (w-64 ou w-16)
├── Logo + Collapse Button
├── WorkspaceSwitcher (collapsed=bool)
├── AccountSwitcher (collapsed=bool)
├── Nav Links
│   ├── Dashboard (LayoutDashboard)
│   ├── Campanhas (Megaphone)
│   ├── Vendas (ShoppingCart)
│   ├── Integrações (Link2)
│   ├── Configurações (Settings)
│   └── [Admin] (Shield) — se user.role === 'admin'
├── User email
└── Button Sair (LogOut)
```

#### `AccountSwitcher.tsx`
- Dropdown com lista de conexões Facebook da workspace ativa
- Opção "Todas as contas" (define `activeConnectionId = null`)
- Ad account IDs mascarados
- Badge de status por conexão

#### `WorkspaceSwitcher.tsx`
- Dropdown/inline com lista de workspaces
- Botão criar nova workspace
- Botão excluir workspace
- Limite verificado via `plan_rules.max_workspaces`

#### `DateRangeFilter.tsx`
- Popover com botões de preset
- Calendário único com seleção sequencial (start → end)
- Visual range highlighting (start, middle, end)
- Locale pt-BR

#### `SyncButton.tsx`
- Botão com ícone RefreshCw (animate-spin durante sync)
- `useFacebookSync().syncData()`

---

### 2.5 Componentes Visuais Especiais

#### `SalesGlobe.tsx`
- Globo 3D interativo com `topojson-client` + `world-atlas`
- Pontos verdes nos estados brasileiros proporcionais ao número de vendas
- Dados via `useSalesByRegion`
- Feature gated: `feature_sales_globe` no plano

#### `ConversionFunnel.tsx`
- Visualização de funil em 4 etapas:
  1. Link Clicks
  2. Landing Page Views
  3. Initiate Checkouts
  4. Sales (conversões)
- Barras proporcionais com taxa de conversão entre etapas
- Feature gated: `feature_conversion_funnel` no plano

#### `TopAdsChart.tsx`
- BarChart horizontal (Recharts)
- Top 10 anúncios por vendas/conversões
- Métricas: vendas, faturamento, gasto, ROAS

#### `ProductSalesChart.tsx`
- BarChart vertical agrupado por nome de produto
- Mostra quantidade de vendas por produto

#### `UtmContentChart.tsx`
- BarChart vertical agrupado por `utm_content`
- Distribuição de vendas por conteúdo UTM

---

## 3. Fluxos de Usuário

### 3.1 Registro e Onboarding

```
/register
  ├── Preenche nome, email, senha
  ├── Aceita termos
  ├── auth.signUp() → Supabase Externo
  ├── Trigger handle_new_user → cria profile + user_role
  ├── send-welcome-email (fire-and-forget)
  └── Navega → /onboarding
         ├── Step 1: Conecta Facebook (token + ad account)
         ├── Step 2: Seleciona checkout, copia webhook URL
         ├── Step 3: Verifica conexões
         └── Navega → /dashboard
```

### 3.2 Login e Auto-sync

```
/login
  ├── auth.signInWithPassword()
  ├── fetchUserProfile(userId) → profile + role
  ├── Se admin → /admin
  ├── Se user → /dashboard
  └── DashboardLayout monta:
       ├── WorkspaceSync carrega workspaces
       ├── useAccessControl verifica subscription
       ├── ExpiredAccessModal (se expirado)
       └── Auto-sync silencioso (1x/sessão)
            └── fetch-meta-insights action=sync
```

### 3.3 Fluxo de Dados Completo

```
1. Usuário configura Facebook (Integrações)
   └── manage-facebook-connection action=save-multiple
       └── Encripta tokens, salva conexões, auto-link workspace

2. Sincronização (manual ou auto)
   └── fetch-meta-insights action=sync
       ├── Busca campanhas (OUTCOME_SALES) via Graph API
       ├── Para cada campanha: ad_sets → ads
       ├── Upsert campaigns, ad_sets, ads
       ├── Limpa + insere daily_ad_spend
       └── Grava facebook_connection_id

3. Webhook de Checkout recebe venda
   └── webhook-{plataforma}
       ├── Identifica usuário via checkout_integration_id
       ├── Normaliza dados (produto, valor, UTMs, estado)
       ├── match-sale-to-ads (ad_id → campaign_id + ad_set_id + ad_internal_id)
       └── INSERT into sales

4. Usuário visualiza Dashboard
   └── useDashboardMetrics(dateRange)
       ├── Busca sales (filtro: workspace checkouts, período)
       ├── Busca daily_ad_spend (filtro: connection, período)
       ├── Calcula: Revenue, Spend, ROI, ROAS, CPA
       ├── Calcula variação vs período anterior
       └── Gera chartData por dia/hora
```

### 3.4 Fluxo de Impersonificação (Admin)

```
/admin/users/:id
  ├── Admin clica "Impersonar"
  ├── ImpersonationContext.startImpersonation(userId, userName)
  ├── useSupabase() retorna proxied-client
  ├── Banner amber fixo "Visualizando como: {nome}"
  ├── Todos os hooks usam effectiveUserId
  ├── Auto-sync bloqueado
  └── Admin clica "Sair" → stopImpersonation()
```

### 3.5 Fluxo Multi-Workspace

```
Sidebar → WorkspaceSwitcher
  ├── Seleciona workspace → WorkspaceContext.setActiveWorkspace(id)
  ├── activeConnectionIds = workspace.workspace_connections.map(c => c.facebook_connection_id)
  ├── activeCheckoutIds = workspace.workspace_checkout_integrations.map(c => c.checkout_integration_id)
  ├── Todos os hooks filtram por workspace connections
  └── AccountSwitcher filtra conexões pela workspace ativa
```

---

## 4. Níveis de Acesso

### 4.1 Roles

| Role | Descrição | Acesso |
|------|-----------|--------|
| `user` | Padrão | Dashboard, Campaigns, Sales, Integrations, Settings |
| `admin` | Administrador | Tudo de user + /admin/*, impersonificação |

### 4.2 Controle de Rota

| Componente | Comportamento |
|-----------|---------------|
| `ProtectedRoute` | Redireciona para `/login` se não autenticado |
| `ProtectedRoute requireAdmin` | Redireciona se role ≠ admin |
| `ExpiredAccessModal` | Modal blocking se `active=false` ou `subscription_end < now()` |

### 4.3 Controle por Plano

| Feature | free | starter | pro | enterprise | unlimited |
|---------|------|---------|-----|------------|-----------|
| Ad Accounts | 1 | 1 | 2 | 3 | ∞ |
| Workspaces | 1 | 2 | 5 | 10 | ∞ |
| Checkout Integrations | 1 | 2 | 5 | 10 | ∞ |
| Sales Globe | ❌ | ✅ | ✅ | ✅ | ✅ |
| Conversion Funnel | ❌ | ❌ | ✅ | ✅ | ✅ |
| Auto-sync | ❌ | ❌ | ✅ | ✅ | ✅ |
| Advanced Reports | ❌ | ❌ | ❌ | ✅ | ✅ |
| API Access | ❌ | ❌ | ❌ | ❌ | ✅ |

### 4.4 Hook useAccessControl

```typescript
// Verifica condições de bloqueio:
// 1. profile.active === false
// 2. subscription_end < now() (mesmo se active=true)
// Admin sempre tem acesso total
```

---

## 5. Hooks — Catálogo Completo

### 5.1 Hooks de Autenticação e Contexto

| Hook | Arquivo | Retorno | Descrição |
|------|---------|---------|-----------|
| `useAuth()` | AuthContext.tsx | `{ user, session, login, register, logout, resetPassword, updateUser }` | Estado de autenticação completo |
| `useSupabase()` | useSupabase.ts | `supabase client` | Retorna proxied-client se impersonando |
| `useImpersonation()` | ImpersonationContext.tsx | `{ target, isImpersonating, startImpersonation, stopImpersonation, getEffectiveUserId }` | Estado de impersonificação |
| `useActiveConnection()` | ActiveConnectionContext.tsx | `{ activeConnectionId, connections, setActiveConnection, activeConnection }` | Conta de anúncio ativa |
| `useWorkspaceContext()` | WorkspaceContext.tsx | `{ activeWorkspaceId, workspaces, setActiveWorkspace, activeConnectionIds, activeCheckoutIds }` | Workspace ativa + IDs filtrados |
| `useRefetch()` | RefetchContext.tsx | `{ refetchSignal, triggerRefetch }` | Signal para refetch global |
| `useAccessControl()` | useAccessControl.ts | `{ hasAccess, isExpired }` | Verifica subscription ativa |

### 5.2 Hooks de Dados — Last Click Attribution

| Hook | Arquivo | Parâmetros | Retorno | Descrição |
|------|---------|------------|---------|-----------|
| `useCampaigns` | useCampaigns.ts | `dateRange` | `{ campaigns, loading, refetch }` | Campanhas com vendas reais e gasto por período |
| `useAdSets` | useAdSets.ts | `dateRange, campaignId?` | `{ adSets, loading, refetch }` | Ad sets com vendas reais |
| `useAds` | useAds.ts | `dateRange, adSetId?` | `{ ads, loading, refetch }` | Ads com vendas reais |
| `useTopAds` | useTopAds.ts | `dateRange` | `{ topAds, loading, refetch }` | Top 10 ads por vendas |
| `useCampaignsFunnel` | useCampaignsFunnel.ts | `dateRange, campaignIds` | `funnelData` | Dados de funil (link clicks → sales) |

### 5.3 Hooks de Dados — Meta Attribution

| Hook | Arquivo | Parâmetros | Retorno | Descrição |
|------|---------|------------|---------|-----------|
| `useMetaCampaigns` | useMetaCampaigns.ts | `dateRange` | `{ campaigns, loading, refetch }` | Campanhas com conversões do pixel |
| `useMetaAdSets` | useMetaAdSets.ts | `dateRange, campaignId?` | `{ adSets, loading, refetch }` | Ad sets com conversões do pixel |
| `useMetaAds` | useMetaAds.ts | `dateRange, adSetId?` | `{ ads, loading, refetch }` | Ads com conversões do pixel |
| `useMetaCampaignsFunnel` | useMetaCampaignsFunnel.ts | `dateRange, campaignIds` | `funnelData` | Funil com dados Meta |
| `useMetaInsights` | useMetaInsights.ts | `dateRange` | `insights` | Insights agregados da Meta |

### 5.4 Hooks de Dashboard e Vendas

| Hook | Arquivo | Parâmetros | Retorno | Descrição |
|------|---------|------------|---------|-----------|
| `useDashboardMetrics` | useDashboardMetrics.ts | `dateRange, productFilter?` | `{ metrics, chartData, pieData, campaigns, products, loading, refetch }` | Métricas completas do dashboard |
| `useSales` | useSales.ts | — | `{ sales, loading, refetch, fetchAdSpend }` | Lista de vendas com detalhes |
| `useSalesByRegion` | useSalesByRegion.ts | `dateRange` | `{ regions, loading }` | Vendas agrupadas por estado (globo 3D) |

### 5.5 Hooks de Facebook

| Hook | Arquivo | Retorno | Descrição |
|------|---------|---------|-----------|
| `useFacebookConnection` | useFacebookConnection.ts | `{ connections, isConfigured, isValid, saving, saveConnection, validateConnection, deleteConnection, ... }` | CRUD de conexões Facebook |
| `useFacebookSync` | useFacebookSync.ts | `{ syncData, syncing, progress }` | Sincronização com Facebook API |

### 5.6 Hooks de Ações

| Hook | Arquivo | Retorno | Descrição |
|------|---------|---------|-----------|
| `useBudgetUpdate` | useBudgetUpdate.ts | `{ updateBudget, updating }` | Atualiza orçamento via Facebook API |
| `useCampaignStatusUpdate` | useCampaignStatusUpdate.ts | `{ updateStatus, updating }` | Altera status ACTIVE/PAUSED via Facebook API |
| `useCompanyCosts` | useCompanyCosts.ts | `{ costs, addCost, removeCost }` | CRUD custos da empresa |
| `useCheckoutIntegrations` | useCheckoutIntegrations.ts | `{ integrations, save, toggle, remove }` | CRUD integrações de checkout |
| `useSyncSchedule` | useSyncSchedule.ts | `{ schedule, update }` | Configuração de sync automático |
| `useWorkspaces` | useWorkspaces.ts | `{ workspaces, create, update, remove }` | CRUD workspaces |
| `usePlanRules` | usePlanRules.ts | `{ rules, loading }` | Regras do plano do usuário |

### 5.7 Hooks Admin

| Hook | Arquivo | Retorno | Descrição |
|------|---------|---------|-----------|
| `useAdminDashboard` | useAdminDashboard.ts | `{ stats, loading, error }` | Estatísticas do painel admin |
| `useAdminUsers` | useAdminUsers.ts | `{ users, totalCount, page, setPage, search, filters, createUser, updateUser, deleteUser, forceSync }` | CRUD de usuários |
| `useAdminUserDetail` | useAdminUserDetail.ts | `{ user, connections, integrations, campaigns, sales, syncLogs }` | Detalhes de um usuário |
| `useAdminPlans` | useAdminPlans.ts | `{ plans, update }` | Gestão de regras de planos |

### 5.8 Hooks Utilitários

| Hook | Arquivo | Descrição |
|------|---------|-----------|
| `use-mobile` | use-mobile.tsx | Detecta viewport mobile |
| `use-toast` | use-toast.ts | Sistema de toasts |
| `useFunnelData` | useFunnelData.ts | Dados de funil genérico |

---

## 6. Contexts — Estado Global

### 6.1 AuthContext

```typescript
interface User {
  id: string;           // auth.users.id
  name: string;         // profiles.name
  email: string;        // profiles.email
  role: 'admin' | 'user';  // user_roles.role
  plan: 'free' | 'starter' | 'pro' | 'enterprise' | 'unlimited';
  avatar_url?: string;
  createdAt: string;
  active: boolean;      // profiles.active
  subscription_end: string | null;
}
```

- **Inicialização:** `supabase.auth.getSession()` + `fetchUserProfile()`
- **Listener:** `supabase.auth.onAuthStateChange()` para atualizações em tempo real
- **Register:** `supabase.auth.signUp()` com `emailRedirectTo` + fire-and-forget welcome email
- **Login:** `signInWithPassword()` + retorna `{ success, isAdmin }`
- **Logout:** `signOut()` + limpa localStorage/sessionStorage

### 6.2 WorkspaceContext

```typescript
interface WorkspaceContextType {
  activeWorkspaceId: string | null;
  activeWorkspace: Workspace | null;
  workspaces: Workspace[];
  setActiveWorkspace: (id: string) => void;
  setWorkspaces: (workspaces: Workspace[]) => void;
  activeConnectionIds: string[];    // derivado de workspace_connections
  activeCheckoutIds: string[];      // derivado de workspace_checkout_integrations
}
```

- **Persistência:** `localStorage.get/set('sentinel_active_workspace')`
- **Auto-select:** Primeiro workspace se nenhum ativo
- **Derivação:** `activeConnectionIds` e `activeCheckoutIds` são computados do workspace ativo

### 6.3 ActiveConnectionContext

```typescript
interface ActiveConnectionContextType {
  activeConnectionId: string | null;   // null = "Todas as contas"
  connections: FacebookConnectionInfo[];  // filtradas pelo workspace
  allConnections: FacebookConnectionInfo[];
  setActiveConnection: (id: string | null) => void;
  activeConnection: FacebookConnectionInfo | null;
}
```

- **showAllRef:** `useRef` que impede auto-seleção quando usuário escolheu "Todas as contas"
- **Reset on user change:** Limpa ao trocar de usuário
- **Filtragem:** `allConnections.filter(c => workspaceConnectionIds.includes(c.id))`

### 6.4 ImpersonationContext

```typescript
interface ImpersonationTarget {
  userId: string;
  userName: string;
}
```

- **startImpersonation(userId, userName):** Define target
- **stopImpersonation():** Limpa target
- **getEffectiveUserId(realUserId):** Retorna target.userId ou realUserId

### 6.5 RefetchContext

- **refetchSignal:** Número que incrementa para triggerar re-fetch nos hooks
- **triggerRefetch():** Incrementa signal

---

## 7. Banco de Dados

### 7.1 Arquitetura Dual

| Banco | Projeto | Uso |
|-------|---------|-----|
| **Supabase Externo** | `picgyetvkjymfrgsjozt` | Auth, profiles, campaigns, ads, sales, facebook_connections, checkout_integrations |
| **Lovable Cloud** | `obmkhvzargmcgndaioxb` | plan_rules, workspaces, workspace_connections, workspace_checkout_integrations, company_costs, welcome_emails_sent |

### 7.2 Schema Supabase Externo

```sql
-- profiles (user data)
profiles (id, user_id, name, email, cpf, avatar_url, plan, active, 
          subscription_start, subscription_end, created_at, updated_at)
  CONSTRAINT profiles_plan_check: plan IN ('free','starter','pro','enterprise','unlimited')

-- RBAC
user_roles (id, user_id, role::app_role, created_at)
  UNIQUE (user_id, role)

-- Facebook Ads hierarchy
campaigns (id, user_id, facebook_campaign_id, facebook_connection_id, name, status, 
           objective, spend, impressions, clicks, conversions, cpc, cpm, ctr,
           daily_budget, lifetime_budget, date_start, date_end, synced_at)

ad_sets (id, campaign_id→campaigns, user_id, facebook_adset_id, name, status,
         spend, impressions, clicks, conversions, cpc, cpm, ctr, date_start, date_end, synced_at)

ads (id, ad_set_id→ad_sets, user_id, facebook_ad_id, name, status,
     spend, impressions, clicks, conversions, cpc, cpm, ctr, date_start, date_end, synced_at)

-- Daily spend granular
daily_ad_spend (id, user_id, campaign_id→campaigns, facebook_adset_id, facebook_ad_id,
                facebook_connection_id, date, spend, impressions, clicks, link_clicks, cpc, cpm, ctr)
  UNIQUE (campaign_id, facebook_ad_id, date)

-- Sales from webhooks
sales (id, user_id, campaign_id→campaigns, ad_set_id→ad_sets, ad_internal_id→ads,
       checkout_integration_id, checkout_platform, amount, product_name,
       customer_name, customer_email, customer_phone, customer_document,
       status, payment_method, currency, utm_source, utm_medium, utm_campaign,
       utm_content, utm_term, ad_id, external_id, state, sold_at, created_at)

-- Facebook credentials (encrypted)
facebook_connections (id, user_id, app_id[enc], app_secret[enc], access_token[enc],
                      ad_account_id, is_valid, last_validated_at, created_at, updated_at)

-- Checkout integrations
checkout_integrations (id, user_id, platform, webhook_secret, is_active, last_webhook_at)

-- Sync scheduling
sync_schedules (id, user_id, is_active, interval_minutes, last_sync_at, last_sync_status, last_sync_error)

-- Sync history
sync_logs (id, user_id, started_at, duration_ms, status, campaigns_synced, ad_sets_synced, ads_synced, error_message)

-- Async job tracking
processing_jobs (id, user_id, status, progress, result, error_message, created_at, updated_at)
```

### 7.3 Schema Lovable Cloud

```sql
plan_rules (id, plan, max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts,
            max_workspaces, sync_interval_minutes, feature_sales_globe, feature_advanced_reports,
            feature_conversion_funnel, feature_auto_sync, feature_api_access, created_at, updated_at)

workspaces (id, user_id, name, created_at, updated_at)

workspace_connections (id, workspace_id→workspaces, facebook_connection_id, created_at)

workspace_checkout_integrations (id, workspace_id→workspaces, checkout_integration_id, created_at)

company_costs (id, user_id, name, type, value, created_at)

welcome_emails_sent (id, email, sent_at)
```

### 7.4 RLS Resumo

| Tabela | Regra |
|--------|-------|
| profiles | user vê/edita próprio; admin vê todos |
| user_roles | user vê próprio; admin CRUD todos |
| campaigns, ad_sets, ads, daily_ad_spend | user CRUD próprio |
| sales | user SELECT/INSERT/UPDATE próprio |
| facebook_connections, checkout_integrations, sync_schedules, sync_logs | user CRUD próprio |
| workspaces | user CRUD próprio |
| workspace_connections, workspace_checkout_integrations | via ownership do workspace |
| plan_rules | authenticated SELECT; admin ALL |
| company_costs | user CRUD próprio |

### 7.5 Triggers

| Trigger | Tabela | Descrição |
|---------|--------|-----------|
| handle_new_user | auth.users | Cria profile + user_role 'user' |
| update_updated_at_column | várias | Atualiza updated_at automaticamente |
| update_plan_rules_updated_at | plan_rules | Atualiza updated_at (Lovable Cloud) |

---

## 8. Edge Functions — API Backend

### 8.1 Catálogo Completo (22 funções)

| Função | Actions/Métodos | Auth | Descrição |
|--------|-----------------|------|-----------|
| `fetch-meta-insights` | validate, insights, campaigns, sync, check_job | JWT Externo | Integração Facebook Graph API v22.0 |
| `manage-facebook-connection` | save, get, delete, validate, list-accounts, list-accounts-from-connection, save-multiple, update-token, migrate | JWT Externo | CRUD conexões Facebook (multi-conta) |
| `manage-workspaces` | list, create, update, delete | JWT Externo | CRUD áreas de trabalho |
| `manage-plan-rules` | list, update | JWT Cloud | CRUD regras de planos |
| `admin-users` | stats, list, get, create, update, delete, force-sync | JWT Externo + Admin | CRUD de usuários |
| `admin-proxy` | proxy | JWT Externo + Admin | Proxy para impersonificação |
| `auto-sync` | — | Service Role | Sincronização automática agendada |
| `update-budget` | — | JWT Externo | Altera orçamento via Facebook API |
| `update-campaign-status` | — | JWT Externo | Altera status ACTIVE/PAUSED |
| `rematch-sales` | — | JWT Externo | Re-atribui vendas a anúncios |
| `send-welcome-email` | — | Anon | Email de boas-vindas (Resend) |
| `webhook-n8n-profiles` | — | Webhook | Sync de perfis via N8N |
| `webhook-hotmart` | — | Webhook | Vendas Hotmart |
| `webhook-kiwify` | — | Webhook | Vendas Kiwify |
| `webhook-kirvano` | — | Webhook | Vendas Kirvano |
| `webhook-guru` | — | Webhook | Vendas Guru Digital |
| `webhook-perfectpay` | — | Webhook | Vendas Perfect Pay |
| `webhook-ticto` | — | Webhook | Vendas Ticto |
| `webhook-payt` | — | Webhook | Vendas PayT |
| `webhook-cakto` | — | Webhook | Vendas Cakto |
| `webhook-balaclava` | — | Webhook | Vendas Balaclava |

### 8.2 Módulos Compartilhados (_shared/)

| Módulo | Descrição |
|--------|-----------|
| `match-sale-to-ads.ts` | Extrai ad_id das UTMs → busca ads.facebook_ad_id → resolve hierarquia |
| `ddd-to-state.ts` | DDD telefônico → UF brasileiro |
| `normalize-state.ts` | Normaliza nomes/siglas de estados |
| `encryption.ts` | AES encrypt/decrypt, formato `iv:ciphertext`, `decryptIfNeeded` |
| `extract-webhook-token.ts` | Extrai token de auth de diferentes formatos de webhook |
| `currency.ts` | Conversão e formatação de moedas |

### 8.3 Secrets Configurados

| Secret | Descrição |
|--------|-----------|
| `EXTERNAL_SUPABASE_URL` | URL do Supabase externo |
| `EXTERNAL_SUPABASE_ANON_KEY` | Chave anon externa |
| `EXTERNAL_SUPABASE_SERVICE_ROLE_KEY` | Service role externa |
| `ENCRYPTION_KEY` | Chave AES para credenciais |
| `RESEND_API_KEY` | API key do Resend (emails) |
| `LOVABLE_API_KEY` | Gateway AI Lovable |
| `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` | Cloud (automáticos) |

---

*Documento atualizado em 2026-02-18. Versão 3.0 — Documentação Técnica Completa*
