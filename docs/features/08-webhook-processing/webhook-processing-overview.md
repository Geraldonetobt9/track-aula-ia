# Processamento de Webhooks - Visao Geral

## 1. Proposito

Receber notificacoes de vendas em tempo real de 16 plataformas de checkout (Hotmart, Kiwify, Kirvano, Guru, PerfectPay, Ticto, PayT, Cakto, Hubla, CartPanda, GG Checkout, LastLink, Eduzz, Mundpay, Monetizze, Greenn), normalizar os dados e registrar as vendas na tabela `sales` vinculando-as aos anuncios do Facebook Ads.

## 2. Plataformas Suportadas

| Plataforma | Autenticacao | Processamento |
|------------|-------------|---------------|
| Hotmart | Header `x-hotmart-hottok` / `x-hottok` | Direto (sincrono) |
| Kiwify | HMAC-SHA1 da assinatura no body/query | Direto (sincrono) |
| Kirvano | Header `x-kirvano-token` | Direto (sincrono) |
| Guru | Campo `api_token` no body | Via fila (assincrono) |
| PerfectPay | Token generico (headers/body/query) | Direto (sincrono) |
| Ticto | Token generico (headers/body/query) | Direto (sincrono) |
| PayT | Token generico (headers/body/query) | Direto (sincrono) |
| Cakto | Token generico (headers/body/query) | Direto (sincrono) |
| Hubla | Token generico (headers/body/query) | Direto (sincrono) |
| CartPanda | Token generico (headers/body/query) | Direto (sincrono) |
| GG Checkout | Secret definido pelo usuario | Direto (sincrono) |
| LastLink | Token generico (headers/body/query) | Direto (sincrono) |
| Eduzz | Header `x-eduzz-token` ou `x-signature` (HMAC SHA-256) | Direto (sincrono) |
| Mundpay | Query param `?token=...` (self-authenticating) | Direto (sincrono) |
| Monetizze | Header `x-monetizze-token` | Direto (sincrono) |
| Greenn | Header `x-webhook-token` | Direto (sincrono) |

## 3. Fluxo Compartilhado de Processamento

Todas as plataformas seguem o mesmo fluxo geral:

```
1. Receber POST com payload JSON
2. Validar evento (filtrar eventos nao aceitos)
3. Autenticar token (buscar checkout_integration correspondente)
4. Filtrar webhooks de teste
5. Parsear payload (extrair dados do cliente, produto, valor, UTMs)
6. Converter moeda para BRL (se necessario)
7. Verificar venda duplicada (por external_id + user_id)
   - Se existir: atualizar status (se mudou) e retornar
   - Se nao existir: inserir nova venda
8. Fazer match com anuncios do Facebook (ad_id -> ads -> ad_sets -> campaigns)
9. Atualizar timestamp da integracao (last_webhook_at)
10. Retornar resposta de sucesso
```

## 4. Endpoint

```
POST /api/webhooks/:platform
```

Onde `:platform` e um dos valores: `hotmart`, `kiwify`, `kirvano`, `guru`, `perfectpay`, `ticto`, `payt`, `cakto`, `hubla`, `cartpanda`, `ggcheckout`, `lastlink`, `eduzz`, `mundpay`, `monetizze`, `greenn`.

O controller recebe a requisicao e despacha para o processador correto baseado no parametro `platform`.

## 5. Extracao de Token (`extractWebhookToken`)

A funcao utilitaria `extractWebhookToken(req, payload, platform)` busca o token de autenticacao em multiplas fontes, nesta ordem de prioridade:

### Headers especificos por plataforma
- **Hotmart**: `x-hotmart-hottok`, `X-Hotmart-Hottok`, `x-hottok`
- **Kirvano**: `x-kirvano-token`
- **Guru**: campo `api_token` no body do payload

### Headers genericos (todas as plataformas)
- `x-webhook-token`
- `x-api-token`
- `authorization-token`

### Campos no body
- `payload.token`
- `payload.signature`
- `payload.hottok`
- `payload.api_token`

### Query parameters
Query parameters **nao** sao aceitos como fonte de token pelo helper `extractWebhookToken` (eles aparecem em logs de acesso e podem ser cacheados por proxies). Plataformas que enviam credenciais via querystring (ex: Kiwify, que envia o HMAC em `?signature=`) devem estar em `SELF_AUTHENTICATING_PLATFORMS` no controller — nesse caso o pre-check e pulado e o processador valida a assinatura diretamente.

### Comportamento quando nenhum token e encontrado
- Plataformas padrao: `WebhooksController` retorna `200 OK` com `{ success: false, message: 'Missing authentication token' }` e nao invoca o processador.
- Plataformas em `SELF_AUTHENTICATING_PLATFORMS` (`kiwify`, `n8n-profiles`): o pre-check e pulado e o processador assume a validacao. Ele pode aceitar, rejeitar ou responder com mensagem informativa, dependendo da logica interna.

## 6. Mapeamento Comum de Status

Todas as vendas sao normalizadas para 3 status internos:

| Status Interno | Significado |
|---------------|------------|
| `approved` | Venda aprovada/paga |
| `refunded` | Reembolso, chargeback ou cancelamento |
| `pending` | Aguardando pagamento (geralmente ignorado) |

