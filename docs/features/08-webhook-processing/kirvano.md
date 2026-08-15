# Webhook - Kirvano

## 1. Proposito

Processar notificacoes de vendas da plataforma Kirvano, normalizando o payload e vinculando vendas aos anuncios do Facebook.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Header (especifico) | `x-kirvano-token` |
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |
| Query param | `?token=` ou `?key=` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'kirvano'` e `is_active = true`.

## 3. Eventos Aceitos

Kirvano nao envia um campo `event`. O processamento e baseado no campo `status` da venda:

| Status da Venda | Acao |
|----------------|------|
| `approved`, `paid`, `completed` | Criar venda com status `approved` |
| `refunded`, `chargeback`, `cancelled` | Criar venda com status `refunded` ou atualizar existente |
| `pending`, `waiting` | Criar venda com status `pending` |

Diferente de Kiwify, vendas com status `pending` nao sao ignoradas (sao inseridas).

## 4. Mapeamento de Status

| Status Kirvano | Status Interno |
|---------------|---------------|
| `approved` | `approved` |
| `paid` | `approved` |
| `completed` | `approved` |
| `refunded` | `refunded` |
| `chargeback` | `refunded` |
| `cancelled` | `refunded` |
| `pending` | `pending` |
| `waiting` | `pending` |

Status nao mapeados sao tratados como `pending`.

## 5. Extracao de Dados

O payload do Kirvano pode vir em diferentes formatos. O sistema busca os dados em multiplos caminhos:

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `sale.transaction_id` ou `sale.sale_id` ou `sale.id` ou `body.transaction_id` | `external_id` |
| `product.name` ou `sale.product_name` | `product_name` |
| `customer.name` ou `customer.full_name` | `customer_name` |
| `customer.email` | `customer_email` |
| `customer.phone` | `customer_phone` |
| `buyer.address.state` ou `customer.address.state` (normalizado) | `customer_state` |
| `buyer.address.city` ou `customer.address.city` (normalizado) | `customer_city` |
| `buyer.address.country` ou `customer.address.country` | `customer_country` |
| `sale.payment_method` ou `body.payment_method` | `payment_method` |
| `sale.date` ou `sale.created_at` ou `body.created_at` | `sold_at` |

### Resolucao de objetos aninhados
O sistema verifica multiplos caminhos para cada objeto:
- **sale**: `body.sale` -> `body.data.sale` -> `body` (raiz)
- **customer**: `body.customer` -> `body.data.customer` -> `sale.customer`
- **product**: `body.product` -> `body.data.product` -> `sale.product`
- **tracking**: `body.tracking` -> `body.data.tracking` -> `sale.tracking`

## 6. Regras de Negocio Especificas

### Calculo de valor
O valor e lido diretamente de `sale.amount` ou `sale.value` ou `body.amount`. Nao ha divisao por 100 (o valor ja vem em reais).

### Tratamento de duplicatas
- Vendas existentes (mesmo `external_id` + `user_id`) nao sao reinseridas
- Se o status mudou, a venda existente e atualizada

### Ad ID no fallback
Se nenhum `ad_id` explicito for encontrado, usa `utmTerm || utmContent` como valor de `ad_id`.

## 7. Tratamento de Moeda

- Moeda lida de `sale.currency`, padrao `'BRL'`
- Nao ha conversao de cambio (todas as vendas sao tratadas como BRL)

## 8. Extracao de Ad ID

Utiliza a funcao compartilhada `extractAdId(tracking)`:

| Prioridade | Campo de Tracking |
|-----------|------------------|
| 1 | `tracking.ad_id` |
| 2 | `tracking.utm_term` |
| 3 | `tracking.utm_content` |
| 4 | `tracking.src` |
| 5 | `tracking.sck` |

O match com anuncios e feito via `matchSaleToAds()`.

## 9. Deteccao de Teste

Kirvano nao possui deteccao explicita de webhooks de teste. A validacao e feita apenas pelo token de autenticacao.

Se nenhum token for encontrado na requisicao, retorna `200 OK` com mensagem informativa.

## 10. Endpoint

```
POST /api/webhooks/kirvano
```

Respostas:
- `200` - Webhook processado (criado, atualizado ou ignorado)
- `400` - Transaction ID ausente
- `401` - Token invalido ou integracao nao encontrada
- `405` - Metodo HTTP nao permitido
- `500` - Erro interno
