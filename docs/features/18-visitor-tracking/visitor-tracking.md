# Rastreio de Visitantes

> **Modulo:** `packages/backend/src/modules/tracking` | **Pagina:** `packages/frontend/src/pages/Tracking.tsx`
> **Ultima atualizacao:** 2026-09-28
> **Status:** Implementado — pendente de validacao com trafego real
>
> **Pendencias operacionais antes de funcionar:**
> 1. Rodar `supabase/migrations/20260928000000_rastreio_de_visitantes.sql` no SQL Editor
> 2. Deploy normal (frontend + API na Vercel). Nenhuma variavel de ambiente nova
> 3. Colar o snippet (Integracoes → Rastreio de visitantes) na pagina de vendas

---

## 1. Proposito

Ate aqui o painel so sabia de uma venda quando o webhook do checkout chegava. O rastreio registra quem visitou a pagina de vendas, quem clicou para comprar e de onde veio, e liga a venda a visita que a trouxe. Da a taxa de conversao (visitantes → vendas), o funil e a jornada de cada comprador.

E uma camada complementar a atribuicao por UTM ([sale-attribution](../05-sales/sale-attribution.md)): nao altera `campaign_id`, `ad_set_id` nem `ad_internal_id` de nenhuma venda.

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Integracoes → card "Rastreio de visitantes" | Snippet pronto para copiar, status (ativo / sem eventos em 24h), eventos de hoje |
| Sidebar `/tracking` ("Visitantes") | Cards, funil, visitantes e vendas por dia, paginas de entrada, origens |
| Dashboard | Quatro cards de funil abaixo dos de receita — so quando ha visitas no periodo ou no anterior |
| Vendas → detalhes da venda | "Jornada do comprador", quando a venda foi ligada a uma visita |

### 2.2 Fluxo de UI

1. Em Integracoes, o usuario copia o snippet e cola antes do `</body>` da pagina de vendas.
2. O card passa a "Snippet ativo" com o primeiro evento (consulta a cada 30s).
3. Os links da pagina que apontam para um checkout conhecido passam a levar `sck=stl_<sessao>` e as UTMs da chegada.
4. Quando a venda chega pelo webhook, ela e ligada a sessao; o drawer da venda mostra a jornada.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Baixar `tracker.js` e enviar eventos | Publico (sem login). O id da area nao e segredo — fica na pagina do cliente |
| Ler metricas, status e jornada | Dono da area (JWT + conferencia de `workspaces.user_id`) |
| Escrever nas tabelas de rastreio | So a service role, via RPC. Sem politica de escrita para usuarios |

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Visitante | Sempre | Cookie `_stl_vid` (UUID, 1 ano), no dominio raiz (`loja.com.br`, nao `www.`) |
| RN-02 | Sessao | Sempre | Cookie `_stl_sid` (UUID, 30 min), renovado a cada evento. Expirou = sessao nova |
| RN-03 | UTMs persistem | Pagina sem UTM na URL | Usa as do cookie `_stl_utm` (7 dias). URL com UTM substitui o cookie inteiro |
| RN-04 | Lote | pageview, custom | Acumula 2s e manda num envio so |
| RN-05 | Saida imediata | `visibilitychange` → hidden, `pagehide`, `beforeunload` | `page_exit` com `duration_seconds`, na hora, junto com o que estiver no lote |
| RN-06 | Clique no checkout | Link para Hotmart, Kiwify, Kirvano, PerfectPay, Payt, Cakto, Hubla, Ticto, CartPanda, GGCheckout, LastLink, Eduzz, Mundpay, Monetizze, Greenn, Guru, ou host com "checkout", ou `data-sentinel-checkout` | Evento `checkout_click` imediato |
| RN-07 | Decoracao do link | Link de checkout | Ganha `sck=stl_<sessao>` e as UTMs/fbclid da chegada, **so os parametros que o link ainda nao tem**. Um `sck` do proprio cliente nunca e trocado |
| RN-08 | Do Not Track | DNT ligado | Nada: nem cookie, nem envio. `sentinel()` vira no-op |
| RN-09 | Sem PII | Sempre | Nao coleta nome, e-mail, documento nem IP. Query string da URL e do referrer e descartada |
| RN-10 | Robos | UA de bot (inclui `facebookexternalhit`) | Descartado |
| RN-11 | Limite | Mais de 100 req/min do mesmo IP (por instancia) | Excedente descartado, resposta 200 |
| RN-12 | Resposta | Sempre | `/collect` responde 200 vazio, inclusive em erro |
| RN-13 | Casamento — ordem | Venda gravada pelo webhook | `order` → `sck` → `fbclid` → `utm_exact`. Primeira que achar vence |
| RN-14 | `sck` | Marcador `stl_<uuid>` em qualquer lugar do metadata/UTMs da venda | Sessao exata |
| RN-15 | `fbclid` | `metadata.fbclid` ou o `_fbc` | Sessao com o mesmo fbclid, iniciada ate 7 dias antes da venda |
| RN-16 | `utm_exact` | source + campaign + content iguais, clique no checkout nas 24h anteriores | So se houver **uma** candidata. Duas ou mais: sem vinculo |
| RN-17 | Sem e-mail/IP | — | Nao existe: o webhook traz o IP da plataforma, nao do comprador |
| RN-18 | `stl_` fora do ad_id | Processor tirou o ad_id do `sck` | `SalesService.upsertFromWebhook` zera o `ad_id` e move o marcador para `metadata.tracking_ref` |
| RN-19 | Rejeicao | Sessao | 1 pageview, sem clique no checkout e menos de 10s (sessao nao engajada do GA4) |
| RN-20 | Vendas no funil | Sempre | Pedidos aprovados do periodo (`DISTINCT order_external_id`), como no Dashboard — casados ou nao |
| RN-21 | Vendas por pagina/origem | Sempre | So as casadas com uma sessao |
| RN-22 | Retencao | Diariamente, 01:30 BRT (pg_cron) | Eventos > 90 dias apagados; sessoes sem venda > 1 ano apagadas; sessoes com venda ficam |

