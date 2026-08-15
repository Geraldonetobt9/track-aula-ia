# Automation Rules — Design Spec

**Date**: 2026-04-01
**Status**: Approved
**Feature**: Regras automatizadas para campanhas Facebook Ads

---

## 1. Objetivo

Permitir que usuários criem regras automatizadas por workspace para executar ações em campanhas, conjuntos de anúncios e anúncios do Facebook com base em condições de métricas avaliadas ao vivo. As ações incluem: ativar, pausar, aumentar orçamento e diminuir orçamento.

## 2. Decisões de Design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Fonte de métricas | Fetch ao vivo (Facebook API) | Dados frescos no momento da avaliação |
| Arquitetura do scheduler | Cron no NestJS (`@nestjs/schedule`) | Reutiliza infraestrutura existente, sem Redis |
| Multi-instance safety | `pg_try_advisory_lock` | Evita execução duplicada sem infra extra |
| Lógica entre condições | AND (todas devem ser verdadeiras) | Simplicidade e previsibilidade |
| Ação de duplicar | Excluída | Risco de criação descontrolada |
| Notificações | Log na plataforma + Discord webhook | Usa sistema de Discord logs existente |
| Limite por plano | Por regras ativas (não criadas) | Flexibilidade — usuário pode ter N inativas |
| Período personalizado | Data de início fixa → dia atual | Janela deslizante automática |
| Fuso horário | America/Sao_Paulo | Todos os usuários são brasileiros |

## 3. Modelo de Dados

### 3.1 Tabela `automation_rules`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid PK | Identificador único |
| `workspace_id` | uuid FK → workspaces | Partição por workspace |
| `name` | text NOT NULL | Nome da regra |
| `is_active` | boolean DEFAULT false | Ativa/inativa (limite por plano conta apenas ativas) |
| `connection_id` | uuid FK → facebook_connections NULL | NULL = todas as contas de anúncio |
| `target_entity` | text NOT NULL | `campaign`, `adset`, ou `ad` |
| `target_status` | text NOT NULL | `active`, `paused`, ou `any` |
| `name_filter` | text NULL | Filtro por nome (ILIKE `%valor%` — contém) |
| `action_type` | text NOT NULL | `activate`, `pause`, `increase_budget`, `decrease_budget` |
| `budget_adjustment` | jsonb NULL | Config de orçamento (ver 3.1.1) |
| `evaluation_period` | text NOT NULL | `today`, `yesterday`, `last_7d`, `last_30d`, `custom` |
| `custom_start_date` | date NULL | Data de início fixa (quando period = custom). Fim = dia atual |
| `frequency_minutes` | int NOT NULL | 10, 15, 30, 60, 120, 180, 360, 1440 |
| `daily_run_time` | time NULL | Horário de execução (quando frequency = 1440). Fuso: America/Sao_Paulo |
| `last_executed_at` | timestamptz NULL | Timestamp da última execução |
| `created_at` | timestamptz DEFAULT now() | |
| `updated_at` | timestamptz DEFAULT now() | |

#### 3.1.1 Schema de `budget_adjustment` (JSONB)

```json
{
  "mode": "percentage" | "fixed",
  "value": 20,
  "budget_type": "daily" | "lifetime",
  "min_budget": 50.00,
  "max_budget": 1000.00
}
```

- `mode: "percentage"` — valor é percentual (ex: 20 = +20% ou -20%)
- `mode: "fixed"` — valor é o novo orçamento em BRL (ex: 500.00)
- `min_budget` / `max_budget` — limites de segurança opcionais (NULL = sem limite)

### 3.2 Tabela `automation_rule_conditions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid PK | |
| `rule_id` | uuid FK → automation_rules ON DELETE CASCADE | |
| `metric` | text NOT NULL | `spend`, `cpa`, `roi`, `roas`, `profit`, `profit_margin`, `cpc`, `ctr`, `cpm`, `impressions`, `clicks`, `conversions` |
| `operator` | text NOT NULL | `gt`, `lt`, `gte`, `lte` |
| `value` | numeric NOT NULL | Valor de referência |

