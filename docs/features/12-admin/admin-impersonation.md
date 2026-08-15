# Impersonacao de Usuarios (Admin Impersonation)

> **Modulo:** `packages/backend/src/modules/admin/admin.service.ts` (proxyQuery) | **Contexto:** `src/contexts/ImpersonationContext.tsx`
> **Ultima atualizacao:** 2026-03-30
> **Status:** Aprovado

---

## 1. Proposito

A funcionalidade de impersonacao permite que administradores visualizem o sistema como se fossem outro usuario, sem necessidade de acessar suas credenciais. Ao ativar a impersonacao, todos os hooks de dados da aplicacao passam a buscar informacoes do usuario-alvo ao inves do admin logado. Isso e essencial para suporte ao cliente, depuracao de problemas e verificacao de dados. A impersonacao opera apenas em modo de leitura logica (consulta dados do usuario) e utiliza o proxy admin no backend para executar queries em nome do usuario-alvo. Um indicador visual informa o admin que esta operando em modo de impersonacao.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Ponto de Entrada | Descricao |
|---|---|
| Pagina de detalhe do usuario | Botao para iniciar impersonacao |
| Listagem de usuarios | Acao de impersonar na tabela |
| Banner de impersonacao | Botao para encerrar impersonacao |

### 2.2 Fluxo de UI

1. Admin navega para o detalhe de um usuario ou lista de usuarios.
2. Admin clica em "Impersonar" (ou botao similar) passando `userId` e `userName`.
3. O `ImpersonationContext` registra o alvo via `startImpersonation(userId, userName)`.
4. Um banner/badge visual e exibido na interface indicando "Visualizando como: [Nome do Usuario]".
5. Todos os hooks de dados (`useSales`, `useCampaigns`, `useDashboardMetrics`, etc.) detectam a impersonacao via `useImpersonation().getEffectiveUserId(realUserId)`.
6. Os hooks passam `target_user_id` como query parameter nas chamadas de API, fazendo o backend retornar dados do usuario-alvo.
7. O admin navega normalmente pelo dashboard, vendas, campanhas, etc., vendo os dados do usuario impersonado.
8. Para encerrar, o admin clica no botao de "Parar Impersonacao" no banner, que chama `stopImpersonation()`.
9. Todos os hooks voltam a usar o `userId` real do admin.

### 2.3 Permissoes

| Acao | Permissao |
|---|---|
| Iniciar impersonacao | Somente admin |
| Visualizar dados como outro usuario | Somente admin impersonando |
| Encerrar impersonacao | Somente admin (ativo durante impersonacao) |

---

## 3. Regras de Negocio

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | Inicio de impersonacao | `startImpersonation(userId, userName)` | `target` e definido no contexto; `isImpersonating = true` |
| RN-02 | Fim de impersonacao | `stopImpersonation()` | `target = null`; `isImpersonating = false` |
| RN-03 | User ID efetivo | `getEffectiveUserId(realUserId)` | Retorna `target.userId` se impersonando; caso contrario retorna `realUserId` |
| RN-04 | Todos os hooks afetados | Impersonacao ativa | Hooks passam `target_user_id` para filtrar dados pelo usuario-alvo |
| RN-05 | Indicador visual | Impersonacao ativa | Banner ou badge exibe nome do usuario impersonado |
| RN-06 | Proxy no backend | `POST /api/admin/proxy` | Executa queries no banco filtrando por `user_id = targetUserId` |
| RN-07 | Filtro obrigatorio | Toda query via proxy | `query.eq('user_id', targetUserId)` e SEMPRE aplicado (nao pode ser omitido) |
| RN-08 | Operadores suportados | Filtros no proxy | `eq`, `neq`, `gt`, `gte`, `lt`, `lte`, `in`, `is`, `like`, `ilike`, `not_is` |
| RN-09 | Paginacao no proxy | `range` presente | Aplica `.range(from, to)` na query |
| RN-10 | Ordenacao no proxy | `order` presente | Aplica `.order(column, { ascending })` na query |
| RN-11 | Limite no proxy | `limit` presente | Aplica `.limit(limit)` na query |
| RN-12 | Resultado por chave | Multiplas queries | Cada query retorna resultado identificado pela `key` |

---

## 4. Modelo de Dados

### 4.1 Estrutura do Contexto

A impersonacao nao possui tabela propria. Opera inteiramente em memoria no frontend:

```typescript
interface ImpersonationTarget {
  userId: string;   // ID do usuario impersonado
  userName: string;  // Nome para exibicao no banner
}

interface ImpersonationContextType {
  target: ImpersonationTarget | null;
  isImpersonating: boolean;
  startImpersonation: (userId: string, userName: string) => void;
  stopImpersonation: () => void;
  getEffectiveUserId: (realUserId: string | undefined) => string | undefined;
}
```

