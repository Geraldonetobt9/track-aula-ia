# VTurb Analytics

> **Modulo:** `packages/backend/src/modules/vturb` | **Pagina:** `packages/frontend/src/pages/Vturb.tsx`
> **Ultima atualizacao:** 2026-08-13
> **Status:** Implementado e validado contra a API real (2026-08-13)
>
> **Pendencias antes de funcionar:**
> 1. Rodar `supabase/migrations/20260813120000_workspaces_vturb_token.sql`
> 2. Deploy normal do backend e do frontend
> 3. Colar a chave da API na aba VTurb

---

## 1. Proposito

Traz o desempenho dos VSLs para dentro do Sentinela: quanto cada video faturou,
quantos assistiram, onde a audiencia abandona e quantos chegaram no pitch.

E o pedaco do funil que hoje e cego. O Facebook diz quanto se gastou, o checkout
diz o que vendeu — entre os dois esta o video, e ate agora nao havia visibilidade
sobre ele.

**Nao substitui nada.** A VTurb nao sabe de gasto com anuncio nem de venda
aprovada; e uma fonte complementar.

---

## 2. Comportamento para o Usuario

### 2.1 Fluxo

1. Aba **VTurb** na sidebar, visivel para todos.
2. Sem chave configurada, a tela e so o formulario: colar a chave e conectar.
3. Ao salvar, o backend chama `/players/list` na hora e devolve quantos videos
   achou. Chave errada falha ali, e nao quando o usuario ja saiu da tela.
4. Com chave, a tela mostra o resumo da conta, o ranking de videos e o filtro de
   periodo (o mesmo `DateRangeFilter` do Dashboard).
5. Clicar num video abre um painel lateral com as metricas daquele video.

### 2.2 O que aparece

**Resumo da conta:** Receita, Visualizacoes, Plays, Conversoes, Taxa de
conversao e Top paises.

**Ranking:** todos os videos, do mais assistido ao menos, com visualizacoes,
plays, conversoes e receita.

**Detalhe do video:** Visualizacoes, Visualizacoes Unicas, Plays, Plays Unicos,
Play Rate, Retencao ao Pitch, Audiencia do Pitch, Engajamento, Cliques no Botao,
Conversoes, Taxa de Conversao e Receita.

### 2.3 Responsividade

O ranking tem **dois layouts**, nao um com scroll horizontal: tabela completa a
partir de `sm`, e um cartao por video abaixo disso. Tabela larga no celular
esconde justamente as colunas que importam atras de um gesto que ninguem faz.

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Chave por area | Sempre | O token e do workspace, nao do usuario. Areas diferentes podem apontar para contas VTurb diferentes |
| RN-02 | Chave nunca voltta ao browser | Sempre | O backend so responde `configured: true/false`. O campo comeca vazio mesmo com chave salva |
| RN-03 | Chave validada ao salvar | Salvou a chave | Chama `/players/list`; falha invalida a operacao com a mensagem da VTurb |
| RN-04 | Somente os 5 mais assistidos | Sempre | O ranking sai de `/events/total_by_company_players` (1 requisicao) e so os 5 primeiros recebem `/sessions/stats`. Os totais da conta somam esses 5 |
| RN-05 | Datas com hora | Sempre | A VTurb exige `YYYY-MM-DD HH:MM:SS` e filtra `>=` no inicio e `<=` no fim. O range vai como `00:00:00` e `23:59:59` — meia-noite no fim perderia o ultimo dia inteiro |
| RN-06 | Cota respeitada | Fan-out por video | No maximo 6 requisicoes simultaneas |
| RN-07 | Paises amostrados | Sempre | Somados a partir dos mesmos 5 videos |
| RN-08 | Falha de pais nao derruba a tela | `stats_by_field` falha | O card de paises fica vazio; o resto renderiza |
| RN-09 | Erro de cota e distinguivel | VTurb responde 429 | A tela diz que e cota e sugere esperar, em vez de "erro" generico |
| RN-10 | Receita em centavos | Sempre | `total_amount_brl` vem em centavos e e dividido por 100. Sem isso a tela mostraria valores 100x maiores, sem erro em lugar nenhum |

---

## 4. Modelo de Dados

Nenhuma tabela nova. Uma coluna:

| Tabela | Coluna | Descricao |
|---|---|---|
| workspaces | vturb_api_token | Token da API, criptografado com `EncryptionService` |

Nada da VTurb e persistido. Os numeros sao lidos sob demanda e mantidos em cache
em memoria — 5 minutos para o resumo, 1 minuto para o detalhe.