Lógica: todas as condições de uma regra devem ser verdadeiras (AND).

### 3.3 Tabela `automation_rule_executions`

| Coluna | Tipo | Descrição |
|--------|------|-----------|
| `id` | uuid PK | |
| `rule_id` | uuid FK → automation_rules ON DELETE CASCADE | |
| `workspace_id` | uuid FK → workspaces | Denormalizado para queries rápidas |
| `entity_facebook_id` | text NOT NULL | ID do Facebook da entidade afetada |
| `entity_name` | text | Nome da campanha/conjunto/anúncio |
| `action_taken` | text NOT NULL | Ex: `paused`, `activated`, `budget_increased_20%`, `budget_set_500` |
| `metrics_snapshot` | jsonb NOT NULL | Snapshot de todas as métricas no momento da execução |
| `status` | text NOT NULL | `success` ou `error` |
| `error_message` | text NULL | Detalhes do erro (se houver) |
| `executed_at` | timestamptz DEFAULT now() | |

### 3.4 Indexes

```sql
-- Buscar regras ativas por workspace
CREATE INDEX idx_automation_rules_workspace_active
  ON automation_rules (workspace_id, is_active);

-- Scheduler: encontrar regras prontas para execução
CREATE INDEX idx_automation_rules_active_last_exec
  ON automation_rules (is_active, last_executed_at)
  WHERE is_active = true;

-- Join rápido de condições
CREATE INDEX idx_automation_rule_conditions_rule
  ON automation_rule_conditions (rule_id);

-- Histórico por regra
CREATE INDEX idx_automation_rule_executions_rule_date
  ON automation_rule_executions (rule_id, executed_at DESC);

-- Histórico por workspace
CREATE INDEX idx_automation_rule_executions_workspace_date
  ON automation_rule_executions (workspace_id, executed_at DESC);

-- BRIN para tabela append-only
CREATE INDEX idx_automation_rule_executions_brin
  ON automation_rule_executions USING BRIN (executed_at);
```

### 3.5 RLS Policies

```sql
-- automation_rules: workspace-scoped
CREATE POLICY "workspace_rules" ON automation_rules TO authenticated
  USING (workspace_id IN (
    SELECT id FROM workspaces WHERE user_id = (SELECT auth.uid())
  ));

-- automation_rule_conditions: via rule_id join
CREATE POLICY "workspace_conditions" ON automation_rule_conditions TO authenticated
  USING (rule_id IN (
    SELECT id FROM automation_rules WHERE workspace_id IN (
      SELECT id FROM workspaces WHERE user_id = (SELECT auth.uid())
    )
  ));

-- automation_rule_executions: workspace-scoped (read-only para usuário)
CREATE POLICY "workspace_executions" ON automation_rule_executions TO authenticated
  USING (workspace_id IN (
    SELECT id FROM workspaces WHERE user_id = (SELECT auth.uid())
  ));
```

### 3.6 Alteração em `plan_rules`

```sql
ALTER TABLE plan_rules ADD COLUMN max_active_rules int DEFAULT 0;

-- Seed dos limites por plano
UPDATE plan_rules SET max_active_rules = 0  WHERE plan_id = 'aa410a04-a399-400e-ad1c-1ca7f75ccfeb'; -- free
UPDATE plan_rules SET max_active_rules = 3  WHERE plan_id = '29a4ba19-f691-4ceb-894f-19601ea60b17'; -- starter
UPDATE plan_rules SET max_active_rules = 7  WHERE plan_id = 'bd669e8b-eac6-494e-86dd-5e639a8ee182'; -- pro
UPDATE plan_rules SET max_active_rules = NULL WHERE plan_id = '1b17c43a-be5f-475f-996c-95a228af4d49'; -- enterprise (ilimitado)
```

## 4. Arquitetura Backend

