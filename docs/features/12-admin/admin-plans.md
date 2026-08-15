# Gestao de Planos (Admin Plans)

> **Modulo:** `packages/backend/src/modules/plans/plans.service.ts` | **Pagina:** `src/pages/admin/AdminPlans.tsx`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Aprovado

---

## 1. Proposito

A pagina de gestao de planos permite aos administradores visualizar e editar as regras de todos os planos da plataforma Sentinela (free, starter, pro, enterprise, unlimited). O admin pode ajustar limites numericos (campanhas, vendas, integracoes, contas de anuncio, workspaces, intervalo de sync) e habilitar/desabilitar feature gates (globo de vendas, relatorios avancados, funil de conversao, auto-sync, acesso a API). As alteracoes afetam imediatamente todos os usuarios do plano modificado.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Sidebar Admin `/admin/plans` | Link "Planos" na area administrativa |

### 2.2 Fluxo de UI

1. Admin acessa `/admin/plans`.
2. O hook `useAdminPlans` busca regras de todos os planos via `GET /api/plans/rules`.
3. A pagina exibe um grid de cards (mesmo padrao visual da aba "Plano" em `/settings`), um por plano (`free`, `pro`, `starter`, `enterprise`, `unlimited`), em modo somente leitura. Cada card mostra:
   - Nome, tagline e preco-base do plano (catalogo fixo no frontend, paridade com `CurrentPlanCard`).
   - Badge "Mais popular" no `starter` e "Custom" no `unlimited`.
   - Lista de limites com icones `Check`/`Infinity` (formato "X vendas aprovadas/mes", "Ilimitado" quando o valor e `-1`).
   - Linha de overage (`+ R$ X,XX por venda extra`) quando `overage_price_cents > 0`.
   - Botao "Editar regras" no rodape do card.
4. Ao clicar em "Editar regras", abre o `EditPlanRulesDialog` (`packages/frontend/src/components/admin/EditPlanRulesDialog.tsx`):
   - Cada limite e renderizado como um bloco com label, helper, `Input type="number"` e um switch "Ilimitado". Ligar o switch fixa o valor em `-1` e desabilita o input; desligar volta para um valor numerico (default `0`).
   - Campo de overage com mascara em reais (prefixo "R$" e formato `0,00`).
   - Cada bloco com mudanca em relacao ao valor original ganha realce ambar e exibe o diff inline (`<antigo> → <novo>`).
   - Rodape com pill "N alteracoes nao salvas" quando ha diff, ou "Sem alteracoes" quando o form esta limpo.
   - Botao "Salvar alteracoes" desabilitado enquanto nao houver diff.
   - Botao "Cancelar" (e fechar via overlay/ESC) abre `AlertDialog` de confirmacao se houver alteracoes nao salvas.
5. Ao salvar, o hook chama `PATCH /api/plans/rules/:plan` apenas com os campos alterados.
6. O backend valida via `UpdatePlanDto` (whitelist + ranges) e atualiza o registro.
7. Toast de sucesso (`Plano X atualizado`) ou erro (`Erro ao salvar regras`) e exibido.
8. A lista e recarregada automaticamente via invalidacao de cache `['admin-plan-rules']` e o dialog e fechado.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Visualizar regras de planos | Somente admin |
| Editar regras de planos | Somente admin |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Listar todos os planos | `GET /api/plans/rules` | Retorna array com regras dos 5 planos ordenados por `plan` |
| RN-02 | Whitelist de campos | PATCH com campos arbitrarios | Apenas campos em `ALLOWED_FIELDS` sao processados |
| RN-03 | Campos permitidos (numericos) | `max_campaigns`, `max_sales`, `max_checkout_integrations`, `max_ad_accounts`, `max_workspaces`, `sync_interval_minutes` | Aceitos no update |
| RN-04 | Campos permitidos (features) | `feature_sales_globe`, `feature_advanced_reports`, `feature_conversion_funnel`, `feature_auto_sync`, `feature_api_access` | Aceitos no update |
| RN-05 | Campos nao permitidos | `id`, `plan`, `created_at`, ou qualquer outro | Silenciosamente ignorados (nao lanca erro) |
| RN-06 | Timestamp automatico | Qualquer PATCH | `updated_at` e definido como `new Date().toISOString()` |
| RN-07 | Validacao de entrada | `plan` ou `updates` ausentes | `BadRequestException` "plan and updates required" |
| RN-08 | Valor -1 | Campo numerico com valor -1 | Significa "ilimitado" no sistema |
| RN-09 | Efeito imediato | PATCH bem-sucedido | Todos os usuarios do plano afetado passam a respeitar as novas regras na proxima verificacao |

---

## 4. Modelo de Dados

### 4.1 Tabelas Principais

#### `plan_rules`

| Coluna | Tipo | Editavel pelo Admin | Descricao |
|---|---|---|---|
| id | UUID | Nao | Chave primaria |
| plan | TEXT | Nao | Nome do plano (imutavel) |
| max_campaigns | INTEGER | Sim | Limite de campanhas |
| max_sales | INTEGER | Sim | Limite de vendas |
| max_checkout_integrations | INTEGER | Sim | Limite de integracoes de checkout |
| max_ad_accounts | INTEGER | Sim | Limite de contas de anuncio |
| max_workspaces | INTEGER | Sim | Limite de workspaces |
| sync_interval_minutes | INTEGER | Sim | Intervalo minimo de sync |
| feature_sales_globe | BOOLEAN | Sim | Globo de vendas |
| feature_advanced_reports | BOOLEAN | Sim | Relatorios avancados |
| feature_conversion_funnel | BOOLEAN | Sim | Funil de conversao |
| feature_auto_sync | BOOLEAN | Sim | Sincronizacao automatica |
| feature_api_access | BOOLEAN | Sim | Acesso a API |
| updated_at | TIMESTAMPTZ | Auto | Atualizado automaticamente |

