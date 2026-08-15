# Import Sales — Importação Retroativa

> **Módulo:** `packages/backend/src/modules/sales/sales-import.{service,controller}.ts` | **Página:** `packages/frontend/src/pages/Sales.tsx` + `packages/frontend/src/components/sales/ImportSalesModal.tsx`
> **Última atualização:** 2026-04-22
> **Status:** Aprovado

---

## 1. Proposito

Permite que o usuario faca upload de um arquivo CSV ou XLSX exportado do painel da plataforma de checkout (v1: apenas Hotmart) para registrar retroativamente vendas que nao foram capturadas pelo webhook — tipicamente vendas anteriores a criacao da conta no Sentinela ou a configuracao da integracao. As linhas sao deduplicadas contra vendas ja existentes, atribuidas aos anuncios do Facebook via UTM/xcod (mesma logica do webhook) e persistidas com `source='import'`. Por decisao de produto, vendas importadas **nao contam** no limite mensal do plano — o plano e precificado por volume de vendas ao vivo, e o historico retroativo deve poder ser populado livremente. Beneficia usuarios novos que querem visualizar o ROI de campanhas passadas assim que entram na plataforma.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Botao "Importar Vendas" em `/sales` | Novo botao no header da pagina, ao lado do botao de refresh |

### 2.2 Fluxo de UI

A interacao acontece em um modal (`ImportSalesModal`) que segue uma state machine com os seguintes estados:

```
[closed] -> idle -> previewing -> preview-ready -> importing -> done
                \-> error                         \-> error
```

1. O usuario clica em "Importar Vendas" no header da pagina `/sales`. O modal abre no estado `idle`.
2. **idle:** Dropzone aceita `.csv` ou `.xlsx` ate 5 MB. Texto auxiliar informa o limite de 5.000 linhas e que apenas vendas com status "Aprovado" serao importadas. Se o workspace nao tiver nenhuma integracao Hotmart ativa, o dropzone e substituido por um CTA para `/settings/integrations`.
3. **previewing:** Ao soltar o arquivo, o modal chama `POST /api/sales/import/preview` e exibe um spinner enquanto aguarda resposta.
4. **preview-ready:** Resumo com contadores (`to_import`, `duplicates`, `non_approved`, `invalid`), dropdown com as integracoes Hotmart ativas do workspace e preview das 5 primeiras linhas. O usuario seleciona a integracao e clica em "Confirmar (N)".
5. **importing:** Loader bloqueante em tela cheia com mensagem "Processando N vendas... Nao feche esta janela." O botao de fechar e escondido e `onOpenChange` do Radix Dialog e ignorado — o modal so sai desse estado quando a requisicao termina.
6. **done:** Relatorio final com contagens (`imported`, `skipped_duplicates`, `skipped_non_approved`, `skipped_invalid`). Se houver linhas invalidas, um accordion mostra ate 5 exemplos com motivo. Ao fechar, `useSales.refetch()` e disparado para atualizar a tabela.
7. **error:** Qualquer passo pode transicionar para `error`, exibindo mensagem legivel e botao "Tentar outro arquivo" / "Voltar".

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Abrir o modal | Membro autenticado com workspace ativo |
| Fazer preview | Membro do workspace ativo |
| Confirmar import | Membro do workspace ativo + pelo menos 1 integracao Hotmart ativa no workspace |
| Visualizar vendas importadas | Mesmas regras da pagina `/sales` (workspace scoping + RLS) |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Deduplicacao | Upload contem `external_id` ja existente em `sales (external_id, workspace_id)` | Linha pulada e reportada como `skipped_duplicates`. Nao cria segunda row, nem atualiza a existente |
| RN-02 | Filtro por status | `Status != 'Aprovado'` na linha do CSV | Linha pulada como `skipped_non_approved`, nao persistida. Refunds/cancelamentos virao via webhook |
| RN-03 | Exclusao do plan-limit | Venda importada com `source='import'` | NAO conta no `plan.max_sales_monthly`. `PlanLimitsService` filtra explicitamente `source='webhook'` |
| RN-04 | Paridade de atribuicao | Linha importada possui coluna `Origem` com xcod valido | Mesmo `parseXcod` do webhook extrai UTMs + `ad_id`; `matchAndUpdateSale` vincula campanha/adset/ad. Se o ad nao existe no workspace, venda fica como `organic` (`campaign_id=NULL`) |
| RN-05 | Amount em BRL | Coluna `Valor que você recebeu convertido` + a coluna `Moeda` imediatamente anterior a ela | Gravada em `sales.amount` + `sales.currency`. O Hotmart export repete o header `Moeda` 4 vezes (uma por coluna de preço adjacente); o parser renomeia duplicatas para `Moeda (2..N)` e usa a que qualifica o valor recebido. Linhas com moeda de recebimento != `BRL` são `skipped_invalid`. **NÃO usar `Preço Total Convertido`**: nessa coluna o valor vem na moeda da oferta (USD para vendas internacionais), e tratá-lo como BRL subestima a receita em ~4–5x |
| RN-06 | Escopo por workspace | `integration_id` selecionado no modal | Usado como `checkout_integration_id`. Backend valida que pertence ao workspace do caller e que `platform='hotmart'`, senao retorna 403 |
| RN-07 | Volume maximo | Arquivo > 5 MB OU > 5.000 linhas | Rejeitado antes de qualquer insert. 413 no multipart para tamanho; 400 `too_many_rows` no parse |
| RN-08 | Idempotencia sob concorrencia | Webhook chega para a mesma transacao durante um import | `onConflict (external_id, workspace_id) DO NOTHING`: quem chegar primeiro vence, o outro e no-op. Uma unica linha, sem erro |
| RN-09 | Refund em venda importada | Webhook posterior de refund para linha com `source='import'` | `status='refunded'`; `source` permanece `'import'`. Imports continuam excluidos do plan-limit para sempre |
| RN-10 | Ad match sincrono por linha inserida | Cada row persistida durante o import | `matchAndUpdateSale` executa inline (via `Promise.allSettled` em lote) antes da resposta retornar ao cliente |