### 4.1 Estrutura do Módulo

```
packages/backend/src/modules/automation-rules/
├── automation-rules.module.ts       — NestJS module, imports ScheduleModule
├── automation-rules.controller.ts   — CRUD de regras (REST)
├── automation-rules.service.ts      — Lógica de negócio (criar, editar, ativar/desativar)
├── rule-scheduler.service.ts        — Cron job que roda a cada minuto
├── rule-evaluator.service.ts        — Busca métricas ao vivo, avalia condições
├── rule-executor.service.ts         — Executa ações (pause, activate, budget)
├── rule-notifier.service.ts         — Discord webhook + salva log de execução
└── dto/
    ├── create-rule.dto.ts
    ├── update-rule.dto.ts
    └── rule-response.dto.ts
```

### 4.2 Responsabilidades dos Services

**AutomationRulesService**
- CRUD de regras + condições (transação: regra + condições juntas)
- Validação de limite do plano no toggle (conta regras ativas do workspace vs. `max_active_rules`)
- Rejeita toggle com 403 se limite excedido

**RuleSchedulerService**
- `@Cron('* * * * *')` — roda a cada 1 minuto
- Adquire `pg_try_advisory_lock(hash)` — pula ciclo se lock não adquirido
- Query: regras ativas onde `(now() - last_executed_at) >= frequency_minutes`
- Para `frequency_minutes = 1440`: verifica se `daily_run_time` (convertido de America/Sao_Paulo para UTC) já passou hoje e não executou
- Orquestra: evaluator → executor → notifier
- Atualiza `last_executed_at` após execução
- Libera lock ao final

**RuleEvaluatorService**
- Usa `LiveMetricsService` para fetch ao vivo na Facebook API
- Aplica filtros: `connection_id`, `target_status`, `name_filter` (ILIKE)
- Calcula período de datas baseado em `evaluation_period` / `custom_start_date`
- Para cada entidade, avalia todas as condições (AND)
- Retorna lista de entidades que passaram em todas as condições, com snapshot de métricas

**RuleExecutorService**
- Chama `FacebookService` existente para executar ações:
  - `activate` / `pause` → `patchStatus()`
  - `increase_budget` / `decrease_budget` → calcula novo valor, aplica min/max, chama `patchBudget()`
- `Promise.allSettled` para múltiplas entidades em paralelo
- Retorna resultados por entidade (success/error)

**RuleNotifierService**
- Insere registros em `automation_rule_executions` (batch insert)
- Envia mensagem formatada via Discord webhook (`DISCORD_RULES_WEBHOOK_URL`)
- Mensagem inclui: nome da regra, workspace, entidades afetadas, ação tomada, métricas, status

### 4.3 API Endpoints

| Método | Rota | Descrição |
|--------|------|-----------|
| `GET` | `/api/automation-rules` | Listar regras do workspace |
| `POST` | `/api/automation-rules` | Criar regra (com condições) |
| `PATCH` | `/api/automation-rules/:id` | Editar regra |
| `DELETE` | `/api/automation-rules/:id` | Excluir regra |
| `PATCH` | `/api/automation-rules/:id/toggle` | Ativar/desativar (valida limite do plano) |
| `GET` | `/api/automation-rules/:id/history` | Histórico de execuções (paginação por cursor) |

Todos os endpoints requerem `AuthGuard` + `workspace_id` no header/query.

### 4.4 Dependências do Módulo

```typescript
@Module({
  imports: [
    ScheduleModule.forRoot(),
    FacebookModule,
    MetricsModule,
    PlansModule,
    SharedModule,
  ],
  controllers: [AutomationRulesController],
  providers: [
    AutomationRulesService,
    RuleSchedulerService,
    RuleEvaluatorService,
    RuleExecutorService,
    RuleNotifierService,
  ],
})
export class AutomationRulesModule {}
```

## 5. Frontend

### 5.1 Páginas e Componentes

