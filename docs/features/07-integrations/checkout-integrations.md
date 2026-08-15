# Integracoes de Checkout (Checkout Integrations)

## 1. Proposito

As integracoes de checkout permitem que o usuario conecte plataformas de vendas de produtos digitais ao Sentinela. Cada plataforma envia dados de vendas via webhook (HTTP POST) para uma URL dedicada, permitindo que o sistema registre transacoes automaticamente na tabela `sales`. O Sentinela suporta 16 plataformas: Hotmart, Kiwify, Kirvano, Guru Digital, Perfect Pay, Ticto, PayT, Cakto, Hubla, CartPanda, GG Checkout, LastLink, Eduzz, Mundpay, Monetizze e Greenn. Cada integracao requer um token de autenticacao para validar a origem dos webhooks. **LastLink exige uma integracao por produto** (nao uma por conta). **Mundpay autentica via query param `?token=...` na URL** (nao permite headers customizados).

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Pagina de Integracoes `/integrations` | Secao "Checkout" com grid de plataformas |

### 2.2 Fluxo de UI

1. O usuario acessa `/integrations` e navega ate a secao de Checkout.
2. Um grid exibe as 16 plataformas suportadas, cada uma com:
   - Nome e descricao da plataforma.
   - Indicador visual de status: configurada (com toggle ativa/inativa) ou nao configurada.
3. O usuario clica em uma plataforma para abrir o `CheckoutConfigModal`.
4. O modal exibe:
   - **URL do Webhook** (somente leitura, com botao copiar): gerada automaticamente no formato `https://api.sentinelatracker.com.br/webhook-{platform}`.
   - **Campo de Token**: label e help text especificos da plataforma (ex: "Hottok" para Hotmart, "API Token" para Guru).
   - **Instrucoes passo a passo**: lista numerada com orientacoes especificas para configurar o webhook na plataforma.
5. O usuario cola o token e clica em "Salvar".
6. O hook `useCheckoutIntegrations.saveIntegration(platform, token)` envia POST para `/api/integrations/checkout`.
7. Se `activeWorkspaceId` disponivel, o `workspace_id` e enviado para auto-link.
8. Toast de sucesso: "{Plataforma} configurado com sucesso."
9. A integracao agora aparece como "configurada" no grid com toggle ativo.
10. O usuario pode:
    - **Ativar/desativar** via toggle (PATCH toggle).
    - **Remover** via botao de delete (DELETE).

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar integracoes | Usuario autenticado (filtrado por workspace) |
| Configurar nova integracao | Usuario autenticado |
| Ativar/desativar integracao | Proprietario da integracao |
| Remover integracao | Proprietario da integracao |

---

## 3. Regras de Negocio

| # | Regra | Descricao |
|---|---|---|
| RN01 | 16 plataformas suportadas | hotmart, kiwify, kirvano, guru, perfectpay, ticto, payt, cakto, hubla, cartpanda, ggcheckout, lastlink, eduzz, mundpay, monetizze, greenn |
| RN02 | Token obrigatorio | O campo `webhook_secret` (ou `api_token` para Guru) e obrigatorio para salvar |
| RN03 | URL do webhook fixa | Formato: `https://api.sentinelatracker.com.br/webhook-{platform}` |
| RN04 | Auto-link ao workspace | Se `workspace_id` fornecido no payload, a integracao e vinculada automaticamente via `workspace_checkout_integrations` |
| RN05 | Toggle sem perda de dados | Desativar uma integracao muda apenas `is_active` para false; configuracao preservada |
| RN06 | Filtro por workspace | Na UI, integracoes sao filtradas por `activeCheckoutIds` do workspace ativo |
| RN07 | Upsert de integracao | Se `body.id` presente no POST, atualiza existente; senao, insere nova |
| RN08 | Webhook domain fixo | URL usa dominio de producao `api.sentinelatracker.com.br` independente do ambiente |
| RN09 | Instrucoes por plataforma | Cada plataforma tem instrucoes especificas definidas em `CHECKOUT_PLATFORMS` |
| RN10 | Invalidacao de cache | Apos salvar integracao, `queryClient.invalidateQueries({ queryKey: ['workspaces'] })` para atualizar vinculacoes |

---

## 4. Modelo de Dados

### 4.1 Tabelas