Cada plataforma tem seu proprio mapeamento. Consulte a documentacao individual para detalhes.

## 7. Match com Anuncios do Facebook (`matchSaleToAds`)

O matching segue esta hierarquia de prioridade:

```
1. ad_id efetivo = adId || utmTerm || utmContent
2. Extrair ID numerico longo de strings compostas (ex: "vid34|120245519580910309")
3. Buscar na tabela ads por facebook_ad_id -> retorna ad + ad_set + campaign
4. Se nao achou, buscar na tabela ad_sets por facebook_adset_id
5. Se nao achou (Guru), tentar adSetFbId extraido de utm_campaign
6. Se nao achou (Guru), tentar campaignFbId extraido de utm_medium
7. Fallback: buscar campaign por facebook_campaign_id ou nome parcial via utm_campaign
8. Se nada casar: venda organica (sem vinculacao)
```

### Extracao de Ad ID numerico

IDs numericos do Facebook sao extraidos de strings compostas usando separadores `|` e `/`. O sistema busca a ultima parte que seja composta apenas por digitos e tenha mais de 5 caracteres.

Exemplos:
- `"vid34-d09-02|120245519580910309"` -> `"120245519580910309"`
- `"creative/120245519580910309"` -> `"120245519580910309"`
- `"120245519580910309"` -> `"120245519580910309"` (passthrough)

## 8. Sistema de Fila (`webhook_queue`)

Usado atualmente apenas pelo **Guru** para processamento assincrono.

### Tabela `webhook_queue`

| Coluna | Tipo | Descricao |
|--------|------|-----------|
| `id` | UUID | Identificador unico |
| `platform` | text | Plataforma de origem (ex: `guru`) |
| `payload` | jsonb | Payload completo do webhook |
| `status` | text | `pending`, `completed`, `failed` |
| `attempts` | integer | Numero de tentativas realizadas |
| `max_attempts` | integer | Maximo de tentativas (padrao: 3) |
| `error_message` | text | Ultima mensagem de erro |
| `next_retry_at` | timestamp | Proximo horario de retry |
| `processed_at` | timestamp | Horario de processamento bem-sucedido |
| `created_at` | timestamp | Horario de criacao |

### Processador da Fila (`process-webhook-queue`)

- **Trigger**: Cron job executado a cada minuto
- **Batch size**: 10 itens por execucao
- **Max tentativas**: 3
- **Backoff exponencial**: `tentativa * 30 segundos` (30s, 60s, 90s)
- **Selecao**: Itens com `status = 'pending'` e `next_retry_at <= now()`
- **Ordenacao**: `created_at ASC` (FIFO)
- **Apos sucesso**: Status atualizado para `completed` com `processed_at`
- **Apos falha**: Incrementa `attempts`, calcula `next_retry_at`, marca como `failed` se esgotou tentativas

## 9. Conversao de Moeda

Aplicavel principalmente ao **Hotmart** que suporta vendas internacionais.

### Estrategia de conversao (Hotmart)
1. **Taxa da Hotmart**: Usar `conversion_rate` da comissao do PRODUCER (quando disponivel)
2. **Fallback API**: Buscar taxa de cambio via API externa (`getExchangeRate`)
3. **Funcao**: `convertToBRL(amount, rate)` multiplica o valor pela taxa

### Demais plataformas
- Operam exclusivamente em BRL
- Campo `currency` padrao: `'BRL'`
- Kiwify: `product_base_price` com `product_base_price_currency === 'BRL'` para vendas internacionais (valor ja em BRL)

## 10. Normalizacao de Dados de Localizacao

### Estado (`normalizeState`)
- Normaliza abreviacoes e nomes completos de estados brasileiros para a sigla UF padrao

### Cidade (`normalizeCity`)
- Normaliza nomes de cidades removendo acentos e padronizando formatacao

### Fallback por DDD (`getStateFromPhone`)
- Se o estado nao for encontrado no endereco, o sistema extrai o DDD do telefone do cliente e mapeia para o estado correspondente usando a tabela `ddd-to-state`

### Clientes internacionais (Hotmart)
- Se o pais nao for Brasil, o nome do pais e usado como `customer_state` para exibicao regional

## Arquivos Relacionados

### Edge Functions (Supabase)
- `supabase/functions/webhook-hotmart/index.ts`
- `supabase/functions/webhook-kiwify/index.ts`
- `supabase/functions/webhook-kirvano/index.ts`
- `supabase/functions/webhook-guru/index.ts`
- `supabase/functions/webhook-perfectpay/index.ts`
- `supabase/functions/webhook-ticto/index.ts`
- `supabase/functions/webhook-payt/index.ts`
- `supabase/functions/webhook-cakto/index.ts`
- `supabase/functions/process-webhook-queue/index.ts`

### Helpers compartilhados
- `supabase/functions/_shared/extract-webhook-token.ts`
- `supabase/functions/_shared/match-sale-to-ads.ts`
- `supabase/functions/_shared/normalize-state.ts`
- `supabase/functions/_shared/ddd-to-state.ts`
- `supabase/functions/_shared/currency.ts`
