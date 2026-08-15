# Webhook - Cakto

## 1. Proposito

Processar notificacoes de vendas da plataforma Cakto, extraindo dados do cliente e vinculando vendas aos anuncios do Facebook.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |
| Query param | `?token=` ou `?key=` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'cakto'` e `is_active = true`.

## 3. Eventos Aceitos

Cakto envia o tipo de notificacao no campo `event`:

| Evento Cakto | Acao |
|-------------|------|
| `purchase_approved` | Criar venda com status `approved` |
| `refund` | Criar venda com status `refunded` |
| `chargeback` | Criar venda com status `refunded` |

Eventos fora desta lista sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Evento Cakto | Status Interno |
|-------------|---------------|
| `purchase_approved` | `approved` |
| `refund` | `refunded` |
| `chargeback` | `refunded` |

## 5. Extracao de Dados

Todos os dados de venda estao dentro do objeto `payload.data`:

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `data.refId` ou `data.id` | `external_id` (fallback: `cakto_` + timestamp) |
| `data.product.name` ou `data.offer.name` | `product_name` |
| `data.customer.name` | `customer_name` |
| `data.customer.email` | `customer_email` |
| `data.customer.phone` | `customer_phone` |
| `data.customer.docNumber` | `customer_doc` |
| Derivado de `getStateFromPhone(customer.phone)` | `customer_state` |
| (nao disponivel) | `customer_city` = `null` |
| (fixo) | `customer_country` = `'BR'` |
| `data.paymentMethod` | `payment_method` |
| `data.paidAt` ou `data.createdAt` | `sold_at` |

### Metadata adicional (salvo em `raw_data`)
- `event`, `order_id` (`data.id`), `ref_id` (`data.refId`)
- `baseAmount`, `discount`, `fees`
- `couponCode`, `reason`, `refund_reason`
- `installments`
- `offer.id`, `offer.name`, `offer_type`
- `product.id`, `product.short_id`
- `parent_order`, `checkoutUrl`, `checkout`
- `sck`, `affiliate`
- `releaseDate`, `refundedAt`, `chargedbackAt`, `canceledAt`

## 6. Regras de Negocio Especificas

### Calculo de valor
O valor ja vem em reais (sem divisao por 100). O sistema aceita tanto number quanto string:
```
amount = typeof data.amount === 'number' ? data.amount : parseFloat(data.amount) || 0
```

### Estado do cliente
Cakto nao envia o estado no payload. O sistema deriva o estado exclusivamente a partir do DDD do telefone via `getStateFromPhone()`.

### Cidade nao disponivel
Cakto nao fornece dados de cidade. O campo `customer_city` e sempre `null`.

### Pais fixo
O pais e sempre definido como `'BR'` (Cakto nao suporta vendas internacionais explicitamente).

### Campos especiais
- `data.sck`: Campo de tracking extra (similar ao Hotmart)
- `data.affiliate`: Dados do afiliado (se aplicavel)

### Upsert em vez de insert
Cakto usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda fixa: `BRL`
- Valor ja em reais (sem conversao de centavos)
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido de `data.utm_content` ou `data.sck`:

1. Tenta extrair de `utm_content` primeiro
2. Fallback: tenta extrair de `sck`
3. Divide a string por `|`
4. Percorre de tras para frente
5. Retorna o primeiro segmento composto apenas por digitos com mais de 5 caracteres

Exemplo: `"vid34-d09-02|120245519580910309"` -> `"120245519580910309"`

Apos obter o ad_id, o match direto com a tabela `ads` e feito por `facebook_ad_id`, obtendo a hierarquia completa (ad -> ad_set -> campaign).

## 9. Deteccao de Teste

Cakto nao possui deteccao explicita de webhooks de teste. A filtragem e feita apenas pelo campo `event` -- eventos nao reconhecidos sao ignorados.

## 10. Endpoint

```
POST /api/webhooks/cakto
```

Respostas:
- `200` - Webhook processado (criado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
