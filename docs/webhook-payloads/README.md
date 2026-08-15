# Webhook Payload Examples

Real webhook payloads received from each checkout platform. Use these as reference when implementing or modifying webhook processors.

> **Sensitive data**: These payloads contain real customer data patterns. Field values have been received in production.

## Files

| Platform | File | Commission Field |
|----------|------|-----------------|
| Kiwify | [kiwify.json](kiwify.json) | `Commissions.my_commission` (centavos) |
| Hotmart | [hotmart.json](hotmart.json) | `commissions[].value` por `source` (PRODUCER/AFFILIATE) |
| Kirvano | [kirvano.json](kirvano.json) | `commission` (reais) + `fiscal.commission` |
| PayT | [payt.json](payt.json) | `commission[].amount` por `type` (centavos) |
| Perfect Pay | [perfectpay.json](perfectpay.json) | `commission[].commission_amount` por `affiliation_type_enum_key` |
| Ticto | [ticto.json](ticto.json) | `producer.amount` (centavos) + `owner_commissions[]` |
| Cakto | [cakto.json](cakto.json) | `commissions[].totalAmount` por `type` |
| Guru Digital | [guru.json](guru.json) | `payment.net` (reais) |
| CartPanda | [cartpanda.json](cartpanda.json) | `order.payment.seller_split_amount` (reais) |
| GGCheckout | [ggcheckout.json](ggcheckout.json) | N/A — no commission field available |
| Hubla | [hubla.json](hubla.json) | N/A — no commission field available |

## Commission Summary

How to extract the **user's actual earnings** from each platform:

- **Kiwify**: `Commissions.my_commission / 100` — already the webhook receiver's net earnings
- **Hotmart**: Find `commissions[]` entry matching user role (PRODUCER or AFFILIATE), use `.value`. Check `currency_conversion.converted_value` for BRL conversion
- **Kirvano**: `commission` field (top-level, already in reais). Also available in `fiscal.commission`
- **PayT**: Find `commission[]` entry where `type === "producer"` (or affiliate), use `amount / 100`
- **Perfect Pay**: Find `commission[]` entry where `affiliation_type_enum_key === "producer"`, use `commission_amount`
- **Ticto**: `producer.amount / 100` for producer. For affiliates: `affiliates[].amount / 100`
- **Cakto**: Find `commissions[]` entry matching user role, use `totalAmount`
- **Guru Digital**: `payment.net` — already the net value after fees in reais
- **CartPanda**: `order.payment.seller_split_amount` — net value after CartPanda fees, already in reais
- **GGCheckout**: No commission/net field available. Only `payment.amount` (gross)
- **Hubla**: No commission/net field available. Use `event.subscription.lastInvoice.amount.totalCents / 100` for total paid (in centavos)

## Non-webhook references

### hotmart-csv-export.csv

Sample redacted do export de vendas do painel Hotmart (Vendas > Histórico de vendas > Exportar). **NÃO é um payload de webhook** — é referência do formato CSV aceito pela funcionalidade de Import Sales (`docs/features/15-import-sales/import-sales.md`). O arquivo contém 2 linhas de venda aprovada com PII mascarada (nome, email, documento, DDD/telefone). Header preservado com BOM UTF-8 e 59 colunas, conforme gerado pela Hotmart. Use para testar parsers sem expor dados reais de clientes.
