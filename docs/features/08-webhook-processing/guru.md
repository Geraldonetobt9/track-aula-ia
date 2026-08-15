# Webhook - Guru

## 1. Proposito

Receber notificacoes de vendas da plataforma Guru e processa-las de forma assincrona via sistema de fila, garantindo resposta rapida ao webhook e resiliencia a falhas.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Body (primario) | `payload.api_token` ou `body.api_token` |
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body (fallback) | `payload.token` |
| Query param | `?token=` ou `?key=` |

### Validacao em dois estagios
1. **Na recepcao**: Token e extraido para validacao rapida (apenas verifica se existe)
2. **No processamento da fila**: Token e usado para buscar a integracao na tabela `checkout_integrations` onde `platform = 'guru'`, `is_active = true` e `webhook_secret = authToken`

## 3. Eventos Aceitos

Guru nao filtra por tipo de evento na recepcao. O filtro ocorre no processamento via mapeamento de status:

| Status Guru | Acao |
|------------|------|
| `approved`, `paid`, `completed` | Criar venda com status `approved` |
| `refused`, `refunded`, `chargedback`, `canceled` | Criar venda com status `refunded` ou atualizar existente |
| `waiting_payment`, `pending` | Criar venda com status `pending` |

## 4. Mapeamento de Status

| Status Guru | Status Interno |
|------------|---------------|
| `approved` | `approved` |
| `paid` | `approved` |
| `completed` | `approved` |
| `refused` | `refunded` |
| `refunded` | `refunded` |
| `chargedback` | `refunded` |
| `canceled` | `refunded` |
| `waiting_payment` | `pending` |
| `pending` | `pending` |

Status nao mapeados sao tratados como `pending`.

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `payload.id` | `external_id` |
| `payload.product.name` | `product_name` |
| `payload.contact.name` | `customer_name` |
| `payload.contact.email` | `customer_email` |
| `payload.contact.phone_local_code` + `payload.contact.phone_number` | `customer_phone` |
| `payload.contact.doc` | `customer_doc` |
| `payload.contact.state` ou `payload.infrastructure.region` (normalizado) | `customer_state` |
| `payload.contact.city` ou `payload.infrastructure.city` (normalizado) | `customer_city` |
| `payload.infrastructure.country` | `customer_country` |
| `payload.payment.method` | `payment_method` |
| `payload.payment.total` | `amount` |
| `payload.payment.currency` | `currency` |
| `payload.source.checkout_source` | `checkout_source` |
| `payload.dates.ordered_at` ou `payload.dates.confirmed_at` | `sold_at` |

### Metadata adicional
O objeto `infrastructure` do Guru fornece dados ricos de rastreamento:
- `ip`, `city`, `region`, `country`
- `user_agent`, `facebook_browser_id`, `ga_id`

## 6. Regras de Negocio Especificas

### Processamento via fila (unica plataforma)
Guru e a **unica plataforma** que usa o sistema de fila assincrona:

1. **Recepcao**: Webhook recebido, payload inteiro inserido na tabela `webhook_queue` com `status = 'pending'`
2. **Resposta**: Retorna `202 Accepted` imediatamente (nao `200`)
3. **Processamento**: Cron job (`process-webhook-queue`) busca itens pendentes a cada minuto
4. **Retries**: Maximo 3 tentativas com backoff exponencial (30s, 60s, 90s)

### Tratamento de duplicatas
- Vendas existentes (mesmo `external_id` + `user_id`) nao sao reinseridas
- Se o status mudou, a venda existente e atualizada

### Telefone do cliente
O telefone e montado concatenando `contact.phone_local_code` + `contact.phone_number`.

## 7. Tratamento de Moeda

- Moeda lida de `payment.currency`, padrao `'BRL'`
- Valor lido de `payment.total`
- Nao ha conversao de cambio ativa

## 8. Extracao de Ad ID

Guru usa os campos `source.utm_*` com uma logica especifica de extracao por pipe:

| Campo UTM | ID Extraido | Destino |
|-----------|------------|---------|
| `source.utm_content` | Ultimo numero da string separada por `\|` | `ad_id` |
| `source.utm_campaign` | Ultimo numero da string separada por `\|` | `adset_fb_id` |
| `source.utm_medium` | Ultimo numero da string separada por `\|` | `campaign_fb_id` |

A funcao `extractIdFromPipedString()` divide a string por `|` e retorna o ultimo segmento composto apenas por digitos.

### Hierarquia de match (via `matchSaleToAds`)
1. ad_id (de `utm_content`) -> tabela `ads` por `facebook_ad_id`
2. adSetFbId (de `utm_campaign`) -> tabela `ad_sets` por `facebook_adset_id`
3. campaignFbId (de `utm_medium`) -> tabela `campaigns` por `facebook_campaign_id`
4. Fallback: `utm_campaign` -> busca por `facebook_campaign_id` ou nome parcial

## 9. Deteccao de Teste

Guru nao possui deteccao explicita de webhooks de teste. A validacao e feita pelo campo `payload.id` (obrigatorio) e pelo token de autenticacao.

Se `payload.id` estiver ausente, retorna `400 Bad Request`.

## 10. Endpoint

```
POST /api/webhooks/guru
```

Respostas:
- `202` - Webhook enfileirado para processamento assincrono
- `400` - JSON invalido ou `payload.id` ausente
- `500` - Erro ao enfileirar

O processamento real ocorre na funcao `process-webhook-queue`, que pode gerar os seguintes resultados:
- `completed` - Venda processada com sucesso
- `failed` - Esgotou tentativas (3x) sem sucesso
