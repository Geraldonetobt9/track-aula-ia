# Financial API Slim Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduzir a superfície de resposta da API Financeira (`/financial/summary` e `/integrations/company-costs`) para devolver apenas os campos que o frontend realmente consome, eliminando queries desnecessárias, cálculos em memória redundantes e payload morto.

**Architecture:** Refatoração cirúrgica em dois pontos — `FinancialService.getSummary` passa a retornar apenas `{ grossRevenue, adSpend }` (remove 3 queries secundárias e 4 somas em memória), e `IntegrationsService.listCompanyCosts` deixa de selecionar colunas que o front ignora. O frontend não precisa de alterações funcionais (os tipos atuais já descrevem apenas os campos consumidos), mas a documentação é atualizada para refletir o contrato enxuto.

**Tech Stack:** NestJS 10, Fastify, Supabase PostgreSQL (via `@supabase/supabase-js`), Jest (para testes), frontend React/TypeScript consumidor (sem mudanças de lógica).

---

## Contexto da Análise

### O que o frontend usa hoje (rota `/financial`)

| Endpoint | Campos consumidos pelo UI |
|---|---|
| `GET /financial?workspace_id&reference_month?` | `id`, `type`, `name`, `amount`, `reference_month` (todos usados — `id` em keys/CRUD, `type` pra separar despesa/receita, `name`/`amount` em display+edição, `reference_month` trafega mas não é exibido) |
| `GET /financial/summary?workspace_id&reference_month?&target_user_id?` | **apenas `grossRevenue` e `adSpend`** — veja `useFinancialSummary.ts:38-41` |
| `GET /integrations/company-costs?workspace_id` | `id`, `name`, `type`, `value` — veja `useCompanyCosts.ts:28-35` |
| `POST/PATCH/DELETE /financial`, `POST /financial/import` | CRUD; response seguem shape de `FinancialEntry` |

### O que o backend devolve hoje e é ignorado

**`GET /financial/summary`** (em `financial.service.ts:141-151`) retorna 9 campos. O hook `useFinancialSummary` descarta 7:

```ts
// financial.service.ts:141-151 — retorno atual
return {
  grossRevenue,          // ✅ usado
  adSpend,               // ✅ usado
  totalExpenses,         // ❌ frontend recalcula via /financial
  totalRevenues,         // ❌ frontend recalcula via /financial
  companyCosts,          // ❌ frontend recalcula via /integrations/company-costs
  profit,                // ❌ frontend recalcula
  expenses,              // ❌ redundante com /financial
  revenues,              // ❌ redundante com /financial
  companyCostsList,      // ❌ redundante com /integrations/company-costs
};
```

Além do payload morto, há custo computacional desperdiçado:
- 2 queries extras ao banco (`financial_entries`, `company_costs`)
- 2 loops de `reduce` + 2 `filter` + 1 map de normalização sobre `entries`
- 1 loop de `reduce` sobre `costs` aplicando regra percentual
- Uma soma final de `profit`

O frontend já faz todas essas contas — estão duplicadas em `Financial.tsx:55-63`.

**`GET /integrations/company-costs`** (em `integrations.service.ts:109`) seleciona `id, user_id, name, type, value, created_at`. O hook `useCompanyCosts` só consome `id, name, type, value` — `user_id` e `created_at` trafegam sem uso.

### Estratégia de otimização

1. `getSummary` passa a executar apenas 2 operações em paralelo: `buildSalesQuery()` e `fetchAdSpend()`. Retorna `{ grossRevenue, adSpend }`.
2. `listCompanyCosts` seleciona apenas `id, name, type, value`.
3. Documentação em `docs/features/06-financial/financial.md` é atualizada para refletir o novo contrato de `/summary`.

### Ganhos esperados

- **Payload**: `/financial/summary` sai de ~9 campos (incluindo 3 arrays que podem ter dezenas de itens) para 2 números. Em workspaces com 30+ entries e 10+ custos, redução típica de 80–95% do corpo da resposta.
- **Banco**: 2 queries a menos por chamada de `/summary`. Como o summary é refetch a cada troca de mês no dropdown, isso corta latência visível para o usuário.
- **Código**: ~35 linhas a menos em `financial.service.ts`, lógica mais focada (single responsibility).

