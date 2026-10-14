# Testes A/B

> **Modulo:** `packages/backend/src/modules/ab-tests` | **Pagina:** `packages/frontend/src/pages/AbTests.tsx`, `AbTestDetail.tsx`
> **Ultima atualizacao:** 2026-10-14
> **Status:** Implementado — pendente de validacao com trafego real
>
> **Pendencias operacionais antes de funcionar:**
> 1. Rodar `supabase/migrations/20261014120000_testes_ab.sql` no SQL Editor
> 2. Deploy normal (frontend + API na Vercel). Nenhuma variavel de ambiente nova
> 3. O snippet de rastreio ja instalado faz o sorteio: nao ha codigo novo para colar

---

## 1. Proposito

Comparar versoes da pagina de vendas pela venda que cada uma trouxe, e nao so pelo clique.

A medicao usa o indexador do rastreio (ver [Rastreio de Visitantes](../18-visitor-tracking/visitor-tracking.md)): o `tracker.js` sorteia a variante do visitante e grava o sorteio; a venda volta pelo webhook com `stl_<sessao>`, o `tracking_match_sale` liga a venda a sessao e, por ela, ao visitante — que diz em que variante estava. Nada do casamento nem da ingestao foi alterado.

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar `/ab-tests` ("Testes A/B") | Lista dos testes, com status, visitantes, metrica de cada variante e veredito |
| `/ab-tests/:id` | Resultado por variante, curva de conversao acumulada, passo a passo de instalacao, iniciar/pausar/encerrar |

### 2.2 Fluxo de UI

1. "Novo teste": nome, hipotese, modo, pagina, objetivo e 2 a 5 variantes com peso.
2. O teste nasce em rascunho. Conferido, "Iniciar teste".
3. Em ate 5 minutos (cache do `tracker.js` no navegador) as paginas passam a sortear.
4. O resultado atualiza a cada minuto enquanto roda. "Encerrar" pede a vencedora (sugere a lider estatistica).

### 2.3 Modos

