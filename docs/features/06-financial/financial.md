# Financeiro (Financial)

## 1. Proposito

A pagina Financeiro oferece uma visao mensal de P&L (Profit & Loss) do negocio do usuario. Ela consolida faturamento bruto (vendas aprovadas), gasto com anuncios (Facebook Ads), despesas manuais, receitas adicionais e custos fixos da empresa para calcular o lucro liquido do mes. O usuario pode adicionar lancamentos financeiros, importar lancamentos de meses anteriores, configurar custos recorrentes da empresa e acompanhar a evolucao do lucro ao longo de multiplos meses.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar `/financial` | Link "Financeiro" no menu lateral do DashboardLayout |

### 2.2 Fluxo de UI

1. O usuario acessa `/financial` pela sidebar.
2. Um seletor de periodo oferece tres granularidades:
   - **Total** — todo o historico, sem limite de data.
   - **Ano** — os 4 anos mais recentes (`YYYY-01-01` a `YYYY-12-31`).
   - **Mes** — os 12 meses mais recentes.

   A opcao escolhida e convertida em um par `from`/`to` (`periodToRange`) e enviada a API. "Total" envia a faixa vazia, que a API interpreta como ilimitada.
3. Cards de resumo exibem os 6 indicadores principais:
   - **Faturamento Bruto**: soma das vendas aprovadas no periodo (via `useFinancialSummary`).
   - **Gasto com Ads**: spend do Facebook Ads **+ imposto do Meta Ads**. O valor principal e `adSpend + adSpendTax`; uma linha de breakdown mostra `Ads R$ X · Imposto Y% R$ Z`.
   - **Imposto**: apenas exibe a soma dos lancamentos tipo `tax` do periodo. **Nao e editavel aqui** — o valor e informado no `ImpostoValueCard`, ao lado do card do imposto do Meta Ads.
   - **Outros Gastos**: soma dos lancamentos tipo `expense` + custos da empresa.
   - **Outras Receitas**: soma dos lancamentos tipo `revenue` no periodo (via `useFinancialEntries`).
   - **Lucro**: `Faturamento Bruto - Gasto Ads - Imposto Meta Ads - Imposto informado - Despesas - Custos Empresa + Receitas`.
4. Abaixo dos cards, duas secoes de lancamentos (despesas e receitas) permitem:
   - Adicionar novo lancamento (nome + valor).
   - Editar lancamento existente (nome ou valor).
   - Remover lancamento.
   - Importar lancamentos do mes anterior.
5. Secao de custos da empresa (`useCompanyCosts`) permite configurar custos recorrentes:
   - Tipo `percentage`: percentual sobre o faturamento bruto (ex: 6% de impostos).
   - Tipo `fixed`: valor absoluto mensal (ex: R$ 2.000 de aluguel).
7. Abaixo do grafico de composicao, os dois cards de imposto ficam lado a lado: **Imposto sobre Anuncios** (`AdSpendTaxCard`, percentual do Meta Ads persistido em `workspaces.ad_spend_tax_percentage`) e **Imposto** (`ImpostoValueCard`, valor em reais informado pelo usuario, com a imagem ilustrativa). Sao independentes.
8. Grafico de evolucao do lucro (`useProfitEvolution`) exibe tendencia dos ultimos 6 meses com barras empilhadas mostrando receita, gastos, despesas e lucro.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar financeiro | Proprietario do workspace |
| Adicionar/editar/remover lancamentos | Proprietario do workspace |
| Importar lancamentos | Proprietario do workspace |
| Configurar custos da empresa | Usuario autenticado (escopo global, nao por workspace) |
| Admin impersonando | Pode visualizar via `target_user_id` no summary |

---

## 3. Regras de Negocio