#### `checkout_integrations`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| platform | TEXT | Nao | - | Nome da plataforma (ver CHECK constraint) |
| webhook_secret | TEXT | Sim | NULL | Token/secret de autenticacao do webhook |
| api_token | TEXT | Sim | NULL | Token de API adicional (usado por Guru Digital) |
| webhook_url | TEXT | Sim | NULL | URL do webhook gerada (informativo) |
| is_active | BOOLEAN | Sim | true | Se a integracao esta ativa |
| last_webhook_at | TIMESTAMPTZ | Sim | NULL | Data/hora do ultimo webhook recebido |
| created_at | TIMESTAMPTZ | Nao | now() | Data de criacao |
| updated_at | TIMESTAMPTZ | Nao | now() | Data de atualizacao |

### 4.2 Relacionamentos

```
checkout_integrations.user_id -> auth.users(id) ON DELETE CASCADE
workspace_checkout_integrations.checkout_integration_id -> checkout_integrations(id) [logico]
sales.checkout_integration_id -> checkout_integrations(id) ON DELETE SET NULL
```

### 4.3 Constraints

- `platform` CHECK: originalmente `('hotmart', 'kiwify', 'kirvano', 'other')`, depois atualizado para incluir `'guru'` e demais plataformas
- RLS habilitado: usuarios so veem/editam suas proprias integracoes (`auth.uid() = user_id`)
- Trigger `update_checkout_integrations_updated_at`: atualiza `updated_at` automaticamente

**Indices:**
- `idx_checkout_integrations_user_id` em `user_id`

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/integrations/checkout` | Lista integracoes de checkout do usuario |
| POST | `/api/integrations/checkout` | Cria ou atualiza integracao |
| PATCH | `/api/integrations/checkout/:id/toggle` | Ativa ou desativa integracao |
| DELETE | `/api/integrations/checkout/:id` | Remove integracao |

### 5.2 Logica

**GET /api/integrations/checkout**

Controller: `IntegrationsController.listCheckout()`
Service: `IntegrationsService.listCheckoutIntegrations(userId)`

- Busca todas as integracoes do usuario ordenadas por `created_at`.
- Retorna array completo sem filtragem (filtragem por workspace e feita no frontend).

**POST /api/integrations/checkout**

Controller: `IntegrationsController.saveCheckout()`
Service: `IntegrationsService.saveCheckoutIntegration(userId, body)`

Fluxo de upsert:
1. Se `body.id` presente: UPDATE na integracao existente (exclui `id` do payload de update, filtra por `user_id`).
2. Se `body.id` ausente: INSERT com `user_id` do usuario autenticado.
3. Campos tipicamente enviados: `platform`, `webhook_secret`, `webhook_url`, `workspace_id`.
4. Retorna o registro salvo.

**PATCH /api/integrations/checkout/:id/toggle**

Controller: `IntegrationsController.toggleCheckout()`
Service: `IntegrationsService.toggleCheckoutIntegration(userId, id, isActive)`

- Atualiza apenas `is_active` para o valor informado.
- Filtro duplo: `id` e `user_id` (seguranca).

**DELETE /api/integrations/checkout/:id**

Controller: `IntegrationsController.deleteCheckout()`
Service: `IntegrationsService.deleteCheckoutIntegration(userId, id)`

- Remove o registro com filtro duplo: `id` e `user_id`.
- Retorna `{ success: true }`.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| CheckoutIntegrationsSection | `src/components/integrations/CheckoutIntegrationsSection.tsx` | Grid de plataformas com status e acoes |
| CheckoutConfigModal | `src/components/integrations/CheckoutConfigModal.tsx` | Modal de configuracao com URL, token e instrucoes |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useCheckoutIntegrations` | `src/hooks/useCheckoutIntegrations.ts` | Ver tabela abaixo |

**Retorno do useCheckoutIntegrations:**

| Propriedade | Tipo | Descricao |
|---|---|---|
| integrations | CheckoutIntegration[] | Integracoes filtradas pelo workspace ativo |
| loading | boolean | Se esta carregando dados |
| saving | boolean | Se esta salvando integracao |
| saveIntegration | (platform, token) => Promise<boolean> | Salva integracao com webhook_url gerada |
| toggleIntegration | (id, active) => Promise<void> | Ativa/desativa integracao |
| deleteIntegration | (id) => Promise<void> | Remove integracao |
| getIntegration | (platform) => CheckoutIntegration \| undefined | Busca integracao por plataforma |
| generateWebhookUrl | (platform) => string | Gera URL do webhook |
| refetch | () => Promise<void> | Recarrega lista |

