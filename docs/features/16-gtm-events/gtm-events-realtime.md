# Eventos do GTM Server em Tempo Real

> **Modulo:** `packages/backend/src/modules/gtm-events` | **Pagina:** `packages/frontend/src/pages/Events.tsx`
> **Ultima atualizacao:** 2026-08-05
> **Status:** Implementado — pendente de validacao com trafego real
>
> **Pendencias operacionais antes de funcionar:**
> 1. Rodar `supabase/migrations/20260804120000_gtm_events.sql` — ja inclui o `ALTER PUBLICATION` que habilita o Realtime
> 2. Rodar `supabase/migrations/20260804140000_gtm_events_retention_cron.sql` — agenda o expurgo no pg_cron
> 3. Rodar `supabase/migrations/20260805120000_gtm_events_visit_number.sql` — numero da visita, com retroalimentacao dos eventos ja ingeridos
> 4. Deploy normal do backend e do frontend
> 4. (Opcional) Definir `GTM_VISITOR_SALT` no Render — se ausente, cai na service role key
> 5. Gerar o token em Integracoes e configurar a tag no container sGTM

---

## 1. Proposito

Uma aba que mostra, em tempo real, os eventos que o container server-side do GTM esta enviando para a Meta (CAPI). Serve para diagnosticar rastreamento sem sair do Sentinela: ver se o evento chegou, com quais parametros, se `fbp`/`fbc` vieram preenchidos, se o `event_id` esta consistente para deduplicacao com o pixel do navegador.

Beneficia apenas `allanss.ads@gmail.com` nesta primeira versao — e uma ferramenta de diagnostico do operador, nao um recurso de produto.

**Nao substitui** o painel da Stape: a resposta que a Meta devolve (aceite, rejeicao, `fbtrace_id`) nao e visivel aqui. Ver secao 10.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar `/events` | Item "Eventos", visivel apenas para o e-mail da allowlist |
| Integracoes | Card com a URL de ingestao e o token, para configurar a tag no sGTM |

### 2.2 Fluxo de UI

**Configuracao (uma vez):**
1. Em Integracoes, o usuario copia a URL de ingestao e o token do workspace.
2. No container sGTM (hospedado na Stape), cria uma tag HTTP Request apontando para essa URL, com o token no header.
3. Associa a tag **aos mesmos triggers que ja disparam a tag da Meta CAPI** — e o trigger que define o escopo, nao o backend.

**Uso diario:**
1. Abre `/events`. A lista comeca vazia e recebe eventos conforme chegam.
2. Cada linha traz: horario, nome do evento, valor/moeda, presenca de `fbp`/`fbc`, `event_id` truncado.
3. Botao **Pausar** congela o scroll — sem ele a lista fica ilegivel em volume.
4. Filtros por nome do evento e janela de tempo.
5. Clicar numa linha abre um drawer com o payload completo recebido.
6. No topo, contadores: eventos/min, % com `fbc`, % com `fbp`, total na janela.

**Card de visitantes no Dashboard — removido (2026-08-05).**

Existiu brevemente: um card com visitantes unicos e media de visitas, na linha
de metricas do Dashboard. Retirado a pedido do usuario. A informacao de visita
vive agora onde e util para diagnostico — no numero da visita de cada evento na
propria aba (RN-11b).

O que foi apagado: `VisitorsCard.tsx`, `useGtmVisits.ts`, o DTO e a rota
`GET /api/gtm/visits`. **A RPC `gtm_visit_metrics` continua no banco**, sem
chamador — dropar exigiria mais uma migracao manual para zero ganho. Se a
metrica voltar, em qualquer tela, o agregado ja esta pronto.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Ver a aba `/events` | E-mail na allowlist |
| Ler eventos via API | E-mail na allowlist **e** dono do workspace |
| Enviar eventos (ingestao) | Token valido do workspace (sem sessao de usuario) |
| Ver eventos de outro workspace | Ninguem — bloqueado por RLS |

