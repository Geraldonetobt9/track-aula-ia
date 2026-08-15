# Design: Flag de Valor por Integração (Comissão vs Venda)

**Data:** 2026-04-07
**Status:** Aprovado

## Resumo

Adicionar um campo `use_commission_value` (boolean, default `false`) na tabela `checkout_integrations`. Quando `true`, os processadores de webhook registram o valor líquido do produtor (comissão) em vez do valor bruto da venda no campo `amount` da tabela `sales`.

Por padrão, o sistema continua registrando o valor da venda (comportamento atual).

## Motivação

O usuário precisa poder escolher, por integração, se quer que o sistema registre o valor bruto da venda ou o valor líquido que ele recebe como produtor (após taxas da plataforma). Isso permite um tracking de ROI mais preciso conforme a preferência de cada usuário.

## Banco de Dados

Uma nova migration adicionando a coluna:

```sql
ALTER TABLE public.checkout_integrations
ADD COLUMN use_commission_value BOOLEAN NOT NULL DEFAULT false;
```

- Sem impacto em vendas existentes.
- Sem novos índices necessários (a coluna não é usada em WHERE/JOIN/ORDER BY).
- A tabela `sales` permanece inalterada.

## Backend

### DTO

Adicionar `use_commission_value?: boolean` no `SaveCheckoutDto` com validação `@IsOptional()` e `@IsBoolean()`.

### Integrations Service

Nenhuma mudança necessária — o service já faz upsert de todos os campos do DTO.

### Webhook Processors

Cada um dos 8 processadores precisa:

1. Buscar a integração associada ao webhook (já fazem isso para obter `workspace_id`).
2. Verificar `integration.use_commission_value`.
3. Se `true`, extrair o valor líquido do produtor usando o campo específico da plataforma.
4. Se `false` (default), manter o comportamento atual (valor bruto).
5. Fallback: se o campo líquido não existir ou for 0, usar o valor bruto.

### Mapeamento de campos líquidos por plataforma

| Plataforma | Campo líquido do produtor |
|---|---|
| Hotmart | `commissions[source="PRODUCER"].value` |
| Kiwify | `Commissions.my_commission` |
| Kirvano | `commission` (top-level) |
| Guru | `payment.net` |
| PerfectPay | `commission[affiliation_type_enum_key="producer"].commission_amount` |
| TicTo | `producer.amount` |
| PayT | `commission[type="producer"].amount` |
| Cakto | `commissions[type="producer"].totalAmount` |

## Frontend

### CheckoutConfigModal

Adicionar um **radio group** com duas opções no modal de configuração:

- **"Valor da venda"** — default, `use_commission_value = false`
- **"Valor da comissão"** — `use_commission_value = true`

Posicionado abaixo do toggle de ativo e acima das instruções da plataforma.

### useCheckoutIntegrations Hook

Passar o novo campo `use_commission_value` no `saveIntegration()` e recebê-lo no `fetchIntegrations()`.

## O que NÃO muda

- Tabela `sales` permanece inalterada.
- Vendas já registradas não são afetadas pela mudança de configuração.
- Dashboards e métricas continuam usando `amount` normalmente.
- A alteração só afeta vendas futuras recebidas via webhook após a configuração ser alterada.
