# Logs no Discord — Estrutura e Guia

> **Modulo:** `packages/backend/src/shared/services/discord-logger.service.ts`
> **Ultima atualizacao:** 2026-03-30
> **Status:** Rascunho

---

## 1. Proposito

Sistema de logs estrategicos enviados para canais do Discord, permitindo que o time de suporte e o time tecnico tenham visibilidade em tempo real sobre eventos criticos, erros e atividade do sistema — sem precisar acessar logs do servidor.

---

## 2. Estrutura do Discord Server

### 2.1 Visao Geral das Categorias e Canais

O servidor Discord e organizado em **3 categorias** que agrupam os canais por area do sistema:

```
📋 RESUMO
├── #resumo-diario

🔔 WEBHOOKS
├── #webhooks-errors
├── #webhooks-activity

⚙️ OPERAÇÕES
├── #integrations
├── #api-errors
├── #data-integrity
```

### 2.2 Descricao de Cada Categoria

**📋 RESUMO** — Canal unico com o consolidado diario. Primeiro lugar que o time de suporte deve olhar ao iniciar o dia.

**🔔 WEBHOOKS** — Tudo relacionado ao recebimento de vendas das plataformas de checkout. E o coracao do sistema — se webhooks param, vendas param de aparecer.

**⚙️ OPERAÇÕES** — Eventos operacionais: integrações criadas/removidas, erros de API que o usuario sente, e anomalias nos dados.

---

## 3. Detalhamento de Cada Canal

---

### 3.1 #resumo-diario

**Frequencia:** 1x por dia, as 08:00 (horario de Brasilia)
**Quem deve olhar:** Todos — e o ponto de partida do dia

**O que mostra:** Consolidado das ultimas 24h com totais de cada area.

**Formato do embed:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Resumo Diário — 29/03/2026
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🔔 WEBHOOKS
   Recebidos: 2.847
   Com erro: 14
   Plataforma com mais erros: Kiwify (9)
   Fila Guru: 0 pendentes | 2 falharam

⚙️ INTEGRAÇÕES
   Criadas: 3
   Removidas: 1
   Desativadas: 0

🌐 API
   Erros 4xx: 23
   Erros 5xx: 7
   Queries lentas (>5s): 4
   Rota com mais erros: GET /api/metrics/dashboard

🛡️ DADOS
   Vendas com campos nulos: 2
   Operações parciais: 0
   Possíveis duplicatas: 1

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Como o suporte interpreta:**
- Se "Com erro" estiver alto → verificar #webhooks-errors
- Se "Erros 5xx" > 0 → verificar #api-errors
- Se "Vendas com campos nulos" > 0 → verificar #data-integrity

---

### 3.2 #webhooks-errors

**Frequencia:** Tempo real (cada erro dispara uma mensagem)
**Quem deve olhar:** Suporte quando um usuario reportar "minha venda nao apareceu"

**Eventos logados:**

| Evento | Cor do Embed | Quando Acontece |
|--------|--------------|-----------------|
| Token invalido | 🔴 Vermelho | Plataforma mandou webhook mas o token nao bate com nenhuma integracao |
| Payload invalido | 🔴 Vermelho | Webhook chegou mas o corpo da requisicao esta em formato inesperado |
| Erro ao salvar venda | 🔴 Vermelho | Webhook processado com sucesso mas falhou ao inserir no banco |
| Fila Guru falhou | 🟠 Laranja | Item da fila atingiu 3 tentativas e foi marcado como falho |
| Webhook de teste ignorado | ⚪ Cinza | Plataforma enviou webhook de teste (ignorado de proposito) |

**Formato do embed (exemplo — Token invalido):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Webhook Rejeitado — Token Inválido
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Plataforma: Kiwify
🕐 Horário: 29/03/2026 às 14:32
🔑 Token recebido: ak7f...x9z2 (parcial)
👤 Cliente no payload: João Silva
💰 Valor no payload: R$ 297,00

💡 O que isso significa:
   O token enviado pela Kiwify não corresponde
   a nenhuma integração ativa no Sentinela.
   Possível causa: usuario configurou o webhook
   errado na plataforma ou removeu a integração.

🔧 Ação sugerida:
   Verificar com o usuario se a integração
   ainda existe e se o token está correto.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Formato do embed (exemplo — Fila Guru falhou):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟠 Fila de Webhooks — Item Falhou Definitivamente
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Plataforma: Guru
🕐 Primeira tentativa: 29/03/2026 às 10:15
🕐 Última tentativa: 29/03/2026 às 10:16
🔄 Tentativas: 3/3
👤 Usuário: matheus@email.com
🏢 Workspace: "Meu Negócio Digital"
📋 ID na fila: wq_abc123

