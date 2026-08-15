# Workspaces (Areas)

## 1. Proposito

Permitir que cada usuario organize seus dados em areas de trabalho isoladas (workspaces). Cada workspace agrupa conexoes do Facebook, integracoes de checkout e produtos, garantindo que metricas e dashboards exibam apenas dados relevantes a area ativa. Isso suporta cenarios de multiplos produtos, negocios ou clientes sob uma unica conta.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Local                | Componente           | Descricao                                       |
|----------------------|----------------------|-------------------------------------------------|
| Sidebar              | WorkspaceSwitcher    | Dropdown de selecao + botao "Nova area"         |
| Dashboard header     | WorkspaceSwitcher    | Versao inline com selecao, rename e delete      |
| Integracoes          | Pagina Integrations  | Associacao de conexoes e checkouts ao workspace  |

### 2.2 Fluxo de UI

**Criar workspace:**
1. Usuario clica em "Nova area" no WorkspaceSwitcher (sidebar ou inline)
2. Aparece campo de input inline com placeholder "Nome da area"
3. Digita o nome e pressiona Enter ou clica no icone "+"
4. `useWorkspaces.createWorkspace(name)` faz POST para `/api/workspaces`
5. Workspace criado e automaticamente selecionado como ativo
6. Toast "Area criada com sucesso"

**Selecionar workspace:**
1. Dropdown Select exibe todas as areas do usuario
2. Ao selecionar, `setActiveWorkspace(id)` atualiza o contexto
3. `localStorage('sentinel_active_workspace', id)` persiste a selecao
4. Todos os hooks de dados (metricas, campanhas, vendas) recarregam automaticamente

**Renomear workspace:**
1. Usuario clica no icone de lapis ao lado do dropdown (variante inline)
2. Campo de edicao aparece com o nome atual pre-preenchido
3. Edita e pressiona Enter ou clica no check
4. `useWorkspaces.updateWorkspace(id, name)` faz PATCH para `/api/workspaces/:id`

**Excluir workspace:**
1. Usuario clica no icone de lixeira
2. AlertDialog de confirmacao: "Excluir area 'Nome'? Todas as conexoes associadas serao removidas."
3. Ao confirmar, `useWorkspaces.deleteWorkspace(id)` faz DELETE para `/api/workspaces/:id`
4. Toast "Area excluida"
5. Proximo workspace da lista e selecionado automaticamente

**Associar conexoes/checkouts:**
1. Na pagina de Integracoes, usuario associa Facebook connections e checkout integrations ao workspace ativo
2. `addConnection(workspaceId, facebookConnectionId)` e `addCheckout(workspaceId, checkoutIntegrationId)`
3. Remocao via `removeConnection` e `removeCheckout`

**Mapear produtos:**
1. Na pagina de Integracoes, usuario seleciona quais produtos pertencem ao workspace
2. `setProducts(workspaceId, productNames[])` faz PATCH para `/api/workspaces/:id/products`
3. Substitui todos os produtos mapeados (delete + insert)

### 2.3 Permissoes

| Acao                        | Permissao Necessaria          |
|-----------------------------|-------------------------------|
| Criar workspace             | Usuario autenticado (respeitando limite do plano) |
| Listar workspaces           | Usuario autenticado (ve apenas os seus) |
| Atualizar workspace         | Dono do workspace             |
| Excluir workspace           | Dono do workspace             |
| Associar conexoes/checkouts | Dono do workspace             |
| Listar workspaces de outro  | Admin (via target_user_id)    |

---

## 3. Regras de Negocio

