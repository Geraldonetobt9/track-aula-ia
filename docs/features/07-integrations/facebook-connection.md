# Conexao Facebook Ads (Facebook Connection)

## 1. Proposito

A funcionalidade de conexao com o Facebook Ads permite que o usuario conecte suas contas de anuncios ao Sentinela via fluxo OAuth 2.0 padrao. O usuario clica em "Conectar com Facebook", autoriza o app no Facebook, e o token e obtido automaticamente. Os tokens sao criptografados com AES-256-GCM antes do armazenamento. A conexao e validada contra a Graph API do Facebook e, uma vez ativa, permite sincronizar campanhas, conjuntos de anuncios, anuncios e metricas de desempenho. O sistema suporta multiplas contas por usuario, com limites definidos pelo plano contratado.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Pagina de Integracoes `/integrations` | Secao "Facebook Ads" na pagina de integracoes |
| Onboarding | Direcionado apos criar primeiro workspace |

### 2.2 Fluxo de UI

**Fluxo Principal - OAuth 2.0:**

1. O usuario clica em "Conectar com Facebook" na secao Facebook Ads.
2. O frontend obtem o JWT da sessao Supabase e redireciona para `GET /api/facebook/auth/connect?token=<jwt>`.
3. O backend valida o JWT, gera um state assinado (HMAC-SHA256) com o userId, e redireciona para `https://www.facebook.com/v22.0/dialog/oauth`.
4. O usuario autoriza o app no Facebook com scopes: `ads_read`, `read_insights`, `business_management`, `public_profile`.
5. O Facebook redireciona para `GET /api/facebook/auth/callback?code=xxx&state=yyy`.
6. O backend valida o state (CSRF), troca o code por short-lived token, troca por long-lived token (60 dias).
7. O token e criptografado com AES-256-GCM e salvo na tabela `facebook_connections`.
8. Contas de anuncios sao descobertas automaticamente em background.
9. O usuario e redirecionado para `/dashboard/integrations?connected=true`.
10. O frontend exibe toast: "Facebook conectado com sucesso!"

**Fluxo de Reconexao:**

1. Quando o token expira (apos 60 dias), o usuario clica novamente em "Conectar com Facebook".
2. O fluxo OAuth e repetido. Se ja existe conexao com o mesmo `facebook_user_id`, o token e atualizado.

**Gerenciamento de Contas:**

- O usuario pode ativar/desativar contas de anuncios individuais via toggles.
- O usuario pode remover um perfil inteiro do Facebook, o que deleta todas as contas de anuncios associadas.
- Conexoes sao vinculadas a workspaces via toggles.

**Fluxo de Atualizacao de Contas (botao "Atualizar"):**

Resolve o caso em que o usuario ganhou acesso a novas contas de anuncios no Facebook *depois* de ja ter conectado o perfil — sem precisar remover e reconectar.

1. O usuario clica em "Atualizar" no cabecalho do perfil.
2. O frontend chama `POST /api/facebook/connections/profile/:facebookUserId/refresh`.
3. O backend recupera o token armazenado do perfil e reconsulta a Graph API via `listAccounts()`.
4. Contas ainda nao registradas sao inseridas em lote, sempre com `is_active = false`.
5. Contas ja existentes que mudaram de nome ou `account_status` sao atualizadas.
6. Contas que o token deixou de retornar **nao** sao removidas (podem ter historico de insights).
7. O toast informa quantas contas novas apareceram, ou que nenhuma apareceu.

**Visualizacao de conexoes:**

- Conexoes sao agrupadas por perfil do Facebook (campo `facebook_user_id`).
- Cada perfil exibe:
  - Nome do perfil do Facebook (ex: "Matheus Almeida") obtido via OAuth.
  - Quantidade de contas de anuncios associadas.
  - Botao "Atualizar" para rebuscar contas de anuncios no Facebook.
  - Botao para remover o perfil (com dialog de confirmacao).
- Dentro de cada perfil, cada conta exibe:
  - Nome da conta de anuncios e ID mascarado: `act_****1234`.
  - Toggle para ativar/desativar rastreamento.
  - Badge "Rastreando" quando ativa.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Conectar nova conta | Usuario autenticado (limitado pelo plano) |
