# Integracoes - Visao Geral (Integrations Overview)

## 1. Proposito

A pagina de Integracoes e o hub central onde o usuario configura todas as conexoes externas necessarias para o funcionamento da plataforma Sentinela. Ela organiza as integracoes em tres secoes: conexao com contas de anuncios do Facebook, configuracao de plataformas de checkout (webhooks), e mapeamento de produtos para workspaces. Adicionalmente, o usuario pode configurar o agendamento de sincronizacao automatica dos dados do Facebook Ads.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar `/integrations` | Link "Integracoes" no menu lateral do DashboardLayout |
| Onboarding | Novos usuarios sao direcionados para configurar integracoes apos criar o primeiro workspace |
| Pagina de Vendas | Aviso com link para integracoes quando nenhuma integracao esta configurada |

### 2.2 Fluxo de UI

1. O usuario acessa `/integrations` pela sidebar.
2. A pagina exibe tres secoes principais em cards/abas:

**Secao 1 - Facebook Ads:**
- Lista as contas de anuncios conectadas (filtradas pelo workspace ativo).
- Cada conexao mostra: ID mascarado da conta (act_****1234), status de validacao (valido/invalido), data da ultima validacao.
- Acoes: conectar nova conta, validar conexao existente, atualizar token, remover conexao.
- Se nenhuma conta conectada, exibe formulario de conexao.

**Secao 2 - Checkout (Plataformas):**
- Grid com as 16 plataformas suportadas: Hotmart, Kiwify, Kirvano, Guru Digital, Perfect Pay, Ticto, PayT, Cakto, Hubla, CartPanda, GG Checkout, LastLink, Eduzz, Mundpay, Monetizze, Greenn.
- Cada plataforma mostra: nome, descricao, status (configurada/nao configurada, ativa/inativa).
- Ao clicar em uma plataforma, abre modal de configuracao (`CheckoutConfigModal`) com:
  - URL do webhook (gerada automaticamente, somente leitura).
  - Campo para colar o token/secret da plataforma.
  - Instrucoes passo a passo especificas da plataforma.
- Integracoes configuradas podem ser ativadas/desativadas via toggle.

**Secao 3 - Mapeamento de Produtos:**
- Lista os nomes de produtos vinculados ao workspace ativo.
- Permite adicionar/remover mapeamentos entre nomes de produtos (vindos das vendas) e o workspace.

**Secao 4 - Sincronizacao (Sync Schedule):**
- Configuracao do intervalo de sincronizacao automatica dos dados do Facebook Ads.
- Opcoes de intervalo e tipo de sincronizacao.

3. Todas as operacoes exibem toast de sucesso ou erro apos conclusao.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar integracoes | Usuario autenticado com workspace ativo |
| Conectar conta Facebook | Usuario autenticado (limitado pelo plano) |
| Configurar checkout | Usuario autenticado |
| Mapear produtos | Usuario autenticado com workspace ativo |
| Configurar sync schedule | Usuario autenticado |

---

## 3. Regras de Negocio

| # | Regra | Descricao |
|---|---|---|
| RN01 | Workspace obrigatorio | Maioria das integracoes requer workspace ativo para funcionar |
| RN02 | Limite de contas Facebook | Numero maximo de contas de anuncios definido por `plan_rules.max_ad_accounts` |
| RN03 | Webhook URL automatica | URL do webhook e gerada como `{WEBHOOK_DOMAIN}/webhook-{platform}` |
| RN04 | Token obrigatorio | Toda integracao de checkout requer um token/secret para autenticacao do webhook |
| RN05 | Auto-link ao workspace | Novas conexoes Facebook e checkouts sao automaticamente vinculados ao workspace ativo |
| RN06 | Filtro por workspace | A listagem de integracoes e filtrada pelos IDs vinculados ao workspace ativo |
| RN07 | Toggle ativa/inativa | Integracoes de checkout podem ser desativadas sem perder a configuracao |
| RN08 | Conexoes criptografadas | Tokens do Facebook sao criptografados com AES-256-GCM antes de persistir |
| RN09 | Sync schedule por tipo | Cada tipo de sincronizacao (campaigns, insights) pode ter intervalo independente |
| RN10 | Upsert de schedule | Sync schedules usam upsert com conflito em `(user_id, sync_type)` |

---

## 4. Modelo de Dados

### 4.1 Tabelas

As tabelas utilizadas pela pagina de integracoes sao detalhadas em seus respectivos documentos:

- `facebook_connections` -> ver [facebook-connection.md](./facebook-connection.md)
- `checkout_integrations` -> ver [checkout-integrations.md](./checkout-integrations.md)
- `workspace_connections` -> vinculacao entre workspace e facebook_connection
- `workspace_checkout_integrations` -> vinculacao entre workspace e checkout_integration
- `workspace_products` -> vinculacao entre workspace e nomes de produtos
- `sync_schedules` -> configuracao de sincronizacao automatica
- `sync_logs` -> historico de execucoes de sincronizacao