### 4.2 Relacionamentos

```
profiles.plan_id -> plan_rules(id)
```

### 4.3 Constraints e Defaults

- `plan` UNIQUE: cada plano tem exatamente um registro
- `id` e `plan` nao sao editaveis (excluidos pela whitelist)
- `updated_at` e sempre atualizado pelo service

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | `/api/plans/rules` | JWT | Lista regras de todos os planos |
| PATCH | `/api/plans/rules/:plan` | JWT + Admin | Atualiza regras de um plano |

### 5.2 Logica do Service

**PlansService.list()**
- `SELECT * FROM plan_rules ORDER BY plan`
- Retorna array com todos os planos e suas regras.

**PlansService.update(plan, updates)**

1. Valida que `plan` e `updates` estao presentes.
2. Inicializa `safeUpdates` com `updated_at: now()`.
3. Itera sobre `ALLOWED_FIELDS`:
   ```typescript
   const ALLOWED_FIELDS = [
     'max_campaigns', 'max_sales', 'max_checkout_integrations',
     'max_ad_accounts', 'max_workspaces', 'sync_interval_minutes',
     'feature_sales_globe', 'feature_advanced_reports',
     'feature_conversion_funnel', 'feature_auto_sync', 'feature_api_access',
   ];
   ```
4. Para cada campo da whitelist presente em `updates`, copia para `safeUpdates`.
5. Executa `UPDATE plan_rules SET safeUpdates WHERE plan = :plan`.
6. Retorna `{ success: true }`.

---

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| AdminPlans | `src/pages/admin/AdminPlans.tsx` | Pagina com grid de cards somente leitura, abre dialog de edicao por plano |
| EditPlanRulesDialog | `src/components/admin/EditPlanRulesDialog.tsx` | Dialog de edicao com toggles "Ilimitado", diff inline, indicador de alteracoes nao salvas e confirmacao ao descartar |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useAdminPlans` | `src/hooks/useAdminPlans.ts` | `{ planRules, isLoading, updatePlanRules, isUpdating }` |

**useAdminPlans:**
- Busca `GET /api/plans/rules` via TanStack Query.
- Cache key: `['admin-plan-rules']`.
- `updatePlanRules(plan, updates)` executa `PATCH /api/plans/rules/:plan` via mutation.
- Apos sucesso, invalida cache `['admin-plan-rules']` automaticamente.
- `isUpdating` indica se uma atualizacao esta em andamento.

### 6.3 Gerenciamento de Estado

| Estado | Tipo | Descricao |
|---|---|---|
| `planRules` | PlanRules[] | Array com regras de todos os planos |
| `isLoading` | boolean | Indica carregamento inicial |
| `isUpdating` | boolean | Indica atualizacao em andamento |

**Cache key:** `['admin-plan-rules']`

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| usePlanRules (usuarios) | Leitura | Hook dos usuarios finais que consulta regras do seu plano |
| profiles.plan_id | FK | Vincula cada usuario a um plano |
| Sync Schedule | Enforcement | `sync_interval_minutes` define frequencia do auto-sync |
| Feature Gates | UI | `feature_*` controlam visibilidade de componentes |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| Plan ou updates ausentes | `BadRequestException` "plan and updates required" |
| Campo nao permitido enviado | Silenciosamente ignorado; nao causa erro |
| Plano inexistente no PATCH | UPDATE nao encontra registro; retorna `{ success: true }` sem alterar nada |
| Valor numerico negativo (exceto -1) | Aceito pelo service; validacao de negocio deve ser feita no frontend |
| Erro no Supabase | Excecao propagada ao controller |
| Cache desatualizado no frontend | Invalidacao automatica via `onSuccess` da mutation |

---

## 9. Checklist de Testes

- [ ] Verificar que `GET /api/plans/rules` retorna os 5 planos
- [ ] Testar PATCH com campo numerico (ex: `max_campaigns = 50`)
- [ ] Testar PATCH com feature toggle (ex: `feature_auto_sync = true`)
- [ ] Verificar que campos fora da whitelist sao ignorados
- [ ] Testar PATCH sem `plan` (deve lancar BadRequestException)
- [ ] Testar PATCH sem `updates` (deve lancar BadRequestException)
- [ ] Confirmar que `updated_at` e atualizado automaticamente
- [ ] Verificar que alteracao afeta usuarios do plano (via `usePlanRules`)
- [ ] Testar invalidacao de cache `['admin-plan-rules']` apos PATCH
- [ ] Testar edicao de cada um dos 11 campos permitidos
- [ ] Verificar que `id` e `plan` nao podem ser alterados
- [ ] Confirmar que somente admins acessam o endpoint PATCH

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Validacao de valores | O backend aceita qualquer valor numerico (inclusive negativos exceto -1). Deveria validar ranges razoaveis |
| Q02 | Preview de impacto | Antes de salvar, seria util exibir quantos usuarios serao afetados pela mudanca |
| Q03 | Historico de alteracoes | Nao ha log de quando e quem alterou as regras de plano |
| Q04 | Confirmacao de downgrade | Se o admin reduz um limite, usuarios que ja excedem o novo limite nao sao notificados |
| Q05 | Plano "unlimited" | O plano unlimited nao aparece no mapeamento padrao de `usersByPlan` no dashboard admin |