### Risco e mitigação

- **Quebra de clientes ocultos**: um grep em `packages/frontend/src` confirma que `totalExpenses`, `totalRevenues`, `companyCostsList`, `profit`, `expenses`, `revenues` em resposta de `/summary` não são lidos em nenhum lugar — o único consumidor é `useFinancialSummary.ts` que já extrai apenas os dois campos. Mesmo assim, Task 0 faz a verificação final antes de remover.
- **Impersonation (admin)**: o parâmetro `target_user_id` continua funcionando — a assinatura não muda.
- **Cache TanStack**: o hook usa `useState` manual (não TanStack Query), então não há chave de cache a invalidar.

---

## File Structure

Arquivos modificados (nenhum arquivo novo; nenhum removido):

- **Modify**: `packages/backend/src/modules/financial/financial.service.ts` — enxuga `getSummary` (linhas 38-152).
- **Modify**: `packages/backend/src/modules/integrations/integrations.service.ts` — enxuga `listCompanyCosts` (linha 109).
- **Create**: `packages/backend/src/modules/financial/__tests__/financial.service.spec.ts` — testes de contrato para o novo shape de `getSummary`.
- **Modify**: `docs/features/06-financial/financial.md` — atualiza seção "API/Backend" com o contrato enxuto.

Arquivos de frontend **não precisam mudar**: `useFinancialSummary.ts` já só lê `grossRevenue`/`adSpend`, e `useCompanyCosts.ts` já só lê os 4 campos remanescentes. A interface `FinancialSummaryData` do hook já está enxuta. Confirmado pelas Tasks 0 e 5.

---

### Task 0: Verificação final de consumidores ocultos

Antes de remover qualquer campo, comprovar por grep que nenhum componente/hook/teste depende dos campos que vão sumir.

**Files:**
- Read-only: todo `packages/frontend/src/` e `packages/backend/src/`

- [ ] **Step 1: Checar consumidores de cada campo removido do summary**

Rodar, na raiz do repo:

```bash
grep -rn "totalExpenses\|totalRevenues\|companyCostsList\|companyCosts\b" packages/frontend/src/hooks/useFinancialSummary.ts packages/frontend/src/pages/Financial.tsx
grep -rn "\.profit\|\.expenses\|\.revenues" packages/frontend/src/hooks/useFinancialSummary.ts
grep -rn "getSummary\|/financial/summary" packages/frontend/src
```

Expected:
- `useFinancialSummary.ts` só acessa `result?.grossRevenue` e `result?.adSpend`.
- `Financial.tsx` calcula `totalExpenses`, `totalRevenues`, `companyCostsTotal`, `profit` localmente a partir de `entries` e `companyCosts` (hooks separados), **sem** ler esses campos da resposta de `/summary`.
- Nenhum outro consumidor de `/financial/summary` além de `useFinancialSummary`.

Se qualquer grep revelar um consumidor inesperado, **parar** e ajustar o plano antes de seguir.

- [ ] **Step 2: Checar consumidores de `user_id` e `created_at` em company-costs**

```bash
grep -rn "cost\.\(user_id\|created_at\)\|c\.\(user_id\|created_at\)" packages/frontend/src
grep -rn "company[_-]costs" packages/frontend/src
```

Expected:
- Nenhuma leitura de `user_id` ou `created_at` de objetos originados de `/integrations/company-costs`.
- Único hook consumidor: `useCompanyCosts.ts`, que já mapeia explicitamente para `{ id, name, type, value }`.

- [ ] **Step 3: Commit (marker vazio, para histórico — opcional)**

Nenhuma mudança de código nesta task. Não commitar. Apenas registrar mentalmente a confirmação.

---

### Task 1: Escrever teste falhando para o novo contrato de `getSummary`

Criar suite de teste unitário que fixa o shape exato da resposta e comprova que queries desnecessárias deixaram de ser feitas.

