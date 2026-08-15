# Webhook - Hotmart

## 1. Proposito

Processar notificacoes de vendas aprovadas, reembolsos, cancelamentos e chargebacks da plataforma Hotmart, incluindo vendas internacionais com conversao de moeda.

## 2. Autenticacao

O token e enviado pela Hotmart via header HTTP proprietario:

| Fonte | Campo |
|-------|-------|
| Header (primario) | `x-hotmart-hottok` ou `X-Hotmart-Hottok` |
| Header (alternativo) | `x-hottok` |
| Body (fallback) | `payload.hottok` |
| Headers genericos | `x-webhook-token`, `x-api-token` |
| Query param | `?token=` ou `?key=` |

O token e comparado com o campo `webhook_secret` da tabela `checkout_integrations` onde `platform = 'hotmart'` e `is_active = true`.

## 3. Eventos Aceitos

| Evento Hotmart | Acao |
|---------------|------|
| `PURCHASE_APPROVED` | Criar venda com status `approved` |
| `PURCHASE_COMPLETE` | Criar venda com status `approved` |
| `PURCHASE_REFUNDED` | Criar venda com status `refunded` ou atualizar existente |
| `PURCHASE_CANCELED` | Criar venda com status `refunded` ou atualizar existente |
| `PURCHASE_PROTEST` | Criar venda com status `refunded` ou atualizar existente |
| `PURCHASE_CHARGEBACK` | Criar venda com status `refunded` ou atualizar existente |

Eventos fora desta lista sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Status Hotmart | Status Interno |
|---------------|---------------|
| `PURCHASE_APPROVED` | `approved` |
| `PURCHASE_COMPLETE` | `approved` |
| `PURCHASE_REFUNDED` | `refunded` |
| `PURCHASE_CANCELED` | `refunded` |
| `PURCHASE_PROTEST` | `refunded` |
| `PURCHASE_CHARGEBACK` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `data.purchase.transaction` | `external_id` |
| `data.product.name` | `product_name` |
| `data.buyer.name` | `customer_name` |
| `data.buyer.email` | `customer_email` |
| `data.buyer.checkout_phone` ou `data.buyer.phone` | `customer_phone` |
| `data.buyer.document` | `customer_doc` |
| `data.buyer.address.state` (normalizado) | `customer_state` |
| `data.buyer.address.city` (normalizado) | `customer_city` |
| `data.buyer.address.country_iso` | `customer_country` |
| `data.purchase.payment.type` | `payment_method` |
| `data.purchase.approved_date` ou `data.purchase.order_date` | `sold_at` |

## 6. Regras de Negocio Especificas

### Deducao de comissao MARKETPLACE
O Hotmart inclui taxas da plataforma no preco. O sistema deduz a comissao com `source === 'MARKETPLACE'` do valor da venda — **somente** a entrada cuja `currency_value` bate com a moeda do pagamento:

```
valor_final = purchase.price.value - marketplace_fee_na_mesma_moeda
```

### Prioridade de preco
A fonte primaria do valor e o que o comprador realmente pagou. `original_offer_price` e apenas o preco de **referencia** da oferta (frequentemente em USD) e nao deve ser usado como valor da venda.

1. `purchase.price.value` + `purchase.price.currency_value` (valor pago e moeda real)
2. `purchase.full_price.value` + `purchase.full_price.currency_value` (fallback)
3. `purchase.original_offer_price.value` (ultimo recurso, somente se nao houver `price`/`full_price`)

### Tratamento de duplicatas
- Vendas existentes (mesmo `external_id` + `user_id`) nao sao reinseridas
- Se o evento for de reembolso e a venda ja existe, apenas o status e atualizado para `refunded`

### Data de venda (`sold_at`)
- Para status `approved`: usa `approved_date` (fallback para `order_date`)
- Para outros status: usa `order_date`
- Timestamps podem vir como number (epoch ms) ou string

## 7. Tratamento de Moeda

Hotmart e a unica plataforma com suporte completo a vendas internacionais.

### Deteccao de moeda
A moeda da venda e a do pagamento (o que o comprador efetivamente pagou):
1. `purchase.price.currency_value`
2. `purchase.full_price.currency_value`
3. `purchase.original_offer_price.currency_value` (somente se os dois acima ausentes)
4. Padrao: `'BRL'`

