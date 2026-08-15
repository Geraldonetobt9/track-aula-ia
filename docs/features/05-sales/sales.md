# Vendas (Sales)

## 1. Proposito

A pagina de Vendas e o painel central para visualizacao e analise de todas as transacoes recebidas via webhooks das plataformas de checkout integradas. Ela permite ao usuario filtrar, buscar e analisar vendas por multiplos criterios, visualizar metricas consolidadas (faturamento bruto, liquido, ticket medio, taxa de reembolso), explorar graficos de distribuicao por produto e UTM, e inspecionar os detalhes completos de cada venda individual, incluindo dados de atribuicao de anuncios.

> **Caminhos de ingestao de vendas:**
> Vendas no Sentinela chegam por dois caminhos, diferenciados pela coluna `sales.source`:
> 1. **Webhook** (`source='webhook'`) — tempo real, disparado pelas integracoes de checkout configuradas. **Conta** no limite mensal do plano.
> 2. **Import retroativo** (`source='import'`) — upload manual de CSV/XLSX exportado da plataforma (v1: apenas Hotmart). **NAO conta** no limite do plano, para permitir popular o historico livremente.
>
> Detalhes do fluxo de import em `docs/features/15-import-sales/import-sales.md`.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar `/sales` | Link "Vendas" no menu lateral do DashboardLayout |
| Dashboard | Cards de metricas com link para detalhamento de vendas |

### 2.2 Fluxo de UI

1. O usuario acessa `/sales` pela sidebar.
2. Se nao houver workspace ativo ou integracoes configuradas, exibe mensagem orientando o usuario a configurar via `/integrations`.
3. Com workspace ativo, a pagina carrega automaticamente todas as vendas aprovadas e reembolsadas via `useSales`.
4. O usuario utiliza os filtros na barra superior:
   - **Busca textual**: filtra por nome do produto, nome do cliente, email ou nome da campanha.
   - **Plataforma de checkout**: dropdown com todas as plataformas configuradas (Hotmart, Kiwify, Kirvano, Guru, etc.) ou "Todas".
   - **Status**: approved, refunded ou "Todos".
   - **Campanha**: dropdown com campanhas do Facebook Ads.
   - **Periodo**: presets (7d, 15d, 30d, 90d) ou seletor de data personalizado.
5. Cards de metricas atualizam conforme filtros: Total de Vendas, Faturamento Bruto, Faturamento Liquido, Ticket Medio, Taxa de Reembolso.
6. Tres graficos exibem distribuicao: Vendas por Produto (barras), UTM Content (barras horizontais), Analise de Reembolsos (barras comparativas).
7. Tabela paginada (10 por pagina) lista as vendas com colunas: Data, Produto, Cliente, Valor, Status, Plataforma, Campanha, Tipo (pago/organico).
8. Ao clicar em uma linha, abre o `SaleDetailsDrawer` com todas as informacoes: dados do cliente, metodo de pagamento, UTMs completos, hierarquia de atribuicao (campanha > conjunto de anuncios > anuncio), metricas do anuncio atribuido (spend, impressions, clicks, CPC, CTR).

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar vendas | Proprietario do workspace ou admin impersonando |
| Filtrar e buscar | Qualquer usuario autenticado com workspace ativo |
| Ver detalhes da venda | Proprietario do workspace ou admin impersonando |

---

## 3. Regras de Negocio

| # | Regra | Descricao |
|---|---|---|
| RN01 | Filtro de status padrao | A consulta padrao busca vendas com status `approved` e `refunded`, excluindo `pending` |
| RN02 | Escopo de workspace | Vendas sao filtradas pelos `checkout_ids` e `product_names` vinculados ao workspace ativo |
| RN03 | Tipo de atribuicao | Venda e "paid" se possui `campaign_id` preenchido; caso contrario e "organic" |
| RN04 | Paginacao | Tabela exibe 10 itens por pagina com navegacao anterior/proximo |
| RN05 | Faturamento Bruto | Soma de `amount` de todas as vendas aprovadas no periodo filtrado |
| RN06 | Faturamento Liquido | Faturamento Bruto menos soma de `amount` das vendas reembolsadas |
| RN07 | Ticket Medio | Faturamento Bruto dividido pelo numero de vendas aprovadas |
| RN08 | Taxa de Reembolso | (Vendas reembolsadas / Total de vendas) * 100 |
| RN09 | Ad Spend correlacionado | O gasto com anuncios e buscado via `/metrics/daily-spend` para o mesmo periodo selecionado |
| RN10 | Impersonacao | Admins podem visualizar vendas de outros usuarios via parametro `target_user_id` |