**Diferenca importante em relacao a outros gates deste projeto:** aqui a allowlist precisa valer no backend tambem. Esta feature expoe dados; esconder apenas a rota no frontend deixaria a API acessivel a qualquer usuario autenticado.

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Autenticacao por token | Request sem header `X-Sentinela-Token` ou com token invalido | 401, nada gravado |
| RN-02 | Escopo definido no GTM | Sempre | O backend aceita qualquer evento enviado; quais eventos chegam e decisao do trigger da tag |
| RN-03 | Deduplicacao | Chega evento com `event_id` ja gravado no mesmo workspace | Ignorado silenciosamente, resposta 200 |
| RN-04 | Aceita lote | Body e um array | Cada item validado individualmente; itens invalidos sao descartados sem derrubar o lote |
| RN-05 | Descarte de PII | Sempre | `user_data` (em, ph, external_id) e o IP do cliente **nao** sao gravados |
| RN-05b | `_fbp` so em hash | Evento traz `fbp` | Grava `sha256(fbp + GTM_VISITOR_SALT)` em `visitor_hash`. O cookie cru nunca e persistido |
| RN-11 | Visita = acesso | Sempre | Cada `PageView` e uma visita. Tres acessos seguidos sao tres visitas, por mais proximos que estejam |
| RN-11b | Numero da visita | Cada evento na aba | Quantas visitas aquela pessoa teve ate aquele evento, inclusive. Num `PageView` e a posicao dele; num `Purchase`, quantas visitas ate comprar |
| RN-11e | Contagem por subdominio | Evento tem `page_host` | Escopada ao host. `loja.exemplo.com` e `blog.exemplo.com` tem sequencias independentes, e `www.` conta como subdominio |
| RN-11f | Evento sem `page_url` | `page_host` nulo | Conta os acessos em **todos** os hosts da pessoa. Nao ha host a que se ancorar, e o total e a resposta honesta. `visit_scope = 'all_hosts'` sinaliza isso na resposta |
| RN-11d | Sem PageView antes | `visit_number = 0` | Exibe `—`. O evento chegou sem nenhum acesso registrado antes dele |
| RN-11c | Chave da pessoa | Sempre | `id_do_usuario` quando o site manda; senao o hash do `_fbp`. Quem navega antes de logar tambem e um visitante |
| RN-14 | Evento sem identificacao | `visitor_key` nulo | Aparece na lista com `—` no lugar do numero da visita |
| RN-15 | Janela limitada pela retencao | Sempre | O numero cobre so o que sobreviveu ao expurgo: "1a visita" e a primeira nos ultimos 30 dias, nao na vida |
| RN-06 | Retencao | Diariamente | Eventos com mais de 30 dias sao apagados |
| RN-07 | Ingestao nao bloqueia | Falha ao gravar | Responde 200 mesmo assim; o sGTM nao deve reprocessar por erro nosso |
| RN-08 | Isolamento por workspace | Sempre | RLS restringe leitura ao dono do workspace |
| RN-09 | Gate duplo | Usuario fora da allowlist chama a API | 403, mesmo autenticado |
| RN-10 | Tempo real via Postgres | Evento gravado | Chega na tela por Supabase Realtime, sem polling |
| RN-16 | Pausa congela a lista, nao a medicao | Stream pausado | Eventos novos vao para um buffer; os contadores continuam contando, a lista fica parada |
| RN-17 | Lote limitado | Body com mais de 200 itens | Os 200 primeiros sao processados; o excedente e descartado |

---

## 4. Modelo de Dados

### 4.1 Tabela `gtm_events`

| Coluna | Tipo | Nulavel | Descricao |
|---|---|---|---|
| id | UUID | Nao | PK |
| workspace_id | UUID | Nao | FK para workspaces |
| user_id | UUID | Nao | Dono, para RLS |
| event_name | TEXT | Nao | Purchase, InitiateCheckout, ViewContent... |
| event_id | TEXT | Sim | Chave de deduplicacao com o pixel do navegador |
| event_time | TIMESTAMPTZ | Nao | Horario informado pelo evento |
| value | NUMERIC | Sim | Valor da conversao |
| currency | TEXT | Sim | Moeda |
| page_url | TEXT | Sim | URL de origem |
| has_fbp | BOOLEAN | Nao | Se o cookie `_fbp` veio preenchido |
| has_fbc | BOOLEAN | Nao | Se o cookie `_fbc` veio preenchido |
| visitor_hash | TEXT | Sim | `sha256(fbp + GTM_VISITOR_SALT)`. Chave estavel por navegador |
| external_user_id | TEXT | Sim | Id que o site manda como `id_do_usuario`. Nao e hasheado: e o identificador do operador para o proprio usuario dele, e precisa continuar legivel para servir de diagnostico |
| visitor_key | TEXT | Gerada | `COALESCE(external_user_id, visitor_hash)` STORED. Uma chave so, para consultas e indices nao repetirem o fallback |
| page_host | TEXT | Gerada | Host extraido de `page_url` — sem esquema, caminho, query nem porta, em minusculas. Granularidade de subdominio: `www.` e mantido de proposito |
| fbclid | TEXT | Sim | Quando presente |
| raw | JSONB | Sim | Payload recebido **ja sem PII** |
| created_at | TIMESTAMPTZ | Nao | Momento da ingestao |