💡 O que isso significa:
   Um webhook da Guru foi recebido mas falhou
   ao ser processado 3 vezes seguidas.
   A venda NÃO foi registrada no sistema.

🔧 Ação sugerida:
   Verificar o payload no banco (tabela webhook_queue,
   id: wq_abc123) e reprocessar manualmente se necessário.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 3.3 #webhooks-activity

**Frequencia:** A cada 30 minutos (resumo periodico, NAO cada webhook individual)
**Quem deve olhar:** Para ter o pulso geral do sistema

**Formato do embed:**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
📊 Atividade de Webhooks — Últimos 30 min
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🕐 Período: 14:00 - 14:30

📦 Por plataforma:
   Hotmart     ████████░░  42
   Kiwify      ██████████  67
   Kirvano     ██████░░░░  31
   Guru        ███░░░░░░░  15
   PerfectPay  ██░░░░░░░░   8
   Ticto       █░░░░░░░░░   3
   PayT        ░░░░░░░░░░   0
   Cakto       █░░░░░░░░░   2
   Hubla       █░░░░░░░░░   2
   CartPanda   ░░░░░░░░░░   0
   GG Checkout ░░░░░░░░░░   0
   LastLink    ░░░░░░░░░░   0

📈 Total: 168 webhooks
✅ Sucesso: 165 (98.2%)
❌ Erros: 3 (1.8%)

🔄 Fila Guru: 0 pendentes

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Como o suporte interpreta:**
- Se uma plataforma que normalmente tem volume alto mostra 0 → pode indicar problema na plataforma ou no webhook URL
- Se % de erros subir acima de 5% → algo sistêmico esta acontecendo, verificar #webhooks-errors
- Se fila Guru tem muitos pendentes → processamento esta travado

---

### 3.4 #integrations

**Frequencia:** Tempo real (cada evento dispara uma mensagem)
**Quem deve olhar:** Para acompanhar o ciclo de vida das integracoes dos usuarios

**Eventos logados:**

| Evento | Cor do Embed | Quando Acontece |
|--------|--------------|-----------------|
| Integracao criada | 🟢 Verde | Usuario configurou uma nova integracao de checkout |
| Integracao removida | 🔴 Vermelho | Usuario deletou uma integracao |
| Integracao desativada | 🟡 Amarelo | Usuario desativou (is_active = false) |
| Integracao reativada | 🟢 Verde | Usuario reativou uma integracao |
| Workspace criado | 🟢 Verde | Usuario criou um novo workspace |
| Workspace removido | 🔴 Vermelho | Usuario deletou um workspace |

**Formato do embed (exemplo — Integracao criada):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟢 Nova Integração Criada
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 Usuário: carlos@email.com
🏢 Workspace: "Lançamento Curso X"
📦 Plataforma: Hotmart
🕐 Horário: 29/03/2026 às 16:45

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Formato do embed (exemplo — Integracao removida):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Integração Removida
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 Usuário: carlos@email.com
🏢 Workspace: "Lançamento Curso X"
📦 Plataforma: Hotmart
🕐 Horário: 29/03/2026 às 17:10

⚠️ Atenção: Webhooks desta plataforma
   para este workspace não serão mais
   processados. Se o usuario reportar
   vendas faltando, verificar se a
   remoção foi intencional.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 3.5 #api-errors

**Frequencia:** Tempo real para erros 5xx. Resumo a cada 30 min para erros 4xx.
**Quem deve olhar:** Quando um usuario reportar que "o sistema esta com erro" ou "nao carrega"

**Eventos logados:**

| Evento | Cor do Embed | Quando Acontece |
|--------|--------------|-----------------|
| Erro 5xx (server error) | 🔴 Vermelho | Erro interno do servidor — o usuario ve tela de erro |
| Query lenta (>5s) | 🟠 Laranja | Uma consulta ao banco demorou mais de 5 segundos |
| Request timeout | 🔴 Vermelho | Requisicao estourou o tempo limite sem resposta |
| Resumo de erros 4xx | 🟡 Amarelo | Consolidado a cada 30 min de erros de validacao/auth |

**Formato do embed (exemplo — Erro 5xx):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Erro no Servidor (500)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

👤 Usuário: ana@email.com
🌐 Rota: GET /api/metrics/dashboard
🏢 Workspace: "Minha Loja"
🕐 Horário: 29/03/2026 às 09:22
⏱️ Tempo de resposta: 12.4s (timeout)

📋 Erro: Cannot read property 'amount' of null

💡 O que o usuário viu:
   Dashboard não carregou ou mostrou
   mensagem de erro genérica.