## 4. Modelo de Dados

### 4.1 Tabelas Principais

- `tracking_visitors` — uma linha por (`workspace_id`, `visitor_id`): primeiro/ultimo acesso, totais, UTMs do primeiro toque, cidade/estado/pais, aparelho.
- `tracking_sessions` — uma linha por (`workspace_id`, `session_id`): UTMs da entrada (primeiro toque na sessao), `fbclid`, `gclid`, pagina de entrada, referrer, aparelho, geo, `pageviews`, `duration_seconds`, `had_checkout_click`, `checkout_clicked_at`, e o vinculo `sale_id` / `matched_at` / `match_method`.
- `tracking_events` — cada evento: `event_type` (`pageview`, `checkout_click`, `page_exit`, `custom`), `event_name`, `url`, `metadata` (`duration_seconds`, `page_id`, `referrer`, `props`), `occurred_at`.
- `sales` ganha `session_id`, `visitor_id`, `matched_session_at`, `match_method`.

Prefixo `tracking_` para nao confundir com `auth.sessions`.

### 4.2 Relacionamentos

Tudo escopado por `workspace_id` (FK para `workspaces`, `ON DELETE CASCADE`). `tracking_sessions.sale_id` → `sales.id` (`ON DELETE SET NULL`) aponta para a primeira linha do pedido; as demais linhas do pedido (order bumps) apontam para a sessao via `sales.session_id`.

### 4.3 Funcoes (RPC)

| Funcao | Quem chama | O que faz |
|---|---|---|
| `tracking_ingest` | `/collect` | Visitante + sessao + eventos numa ida ao banco |
| `tracking_match_sale` | `SalesService.upsertFromWebhook` | Casamento venda ↔ sessao (RN-13 a RN-16) |
| `tracking_stats` | `/tracking/stats` | Periodo atual e anterior, visitantes de hoje, serie diaria |
| `tracking_breakdown` | `/tracking/breakdown` | Por pagina, origem ou campanha |