| Modo | Como funciona |
|---|---|
| `redirect` (paginas diferentes) | Cada variante e uma URL no mesmo dominio. Quem abre qualquer pagina do teste e sorteado; se a variante e outra pagina, vai para ela com `location.replace`, antes do pageview, levando a query string da chegada (UTMs, fbclid) |
| `elements` (blocos na mesma pagina) | Blocos marcados com `data-stl-ab="A"`, `data-stl-ab="B"`... O snippet esconde os de outras variantes e tira o `hidden` dos da sorteada. As desafiantes comecam com `hidden`: sem o script (bloqueador, Do Not Track), o visitante ve o original. `sentinel('ab', fn)` entrega `{ id do teste: letra }` para mudancas feitas por script |

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Sorteio fixo | Sempre | Hash FNV-1a de `_stl_vid` + id do teste, ponderado pelos pesos. O mesmo visitante cai sempre na mesma variante, sem cookie novo |
| RN-02 | Primeiro sorteio vale | Visitante ja sorteado | `ab_record_assignments` ignora o segundo (`UNIQUE (test_id, visitor_id)`) |
| RN-03 | Sem cookie, sem sorteio | `_stl_vid` nao gravavel | Nem sorteia nem redireciona: com id instavel o visitante trocaria de variante a cada pagina (e poderia entrar em loop entre A e B) |
| RN-04 | Do Not Track | DNT ligado | Nada: o script inteiro e no-op |
| RN-05 | Referrer preservado | Redirecionamento | O referrer da chegada vai no cookie `_stl_abref` (60s) e substitui o `document.referrer` no pageview da variante |
| RN-06 | Entrada direta na variante | Visitante abre a pagina B mas foi sorteado para A | Vai para A. Sem isso, trafego direto para B entortaria a divisao |
| RN-07 | Mesmo dominio | Modo redirect | Variantes no mesmo host da pagina (ignorando `www.`): o `_stl_vid` e por dominio |
| RN-08 | Uma pagina, um teste | Iniciar | Recusado (409) se outro teste rodando usa alguma das mesmas paginas |
| RN-09 | Edicao | Fora do rascunho | So nome e hipotese mudam. Pagina, modo, objetivo e variantes misturariam dois experimentos |
| RN-10 | Retomar | Pausado → rodando | `started_at` nao muda |
| RN-11 | Visitante | Sempre | Contado na variante do sorteio, a partir do sorteio |
| RN-12 | Checkout | Sempre | Sessao do sorteio ou posterior com `had_checkout_click` |
| RN-13 | Compra | Sempre | Venda aprovada com `sales.visitor_id` do sorteado, de 5 min antes do sorteio ate 7 dias apos o fim do teste. Pedidos por `DISTINCT order_external_id`; receita soma as linhas (order bumps), como no Dashboard |
| RN-14 | Pelo indexador | Sempre | `orders_indexed`: pedidos com `match_method` `sck` ou `order` — o vinculo exato. O resto veio por `fbclid` ou `utm_exact` |
| RN-15 | Fora do teste | Sempre | `unmatched_sales`: aprovadas no periodo sem visita ligada. Muitas = a plataforma nao devolve o indexador |
| RN-16 | Significancia | Objetivo venda/checkout | Teste z de duas proporcoes, bilateral, contra o controle (A) |
| RN-17 | Significancia | Objetivo receita | Receita por visitante: medias com variancias separadas (Welch, aproximacao normal) |
| RN-18 | Chance de superar | Sempre | Posterior Beta(1+c, 1+n−c) de cada lado, aproximada pela normal |
| RN-19 | Bonferroni | Mais de um desafiante | Nivel = 5% / numero de desafiantes |
| RN-20 | Amostra minima | Sempre | Sem 100 visitantes por variante e 10 eventos do objetivo somados, "Coletando dados" — nenhum p-valor e declarado significativo |
| RN-21 | Veredito | Sempre | `winner` (algum desafiante significativamente melhor; o de maior metrica), `control` (todos significativamente piores), `inconclusive` (ha amostra, sem diferenca), `collecting` |
| RN-22 | Amostra sugerida | Sempre | Visitantes por variante para detectar +20% sobre a taxa do controle, com 80% de poder |

## 4. Modelo de Dados

- `ab_tests` — `workspace_id`, `name`, `hypothesis`, `mode`, `page_url`, `goal` (`sale`, `checkout`, `revenue`), `status` (`draft`, `running`, `paused`, `finished`), `started_at`, `ended_at`, `winner_variant_id`.
- `ab_test_variants` — `test_id`, `key` (A–E; A e o controle), `name`, `url` (so redirect), `weight` (1–100), `position`.
- `ab_test_assignments` — `test_id`, `variant_id`, `visitor_id`, `session_id` (a visita do sorteio), `assigned_at`. `UNIQUE (test_id, visitor_id)`.

Apagar o teste apaga variantes e sorteios (`ON DELETE CASCADE`); visitas e vendas ficam. RLS: so leitura pelo dono; escrita so pela service role.

Indices novos de leitura: `sales (workspace_id, visitor_id)` e `tracking_sessions (workspace_id, visitor_id)`.

### 4.1 Funcoes (RPC)

| Funcao | Quem chama | O que faz |
|---|---|---|
| `ab_record_assignments` | `/collect`, quando o lote traz `ab` | Grava o sorteio se o teste esta rodando, e da area, e a variante e dele |
| `ab_test_results` | `GET /ab-tests` e `/ab-tests/:id` | Numeros por variante, serie diaria e vendas sem visita. A estatistica e feita no backend (`ab-stats.ts`) |