---

## 4. Modelo de Dados

### 4.1 Tabelas Principais

#### `sales` (tabela existente)

A tabela nao muda estrutura logica. Uma unica coluna nova e adicionada:

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| source | TEXT | Nao | `'webhook'` | Origem da linha. CHECK IN (`'webhook'`, `'import'`, `'manual'`). `'webhook'`: recebida via processor; conta no plan-limit. `'import'`: upload CSV/XLSX retroativo; NAO conta no plan-limit. `'manual'`: reservado para entrada manual futura |

Demais colunas da tabela permanecem identicas ao descrito em `docs/features/05-sales/sales.md`. A coluna `external_id` continua sendo a chave de deduplicacao.

### 4.2 Relacionamentos

As mesmas foreign keys ja existentes sao usadas:

```
sales.user_id                 -> auth.users(id)            ON DELETE CASCADE
sales.workspace_id            -> workspaces(id)            ON DELETE CASCADE
sales.checkout_integration_id -> checkout_integrations(id) ON DELETE SET NULL
sales.campaign_id             -> campaigns(id)             ON DELETE SET NULL
sales.ad_set_id               -> ad_sets(id)               ON DELETE SET NULL
sales.ad_internal_id          -> ads(id)                   ON DELETE SET NULL
```

Durante import, `checkout_integration_id` vem do dropdown do modal (validado no backend contra o workspace do caller).

### 4.3 Constraints e Defaults