#### `workspace_connections`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| workspace_id | UUID | Nao | - | FK para workspaces |
| facebook_connection_id | TEXT | Nao | - | ID da conexao Facebook |
| created_at | TIMESTAMPTZ | Sim | now() | Data de criacao |

#### `workspace_checkout_integrations`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| workspace_id | UUID | Nao | - | FK para workspaces |
| checkout_integration_id | TEXT | Nao | - | ID da integracao de checkout |
| created_at | TIMESTAMPTZ | Sim | now() | Data de criacao |

#### `workspace_products`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| workspace_id | UUID | Nao | - | FK para workspaces |
| product_name | TEXT | Nao | - | Nome do produto mapeado |
| created_at | TIMESTAMPTZ | Sim | now() | Data de criacao |

#### `sync_schedules`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| sync_type | TEXT | Nao | - | Tipo de sincronizacao |
| interval_minutes | INTEGER | Sim | - | Intervalo em minutos |
| is_active | BOOLEAN | Sim | true | Se o agendamento esta ativo |
| created_at | TIMESTAMPTZ | Sim | now() | Data de criacao |

### 4.2 Relacionamentos

```
workspace_connections.workspace_id           -> workspaces(id)  ON DELETE CASCADE
workspace_checkout_integrations.workspace_id -> workspaces(id)  ON DELETE CASCADE
workspace_products.workspace_id              -> workspaces(id)  ON DELETE CASCADE
sync_schedules.user_id                       -> auth.users(id)
```

### 4.3 Constraints

- `workspace_connections` UNIQUE: `(workspace_id, facebook_connection_id)`
- `workspace_checkout_integrations` UNIQUE: `(workspace_id, checkout_integration_id)`
- `workspace_products` UNIQUE: `(workspace_id, product_name)`
- `sync_schedules` UNIQUE (via upsert): `(user_id, sync_type)`
- RLS habilitado em todas as tabelas: acesso via workspace pertencente ao usuario

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/facebook/auth/connect` | Inicia OAuth — redireciona para o Facebook |
| GET | `/api/facebook/auth/callback` | Callback do OAuth — salva conexoes |
| GET | `/api/facebook/connections` | Lista conexoes Facebook do usuario |
| DELETE | `/api/facebook/connections/profile/:facebookUserId` | Remove perfil Facebook e todas as contas associadas |
| PATCH | `/api/facebook/connections/:id/active` | Ativa/desativa rastreamento de uma conta |
| GET | `/api/integrations/checkout` | Lista integracoes de checkout |
| POST | `/api/integrations/checkout` | Salva integracao de checkout |
| PATCH | `/api/integrations/checkout/:id/toggle` | Ativa/desativa integracao |
| DELETE | `/api/integrations/checkout/:id` | Remove integracao de checkout |
| GET | `/api/integrations/sync-schedules` | Lista agendamentos de sincronizacao |
| POST | `/api/integrations/sync-schedules` | Cria/atualiza agendamento (upsert) |
| PATCH | `/api/integrations/sync-schedules/:id` | Atualiza agendamento existente |
| GET | `/api/integrations/sync-logs` | Lista historico de sincronizacoes |

### 5.2 Logica

A logica detalhada de cada grupo de endpoints esta documentada nos respectivos arquivos:

- Conexoes Facebook: ver [facebook-connection.md](./facebook-connection.md)
- Integracoes de checkout: ver [checkout-integrations.md](./checkout-integrations.md)

**Sync Schedules (IntegrationsService):**

- `getSyncSchedules(userId)`: lista todos os agendamentos do usuario.
- `createSyncSchedule(userId, body)`: upsert com `onConflict: 'user_id,sync_type'`.
- `updateSyncSchedule(userId, id, updates)`: atualiza campos do agendamento.
- `getSyncLogs(userId, limit = 20)`: lista ultimas 20 execucoes de sincronizacao ordenadas por data descendente.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Integrations (pagina) | `src/pages/Integrations.tsx` | Pagina principal com as 3-4 secoes de integracoes |
| FacebookConnectionForm | `src/components/integrations/FacebookConnectionForm.tsx` | Formulario para conectar conta Facebook (App ID, App Secret, Access Token, Ad Account ID) |
| CheckoutIntegrationsSection | `src/components/integrations/CheckoutIntegrationsSection.tsx` | Grid de plataformas de checkout com status e acoes |
| CheckoutConfigModal | `src/components/integrations/CheckoutConfigModal.tsx` | Modal de configuracao de plataforma de checkout |
| PlatformSelectorModal | `src/components/integrations/PlatformSelectorModal.tsx` | Modal de selecao de plataforma ao adicionar nova integracao |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useFacebookConnection` | `src/hooks/useFacebookConnection.ts` | `{ connections, allConnections, loading, deleteProfile, toggleActive, refetch, isConfigured, isValid }` |
| `useCheckoutIntegrations` | `src/hooks/useCheckoutIntegrations.ts` | `{ integrations, loading, saving, saveIntegration, toggleIntegration, deleteIntegration, getIntegration, generateWebhookUrl, refetch }` |

