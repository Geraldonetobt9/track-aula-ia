# Painel Administrativo (Admin Dashboard)

> **Modulo:** `packages/backend/src/modules/admin/admin.service.ts` | **Pagina:** `src/pages/admin/AdminDashboard.tsx`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

O painel administrativo fornece uma visao geral consolidada de toda a plataforma Sentinela para administradores. Exibe metricas-chave como total de usuarios, novos usuarios, conexoes ativas do Facebook, total de campanhas, vendas e receita. Inclui graficos de evolucao de novos usuarios (ultimos 30 dias) e distribuicao por plano, alem de tabelas com usuarios recentes e erros de sincronizacao. E a pagina inicial da area administrativa e permite ao admin navegar rapidamente para detalhes de usuarios ou investigar problemas de sync.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar Admin `/admin` | Link "Dashboard" na area administrativa |
| Apos login de admin | Pagina padrao para usuarios com role `admin` |

### 2.2 Fluxo de UI

1. Admin acessa `/admin` ou clica em "Dashboard" no menu administrativo.
2. O hook `useAdminDashboard` busca estatisticas via `GET /api/admin/stats`.
3. **Cards de metricas** sao exibidos no topo (componente `AdminStatsCards`):
   - Total de Usuarios
   - Novos Usuarios (ultimos 7 dias)
   - Conexoes Facebook Ativas
   - Total de Campanhas
   - Total de Vendas
   - Receita Total (soma de vendas aprovadas)
4. **Grafico de barras "Novos Usuarios"** exibe novos cadastros por dia nos ultimos 30 dias, usando Recharts (`BarChart`, `Bar`, `XAxis`, `YAxis`, `CartesianGrid`, `Tooltip`).
5. **Grafico donut "Distribuicao por Plano"** exibe quantidade de usuarios por plano (starter, pro, enterprise) usando Recharts (`PieChart`, `Pie`, `Cell`, `Legend`). Cores: starter=branco 25%, pro=#d1fe17 (verde primario), enterprise=branco 50%.
6. **Tabela "Usuarios Recentes"** lista os 10 usuarios mais recentes com colunas: nome, email, plano, status do Facebook, data de criacao. Clicar em um usuario navega para `/admin/users/:userId`.
7. **Tabela "Erros de Sincronizacao"** lista ate 10 usuarios com erros de sync, exibindo nome, email, mensagem de erro e data do ultimo sync.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Acessar dashboard admin | Somente role `admin` |
| Visualizar dados de todos os usuarios | Somente role `admin` |
| Navegar para detalhe de usuario | Somente role `admin` |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Total de usuarios | COUNT em `profiles` | Exibe contagem total de usuarios cadastrados |
| RN-02 | Novos usuarios 7d | COUNT em `profiles` WHERE `created_at >= 7 dias atras` | Exibe quantidade de novos cadastros na semana |
| RN-03 | Conexoes Facebook ativas | COUNT em `facebook_connections` WHERE `is_valid=true` | Exibe total de conexoes validas |
| RN-04 | Total de campanhas | COUNT em `campaigns` | Exibe total de campanhas de todos os usuarios |
| RN-05 | Total de vendas | COUNT em `sales` | Exibe total de vendas de todos os usuarios |
| RN-06 | Receita total | SUM de `amount` em `sales` WHERE `status='approved'` | Soma apenas vendas aprovadas |
| RN-07 | Usuarios por plano | GROUP BY em `profiles.plan_id -> plan_rules.plan` | Agrupa: free, starter, pro, enterprise (default `starter`) |
| RN-08 | Novos por dia | `profiles.created_at` agrupado por data (30 dias) | Cada entrada: `{ date: 'YYYY-MM-DD', count: N }` |
| RN-09 | Usuarios recentes | TOP 10 `profiles` ORDER BY `created_at DESC` | Enriquecidos com status Facebook (connected/expired/null) |
| RN-10 | Erros de sync | `sync_schedules` WHERE `last_sync_status='error'` LIMIT 10 | Enriquecidos com nome e email do usuario |
| RN-11 | Usuarios ativos 30d | `auth.users` WHERE `last_sign_in_at > 30 dias atras` | Contagem de usuarios que fizeram login nos ultimos 30 dias |
| RN-12 | Status Facebook enriquecido | Para cada usuario recente | `true` se alguma conexao valida, `false` se todas invalidas, `null` se sem conexoes |

