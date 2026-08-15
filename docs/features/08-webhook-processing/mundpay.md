# Webhook Mundpay

## Endpoint
`POST /api/webhooks/mundpay?token=<seu-token>`

## Autenticação
Mundpay **não permite headers customizados** no painel de configuração de webhook. Por isso, o token é passado como query param (`?token=...`) na própria URL do webhook.

O usuário gera um token aleatório no Sentinela (botão "Gerar token") e cola a URL completa (já com `?token=...`) no campo "Webhook URL" da Mundpay.

> **Nota de segurança:** query-param tokens aparecem em logs de acesso HTTP. O usuário pode rotacionar o token a qualquer momento via Edit Integration.

A plataforma é registrada como `SELF_AUTHENTICATING_PLATFORMS` no controller — o token é validado dentro do processor, não no `extractWebhookToken`.

## Eventos processados
| `event_type` (ou `status`) | Status interno |
|---|---|
| `order.paid` (`status=paid`) | approved |
| `order.refunded` (`status=refunded`) | refunded |
| `order.chargedback` (`status=chargedback`) | refunded |

## Mapeamento de campos
| Sentinela `sales.<col>` | Mundpay JSON |
|---|---|
| `external_id` | `mundpay_{id}` |
| `amount` | `amount / 100` (cents → reais); se `use_commission_value`, usa `net_amount / 100` |
| `product_name` | `offers[0].name` ou `offers[0].product.name` |
| `customer_name` | `customer.name` |
| `customer_email` | `customer.email` |
| `customer_phone` | `customer.phone` |
| `customer_doc` | `customer.document` |
| `customer_state` | `customer.location.state` ou via DDD do telefone |
| `customer_city` | `customer.location.city` |
| `customer_country` | `customer.location.country` (default `BR`) |
| `payment_method` | `payment_method` |
| `currency` | `currency` (default `BRL`) |
| `utm_*` | `tracking.utm_*` |
| `sold_at` | `paid_at` ou `created_at` |

## Particularidades
- Mundpay envia `offers` como array OU como objeto (`{"0": {...}}`). O processor normaliza.
- Mundpay envia `amount` em **centavos** (string ou número). Sempre divide por 100.
- Tracking inclui `sck`, `xcod`, `fbclid`, `utm_id` — todos preservados em `metadata`.

## Payload de exemplo
`docs/webhook-payloads/mundpay.json`