| #  | Regra                                    | Condicao                                          | Resultado Esperado                                       |
|----|------------------------------------------|---------------------------------------------------|----------------------------------------------------------|
| 1  | Limite de workspaces por plano           | `workspaces.length >= max_workspaces`              | Botao "Nova area" oculto; usuario nao pode criar mais    |
| 2  | Nome obrigatorio                         | `name` vazio no create/update                      | HTTP 400 BadRequestException                             |
| 3  | Isolamento de dados                      | Workspace ativo                                    | Metricas, campanhas e vendas filtradas por conexoes e checkouts do workspace |
| 4  | Selecao automatica                       | Primeiro acesso ou workspace excluido              | Primeiro workspace da lista selecionado automaticamente  |
| 5  | Persistencia de selecao                  | Usuario troca de workspace                         | `localStorage('sentinel_active_workspace')` atualizado   |
| 6  | Restauracao de selecao                   | Refresh da pagina                                  | Le `sentinel_active_workspace` do localStorage           |
| 7  | Upsert de conexoes                       | Associar conexao ja existente                      | Upsert com `onConflict: 'workspace_id,facebook_connection_id'` |
| 8  | Upsert de checkouts                      | Associar checkout ja existente                     | Upsert com `onConflict: 'workspace_id,checkout_integration_id'` |
| 9  | Substituicao de produtos                 | Chamar setProducts                                 | Deleta todos os produtos existentes e insere os novos    |
| 10 | Sem workspace = sem dados                | Nenhum workspace criado                            | Dashboard exibe empty state "Crie sua primeira area"     |
| 11 | Workspace sem conexoes                   | Workspace ativo sem conexoes associadas            | Dashboard exibe "Area vazia" com link para Integracoes   |
| 12 | Filtro por produtos                      | Workspace com produtos mapeados                    | Vendas filtradas por `product_name IN (workspace_products)` |
| 13 | Sem produtos = sem vendas                | Workspace sem produtos e array vazio               | Query usa `['__no_product_mapped__']` para retornar zero |
| 14 | Admin pode listar de outro usuario       | `target_user_id` informado por admin               | Service verifica `isAdmin` antes de retornar dados       |

---

## 4. Modelo de Dados

### 4.1 Tabelas

**workspaces**
| Coluna     | Tipo      | Descricao                    |
|------------|-----------|------------------------------|
| id         | uuid (PK) | Identificador unico          |
| user_id    | uuid (FK) | Dono do workspace            |
| name       | text      | Nome da area                 |
| created_at | timestamp | Data de criacao              |
| updated_at | timestamp | Ultima atualizacao           |

**workspace_connections**
| Coluna                 | Tipo      | Descricao                            |
|------------------------|-----------|--------------------------------------|
| id                     | uuid (PK) | Identificador unico                  |
| workspace_id           | uuid (FK) | Workspace pai                        |
| facebook_connection_id | uuid (FK) | Conexao do Facebook associada        |
| created_at             | timestamp | Data de associacao                   |

**workspace_checkout_integrations**
| Coluna                   | Tipo      | Descricao                            |
|--------------------------|-----------|--------------------------------------|
| id                       | uuid (PK) | Identificador unico                  |
| workspace_id             | uuid (FK) | Workspace pai                        |
| checkout_integration_id  | uuid (FK) | Integracao de checkout associada     |
| created_at               | timestamp | Data de associacao                   |

**workspace_products**
| Coluna       | Tipo      | Descricao                          |
|--------------|-----------|-------------------------------------|
| id           | uuid (PK) | Identificador unico                 |
| workspace_id | uuid (FK) | Workspace pai                       |
| product_name | text      | Nome do produto mapeado             |
| created_at   | timestamp | Data de associacao                  |

### 4.2 Relacionamentos

- `workspaces.user_id` -> `auth.users.id` (N:1)
- `workspace_connections.workspace_id` -> `workspaces.id` (N:1, cascade delete)
- `workspace_connections.facebook_connection_id` -> `facebook_connections.id` (N:1)
- `workspace_checkout_integrations.workspace_id` -> `workspaces.id` (N:1, cascade delete)
- `workspace_checkout_integrations.checkout_integration_id` -> `checkout_integrations.id` (N:1)
- `workspace_products.workspace_id` -> `workspaces.id` (N:1, cascade delete)

### 4.3 Constraints