```
packages/frontend/src/
├── pages/
│   └── Rules.tsx                              — Página principal (lazy-loaded)
├── components/rules/
│   ├── RulesList.tsx                          — Lista de cards + header com contador
│   ├── RuleCard.tsx                           — Card individual com toggle e ações
│   ├── RuleFormModal.tsx                      — Modal de criar/editar regra
│   ├── ConditionBuilder.tsx                   — Adicionar/remover condições (métrica + operador + valor)
│   ├── BudgetConfig.tsx                       — Config de orçamento (condicional)
│   └── RuleHistoryDrawer.tsx                  — Drawer com histórico de execuções
├── hooks/
│   ├── useAutomationRules.ts                  — CRUD + toggle + listagem
│   └── useRuleHistory.ts                      — Histórico paginado por cursor
```

### 5.2 Página de Listagem (`/rules`)

- Header: título + contador "X de Y regras ativas (Plano Z)" + botão "+ Nova Regra"
- Cards por regra com:
  - Nome + badge de status (Ativa/Inativa)
  - Resumo: target, frequência, ação, condições
  - Última execução + resultado
  - Toggle (ativa/desativa, valida limite do plano)
  - Ícones de ação: Pencil (editar), ClipboardList (histórico), Trash2 (excluir) — Lucide React
- Regras inativas: opacity reduzida, border-left cinza
- Regras ativas: border-left verde

### 5.3 Modal de Criação/Edição

Campos do formulário:

1. **Nome da regra** — text input
2. **Conta de Anúncio** — select (Todas / lista de connections do workspace)
3. **Aplicar regra a** — select combinando entity + status:
   - Campanhas Ativas / Campanhas Pausadas / Campanhas (Qualquer)
   - Conjuntos Ativos / Conjuntos Pausados / Conjuntos (Qualquer)
   - Anúncios Ativos / Anúncios Pausados / Anúncios (Qualquer)
4. **Filtrar por nome** — text input (vazio = qualquer)
5. **Ação** — select: Ativar / Pausar / Aumentar orçamento / Diminuir orçamento
6. **Configuração de orçamento** (visível quando ação = aumentar/diminuir):
   - Modo: Porcentagem / Valor fixo
   - Valor: number input
   - Tipo de orçamento: Diário / Vitalício
   - Orçamento mínimo (R$): number input (opcional)
   - Orçamento máximo (R$): number input (opcional)
7. **Condições** — condition builder:
   - Métrica: spend, cpa, roi, roas, profit, profit_margin, cpc, ctr, cpm, impressions, clicks, conversions
   - Operador: Maior que / Menor que / Maior ou igual a / Menor ou igual a
   - Valor: number input
   - Botão confirmar + botão remover por condição
   - Botão "+ Adicionar condição"
8. **Período de Cálculo** — select: Hoje / Ontem / Últimos 7 dias / Últimos 30 dias / Personalizado
   - Personalizado: date picker para data de início (fim = dia atual da execução)
9. **Frequência** — select: A cada 10 min / 15 min / 30 min / 1 hora / 2 horas / 3 horas / 6 horas / Uma vez por dia
10. **Horário** (visível quando frequência = Uma vez por dia) — time picker, fuso America/Sao_Paulo

### 5.4 Drawer de Histórico

- Lista de execuções por regra
- Cada item mostra: nome da entidade, ação tomada, métricas no momento, status (sucesso/erro com cor), timestamp
- Paginação por cursor ("Carregar mais...")
- Erro mostra `error_message`

### 5.5 Routing e Sidebar

- Rota: `/rules` — lazy-loaded com `React.lazy()` + `Suspense`
- Sidebar: nova entrada "Regras" entre "Campanhas" e "Financeiro"
- Plano free: entrada no sidebar desabilitada com tooltip "Disponível no plano Starter"

### 5.6 TanStack Query Config

```typescript
// useAutomationRules — regras mudam por ação do usuário, não por polling
{ staleTime: 30 * 1000 }

// useRuleHistory — dados históricos, pode ser mais agressivo
{ staleTime: 60 * 1000 }
```