**Files:**
- Create: `packages/backend/src/modules/financial/__tests__/financial.service.spec.ts`

- [ ] **Step 1: Criar o arquivo de teste com mock do SupabaseService e LiveMetricsService**

Cole o conteúdo abaixo no arquivo novo:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { FinancialService } from '../financial.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { LiveMetricsService } from '../../metrics/live-metrics.service';

type FromCall = { table: string; columns?: string };

describe('FinancialService.getSummary — slim contract', () => {
  let service: FinancialService;
  let fromCalls: FromCall[];
  let liveMetrics: { getDashboardData: jest.Mock };

  const userId = 'user-1';
  const workspaceId = '00000000-0000-0000-0000-000000000001';

  beforeEach(async () => {
    fromCalls = [];

    // Minimal query builder: records the table+columns touched and
    // returns a thenable that resolves to the canned data per table.
    const makeBuilder = (table: string) => {
      const builder: any = {
        select: (cols: string) => {
          fromCalls.push({ table, columns: cols });
          return builder;
        },
        eq: () => builder,
        gte: () => builder,
        lt: () => builder,
        order: () => builder,
        maybeSingle: async () => {
          if (table === 'workspaces') {
            return { data: { id: workspaceId }, error: null };
          }
          return { data: null, error: null };
        },
        then: (resolve: (v: any) => void) => {
          if (table === 'sales') {
            resolve({ data: [{ amount: '100' }, { amount: '250' }], error: null });
          } else {
            resolve({ data: [], error: null });
          }
        },
      };
      return builder;
    };

    const supabaseMock: Partial<SupabaseService> = {
      getClient: () => ({ from: (table: string) => makeBuilder(table) }) as any,
    };

    liveMetrics = {
      getDashboardData: jest.fn().mockResolvedValue({
        daily_spend: [{ spend: 50 }, { spend: 75 }],
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FinancialService,
        { provide: SupabaseService, useValue: supabaseMock },
        { provide: LiveMetricsService, useValue: liveMetrics },
      ],
    }).compile();

    service = module.get(FinancialService);
  });

  it('returns only grossRevenue and adSpend', async () => {
    const result = await service.getSummary(userId, workspaceId);

    expect(Object.keys(result).sort()).toEqual(['adSpend', 'grossRevenue']);
    expect(result.grossRevenue).toBe(350);
    expect(result.adSpend).toBe(125);
  });

  it('does not query financial_entries or company_costs', async () => {
    await service.getSummary(userId, workspaceId);

    const tablesTouched = fromCalls.map((c) => c.table);
    expect(tablesTouched).not.toContain('financial_entries');
    expect(tablesTouched).not.toContain('company_costs');
    expect(tablesTouched).toContain('sales');
    expect(tablesTouched).toContain('workspaces'); // ownership check
  });

  it('forwards reference_month to sales range and live metrics', async () => {
    await service.getSummary(userId, workspaceId, '2026-04-01');

    expect(liveMetrics.getDashboardData).toHaveBeenCalledWith(
      userId,
      expect.objectContaining({
        workspace_id: workspaceId,
        from: '2026-04-01',
        to: expect.stringMatching(/^2026-04-\d{2}$/),
      }),
    );
  });
});
```

- [ ] **Step 2: Rodar o teste e confirmar que falha**

Comando:
```bash
cd packages/backend && npx jest src/modules/financial/__tests__/financial.service.spec.ts
```

Expected: falha com pelo menos uma asserção — hoje `Object.keys(result)` inclui `totalExpenses`, `totalRevenues`, `companyCosts`, `profit`, `expenses`, `revenues`, `companyCostsList`, e `financial_entries` + `company_costs` aparecem em `tablesTouched`.

- [ ] **Step 3: Commit do teste falhando**

```bash
git add packages/backend/src/modules/financial/__tests__/financial.service.spec.ts
git commit -m "test(financial): pin slim contract for getSummary (expected failing)"
```

---

### Task 2: Enxugar `FinancialService.getSummary`

Remover queries e cálculos desnecessários para passar o teste da Task 1.

**Files:**
- Modify: `packages/backend/src/modules/financial/financial.service.ts:38-152`

- [ ] **Step 1: Substituir o método `getSummary` pela versão enxuta**

Abra `packages/backend/src/modules/financial/financial.service.ts` e substitua as linhas 38-152 (método `getSummary` inteiro) por:

```ts
  async getSummary(
    userId: string,
    workspaceId: string,
    referenceMonth?: string,
  ): Promise<{ grossRevenue: number; adSpend: number }> {
    await this.verifyWorkspaceOwnership(workspaceId, userId);

    const client = this.supabase.getClient();

    let from: string | undefined;
    let to: string | undefined;

    if (referenceMonth) {
      from = referenceMonth;
      const d = new Date(referenceMonth + 'T12:00:00Z');
      d.setUTCMonth(d.getUTCMonth() + 1);
      d.setUTCDate(0);
      to = d.toISOString().slice(0, 10);
    }

    const buildSalesQuery = () => {
      let q = client
        .from('sales')
        .select('amount')
        .eq('user_id', userId)
        .eq('workspace_id', workspaceId)
        .eq('status', 'approved');
      if (from) q = q.gte('sold_at', toStartOfDayUTC(from));
      if (to) q = q.lt('sold_at', toExclusiveEndDate(to));
      return q;
    };

    const fetchAdSpend = () =>
      this.liveMetrics.getDashboardData(userId, {
        workspace_id: workspaceId,
        from,
        to,
      });

    const [salesResult, dashboardData] = await Promise.all([
      buildSalesQuery(),
      fetchAdSpend(),
    ]);

    if (salesResult.error) throw salesResult.error;

    const grossRevenue = (salesResult.data ?? []).reduce(
      (sum, r) => sum + Number(r.amount ?? 0),
      0,
    );

    const adSpend = (dashboardData.daily_spend ?? []).reduce(
      (sum: number, r: any) => sum + Number(r.spend ?? 0),
      0,
    );

    return { grossRevenue, adSpend };
  }
