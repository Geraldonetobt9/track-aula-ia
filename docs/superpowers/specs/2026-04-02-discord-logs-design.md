# Design: Sistema de Logs Discord

**Date:** 2026-04-02

---

## Objetivo

Sistema de logs em tempo real via Discord para suporte e monitoramento do Sentinela. Cada plataforma de checkout tem seu próprio canal, com vendas, reembolsos e erros logados individualmente. Um canal consolidado de erros e um resumo diário completam a visão.

---

## Estrutura de Canais (15 canais)

```
🔔 WEBHOOKS (13 canais — 1 por plataforma)
├── #hotmart
├── #kiwify
├── #kirvano
├── #guru-digital
├── #perfectpay
├── #ticto
├── #payt
├── #cakto
├── #balaclava
├── #hubla
├── #cartpanda
├── #ggcheckout
├── #lastlink

⚠️ ALERTAS (1 canal)
├── #webhook-errors     (erros de TODAS as plataformas)

📋 RESUMO (1 canal)
├── #resumo-diario      (1x/dia às 08:00 BRT)
```

---

## Mensagens nos Canais de Plataforma

### 1. Venda Aprovada — embed verde (`#00CC66`)

```
✅ R$ 297,00 | João Silva | joao@email.com | Curso Marketing | PIX | Ad Match: ✅
UTM: source=FBjLj696... | medium=CJ|120241... | campaign=CAMP|120241... | content=AD|120241...
```

Campos:
- Valor (R$), nome, email, produto, método de pagamento
- Ad Match: ✅ se `ad_id` foi encontrado e vinculado, ❌ se não
- UTMs: source, medium, campaign, content, term (se disponíveis)

### 2. Reembolso — embed vermelho (`#FF4444`)

```
🔄 R$ 297,00 | João Silva | joao@email.com | Curso Marketing | PIX | Reembolso
UTM: source=FBjLj696... | medium=CJ|120241... | campaign=CAMP|120241...
```

Mesmo formato da venda, com ícone 🔄 e cor vermelha.

### 3. Erro — embed laranja (`#FF8C00`)

Enviado **tanto no canal da plataforma quanto no `#webhook-errors`**.

```
⚠️ Token Inválido
📦 Plataforma: Kiwify
🕐 02/04/2026 às 14:32
🔑 Token: ...x9z2
👤 João Silva | 💰 R$ 297,00 | 📦 Curso Marketing

💡 Token não corresponde a nenhuma integração ativa.
🔧 Verificar com o usuário se o token está correto.
```

### 4. Evento de Teste Ignorado — embed cinza (`#808080`)

```
🔇 Webhook de teste ignorado
📦 Plataforma: Hotmart | 🕐 02/04/2026 às 14:32
```

Apenas no canal da plataforma, não vai para `#webhook-errors`.

---

## Tipos de Erro

| Erro | Mensagem explicativa | Ação sugerida |
|------|---------------------|---------------|
| Token inválido | "Token não corresponde a nenhuma integração ativa" | "Verificar com o usuário se o token está correto" |
| Falha ao salvar venda | "Erro ao inserir/atualizar venda no banco de dados" | "Verificar logs do servidor e status do Supabase" |
| Evento desconhecido ignorado | "Evento '{event}' não é processado pelo sistema" | Informativo, sem ação |
| Payload sem dados obrigatórios | "Payload recebido sem {campo} — venda salva com dados incompletos" | "Verificar se a plataforma mudou o formato do webhook" |

---

## Resumo Diário (`#resumo-diario`, 08:00 BRT)

Embed azul (`#4A90D9`):

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Resumo Diário — 02/04/2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 WEBHOOKS
   Recebidos: 2.847
   Vendas: 2.512 (R$ 187.430,00)
   Reembolsos: 321 (R$ 24.100,00)
   Com erro: 14
   Plataforma com mais erros: Kiwify (9)

⚙️ INTEGRAÇÕES
   Criadas: 3
   Removidas: 1
   Desativadas: 0