- `UNIQUE (external_id, workspace_id)` — ja existia; e a chave de dedupe do import (BR-01 e BR-08).
- `CHECK (source IN ('webhook','import','manual'))` — novo.
- Novo indice parcial `idx_sales_planlimits_webhook` em `(user_id, sold_at DESC)` WHERE `status='approved' AND blocked_by_limit=false AND source='webhook'`. Da suporte direto a query de contagem do `PlanLimitsService` (que agora filtra `source='webhook'`).
- Migration: `supabase/migrations/20260422100000_sales_source_column.sql`. Linhas pre-existentes recebem `source='webhook'` via DEFAULT — valor historicamente correto.

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/sales/import/preview` | JWT + WorkspaceMember | Parse do arquivo + lookup de duplicatas + lista de integracoes Hotmart ativas. Retorna summary sem persistir nada |
| POST | `/api/sales/import` | JWT + WorkspaceMember | Parse + insert em lote (`upsertManyImported`, chunks de 500, `onConflict DO NOTHING`) + `matchAndUpdateSale` sincrono por linha inserida. Retorna relatorio final |

**Shape de `PreviewResponse`:**

```ts
{
  total_rows: number;
  to_import: number;
  duplicates: number;
  non_approved: number;
  invalid: number;
  invalid_samples: Array<{ row: number; reason: string }>;   // ate 5
  sample_preview: Array<{                                     // ate 5
    transaction: string;
    product_name: string;
    customer_email: string;
    amount_brl: number;
    sold_at: string;  // ISO
  }>;
  integrations: Array<{ id: string; name: string }>;
}
```

**Shape de `ImportResponse`:**

```ts
{
  imported: number;
  skipped_duplicates: number;
  skipped_non_approved: number;
  skipped_invalid: number;
  invalid_samples: Array<{ row: number; reason: string }>;   // ate 5
}
```

**Catalogo de erros 4xx:**

| Status | Code | Situacao |
|---|---|---|
| 400 | `unsupported_format` | Extensao diferente de `.csv` ou `.xlsx` |
| 400 | `parse_error` | Delimitador nao detectavel ou header malformado |
| 400 | `unsupported_schema` | Coluna obrigatoria ausente. Body retorna `{ missing_column }` |
| 400 | `no_data_rows` | Arquivo tem apenas header |
| 400 | `too_many_rows` | Mais de 5.000 linhas de dados |
| 403 | `integration_forbidden` | `integration_id` nao existe, nao esta ativo, nao e Hotmart ou nao pertence ao workspace (apenas `POST /sales/import`) |
| 413 | `file_too_large` | Maior que 5 MB (barrado pelo `@fastify/multipart`) |
| 422 | `no_active_integration` | Workspace nao tem integracao Hotmart ativa |

**Rate limit:** 5 requisicoes por minuto por usuario em ambos endpoints via `ThrottlerGuard` local.

### 5.2 Logica do Service

**`SalesImportService`** (`packages/backend/src/modules/sales/sales-import.service.ts`):

| Metodo | Responsabilidade |
|---|---|
| `preview(file, filename, userId, workspaceId)` | Parse -> classifica cada linha (import / duplicate / non_approved / invalid) -> consulta integracoes Hotmart ativas -> retorna `PreviewResponse`. Nao persiste |
| `import(file, filename, userId, workspaceId, integrationId)` | Valida integracao (404/403) -> parse + classifica -> `SalesService.upsertManyImported` em chunks de 500 -> `WebhooksService.matchAndUpdateSale` via `Promise.allSettled` por linha inserida -> retorna `ImportResponse` |

**Detalhes:**

- Parser CSV usa `csv-parse` com `{ delimiter: ';', bom: true, columns: true, skip_empty_lines: true, trim: true }`. Fallback para `,` quando o resultado e uma unica coluna.
- Parser XLSX usa `xlsx` (SheetJS). Arquivos `.xls` legados (binarios) sao rejeitados com mensagem especifica ao detectar magic bytes.
- Limite de 5.001 linhas verificado durante streaming — aborta antes de alocar o array completo.
- Datas em `Data de Venda` parseadas como `America/Sao_Paulo` via `date-fns-tz` e convertidas para UTC.
- `parseXcod` e `extractAdIdFromValue` importados de `packages/backend/src/modules/webhooks/processors/hotmart-tracking.util.ts` — mesmos usados pelo `HotmartProcessor`.
- Logging estruturado em cada `import`: `{ event: 'sales_import', workspace_id, imported, skipped_duplicates, skipped_invalid, duration_ms }`.

**`SalesService.upsertManyImported(rows)`** (metodo novo): upsert unico com `onConflict: 'external_id,workspace_id'` e `ignoreDuplicates: true`. Retorna as linhas efetivamente inseridas (exclui duplicatas). Marca `source='import'` e `blocked_by_limit=false` incondicionalmente na escrita.

**Alteracao em `PlanLimitsService`** (`packages/backend/src/modules/plan-limits/plan-limits.service.ts`): a query de contagem mensal ganha `.eq('source', 'webhook')`. O novo indice parcial casa exatamente com os predicados, tornando a query estritamente mais barata do que era antes.

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Arquivo | Descricao |
|---|---|
| `packages/frontend/src/pages/Sales.tsx` | Adiciona botao "Importar Vendas" no header, ao lado do refresh. Mantem state `isImportModalOpen` |
| `packages/frontend/src/components/sales/ImportSalesModal.tsx` | Radix Dialog com state machine (idle / previewing / preview-ready / importing / done / error). Encapsula dropzone, preview, seletor de integracao, loader bloqueante e relatorio final |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useSalesImportPreview` | `packages/frontend/src/hooks/useSalesImportPreview.ts` | `useMutation` -> `POST /api/sales/import/preview` (multipart) |
| `useSalesImportCommit` | `packages/frontend/src/hooks/useSalesImportCommit.ts` | `useMutation` -> `POST /api/sales/import` (multipart) |