---

## 4. Modelo de Dados

### 4.1 Tabelas

#### `sales`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| campaign_id | UUID | Sim | NULL | FK para campaigns (atribuicao) |
| checkout_integration_id | UUID | Sim | NULL | FK para checkout_integrations |
| ad_id | TEXT | Sim | NULL | Facebook Ad ID numerico extraido do UTM |
| ad_set_id | UUID | Sim | NULL | FK para ad_sets (atribuicao) |
| ad_internal_id | UUID | Sim | NULL | FK para ads (atribuicao) |
| external_id | TEXT | Sim | NULL | ID da transacao na plataforma de checkout |
| customer_email | TEXT | Sim | NULL | Email do comprador |
| customer_name | TEXT | Sim | NULL | Nome do comprador |
| customer_phone | TEXT | Sim | NULL | Telefone do comprador |
| customer_doc | TEXT | Sim | NULL | CPF/CNPJ do comprador |
| product_name | TEXT | Sim | NULL | Nome do produto vendido |
| amount | DECIMAL(12,2) | Nao | - | Valor da transacao |
| currency | TEXT | Sim | 'BRL' | Moeda da transacao |
| status | TEXT | Sim | 'approved' | Status: pending, approved, refunded, chargeback |
| payment_method | TEXT | Sim | NULL | Metodo de pagamento (pix, credit_card, boleto) |
| checkout_source | TEXT | Sim | NULL | Plataforma de origem (hotmart, kiwify, etc.) |
| utm_source | TEXT | Sim | NULL | Parametro UTM source |
| utm_medium | TEXT | Sim | NULL | Parametro UTM medium |
| utm_campaign | TEXT | Sim | NULL | Parametro UTM campaign |
| utm_content | TEXT | Sim | NULL | Parametro UTM content |
| utm_term | TEXT | Sim | NULL | Parametro UTM term |
| metadata | JSONB | Sim | NULL | Dados adicionais do webhook |
| sold_at | TIMESTAMPTZ | Nao | now() | Data/hora da venda |
| created_at | TIMESTAMPTZ | Nao | now() | Data de criacao do registro |

### 4.2 Relacionamentos

```
sales.user_id         -> auth.users(id)         ON DELETE CASCADE
sales.campaign_id     -> campaigns(id)           ON DELETE SET NULL
sales.checkout_integration_id -> checkout_integrations(id) ON DELETE SET NULL
sales.ad_set_id       -> ad_sets(id)             ON DELETE SET NULL (opcional)
sales.ad_internal_id  -> ads(id)                 ON DELETE SET NULL (opcional)
```

### 4.3 Constraints

- `status` CHECK: deve ser um de `pending`, `approved`, `refunded`, `chargeback`
- RLS habilitado: usuarios so veem suas proprias vendas (`auth.uid() = user_id`)
- Admins podem visualizar todas as vendas via policy separada

**Indices:**

