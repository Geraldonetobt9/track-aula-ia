# Webhook - LastLink

## 1. Proposito

Processar notificacoes de vendas e reembolsos da plataforma LastLink, capturando dados de compra, assinatura e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'lastlink'` e `is_active = true`.

## 3. Eventos Aceitos

LastLink nao usa campo `event`. O tipo e detectado pela estrutura do payload:

| Estrutura do Payload | Acao |
|---------------------|------|
| Contem `Purchase` + `Utm` | Criar venda com status `approved` |
| Contem `Action: "Remove"` | Atualizar venda existente para `refunded` |

## 4. Mapeamento de Status

| Estrutura | Status Interno |
|-----------|---------------|
| Payload com `Purchase` | `approved` |
| Payload com `Action: "Remove"` | `refunded` |

## 5. Extracao de Dados (Compra)

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `Purchase.PaymentId` | `external_id` |
| `Products[0].Name` ou `Product.Name` | `product_name` |
| `Buyer.Name` | `customer_name` |
| `Buyer.Email` | `customer_email` |
| `Buyer.PhoneNumber` | `customer_phone` |
| `Buyer.Document` | `customer_doc` |
| Derivado de `getStateFromPhone()` | `customer_state` |
| `Purchase.Payment.PaymentMethod` | `payment_method` |
| `Purchase.PaymentDate` (com offset `-03:00`) | `sold_at` |

### Tracking
Objeto `Utm` com PascalCase: `UtmSource`, `UtmMedium`, `UtmCampaign`, `UtmContent`, `UtmTerm`, `UtmId`.

## 6. Regras de Negocio Especificas

### Dois formatos de payload
- **Compra**: `Purchase`, `Utm`, `Products`, `Buyer`, `Commissions`
- **Reembolso**: `Action: "Remove"`, `Product`, `Subscription`, `Buyer`

### Refund via Subscription.Id
1. Na compra: `Subscriptions[0].Id` salvo em `raw_data.subscription_id`
2. No reembolso: busca venda onde `raw_data->>'subscription_id'` = `Subscription.Id`
3. Atualiza status para `refunded`

### PascalCase
Todos os campos usam PascalCase.

### Deteccao de teste
`payload.IsTest === true` → ignorado.

## 7. Tratamento de Moeda

- Moeda fixa `'BRL'`
- Valor ja em reais em `Purchase.Price.Value`

## 8. Extracao de Ad ID

Extraido de `Utm.UtmContent` usando `extractNumericAdId()`.
`Utm.UtmId` contem ID da campanha Facebook (salvo em `raw_data`).

## 9. Endpoint

```
POST /api/webhooks/lastlink
```