### 6.3 Estado

Estado principal gerenciado pela pagina Integrations:

| Estado | Tipo | Descricao |
|---|---|---|
| activeTab | string | Aba/secao ativa (facebook, checkout, products, sync) |
| selectedPlatform | CheckoutPlatform \| null | Plataforma selecionada para configuracao no modal |
| modalOpen | boolean | Se o modal de configuracao esta aberto |

Estado de filtro por workspace (via WorkspaceContext):

| Estado | Tipo | Descricao |
|---|---|---|
| activeConnectionIds | string[] | IDs de conexoes Facebook vinculadas ao workspace ativo |
| activeCheckoutIds | string[] | IDs de integracoes checkout vinculadas ao workspace ativo |
| activeProductNames | string[] | Nomes de produtos vinculados ao workspace ativo |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Facebook Graph API | Externo | Validacao de tokens e listagem de contas de anuncios |
| Plataformas de checkout (9) | Externo | Webhooks recebidos para processamento de vendas |
| WorkspaceContext | Contexto | Define quais integracoes sao visiveis e ativas para o workspace |
| ActiveConnectionContext | Contexto | Propaga a conexao Facebook ativa para outros hooks |
| Sync Engine | Backend | Consome sync_schedules para executar sincronizacoes automaticas |
| Pagina de Vendas | Dependente | Depende das integracoes de checkout configuradas para receber vendas |
| Pagina de Campanhas | Dependente | Depende da conexao Facebook para sincronizar campanhas |
| Dashboard | Dependente | Depende de ambas integracoes para exibir metricas consolidadas |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Token Facebook expirado | Validacao retorna `{ valid: false, error: "..." }`; UI mostra botao para atualizar token |
| Limite de contas atingido | Backend retorna `ForbiddenException` com `limit_reached: true`; UI mostra toast com mensagem de upgrade |
| Plataforma de checkout sem token | Botao de salvar desabilitado; toast alerta que token e obrigatorio |
| Webhook URL invalida | URL e gerada automaticamente pelo sistema, nao editavel pelo usuario |
| Workspace sem integracoes vinculadas | Listas filtradas retornam vazias; UI mostra estado vazio com orientacao |
| Erro na API do Facebook ao listar contas | Tenta 5 estrategias em cascata; se todas falharem, retorna mensagem de erro |
| Integracao duplicada (mesmo ad_account_id) | Ao salvar multiplas, atualiza o token da existente em vez de criar duplicata |
| Sync schedule duplicado | Upsert garante que apenas um schedule existe por (user_id, sync_type) |

---

## 9. Checklist de Testes

- [ ] Verificar que a pagina exibe as 3 secoes corretamente
- [ ] Testar conexao Facebook com credenciais validas
- [ ] Testar conexao Facebook com credenciais invalidas e verificar mensagem de erro
- [ ] Verificar que ID da conta e mascarado na listagem (act_****1234)
- [ ] Testar validacao de conexao existente
- [ ] Testar listagem de contas de anuncios via access token
- [ ] Testar salvamento de multiplas contas em lote
- [ ] Testar atualizacao de token com auto-validacao
- [ ] Testar limite de contas do plano (free, starter, pro)
- [ ] Configurar integracao Hotmart e verificar URL gerada
- [ ] Configurar integracao para cada uma das 9 plataformas
- [ ] Ativar/desativar integracao de checkout via toggle
- [ ] Remover integracao de checkout e confirmar exclusao
- [ ] Adicionar mapeamento de produto ao workspace
- [ ] Remover mapeamento de produto
- [ ] Configurar sync schedule e verificar persistencia
- [ ] Verificar que integracoes sao filtradas pelo workspace ativo
- [ ] Testar com usuario sem workspace: deve exibir orientacao

---

## 10. Questoes Abertas

| # | Questao | Contexto |
|---|---|---|
| Q01 | Webhook health check | Nao ha mecanismo para verificar se o webhook esta recebendo dados corretamente. Um ping/test endpoint ajudaria na depuracao |
| Q02 | Refresh automatico do token Facebook | Tokens de acesso expiram. Nao ha renovacao automatica; o usuario precisa atualizar manualmente |
| Q03 | Mapeamento de produtos automatico | Atualmente o mapeamento e manual. Uma sugestao automatica baseada em vendas ja recebidas simplificaria o processo |
| Q04 | Sync logs na pagina de integracoes | Os sync_logs sao buscados via API mas a exibicao na UI pode nao estar completamente implementada |
| Q05 | Webhook URL por ambiente | A URL de webhook usa dominio fixo (`api.sentinelatracker.com.br`). Em ambientes de desenvolvimento, o usuario nao consegue testar webhooks localmente |