### Conversao para BRL
**Regra de ouro:** so converte se nao houver valor em BRL ja disponivel no payload.

Se `paymentCurrency === 'BRL'` o valor e usado direto, sem conversao. Caso contrario:
1. **Taxa da Hotmart (so quando bate com a moeda paga)**: usa `conversion_rate` da comissao PRODUCER cuja `currency_value` seja a mesma moeda do pagamento e que tenha `converted_to_currency === 'BRL'`. Importante: o `currency_conversion` do PRODUCER e USD->BRL na maioria dos webhooks, **nao** serve para converter pagamentos em DOP/COP/MXN.
2. **Fallback**: busca taxa via API externa (`getExchangeRate(paymentCurrency)`).
3. Calcula: `amount = (paymentValue - marketplaceFee) * rate`.

#### Modo "valor da comissao" (`use_commission_value = true`)
Quando o usuario opta por gravar o liquido (comissao do produtor) em vez do bruto, o sistema le `commissions[].source === 'PRODUCER'` e:
1. Se `commission.currency_value === 'BRL'` -> usa o valor direto (sem conversao).
2. Se ha `currency_conversion.converted_value` -> usa o BRL ja convertido pela Hotmart.
3. Caso ainda nao seja BRL e haja `conversion_rate` -> aplica.
4. Ultimo recurso: `getExchangeRate(commissionCurrency)`.

O valor final e sempre armazenado em BRL. Os campos `original_currency` (moeda do pagamento), `original_amount` (liquido na moeda do pagamento) e `exchange_rate` sao salvos em `metadata` para auditoria.

#### Bug historico (corrigido em 2026-04-27)
Antes desta correcao, o processor priorizava `original_offer_price` (USD de referencia) em vez de `purchase.price` (valor pago). Em vendas em BRL onde a oferta tinha USD de referencia, o sistema lia "USD", procurava `currency_conversion` na comissao (que nao existia porque ela ja vinha em BRL), caia no fallback de API e multiplicava o valor da comissao em BRL pela cotacao do dolar — gerando valores ~5x maiores que o correto.

## 8. Extracao de Ad ID

O Hotmart usa um sistema proprietario de tracking via campo `xcod` (dentro de `purchase.origin`).

### Parsing do `xcod`
O campo `xcod` e uma string separada por `|` com a seguinte estrutura:
```
utm_source | utm_medium_part1 | utm_medium_part2 | utm_campaign_part1 | utm_campaign_part2 | utm_content_part1 | utm_content_part2 | utm_term
```

- **Ad ID**: Extraido de `parts[6]` (segundo componente do utm_content). Se nao encontrado, busca o ultimo ID numerico (>5 digitos) em toda a string, separando por `|` e `/`.
- **Adset FB ID**: Extraido de `parts[4]` (segundo componente do utm_campaign)
- **Campaign FB ID**: Extraido de `parts[2]` (segundo componente do utm_medium)

### Fallback via `src` e `sck`
Se o `xcod` nao fornecer um `ad_id`, o sistema tenta extrair de `purchase.origin.src` e `purchase.origin.sck` usando a mesma logica de busca de IDs numericos longos.

### Hierarquia de match
1. Match por `ad_id` -> tabela `ads` (por `facebook_ad_id`)
2. Match por `adset_fb_id` -> tabela `ad_sets` (por `facebook_adset_id`)
3. Match por `campaign_fb_id` -> tabela `campaigns` (por `facebook_campaign_id`)

## 9. Deteccao de Teste

Um webhook e considerado de teste se qualquer condicao abaixo for verdadeira:

| Condicao | Verificacao |
|----------|-----------|
| Transaction ID vazio | `purchase.transaction === ''` |
| Email da Hotmart | `buyer.email` contem `hotmart.com` |
| Email de teste | `buyer.email` contem `@test` |
| Email generico | `buyer.email === 'test@test.com'` |
| Valor zero | `purchase.price.value === 0` |

Webhooks de teste retornam `200 OK` com `ignored: true`.

## 10. Endpoint

```
POST /api/webhooks/hotmart
```

Respostas:
- `200` - Webhook processado (criado, atualizado ou ignorado)
- `400` - JSON invalido ou transaction ID ausente
- `401` - Token invalido ou integracao nao encontrada
- `405` - Metodo HTTP nao permitido
- `500` - Erro interno