```

Mudanças-chave vs. versão antiga:
- Promise.all passa de 4 para 2 operações (removidas `buildEntriesQuery`, `buildCostsQuery`).
- Objeto de retorno contém apenas 2 campos.
- Anotação de tipo de retorno explícita (`Promise<{ grossRevenue: number; adSpend: number }>`).

- [ ] **Step 2: Verificar que imports não usados foram removidos**

Após a edição, `financial.service.ts` ainda usa `toStartOfDayUTC` e `toExclusiveEndDate` (na sales query). Nenhum import precisa ser removido. Confirme rodando:

```bash
cd packages/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "financial.service" || echo "clean"
```

Expected: `clean` (sem erros de tipo nem de import unused).

- [ ] **Step 3: Rodar os testes da Task 1 e confirmar que passam**

```bash
cd packages/backend && npx jest src/modules/financial/__tests__/financial.service.spec.ts
```

Expected: 3 testes verdes.

- [ ] **Step 4: Rodar a suite inteira do backend para garantir que nada regrediu**

```bash
cd packages/backend && npm test
```

Expected: todos os specs verdes (os outros não tocam em `FinancialService`).

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/financial/financial.service.ts
git commit -m "refactor(financial): slim getSummary to return only grossRevenue and adSpend"
```

---

### Task 3: Enxugar `IntegrationsService.listCompanyCosts`

Remover `user_id` e `created_at` do SELECT — o frontend não usa.

**Files:**
- Modify: `packages/backend/src/modules/integrations/integrations.service.ts:109`

- [ ] **Step 1: Trocar a lista de colunas do SELECT**

Em `packages/backend/src/modules/integrations/integrations.service.ts` linha 109, substituir:

```ts
    let query = db.from('company_costs').select('id, user_id, name, type, value, created_at').eq('user_id', userId);
```

por:

```ts
    let query = db.from('company_costs').select('id, name, type, value').eq('user_id', userId);
```

- [ ] **Step 2: Type-check**