| # | Regra | Descricao |
| RN01 | Formula de lucro | `Lucro = Faturamento Bruto - Gasto Anuncios - Imposto Meta Ads - Imposto informado - Soma Despesas - Custos Empresa + Soma Receitas` |
| RN01 | Formula de lucro | `Lucro = Faturamento Bruto - Gasto Anuncios - Imposto - Soma Despesas - Custos Empresa + Soma Receitas` |
| RN02 | Custo empresa percentual | Para custos tipo `percentage`, o valor aplicado e: `faturamento_bruto * (value / 100)` |
| RN03b | Imposto do Meta Ads | `adSpendTax = adSpend * (workspaces.ad_spend_tax_percentage / 100)`. Aplicado no Dashboard E no Financeiro, somado ao card "Gasto com Ads". Valor 0–100, validado no backend. |
| RN03b | Imposto informado pelo usuario | O imposto e um valor em reais digitado no card, gravado como um lancamento `financial_entries` de tipo `tax`. Nao e mais derivado do gasto com ads. |
| RN04 | Lancamento por mes e workspace | Cada lancamento e vinculado a um `workspace_id` e um `reference_month` |
| RN05 | Tipos de lancamento | Tres tipos validos: `expense` (despesa), `revenue` (receita) e `tax` (imposto) |
| RN06 | Valor obrigatoriamente positivo | O `amount` deve ser um numero finito maior que zero |
| RN07 | Importacao de mes anterior | Copia todos os lancamentos (tipo, nome, valor) de um mes de origem para o mes de destino |
| RN08 | Verificacao de propriedade | Toda operacao verifica que o workspace pertence ao usuario via `verifyWorkspaceOwnership` |
| RN09 | Faturamento Bruto | Calculado a partir de vendas aprovadas no periodo via endpoint `/metrics/dashboard` |
| RN10 | Gasto com Anuncios | Calculado a partir do spend do Facebook Ads no periodo via `aggregateAdSpend` |
| RN11 | Granularidade do periodo | O seletor aceita mes, ano ou total. Todos viram um par `from`/`to`; total envia faixa vazia |
| RN12 | Lancamentos por faixa de meses | Com `from`/`to`, `financial_entries` e filtrado por `reference_month` entre os limites (`gte`/`lte`). Como o campo guarda o primeiro dia do mes, a visao anual cobre os 12 meses do ano |
| RN13 | Ancoragem do gasto com ads no total | Sem `from`, `aggregateAdSpend` cairia no default de 30 dias e seria comparado com faturamento all-time, inflando o lucro. O service ancora na data da primeira venda do workspace |
| RN15 | Dois impostos independentes | O do Meta Ads e percentual sobre `adSpend` e entra no card "Gasto com Ads". O informado pelo usuario e um valor em reais gravado como lancamento `tax`, com card proprio. Nao se sobrepoem: o lucro subtrai os dois |
| RN15 | Imposto separado do gasto com ads | O card "Gasto com Ads" mostra apenas `adSpend`. O imposto tem card proprio e entra na formula do lucro como parcela independente |
| RN16 | Mes de destino de novos lancamentos | Nas visoes de ano e total nao existe um mes unico, entao novos lancamentos usam o mes corrente (`periodToEntryMonth`) |
| RN17 | Importacao so em visao mensal | O botao "Importar de outro mes" copia um mes para outro, entao so aparece quando a visao e mensal |

---

## 4. Modelo de Dados

### 4.1 Tabelas

#### `financial_entries`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| workspace_id | UUID | Sim | NULL | FK para workspaces |
| type | TEXT | Sim | - | Tipo: 'expense', 'revenue' ou 'tax' |
| name | TEXT | Nao | - | Descricao do lancamento |
| amount | NUMERIC | Sim | 0 | Valor do lancamento |
| reference_month | DATE | Nao | - | Mes de referencia (primeiro dia do mes, ex: 2026-03-01) |
| created_at | TIMESTAMPTZ | Sim | now() | Data de criacao |

#### `company_costs`

| Coluna | Tipo | Nulavel | Default | Descricao |
|---|---|---|---|---|
| id | UUID | Nao | gen_random_uuid() | Chave primaria |
| user_id | UUID | Nao | - | FK para auth.users |
| name | TEXT | Nao | - | Descricao do custo (ex: "Impostos", "Aluguel") |
| type | TEXT | Nao | - | Tipo: 'percentage' ou 'fixed' |
| value | NUMERIC | Nao | - | Valor: percentual (ex: 6.0) ou absoluto (ex: 2000.00) |
| created_at | TIMESTAMPTZ | Sim | now() | Data de criacao |

