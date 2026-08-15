# Webhook - Kiwify

## 1. Proposito

Processar notificacoes de vendas da plataforma Kiwify, utilizando validacao por assinatura HMAC-SHA1 para garantir autenticidade.

## 2. Autenticacao

Kiwify utiliza **HMAC-SHA1** para autenticacao, diferente de todas as outras plataformas.

### Fluxo de validacao
1. A assinatura e recebida via query parameter `?signature=` (formato padrao documentado pela Kiwify) ou via campo `signature` no body do JSON (formato de vendas internacionais que envolve o pedido em `{ url, signature, order }`)
2. O controller (`WebhooksController`) **nao** rejeita requisicoes da Kiwify por falta de token — a plataforma esta na lista `SELF_AUTHENTICATING_PLATFORMS`, entao o processador valida a autenticacao integralmente
3. O `KiwifyProcessor` carrega **todas** as integracoes Kiwify ativas
4. Para cada integracao, calcula `HMAC-SHA1(webhook_secret, rawBody)` em hexadecimal
5. Compara o hash computado com a assinatura recebida
6. A primeira integracao cuja assinatura corresponda e usada

> Por que a excecao no controller? O helper `extractWebhookToken` so olha em headers e body (query params foram removidos para evitar vazamento em logs). A Kiwify, porem, envia a assinatura em querystring por design. Como a assinatura e um HMAC por payload (nao um token reutilizavel), confiar ao processador a validacao completa nao introduz risco de credencial vazada.

### Calculo da assinatura
```
HMAC-SHA1(secret=webhook_secret, message=raw_request_body) -> hex string
```

Se nenhuma assinatura corresponder, retorna `401 Invalid signature`.

## 3. Eventos Aceitos

Kiwify nao envia um campo `event` explicito. O processamento e baseado no `order_status`:

| Status do Pedido | Acao |
|-----------------|------|
| `paid`, `approved`, `completed` | Criar venda com status `approved` |
| `refunded`, `chargedback`, `cancelled` | Criar venda com status `refunded` ou atualizar existente |
| `waiting`, `pending` | Ignorado (skip com `200 OK`) |

Vendas com status `pending` sao explicitamente ignoradas e nao inseridas.

## 4. Mapeamento de Status

| Status Kiwify | Status Interno |
|--------------|---------------|
| `paid` | `approved` |
| `approved` | `approved` |
| `completed` | `approved` |
| `refunded` | `refunded` |
| `chargedback` | `refunded` |
| `cancelled` | `refunded` |
| `waiting` | `pending` |
| `pending` | `pending` |

Status nao mapeados sao tratados como `pending`.

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `order_id` ou `subscription.id` | `external_id` |
| `Product.product_name` ou `product.name` ou `product_name` | `product_name` |
| `Customer.full_name` ou `customer.name` | `customer_name` |
| `Customer.email` ou `customer.email` | `customer_email` |
| `Customer.mobile` ou `customer.phone` | `customer_phone` |
| `Customer.address.state` (normalizado) | `customer_state` |
| `Customer.address.city` (normalizado) | `customer_city` |
| `Customer.address.country` | `customer_country` |
| `payment_method` | `payment_method` |
| `created_at` ou `approved_date` | `sold_at` |

### Nota sobre case dos campos
Kiwify usa nomenclatura inconsistente: `Customer` (maiusculo) e `customer` (minusculo), `Product` e `product`, `TrackingParameters` e `tracking_parameters`. O sistema verifica ambos.

### Vendas internacionais
Kiwify envolve vendas internacionais sob o campo `order`. Se `bodyRaw.order` existir, todos os dados sao extraidos de dentro dele.

## 6. Regras de Negocio Especificas

### Calculo de valor
1. **Fonte do valor (em ordem de prioridade)**:
   1. `commissions.product_base_price` + `commissions.product_base_price_currency`
   2. `commissions.charge_amount` + `commissions.currency`
   3. `product.price` (assume BRL)
   4. `sale_amount` (assume BRL)
2. **Valores em string**: Strings como `"49,15"` ou `"1.049,15"` sao parseadas removendo separador de milhar e substituindo virgula por ponto
3. **Valores em centavos**: Inteiros >= 100 sao divididos por 100 (ex: `4700` -> `R$ 47,00`, `990` USD -> `$9,90`)
4. **Conversao para BRL**: se a moeda original nao for BRL (ex: USD, COP), o sistema busca a taxa via `getExchangeRate()` e converte com `convertToBRL()`. O valor persistido em `sales.amount` fica sempre em BRL.
5. **Comissao (`use_commission_value`)**: usa `commissions.my_commission` com a moeda de `commissions.settlement_amount_currency`. Se diferente de BRL, converte antes de persistir.

### Tratamento de datas
Kiwify envia datas no horario local de Brasilia sem timezone (ex: `"2026-02-17 09:39"`). O sistema adiciona o offset `-03:00` antes de converter para UTC/ISO.

### Ad ID no fallback
Se nenhum `ad_id` explicito for encontrado nos tracking parameters, o sistema tenta usar `utmTerm || utmContent || utmSource` como valor de `ad_id`.

## 7. Tratamento de Moeda

- Moeda persistida: **sempre `BRL`** (campo `sales.currency`).
- A Kiwify pode enviar valores em USD, COP, EUR e outras moedas (campos `product_base_price_currency`, `commissions.currency`, `settlement_amount_currency`).
- Quando a moeda original nao e BRL, o sistema busca a taxa de cambio via `shared/helpers/currency.ts::getExchangeRate()` (API `exchangerate-api.com` com fallback para `open.er-api.com` e hardcode USD=5.0 em ultimo caso) e converte com `convertToBRL()`.
- Metadata da venda armazena `original_currency`, `original_amount`, `price_source`, `exchange_rate` e `converted_amount_brl` para auditoria da conversao.

## 8. Extracao de Ad ID

Utiliza a funcao compartilhada `extractAdId(tracking)` com a seguinte prioridade:

| Prioridade | Campo de Tracking |
|-----------|------------------|
| 1 | `tracking.ad_id` |
| 2 | `tracking.utm_term` |
| 3 | `tracking.utm_content` |
| 4 | `tracking.src` |
| 5 | `tracking.sck` |

O objeto `tracking` e lido de `TrackingParameters` ou `tracking_parameters`.

Apos obter o ad_id, o match com anuncios do Facebook e feito via `matchSaleToAds()`.

## 9. Deteccao de Teste

Kiwify nao tem deteccao explicita de webhooks de teste no codigo. A validacao HMAC-SHA1 impede que webhooks nao assinados sejam processados.

Se a assinatura nao for fornecida (campo `signature` ausente), retorna `200 OK` com mensagem informativa (comportamento de endpoint ativo).

## 10. Endpoint

```
POST /api/webhooks/kiwify
```

Respostas:
- `200` - Webhook processado (criado, atualizado ou ignorado)
- `400` - Order ID ausente
- `401` - Assinatura invalida ou nenhuma integracao encontrada
- `405` - Metodo HTTP nao permitido
- `500` - Erro interno