- `idx_sales_user_id` em `user_id`
- `idx_sales_campaign_id` em `campaign_id`
- `idx_sales_sold_at` em `sold_at`
- `idx_sales_ad_id` em `ad_id`
- `idx_sales_ad_set_id` em `ad_set_id`
- `idx_sales_ad_internal_id` em `ad_internal_id`

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/sales` | Lista vendas do usuario com filtros |
| GET | `/api/metrics/daily-spend` | Retorna gasto total com anuncios no periodo |

### 5.2 Logica

**GET /api/sales**

Controller: `SalesController.getSales()`
Service: `SalesService.getSales()`

Parametros de query:
- `from` (string, opcional): data inicial no formato `YYYY-MM-DD`
- `to` (string, opcional): data final no formato `YYYY-MM-DD`
- `status` (string, opcional): filtro por status (ex: `approved,refunded`)
- `checkout_ids` (string, opcional): IDs das integracoes de checkout separados por virgula
- `product_names` (string, opcional): nomes de produtos separados por virgula

Fluxo:
1. Valida autenticacao via `AuthGuard`.
2. Extrai `userId` do token JWT via `@CurrentUser('id')`.
3. Constroi query Supabase em `sales` com `user_id = userId`.
4. Aplica filtros opcionais: `gte('sold_at', from)`, `lte('sold_at', to)`, `eq('status', status)`, `in('checkout_id', checkout_ids)`, `in('product_name', product_names)`.
5. Ordena por `sold_at` descendente.
6. Retorna array de vendas.

**GET /api/sales (com detalhes)**

Service alternativo: `SalesService.getSalesWithDetails()`
- Mesma logica, mas com join: `select('*, campaigns(name), ads(name)')`.
- Retorna nome da campanha e nome do anuncio junto com a venda.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Sales (pagina) | `src/pages/Sales.tsx` | Pagina principal com layout, filtros, metricas, graficos e tabela |
| SalesMetricsCards | `src/components/sales/SalesMetricsCards.tsx` | Cards de Total Vendas, Faturamento Bruto, Liquido, Ticket Medio, Taxa Reembolso |
| SalesFilters | `src/components/sales/SalesFilters.tsx` | Barra de filtros: busca, plataforma, status, campanha, periodo |
| SaleDetailsDrawer | `src/components/sales/SaleDetailsDrawer.tsx` | Drawer lateral com detalhes completos da venda selecionada |
| ProductSalesChart | `src/components/sales/ProductSalesChart.tsx` | Grafico de barras com vendas agrupadas por produto |
| UtmContentChart | `src/components/sales/UtmContentChart.tsx` | Treemap "Vendas por Anúncio". Agrupa pela chave `COALESCE(utm_content, ads.name, sales.ad_id, 'Sem anúncio')` aplicando `split('\|')[0].split('/')[0].trim()`. Fonte: RPC `sales_summary` (com fallback in-memory em `sales.service.ts`). |
| RefundAnalysisSection | `src/components/sales/RefundAnalysisSection.tsx` | Secao com analise comparativa de reembolsos |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useSales` | `src/hooks/useSales.ts` | `{ sales, loading, error, refetch, fetchAdSpend }` |

**useSales:**
- Busca vendas via `GET /api/sales` com filtros de status (`approved,refunded`), checkout_ids e product_names do workspace ativo.
- Suporta impersonacao via `target_user_id`.
- `fetchAdSpend(from, to)` busca gasto com anuncios via `/metrics/daily-spend`.
- Recarrega automaticamente quando `effectiveId`, `refetchSignal`, `activeWorkspaceId`, `activeCheckoutIds` ou `activeProductNames` mudam.

> **Nota:** Dados de vendas agrupadas por regiao nao sao mais buscados pela pagina de Vendas. Esses dados sao retornados pelo endpoint `/api/metrics/dashboard` e consumidos exclusivamente pelo Dashboard via `useDashboardMetrics`.

### 6.3 Estado