O helper `postMultipart` em `packages/frontend/src/lib/api.ts` faz o `fetch` sem setar `Content-Type` (deixa o browser definir boundary).

### 6.3 Gerenciamento de Estado

- Estado do modal e local — `useState` da state machine dentro de `ImportSalesModal`. Nao propaga para contexts globais.
- Client-side validations minimas antes de chamar preview: extensao em `{.csv, .xlsx}` e tamanho <= 5 MB. Toda validacao profunda fica no backend.
- Durante `importing`, o Dialog recebe `onOpenChange` como no-op e o botao X e ocultado — impede o usuario de sair no meio.
- Ao fechar em `done`, chama `refetch()` do `useSales` (ou invalida `['sales', workspaceId]` no `queryClient`) para a tabela refletir as novas linhas ja atribuidas.

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| `HotmartProcessor` (webhook) | Reuso de parser | Compartilha `parseXcod`/`extractAdIdFromValue` via `hotmart-tracking.util.ts`. Snapshot test garante paridade comportamental |
| `WebhooksService.matchAndUpdateSale` | Reuso de atribuicao | Chamado por cada linha inserida para popular campaign/ad_set/ad |
| `PlanLimitsService.getSalesCount` | Alteracao de predicado | Agora filtra `source='webhook'`. Imports ficam invisiveis ao plan-limit |
| `SalesService.upsertFromWebhook` | Inalterado | Webhooks continuam gravando `source='webhook'` por default da coluna |
| `checkout_integrations` | Leitura | Lista de integracoes Hotmart ativas do workspace, usada no dropdown e na validacao do commit |
| `/sales` page (`useSales`) | Consumer | Recarrega ao fechar o modal em estado `done` |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Header com BOM UTF-8 | `csv-parse` com `bom: true` consome o BOM silenciosamente |
| Delimitador ambiguo (`,` vs `;`) | Tenta `;` primeiro; se resultado tem coluna unica, reparseia com `,`. Se ambos falham, 400 `parse_error` |
| Arquivo `.xls` legado (binario) | Detectado por magic bytes e rejeitado com 400 `unsupported_format` — nao suportado em v1 |
| Arquivo vazio (apenas header) | 400 `no_data_rows` |
| Coluna critica ausente no header | 400 `unsupported_schema` com `{ missing_column }` |
| Mais de 5.000 linhas de dados | 400 `too_many_rows` — detectado na linha 5.001 antes de alocar array |
| Arquivo > 5 MB | 413 `file_too_large` pelo `@fastify/multipart` |
| Webhook para mesma transacao durante import | `onConflict (external_id, workspace_id) DO NOTHING` — primeiro writer vence, sem erro |
| Usuario fecha aba durante `importing` | `req.raw.on('close')` aborta entre chunks; o que ja foi commitado persiste. Re-importar e idempotente via dedupe |
| Ads ainda nao sincronizados para o periodo | Linhas salvas como `organic` (`campaign_id=NULL`). Nao ha re-match retroativo automatico (ver Q01) |
| Refund via webhook para linha `source='import'` | Path existente atualiza `status='refunded'`; `source` nao muda. Permanece fora do plan-limit |
| Zero integracoes Hotmart | Preview retorna 422 `no_active_integration` com CTA para `/settings/integrations` |
| Multiplas integracoes Hotmart | Dropdown no modal, selecao obrigatoria |
| Metodo de pagamento desconhecido | Armazenado como string crua em `payment_method` (mesmo comportamento do webhook) |
| Mesma transacao em outro workspace do usuario | Nao e duplicata no workspace atual — a unicidade e `(external_id, workspace_id)`. Linha inserida normalmente |
| Linha com `Valor que você recebeu convertido` = 0 ou nao numerico | `skipped_invalid` com motivo — nao persistida |
| Linha com `Moeda` de recebimento != BRL | `skipped_invalid` com motivo `Moeda de recebimento "<xxx>" não suportada` |
| Linha sem `Email` ou `Transação` vazio | `skipped_invalid` com motivo |