### 4.2 Estrutura do Proxy Query

```typescript
interface ProxyQuery {
  key: string;                    // Identificador unico do resultado
  table: string;                  // Nome da tabela Supabase
  select?: string;                // Colunas (default: '*')
  filters?: Array<{
    column: string;               // Nome da coluna
    op: string;                   // Operador (eq, neq, gt, gte, lt, lte, in, is, like, ilike, not_is)
    value: any;                   // Valor do filtro
  }>;
  order?: {
    column: string;               // Coluna para ordenacao
    ascending?: boolean;          // Default: true
  };
  limit?: number;                 // Limite de registros
  range?: {
    from: number;                 // Inicio do range
    to: number;                   // Fim do range
  };
}
```

### 4.3 Constraints

- O filtro `user_id = targetUserId` e SEMPRE aplicado automaticamente pelo backend, independente dos filtros enviados pelo frontend.
- O admin nao pode omitir ou sobrescrever o filtro de `user_id`.

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| POST | `/api/admin/proxy` | JWT + Admin | Executa queries em nome de outro usuario |

### 5.2 Logica do Service

**AdminService.proxyQuery(targetUserId, queries)**

1. Valida que `targetUserId` e `queries` (array) estao presentes.
2. Para cada query no array:
   a. Inicia query Supabase: `client.from(table).select(select || '*')`.
   b. Aplica filtro obrigatorio: `.eq('user_id', targetUserId)`.
   c. Itera sobre `filters` e aplica operadores correspondentes:
      - `eq`, `neq`, `gt`, `gte`, `lt`, `lte`: metodos diretos do Supabase.
      - `in`: `.in(column, value)` (value deve ser array).
      - `is`: `.is(column, value)`.
      - `like`: `.like(column, value)`.
      - `ilike`: `.ilike(column, value)`.
      - `not_is`: `.not(column, 'is', value)`.
   d. Aplica `order` se presente.
   e. Aplica `limit` se presente.
   f. Aplica `range` se presente.
   g. Executa query e armazena resultado em `results[query.key]`.
3. Retorna objeto com resultados: `{ [key]: { data: [], error: string | null } }`.

**Seguranca:**
- O filtro `user_id = targetUserId` e aplicado no servidor, nao pode ser manipulado pelo cliente.
- O endpoint requer autenticacao JWT e role admin.
- Cada query e executada independentemente; erro em uma nao afeta as demais.

---

## 6. Implementacao no Frontend

### 6.1 Componentes

| Componente | Arquivo | Responsabilidade |
|---|---|---|
| ImpersonationProvider | `src/contexts/ImpersonationContext.tsx` | Context provider que gerencia estado de impersonacao |
| Banner/Badge de impersonacao | Componente na UI | Indicador visual com nome do usuario e botao de parar |

### 6.2 Hooks

| Hook | Arquivo | Retorno |
|---|---|---|
| `useImpersonation` | `src/contexts/ImpersonationContext.tsx` | `{ target, isImpersonating, startImpersonation, stopImpersonation, getEffectiveUserId }` |

**useImpersonation:**
- Deve ser usado dentro de `ImpersonationProvider` (lanca erro caso contrario).
- `startImpersonation(userId, userName)`: define o alvo da impersonacao.
- `stopImpersonation()`: limpa o alvo (define `target = null`).
- `getEffectiveUserId(realUserId)`: retorna `target.userId` se impersonando, caso contrario `realUserId`.
- `isImpersonating`: booleano derivado de `!!target`.

**Integracao com hooks de dados:**

Os seguintes hooks utilizam `useImpersonation().getEffectiveUserId()` e/ou passam `target_user_id` nas queries:

| Hook | Arquivo |
|---|---|
| `useSales` | `src/hooks/useSales.ts` |
| `useCampaigns` | `src/hooks/useCampaigns.ts` |
| `useAdSets` | `src/hooks/useAdSets.ts` |
| `useAds` | `src/hooks/useAds.ts` |
| `useDashboardMetrics` | `src/hooks/useDashboardMetrics.ts` |
| `useCheckoutIntegrations` | `src/hooks/useCheckoutIntegrations.ts` |
| `useFacebookConnection` | `src/hooks/useFacebookConnection.ts` |
| `useWorkspaces` | `src/hooks/useWorkspaces.ts` |
| `useFinancialSummary` | `src/hooks/useFinancialSummary.ts` |
| `useProfitEvolution` | `src/hooks/useProfitEvolution.ts` |
| `useTopAds` | `src/hooks/useTopAds.ts` |
| `useFunnelData` | `src/hooks/useFunnelData.ts` |
| `useCampaignsFunnel` | `src/hooks/useCampaignsFunnel.ts` |
| `useMetaCampaigns` | `src/hooks/useMetaCampaigns.ts` |
| `useMetaAdSets` | `src/hooks/useMetaAdSets.ts` |
| `useMetaAds` | `src/hooks/useMetaAds.ts` |
| `useMetaCampaignsFunnel` | `src/hooks/useMetaCampaignsFunnel.ts` |