| Visualizar conexoes | Usuario autenticado (filtrado por workspace) |
| Validar conexao | Proprietario da conexao |
| Atualizar token | Proprietario da conexao |
| Remover conexao | Proprietario da conexao |
| Atualizar contas do perfil | Proprietario da conexao |
| Listar contas via token | Qualquer usuario autenticado |

---

## 3. Regras de Negocio

| # | Regra | Descricao |
|---|---|---|
| RN01 | Campos obrigatorios (manual) | `app_id`, `app_secret`, `access_token` e `ad_account_id` sao obrigatorios para salvar conexao manual. No fluxo OAuth, apenas `access_token` e obrigatorio |
| RN02 | Normalizacao do ad_account_id | Remove caracteres nao-numericos, remove prefixo `act_` se presente, depois adiciona `act_` padronizado |
| RN03 | Criptografia AES-256-GCM | `app_id`, `app_secret` e `access_token` sao criptografados via `EncryptionService.encrypt()` antes de persistir |
| RN04 | Limite por plano | Numero maximo de contas definido em `plan_rules.max_ad_accounts`. Free: 1, Starter: 2, Pro: 5, Enterprise/Unlimited: ilimitado (-1) |
| RN05 | Verificacao de limite antes de criar | Ao criar nova conexao, verifica contagem atual vs limite do plano. Se exceder, retorna `ForbiddenException` com `limit_reached: true` |
| RN06 | Validacao contra Graph API | Chama `GET /{ad_account_id}?fields=name,account_status,currency` com o access_token descriptografado |
| RN07 | Mascaramento na listagem | Tokens nunca sao retornados ao frontend. O `ad_account_id` e mascarado como `act_****XXXX` |
| RN08 | Auto-link ao workspace | Nova conexao e automaticamente vinculada ao workspace ativo via `workspace_connections` |
| RN09 | Deduplicacao na batch save | Se o `ad_account_id` ja existe para o usuario, atualiza o token em vez de criar duplicata |
| RN10 | Auto-validacao na batch save | Apos salvar cada conexao no batch, tenta validar automaticamente contra a Graph API |
| RN11 | OAuth state CSRF | O state do OAuth e assinado com HMAC-SHA256 usando ENCRYPTION_KEY, contendo o userId e timestamp. TTL de 10 minutos |
| RN12 | Long-lived token | OAuth troca short-lived por long-lived token (60 dias). Expiracao salva em `token_expires_at` |
| RN13 | Reconexao via OAuth | Se `facebook_user_id` ja existe para o usuario, atualiza o token em vez de criar nova conexao |
| RN14 | Pre-fetch de contas | Apos OAuth, o backend chama `listAccounts()` em background para pre-carregar contas nos logs. O usuario seleciona contas manualmente via edit no frontend |
| RN15 | Nome do perfil salvo no OAuth | Durante o fluxo OAuth, o nome do perfil Facebook (`facebook_user_name`) e obtido via `GET /me?fields=id,name` e salvo em cada conexao criada/atualizada |
| RN16 | Exclusao por perfil | Ao remover um perfil, todas as conexoes com o mesmo `facebook_user_id` sao deletadas, incluindo os vinculos em `workspace_connections` |
| RN17 | Refresh nao reativa contas | Contas descobertas pelo botao "Atualizar" sao inseridas com `is_active = false`. O usuario ativa manualmente, e so nesse momento o limite do plano e verificado |
| RN18 | Refresh e aditivo | O refresh nunca deleta conexoes. Contas que o token deixou de retornar permanecem, porque podem ter insights e historico de campanhas ja sincronizados |
| RN19 | Refresh reusa o token existente | Nenhum novo fluxo OAuth e disparado: o token criptografado do perfil e reaproveitado. Novas conexoes herdam `access_token`, `token_expires_at` e `workspace_id` da conexao de referencia |
| RN20 | Token expirado bloqueia o refresh | Se `token_expires_at` ja passou, retorna 400 com instrucao de reconectar, sem chamar a Graph API |
| RN21 | Falha na Graph API invalida o perfil | Se a Graph API rejeita o token, todas as conexoes do perfil recebem `is_valid = false` e o usuario e orientado a reconectar |

---

## 4. Modelo de Dados

### 4.1 Tabelas

