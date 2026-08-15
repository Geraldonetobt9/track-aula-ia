# Webhook - Hubla

## 1. Proposito

Processar notificacoes de vendas da plataforma Hubla, capturando dados de fatura, assinatura e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'hubla'` e `is_active = true`.

## 3. Eventos Aceitos

| Evento Hubla | Acao |
|-------------|------|
| `invoice.payment_succeeded` | Criar venda com status `approved` |
| `refund_request.accepted` | Criar venda com status `refunded` |

Eventos fora desta lista sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Evento Hubla | Status Interno |
|-------------|---------------|
| `invoice.payment_succeeded` | `approved` |
| `refund_request.accepted` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `event.invoice.id` | `external_id` (fallback: `hubla_` + timestamp) |
| `event.product.name` ou `event.products[0].name` | `product_name` |
| `event.user.firstName + " " + event.user.lastName` | `customer_name` |
| `event.user.email` | `customer_email` |
| `event.user.phone` | `customer_phone` |
| `event.user.document` | `customer_doc` |
| `event.invoice.billingAddress.state` (normalizado para UF) | `customer_state` |
| `event.invoice.billingAddress.city` | `customer_city` |
| `event.invoice.billingAddress.countryCode` | `customer_country` (padrao: `'BR'`) |
| `event.invoice.paymentMethod` | `payment_method` |
| `event.invoice.currency` | `currency` (padrao: `'BRL'`) |
| `event.invoice.saleDate` | `sold_at` |

### Metadata adicional (salvo em `raw_data`)
- `invoice_id`, `subscription_id`, `seller_id`
- `installments`
- `subtotal_cents`, `discount_cents`, `installment_fee_cents`
- `coupon`, `ip`, `product_id`, `offers`
- `refund` (dados de reembolso quando aplicavel)

## 6. Regras de Negocio Especificas

### Calculo de valor
Valores vem em **centavos** no campo `amount.totalCents`. O sistema divide por 100.

### Estado do cliente
Hubla envia `billingAddress.state` que e normalizado para UF via `normalizeState()`. Fallback por DDD do telefone.

### Nome do cliente
Composto de `firstName` + `lastName` concatenados.

### Upsert em vez de insert
Usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda lida de `invoice.currency`, padrao `'BRL'`
- Valor em centavos (dividir por 100)

## 8. Extracao de Ad ID

Extraido de `firstPaymentSession.utm.content` usando `extractNumericAdId()`.

## 9. Deteccao de Teste

Nao ha deteccao explicita de eventos de teste.

## 10. Endpoint

```
POST /api/webhooks/hubla
```
