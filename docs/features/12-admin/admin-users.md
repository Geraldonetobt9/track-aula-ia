# Gerenciamento de Usuarios (Admin Users)

> **Modulo:** `packages/backend/src/modules/admin/admin.service.ts` | **Pagina:** `src/pages/admin/AdminUsers.tsx`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

A pagina de gerenciamento de usuarios permite aos administradores listar, buscar, filtrar, criar, editar, excluir e forcar sincronizacao de usuarios na plataforma Sentinela. E a principal ferramenta administrativa para gestao de contas, oferecendo visao completa de cada usuario com informacoes de plano, role, status do Facebook, contagem de campanhas, vendas e receita. Suporta paginacao server-side e filtros combinados por plano, role e status de conexao Facebook.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar Admin `/admin/users` | Link "Usuarios" na area administrativa |
| Dashboard Admin | Clicar em usuario na tabela de recentes navega para detalhe |

### 2.2 Fluxo de UI

1. Admin acessa `/admin/users`.
2. O hook `useAdminUsers` busca a lista paginada via `GET /api/admin/users`.
3. Barra de busca permite filtrar por nome ou email (busca `ilike`).
4. Dropdowns de filtro:
   - **Plano**: free, starter, pro, enterprise, unlimited
   - **Role**: user, admin
   - **Status Facebook**: connected, expired, not_configured
5. Tabela exibe usuarios com colunas: nome, email, plano, role, status Facebook, campanhas, vendas, receita, ultimo login, data de criacao.
6. Paginacao server-side com 20 usuarios por pagina.
7. Acoes disponiveis:
   - **Criar usuario**: formulario com email, senha, plano, role e email de boas-vindas opcional.
   - **Editar usuario**: atualizar nome, plano, role, CPF, datas de assinatura.
   - **Excluir usuario**: confirmacao antes de excluir (CASCADE remove dados relacionados).
   - **Force sync**: agenda sincronizacao imediata para o usuario.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Listar usuarios | Somente admin |
| Criar usuario | Somente admin |
| Editar usuario | Somente admin |
| Excluir usuario | Somente admin (nao pode excluir a si mesmo) |
| Force sync | Somente admin |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Busca por nome/email | `search` nao vazio | RPC aplica `name ILIKE %search% OR email ILIKE %search%` |
| RN-02 | Filtro por plano | `plan` especificado | RPC compara `plan_rules.plan = p_plan` no WHERE pre-paginacao |
| RN-03 | Filtro por role | `role` especificado | RPC compara `COALESCE(user_roles.role, 'user') = p_role` no WHERE pre-paginacao (corrigido em 2026-05-02 — antes era pos-query e quebrava `total_count`) |
| RN-04 | Filtro por Facebook | `facebook_status` especificado | RPC deriva `facebook_connected` via LATERAL e filtra no WHERE: `connected`=alguma conexao valida; `expired`=todas invalidas; `not_configured`=sem conexoes |
| RN-05 | Paginacao | `page` e `limit` (default 1 e 20) | RPC aplica `LIMIT/OFFSET` apos todos os filtros; `total_count` reflete a base completamente filtrada |
| RN-06 | Ordenacao | Sempre por `created_at DESC, id DESC` | Usuarios mais recentes primeiro |
| RN-07 | Criar usuario | name, email, password obrigatorios | Cria via `auth.admin.createUser()` com `email_confirm: true` |
| RN-08 | CPF unico | `cpf` fornecido na criacao/edicao | Verifica unicidade antes de inserir; erro "Ja existe um usuario cadastrado com este CPF" |
| RN-09 | Role admin na criacao | `role = 'admin'` | Atualiza `user_roles` para `admin` apos criacao |
| RN-10 | Plano na criacao | `plan != 'starter'` | Busca `plan_rules.id` pelo nome do plano e atualiza `profiles.plan_id` |
| RN-11 | Auto-exclusao proibida | `userId === callerUserId` | `ForbiddenException` com mensagem "Nao e possivel excluir sua propria conta" |
| RN-12 | Exclusao em cascata | DELETE via Admin API | `auth.admin.deleteUser(userId)` aciona CASCADE nas tabelas relacionadas |
| RN-13 | Force sync | Conexao Facebook valida necessaria | Atualiza `sync_schedules.next_sync_at = now()` e `last_sync_status = 'pending'` |
| RN-14 | Force sync sem conexao | Nenhuma conexao encontrada | `NotFoundException` com mensagem "Facebook connection not found" |
| RN-15 | Force sync conexao invalida | `is_valid = false` | `BadRequestException` com mensagem "Facebook connection is invalid" |
| RN-16 | Enriquecimento de dados | Para cada usuario na lista | Busca role, Facebook status, contagem de campanhas, vendas e receita |
| RN-17 | Trigger de perfil | Criacao de usuario | O trigger `handle_new_user` cria profile e role automaticamente; service aguarda 500ms antes de atualizar |

---

## 4. Modelo de Dados

### 4.1 Tabelas Principais

O gerenciamento de usuarios consulta e modifica as seguintes tabelas:

| Tabela | Operacao | Descricao |
|---|---|---|
| `profiles` | CRUD | Dados do perfil do usuario |
| `user_roles` | READ/UPDATE | Role do usuario (user/admin) |
| `facebook_connections` | READ | Status de conexao Facebook |
| `campaigns` | READ (count) | Contagem de campanhas |
| `sales` | READ (count + sum) | Contagem de vendas e receita |
| `sync_schedules` | UPDATE | Force sync atualiza agendamento |
| `auth.users` | CRUD | Criacao/exclusao via Admin API |

### 4.2 Relacionamentos

```
profiles.user_id          -> auth.users(id) ON DELETE CASCADE
user_roles.user_id        -> auth.users(id) ON DELETE CASCADE
facebook_connections.user_id -> auth.users(id) ON DELETE CASCADE
campaigns.user_id         -> auth.users(id) ON DELETE CASCADE
sales.user_id             -> auth.users(id) ON DELETE CASCADE
sync_schedules.user_id    -> auth.users(id) ON DELETE CASCADE
```

### 4.3 Constraints e Defaults

- Exclusao via `auth.admin.deleteUser` aciona CASCADE em todas as tabelas com FK para `auth.users`
- `user_roles.role` default `user`
- Unicidade de `cpf` em `profiles` (validada no service, nao via constraint SQL)

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/admin/users` | JWT + Admin | Lista usuarios com filtros e paginacao |
| POST | `/api/admin/users` | JWT + Admin | Cria novo usuario |
| PATCH | `/api/admin/users/:userId` | JWT + Admin | Atualiza dados do usuario |
| DELETE | `/api/admin/users/:userId` | JWT + Admin | Exclui usuario |
| POST | `/api/admin/users/:userId/force-sync` | JWT + Admin | Forca sincronizacao |

### 5.2 Logica do Service

**AdminService.listUsers(filters)**

Parametros: `page` (default 1), `limit` (default 20), `search`, `plan`, `role`, `facebook_status`.

Faz uma unica chamada `rpc('admin_list_users', ...)` (Postgres function `public.admin_list_users`, migration `20260502120000_admin_list_users_rpc.sql`). A funcao roda como `STABLE SECURITY DEFINER` e retorna o jsonb final ja paginado:

1. CTE `filtered`: junta `profiles` ↔ `plan_rules` ↔ `user_roles` e deriva `facebook_connected` via LATERAL (`bool_or(is_valid)` ou `NULL`). Aplica TODOS os filtros (search, plan, role, facebook_status) no WHERE.
2. CTE `paged`: aplica `ORDER BY created_at DESC, id DESC` + `LIMIT/OFFSET`.
3. CTE `enriched`: somente para as linhas paginadas, agrega via LATERAL `campaigns_count`, `sales_count`, `total_revenue` e faz `LEFT JOIN auth.users` para `last_sign_in_at`.
4. `total_count` e calculado a partir de `filtered` (refletindo todos os filtros).

**Retorno (somente o que a tela consome):**

```typescript
{
  users: Array<{
    id: string,
    user_id: string,
    name: string | null,
    email: string | null,
    avatar_url: string | null,
    cpf: string | null,
    plan: string | null,
    role: 'admin' | 'user',
    facebook_connected: boolean | null,
    campaigns_count: number,
    sales_count: number,
    total_revenue: number,
    subscription_start: string | null,
    subscription_end: string | null,
    last_sign_in_at: string | null,
  }>,
  total_count: number,
  page: number,
  total_pages: number,
}
```

Campos `cnpj`, `ad_account_id`, `plan_id`, `created_at` e `next_cursor` foram removidos do payload — nenhum deles era lido pela tabela ou pelos modais (`/admin/users/:id` continua tendo seu proprio endpoint que mantem `created_at` e demais detalhes).

Bugs corrigidos pela migracao para o RPC:

* `auth.admin.listUsers({ perPage: 1000 })` capava `last_sign_in_at` aos primeiros 1000 usuarios.
* `campaigns_count`, `sales_count` e `total_revenue` eram somados em Node a partir de result sets que o PostgREST trunca em 1000 linhas — qualquer usuario com >1000 campanhas ou >1000 vendas aprovadas tinha numeros silenciosamente errados.
* Os filtros `role` e `facebook_status` eram aplicados pos-paginacao em JS, deixando `total_count` errado e paginas curtas/vazias.
* As agregacoes de campanhas/vendas rodavam para todos os 20 usuarios da pagina mesmo quando os filtros pos-paginacao iam descartar parte deles. Agora rodam somente para os usuarios que sobrevivem aos filtros.

**AdminService.createUser(data)**

1. Valida campos obrigatorios: name, email, password.
2. Verifica unicidade do CPF (se fornecido).
3. Cria usuario via `auth.admin.createUser()` com `email_confirm: true`.
4. Aguarda 500ms para trigger `handle_new_user` criar profile e role.
5. Se `role = 'admin'`, atualiza `user_roles`.
6. Se `plan != 'starter'`, busca `plan_rules.id` e atualiza `profiles.plan_id`.
7. Atualiza CPF e datas de assinatura se fornecidos.

**AdminService.updateUser(userId, data)**

1. Verifica unicidade do CPF (excluindo usuario atual).
2. Atualiza `profiles`: name, plan_id (via lookup), cpf, subscription_start, subscription_end.
3. Atualiza `user_roles.role` se role fornecido.

**AdminService.deleteUser(userId, callerUserId)**

1. Verifica auto-exclusao: `userId === callerUserId` lanca `ForbiddenException`.
2. Executa `auth.admin.deleteUser(userId)` que aciona CASCADE.

**AdminService.forceSync(userId)**

1. Busca `facebook_connections` do usuario.
2. Valida que conexao existe e `is_valid = true`.
3. Atualiza `sync_schedules`: `next_sync_at = now()`, `last_sync_status = 'pending'`.

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| AdminUsers | `src/pages/admin/AdminUsers.tsx` | Pagina de listagem e gestao de usuarios |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useAdminUsers` | `src/hooks/useAdminUsers.ts` | `{ users, totalCount, loading, error, page, setPage, totalPages, search, setSearch, planFilter, setPlanFilter, roleFilter, setRoleFilter, facebookStatusFilter, setFacebookStatusFilter, createUser, updateUser, deleteUser, forceSync, isCreating, isUpdating, isDeleting, refetch }` |

