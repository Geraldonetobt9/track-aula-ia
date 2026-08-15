# Atribuicao de Vendas (Sale Attribution)

## 1. Proposito

O sistema de atribuicao de vendas e responsavel por conectar cada venda recebida via webhook a hierarquia completa de anuncios do Facebook Ads (campanha > conjunto de anuncios > anuncio). Esse processo permite calcular metricas de ROI, ROAS e custo por aquisicao de forma precisa. O algoritmo opera em duas frentes: atribuicao em tempo real (no momento do webhook) via `matchSaleToAds` e reatribuicao em lote (rematch) via `SaleMatcherService` para vendas que nao foram atribuidas inicialmente.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Webhook de checkout | Atribuicao automatica no momento em que a venda e recebida |
| Botao "Rematch" na UI | Aciona o processo de reatribuicao em lote para vendas nao atribuidas |
| Pagina de Vendas | Exibe o resultado da atribuicao: tipo (pago/organico), campanha, ad set, anuncio |

### 2.2 Fluxo de UI

1. Uma venda chega via webhook com parametros UTM (utm_content, utm_term, utm_campaign, utm_medium).
2. A Edge Function ou backend processa o webhook e chama `matchSaleToAds` para tentar atribuir a venda.
3. Se a atribuicao for bem-sucedida, os campos `campaign_id`, `ad_set_id` e `ad_internal_id` sao preenchidos na tabela `sales`.
4. Se a atribuicao falhar (nenhum match encontrado), a venda e salva como organica (campos null).
5. O usuario pode acionar o rematch manualmente, que tenta atribuir todas as vendas com dados de tracking mas sem atribuicao completa.
6. Na pagina de Vendas, vendas atribuidas aparecem como "Pago" com nome da campanha; vendas sem atribuicao aparecem como "Organico".

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Atribuicao automatica via webhook | Sistema (service role) |
| Acionar rematch | Usuario autenticado proprietario das vendas |
| Visualizar resultado da atribuicao | Proprietario do workspace |

---

## 3. Regras de Negocio

| # | Regra | Descricao |
|---|---|---|
| RN01 | Prioridade de ad_id | O ad_id efetivo e extraido com prioridade: `ad_id` > `utm_term` > `utm_content` |
| RN02 | Extracao de ID numerico | IDs compostos como `"vid34-d09-02\|120245519580910309"` sao desmembrados por `\|` e `/`; o primeiro segmento com 6+ digitos e usado |
| RN03 | Hierarquia de matching (6 passos) | O algoritmo segue 6 etapas em cascata, parando no primeiro match bem-sucedido |
| RN04 | Match por facebook_ad_id | Busca exata na tabela `ads` pelo facebook_ad_id, retornando ad + ad_set + campaign |
| RN05 | Match por facebook_adset_id | Se nao achou ad, tenta match pelo adset ID na tabela `ad_sets` |
| RN06 | Match por adSetFbId (Guru) | Parametro especifico do Guru Digital extraido do `utm_campaign` |
| RN07 | Match por campaignFbId (Guru) | Parametro especifico do Guru Digital extraido do `utm_medium` |
| RN08 | Fallback por utm_campaign | Tenta match exato com `campaigns.facebook_campaign_id`, depois match parcial com `campaigns.name` (ILIKE) |
| RN09 | Venda organica | Se nenhum match for encontrado, todos os campos de atribuicao permanecem null |
| RN10 | Rematch em lote | Primeiro preenche `ad_id` faltante a partir de utm_content/utm_term, depois usa mapa em memoria para atribuicao rapida |

---

## 4. Modelo de Dados

### 4.1 Tabelas

A atribuicao opera sobre as seguintes tabelas existentes:

#### Campos de atribuicao na tabela `sales`

| Coluna | Tipo | Descricao |
|---|---|---|
| ad_id | TEXT | Facebook Ad ID numerico extraido do UTM (ex: "120245519580910309") |
| ad_set_id | UUID | FK para ad_sets.id (preenchido pelo matcher) |
| ad_internal_id | UUID | FK para ads.id (preenchido pelo matcher) |
| campaign_id | UUID | FK para campaigns.id (preenchido pelo matcher) |
| utm_content | TEXT | Parametro UTM original da venda |
| utm_term | TEXT | Parametro UTM term original |
| utm_campaign | TEXT | Parametro UTM campaign original |
| utm_medium | TEXT | Parametro UTM medium original |

#### Tabelas de referencia para matching