- RLS habilitado em todas as tabelas: `user_id = auth.uid()` (via join com workspaces)
- UNIQUE constraint em `workspace_connections(workspace_id, facebook_connection_id)`
- UNIQUE constraint em `workspace_checkout_integrations(workspace_id, checkout_integration_id)`
- `name` nao pode ser vazio (validacao no service)

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path                                       | Guard     | Descricao                                 |
|--------|--------------------------------------------|-----------|--------------------------------------------|
| GET    | `/api/workspaces`                          | AuthGuard | Lista workspaces do usuario (aceita `target_user_id` para admin) |
| POST   | `/api/workspaces`                          | AuthGuard | Cria novo workspace                        |
| PATCH  | `/api/workspaces/:id`                      | AuthGuard | Renomeia workspace                         |
| DELETE | `/api/workspaces/:id`                      | AuthGuard | Exclui workspace e associacoes (cascade)   |
| POST   | `/api/workspaces/:id/connections`          | AuthGuard | Associa conexao Facebook ao workspace      |
| DELETE | `/api/workspaces/:id/connections/:connId`  | AuthGuard | Remove conexao do workspace                |
| POST   | `/api/workspaces/:id/checkouts`            | AuthGuard | Associa checkout ao workspace              |
| DELETE | `/api/workspaces/:id/checkouts/:checkoutId`| AuthGuard | Remove checkout do workspace               |
| POST   | `/api/workspaces/:id/products`             | AuthGuard | Define produtos do workspace (replace all) |

### 5.2 Logica do Service

**WorkspacesService** (`packages/backend/src/modules/workspaces/workspaces.service.ts`):

- `list(userId, targetUserId?)`: Lista workspaces com joins para connections, checkouts e products. Se `targetUserId` diferente de `userId`, verifica `isAdmin`.
- `create(userId, name)`: Insere novo workspace e retorna registro criado.
- `update(userId, workspaceId, name)`: Atualiza nome, filtrando por `user_id` para seguranca.
- `remove(userId, workspaceId)`: Deleta workspace filtrando por `user_id`. Cascade deleta associacoes.
- `addConnection(userId, workspaceId, connectionId)`: Upsert em `workspace_connections`.
- `removeConnection(workspaceId, connectionId)`: Delete em `workspace_connections`.
- `addCheckout(workspaceId, checkoutId)`: Upsert em `workspace_checkout_integrations`.
- `removeCheckout(workspaceId, checkoutId)`: Delete em `workspace_checkout_integrations`.
- `setProducts(workspaceId, productNames[])`: Deleta todos os produtos do workspace e insere os novos.

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente         | Arquivo                                 | Descricao                                       |
|--------------------|-----------------------------------------|-------------------------------------------------|
| WorkspaceSwitcher  | `src/components/WorkspaceSwitcher.tsx`   | Dropdown de selecao, criar, renomear e excluir  |

Variantes do WorkspaceSwitcher:
- `sidebar` (padrao): Compacto vertical para a sidebar. Colapsado mostra apenas icone Layers.
- `inline`: Horizontal para o header do Dashboard, com botoes de rename e delete.

### 6.2 Hooks

| Hook              | Arquivo                          | Descricao                                           |
|-------------------|----------------------------------|-----------------------------------------------------|
| useWorkspaces     | `src/hooks/useWorkspaces.ts`     | CRUD completo: create, update, delete, addConnection, removeConnection, addCheckout, removeCheckout, setProducts |
| useWorkspaceContext | `src/contexts/WorkspaceContext.tsx` | Estado global: activeWorkspaceId, workspaces, activeConnectionIds, activeCheckoutIds, activeProductNames |
| usePlanRules      | `src/hooks/usePlanRules.ts`      | `getLimit('max_workspaces')` para verificar limite do plano |

### 6.3 Estado

**WorkspaceContext** fornece:
- `activeWorkspaceId: string | null` - ID do workspace selecionado
- `activeWorkspace: Workspace | null` - Objeto completo do workspace ativo
- `workspaces: Workspace[]` - Lista de todos os workspaces
- `setActiveWorkspace(id)` - Troca workspace ativo (persiste no localStorage)
- `setWorkspaces(ws[])` - Atualiza lista de workspaces
- `activeConnectionIds: string[]` - IDs das conexoes Facebook do workspace ativo
- `activeCheckoutIds: string[]` - IDs dos checkouts do workspace ativo
- `activeProductNames: string[]` - Nomes dos produtos mapeados no workspace ativo