**useAdminUsers:**
- Cache key: `['admin-users', page, search, planFilter, roleFilter, facebookStatusFilter]`.
- Mutations com invalidacao automatica de caches:
  - `createUser`: invalida `admin-users` e `admin-stats`.
  - `updateUser`: invalida `admin-users` e `admin-user-detail`.
  - `deleteUser`: invalida `admin-users` e `admin-stats`.
  - `forceSync`: toast de sucesso/erro sem invalidacao de cache.
- Todos os mutations exibem toasts de sucesso ou erro.
- Estados de loading por operacao: `isCreating`, `isUpdating`, `isDeleting`.

### 6.3 Gerenciamento de Estado

| Estado | Tipo | Descricao |
|---|---|---|
| `page` | number | Pagina atual (default 1) |
| `search` | string | Texto de busca |
| `planFilter` | string ou null | Filtro de plano selecionado |
| `roleFilter` | string ou null | Filtro de role selecionado |
| `facebookStatusFilter` | string ou null | Filtro de status Facebook |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| auth.admin API (Supabase) | CRUD | Criacao e exclusao de usuarios |
| profiles | Leitura/Escrita | Dados de perfil |
| user_roles | Leitura/Escrita | Roles de usuario |
| facebook_connections | Leitura | Status de conexao |
| sync_schedules | Escrita | Force sync |
| AdminUserDetail | Navegacao | Link para pagina de detalhe |
| AdminDashboard | Cache | Invalidacao de `admin-stats` ao criar/excluir |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Busca sem resultados | Tabela exibe estado vazio |
| Tentativa de auto-exclusao | `ForbiddenException` "Nao e possivel excluir sua propria conta" |
| CPF duplicado | `BadRequestException` "Ja existe um usuario cadastrado com este CPF" |
| Email ja cadastrado | Erro retornado pela Supabase Admin API |
| Force sync sem conexao Facebook | `NotFoundException` "Facebook connection not found" |
| Force sync com conexao invalida | `BadRequestException` "Facebook connection is invalid" |
| Campos obrigatorios ausentes na criacao | `BadRequestException` "Name, email, and password are required" |
| Trigger de perfil nao executou | O service aguarda 500ms; se trigger falhar, profile pode nao existir |

---

## 9. Checklist de Testes

- [ ] Verificar listagem de usuarios com paginacao de 20 por pagina
- [ ] Testar busca por nome (parcial, case-insensitive)
- [ ] Testar busca por email (parcial, case-insensitive)
- [ ] Testar filtro por plano (starter, pro, enterprise)
- [ ] Testar filtro por role (user, admin)
- [ ] Testar filtro por status Facebook (connected, expired, not_configured)
- [ ] Testar combinacao de multiplos filtros simultaneos
- [ ] Verificar criacao de usuario com campos obrigatorios
- [ ] Testar criacao com role admin e verificar user_roles
- [ ] Testar criacao com plano diferente de starter
- [ ] Testar validacao de CPF unico na criacao
- [ ] Testar atualizacao de nome, plano e role
- [ ] Testar validacao de CPF unico na edicao
- [ ] Verificar que auto-exclusao e bloqueada
- [ ] Testar exclusao de usuario e cascata de dados
- [ ] Testar force sync com conexao valida
- [ ] Testar force sync sem conexao Facebook
- [ ] Testar force sync com conexao invalida
- [ ] Verificar invalidacao de caches apos criar/editar/excluir
- [ ] Testar toasts de sucesso e erro para cada operacao

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Welcome email | O campo de email de boas-vindas na criacao nao esta implementado |
| Q02 | Auditoria de acoes | Nao ha log de auditoria para acoes administrativas (criar, editar, excluir) |
| Q03 | Custo das LATERAL agregadas | Para a base completa filtrada (CTE `filtered`), a derivacao de `facebook_connected` faz 1 lookup por profile. Em escala (>>50K profiles), avaliar precomputar uma view materializada ou coluna em `profiles` |