| Tabela | Campo-chave | Descricao |
|---|---|---|
| ads | facebook_ad_id | ID numerico do anuncio no Facebook |
| ad_sets | facebook_adset_id | ID numerico do conjunto de anuncios |
| campaigns | facebook_campaign_id | ID numerico da campanha |
| campaigns | name | Nome da campanha (usado no fallback ILIKE) |

### 4.2 Relacionamentos

```
sales.ad_internal_id -> ads(id)
sales.ad_set_id      -> ad_sets(id)
sales.campaign_id    -> campaigns(id)
ads.ad_set_id        -> ad_sets(id)
ad_sets.campaign_id  -> campaigns(id)
```

### 4.3 Constraints

- `sales.ad_set_id` FK com `ON DELETE SET NULL` (referencia opcional)
- `sales.ad_internal_id` FK com `ON DELETE SET NULL` (referencia opcional)
- Indices em `sales.ad_id`, `sales.ad_set_id`, `sales.ad_internal_id` para performance
- Indice em `ads.facebook_ad_id` para lookup rapido

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| POST | `/api/facebook/rematch` | Aciona o processo de rematch em lote |

### 5.2 Logica

**Funcao `matchSaleToAds` (Edge Function - tempo real)**

Arquivo: `supabase/functions/_shared/match-sale-to-ads.ts`

Parametros:
- `supabaseAdmin`: cliente Supabase com service role
- `userId`: UUID do usuario proprietario
- `adId`, `utmCampaign`, `utmContent`, `utmTerm`: parametros de tracking
- `adSetFbId` (opcional): ID do adset extraido do utm_campaign (Guru)
- `campaignFbId` (opcional): ID da campanha extraido do utm_medium (Guru)

Retorno: `MatchResult { campaign_id, ad_set_id, ad_internal_id }`

**Hierarquia de matching (6 etapas):**

```
Etapa 1: Extrair ad_id efetivo
  - rawAdId = adId || utmTerm || utmContent
  - effectiveAdId = extractNumericAdId(rawAdId)
    - Divide por | e /
    - Encontra primeiro segmento com 6+ digitos puros

Etapa 2: Match por facebook_ad_id
  - SELECT ads.id, ads.ad_set_id, ad_sets.campaign_id
    FROM ads JOIN ad_sets ON ads.ad_set_id = ad_sets.id
    WHERE ads.user_id = userId AND ads.facebook_ad_id = effectiveAdId
  - Se encontrou: retorna hierarquia completa (ad + adset + campaign)

Etapa 3: Match por facebook_adset_id
  - SELECT ad_sets.id, ad_sets.campaign_id
    FROM ad_sets
    WHERE ad_sets.user_id = userId AND ad_sets.facebook_adset_id = effectiveAdId
  - Se encontrou: retorna adset + campaign (sem ad especifico)
  - O update da venda tambem zera `sales.ad_id`: o numero gravado ali era na
    verdade um adset_id (a URL do criativo nao incluia o macro `{{ad.id}}`),
    entao manter o valor faria a coluna mentir. O adset fica preservado em
    `sales.ad_set_id`.

Etapa 4: Match por adSetFbId (Guru)
  - Mesmo que Etapa 3, mas usando o parametro adSetFbId
  - Especifico para plataforma Guru Digital

Etapa 5: Match por campaignFbId (Guru)
  - SELECT campaigns.id
    FROM campaigns
    WHERE campaigns.user_id = userId AND campaigns.facebook_campaign_id = campaignFbId
  - Se encontrou: retorna apenas campaign

Etapa 6: Fallback por utm_campaign
  - 6a: Match exato com campaigns.facebook_campaign_id
  - 6b: Match parcial com campaigns.name (ILIKE '%utm_campaign%')
  - Se encontrou: retorna apenas campaign

Etapa 7: Nenhum match -> retorna { null, null, null } (venda organica)
```

**Funcao `extractNumericAdId`**

```typescript
function extractNumericAdId(raw: string | null): string | null {
  if (!raw) return null;
  const parts = raw.split(/[|\/]/);
  const numericPart = parts.find(p => /^\d{6,}$/.test(p.trim()));
  return numericPart?.trim() || raw; // fallback para valor original se nao achou numerico
}
```

Exemplos:
- `"vid34-d09-02|120245519580910309"` -> `"120245519580910309"`
- `"creative/120245519580910309"` -> `"120245519580910309"`
- `"120245519580910309"` -> `"120245519580910309"` (passthrough)
- `"bio"` -> `"bio"` (passthrough, nenhum numerico com 6+ digitos)