**useWorkspaces** usa React Query:
- QueryKey: `['workspaces', effectiveUserId]`
- `invalidateQueries` em toda operacao de mutacao para manter UI sincronizada

---

## 7. Pontos de Integracao

| Sistema              | Tipo        | Descricao                                                  |
|----------------------|-------------|-------------------------------------------------------------|
| Dashboard            | Contexto    | `useWorkspaceContext` filtra metricas pelo workspace ativo  |
| Campanhas            | Contexto    | Conexoes ativas determinam quais campanhas sao exibidas     |
| Vendas               | Contexto    | `activeCheckoutIds` e `activeProductNames` filtram vendas   |
| Integracoes          | CRUD        | Pagina gerencia associacoes de conexoes e checkouts         |
| Planos               | Limite      | `max_workspaces` do plano determina quantas areas pode criar|
| Impersonation (admin)| Contexto    | Admin usa `target_user_id` para ver workspaces de outro user|

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                          | Tratamento                                                    |
|--------------------------------------------------|---------------------------------------------------------------|
| Usuario sem nenhum workspace                     | Dashboard exibe empty state "Crie sua primeira area"          |
| Workspace ativo excluido                         | Auto-seleciona o primeiro workspace restante                  |
| Workspace salvo no localStorage nao existe mais  | Fallback para o primeiro workspace da lista                   |
| Limite de workspaces atingido                    | Botao "Nova area" oculto (`canCreate = false`)                |
| Nome vazio ao criar/renomear                     | Backend retorna 400; frontend desabilita botao se `!name.trim()` |
| Erro de rede ao criar                            | Toast "Erro ao criar area"                                    |
| Erro de rede ao excluir                          | Toast "Erro ao excluir area"                                  |
| Admin tentando listar sem ser admin              | Backend retorna 403 ForbiddenException                        |
| Lista de workspaces vazia (0 workspaces)         | `activeWorkspaceId` setado como null                          |
| Workspace sem produtos mapeados                  | Query de vendas usa `['__no_product_mapped__']` = zero vendas |

---

## 9. Checklist de Testes

- [ ] Criar workspace com nome valido exibe toast de sucesso
- [ ] Criar workspace sem nome: botao desabilitado
- [ ] Selecionar workspace atualiza dados no Dashboard
- [ ] Selecao de workspace persiste apos reload (localStorage)
- [ ] Renomear workspace atualiza nome no dropdown
- [ ] Excluir workspace exibe dialog de confirmacao
- [ ] Excluir workspace auto-seleciona o proximo
- [ ] Limite de workspaces oculta botao "Nova area"
- [ ] Workspace sem conexoes exibe empty state no Dashboard
- [ ] Associar conexao Facebook ao workspace funciona
- [ ] Remover conexao do workspace funciona
- [ ] Associar checkout ao workspace funciona
- [ ] Remover checkout do workspace funciona
- [ ] Mapear produtos atualiza filtro de vendas
- [ ] Admin pode listar workspaces de outro usuario
- [ ] Usuario nao-admin nao pode usar target_user_id

---

## 10. Questoes Abertas / TODOs

- [ ] O endpoint `POST /workspaces/:id/products` usa a mesma rota que `setProducts` mas o controller mapeia para `@Post`. O hook frontend usa `api.patch`. Verificar se o metodo HTTP esta correto (controller usa `@Post`, hook usa `PATCH`).
- [ ] Nao ha validacao de que o `facebook_connection_id` ou `checkout_integration_id` realmente pertence ao usuario antes de associar ao workspace.
- [ ] Considerar implementacao de workspace compartilhado entre usuarios (multi-tenancy).
- [ ] Avaliar soft delete para workspaces (manter historico).
- [ ] A exclusao de workspace nao tem rate limiting ou protecao contra exclusao acidental alem do dialog.