### 4.2 Relacionamentos

```
financial_entries.user_id      -> auth.users(id)
financial_entries.workspace_id -> workspaces(id)    ON DELETE CASCADE
company_costs.user_id          -> auth.users(id)
```

### 4.3 Constraints

**financial_entries:**
- `type` CHECK: deve ser `expense`, `revenue` ou `tax`
- RLS habilitado: usuarios so veem/editam seus proprios lancamentos (`auth.uid() = user_id`)
- Admins podem gerenciar todos os lancamentos

**company_costs:**
- `type` CHECK: deve ser `percentage` ou `fixed`
- RLS habilitado: usuarios so veem/editam seus proprios custos (`auth.uid() = user_id`)

**Indices:**
- `idx_financial_entries_user_id` em `financial_entries.user_id`
- `idx_financial_entries_workspace_id` em `financial_entries.workspace_id`
- `idx_financial_entries_reference_month` em `financial_entries.reference_month`
- `idx_financial_entries_workspace_month_type` em `financial_entries (workspace_id, reference_month, type)`
- `idx_company_costs_user_id` em `company_costs.user_id`

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Rota | Descricao |
|---|---|---|
| GET | `/api/financial` | Lista lancamentos por workspace e mes |
| POST | `/api/financial` | Adiciona novo lancamento |
| PATCH | `/api/financial/:id` | Atualiza nome e/ou valor de um lancamento |
| DELETE | `/api/financial/:id` | Remove um lancamento |
| POST | `/api/financial/import` | Importa lancamentos de um mes para outro |
| GET | `/api/financial/summary` | Retorna `grossRevenue`, `adSpend`, `adSpendTax` e `adSpendTaxPercentage` do periodo |
| PATCH | `/api/workspaces/:id/ad-spend-tax` | Atualiza `ad_spend_tax_percentage` do workspace (body: `{ percentage: number }`, 0–100) |
| GET | `/api/integrations/company-costs` | Lista custos da empresa do usuario |
| POST | `/api/integrations/company-costs` | Adiciona custo da empresa |
| DELETE | `/api/integrations/company-costs/:id` | Remove custo da empresa |
| GET | `/api/metrics/dashboard` | Retorna grossRevenue e adSpend para o periodo |

### 5.2 Logica

**GET /api/financial**

Controller: `FinancialController.list()`
Service: `FinancialService.list(userId, workspaceId, { referenceMonth?, from?, to? })`

- Parametros: `workspace_id` (obrigatorio), `from`/`to` (opcionais, `YYYY-MM-DD`), `reference_month` (opcional, mantido para compatibilidade).
- Verifica propriedade do workspace via `verifyWorkspaceOwnership`.
- Consulta `financial_entries` filtrando por `workspace_id` e, quando informado, por faixa de `reference_month` (`gte`/`lte`). Sem faixa, cai no `reference_month` exato; sem nenhum dos dois, retorna tudo.
- Retorna: `[{ id, type, name, amount, reference_month }]`.

**POST /api/financial**

Service: `FinancialService.add(userId, body)`

- Campos obrigatorios: `workspace_id`, `type`, `name`, `reference_month`.
- Valida: `type` deve ser `expense` ou `revenue`; `amount` deve ser finito e positivo.
- Sanitiza: `name` e trimado; `amount` e convertido para numerico.
- Verifica propriedade do workspace.
- Insere em `financial_entries` com `user_id`.

**PATCH /api/financial/:id**

Service: `FinancialService.update(userId, id, workspaceId, { name?, amount? })`

- Pelo menos um campo (`name` ou `amount`) deve ser fornecido.
- Se `amount` fornecido, valida que e finito e positivo.
- Atualiza apenas os campos fornecidos.
- Filtro triplo: `id`, `workspace_id` e `user_id` (seguranca).

**DELETE /api/financial/:id**

Service: `FinancialService.remove(userId, id, workspaceId)`

