# API de Conversões do Meta (server-side, first-party)

> **Modulo:** `packages/backend/src/modules/meta-capi` | **Tela:** Integrações → "Rastreio de visitantes" e "API de Conversões do Meta"
> **Ultima atualizacao:** 2026-09-29
> **Status:** Implementado — pendente de validacao com trafego real
>
> **Pendencias operacionais antes de funcionar:**
> 1. Rodar `supabase/migrations/20260928000000_rastreio_de_visitantes.sql` (se ainda nao rodou) e depois `20260929000000_meta_capi.sql`
> 2. Definir `CRON_SECRET` na Vercel (reenvio diario de falhas)
> 3. No DNS do cliente: `CNAME track → cname.vercel-dns.com`; adicionar o subdominio no projeto da Vercel
> 4. Em Integracoes: plataforma, subdominio (Verificar), pixel, token; colar o snippet na pagina

---

## 1. Proposito

Substitui os containers do sGTM (pasta `Containers/`, um por plataforma) pelo proprio painel. O desenho e o mesmo:

| Container (sGTM + Stape) | Painel |
|---|---|
| GTM web gera o indexador e poe na URL | `tracker.js` gera `stl_<sessao>` e poe na URL da pagina, nos links e formularios do checkout |
| GA4 → sGTM → tag "BD" (Stape Store Writer) grava fbp, fbc, IP, UA, page_location, id, estado, pais | `/api/t/collect` grava na `tracking_sessions` |
| Tags "FB PageView" / "FB InitiateCheckout" | `MetaCapiService.sendWebEvents`, no mesmo `/collect` |
| Data Client recebe o webhook | `/api/webhooks/<plataforma>` (processors ja existentes) |
| Variaveis "VC" (Stape Store Lookup) buscam pelo indexador | `tracking_match_sale` liga a venda a sessao |
| Tag "FB Purchase" | `MetaCapiService.sendPurchases`, ao fim do webhook |

Tudo no subdominio do cliente (`track.loja.com.br`) apontado para o projeto na Vercel: requisicao first-party, IP real do visitante, sem bloqueio por adblock, cookies gravados pelo servidor.

## 2. Fluxo

1. A pagina carrega o snippet de `https://track.loja.com.br/api/t/tracker.js?tid=<area>`.
2. O script le ou cria `_fbp` e `_fbc` (este a partir do `fbclid`), gera a sessao e escreve `stl_<sessao>` no parametro da plataforma.
3. **PageView** no `DOMContentLoaded`, enviado na hora.
4. **InitiateCheckout** quando a visita vai para o checkout: clique em link, envio de formulario, `window.open`, ou redirecionamento por script (Navigation API, Chrome/Edge). Um por carregamento de pagina.
5. `/collect` grava a sessao (com fbp, fbc, IP, UA, cidade/estado/pais da Vercel) **e** manda os eventos para a CAPI, em paralelo, antes de responder.
6. O checkout devolve o indexador no webhook. `WebhookQueueService` acha o `stl_...` no corpo cru — qualquer campo, qualquer plataforma — e o grava em `metadata.tracking_ref` da venda.
7. A venda aprovada nova e ligada a sessao; terminado o processor, sai **um Purchase por pedido** (a Hubla grava uma linha por produto; o valor e a soma).

## 3. Regras de Negocio

| # | Regra | Resultado |
|---|---|---|
| RN-01 | Parametro por plataforma | `sck` (Hotmart, Kiwify, Cakto, GGCheckout, Ticto, Mundpay, PerfectPay, Lastlink, CartPanda, Guru, Wiven), `src` (Kirvano, Payt, Monetizze, Frendz, Herospark, Kavoo), `xcod` (Greenn, PagTrust, Assiny), `trk` (Eduzz), `utm_term` (Hubla, Yampi, Wiapy, Doppus) |
| RN-02 | Parametro ja usado pelo cliente | Nao e trocado — exceto `utm_term`, que e a unica chave dessas plataformas |
| RN-03 | event_id | UUID gerado na pagina para PageView e InitiateCheckout; `purchase:<pedido>` no Purchase |
| RN-04 | Espelho no navegador | Ligado: o snippet chama `fbq('track', ..., {}, {eventID})` com o mesmo id, e o Meta deduplica. Exige tirar o `fbq('track','PageView')` do codigo base do pixel |
| RN-05 | user_data | em, ph (com 55), fn, ln, st, zp, country e external_id em SHA-256 normalizado; IP, user agent, fbp e fbc em claro. Cidade (ct) não vai em nenhum evento |
| RN-06 | external_id | SHA-256 do `_stl_vid` — o mesmo nos tres eventos |
| RN-07 | Estado e país | Da geolocalizacao do IP, gravada na visita (o endereço do webhook nem sempre está certo); na falta, do comprador (webhook). A cidade fica só na sessão, para relatórios |
| RN-08 | Purchase sem visita | Sai mesmo assim, so com os dados do comprador |
| RN-09 | Purchase duplicado | `capi_events` UNIQUE (area, evento, event_id): reserva antes de enviar; webhook reentregue nao reenvia |
| RN-10 | Compra antiga | `event_time` > 7 dias (limite do Meta) vira a hora do envio |
| RN-11 | Valor | `sales.amount` — respeita a opcao "usar comissao" de cada integracao |
| RN-12 | Falha | Registrada com a mensagem do Meta e o `fbtrace_id`; reenvio pelo botao ou pelo cron diario (ate 5 tentativas, 7 dias) |
| RN-13 | Codigo de teste | Preenchido: eventos vao para "Eventos de teste" no Gerenciador |
| RN-14 | Cookies do servidor | No subdominio, `/collect` regrava `_stl_vid` (1 ano), `_fbp` e `_fbc` (90 dias) no dominio raiz |
| RN-15 | IP | Guardado na sessao para a CAPI; apagado aos 90 dias |

