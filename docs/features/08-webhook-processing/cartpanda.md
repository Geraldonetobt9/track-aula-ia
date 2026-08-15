# Webhook - CartPanda

## 1. Proposito

Processar notificacoes de vendas da plataforma CartPanda, capturando dados de pedido, cliente e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'cartpanda'` e `is_active = true`.

## 3. Eventos Aceitos

| Evento CartPanda | Acao |
|-----------------|------|
| `order.paid` | Criar venda com status `approved` |
| `order.refunded` | Criar venda com status `refunded` |

## 4. Mapeamento de Status

| Evento CartPanda | Status Interno |
|-----------------|---------------|
| `order.paid` | `approved` |
| `order.refunded` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `order.id` (string) | `external_id` |
| `order.line_items[0].title` | `product_name` |
| `order.customer.full_name` | `customer_name` |
| `order.customer.email` ou `order.email` | `customer_email` |
| `order.customer.phone` | `customer_phone` |
| `order.customer.cpf` | `customer_doc` |
| Derivado de `getStateFromPhone()` | `customer_state` |
| (nao disponivel) | `customer_city` = `null` |
| `order.payment.payment_type` | `payment_method` |
| `order.created_at` (com offset `-03:00`) | `sold_at` |

### Tracking (UTMs)
Array `order.tracking_parameters` com objetos `{parameter_name, parameter_value}`.

## 6. Regras de Negocio Especificas

### Calculo de valor
Valor ja em reais no campo `payment.amount`.

### Datas em horario local
Formato `"2026-01-08 19:43:27"` sem timezone. Sistema adiciona `-03:00`.

### Multiplos line_items
Usa o titulo do primeiro item como `product_name`.

## 7. Tratamento de Moeda

- Moeda de `order.currency`, padrao `'BRL'`
- Valor ja em reais

## 8. Extracao de Ad ID

Extraido de `utm_content` do array `tracking_parameters` usando `extractNumericAdId()`.

## 9. Endpoint

```
POST /api/webhooks/cartpanda
```