| Estado | Tipo | Descricao |
|---|---|---|
| `search` | string | Texto de busca |
| `checkoutFilter` | string | Plataforma selecionada (ou 'all') |
| `statusFilter` | string | Status selecionado (ou 'all') |
| `campaignFilter` | string | Campanha selecionada (ou 'all') |
| `periodOption` | PeriodOption | Preset de periodo (7d, 15d, 30d, 90d, custom) |
| `dateRange` | DateRange | Intervalo de datas selecionado |
| `currentPage` | number | Pagina atual da tabela (inicia em 1) |
| `selectedSale` | SaleWithDetails ou null | Venda selecionada para exibicao no drawer |
| `adSpend` | number | Gasto com anuncios no periodo selecionado |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Webhooks de checkout | Entrada | Vendas sao criadas por webhooks de 16 plataformas (Hotmart, Kiwify, Kirvano, Guru, PerfectPay, Ticto, PayT, Cakto, Hubla, CartPanda, GG Checkout, LastLink, Eduzz, Mundpay, Monetizze, Greenn) |
| Facebook Ads (atribuicao) | Leitura | Hierarquia campanha > ad_set > ad preenchida pelo sale-matcher |
| WorkspaceContext | Contexto | Fornece `activeCheckoutIds` e `activeProductNames` para escopo |
| ActiveConnectionContext | Contexto | Fornece `activeConnectionId` para filtrar metricas de spend |
| ImpersonationContext | Contexto | Permite admins visualizarem vendas de outros usuarios |
| RefetchContext | Contexto | Sinal global para recarregar dados apos sincronizacao |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Nenhum workspace ativo | Exibe mensagem orientando configurar workspace em `/integrations` |
| Nenhuma integracao vinculada ao workspace | Exibe aviso com botao para ir a pagina de integracoes |
| Vendas sem produto (`product_name` null) | Exibido como "Produto desconhecido" na UI |
| Vendas sem campanha (`campaign_id` null) | Classificada como "organic" no tipo de atribuicao |
| Erro na API de vendas | Hook seta `error` com mensagem; UI pode exibir estado de erro |
| Vendas com `amount` zero | Incluidas normalmente; podem indicar produto gratuito ou cupom integral |
| Periodo sem vendas | Cards exibem zero; graficos exibem estado vazio |
| Muitas vendas (performance) | Backend retorna todas as vendas sem paginacao server-side; paginacao e feita no frontend com 10 itens por pagina |

---

## 9. Checklist de Testes

- [ ] Verificar que vendas sao listadas corretamente para o usuario autenticado
- [ ] Confirmar que filtro de busca textual filtra por produto, cliente, email e campanha
- [ ] Testar filtro por plataforma de checkout (individual e "Todas")
- [ ] Testar filtro por status (approved, refunded, all)
- [ ] Testar filtro por campanha especifica
- [ ] Validar que presets de periodo (7d, 15d, 30d, 90d) calculam datas corretas
- [ ] Testar seletor de data personalizado
- [ ] Confirmar que metricas (total, bruto, liquido, ticket medio, reembolso) calculam corretamente
- [ ] Verificar que paginacao funciona com 10 itens por pagina
- [ ] Testar abertura do drawer de detalhes ao clicar em uma venda
- [ ] Confirmar que dados de atribuicao (campanha, ad set, ad) aparecem no drawer
- [ ] Verificar comportamento com workspace sem integracoes
- [ ] Testar impersonacao: admin ve vendas de outro usuario
- [ ] Validar que RLS impede acesso a vendas de outros usuarios
- [ ] Testar graficos com dados variados e com dados vazios

---

## 10. Questoes Abertas

| # | Questao | Contexto |
|---|---|---|
| Q01 | Paginacao server-side | Atualmente toda paginacao e feita no frontend. Para usuarios com milhares de vendas, seria necessario implementar paginacao no backend com `LIMIT`/`OFFSET` ou cursor-based |
| Q02 | Exportacao de dados | Nao ha funcionalidade de exportar vendas para CSV/Excel. Usuarios podem precisar disso para contabilidade |
| Q03 | Filtro por tipo de atribuicao | Nao ha filtro explicito para "pago" vs "organico" na UI, apenas a coluna na tabela |
| Q04 | Status `chargeback` | O CHECK constraint permite `chargeback`, mas o filtro padrao so busca `approved` e `refunded`. Chargebacks podem nao aparecer na listagem padrao |
| Q05 | Vendas duplicadas | Nao ha validacao explicita de `external_id` unico. Webhooks reenviados podem criar vendas duplicadas |