**Indices:**
- `(workspace_id, created_at DESC)` — a consulta da tela
- `(workspace_id, event_name, created_at) INCLUDE (visitor_hash)` — a agregacao de visitas
- BRIN em `created_at` — para o expurgo, tabela append-only
- Unico `(workspace_id, event_id)` — deduplicacao

**Desvio do plano original:** o indice de deduplicacao ia ser parcial
(`WHERE event_id IS NOT NULL`), o que seria um pouco menor. Nao da: `ON CONFLICT`
so infere um indice parcial se o predicado for repetido na clausula, e o
parametro `on_conflict` do PostgREST aceita apenas uma lista de colunas. Como o
Postgres trata NULLs como distintos por padrao, eventos sem `event_id` nunca
colidem no indice completo — o resultado e o mesmo, sem a limitacao.

### 4.2 Coluna nova em `workspaces`

| Coluna | Tipo | Descricao |
|---|---|---|
| gtm_ingest_token | TEXT | Token de ingestao, gerado sob demanda. Indexado para o lookup do webhook |

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Guard | Descricao |
|---|---|---|---|
| POST | `/api/gtm/events` | Nenhum — token no header | Recebe evento ou lote do sGTM |
| GET | `/api/gtm/events` | AuthGuard + OperatorGuard | Historico paginado (keyset por `created_at`) |
| GET | `/api/gtm/events/:id/raw` | AuthGuard + OperatorGuard | Payload completo, para o drawer de detalhe |
| GET | `/api/gtm/visitors` | AuthGuard + OperatorGuard | Ranking de quem mais visita no periodo |
| GET | `/api/gtm/token` | AuthGuard + OperatorGuard | Token atual do workspace |
| POST | `/api/gtm/token` | AuthGuard + OperatorGuard | Gera/rotaciona o token do workspace |

A ingestao vive num controller separado (`GtmIngestController`) do resto
(`GtmEventsController`). Nao e organizacao decorativa: um controller esta atras
de `AuthGuard` e da allowlist, o outro autentica por token de workspace. Rotas
adicionadas a qualquer um dos dois herdam a protecao certa por construcao.

As consultas de evento (`list`, `getRaw`, `visits`) filtram por `user_id`, entao
sao auto-escopadas: um `workspace_id` de outro usuario simplesmente nao retorna
nada. Ja o token e segredo do workspace e nao tem esse filtro implicito — por
isso `getToken` filtra por `user_id` explicitamente, e `rotateToken` usa a linha
devolvida pelo `UPDATE` como prova de posse. Sem isso, a service role (que
ignora RLS) entregaria o token de qualquer workspace.

### 5.2 Contrato da ingestao

```
POST /api/gtm/events
X-Sentinela-Token: <token do workspace>
Content-Type: application/json

{
  "event_name": "Purchase",
  "event_id": "abc123",
  "event_time": 1754300000,
  "value": 197.00,
  "currency": "BRL",
  "page_url": "https://...",
  "fbp": "fb.1...",
  "fbc": "fb.1...",
  "fbclid": "..."
}
```

Resposta sempre `200 {"received": n}`. O sGTM nao precisa saber de erro nosso (RN-07).

### 5.3 Logica

1. Le o token do header, resolve o workspace (cache em memoria de 60s, para nao consultar o banco a cada evento).
2. Normaliza: `fbp`/`fbc` viram os booleanos `has_fbp`/`has_fbc`; o valor cru do cookie nao e guardado.
3. Remove `user_data` e qualquer campo de PII antes de montar o `raw`.
4. Insert em lote com `onConflict` no indice de deduplicacao.
5. `@Throttle` proprio de 1200/min, bem acima do limite global de 60/min.

**Sempre 200**, inclusive com token invalido — o sGTM reprocessa em caso de erro,
e reprocessar falha nossa so multiplicaria carga. `received` diz o que entrou de
fato.