🔧 Ação sugerida:
   Verificar se o workspace tem vendas
   com dados incompletos (campos nulos).

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Formato do embed (exemplo — Query lenta):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟠 Query Lenta Detectada
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🌐 Rota: GET /api/sales
👤 Usuário: pedro@email.com
🏢 Workspace: "Projeto ABC"
⏱️ Tempo: 8.2 segundos
📊 Registros retornados: 12.450

💡 O que o usuário sentiu:
   A página de vendas demorou muito
   para carregar ou pareceu travada.

🔧 Possível causa:
   Muitos registros sem paginação
   adequada ou filtro de data amplo.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Formato do embed (exemplo — Resumo 4xx a cada 30 min):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟡 Resumo de Erros 4xx — Últimos 30 min
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕐 Período: 14:00 - 14:30

401 Unauthorized .............. 12
   Rotas: /api/metrics (5), /api/sales (4),
          /api/workspaces (3)

400 Bad Request ............... 4
   Rotas: /api/integrations (3), /api/financial (1)

403 Forbidden ................. 2
   Rotas: /api/workspaces (2)

💡 Se 401 estiver alto, pode indicar
   tokens expirando sem refresh adequado.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

### 3.6 #data-integrity

**Frequencia:** Tempo real para eventos criticos. Verificacao periodica (a cada 1h) para anomalias.
**Quem deve olhar:** Time tecnico. Problemas aqui sao silenciosos — o usuario nao sabe que esta acontecendo.

**Eventos logados:**

| Evento | Cor do Embed | Quando Acontece |
|--------|--------------|-----------------|
| Venda com campos nulos | 🔴 Vermelho | Venda inserida com amount, product_name ou email nulo |
| Possivel duplicata | 🟠 Laranja | Venda com mesmo external_id inserida em intervalo < 5 segundos |
| Falha parcial em operacao | 🔴 Vermelho | Delete + insert onde o insert falhou (ex: setProducts) |
| Conexao com banco instavel | 🔴 Vermelho | Health check do Supabase falhou ou demorou mais de 2s |
| Resumo de anomalias | 🟡 Amarelo | Verificacao periodica (1h) de inconsistencias nos dados |

**Formato do embed (exemplo — Venda com campos nulos):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Venda com Dados Incompletos
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Plataforma: PerfectPay
👤 Usuário: maria@email.com
🏢 Workspace: "Infoproduto Y"
🕐 Horário: 29/03/2026 às 11:45
🆔 Sale ID: sale_xyz789

⚠️ Campos nulos encontrados:
   • amount (valor da venda)
   • product_name (nome do produto)

💡 O que isso causa:
   Métricas de faturamento e ROAS ficam
   incorretas. O usuario pode ver valores
   menores do que o real no dashboard.

🔧 Ação sugerida:
   Verificar se a PerfectPay mudou o formato
   do payload. Conferir o webhook raw no log
   e corrigir a venda manualmente se necessário.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Formato do embed (exemplo — Possivel duplicata):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🟠 Possível Venda Duplicada
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📦 Plataforma: Hotmart
👤 Usuário: joao@email.com
🆔 External ID: ht_12345678
🕐 Primeira inserção: 11:30:02
🕐 Segunda inserção: 11:30:03
⏱️ Intervalo: 1 segundo

💡 O que isso causa:
   A mesma venda pode estar contada duas
   vezes no faturamento do usuario.

🔧 Ação sugerida:
   Verificar na tabela sales se existem
   duas entradas com este external_id e
   remover a duplicata.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

**Formato do embed (exemplo — Conexao instavel):**

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
🔴 Conexão com Banco Instável
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

🕐 Horário: 29/03/2026 às 03:12
⏱️ Tempo de resposta: 4.8 segundos
   (normal: < 100ms)

💡 O que isso causa:
   TODAS as operações do sistema ficam
   lentas ou falham. Usuarios vêem loading
   infinito ou erros em todas as páginas.

🔧 Ação sugerida:
   Verificar status do Supabase em
   status.supabase.com. Se persistir,
   verificar connection pooling no
   painel do projeto.

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## 4. Regras de Envio

### 4.1 Rate Limiting

O Discord permite no maximo 30 mensagens por minuto por webhook. Para evitar problemas:

| Canal | Estrategia |
|-------|-----------|
| #resumo-diario | 1 mensagem/dia — sem risco |
| #webhooks-errors | Tempo real, mas com buffer: acumula erros por 10 segundos e envia agrupado se houver mais de 5 no intervalo |
| #webhooks-activity | 1 mensagem a cada 30 minutos — sem risco |
| #integrations | Tempo real — volume baixo (poucas integracoes criadas/dia) |
| #api-errors (5xx) | Tempo real, mesmo buffer de 10s do webhooks-errors |
| #api-errors (4xx) | Resumo a cada 30 minutos — sem risco |
| #data-integrity | Tempo real para criticos, verificacao a cada 1h para anomalias |