---

## 4. Modelo de Dados

### 4.1 Tabelas Consultadas

O dashboard admin nao possui tabela propria. Ele agrega dados das seguintes tabelas:

| Tabela | Dados Extraidos |
|---|---|
| `profiles` | Total usuarios, novos usuarios, distribuicao por plano, usuarios recentes |
| `facebook_connections` | Conexoes ativas, status Facebook de cada usuario |
| `campaigns` | Total de campanhas |
| `sales` | Total de vendas, receita total |
| `checkout_integrations` | Integracoes de checkout ativas |
| `sync_schedules` | Erros de sincronizacao |
| `auth.users` (Admin API) | Ultimo login, usuarios ativos 30 dias |
| `plan_rules` | Nome do plano (via join em profiles.plan_id) |

### 4.2 Relacionamentos

```
profiles.plan_id          -> plan_rules(id)
profiles.user_id          -> auth.users(id)
facebook_connections.user_id -> auth.users(id)
sync_schedules.user_id    -> auth.users(id)
```

### 4.3 Constraints e Defaults

- Todas as contagens usam `{ count: 'exact', head: true }` para eficiencia
- Receita total filtra `status='approved'` para nao incluir reembolsos

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/admin/stats` | JWT + Admin | Retorna todas as estatisticas do dashboard |

### 5.2 Logica do Service

**AdminService.getStats()**

Faz uma unica chamada `rpc('admin_dashboard_stats')` (Postgres function `public.admin_dashboard_stats`, migration `20260502100000_admin_dashboard_stats_rpc.sql`). Toda a agregacao acontece no banco em uma round-trip:

1. `total_users`, `new_users_7d`, `facebook_connections_active`, `total_campaigns`, `total_sales`, `checkout_integrations_active` via `COUNT(*)`.
2. `total_revenue` via `SUM(amount)` em `sales WHERE status='approved' AND blocked_by_limit=false` (substitui o `reduce()` em Node, que era silenciosamente truncado pelo cap de 1000 linhas do PostgREST).
3. `active_users_30d` via `COUNT(*) FROM auth.users WHERE last_sign_in_at >= now() - interval '30 days'` (substitui `auth.admin.listUsers({ perPage: 1000 })`, que parava de contar acima de 1000 usuarios).
4. `users_by_plan` via `LEFT JOIN plan_rules` + `jsonb_object_agg`, garantindo entrada para todo plano cadastrado (mesmo com count=0).
5. `new_users_by_day` via `GROUP BY date_trunc('day', created_at)` nos ultimos 30 dias.
6. `recent_users` (10 mais recentes) com `LATERAL` para deriver `facebook_connected` (`bool_or(is_valid)` ou `null` se nao houver conexao).
7. `users_with_sync_errors` (10) com `LEFT JOIN profiles` para nome/email.

A funcao roda como `STABLE`, com `EXECUTE` concedido apenas a `service_role`.

**Retorno (somente o que a tela consome):**

```typescript
{
  total_users: number,
  active_users_30d: number,
  new_users_7d: number,
  facebook_connections_active: number,
  total_campaigns: number,
  total_sales: number,
  total_revenue: number,
  checkout_integrations_active: number,
  users_by_plan: Record<string, number>,
  new_users_by_day: Array<{ date: string, count: number }>,
  recent_users: Array<{
    id: string,
    user_id: string,
    name: string | null,
    email: string | null,
    plan: string | null,
    created_at: string,
    facebook_connected: boolean | null,
  }>,
  users_with_sync_errors: Array<{
    user_id: string,
    name: string | null,
    email: string | null,
    last_sync_error: string | null,
    last_sync_at: string | null,
  }>,
}
```

Campos como `avatar_url`, `cpf`, `role`, `ad_account_id`, `campaigns_count`, `sales_count`, `total_revenue` em `recent_users[]` foram removidos do payload — eles nao eram lidos pela tela (eram parte do tipo `AdminUser` herdado pela list page).

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| AdminDashboard | `src/pages/admin/AdminDashboard.tsx` | Pagina principal do painel admin |
| AdminStatsCards | `src/components/admin/AdminStatsCards.tsx` | Cards de metricas agregadas |
| BarChart (Recharts) | lib externa | Grafico de novos usuarios por dia |
| PieChart (Recharts) | lib externa | Grafico donut de distribuicao por plano |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useAdminDashboard` | `src/hooks/useAdminDashboard.ts` | `{ stats, loading, error, refetch }` |