#### `facebook_connections`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| app_id | TEXT | Sim | NULL | App ID do Facebook Developer (criptografado). Nulo no fluxo OAuth |
| app_secret | TEXT | Sim | NULL | App Secret (criptografado). Nulo no fluxo OAuth |
| access_token | TEXT | Nao | - | Access Token (criptografado). Obtido via OAuth ou manual |
| ad_account_id | TEXT | Nao | - | ID da conta de anuncios (formato act_XXXXX, nao criptografado) |
| account_status | INTEGER | Sim | NULL | Status da conta no Facebook (1=Ativa, 2=Desabilitada, 3/7=Pendente, 100/101=Fechada) |
| is_valid | BOOLEAN | Sim | false | Se a conexao foi validada com sucesso |
| last_validated_at | TIMESTAMPTZ | Sim | NULL | Data/hora da ultima validacao bem-sucedida |
| account_name | TEXT | Sim | NULL | Nome da conta de anuncios (obtido da Graph API) |
| is_active | BOOLEAN | Sim | false | Se a conta esta sendo rastreada ativamente |
| token_expires_at | TIMESTAMPTZ | Sim | NULL | Data de expiracao do long-lived token OAuth (60 dias) |
| facebook_user_id | TEXT | Sim | NULL | ID do usuario Facebook que autorizou o token |
| facebook_user_name | TEXT | Sim | NULL | Nome do perfil do Facebook que autorizou o token (ex: "Matheus Almeida") |
| created_at | TIMESTAMPTZ | Nao | now() | Data de criacao |
| updated_at | TIMESTAMPTZ | Nao | now() | Data de atualizacao (trigger automatico) |

### 4.2 Relacionamentos

```
facebook_connections.user_id -> auth.users(id)
workspace_connections.facebook_connection_id -> facebook_connections(id) [logico]
```

### 4.3 Constraints

- RLS habilitado: usuarios so veem/editam suas proprias conexoes (`auth.uid() = user_id`)
- Trigger `update_facebook_connections_updated_at`: atualiza `updated_at` automaticamente em cada UPDATE
- Politicas RLS: SELECT, INSERT, UPDATE, DELETE restritas ao proprietario (`auth.uid() = user_id`)

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/facebook/auth/connect` | Inicia fluxo OAuth — redireciona para Facebook (sem AuthGuard, valida via ?token=jwt) |
| GET | `/api/facebook/auth/callback` | Callback do Facebook — troca code por token, salva, redireciona (sem AuthGuard, valida via state) |
| GET | `/api/facebook/connections` | Lista conexoes do usuario (sem expor tokens) |
| DELETE | `/api/facebook/connections/profile/:facebookUserId` | Remove todas as conexoes de um perfil Facebook |
| POST | `/api/facebook/connections/profile/:facebookUserId/refresh` | Rebusca contas de anuncios do perfil na Graph API e registra as novas. Retorna `{ added, updated, total }` |
| PATCH | `/api/facebook/connections/:id/active` | Ativa/desativa rastreamento de uma conta |

### 5.2 Logica

**POST /api/facebook/connections**

Service: `FacebookService.saveConnection(userId, payload)`

1. Valida campos obrigatorios: `app_id`, `app_secret`, `access_token`, `ad_account_id`.
2. Normaliza `ad_account_id`: remove nao-numericos, adiciona prefixo `act_`.
3. Se criando nova conexao (sem `connection_id`), verifica limite do plano.
4. Criptografa `app_id`, `app_secret` e `access_token` via `EncryptionService.encrypt()`.
5. Se `connection_id` fornecido: UPDATE na conexao existente. Senao: INSERT nova.
6. Se `workspace_id` fornecido: verifica/cria vinculo em `workspace_connections`.
7. Retorna `{ success: true, connection: { id, ad_account_id, is_valid, ... } }`.

**GET /api/facebook/connections**

Service: `FacebookService.getConnections(userId, workspaceId?, options?)`

**Query params:**
- `workspace_id` (opcional) — filtra conexoes por workspace
- `active_only` (opcional, `true`/`false`) — quando `true`, aplica `WHERE is_active = true` no servidor
- `minimal` (opcional, `true`/`false`) — quando `true`, retorna apenas `id, ad_account_id, account_name`

1. Busca conexoes do usuario, filtrando por `workspace_id` quando fornecido.
2. Aplica `is_active = true` quando `active_only=true`.
3. Ordena por `account_name`.
4. Nunca retorna `app_id`, `app_secret` ou `access_token`.
5. Em modo padrao, retorna array `[{ id, ad_account_id, account_name, account_status, facebook_user_id, facebook_user_name, is_valid, is_active }]`.
6. Em modo `minimal=true`, retorna array `[{ id, ad_account_id, account_name }]` — usado pela tela `/rules` para popular o dropdown de contas.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| FacebookConnectionForm | `src/components/integrations/FacebookConnectionForm.tsx` | Formulario com 4 campos + botoes salvar/validar |
| Lista de conexoes | Inline na pagina de Integracoes | Exibe conexoes com status e acoes |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useFacebookConnection` | `src/hooks/useFacebookConnection.ts` | Ver tabela abaixo |