## 4. Modelo de Dados

- `workspaces`: `tracking_platform`, `tracking_param` (CHECK), `tracking_domain`, `meta_pixel_id`, `meta_capi_token` (cifrado), `meta_test_event_code`, `meta_mirror_browser`.
- `tracking_sessions`: `fbp`, `fbc`, `ip_address`.
- `tracking_events.metadata.event_id`.
- `capi_events`: um envio por linha — `status` (`pending`/`sent`/`failed`), `attempts`, `payload` (o evento enviado), `response`, `fbtrace_id`, `error`, `pixel_id` (o pixel que recebeu). Retencao: 10 dias, todos os eventos (job tracking-retention).

## 5. API

| Metodo | Path | Auth | Descricao |
|---|---|---|---|
| GET | `/api/capi/settings?workspace_id=` | JWT | Configuracao (sem o token; `has_capi_token`) |
| PATCH | `/api/capi/settings` | JWT | Campos omitidos nao mudam; string vazia apaga |
| GET | `/api/capi/events?workspace_id=` | JWT | Ultimos envios e contagem de 24h |
| POST | `/api/capi/retry` | JWT | Reenvia as falhas da area |
| GET | `/api/capi/retry-cron` | `Bearer $CRON_SECRET` | Chamado pela Vercel Cron (diario) |
| GET | `/api/t/ping` | Publico | Verificacao do subdominio |

## 6. Pontos de atencao

- **Safari 16.4+** limita a 7 dias cookies gravados por um servidor cujo IP difere do site principal — o caso da Vercel. O subdominio ainda vale pelo resto (adblock, IP real, Chrome), mas nao contorna esse limite.
- **Plataformas que so existiam nos containers** (Wiven, Frendz, Herospark, Kavoo, PagTrust, Assiny, Yampi, Wiapy, Doppus): tem processor desde 2026-09-29 — ver secao 8.
- **Venda que vira aprovada depois** (pendente → aprovada por atualizacao) nao dispara Purchase: os processors atuais nao promovem a venda pendente (a Hotmart registra "skipping duplicate"). O Purchase sai quando a venda e gravada ja aprovada.
- **Painel no subdominio**: o subdominio aponta para o projeto inteiro, entao `track.loja.com.br` tambem abre a tela de login do painel.
- **Cron diario**: no plano Hobby a Vercel so aceita cron diario; no Pro, encurtar em `vercel.json`.
- **Containers de origem** tinham dois bugs que nao foram copiados: `state` recebia o pais (`X-GEO-Country`) e `city` era lida mas nunca gravada.

## 7. Testes

- `meta-capi/__tests__/meta-user-data.spec.ts` — normalizacao e hash
- `meta-capi/__tests__/meta-capi.service.spec.ts` — PageView/InitiateCheckout num lote, Purchase por pedido com soma, sem visita, reserva duplicada, compra antiga, falha e Meta fora do ar
- `webhooks/__tests__/webhook-capi-flow.spec.ts` — indexador achado no corpo cru, Purchase depois do processor, webhooks simultaneos sem mistura de contexto
- `tracking/__tests__/tracker-script.spec.ts` — o script real em jsdom: fbp/fbc, parametro por plataforma, URL da pagina, formulario, `window.open`, espelho no `fbq`
- `tracking/__tests__/tracking.http.spec.ts` — `/collect` → CAPI, cookies de servidor, ping
- As duas migrations em Postgres (PGlite), a segunda aplicada duas vezes