### 6.3 Gerenciamento de Estado

| Estado | Tipo | Descricao |
|---|---|---|
| `target` | ImpersonationTarget ou null | Usuario sendo impersonado |
| `isImpersonating` | boolean | Derivado de `!!target` |

O estado e mantido em memoria via `useState` do React. Nao persiste entre reloads da pagina (impersonacao e encerrada ao recarregar).

---

## 7. Pontos de Integracao

| Sistema | Tipo | Descricao |
|---|---|---|
| Todos os hooks de dados (18+) | Consumidor | Usam `getEffectiveUserId()` para determinar de quem buscar dados |
| AdminUserDetail | Disparador | Pagina de onde o admin inicia a impersonacao |
| AdminUsers | Disparador | Lista de usuarios com acao de impersonar |
| Admin Proxy endpoint | Backend | Executa queries filtradas por `user_id` do alvo |
| Banner de impersonacao | UI | Indicador visual persistente durante impersonacao |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario | Tratamento |
|---|---|
| useImpersonation fora do Provider | Lanca erro "useImpersonation must be used within ImpersonationProvider" |
| Impersonar usuario inexistente | Proxy retorna arrays vazios; nenhum erro explicito |
| Impersonar a si mesmo | Permitido tecnicamente; dados sao os mesmos |
| Reload da pagina durante impersonacao | Impersonacao e encerrada (estado em memoria) |
| Queries sem `target_user_id` | Sem erro; proxy sempre aplica filtro por user_id |
| Erro em uma query do proxy | Resultado daquela query: `{ data: [], error: 'mensagem' }`; demais queries nao afetadas |
| `targetUserId` ou `queries` ausentes no proxy | `BadRequestException` "Missing user_id or queries" |
| Tabela inexistente no proxy | Erro do Supabase capturado e retornado na chave correspondente |

---

## 9. Checklist de Testes

- [ ] Verificar que `startImpersonation` define corretamente o alvo
- [ ] Verificar que `stopImpersonation` limpa o alvo
- [ ] Testar `getEffectiveUserId` retorna userId do alvo quando impersonando
- [ ] Testar `getEffectiveUserId` retorna realUserId quando nao impersonando
- [ ] Confirmar que `isImpersonating` e true durante impersonacao
- [ ] Verificar que banner de impersonacao e exibido com nome do usuario
- [ ] Testar que hooks passam `target_user_id` durante impersonacao
- [ ] Verificar que dados exibidos sao do usuario impersonado (nao do admin)
- [ ] Testar encerramento de impersonacao e retorno aos dados do admin
- [ ] Verificar que proxy sempre aplica filtro `user_id = targetUserId`
- [ ] Testar proxy com multiplas queries simultaneas
- [ ] Testar proxy com filtros, ordenacao, limite e paginacao
- [ ] Verificar que erro em uma query nao afeta as demais
- [ ] Testar todos os 11 operadores suportados no proxy
- [ ] Confirmar que somente admins acessam o endpoint de proxy
- [ ] Verificar comportamento apos reload da pagina (impersonacao encerrada)
- [ ] Testar que `useImpersonation` fora do Provider lanca erro
- [ ] Verificar os 18 hooks que integram com impersonacao

---

## 10. Questoes Abertas / TODOs

| # | Questao | Contexto |
|---|---|---|
| Q01 | Persistencia da impersonacao | O estado e perdido no reload. Considerar persistir em sessionStorage para manter durante navegacao |
| Q02 | Operacoes de escrita | A impersonacao e pensada para leitura. Nao ha protecao explicita contra operacoes de escrita (ex: editar workspace) como usuario impersonado |
| Q03 | Auditoria | Nao ha log de quando um admin inicia/encerra impersonacao de outro usuario |
| Q04 | Whitelist de tabelas | O proxy aceita qualquer nome de tabela. Considerar restringir a uma lista de tabelas permitidas |
| Q05 | Rate limiting no proxy | Nao ha limite de queries por request no proxy. Um request pode conter muitas queries |
| Q06 | ProxiedClient | O conceito de ProxiedClient que mimetiza a API fluent do Supabase nao foi implementado; hooks usam `target_user_id` diretamente como query parameter |
