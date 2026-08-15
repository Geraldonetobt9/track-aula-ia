# Webhook - PerfectPay

## 1. Proposito

Processar notificacoes de vendas da plataforma PerfectPay, utilizando codigos numericos de status (enums) e metadados de UTM para vinculacao com anuncios.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |
| Query param | `?token=` ou `?key=` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'perfectpay'` e `is_active = true`.

## 3. Eventos Aceitos

PerfectPay usa codigos numericos (`sale_status_enum`) em vez de strings:

| Codigo | Significado | Acao |
|--------|-----------|------|
| `2` | Aprovado | Criar venda com status `approved` |
| `8` | Completo | Criar venda com status `approved` |
| `10` | Aprovado (alternativo) | Criar venda com status `approved` |
| `6` | Reembolsado | Criar venda com status `refunded` |
| `7` | Chargeback | Criar venda com status `refunded` |
| `9` | Cancelado | Criar venda com status `refunded` |

Codigos fora desta lista sao ignorados com `200 OK` e mensagem explicativa.

## 4. Mapeamento de Status

| `sale_status_enum` | Status Interno |
|-------------------|---------------|
| `2` | `approved` |
| `8` | `approved` |
| `10` | `approved` |
| `6` | `refunded` |
| `7` | `refunded` |
| `9` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `code` | `external_id` |
| `product.name` | `product_name` |
| `customer.full_name` | `customer_name` |
| `customer.email` | `customer_email` |
| `customer.phone_area_code` + `customer.phone_number` | `customer_phone` |
| `customer.identification_number` | `customer_doc` |
| `customer.state` (normalizado) | `customer_state` |
| `customer.city` | `customer_city` |
| `customer.country` | `customer_country` |
| `sale_amount` + `currency_enum_key` (convertido para BRL) | `amount` |
| `date_created` | `sold_at` |

### Metodo de pagamento
PerfectPay usa dois enums para metodo de pagamento:

**`payment_type_enum`**:

| Codigo | Metodo |
|--------|--------|
| 1 | `credit_card` |
| 2 | `boleto` |
| 3 | `paypal` |
| 4 | `credit_card_recurrent` |
| 5 | `free` |
| 6 | `credit_card_upsell` |

**`payment_method_enum`** (fallback):

| Codigo | Bandeira |
|--------|---------|
| 1 | `visa` |
| 2 | `boleto` |
| 3 | `amex` |
| 4 | `elo` |
| 5 | `hipercard` |
| 6 | `mastercard` |
| 7 | `melicard` |

## 6. Regras de Negocio Especificas

### UTMs via campo `metadata`
Diferente de outras plataformas, PerfectPay envia UTMs dentro de `payload.metadata`:
- `metadata.utm_source` ou `metadata.src`
- `metadata.utm_medium`
- `metadata.utm_campaign`
- `metadata.utm_content`
- `metadata.utm_term`

### Telefone do cliente
Montado concatenando `customer.phone_area_code` + `customer.phone_number`.

### Fallback de estado por DDD
Se o estado nao estiver disponivel no payload:
1. Tenta `getStateFromDDD(customer.phone_area_code)` usando apenas o codigo de area
2. Fallback: `getStateFromPhone(customerPhone)` usando o telefone completo

### Upsert em vez de insert
PerfectPay usa `upsert` com conflito em `external_id,user_id`, permitindo atualizacoes automaticas em caso de reenvio.

### Data de venda
O campo `date_created` vem no formato local sem timezone (ex: `"2026-03-15 14:30:00"`). O sistema adiciona offset `-03:00` antes de converter para UTC.

## 7. Tratamento de Moeda

- Moeda persistida: **sempre `BRL`** (campo `sales.currency`).
- A PerfectPay envia `currency_enum_key` no payload (ex: `"USD"`, `"BRL"`) — vendas internacionais sao comuns em mercados como Paraguai, Colombia e Mexico.
- Quando `currency_enum_key !== 'BRL'`, o sistema busca a taxa via `shared/helpers/currency.ts::getExchangeRate()` e converte `sale_amount` com `convertToBRL()` antes de persistir.
- Comissao (`use_commission_value`): usa `commission[].commission_amount` do produtor com o `currency_enum_key` da propria comissao; se nao for BRL, converte.
- Metadata armazena `original_currency`, `original_amount`, `exchange_rate` e `converted_amount_brl` para auditoria.

## 8. Extracao de Ad ID

O ad_id e extraido do campo `utm_content` (via `metadata.utm_content`):

1. Divide a string por `|`
2. Percorre de tras para frente
3. Retorna o primeiro segmento composto apenas por digitos com mais de 5 caracteres

Exemplo: `"vid34-d09-02|120245519580910309"` -> `"120245519580910309"`

Apos obter o ad_id, o match direto com a tabela `ads` e feito por `facebook_ad_id`, obtendo `ad_set_id` e `campaign_id` da hierarquia.

## 9. Deteccao de Teste

PerfectPay nao possui deteccao explicita de webhooks de teste. A filtragem e feita pelo `sale_status_enum` -- codigos nao reconhecidos sao ignorados.

## 10. Endpoint

```
POST /api/webhooks/perfectpay
```

Respostas:
- `200` - Webhook processado (criado, atualizado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