## 5. API / Backend

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/ab-tests?workspace_id=` | JWT | Lista com resultado |
| GET | `/api/ab-tests/:id` | JWT | Teste com resultado e estatistica |
| POST | `/api/ab-tests` | JWT | Cria em rascunho |
| PATCH | `/api/ab-tests/:id` | JWT | Edita (RN-09) |
| POST | `/api/ab-tests/:id/status` | JWT | `{ action: start \| pause \| finish, winner_variant_id? }` |
| DELETE | `/api/ab-tests/:id` | JWT | Exclui |

### 5.1 No rastreio

- `GET /api/t/tracker.js` inclui os testes rodando da area (cache de 60s no servidor, 5 min no navegador). **Sem teste rodando, o bloco A/B nem entra no script**: quem nao testa recebe o mesmo `tracker.js` de antes (abaixo de 5 KB comprimido; com teste, abaixo de 6 KB).
- `POST /api/t/collect` aceita `ab: { <test_id>: <variant_id> }` no primeiro envio da pagina e grava em paralelo com a ingestao. Falha aqui nunca derruba a visita nem o envio a CAPI.
- `getScriptTests` e `recordAssignments` nunca lancam: banco fora ou migration nao aplicada = rastreio igual, sem sorteio.

## 6. Implementacao no Frontend

- `pages/AbTests.tsx`, `pages/AbTestDetail.tsx`
- `components/ab-tests/AbTestFormDialog.tsx`, `AbTestResults.tsx`, `AbTestSetupGuide.tsx`, `AbStatusBadge.tsx`
- `hooks/useAbTests.ts`: `useAbTests`, `useAbTest` (refaz a cada minuto enquanto roda), `useAbTestMutations`. Query keys `ab-tests`, `ab-test`. `retry: false`.

## 7. Edge Cases

- Plataforma que nao devolve o `sck`: a venda ainda entra se casou por `fbclid`/`utm_exact`; senao fica em `unmatched_sales`.
- Pausar nao apaga sorteios: quem ja foi sorteado continua contando. Retomar segue com os mesmos visitantes.
- Encerrar: o snippet para de sortear em ate 5 min. Vendas de sorteados contam ate 7 dias depois (boleto/pix).
- SPA: o sorteio roda no carregamento do script, como o pageview.
- Visitante que limpa cookies vira visitante novo e e sorteado de novo (como em qualquer ferramenta de teste A/B por cookie).
- Redirecionamento mostra a pagina A por um instante se o snippet estiver no fim do `<body>`: o guia recomenda o `<head>`.

## 8. Checklist de Testes

Automatizados:
- `tracking/__tests__/tracker-script.spec.ts` — o `tracker.js` real em jsdom: modo elements (estilo, `hidden`, classe), modo redirect (vai antes do pageview, guarda referrer, entrada direta em B), sem cookie nao sorteia, DNT, `sentinel('ab')`, sorteio fixo e dividido pelo peso, tamanho do script, formato torto fora
- `tracking/__tests__/collect-payload.spec.ts` e `tracking.http.spec.ts` — campo `ab` no `/collect`, falha do sorteio nao derruba a visita, script sem o bloco quando nao ha como ler os testes
- `ab-tests/__tests__/ab-stats.spec.ts`, `ab-url.spec.ts`, `ab-tests.service.spec.ts` — estatistica, chave de pagina, validacao, transicoes, conflito, cache, veredito, Bonferroni
- `frontend/src/components/ab-tests/__tests__/AbTests.test.tsx` — resultado, guia e formulario
- As funcoes SQL foram exercitadas em Postgres (PGlite): migration aplicada duas vezes, sorteio (area, status, variante, duplicado), resultado (order bump, reembolso, venda antes do sorteio, checkout em sessao anterior, `unmatched_sales`), dono, cascade

Manual, com trafego real:
- [ ] Teste redirect iniciado → abrir a pagina A em aba anonima algumas vezes → cair em A e em B, com UTMs na URL de B
- [ ] Mesma aba, recarregar → mesma variante
- [ ] Compra de teste na variante B → venda aparece em B, contada "pelo indexador"
- [ ] Modo elements → so os blocos da variante aparecem; com bloqueador, so o original