## 6. Error Handling

- **Scheduler resilience**: `Promise.allSettled` por regra — uma regra falhando não afeta as demais
- **Facebook API rate limit**: erro registrado em `automation_rule_executions` com `status = 'error'`. Próxima execução agendada tenta novamente naturalmente.
- **Advisory lock timeout**: se lock não adquirido, ciclo atual é pulado (outra instância processando)
- **Validação no toggle**: 403 com mensagem clara se limite do plano excedido
- **RLS**: todas as tabelas com policies workspace-scoped
- **Input validation**: DTOs com `class-validator` em todos os endpoints
- **Discord webhook failure**: falha silenciosa (log interno), não impede a execução da regra

## 7. Notificações Discord

Variável de ambiente: `DISCORD_RULES_WEBHOOK_URL`

Formato da mensagem:
```
📋 Regra Executada: {nome_da_regra}
🏢 Workspace: {workspace_name}
🎯 Entidades afetadas: {count}

✅ Campanha "Nome da Campanha" — Pausada
   ROAS: 0.8 | Gasto: R$ 127,50

❌ Campanha "Outra Campanha" — Erro
   Facebook API rate limit exceeded
```

## 8. Limites por Plano

| Plano | ID | Regras Ativas |
|-------|-----|---------------|
| Free | `aa410a04-a399-400e-ad1c-1ca7f75ccfeb` | 0 (sem acesso) |
| Starter | `29a4ba19-f691-4ceb-894f-19601ea60b17` | 3 |
| Pro | `bd669e8b-eac6-494e-86dd-5e639a8ee182` | 7 |
| Enterprise | `1b17c43a-be5f-475f-996c-95a228af4d49` | NULL (ilimitado) |

O limite é por regras **ativas**, não criadas. O usuário pode ter N regras cadastradas e ativar/desativar conforme o limite do plano.

## 9. Testing

### Backend Unit Tests
- `RuleEvaluatorService`: avaliação de condições AND com diferentes métricas e operadores
- `RuleExecutorService`: cálculo de budget (porcentagem/fixo) com min/max limits
- `AutomationRulesService`: validação de limite de plano no toggle

### Backend Integration Tests
- Fluxo completo: scheduler → evaluator → executor → notifier (com mocks do FacebookService)
- Advisory lock behavior com execuções concorrentes

### Frontend Tests
- `RuleFormModal`: validação de campos obrigatórios, campos condicionais (budget config, horário)
- `ConditionBuilder`: adicionar/remover condições, validação de valores

## 10. Frequências de Execução

| Label | `frequency_minutes` |
|-------|-------------------|
| A cada 10 minutos | 10 |
| A cada 15 minutos | 15 |
| A cada 30 minutos | 30 |
| A cada 1 hora | 60 |
| A cada 2 horas | 120 |
| A cada 3 horas | 180 |
| A cada 6 horas | 360 |
| Uma vez por dia | 1440 |

Quando `frequency_minutes = 1440`, o campo `daily_run_time` é obrigatório. O fuso horário é sempre America/Sao_Paulo.

## 11. Métricas Disponíveis para Condições

| Métrica | Chave | Unidade |
|---------|-------|---------|
| Gasto | `spend` | R$ |
| CPA (Custo por Aquisição) | `cpa` | R$ |
| ROI (Retorno sobre Investimento) | `roi` | multiplicador |
| ROAS (Retorno sobre Gasto em Anúncios) | `roas` | multiplicador |
| Lucro | `profit` | R$ |
| Margem de Lucro | `profit_margin` | % |
| CPC (Custo por Clique) | `cpc` | R$ |
| CTR (Taxa de Cliques) | `ctr` | % |
| CPM (Custo por Mil Impressões) | `cpm` | R$ |
| Impressões | `impressions` | número |
| Cliques | `clicks` | número |
| Conversões | `conversions` | número |
