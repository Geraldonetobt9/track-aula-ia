# [Nome da Funcionalidade]

> **Modulo:** [caminho do modulo backend] | **Pagina:** [caminho do componente frontend]
> **Ultima atualizacao:** YYYY-MM-DD
> **Status:** Rascunho | Revisao | Aprovado

---

## 1. Proposito

Um paragrafo. O que essa funcionalidade faz e por que ela existe.
Quem se beneficia (usuario final, admin, sistema).

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada
Como o usuario chega a essa funcionalidade (rota, link no sidebar, acao que dispara).

### 2.2 Fluxo de UI
Passo a passo do que o usuario ve e faz.
Use passos numerados. Referencie nomes de componentes em `backticks`.

### 2.3 Permissoes
Quais roles podem acessar essa funcionalidade. O que acontece se nao autorizado.

## 3. Regras de Negocio

Regras numeradas e testaveis. Cada regra deve ser verificavel por QA com condicao clara de passa/falha.

| # | Regra | Condicao | Resultado Esperado |
|---|-------|----------|--------------------|
| RN-01 | [Nome curto] | [Quando X acontece] | [Entao Y deve ocorrer] |
| RN-02 | ... | ... | ... |

## 4. Modelo de Dados

### 4.1 Tabelas Principais
Lista cada tabela envolvida, com colunas relevantes para essa funcionalidade.

### 4.2 Relacionamentos
Descreve foreign keys, caminhos de join e ownership de dados (user_id, workspace_id).

### 4.3 Constraints e Defaults
CHECK constraints, valores default, regras de unicidade.

## 5. API / Backend

### 5.1 Endpoints
| Metodo | Path | Auth | Descricao |
|--------|------|------|-----------|
| GET | /api/... | JWT | ... |

### 5.2 Logica do Service
Descricao breve do(s) metodo(s) do service que implementam a logica principal.
Mencione edge cases tratados.

## 6. Implementacao no Frontend

### 6.1 Pagina / Componentes
Lista o arquivo da pagina e componentes-filhos principais.

### 6.2 Hooks
Lista os React hooks usados e quais dados fornecem.

### 6.3 Gerenciamento de Estado
Contexts envolvidos, cache keys do TanStack Query.

## 7. Pontos de Integracao

Como essa funcionalidade se conecta a outras funcionalidades.

## 8. Edge Cases e Tratamento de Erros

Lista de edge cases conhecidos e como sao tratados.

## 9. Checklist de Testes

- [ ] [Cenario testavel 1]
- [ ] [Cenario testavel 2]
- [ ] ...

## 10. Questoes Abertas / TODOs

Itens que precisam de esclarecimento ou ainda nao estao implementados.