Rotacionar o token invalida a entrada em cache na hora, entao o token antigo
para de valer imediatamente.

### 5.4 Cron de retencao

`pg_cron`, definido em `20260804140000_gtm_events_retention_cron.sql`. Job
`gtm-events-retention`, `0 4 * * *` (01:00 em Sao Paulo), apagando
`created_at < now() - interval '30 days'` pelo indice BRIN.

Escolhido em vez de um `@Cron` no NestJS: e uma operacao puramente de Postgres,
e passar por um servidor de aplicacao so amarraria o expurgo a esse servidor
estar acordado.

### 5.3b Filtro de data e ranking de visitantes

A aba tem duas visoes, em abas: **Eventos** (o stream) e **Quem mais visita**
(`gtm_top_visitors`). O filtro de data no header vale para as duas, e usa o
mesmo `DateRangeFilter` do Dashboard — inclusive o preset "Todo periodo", que
e o padrao aqui. A retencao de 30 dias ja e o piso real; esconder dado atras de
um filtro que o usuario nao escolheu, numa tela de diagnostico, so faz perseguir
bug que nao existe.

**O historico da numeracao nao e filtrado pela data.** O CTE `history` dentro de
`gtm_events_page` ignora `p_from`/`p_to` de proposito. O numero da visita e um
fato sobre a pessoa, nao sobre o que a tela mostra: filtrar isso renumeraria a
5a visita de alguem como 1a no instante em que voce filtrasse para hoje, e o
numero passaria a significar coisas diferentes conforme o filtro.

**O ranking, ao contrario, conta dentro do periodo.** Sao perguntas diferentes:
no evento e "qual visita daquela pessoa foi essa", no ranking e "quem apareceu
mais nesta janela". A tela diz isso embaixo da tabela, porque os dois numeros
ficam a um clique um do outro e a diferenca nao e obvia.

**Colunas por tipo de evento.** Cada linha traz `events_by_name`, um objeto
jsonb com a contagem por nome (`{"page_view": 6, "add_to_cart": 1, ...}`), o que
faz a linha ler como funil: quantos acessos, quantos carrinhos, quantas compras.

E objeto em vez de colunas fixas porque o conjunto de nomes e o que os gatilhos
do sGTM mandam — nao da para saber aqui, e muda quando uma tag e adicionada.

**Quais colunas existem vem dos dados; a ordem e fixa.** As etapas do funil vem
primeiro, em `FUNNEL_ORDER` (`page_view`, `add_to_cart`, `begin_checkout`,
`purchase`), e o que nao esta na lista entra depois, por volume. Ordenar tudo por
volume punha o topo do funil a esquerda por coincidencia, nao por significado —
e a coincidencia quebra no primeiro periodo com mais carrinhos do que acessos.
Os nomes sao comparados normalizados, porque templates de tag escrevem
`page_view`, `pageview` ou `PageView` indiferentemente.

Teto de 8 colunas; o excedente e somado em "outros" em vez de sumir. Uma coluna
que esconde evento em silencio seria pior do que uma que agrupa.

Eventos que chegam ao vivo tambem passam pelo filtro de data no cliente. Sem
isso, filtrar para uma janela passada continuaria mostrando evento de hoje
entrando na lista.

### 5.4b Numero da visita

`gtm_events_page` substitui o SELECT simples que a aba usava. O numero da visita
nao sai de uma pagina de linhas — depende de tudo o que aquela pessoa fez antes.
Entao a RPC seleciona a pagina primeiro e so depois varre o historico **dos
visitantes daquela pagina**, somando `PageView` numa janela corrente ate a linha.

Uma contagem so responde as duas perguntas: num `PageView` o acumulado e a
posicao do proprio acesso; num `Purchase` e quantos acessos vieram antes da
compra.

**Sessionizacao foi descartada.** A primeira versao cortava visita a cada 30
minutos de inatividade, tratando tres acessos numa mesma sentada como uma visita
so. O operador quer cada acesso contado. Isso simplificou tudo: nao ha mais
`LAG`, janela de tempo, nem constante espelhada entre SQL e frontend.

**O nome do evento e normalizado** (`lower` + remove `_`), porque templates de
tag escrevem `PageView`, `pageview` ou `page_view` conforme o client.

**A contagem e por subdominio.** A janela e particionada por `visitor_key` **e**
`page_host`, entao a mesma pessoa tem uma sequencia independente em cada site.