- `workspace_id` via query param.
- Filtro triplo: `id`, `workspace_id` e `user_id`.

**POST /api/financial/import**

Service: `FinancialService.importEntries(userId, workspaceId, sourceMonth, targetMonth)`

- Busca todos os lancamentos do `sourceMonth` no workspace.
- Se nenhum encontrado, retorna mensagem informativa.
- Cria copias com mesmo `type`, `name` e `amount` mas com `reference_month = targetMonth`.
- Retorna array dos lancamentos importados.

**GET /api/financial/summary**

Controller: `FinancialController.getSummary()`
Service: `FinancialService.getSummary(userId, workspaceId, { referenceMonth?, from?, to? })`

- Parametros: `workspace_id` (obrigatorio), `from`/`to` (opcionais, `YYYY-MM-DD`), `reference_month` (opcional, compatibilidade), `target_user_id` (opcional, apenas admin impersonando).
- Precedencia: `from`/`to` vencem `reference_month`. Com `reference_month` sozinho, a faixa e derivada como o mes inteiro.
- Verifica propriedade do workspace via `verifyWorkspaceOwnership`.
- Quando a faixa e ilimitada (visao "Total"), `resolveAllTimeStart` busca o `sold_at` da primeira venda do workspace e usa essa data como inicio do gasto com ads, limitada a `FB_INSIGHTS_MAX_MONTHS` (36) meses atras. Sem isso, `aggregateAdSpend` usaria o default de 30 dias contra um faturamento all-time.
- Desde 2026-08-05 esse metodo vive em `LiveMetricsService`, nao aqui: o Dashboard ganhou o preset "Todo periodo" e precisa da mesma resolucao. Duas implementacoes fariam a mesma area mostrar dois lucros diferentes dependendo da tela em que se olha.
- Em paralelo (`Promise.all`): agrega o faturamento via RPC `dashboard_metrics` (`grossRevenue`), busca o spend via `LiveMetricsService.aggregateAdSpend` (`adSpend`) e le o percentual via `LiveMetricsService.getAdSpendTaxPercentage`. O imposto informado pelo usuario nao passa por aqui — vem de `financial_entries`.
- Retorna `{ grossRevenue, adSpend, adSpendTax, adSpendTaxPercentage }`. Nao retorna totais de despesas/receitas, custos da empresa, nem lucro — o frontend calcula esses agregados localmente a partir de `/financial` e `/integrations/company-costs`, aplicando a formula da regra RN01.

**Custos da Empresa (via IntegrationsController)**