🌐 API
   Erros 5xx: 7
   Queries lentas (>5s): 4
   Rota com mais erros: GET /api/metrics/dashboard

🛡️ DADOS
   Vendas com campos nulos: 2
   Possíveis duplicatas: 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

Fonte dos dados:
- Webhooks: contar `sales` das últimas 24h agrupado por `platform` e `status`
- Integrações: contar `checkout_integrations` criadas/removidas nas últimas 24h
- API: contadores em memória no `AllExceptionsFilter` (reset diário)
- Dados: query em `sales` por campos nulos (`amount IS NULL OR customer_email IS NULL`)

---

## Arquitetura Técnica

### Componente: `DiscordLoggerService`

**Localização:** `packages/backend/src/shared/services/discord-logger.service.ts`
**Registrado em:** `SharedModule` (disponível para todos os módulos)

**Responsabilidades:**
1. Enviar embeds para canais Discord via webhook HTTP POST
2. Fila interna em memória para respeitar rate limit (30 msg/min por URL)
3. Fire-and-forget — nunca bloqueia o fluxo principal
4. Fail-safe — se Discord estiver fora, silencia e loga localmente

**Fila interna:**
- Array em memória por webhook URL
- `setInterval` a cada 2 segundos faz flush
- Se fila > 25 pendentes para a mesma URL, agrupa em batch temporariamente
- Mensagem de aviso: "⚠️ Volume alto — algumas mensagens foram agrupadas"

**Métodos públicos:**

```typescript
logSale(platform: string, data: SaleLogData): void
logRefund(platform: string, data: RefundLogData): void
logError(platform: string, data: ErrorLogData): void
logTestIgnored(platform: string): void
```

### Configuração de URLs

**Arquivo:** `packages/backend/src/config/discord-webhooks.config.ts` (gitignored)
**Template:** `packages/backend/src/config/discord-webhooks.config.example.ts` (commitado)

Mapa de `platform` → webhook URL. O service faz lookup direto por nome da plataforma.

### Integração nos Processors

Cada processor recebe `DiscordLoggerService` via DI e chama:
- `logSale()` após upsert bem-sucedido com status `approved`
- `logRefund()` após upsert bem-sucedido com status `refunded`
- `logError()` quando token inválido, falha ao salvar, ou payload inválido
- `logTestIgnored()` quando evento de teste é ignorado

O log acontece **após** o processamento completo (não bloqueia a resposta ao webhook).

### Cron: Resumo Diário

- `@Cron('0 11 * * *')` (11:00 UTC = 08:00 BRT)
- Consulta `sales` e `checkout_integrations` das últimas 24h
- Envia um embed consolidado para o canal `resumoDiario`

### Cores dos Embeds

| Tipo | Cor Hex | Decimal (Discord API) |
|------|---------|----------------------|
| Venda aprovada | `#00CC66` | `52326` |
| Reembolso | `#FF4444` | `16728132` |
| Erro | `#FF8C00` | `16747520` |
| Teste ignorado | `#808080` | `8421504` |
| Resumo diário | `#4A90D9` | `4886745` |

### Dados Sensíveis

- **Emails**: mostrar completos (necessário para suporte)
- **Tokens/secrets**: apenas últimos 4 caracteres (`...x9z2`)
- **IDs internos**: mostrar completos
- **Payloads raw**: nunca enviar — referenciar ID para consulta no banco

---

## Escopo da Primeira Implementação

### Incluído:
1. `DiscordLoggerService` com fila interna e rate limiting
2. Logs de venda/reembolso/erro em todos os 13 processors de webhook
3. Canal `#webhook-errors` consolidado
4. Resumo diário com métricas de webhooks, integrações, API e dados

### Excluído (futuro):
- Logs de integração criada/removida (`#integrations`)
- Logs de erros de API (`#api-errors`)
- Logs de data integrity (`#data-integrity`)
- Canal `#webhooks-activity` (resumo a cada 30 min)
