# Webhook Eduzz

## Endpoint
`POST /api/webhooks/eduzz`

## Autenticação
Eduzz envia um dos dois:
- **Header `x-eduzz-token`** com a Chave de Acesso configurada na integração (`webhook_secret`).
- **Header `x-signature`** com HMAC SHA-256 do raw body, usando `webhook_secret` como chave.

O processor valida primeiro se o token recebido bate diretamente com `webhook_secret`. Se não, calcula o HMAC do `rawBody` e compara. Se nenhum bater, retorna 401.

## Eventos processados
| Evento Eduzz | Status interno |
|---|---|
| `myeduzz.invoice_paid` | approved |
| `myeduzz.invoice_refunded` | refunded |
| `myeduzz.invoice_canceled` | refunded |
| `myeduzz.invoice_expired` | refunded |
| `myeduzz.invoice_refused` | refunded |
| `myeduzz.invoice_chargeback` | refunded |

Webhooks de teste (`event=ping`, `test=true`, ou `producer.originSecret === 'originsecrettest'`) são respondidos com 200 + `ignored=true`.

## Mapeamento de campos
| Sentinela `sales.<col>` | Eduzz JSON |
|---|---|
| `external_id` | `eduzz_{data.id}` |
| `amount` | `data.paid.value` ou `data.price.value` |
| `product_name` | `data.items[0].name` ou `data.offer.name` |
| `customer_name` | `data.buyer.name` ou `data.student.name` |
| `customer_email` | `data.buyer.email` |
| `customer_phone` | `data.buyer.cellphone` ou `data.buyer.phone` |
| `customer_doc` | `data.buyer.document` |
| `payment_method` | `data.payment.method` ou `data.paymentMethod` |
| `currency` | `data.paid.currency` (default `BRL`) |
| `utm_*` | `data.utm.*` |
| `sold_at` | `data.paidAt` ou `data.createdAt` |

## Refund handling
Se status é refunded, busca a venda original por `external_id`. Se não achar, faz fallback via `findAndRefundOriginalSale` por email + product_name + integration.

## Payload de exemplo
`docs/webhook-payloads/eduzz.json`