**Retorno do useFacebookConnection:**

| Propriedade | Tipo | Descricao |
|---|---|---|
| connections | FacebookConnectionInfo[] | Conexoes do usuario (filtradas pelo workspace ativo via API) |
| allConnections | FacebookConnectionInfo[] | Alias de `connections` |
| loading | boolean | Se esta carregando dados |
| deleteProfile | (facebookUserId) => Promise<void> | Remove perfil e todas as contas associadas |
| refreshProfile | (facebookUserId) => Promise<boolean> | Rebusca contas do perfil na Graph API, recarrega a lista e emite toast com o resultado |
| toggleActive | (connectionId, isActive) => Promise<boolean> | Ativa/desativa rastreamento de uma conta |
| refetch | () => Promise<void> | Recarrega lista de conexoes |
| isConfigured | boolean | `connections.length > 0` |
| isValid | boolean | Se alguma conexao tem `is_valid === true` |

**Interfaces:**

```typescript
interface FacebookConnectionInfo {
  id: string;
  ad_account_id: string;
  account_name: string | null;
  account_status: number | null;
  facebook_user_id: string | null;
  facebook_user_name: string | null;
  is_valid: boolean;
  is_active: boolean;
}

interface FacebookAdAccount {
  id: string;
  name: string;
  business_name: string | null;
  currency: string;
  account_status: number;
}

interface FacebookConnectionFormData {
  app_id: string;
  app_secret: string;
  access_token: string;
  ad_account_id: string;
}
```

### 6.3 Estado

| Estado | Tipo | Descricao |
|---|---|---|
| connections (local) | FacebookConnectionInfo[] | Todas as conexoes do usuario |
| loading | boolean | Carregando lista de conexoes |
| saving | boolean | Salvando/validando conexao |
| filteredConnections | FacebookConnectionInfo[] | Conexoes filtradas por `activeConnectionIds` do workspace |

Filtragem por workspace:
- `activeConnectionIds` vem do `WorkspaceContext`.
- `filteredConnections = connections.filter(c => activeConnectionIds.includes(c.id))`.

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Facebook Graph API v22.0 | Externo | Validacao de tokens, listagem de contas, busca de dados |
| EncryptionService | Interno | Criptografia AES-256-GCM para tokens sensiveis |
| plan_rules | Leitura | Verifica `max_ad_accounts` para limites do plano |
| workspace_connections | Escrita | Auto-vinculacao da conexao ao workspace ativo |
| WorkspaceContext | Contexto | Fornece `activeConnectionIds` para filtrar conexoes visiveis |
| ActiveConnectionContext | Contexto | Propaga conexoes para `setConnections` |
| Facebook Sync (InsightsService) | Dependente | Usa a conexao para sincronizar campanhas e metricas |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Token expirado | Validacao retorna `{ valid: false, error: "Error validating access token" }`; usuario precisa gerar novo token |
| Token sem permissao ads_read | Graph API retorna erro de permissao; UI exibe mensagem da API |
| Ad Account ID com formato incorreto | Backend normaliza: remove nao-numericos, adiciona `act_` |
| Limite do plano atingido | `ForbiddenException` com `{ limit_reached: true, message: "Seu plano X permite no maximo Y conta(s)" }` |
| Conexao duplicada (mesmo ad_account_id) | Batch save atualiza token da existente em vez de criar nova |
| 5 estrategias de listagem falham | `BadRequestException` com mensagem: "Nao foi possivel listar contas de anuncios com este token" |
| Erro de rede ao validar | Catch generico retorna `{ valid: false, error: mensagem_do_erro }` |
| Usuario sem workspace ativo | `filteredConnections` retorna vazio; UI mostra orientacao para criar workspace |
| Token de System User (Business Manager) | Estrategia 3 (`assigned_ad_accounts`) cobre esse cenario |
| Multiplos Business Managers | Estrategia 4 itera sobre todos os businesses e deduplica contas |
| Refresh com token expirado | Bloqueado antes de chamar a Graph API; retorna 400 "O acesso ao Facebook expirou. Remova o perfil e conecte novamente." |
| Refresh com token revogado no Facebook | Graph API falha; conexoes do perfil recebem `is_valid = false` e retorna 400 orientando reconexao |
| Refresh sem contas novas | Retorna `{ added: 0 }`; toast informa quantas contas o Facebook retornou e que todas ja constam |
| Refresh em perfil inexistente | `NotFoundException` ("Perfil do Facebook não encontrado") |
| Conta perdeu acesso no Facebook | O refresh nao remove nada; a conexao permanece na lista e o usuario decide se desativa ou remove o perfil |