```bash
cd packages/backend && npx tsc --noEmit -p tsconfig.json 2>&1 | grep "integrations.service" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Smoke manual — booting backend + GET real**

Em um terminal:
```bash
npm run dev:backend
```

Em outro (substitua `<TOKEN>` e `<WORKSPACE_UUID>`):
```bash
curl -s -H "Authorization: Bearer <TOKEN>" \
  "http://localhost:3001/api/integrations/company-costs?workspace_id=<WORKSPACE_UUID>" | jq '.[0] | keys'
```

Expected: `["id", "name", "type", "value"]` — sem `user_id`, sem `created_at`.

Se você não tiver um token/workspace à mão, pule este step e confie nos testes da Task 4. Mas ele é valioso como confirmação end-to-end.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/integrations/integrations.service.ts
git commit -m "refactor(integrations): drop unused columns from company-costs list response"
```

---

### Task 4: Smoke test manual do frontend em `/financial`

Confirmar que a tela inteira continua funcional com o backend enxuto. Não há mudanças de código aqui — é verificação.

**Files:**
- (nenhum)

- [ ] **Step 1: Subir o stack completo**

```bash
npm run dev
```

Frontend em http://localhost:5173, backend em http://localhost:3001.

- [ ] **Step 2: Checar o fluxo golden path**

Abrir o navegador em `/financial` logado. Confirmar visualmente:

1. Os 5 cards de resumo preenchem corretamente: Faturamento Bruto, Gasto com Ads, Outros Gastos, Outras Receitas, Lucro. O valor de Lucro deve bater com a fórmula `grossRevenue - adSpend - (totalExpenses + companyCostsTotal) + totalRevenues`.
2. O gráfico `FinancialBreakdownChart` renderiza as fatias (gross/ad/expenses/revenues/profit) sem "loading" travado.
3. A lista "Outros Gastos" mostra os custos da empresa (com `name`, percentual aplicado quando `type=percentage`, ou valor fixo quando `type=fixed`) e os lançamentos manuais.
4. A lista "Outras Receitas" mostra os lançamentos tipo `revenue`.
5. Trocar o mês no dropdown refaz o fetch e atualiza os cards. A aba "Todo período" funciona (`reference_month` não enviado).
6. Adicionar uma despesa nova (botão `+`) atualiza a lista e o total.
7. Editar um lançamento (ícone de lápis) salva e reflete no UI.
8. Remover um lançamento (lixeira) desaparece da lista.
9. "Importar de outro mês" abre modal, aceita seleção, copia os lançamentos.

- [ ] **Step 3: Checar o DevTools Network tab**

Com a aba Network do DevTools aberta:
- Confirmar que `GET /api/financial/summary?...` retorna `{ "grossRevenue": <num>, "adSpend": <num> }` — apenas 2 campos.
- Confirmar que `GET /api/integrations/company-costs?...` retorna array de objetos com 4 chaves: `id`, `name`, `type`, `value`.

- [ ] **Step 4: Sem regressão, sem commit**

Esta task é observacional. Nada a commitar.

Se qualquer passo falhar: **parar**, voltar em Tasks 2 ou 3, e ajustar.

---

### Task 5: Atualizar documentação em `docs/features/06-financial/financial.md`

Refletir o novo contrato da API enxuta na documentação única da feature.

**Files:**
- Modify: `docs/features/06-financial/financial.md` (seção 5 — API/Backend)

- [ ] **Step 1: Ler a seção 5 atual para localizar a descrição de `/summary`**

```bash
grep -n "summary\|getSummary\|financial/summary" docs/features/06-financial/financial.md
```

Anote o intervalo de linhas da subseção que descreve a resposta de `GET /financial/summary`.

- [ ] **Step 2: Substituir o bloco de resposta pelo contrato enxuto**

Na subseção de `GET /financial/summary`, substituir qualquer descrição/exemplo de response que liste os campos antigos (`totalExpenses`, `totalRevenues`, `companyCosts`, `profit`, `expenses`, `revenues`, `companyCostsList`) pelo bloco abaixo:

```markdown
#### `GET /financial/summary`

**Query params:** `workspace_id` (UUID, obrigatório), `reference_month` (YYYY-MM-DD, opcional), `target_user_id` (opcional — somente admin impersonando).

**Response:**
```json
{
  "grossRevenue": 12345.67,
  "adSpend": 2345.10
}
```

- `grossRevenue`: soma de `sales.amount` com `status = 'approved'` no workspace e período (todo o período quando `reference_month` ausente).
- `adSpend`: soma de `daily_spend.spend` vindo do Facebook Ads via `LiveMetricsService.getDashboardData`.

O endpoint **não** retorna totais de despesas/receitas, custos da empresa, nem lucro calculado. O frontend computa esses agregados a partir de `/financial` (lançamentos manuais) e `/integrations/company-costs` (custos fixos/percentuais), aplicando a fórmula da regra RN01.
```

- [ ] **Step 3: Atualizar subseção de `/integrations/company-costs` (se existir)**

Procurar no mesmo arquivo:
```bash
grep -n "company-costs\|company_costs" docs/features/06-financial/financial.md
```

Onde houver listagem de campos da response, deixar explícito: `id, name, type, value`. Remover menções a `user_id` e `created_at` como parte do contrato de leitura.

- [ ] **Step 4: Atualizar a seção 6 (Frontend) se citar `/summary` fornecendo totais**

Se a seção 6 ("Implementação no Frontend") disser algo como "o backend devolve `totalExpenses` e o frontend exibe", reescrever para: "o frontend calcula `totalExpenses` como `sum(entries.filter(type='expense').amount)` localmente".

- [ ] **Step 5: Commit da doc**

```bash
git add docs/features/06-financial/financial.md
git commit -m "docs(financial): align financial.md with slim summary contract"
```

---

### Task 6: Verificação final integrada

Fechar o ciclo verificando uma última vez que nada foi esquecido.

**Files:**
- (nenhum)

- [ ] **Step 1: Rodar lint e testes em ambos os pacotes**

```bash
npm run lint
npm run test
```

Expected: ambos verdes.

- [ ] **Step 2: Grep de salvaguarda**

Confirmar que não sobrou referência aos campos removidos na resposta de `/summary` em nenhum lugar do repo (fora de docs históricos e deste plano):

```bash
grep -rn "companyCostsList\|result\.totalExpenses\|result\.totalRevenues\|result\.profit\|result\.expenses\|result\.revenues" packages/frontend/src packages/backend/src
```

Expected: nenhum match. Qualquer match precisa ser investigado.

- [ ] **Step 3: Diff review**

```bash
git log --oneline main..HEAD
git diff main..HEAD --stat
```

Expected: commits enxutos, mudanças limitadas a `financial.service.ts`, `integrations.service.ts`, um arquivo de teste novo, e `financial.md`. Nenhum arquivo de frontend modificado.

- [ ] **Step 4: Commit vazio de marcação (opcional)**

Se quiser deixar um marcador semântico no histórico:

```bash
git commit --allow-empty -m "chore(financial): slim API rollout complete"
```

Caso contrário, pular.

---

## Self-Review Checklist

1. **Spec coverage** — os dois pontos de saneamento do spec estão cobertos: `/financial/summary` em Tasks 1–2, `/integrations/company-costs` em Task 3. Documentação em Task 5. Verificação ponta-a-ponta em Task 4 e 6.
2. **Placeholder scan** — nenhum "TBD"/"handle edge cases"/"similar to Task N". Cada step tem comando ou código explícito.
3. **Type consistency** — `getSummary` passa a devolver `{ grossRevenue: number; adSpend: number }` do início ao fim (teste da Task 1 fixa isso; Task 2 aplica; Task 5 documenta).
4. **Frontend já compatível** — `FinancialSummaryData` em `useFinancialSummary.ts` já descreve apenas os dois campos finais; `CompanyCost` em `useCompanyCosts.ts` já descreve apenas `id, name, type, value`. Nenhuma mudança de frontend requerida (confirmado pela Task 0).