**useAdminDashboard:**
- Busca `GET /api/admin/stats` via TanStack Query.
- Cache key: `['admin-stats']`.
- `staleTime`: 5 minutos (300.000ms) - dados nao sao re-buscados dentro deste intervalo.
- Retorna `stats` tipado como `AdminStats`, `loading`, `error` (string ou null) e `refetch`.

### 6.3 Gerenciamento de Estado

| Estado | Tipo | Descricao |
|---|---|---|
| `stats` | AdminStats | Objeto com todas as estatisticas |
| `loading` | boolean | Indica carregamento |
| `error` | string ou null | Mensagem de erro |

**Cache key:** `['admin-stats']`

Cores dos planos no grafico donut:
- starter: `rgba(255,255,255,0.25)`
- pro: `#d1fe17`
- enterprise: `rgba(255,255,255,0.5)`

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| profiles | Leitura | Dados de usuarios, contagens, distribuicao por plano |
| facebook_connections | Leitura | Status de conexoes Facebook |
| campaigns | Leitura | Contagem total de campanhas |
| sales | Leitura | Contagem e receita |
| sync_schedules | Leitura | Erros de sincronizacao |
| auth.users (Admin API) | Leitura | Ultimo login e contagem de ativos |
| AdminUsers (navegacao) | Link | Clicar em usuario navega para detalhe |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Erro na API | Exibe mensagem "Erro ao carregar dados: {error}" centralizada |
| Nenhum usuario cadastrado | Cards exibem zero; graficos exibem estado vazio |
| Nenhum erro de sync | Tabela de erros exibe estado vazio ou nao e renderizada |
| Plano novo cadastrado em `plan_rules` | Aparece em `users_by_plan` mesmo com 0 usuarios (LEFT JOIN) |
| Usuario sem facebook_connections | `facebook_connected = null` no enriquecimento |
| Muitos usuarios | Sem mais cap de 1000: `active_users_30d` e `total_revenue` agora sao agregados em SQL e refletem a base completa |

---

## 9. Checklist de Testes

- [ ] Verificar que cards de metricas exibem valores corretos
- [ ] Confirmar que total de usuarios conta todos os profiles
- [ ] Testar que novos usuarios 7d filtra corretamente pela data
- [ ] Verificar que receita total soma apenas vendas aprovadas
- [ ] Testar grafico de novos usuarios por dia com dados variados
- [ ] Testar grafico de distribuicao por plano com todos os planos
- [ ] Verificar que tabela de usuarios recentes lista 10 usuarios
- [ ] Confirmar enriquecimento de status Facebook nos usuarios recentes
- [ ] Testar tabela de erros de sync com dados reais
- [ ] Verificar navegacao ao clicar em usuario na tabela
- [ ] Testar staleTime de 5 minutos (dados nao re-buscados dentro do intervalo)
- [ ] Confirmar que somente admins acessam a pagina

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Filtro temporal no dashboard | Nao ha seletor de periodo; dados sao fixos (7d, 30d). Considerar adicionar filtro |
| Q02 | Cache HTTP de `/admin/stats` | A query roda em < 50ms mas e disparada a cada navegacao. Avaliar `Cache-Control: s-maxage=60` ja que os dados sao globais (nao dependem de `Authorization`) — porem a rota esta protegida por AdminGuard, o que excluiria do cache do CDN. |
| Q03 | View materializada para `total_revenue` | Se o crescimento de `sales` tornar o `SUM` lento, considerar matview com refresh agendado (a query atual ainda escaneia toda a tabela `sales`). |