**Evento sem `page_url` conta em todos os hosts.** A RPC calcula as duas somas
correntes — por host e por pessoa — e escolhe pela presenca do host. O campo
`visit_scope` diz qual foi usada, para a tela nao apresentar um numero por site
como se fosse o total.

Isso apareceu com dado real: um `Purchase` chega sem `page_url`, caia numa
particao de host nulo sozinho e reportava zero visitas para alguem que tinha
acessado seis paginas em cinco subdominios antes de comprar. Mandar `page_url`
na tag de compra nao resolveria — o host seria a pagina de checkout, visitada
uma vez.

**Eventos ao vivo nao passam por essa RPC.** O Realtime entrega a linha, nao o
agregado. Em vez de uma requisicao por evento, o numero continua do evento mais
recente do mesmo `visitor_key` **no mesmo host** que ja esta na tela: `PageView`
incrementa, qualquer outro repete. Casar o host importa — continuar de um evento
de outro site devolveria numero da sequencia errada. Sem nada carregado daquele
host, fica `—` e aparece no proximo refresh, em vez de chutar.

### 5.5 Media de visitas: numerador

`avg_visits_per_visitor` divide acessos (`PageView`) por visitantes unicos, e
ambos contam so o que tem `visitor_key`. Eventos sem nenhuma identificacao
aparecem a parte, como `unidentified_visits`.

A funcao esta sem chamador desde a remocao do card do Dashboard. Foi mantida
alinhada a definicao de visita mesmo assim: deixa-la contando sessao faria
"visita" significar duas coisas dependendo de qual funcao se lesse.

---

## 6. Implementacao no Frontend

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Events | `src/pages/Events.tsx` | Pagina, filtros, contadores |
| GtmIngestCard | `src/components/integrations/GtmIngestCard.tsx` | URL, token e instrucoes da tag, em Integracoes |
| EventStreamList | `src/components/events/EventStreamList.tsx` | Lista virtualizada com pausar |
| TopVisitorsTable | `src/components/events/TopVisitorsTable.tsx` | Ranking de quem mais visita no periodo |
| useGtmTopVisitors | `src/hooks/useGtmTopVisitors.ts` | Busca `/gtm/visitors` para o periodo selecionado |
| EventDetailDrawer | `src/components/events/EventDetailDrawer.tsx` | Payload completo |
| useGtmEventStream | `src/hooks/useGtmEventStream.ts` | Historico inicial + subscription Realtime |
| featureAccess | `src/lib/featureAccess.ts` | Allowlist por e-mail, espelhada no guard do backend |
| gtmEvents | `src/types/gtmEvents.ts` | Tipos compartilhados |

**Dependencia nova:** `@tanstack/react-virtual` (^3.14.9). O `CLAUDE.md` exige virtualizacao acima de 100 itens e um stream passa disso em minutos.

**Primeiro uso de Supabase Realtime no projeto.** A tabela precisa estar na publicacao `supabase_realtime`; isso vai na propria migracao via `ALTER PUBLICATION`, entao nao ha passo manual no painel. Como so `INSERT` e assinado, a replica identity padrao basta.

**A pagina e um chunk lazy** (`Events-*.js`, ~35 kB), via `lazyWithReload` no `App.tsx`. Ninguem fora da allowlist baixa esse codigo.

**Eventos em buffer durante a pausa ficam em state, nao em ref**, para os contadores continuarem se movendo (RN-16). `EventStreamList` e memoizado justamente para que essas atualizacoes nao re-renderizem a lista que o usuario pediu para congelar.

---

## 6.1 Onde cada parte roda

| Parte | Onde | Por que |
|---|---|---|
| Ingestao | API no Render | Mesmo caminho dos webhooks de checkout, que ja e o fluxo de maior volume do backend |
| Retencao | pg_cron no Postgres | Operacao puramente de banco |
| Stream ao vivo | Supabase Realtime → navegador | Nunca passou pelo backend |
| Historico, visitas, token | API no Render | — |

**Alternativa avaliada e descartada: Edge Function do Supabase para a ingestao.**
Isolaria o volume de PageView da API do dashboard, o que e um ganho real. Mas
adiciona um segundo runtime, um segundo caminho de deploy (CLI do Supabase ou
colagem manual no painel) e, o pior, uma segunda copia da logica de remocao de
PII — a pior candidata possivel a divergir entre implementacoes. No volume atual
o ganho e especulativo e o custo operacional e imediato. Se um dia a ingestao
comecar a competir com o dashboard, o caminho e **mover**, nunca duplicar.

