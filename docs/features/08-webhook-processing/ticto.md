# Webhook - Ticto

## 1. Proposito

Processar notificacoes de vendas da plataforma Ticto, extraindo dados de tracking e vinculando vendas aos anuncios do Facebook.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |
| Query param | `?token=` ou `?key=` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'ticto'` e `is_active = true`.

## 3. Eventos Aceitos

Ticto usa o campo `status` (nao `event`) para indicar o tipo de notificacao:

| Status Ticto | Acao |
|-------------|------|
| `authorized` | Criar venda com status `approved` |
| `approved` | Criar venda com status `approved` |
| `refunded` | Criar venda com status `refunded` |
| `chargeback` | Criar venda com status `refunded` |

Qualquer outro status e ignorado com `200 OK`.

## 4. Mapeamento de Status

| Status Ticto | Status Interno |
|-------------|---------------|
| `authorized` | `approved` |
| `approved` | `approved` |
| `refunded` | `refunded` |
| `chargeback` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `order.hash` | `external_id` (fallback: `ticto_` + timestamp) |
| `item.product_name` | `product_name` |
| `customer.name` | `customer_name` |
| `customer.email` | `customer_email` |
| `producer.phone` | `customer_phone` (v2.0 nao tem `customer.phone`) |
| `customer.cpf` ou `customer.cnpj` | `customer_doc` |
| `customer.address.state` | `customer_state` |
| `customer.address.city` | `customer_city` |
| `customer.is_foreign` ? `'OTHER'` : `'BR'` | `customer_country` |
| `payment_method` | `payment_method` |
| `order.order_date` | `sold_at` |

### Metadata adicional
- `order.transaction_hash`
- `order.installments`
- `item.product_id`, `item.offer_id`, `item.offer_name`, `item.offer_code`
- `shipping`, `bumps`, `subscriptions`
- `commission_type`

## 6. Regras de Negocio Especificas

### Calculo de valor
Os valores na Ticto vem em **centavos**:
```
amount = (order.paid_amount || item.amount || 0) / 100
```

### Telefone do cliente (v2.0)
Na versao 2.0 da API Ticto, o campo `customer.phone` nao esta disponivel. O sistema usa `producer.phone` como fallback.

### Clientes estrangeiros
Se `customer.is_foreign === true`, o pais e definido como `'OTHER'` em vez de `'BR'`.

### Data de venda
O campo `order.order_date` vem no formato local sem timezone. O sistema adiciona offset `-03:00` antes de converter para UTC.

### Upsert em vez de insert
Ticto usa `upsert` com conflito em `external_id,user_id`.

### Tracking: dupla fonte
O sistema busca UTMs em dois locais:
1. `tracking.*` (formato novo)
2. `url_params.query_params.*` (formato antigo/fallback)

## 7. Tratamento de Moeda

- Moeda fixa: `BRL`
- Valores em centavos (dividido por 100)
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido do campo `utm_content` (de `tracking` ou `query_params`):

1. Divide a string por `|` e `/`
2. Busca o primeiro segmento composto apenas por digitos com 6+ caracteres

Exemplo: `"vid34-d09-02|120245519580910309"` -> `"120245519580910309"`

### Match com anuncios
O match e feito via `matchSaleToAds()` usando:
- `utm_campaign` para campanhas
- `utm_content` para ad sets e ads
- `utm_term` como fallback

Nota: o parametro `adId` e passado como `null` ao `matchSaleToAds()` -- o ad_id extraido e salvo diretamente no campo `ad_id` da venda, enquanto o match de hierarquia usa os UTMs.

## 9. Deteccao de Teste

Ticto nao possui deteccao explicita de webhooks de teste. A filtragem e feita apenas pelo campo `status` -- status nao reconhecidos sao ignorados.

## 10. Endpoint

```
POST /api/webhooks/ticto
```

Respostas:
- `200` - Webhook processado (criado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `405` - Metodo HTTP nao permitido
- `500` - Erro interno