Manual, com trafego real:
- [ ] Codigo de teste preenchido → PageView e InitiateCheckout em "Eventos de teste"
- [ ] Compra de teste por plataforma → Purchase com fbp, fbc, IP e external_id; qualidade de correspondencia no Gerenciador
- [ ] Conferir que o indexador volta no webhook de cada plataforma usada

## 8. Processor das plataformas dos containers

> **Migration:** `supabase/migrations/20260929100000_plataformas_dos_containers.sql` (libera as 9 no CHECK de `checkout_integrations`)
> **Codigo:** `packages/backend/src/modules/webhooks/processors/generic/`

Wiven, Frendz, Herospark, Kavoo, PagTrust, Assiny, Yampi, Wiapy e Doppus usam **um processor so**, dirigido pela tabela `checkout-specs.ts`: o que muda entre elas e onde cada campo mora no payload. O fluxo e o dos processors existentes — venda aprovada por `SalesService.upsertFromWebhook` (casamento com a visita e Purchase da CAPI vem dai), reembolso atualiza a venda existente e nunca cria linha.

**Autenticacao:** token gerado no painel, na URL do webhook (`?token=`), como na Mundpay. O Data Client dos containers nao autenticava nada; aqui, sem token, 401 — para a plataforma reentregar em vez de a venda sumir.

| Plataforma | Aprova quando | Valor gravado | Indexador |
|---|---|---|---|
| Wiven | evento `TRANSACTION_PAID` | comissao (`transaction.commissionAmount`) | `trackProps.sck` |
| Frendz | status pago (evento e sempre `transaction`); sem status, aprova | `offer.price` em centavos | `tracking.src` |
| Herospark | sem status, aprova (como o container) | `purchase.price.value` | `utm.src` |
| Kavoo | sem status, aprova (como o container) | comissao (`transaction.fee_producer`) em centavos | `tracking.src` |
| PagTrust | `PURCHASE_APPROVED` / `PURCHASE_COMPLETE` | `data.purchase.price.value`; comissao com a opcao ligada | `data.purchase.origin.xcod` |
| Assiny | `approved_purchase` | `data.offer.amount_client` em centavos | `data.metadata.url_parameters.xcod` |
| Yampi | `order.paid` | `resource.value_total` | `resource.utm_term` |
| Wiapy | sem status, aprova (como o container) | `payment.amount` em centavos | `tracking.utm_term` |
| Doppus | sem status, aprova (como o container) | comissao (`transaction.fee_producer`) em centavos | `tracking.utm_term` |

### O que e confirmado e o que e suposicao

- **Confirmado pelos containers em uso:** id da transacao, e-mail, telefone, nome, valor (e se e centavos), produto, evento de compra, campo do indexador. Sao os caminhos que as tags do Facebook ja leem hoje.
- **Suposicao, sempre opcional:** UTMs (`utm_source`...) e campos de status. Os containers nao liam nenhum dos dois. Sem eles a venda e gravada igual, so sem UTM ou sem o filtro de status.
- **Onde o container aprovava tudo** (Herospark, Kavoo, Wiapy, Doppus — gatilho `_event EQUALS Data`), um campo de status pendente ou cancelado agora segura a venda. Sem campo de status, aprova — o mesmo comportamento do container. **Configure o webhook dessas plataformas so para venda aprovada.**
- **Kavoo, Doppus e Wiven gravam a comissao como valor** (o unico valor que o container mapeava). No painel, o faturamento dessas vendas e liquido.
- **Reembolso:** so PagTrust, Assiny, Yampi e Wiven tem evento de reembolso conhecido (e so o da PagTrust segue um formato conhecido, o da Hotmart). Nas demais, reembolso depende de um campo de status com "refund/estorno/chargeback".

### Antes de usar em producao

- [ ] Uma venda real por plataforma, conferindo em Vendas: valor, produto, comprador, UTMs
- [ ] Se algum campo vier vazio, ajustar o caminho em `checkout-specs.ts` com o payload real (fica no log do webhook, primeiros 500 caracteres)
- [ ] Nas plataformas que aprovam tudo, confirmar que o webhook esta configurado so para venda aprovada

### Testes

- `generic/__tests__/checkout-parser.spec.ts` — um payload por plataforma, montado com os caminhos do container; decisao por evento/status; centavos; xcod da PagTrust
- `generic/__tests__/generic-checkout.processor.spec.ts` — token (ausente, invalido, URL x corpo), venda aprovada, comissao, evento ignorado, reembolso com e sem venda, sem id
- `webhooks/__tests__/webhook-capi-flow.spec.ts` — Yampi de ponta a ponta: processor generico → venda com o indexador → Purchase