Todas executaveis so pela `service_role`.

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/t/tracker.js?tid=` | Publico | O script, com a area e o endpoint injetados. `Cache-Control: public, max-age=3600`. Area desconhecida: script no-op |
| POST | `/api/t/collect` | Publico | Lote de eventos (`text/plain` ou JSON). Sempre 200 vazio |
| GET | `/api/tracking/stats` | JWT | `{ stats, funnel, daily }` |
| GET | `/api/tracking/funnel` | JWT | So o `funnel` |
| GET | `/api/tracking/breakdown?by=page\|source\|campaign` | JWT | Linhas agregadas |
| GET | `/api/tracking/status` | JWT | `{ eventsToday, lastEventAt }` |
| GET | `/api/tracking/journey/:saleId` | JWT | Sessao, visitante e eventos da venda |

Parametros de periodo iguais aos do Dashboard: `from`/`to` (YYYY-MM-DD, calendario de Sao Paulo) ou `period=all` (comeca na primeira sessao da area).

### 5.2 Por que sem fila (BullMQ/Redis)

A API roda como funcao serverless da Vercel, que congela a instancia assim que a resposta sai — nao ha processo de pe para um worker, e trabalho feito depois da resposta morre (foi o bug da sincronizacao do Meta, commit c03642e). Por isso:

- `/collect` **aguarda** a gravacao, feita numa unica chamada RPC. Custa dezenas de ms em vez de < 10ms, mas nao perde evento.
- O casamento roda dentro do webhook, **aguardado**, e nunca lanca: a venda ja esta gravada, e um erro aqui faria a plataforma reenviar.
- Os webhooks continuam inline, respondendo 401/500 quando falham — e o que faz a plataforma reentregar. Uma fila que respondesse 200 antes de processar esconderia a falha.
- A retencao e um job do pg_cron.

`/collect` fica fora do `ThrottlerGuard` global: ele conta por `req.ip`, que na Vercel e o IP da borda. O limite proprio conta pelo `x-forwarded-for`.

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

- `pages/Tracking.tsx` — pagina `/tracking`
- `components/tracking/TrackingSummaryCards.tsx` — os quatro cards (tambem no Dashboard)
- `components/tracking/TrackingFunnel.tsx` — barras horizontais, visitantes unicos em cada etapa
- `components/tracking/TrackingDailyCharts.tsx` — visitantes e vendas por dia em dois graficos empilhados sobre o mesmo eixo de datas (e nao um grafico de dois eixos Y)
- `components/tracking/TrackingBreakdownTable.tsx`
- `components/integrations/TrackingSnippetCard.tsx`
- `components/sales/SaleJourney.tsx` — dentro do `SaleDetailsDrawer`

### 6.2 Hooks

`hooks/useTracking.ts`: `useTrackingStats`, `useTrackingFunnel` (mesma consulta), `useTrackingBreakdown` / `useTrackingByPage` / `useTrackingBySource`, `useTrackingStatus`, `useSaleJourney`.

### 6.3 Gerenciamento de Estado

Query keys: `tracking-stats`, `tracking-breakdown`, `tracking-status`, `sale-journey`. `retry: false` — sem a migration aplicada as rotas falham e a UI simplesmente omite as secoes.

## 7. Pontos de Integracao

- **Webhooks** — todos os processors gravam por `SalesService.upsertFromWebhook`, que chama `VisitorMatchingService.matchSale` depois de gravar.
- **Atribuicao por UTM** — independente. A decoracao do link (RN-07) faz UTMs da pagina chegarem ao checkout quando o botao nao as repassava, o que pode transformar em atribuidas vendas que antes caiam como organicas.

## 8. Edge Cases e Tratamento de Erros

- Plataforma que nao devolve o `sck` no webhook: cai para `fbclid` / `utm_exact`, ou fica sem vinculo.
- Venda pendente (boleto/pix) que aprova dias depois: o casamento roda na gravacao da pendente.
- Visitante bloqueia cookies: cada pagina vira visitante novo; nao casa por `sck`.
- SPA (troca de rota sem recarregar): so o primeiro pageview e contado.
- Duracao inclui o tempo com a aba em segundo plano (entrada → saida, como especificado).
- `tracker.js` para area inexistente: script no-op com 200, para nao gerar erro no console da pagina do cliente.

## 9. Checklist de Testes

Automatizados:
- `tracking/__tests__/collect-payload.spec.ts` — validacao do lote, bots, aparelho
- `tracking/__tests__/tracker-script.spec.ts` — o `tracker.js` real em jsdom: cookies, UTMs, lote de 2s, saida, decoracao, DNT, fila pre-carga
- `tracking/__tests__/tracking.http.spec.ts` — rotas publicas com Fastify de verdade: `text/plain`, geo da Vercel, sem IP, limite por IP
- `sales/__tests__/sales.service.spec.ts` — casamento chamado, `stl_` fora do `ad_id`
- As funcoes SQL foram exercitadas em Postgres (PGlite): ingestao, os quatro metodos de casamento, candidata ambigua, stats, breakdown, permissoes

Manual, com trafego real:
- [ ] Snippet colado → card "Snippet ativo" em ate 30s
- [ ] Link do checkout inspecionado na pagina → tem `sck=stl_...`
- [ ] Compra de teste → venda com jornada no drawer, `match_method = sck`
- [ ] Conferir, por plataforma, se o `sck` volta no webhook. Os processors que guardam o `sck` no `metadata` (onde o casamento procura): Hotmart, Cakto, Greenn, GGCheckout, Mundpay, Kiwify e Kirvano. Os demais (CartPanda, Eduzz, Guru, Hubla, LastLink, Monetizze, Payt, PerfectPay, Ticto) nao guardam — ali o casamento depende de `fbclid` e `utm_exact` ate o processor passar a gravar o parametro