**Logica de generateWebhookUrl:**
```typescript
const WEBHOOK_DOMAIN = 'https://api.sentinelatracker.com.br';
const generateWebhookUrl = (platform: CheckoutPlatform): string => {
  return `${WEBHOOK_DOMAIN}/webhook-${platform}`;
};
```

**Logica de saveIntegration:**
1. Valida que token nao esta vazio.
2. Gera URL do webhook.
3. Envia POST para `/api/integrations/checkout` com `{ platform, webhook_url, webhook_secret: token, workspace_id }`.
4. Invalida queries de workspaces para atualizar vinculacoes.
5. Exibe toast e recarrega lista.

**Filtragem por workspace:**
```typescript
const filteredIntegrations = useMemo(() => {
  if (!activeWorkspaceId || activeCheckoutIds.length === 0) return [];
  return integrations.filter(i => activeCheckoutIds.includes(i.id));
}, [integrations, activeWorkspaceId, activeCheckoutIds]);
```

### 6.3 Estado

| Estado | Tipo | Descricao |
|---|---|---|
| integrations | CheckoutIntegration[] | Todas as integracoes do usuario (antes do filtro) |
| loading | boolean | Carregando integracoes |
| saving | boolean | Salvando integracao |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Plataformas de checkout (9) | Externo | Enviam webhooks HTTP POST para a URL configurada |
| Webhook handlers (backend) | Consumidor | Processam o payload do webhook e criam registros em `sales` |
| workspace_checkout_integrations | Escrita | Auto-vinculacao ao workspace ativo |
| WorkspaceContext | Contexto | Fornece `activeCheckoutIds` para filtrar integracoes visiveis |
| React Query | Cache | Invalida cache de workspaces apos salvar integracao |
| ImpersonationContext | Contexto | Permite admin visualizar integracoes de outro usuario |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Token vazio | `saveIntegration` exibe toast "Token obrigatorio" e retorna false |
| Plataforma ja configurada | O POST com `body.id` presente faz update, nao duplica |
| Webhook recebido com integracao desativada | O handler de webhook deve verificar `is_active` antes de processar |
| Multiplas integracoes da mesma plataforma | Permitido pelo schema; cada uma pode ter token diferente (ex: dois produtos na Hotmart) |
| Workspace sem integracoes vinculadas | `filteredIntegrations` retorna vazio; grid mostra todas como nao configuradas |
| Erro ao salvar integracao | Toast "Erro ao salvar integracao" com mensagem do erro |
| Erro ao carregar integracoes | Toast "Erro ao carregar integracoes" com mensagem do erro |
| URL de webhook copiada incorretamente | URL e gerada automaticamente e nao editavel; botao de copiar garante formato correto |
| Plataforma nao listada no CHECK constraint | INSERT falha com erro de constraint; necessario migration para adicionar nova plataforma |

---

## 9. Checklist de Testes

- [ ] Configurar integracao Hotmart com token valido
- [ ] Configurar integracao Kiwify com token valido
- [ ] Configurar integracao Kirvano com token valido
- [ ] Configurar integracao Guru Digital com api_token
- [ ] Configurar integracao Perfect Pay
- [ ] Configurar integracao Ticto
- [ ] Configurar integracao PayT
- [ ] Configurar integracao Cakto
- [ ] Configurar integracao Hubla (copiar Token na aba Autenticacao)
- [ ] Configurar integracao CartPanda (copiar token do menu de iniciais)
- [ ] Configurar integracao GG Checkout (Secret definido pelo usuario nos dois lados)
- [ ] Configurar integracao LastLink para CADA produto (uma integracao por produto)
- [ ] Configurar integracao Eduzz (Chave de acesso copiada do painel)
- [ ] Configurar integracao Mundpay (URL completa com ?token=...)
- [ ] Configurar integracao Monetizze (Chave Unica do postback)
- [ ] Configurar integracao Greenn (Webhook Token global; configurar webhook em cada produto)
- [ ] Verificar que URL do webhook e gerada corretamente para cada plataforma
- [ ] Verificar que instrucoes sao exibidas corretamente para cada plataforma
- [ ] Tentar salvar com token vazio e verificar toast de erro
- [ ] Ativar e desativar integracao via toggle
- [ ] Remover integracao e confirmar exclusao
- [ ] Verificar filtragem por workspace ativo
- [ ] Verificar que `getIntegration(platform)` retorna a integracao correta
- [ ] Testar upsert: salvar integracao existente com novo token
- [ ] Verificar que `last_webhook_at` e atualizado quando webhook e recebido
- [ ] Testar comportamento com workspace sem integracoes vinculadas

