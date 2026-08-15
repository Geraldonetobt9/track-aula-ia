# Webhook - PayT

## 1. Proposito

Processar notificacoes de vendas da plataforma PayT, utilizando validacao dupla de status (order + payment) e dados de tracking via campo `link.sources`.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |
| Query param | `?token=` ou `?key=` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'payt'` e `is_active = true`.

## 3. Eventos Aceitos

PayT usa uma combinacao de **status do pedido** e **status do pagamento**:

### Status do pedido (aprovacao)

| Status do Pedido | Acao |
|-----------------|------|
| `paid` | Criar venda com status `approved` |
| `billed` | Criar venda com status `approved` |

### Status do pagamento (reembolso)

| Status do Pagamento (`transaction.payment_status`) | Acao |
|-----------------------------------------------------|------|
| `refunded` | Criar venda com status `refunded` |
| `refunded_partial` | Criar venda com status `refunded` |
| `chargeback` | Criar venda com status `refunded` |
| `chargeback_presented` | Criar venda com status `refunded` |
| `one_click_buy_refunded` | Criar venda com status `refunded` |
| `one_click_buy_refunded_partial` | Criar venda com status `refunded` |

Se nenhum dos dois conjuntos casar, o webhook e ignorado com `200 OK`.

## 4. Mapeamento de Status

| Condicao | Status Interno |
|----------|---------------|
| `status` in [`paid`, `billed`] | `approved` |
| `transaction.payment_status` in [`refunded`, `refunded_partial`, `chargeback`, `chargeback_presented`, `one_click_buy_refunded`, `one_click_buy_refunded_partial`] | `refunded` |

A verificacao do status do pedido tem prioridade sobre o status do pagamento.

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `transaction_id` | `external_id` |
| `product.name` | `product_name` |
| `customer.name` | `customer_name` |
| `customer.email` (se `fake_email` for false) | `customer_email` |
| `customer.phone` | `customer_phone` |
| `customer.doc` | `customer_doc` |
| `customer.billing_address.state` (normalizado) | `customer_state` |
| `customer.billing_address.city` | `customer_city` |
| `customer.billing_address.country` | `customer_country` |
| `transaction.payment_method` | `payment_method` |
| `transaction.paid_at` ou `transaction.created_at` | `sold_at` |

### Metadata adicional
- `seller_id`, `type`, `tangible`
- `cart_recovered`, `cart_id`
- `transaction.installments`
- `product.code`, `product.sku`
- `link.title`
- `customer.code`
- `link.query_params.fbclid`

## 6. Regras de Negocio Especificas

### Calculo de valor
Os valores na PayT vem em **centavos**:
```
amount = (transaction.total_price || product.price || 0) / 100
```

### Email falso
PayT indica se o email e falso via campo `customer.fake_email`. Se `true`, o `customer_email` e salvo como `null`.

### UTMs via `link.sources`
Diferente de outras plataformas, PayT envia UTMs dentro do objeto `link.sources`:
- `link.sources.utm_source` ou `link.sources.src`
- `link.sources.utm_medium`
- `link.sources.utm_campaign`
- `link.sources.utm_content`
- `link.sources.utm_term`

Query params (incluindo `fbclid`) estao em `link.query_params`.

### Data de venda
Prioridade:
1. `transaction.paid_at` (data de pagamento)
2. `transaction.created_at` (data de criacao)
3. `new Date()` (fallback)

Datas vem no formato local sem timezone. O sistema adiciona offset `-03:00`.

### Upsert em vez de insert
PayT usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda fixa: `BRL`
- Valores em centavos (dividido por 100)
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido de `link.sources.utm_content` ou `link.sources.src`:

1. Tenta extrair de `utm_content` primeiro
2. Fallback: tenta extrair de `src`
3. Divide a string por `|`
4. Percorre de tras para frente
5. Retorna o primeiro segmento composto apenas por digitos com mais de 5 caracteres

Apos obter o ad_id, o match direto com a tabela `ads` e feito por `facebook_ad_id`, obtendo a hierarquia completa (ad -> ad_set -> campaign).

## 9. Deteccao de Teste

PayT envia um campo `test` no payload:

| Condicao | Verificacao |
|----------|-----------|
| Venda de teste | `payload.test === true` |

Webhooks de teste retornam `200 OK` com `ignored: true` e mensagem `"Venda de teste (homologacao)"`.

## 10. Endpoint

```
POST /api/webhooks/payt
```

Respostas:
- `200` - Webhook processado (criado, atualizado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