---

## 9. Checklist de Testes

**Backend (Jest):**

- [ ] BR-03 (plan-limit exclusion): 5 vendas `source='import'` + 3 `source='webhook'`, todas aprovadas no ciclo -> `getUsageSnapshot` retorna `sales.used = 3`
- [ ] Snapshot de `parseXcod`/`extractAdIdFromValue` cobre os formatos reais do CSV (Facebook_Mobile_Reels, FB long-tail, Facebook_Stories, Instagram_Stories trailing)
- [ ] `SalesImportService.parseFile` (CSV) lida com BOM UTF-8, delimitador `;` e `,`, datas em America/Sao_Paulo
- [ ] `SalesImportService.parseFile` (XLSX) lida com OOXML e rejeita `.xls` legado
- [ ] Classificacao: `skipped_non_approved` quando `Status != 'Aprovado'`
- [ ] Classificacao: `skipped_invalid` para `Transação` vazio, amount <= 0, email vazio, data invalida
- [ ] Dedupe: upload contendo `external_id` pre-existente no workspace -> `skipped_duplicates`
- [ ] Dedupe cross-workspace: mesma `external_id` em outro workspace do mesmo usuario -> inserida normalmente
- [ ] Arquivo com 5.001 linhas -> 400 `too_many_rows`
- [ ] Arquivo com 6 MB -> 413 `file_too_large`
- [ ] `integration_id` de outro workspace -> 403 `integration_forbidden`
- [ ] `integration_id` de plataforma nao-Hotmart -> 403 `integration_forbidden`
- [ ] Zero integracoes Hotmart ativas -> 422 `no_active_integration`
- [ ] Sync ad matching: ad pre-seedado com ID compativel -> linha importada tem `campaign_id` preenchido
- [ ] Auth: token ausente -> 401

**Frontend (Vitest + Testing Library):**

- [ ] State machine do `ImportSalesModal` renderiza cada estado corretamente e transiciona em success/error das mutations
- [ ] Validacao client-side rejeita `.pdf` sem chamar o backend
- [ ] Cenario zero-integracao mostra CTA para `/settings/integrations` e esconde o dropzone
- [ ] Durante `importing`, botao de fechar e invisivel e clique fora/ESC nao fecha o modal
- [ ] Ao fechar em `done`, `queryClient.invalidateQueries(['sales', workspaceId])` e disparado

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Re-match historico de anuncios | Se o usuario importa hoje e a sincronizacao do Facebook busca anuncios mais antigos amanha, as vendas importadas nao sao re-atribuidas. Fora de escopo v1; revisitar com feedback de usuarios |
| Q02 | Outras plataformas | Kiwify, Kirvano, Guru, Perfect Pay, Ticto, PayT, Cakto, Hubla, CartPanda, GG Checkout, LastLink. Cada uma entra como PR pequena reusando o esqueleto do `SalesImportService` com parser/column map proprios |
| Q03 | Progresso para arquivos grandes | Loader atual nao mostra percentual. Se imports regularmente passarem de ~10 s, avaliar SSE do endpoint de commit |
| Q04 | Importar statuses alem de Aprovado | Usuarios podem querer historico completo com refunds. Schema ja suporta; basta expor checkbox no modal quando solicitado |