---

## 10. Questoes Abertas

| # | Questao | Contexto |
|---|---|---|
| Q01 | Validacao de token | Nao ha validacao do token contra a plataforma de checkout no momento do cadastro. O usuario so descobre que o token esta errado quando o webhook falha |
| Q02 | CHECK constraint sincronizado | A migration `20260504200000_add_eduzz_mundpay_monetizze_greenn_to_platform_check.sql` adicionou as 4 novas plataformas; o CHECK total agora inclui 16 plataformas. Adicoes futuras devem entrar via nova migration |
| Q03 | Webhook URL por produto | Atualmente a URL e unica por plataforma. Algumas plataformas permitem configurar webhooks por produto, mas o Sentinela nao diferencia |
| Q04 | Rate limiting em webhooks | Nao ha rate limiting nos endpoints de webhook. Uma plataforma enviando muitos webhooks simultaneos pode sobrecarregar o sistema |
| Q05 | Retry de webhooks | O sistema possui `webhook_queue` para retry, mas a integracao entre o handler de webhook e a fila nao esta completamente documentada |
| Q06 | Campo api_token | Adicionado especificamente para Guru Digital. Outras plataformas usam apenas `webhook_secret`. A separacao de campos pode precisar de melhor organizacao |

### Detalhes das 16 Plataformas

| Plataforma | webhookPath | tokenLabel | Descricao |
|---|---|---|---|
| Hotmart | webhook-hotmart | Hottok | Plataforma de produtos digitais; token chamado "Hottok" nas configuracoes |
| Kiwify | webhook-kiwify | Token do Webhook | Plataforma de vendas; token gerado ao criar webhook |
| Kirvano | webhook-kirvano | Token do Webhook | Checkout otimizado; token nas configuracoes de integracao |
| Guru Digital | webhook-guru | API Token | Plataforma de infoprodutos; usa api_token separado do webhook_secret |
| Perfect Pay | webhook-perfectpay | Token do Webhook | Checkout e plataforma de vendas; token nas configuracoes de PostBack |
| Ticto | webhook-ticto | Token do Webhook | Checkout inteligente para infoprodutos; versao 2.0 (V2) recomendada |
| PayT | webhook-payt | Token do Webhook | Checkout para produtos fisicos e digitais; tipo "PayT V1" |
| Cakto | webhook-cakto | Token do Webhook | Checkout e vendas digitais; webhook configurado em Integracoes > Webhooks |
| Hubla | webhook-hubla | Token do Webhook | Comunidades e infoprodutos; token na aba "Autenticacao" da regra de webhook |
| CartPanda | webhook-cartpanda | Token do Webhook | Checkout; token no menu das iniciais (canto superior direito), com webhooks separados por evento |
| GG Checkout | webhook-ggcheckout | Token do Webhook | Checkout otimizado; campo "Secret" definido pelo usuario (mesmo valor em ambos os lados) |
| LastLink | webhook-lastlink | Token do Webhook | Assinaturas e infoprodutos; **integracao por produto** (cria-se uma integracao no Sentinela para cada produto rastreado) |
| Eduzz | webhook-eduzz | Chave de Acesso | Plataforma de produtos digitais; auth via header `x-eduzz-token` ou `x-signature` (HMAC SHA-256 do raw body) |
| Mundpay | webhook-mundpay | Token do Webhook | Checkout de pagamentos; auth via query param `?token=...` (Mundpay nao permite headers customizados) |
| Monetizze | webhook-monetizze | Chave Unica | Plataforma de afiliados; token chamado "Chave Unica" no painel da Monetizze |
| Greenn | webhook-greenn | Webhook Token | Plataforma de infoprodutos; **webhook configurado em cada produto** (token global por conta) |