---

## 5. API / Backend

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/vturb/status` | Se a area tem chave |
| POST | `/api/vturb/token` | Salva a chave e valida na hora |
| DELETE | `/api/vturb/token` | Remove a chave |
| GET | `/api/vturb/overview` | Totais da conta + ranking + paises |
| GET | `/api/vturb/videos/:playerId` | Metricas de um video |

### 5.1 Por que o backend faz proxy

A chave nunca vai para o browser. Um token embutido no bundle e legivel por
qualquer um que abra o devtools, e a VTurb nao libera CORS para chamada de
navegador de qualquer forma.

### 5.2 Ranquear barato, detalhar caro

`GET /overview` faz tres coisas: lista os players, ranqueia com
`/events/total_by_company_players` (uma requisicao para a conta inteira) e so
entao chama `/sessions/stats` para os 5 primeiros.

A primeira versao chamava `/sessions/stats` para todos os 22 videos. Os dois
mais movimentados sao os mais lentos e estouravam o timeout, entao sumiam do
ranking — levando junto a maior parte da receita da conta. O resultado era uma
tela que parecia funcionar, com R$ 2.767,29 no lugar de R$ 26.567,29.

Os totais da conta somam os mesmos 5 videos que aparecem na lista. A cauda e
zero na pratica, e manter uma fonte so evita o ranking discordar do total
impresso acima dele.

### 5.3 Cota

A VTurb limita por **requisicoes por minuto e por bytes lidos por dia**, e avisa
que uma requisicao pode contar como mais de uma query. Por isso:

- so os 5 mais assistidos recebem `/sessions/stats` (6 requisicoes no total, nao 22)
- `mapWithConcurrency` com teto de 6 simultaneas
- timeout de 45s: os videos mais pesados sao os mais lentos
- cache de 5 minutos no resumo
- `retry: false` no frontend — cota estourada nao melhora tentando de novo

### 5.4 Taxas: usar as da VTurb

`play_rate`, `over_pitch_rate`, `engagement_rate` e `overall_conversion_rate` vem
prontas da API e sao usadas como vieram, com calculo local so como fallback.
Recalcular divergiria do painel da propria VTurb onde a definicao deles nao for a
obvia — e o usuario compara as duas telas.

A taxa de conversao da conta divide por **plays unicos**, nao por plays. E o que
a VTurb faz: no painel deles, 68 conversoes sobre 2.969 plays unicos da os 2,29%
exibidos, e nao os 2,15% que sairiam do total de plays.

---

## 6. Implementacao no Frontend

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Vturb | `src/pages/Vturb.tsx` | Pagina, periodo, estado da selecao |
| VturbSummary | `src/components/vturb/VturbSummary.tsx` | Receita, tiles e paises |
| VturbVideoRanking | `src/components/vturb/VturbVideoRanking.tsx` | Ranking, com layout duplo |
| VturbVideoDetail | `src/components/vturb/VturbVideoDetail.tsx` | Painel lateral do video |
| VturbTokenForm | `src/components/vturb/VturbTokenForm.tsx` | Colar/trocar a chave |
| useVturb | `src/hooks/useVturb.ts` | Status, overview, detalhe e mutacoes |

O detalhe e buscado **ao abrir**, nao junto do ranking: puxar o detalhe de todos
os videos de antemao gastaria cota em paineis que ninguem abre.

O modo privacidade (`usePrivacyMode`) e o mesmo do Dashboard e de Campanhas, entao
o borrao vale nas tres telas com um clique.

---

## 7. Edge Cases

| Cenario | Tratamento |
|---|---|
| Sem chave | 428 no backend; a tela mostra o formulario |
| Chave invalida | Erro da VTurb propagado na hora de salvar |
| Cota estourada | 429 com `quotaExceeded: true`; a tela explica e oferece tentar de novo |
| VTurb lenta | Timeout de 20s por requisicao |
| Conta sem videos | Estado vazio explicito no ranking |
| `stats_by_field` rejeita `country` | Card de paises vazio, resto intacto |

---

## 8. Checklist de Testes

### Coberto por teste automatizado

`packages/backend/src/modules/vturb/__tests__/` — 10 testes.

- [x] `mapWithConcurrency` preserva a ordem dos resultados
- [x] Nunca ultrapassa o teto de simultaneidade (o que protege a cota)
- [x] Lista vazia nao trava
- [x] Nao cria mais workers do que itens
- [x] Datas saem como `YYYY-MM-DD HH:MM:SS`
- [x] Fim do range em `23:59:59`
- [x] Receita convertida de centavos, no resumo e no detalhe
- [x] Taxas repassadas como a VTurb calcula, sem recalculo local
- [x] Campo de agrupamento por pais e `country`

### Pendentes — exigem chave real

- [x] Chave valida devolve 22 videos
- [x] Numeros do resumo batem com o painel (receita identica ao centavo)
- [x] Metricas do detalhe batem (33,67%, 23,46%, 2,51%)
- [x] `field: "country"` e aceito
- [ ] Chave invalida falha ao salvar, com a mensagem da VTurb
- [ ] Ranking ordena do mais assistido ao menos
- [ ] Layout de cartoes no celular, tabela no desktop
- [ ] 429 aparece como mensagem de cota, nao como erro generico

---

## 9. Questoes Abertas / TODOs

- **`field: "country"` confirmado.** Testado contra a API real. O proprio 400 da VTurb lista os valores validos: `src, sck, utm_source, utm_term, utm_campaign, utm_content, utm_medium, no_attribution, country, device_type, browser`.
- **`StatsByField` volta como array**, apesar de o spec tipar como objeto. Confirmado com dado real; o parser aceita as duas formas.
- **Validado contra a API real (2026-08-13).** Os totais batem com o painel da VTurb: receita R$ 26.567,29 identica ao centavo, e as taxas do detalhe (33,67%, 23,46%, 2,51%) dentro do arredondamento. Contagens divergem em ~0,1% por causa da fronteira do dia.
- **Cota real desconhecida.** Os numeros do spec (60 queries/min) sao exemplo, nao
  contrato. `/quota/usage` existe e poderia alimentar um aviso na tela antes de
  estourar — nao implementado.
- **Sem cruzamento com campanha.** O gancho obvio e `/traffic_origin/stats` com
  `query_key: utm_campaign`, que ligaria engajamento de VSL a campanha do Meta.
  Fica para depois de a leitura basica estar validada.
- **Cache e por instancia.** Com clustering no Render, cada worker tem o seu, entao
  a taxa de acerto cai proporcionalmente ao numero de instancias. Aceitavel no
  volume atual; se a cota apertar, o caminho e cache compartilhado.

---

## 10. Divergencias entre o spec e a API real

Descobertas chamando a API com uma chave real. Nenhuma esta documentada, e duas
sao contraditas pelo proprio spec.

| # | O que o spec diz | O que a API faz |
|---|---|---|
| 1 | `start_date`/`end_date` aceitam `"2023-10-26"` | **Rejeita.** `/sessions/stats` responde 400 com *"Start date must be a valid datetime with hours, minutes, and seconds"* |
| 2 | Aceita `"2023-10-26T18:24:05.000+00:00"` | **Rejeita** tambem. So `YYYY-MM-DD HH:MM:SS` funciona |
| 3 | `total_amount_brl: integer, example: 1000` | **Vem em centavos.** 1828715 e R$ 18.287,15 no painel deles |
| 4 | `StatsByField` e um `object` | Volta um **array** de buckets, cada um com `grouped_field` |

O item 3 e o mais perigoso: sem perceber, a tela mostraria valores 100x maiores
sem nenhum erro em lugar nenhum. So apareceu porque o numero foi comparado com o
painel da VTurb.

Os tres primeiros estao fixados em teste (`vturb.service.spec.ts`) — sao
exatamente o tipo de coisa que um refactor bem-intencionado desfaz.

---

## 11. Por que so 5 videos

A primeira versao detalhava a biblioteca inteira. Numa conta com 22 videos, 20
voltaram e 2 falharam — e os 2 eram justamente os de maior volume, porque
consulta pesada demora mais e estourava o timeout de 20s sob concorrencia.

O efeito foi pior do que um erro: a tela carregou normalmente, mostrando
R$ 2.767,29 de receita quando o valor real era R$ 26.567,29. Um numero errado
que parece certo.

Duas mudancas evitam a repeticao:

1. **Ranquear antes de detalhar.** `/events/total_by_company_players` devolve o
   total por player da conta toda em uma requisicao. So os 5 primeiros levam o
   `/sessions/stats` caro.
2. **Timeout de 45s.** Os videos que mais importam sao os que mais demoram.

O ranking tambem tem fallback: se aquele endpoint agregado nao responder como o
spec descreve — o que **nao foi verificado contra a API real** — a ordem cai
para a que `/players/list` devolveu. Ordem errada e um problema muito menor do
que tela que nao carrega.
