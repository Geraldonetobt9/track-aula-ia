# Webhook Greenn

## Endpoint
`POST /api/webhooks/greenn`

## Autenticação
Header `x-webhook-token` com o "Webhook Token" exibido pela Greenn em "Sistema > Tokens e API Key".

## Eventos processados
Greenn usa o campo `currentStatus` (e `event` + `type`):

| `currentStatus` | Status interno |
|---|---|
| `paid` | approved |
| `refunded` | refunded |
| `chargedback` | refunded |
| `canceled` | refunded |
| `unpaid` | refunded |

Eventos ignorados:
- `event=checkoutAbandoned`
- `type=lead`
- Qualquer outro `currentStatus` (ex: `waiting_payment`, `created`, `trialing`, `pending_payment`).

## Mapeamento de campos
| Sentinela `sales.<col>` | Greenn JSON |
|---|---|
| `external_id` | `greenn_{sale.id}` ou `greenn_{contract.id}` |
| `amount` | `sale.total` ou `sale.amount` ou `offer.amount`; se `use_commission_value`, usa `sale.seller_balance` |
| `product_name` | `product.name` ou `offer.name` ou `oferta` |
| `customer_name` | `client.name` |
| `customer_email` | `client.email` |
| `customer_phone` | `client.cellphone` |
| `customer_doc` | `client.document` ou `client.cpf_cnpj` |
| `customer_state` | `client.uf` |
| `customer_city` | `client.city` |
| `payment_method` | `sale.method` (CREDIT_CARD, PIX, BOLETO, etc.) |
| `currency` | `currency` (USD ou BRL) |
| `utm_*` | extraído de `saleMetas[]` por `meta_key` |
| `sold_at` | `sale.paid_at` ou `sale.created_at` |

## Particularidades
- **UTMs em `saleMetas`**: Greenn não envia UTMs em campos top-level. Eles estão em `saleMetas[]` como `{ meta_key: 'utm_source', meta_value: 'FB' }`. O processor monta um `metaMap` para extrair.
- **`fbclid` e `utm_id`** também vêm em `saleMetas` — preservados em `metadata`.
- **Integração por produto**: Greenn requer configurar o webhook em CADA produto, mas o token é global por conta. No Sentinela, basta UMA integração — o mesmo token recebe webhooks de todos os produtos.
- **Currency pode ser USD**: caso o produto seja vendido em outras moedas (ex: `currency=USD`). Sentinela preserva o valor original sem conversão.

## Payload de exemplo
`docs/webhook-payloads/greenn.json`