- `GET /api/integrations/company-costs`: lista custos do usuario. Retorna array de `{ id, name, type, value }`.
- `POST /api/integrations/company-costs`: cria custo com `{ name, type, value }`.
- `DELETE /api/integrations/company-costs/:id`: remove custo.
- Custos sao globais por usuario, nao por workspace.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| Financial (pagina) | `src/pages/Financial.tsx` | Pagina principal com seletor de periodo, cards, lancamentos e grafico |
| Cards de resumo | Inline em Financial.tsx | Faturamento Bruto, Gasto com Ads, Imposto, Outros Gastos, Outras Receitas, Lucro |
| AdSpendTaxCard | `src/components/financial/AdSpendTaxCard.tsx` | Cadastro do percentual do imposto do Meta Ads, ao lado do grafico de composicao |
| ImpostoValueCard | `src/components/financial/ImpostoValueCard.tsx` | Card do imposto informado pelo usuario, ao lado do AdSpendTaxCard: input em reais, imagem e total do periodo |
| ImpostoIllustration | `src/components/financial/ImpostoIllustration.tsx` | Imagem (`public/imposto.webp`) dentro do ImpostoValueCard, removida silenciosamente se o arquivo faltar |
| financialPeriod | `src/lib/financialPeriod.ts` | Modelo do seletor: monta as opcoes e converte periodo em faixa `from`/`to` |
| Secao de lancamentos | Inline em Financial.tsx | Lista editavel de despesas e receitas com add/edit/remove |
| Secao de custos empresa | Inline em Financial.tsx | Configuracao de custos percentuais e fixos |
| Grafico evolucao lucro | Inline em Financial.tsx | Grafico de barras com tendencia dos ultimos 6 meses |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useFinancialEntries` | `src/hooks/useFinancialEntries.ts` | `{ entries, loading, addEntry, updateEntry, removeEntry, importFromMonth, refetch }` |
| `useFinancialSummary` | `src/hooks/useFinancialSummary.ts` | `{ grossRevenue, adSpend, adSpendTax, adSpendTaxPercentage, loading, refetch }` |
| `useUpdateAdSpendTax` | `src/hooks/useUpdateAdSpendTax.ts` | `{ saveTax(workspaceId, percentage), saving }` — chama PATCH `/workspaces/:id/ad-spend-tax` |
| `useCompanyCosts` | `src/hooks/useCompanyCosts.ts` | `{ costs, loading, addCost, removeCost }` |
| `useProfitEvolution` | `src/hooks/useProfitEvolution.ts` | `{ data: MonthlyProfit[], loading }` |

**useFinancialEntries(range):**
- Recebe `{ from?, to? }` e busca via `GET /api/financial?workspace_id=X&from=A&to=B`.
- Converte `amount` para `Number` apos receber do backend.
- `addEntry(type, name, amount, refMonth)`: POST para criar lancamento, exibe toast de sucesso/erro.
- `updateEntry(id, { name?, amount? })`: PATCH para atualizar, exibe toast.
- `removeEntry(id)`: DELETE para remover, exibe toast.
- `importFromMonth(sourceMonth, targetMonth)`: POST para importar, exibe toast com contagem.
- Usa `hasFetchedRef` para evitar fetch duplicado com mesmos parametros.

**useFinancialSummary(range):**
- Recebe `{ from?, to? }` e busca via `GET /api/financial/summary?workspace_id=X&from=A&to=B` (opcionalmente `target_user_id` quando admin impersonando).
- Response contem `{ grossRevenue, adSpend, adSpendTax, adSpendTaxPercentage }`. O imposto informado pelo usuario vem dos lancamentos tipo `tax`. Totais de despesas, receitas, custos da empresa e lucro sao calculados localmente no componente a partir de `useFinancialEntries` e `useCompanyCosts`.
- Usa `hasFetchedRef` para evitar fetch duplicado com os mesmos parametros.

**useCompanyCosts:**
- Busca via `GET /api/integrations/company-costs`.
- `addCost(name, type, value)`: POST para criar, exibe toast.
- `removeCost(id)`: DELETE para remover, exibe toast.
- Custos sao globais (nao filtrados por workspace).

**useProfitEvolution(numMonths = 6):**
- Gera lista dos ultimos N meses com `startOfMonth` e `endOfMonth`.
- Busca dados consolidados via `/metrics/dashboard` para todo o periodo.
- Busca lancamentos financeiros do workspace via `/financial`.
- Para cada mes, calcula:
  - `expenses`: soma de lancamentos tipo `expense` do mes.
  - `revenues`: soma de lancamentos tipo `revenue` do mes.
  - `companyCosts`: soma dos custos da empresa aplicados ao grossRevenue do mes.
  - `profit = grossRevenue - adSpend - expenses - companyCosts + revenues`.
- Formata nome do mes em portugues via `date-fns/locale/ptBR`.

### 6.3 Estado

| Estado | Tipo | Descricao |
|---|---|---|
| referenceMonth | string \| null | Mes selecionado no formato 'YYYY-MM-DD' |
| entries | FinancialEntry[] | Lancamentos do mes selecionado |
| grossRevenue | number | Faturamento bruto do mes |
| adSpend | number | Gasto com anuncios do mes |
| costs | CompanyCost[] | Custos recorrentes da empresa |
| profitData | MonthlyProfit[] | Dados de evolucao do lucro (6 meses) |

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Metrics/Dashboard API | Leitura | Fornece grossRevenue e adSpend para o mes selecionado |
| Vendas (sales) | Indireta | grossRevenue e calculado a partir de vendas aprovadas |
| Facebook Ads (daily_ad_spend) | Indireta | adSpend e calculado a partir do spend diario sincronizado |
| WorkspaceContext | Contexto | Fornece workspace_id, checkout_ids e product_names |
| ActiveConnectionContext | Contexto | Fornece connection_id para filtrar ad spend |
| ImpersonationContext | Contexto | Permite admin visualizar financeiro de outro usuario |
| AuthContext | Contexto | Fornece supabaseUser para requisicoes autenticadas |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Workspace sem lancamentos no mes | Secoes de despesas e receitas ficam vazias; totais exibem R$ 0,00 |
| Importacao de mes sem lancamentos | Retorna `{ data: [], message: "Nenhum lancamento encontrado no mes de origem" }` e exibe toast de aviso |
| Valor de lancamento zero ou negativo | Backend rejeita com `BadRequestException('amount invalido')` |
| Tipo de lancamento invalido | Backend rejeita com `BadRequestException('type invalido')` |
| Workspace nao pertence ao usuario | Backend retorna `ForbiddenException('Forbidden')` |
| Mes sem vendas (grossRevenue zero) | Custos percentuais resultam em zero; lucro reflete apenas custos fixos e lancamentos |
| Custo empresa com percentual > 100% | Permitido pelo sistema; pode resultar em lucro negativo |
| Nenhum custo empresa cadastrado | companyCosts = 0; lucro e Faturamento - AdSpend - Despesas + Receitas |
| Erro no fetch de summary | Console.error logado; dados exibem zero |
| Importacao duplicada | Lancamentos sao duplicados no mes destino; nao ha validacao de unicidade |

---

## 9. Checklist de Testes

- [ ] Verificar que cards exibem valores corretos para um mes com vendas e gastos
- [ ] Adicionar lancamento tipo `expense` e confirmar que aparece na lista e afeta o lucro
- [ ] Adicionar lancamento tipo `revenue` e confirmar impacto positivo no lucro
- [ ] Editar nome de um lancamento existente
- [ ] Editar valor de um lancamento existente
- [ ] Remover lancamento e confirmar que desaparece da lista e recalcula lucro
- [ ] Importar lancamentos do mes anterior para o mes atual
- [ ] Tentar importar de um mes sem lancamentos e verificar mensagem de aviso
- [ ] Adicionar custo empresa tipo `percentage` e verificar calculo sobre faturamento bruto
- [ ] Adicionar custo empresa tipo `fixed` e verificar que subtrai valor absoluto
- [ ] Remover custo empresa e confirmar recalculo
- [ ] Navegar entre meses e verificar que dados atualizam corretamente
- [ ] Verificar grafico de evolucao com dados de multiplos meses
- [ ] Testar com workspace sem integracoes: grossRevenue e adSpend devem ser zero
- [ ] Validar que lancamento com valor negativo e rejeitado
- [ ] Validar que lancamento com tipo invalido e rejeitado
- [ ] Testar verificacao de propriedade: usuario nao pode acessar workspace de outro

---

## 10. Questoes Abertas

| # | Questao | Contexto |
|---|---|---|
| Q01 | Custos empresa globais vs por workspace | Atualmente `company_costs` sao globais por usuario. Para usuarios com multiplos workspaces (negocios diferentes), os mesmos custos se aplicam a todos, o que pode nao refletir a realidade |
| Q02 | Importacao sem deduplicacao | Se o usuario importar o mesmo mes mais de uma vez, os lancamentos sao duplicados. Deveria haver validacao ou opcao de sobrescrever |
| Q03 | Faturamento liquido | O P&L nao diferencia entre faturamento bruto e liquido (apos taxas da plataforma). O valor de `amount` na venda pode ja ser o liquido ou bruto dependendo da plataforma |
| Q04 | Custos por mes | `company_costs` nao tem referencia a mes; sao aplicados igualmente a todos os meses. Custos que variam por mes (ex: contratacao temporaria) exigem lancamento manual |
| Q05 | Moeda | Todo o financeiro assume BRL. Para usuarios com vendas em USD ou EUR, a conversao nao e tratada |