## 7. Pontos de Integracao

- **sGTM na Stape (plano Pro)** — a tag HTTP Request e a unica via disponivel nesse plano. Export de logs exige Enterprise; Monitoring exige Business; nao ha API publica de leitura de logs.
- **Supabase Realtime** — Postgres como barramento. Escolhido em vez de SSE porque o backend roda com clustering no Render: a instancia que recebe o evento pode nao ser a que segura a conexao, e SSE exigiria Redis para fan-out.
- **Integracoes** — ganha o card de token e instrucoes.

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Requisicao sem `Content-Type` | Corpo e lido como JSON mesmo assim. O Fastify responderia 415 antes do handler, e a tag do sGTM nem sempre rotula o corpo — ver `common/parsers/unlabelled-json.parser.ts`. Vale so para `/api/gtm/events`; as demais rotas seguem recusando |
| Corpo malformado | Tratado como corpo vazio, resposta 200 com `received: 0`. Rejeitar transformaria payload quebrado em loop de retry |
| Token invalido ou ausente | 401, nada gravado |
| Evento sem `event_id` | Gravado sem deduplicacao |
| Evento duplicado | Descartado por conflito no indice unico, resposta 200 |
| Lote com item invalido | Itens validos entram, invalidos sao descartados |
| Volume alto derrubando a UI | Botao pausar + virtualizacao + limite da janela em memoria |
| Realtime cai | Reconecta e refaz o fetch inicial para cobrir o intervalo perdido |
| Workspace trocado com a aba aberta | Encerra a subscription e reassina no novo workspace |

---

## 9. Checklist de Testes

### Cobertos por teste automatizado

`packages/backend/src/modules/gtm-events/__tests__/` — 23 testes, todos passando.

- [x] POST sem token → nada gravado
- [x] Token desconhecido → nada gravado
- [x] Evento gravado com o `workspace_id` e `user_id` do dono do token, nao do workspace ativo
- [x] Lote com 1 item invalido entre 3 → grava 2
- [x] Lote de 250 itens → grava 200
- [x] Deduplicacao configurada em `(workspace_id, event_id)` com `ignoreDuplicates`
- [x] Falha no insert → retorna 0 sem lancar excecao
- [x] `user_data`, e-mail, telefone e IP removidos em qualquer profundidade, inclusive dentro de arrays
- [x] `_fbp` cru nao aparece em nenhuma coluna nem dentro de `raw`
- [x] `visitor_hash` estavel para o mesmo cookie, diferente com outro salt, e nunca contem o cookie
- [x] Evento sem `_fbp` → `visitor_hash` nulo
- [x] `event_time` aceita unix em segundos, em milissegundos e ISO; timestamp invalido cai para `now()`

### Pendentes — exigem banco, Realtime ou trafego real

- [ ] Mesmo `event_id` duas vezes → uma linha so (depende do indice unico no banco)
- [ ] Evento gravado aparece na aba sem refresh
- [ ] Usuario fora da allowlist: sem item no menu **e** 403 na API
- [ ] Usuario fora da allowlist nao ve eventos via Realtime (RLS)
- [ ] Cron apaga evento com 31 dias e mantem o de 29
- [ ] 500 eventos na lista sem travar o scroll
- [ ] Pausar congela a lista e o contador continua
- [ ] Mesmo `_fbp` em 3 PageView → 1 visitante unico, 3 visitas, media 3,0
- [ ] PageView sem `_fbp` → entra em total, fica fora de unicos, aparece no contador de nao identificados
- [ ] Purchase e InitiateCheckout nao contam como visita
- [ ] `EXPLAIN ANALYZE` da RPC de visitas com 30 dias de PageView usa indice, sem seq scan

---

## 10. Questoes Abertas / TODOs

