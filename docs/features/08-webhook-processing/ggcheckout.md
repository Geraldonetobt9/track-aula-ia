# Webhook - GGCheckout

## 1. Proposito

Processar notificacoes de vendas da plataforma GGCheckout, capturando dados de pagamento, cliente e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'ggcheckout'` e `is_active = true`.

## 3. Eventos Aceitos

| Evento GGCheckout | Acao |
|------------------|------|
| `pix.paid` | Criar venda com status `approved` |
| `card.paid` | Criar venda com status `approved` |
| `pix.refunded` | Criar venda com status `refunded` |
| `card.refunded` | Criar venda com status `refunded` |
| `pix.chargeback` | Criar venda com status `refunded` |
| `card.chargeback` | Criar venda com status `refunded` |

## 4. Mapeamento de Status

| Evento GGCheckout | Status Interno |
|------------------|---------------|
| `*.paid` | `approved` |
| `*.refunded`, `*.chargeback` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `payment.id` | `external_id` |
| `product.title` ou `products[0].title` | `product_name` |
| `customer.name` | `customer_name` |
| `customer.email` | `customer_email` |
| `customer.phone` | `customer_phone` |
| `customer.document` | `customer_doc` |
| Derivado de `getStateFromPhone()` | `customer_state` |
| `payment.paymentMethod` | `payment_method` |
| `createdAt._seconds` (Unix timestamp) | `sold_at` |

### Tracking
Objeto `params` com `utm_source`, `utm_medium`, `utm_campaign`, `utm_content`, `utm_term`, `sck`, `src`.

## 6. Regras de Negocio Especificas

### Data em formato Firestore
`{ _seconds, _nanoseconds }` convertido via `new Date(_seconds * 1000)`.

### Documento mascarado
CPF pode vir como `"***.763.104-**"`. Salvo como esta.

### Campos extras de tracking
`params.sck` e `params.src` salvos no `raw_data`.

## 7. Tratamento de Moeda

- Moeda fixa `'BRL'`
- Valor ja em reais

## 8. Extracao de Ad ID

Extraido de `params.utm_content` usando `extractNumericAdId()`.

## 9. Endpoint

```
POST /api/webhooks/ggcheckout
```