### 4.2 Regra de Silenciamento

Para evitar flood em cenarios de falha catastrofica (ex: banco caiu e TUDO esta falhando):

- Se um canal receber mais de **20 mensagens em 5 minutos**, agrupar todas as seguintes em uma unica mensagem de resumo a cada 5 minutos ate o volume normalizar
- Incluir mensagem: "⚠️ Volume alto de alertas detectado. Agrupando mensagens para evitar flood."

### 4.3 Regra de Dados Sensiveis

Como o time de suporte tera acesso, alguns cuidados:

- **Emails**: mostrar completos (necessario para suporte identificar o usuario)
- **Tokens/secrets**: mostrar apenas os ultimos 4 caracteres (ex: `...x9z2`)
- **IDs internos**: mostrar completos (necessario para debug)
- **Payloads raw**: NUNCA enviar no Discord. Referenciar o ID para consulta no banco

---

## 5. Cores dos Embeds (Referencia Visual)

| Cor | Codigo Hex | Significado | Quando Usar |
|-----|-----------|-------------|-------------|
| 🔴 Vermelho | `#FF4444` | Erro critico | Algo quebrou e precisa de acao |
| 🟠 Laranja | `#FF8C00` | Alerta | Algo preocupante mas nao urgente |
| 🟡 Amarelo | `#FFD700` | Informativo com atencao | Resumos com numeros acima do normal |
| 🟢 Verde | `#00CC66` | Sucesso | Integracoes criadas, operacoes ok |
| ⚪ Cinza | `#808080` | Neutro/ignorado | Webhooks de teste, eventos informativos |
| 🔵 Azul | `#4A90D9` | Resumo | Resumos periodicos e consolidados |

---

## 6. Guia para o Time de Suporte

### 6.1 Rotina Diaria

1. Ao iniciar o dia, olhar **#resumo-diario** para ter a visao geral
2. Se houver numeros fora do normal, ir no canal especifico investigar
3. Manter **#webhooks-errors** e **#api-errors** com notificacoes ligadas

### 6.2 Quando um Usuario Reportar Problema

| Usuario diz... | Onde olhar | O que procurar |
|----------------|-----------|----------------|
| "Minha venda nao apareceu" | #webhooks-errors | Token invalido ou erro ao salvar, filtrar pelo email do usuario |
| "O dashboard nao carrega" | #api-errors | Erro 5xx na rota /api/metrics, filtrar pelo email |
| "Meus numeros estao errados" | #data-integrity | Vendas com campos nulos ou duplicatas para o workspace |
| "Nao consigo criar integracao" | #api-errors | Erros 4xx/5xx na rota /api/integrations |
| "O sistema esta lento" | #api-errors | Queries lentas recentes |
| "Webhook nao esta funcionando" | #webhooks-errors + #integrations | Verificar se a integracao existe e se tokens batem |

### 6.3 Escalacao

Se o canal **#data-integrity** mostrar "Conexão com Banco Instável" ou #api-errors mostrar muitos erros 5xx simultaneos, escalar imediatamente para o time tecnico — isso indica problema de infraestrutura que afeta TODOS os usuarios.

---

## 7. Configuracao Tecnica

### 7.1 Webhook URLs

Cada canal precisa de um webhook URL do Discord configurado como variavel de ambiente no backend:

```
DISCORD_WEBHOOK_RESUMO_DIARIO=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_WEBHOOKS_ERRORS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_WEBHOOKS_ACTIVITY=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_INTEGRATIONS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_API_ERRORS=https://discord.com/api/webhooks/...
DISCORD_WEBHOOK_DATA_INTEGRITY=https://discord.com/api/webhooks/...
```

### 7.2 Arquitetura do Service

O `DiscordLoggerService` sera um servico injetavel no `SharedModule`, disponivel para todos os modulos via DI:

- **Fire-and-forget**: envios nunca bloqueiam o fluxo principal
- **Fail-safe**: se o Discord estiver fora do ar, o erro e silenciado (log local apenas)
- **Buffer**: acumula mensagens em cenarios de alta frequencia
- **Formatacao**: metodos utilitarios para construir embeds padronizados

### 7.3 Dependencias

- `node-fetch` ou `undici` para chamadas HTTP ao Discord (sem SDK pesado)
- Sem dependencias externas adicionais