**Funcao `mapStatus` (mapeamento de status por plataforma)**

Converte status da plataforma de checkout para status interno:

| Plataforma | Approved | Refunded | Pending |
|---|---|---|---|
| Hotmart | approved, purchase_approved, completed, purchase_complete | refunded, purchase_refunded, canceled, purchase_canceled, protest, purchase_protest, chargeback, purchase_chargeback | billet_printed, waiting_payment, pending |
| Kiwify | paid, approved, completed | refunded, chargedback, cancelled | waiting, pending |
| Kirvano | approved, paid, completed | refunded, chargeback, cancelled | pending, waiting |

**Funcao `extractAdId` (extracao de tracking)**

Prioridade de campos: `ad_id` > `utm_term` > `utm_content` > `src` > `sck`

**POST /api/facebook/rematch (rematch em lote)**

Controller: `FacebookController.rematchSales()`
Service: `SaleMatcherService.rematchSales(userId)`

Fluxo:
1. **Passo 0 - Preencher ad_id faltante**: busca vendas do usuario com `utm_content` ou `utm_term` mas sem `ad_id`. Para cada uma, extrai o ID numerico e atualiza o campo `ad_id`.
2. **Passo 1 - Construir mapa em memoria**: busca TODOS os ads do usuario com join em `ad_sets` para obter `campaign_id`. Constroi `Map<facebook_ad_id, { ad_internal_id, ad_set_id, campaign_id }>`.
3. **Passo 2 - Buscar vendas nao atribuidas**: busca vendas com algum dado de tracking (`ad_id`, `utm_content` ou `utm_term`) mas sem `ad_internal_id` ou `campaign_id`.
4. **Passo 3 - Atribuir via mapa**: para cada venda, extrai `effectiveAdId`, busca no mapa e atualiza `campaign_id`, `ad_set_id` e `ad_internal_id`.

Retorno:
```json
{
  "success": true,
  "total_unmatched": 150,
  "rematched": 120,
  "still_unmatched": 30,
  "errors": ["Sale abc123: ..."] // opcional
}
```

---

## 6. Implementacao no Frontend

### 6.1 Componentes

O sistema de atribuicao nao possui componentes proprios de UI. O resultado da atribuicao e exibido nos seguintes componentes da pagina de Vendas:

| Componente | Uso da atribuicao |
|---|---|
| SaleDetailsDrawer | Exibe hierarquia completa: campanha, ad set, anuncio, metricas do ad |
| Tabela de vendas (Sales.tsx) | Coluna "Tipo" exibe "Pago" (com icone) ou "Organico" baseado em `campaign_id` |
| Tabela de vendas (Sales.tsx) | Coluna "Campanha" exibe o nome da campanha atribuida |

### 6.2 Hooks

A atribuicao nao possui hook dedicado no frontend. O resultado e consumido via o hook `useSales` que retorna `SaleWithDetails` com campos de atribuicao ja preenchidos:

| Campo | Tipo | Descricao |
|---|---|---|
| type | 'paid' \| 'organic' | Derivado: 'paid' se campaign_id presente |
| campaign_name | string | Nome da campanha do join |
| ad_set_name | string \| null | Nome do ad set do join |
| ad_name | string \| null | Nome do anuncio do join |
| ad_spend | number \| null | Gasto do anuncio atribuido |
| ad_impressions | number \| null | Impressoes do anuncio |
| ad_clicks | number \| null | Cliques do anuncio |
| ad_cpc | number \| null | CPC do anuncio |
| ad_ctr | number \| null | CTR do anuncio |

### 6.3 Estado

O rematch pode ser acionado e seu estado gerenciado localmente:

| Estado | Tipo | Descricao |
|---|---|---|
| rematching | boolean | Indica se o processo de rematch esta em andamento |
| rematchResult | object \| null | Resultado retornado pelo endpoint de rematch |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Edge Functions (webhooks) | Consumidor | Cada webhook de checkout chama `matchSaleToAds` ao processar uma venda |
| Facebook Sync (insights) | Dependencia | A atribuicao depende de que os dados de ads/ad_sets/campaigns estejam sincronizados do Facebook |
| Tabela `ads` | Leitura | Lookup por `facebook_ad_id` para matching na Etapa 2 |
| Tabela `ad_sets` | Leitura | Lookup por `facebook_adset_id` para matching nas Etapas 3 e 4 |
| Tabela `campaigns` | Leitura | Lookup por `facebook_campaign_id` e `name` para matching nas Etapas 5 e 6 |
| Pagina de Vendas | Exibicao | Mostra o resultado da atribuicao na tabela e no drawer de detalhes |
| Dashboard | Exibicao | Metricas de vendas pagas vs organicas derivadas da atribuicao |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| utm_content com pipe: `"vid34\|120245519580910309"` | `extractNumericAdId` divide por pipe, encontra a parte numerica com 6+ digitos |
| utm_content com slash: `"creative/120245519580910309"` | `extractNumericAdId` divide por slash, encontra a parte numerica |
| utm_content sem ID numerico: `"bio"` ou `"homepage"` | Retorna o valor original como fallback; provavelmente nao matchara com nenhum ad |
| Ad sincronizado apos a venda | Venda fica como organica ate o proximo rematch |
| Multiplos ads com mesmo facebook_ad_id | `maybeSingle()` retorna o primeiro; cenario improvavel pois facebook_ad_id deve ser unico por usuario |
| Erro de banco durante rematch | Erro e logado e adicionado ao array `errors` do resultado; o processo continua para as demais vendas |
| Venda sem nenhum parametro UTM | Nao entra no processo de matching; permanece como organica |
| Guru Digital com utm_campaign contendo adSetFbId | Parametro especifico extraido antes do matching padrao |
| Rematch com milhares de vendas | O mapa em memoria evita queries individuais por venda; apenas os updates sao feitos por sale |

---

## 9. Checklist de Testes

- [ ] Testar `extractNumericAdId` com string contendo pipe (ex: `"vid34|120245519580910309"`)
- [ ] Testar `extractNumericAdId` com string contendo slash (ex: `"creative/120245519580910309"`)
- [ ] Testar `extractNumericAdId` com ID puro (ex: `"120245519580910309"`)
- [ ] Testar `extractNumericAdId` com string sem numerico longo (ex: `"bio"`)
- [ ] Testar `extractNumericAdId` com null
- [ ] Validar matching Etapa 2: facebook_ad_id exato retorna hierarquia completa
- [ ] Validar matching Etapa 3: facebook_adset_id retorna adset + campaign
- [ ] Validar matching Etapa 4: adSetFbId do Guru retorna match correto
- [ ] Validar matching Etapa 5: campaignFbId do Guru retorna campaign
- [ ] Validar matching Etapa 6a: utm_campaign match exato com facebook_campaign_id
- [ ] Validar matching Etapa 6b: utm_campaign match parcial com campaign name (ILIKE)
- [ ] Validar que venda sem nenhum match retorna todos os campos null
- [ ] Testar `mapStatus` para cada plataforma (Hotmart, Kiwify, Kirvano)
- [ ] Testar rematch: confirmar que ad_id e preenchido a partir de utm_content
- [ ] Testar rematch: confirmar que mapa em memoria e construido corretamente
- [ ] Testar rematch: confirmar que vendas sao atualizadas com campaign_id, ad_set_id, ad_internal_id
- [ ] Testar rematch com erros parciais: resultado deve conter contagem correta e array de erros
- [ ] Validar que prioridade de extracao respeita: ad_id > utm_term > utm_content
- [ ] Testar `extractAdId` com campos tracking: ad_id, utm_term, utm_content, src, sck

---

## 10. Questoes Abertas

| # | Questao | Contexto |
|---|---|---|
| Q01 | Diferenca entre Edge Function e Backend | A funcao `matchSaleToAds` (Edge Function) faz queries individuais por venda, enquanto `SaleMatcherService` (backend) usa mapa em memoria. A versao da Edge Function e menos eficiente para grandes volumes |
| Q02 | Plataformas sem mapStatus | Apenas Hotmart, Kiwify e Kirvano possuem mapeamento de status. Guru, PerfectPay, Ticto, PayT, Cakto, Hubla, CartPanda, GG Checkout e LastLink usam mapeamento nos seus respectivos handlers de webhook, nao na funcao compartilhada |
| Q03 | extractNumericAdId vs extractNumericId | A versao da Edge Function retorna o valor original como fallback (`raw`), enquanto a versao do SaleMatcherService retorna `null`. Essa divergencia pode causar comportamentos diferentes entre atribuicao em tempo real e rematch |
| Q04 | Rematch incremental | O rematch atual processa TODAS as vendas nao atribuidas do usuario. Para usuarios com muitas vendas, seria mais eficiente processar apenas vendas dos ultimos N dias |
| Q05 | Batch updates | O rematch faz um UPDATE por venda. Agrupar updates em batches reduziria o numero de queries ao banco |