- **Resposta da Meta nao e capturada.** Uma tag dentro do container ve o que entra, nao o retorno que a tag da Meta recebeu da CAPI. Ver `fbtrace_id` ou motivo de rejeicao exige os logs de saida da Stape, disponiveis apenas no painel (3 dias no plano Pro) ou via Export (Enterprise). Decisao: seguir sem isso.
- **Alternativa descartada:** Logger Tag → BigQuery → polling. Traria potencialmente a saida, mas custa credencial GCP, dependencia nova e deixa de ser tempo real. Nao confirmado se o Logger Tag captura resposta.
- **Alternativa descartada:** o Sentinela virar emissor da CAPI. Daria visibilidade total da resposta, mas transforma o produto de observador em participante do rastreamento, com risco de evento duplicado na Meta.
- **Allowlist como constante.** A partir de ~3 contas, migrar para feature flag por usuario (coluna `jsonb` em `profiles` + toggle no admin).
- **O numero da visita e limitado pela retencao.** O expurgo de 30 dias apaga o historico, entao "1a visita" significa *primeira visita nos ultimos 30 dias*, nao na vida. Quem visita todo mes vai aparecer como visitante novo de novo. Se o numero absoluto passar a importar, o caminho e uma tabela de agregado por visitante que sobreviva ao expurgo — nao aumentar a retencao.
- **`id_do_usuario` e guardado em claro**, ao contrario do `_fbp`. Sao coisas diferentes: o `_fbp` e cookie de rastreamento de terceiro, esse e o identificador do proprio operador para o proprio usuario dele, e so serve se der para ler. Se um dia virar e-mail ou documento em vez de id interno, essa decisao precisa ser revista.
- **Mesma pessoa com e sem `id_do_usuario` conta como duas.** Navegou deslogada e depois logou: o `visitor_key` muda de hash para id no meio do caminho e a numeracao reinicia. Resolver exigiria costurar as duas chaves quando aparecem juntas num evento — vale se o caso for comum.
- **Site que responde em `www` e sem `www` divide a contagem.** Como `www.` e tratado como subdominio, `www.exemplo.com` e `exemplo.com` viram duas sequencias. Na pratica um redireciona para o outro e so uma forma aparece; se as duas aparecerem, o ajuste e um `regexp_replace(..., '^www\.', '')` na expressao de `page_host`.
- **`Purchase` sem `PageView` na frente aparece como `—`, nao como zero visitas.** Acontece quando a tag da compra dispara mas a de acesso nao, ou quando os dois chegam fora de ordem. Se aparecer com frequencia, o problema esta no gatilho do PageView, nao aqui.
- **"Visitante" e navegador, nao pessoa.** O `_fbp` e um cookie de primeira parte por navegador. A mesma pessoa no celular e no desktop conta como dois visitantes; quem limpa cookies vira um visitante novo. O numero e util para tendencia, nao para contagem exata de individuos.
- **`GTM_VISITOR_SALT` precisa ser estavel.** Se o salt mudar, todos os hashes mudam e a continuidade do visitante quebra na virada — visitantes antigos e novos deixam de casar. Definir uma vez no Render e nao rotacionar sem aceitar essa quebra.
- **Custo do `COUNT(DISTINCT)`.** Com 30 dias de PageView a contagem de unicos pode ficar cara. O indice com `INCLUDE (visitor_hash)` cobre a consulta, mas vale rodar `EXPLAIN ANALYZE` com volume real. Se doer, o caminho e uma tabela de agregado diario preenchida por cron.
- **Retencao de 30 dias.** Definida pelo usuario. E o principal fator de tamanho da tabela: PageView e o evento de maior volume, entao 30 dias de PageView domina o custo de armazenamento. Reavaliar depois de medir.
- **`GTM_VISITOR_SALT` tem fallback para a service role key.** Se a variavel nao estiver definida, o hash usa a service role key como salt: continua estavel e secreta, e a ingestao nao quebra. Nao substitui definir a variavel — rotacionar a service role key quebraria a continuidade dos visitantes sem aviso.
- **Nada foi exercitado com o backend rodando.** O ambiente local nao sobe a API (o `.env` esta sem os segredos). Compilacao, lint, build e os testes unitarios passam; o caminho fim-a-fim so sera validado em producao, com a tag configurada.
- **Rate limit da ingestao e por IP.** 1200 req/min via `@Throttle`. Como todos os eventos vem do mesmo container, esse e o teto agregado — se um dia apertar, o caminho e agrupar em lote, nao aumentar o numero.
- **PageView compete com a API do dashboard pela mesma instancia.** E o custo consciente de manter a ingestao no Render. O sinal de que passou da hora de isolar: latencia do dashboard subindo junto com o trafego do site, nao volume da tabela.
