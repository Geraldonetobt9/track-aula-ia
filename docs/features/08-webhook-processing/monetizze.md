# Webhook Monetizze

## Endpoint
`POST /api/webhooks/monetizze`

## Autenticação
Header `x-monetizze-token` (ou `monetizze-token`) com a "Chave Única" exibida pela Monetizze após salvar o postback.

## Eventos processados (códigos de status)
Monetizze usa códigos numéricos (`codigo_status` ou `postback_evento`):

| Código | Descrição | Status interno |
|---|---|---|
| 2 | Aprovada | approved |
| 6 | Completa | approved |
| 101 | Assinatura Ativa | approved |
| 3 | Cancelada | refunded |
| 4 | Devolvida (Reembolso) | refunded |
| 102 | Assinatura Inadimplente | refunded |
| 103 | Assinatura Cancelada | refunded |

Outros códigos (1, 5, 104, etc.) são respondidos com 200 + `ignored=true`.

## Mapeamento de campos
| Sentinela `sales.<col>` | Monetizze JSON |
|---|---|
| `external_id` | `monetizze_{venda.codigo}` (ou `codigo_venda`, ou `chave_unica`) |
| `amount` | `venda.valor`; se `use_commission_value`, usa `venda.valorRecebido` |
| `product_name` | `produto.nome` ou `produtos[0].nome` |
| `customer_name` | `comprador.nome` |
| `customer_email` | `comprador.email` |
| `customer_phone` | `comprador.telefone` |
| `customer_doc` | `comprador.cnpj_cpf` |
| `customer_state` | `comprador.estado` |
| `customer_city` | `comprador.cidade` |
| `payment_method` | `venda.formaPagamento` ou `venda.meioPagamento` |
| `currency` | `BRL` (Monetizze sempre BRL) |
| `utm_*` | `venda.utm_*` |
| `sold_at` | `venda.dataFinalizada` ou `venda.dataInicio` |

## Particularidades
- `venda.valor` é **string** (ex: `"157.00"`) — sempre `parseFloat`.
- `comprador.estado` já vem como UF (ex: `"MG"`).
- `assinatura` é preservada em `metadata` (status, parcelas, etc.).
- Comissões e afiliados são preservados em `metadata.afiliados` / `metadata.comissoes`.

## Payload de exemplo
`docs/webhook-payloads/monetizze.json`