---

## 9. Checklist de Testes

- [ ] Salvar conexao com todos os 4 campos preenchidos
- [ ] Verificar que tokens sao criptografados no banco (nao legivel em texto plano)
- [ ] Confirmar que GET /connections retorna ad_account_id mascarado e nunca retorna tokens
- [ ] Validar conexao com token valido contra Graph API
- [ ] Validar conexao com token invalido e verificar mensagem de erro
- [ ] Testar normalizacao: `"123456"` -> `"act_123456"`, `"act_123456"` -> `"act_123456"`
- [ ] Testar limite do plano: tentar criar conexao quando limite atingido
- [ ] Testar listagem de contas via token pessoal (estrategia 2)
- [ ] Testar listagem de contas via System User token (estrategia 3)
- [ ] Testar listagem de contas via Business Manager (estrategia 4)
- [ ] Testar save-multiple com 3 contas selecionadas
- [ ] Testar save-multiple com conta ja existente (deve atualizar, nao duplicar)
- [ ] Testar save-multiple excedendo limite do plano
- [ ] Testar atualizacao de token com auto-validacao bem-sucedida
- [ ] Testar atualizacao de token com validacao falhando
- [ ] Testar remocao de conexao
- [ ] Verificar que auto-link ao workspace funciona ao salvar
- [ ] Testar filtragem por workspace: conexoes nao vinculadas nao aparecem
- [ ] Testar impersonacao: admin ve conexoes de outro usuario
- [ ] Clicar em "Atualizar" apos ganhar acesso a uma nova conta no Facebook: a conta aparece na lista, desativada
- [ ] Clicar em "Atualizar" sem mudancas: toast "Nenhuma conta nova" com o total retornado
- [ ] Verificar que uma conta recem-descoberta nao conta no limite do plano ate ser ativada
- [ ] Renomear uma conta no Facebook e atualizar: o novo nome aparece sem duplicar a conexao
- [ ] Atualizar com token expirado: mensagem orientando reconexao, sem chamada a Graph API
- [ ] Atualizar perfil A nao deve alterar contas do perfil B

---

## 10. Questoes Abertas

| # | Questao | Contexto |
|---|---|---|
| Q01 | Renovacao automatica de token | Long-lived tokens expiram apos 60 dias (`token_expires_at`). O usuario precisa reconectar via OAuth. Futuro: notificar usuario antes da expiracao |
| Q02 | UNIQUE constraint removida | A migration original tinha `UNIQUE (user_id)` na tabela, mas o sistema agora suporta multiplas conexoes. A constraint provavelmente foi removida em migration posterior |
| Q03 | app_id/app_secret nullable | Com o fluxo OAuth, `app_id` e `app_secret` sao nullable na tabela (o app usa credenciais globais do backend). Conexoes criadas via OAuth nao populam esses campos |
| Q04 | Criptografia do ad_account_id | O `ad_account_id` nao e criptografado (apenas mascarado na resposta). Pode ser considerado dado sensivel |
| Q05 | Webhook de token expirado | Nao ha notificacao proativa ao usuario quando um token esta proximo de expirar ou ja expirou |
