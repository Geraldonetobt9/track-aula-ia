# Design: Múltiplas Integrações por Plataforma

**Data:** 2026-04-07
**Status:** Aprovado

## Resumo

Refatorar o sistema de integrações para permitir N integrações da mesma plataforma por workspace. Cada integração tem um nome obrigatório para identificação. A UI muda de "cards por plataforma" para "cards por integração" com fluxo de adição em dois passos (selecionar plataforma → configurar). O limite total de integrações é controlado por `plan_rules.max_checkout_integrations`.

## Motivação

1. **Bug**: ao clicar em "Configurar" para editar uma integração existente, o sistema cria uma nova ao invés de editar (o frontend não envia o `id`).
2. **Limitação**: o usuário não pode ter mais de uma integração da mesma plataforma (ex: 3 Hotmarts para produtos diferentes).
3. **Identificação**: sem nome, não há como diferenciar integrações da mesma plataforma.

## Banco de Dados

### Nova coluna

```sql
ALTER TABLE public.checkout_integrations
ADD COLUMN name TEXT NOT NULL DEFAULT '';
```

### Migration de dados (preencher integrações existentes)

```sql
WITH ranked AS (
  SELECT id, platform,
    ROW_NUMBER() OVER (PARTITION BY workspace_id, platform ORDER BY created_at) AS rn
  FROM public.checkout_integrations
  WHERE name = ''
)
UPDATE public.checkout_integrations ci
SET name = ranked.platform || ' #' || ranked.rn
FROM ranked
WHERE ci.id = ranked.id;
```

### Remover default após preencher

```sql
ALTER TABLE public.checkout_integrations
ALTER COLUMN name DROP DEFAULT;
```

Sem novos índices necessários (a coluna `name` não é usada em WHERE/JOIN/ORDER BY).

## Backend

### DTO

Adicionar ao `SaveCheckoutDto`:

```typescript
@IsString()
name!: string;
```

Campo obrigatório no POST (criação). No update (quando `id` é enviado), pode ser opcional pois o usuário pode querer editar só o token.

### Service

- Adicionar `name` ao select do `listCheckoutIntegrations`.
- O fluxo de `saveCheckoutIntegration` já suporta create (sem `id`) e update (com `id`). Nenhuma mudança de lógica necessária.

### Limites

O limite total de integrações por workspace é controlado por `plan_rules.max_checkout_integrations`. O backend deve verificar o limite antes de criar uma nova integração:

1. Contar integrações existentes do workspace.
2. Comparar com `plan_rules.max_checkout_integrations` do plano do usuário.
3. Retornar erro 403 se exceder.

## Frontend

### CheckoutIntegrationsSection (refatoração completa)

**Antes:** 9 cards fixos de plataforma, 1 por plataforma.
**Depois:** Cards dinâmicos listando as integrações reais do usuário.

Cada card mostra:
- Nome da integração (ex: "Produto Digital A")
- Plataforma como subtítulo (ex: "Hotmart")
- Logo da plataforma
- Badge: "Conectado" (verde) ou "Desativado"
- Último webhook recebido
- Botão "Editar" → abre modal de edição com `id`
- Menu "..." → opção de remover

Header da seção:
- Título "Integrações de Checkout"
- Botão "Adicionar integração"

Estado vazio (sem integrações):
- Mensagem + botão "Adicionar primeira integração"

### Fluxo de Adição (dois passos)

**Passo 1 — Seletor de plataforma:**
- Modal/drawer com grid de ícones das plataformas disponíveis
- Cada plataforma é clicável
- Ao clicar, fecha esse modal e abre o modal de configuração

**Passo 2 — Configuração:**
- `CheckoutConfigModal` com a plataforma já selecionada
- Campos: nome (obrigatório), token, valor a registrar (radio)
- Sem `id` → cria nova integração

### Fluxo de Edição

- Clicar em "Editar" no card abre o `CheckoutConfigModal` com todos os dados preenchidos
- O modal envia o `id` da integração no save → backend faz UPDATE

### CheckoutConfigModal

Adicionar campo `name`:
- Input de texto, obrigatório
- Label: "Nome da integração"
- Placeholder: "Ex: Produto Digital A"
- Posicionado acima do campo de token

Atualizar `onSave` para incluir `name` e `id` (quando editando).

### useCheckoutIntegrations

- `saveIntegration` passa a receber um objeto com `{ id?, platform, name, token, useCommissionValue }` em vez de parâmetros posicionais.
- Remover `getIntegration(platform)` — não faz mais sentido.
- Na criação, se `name` estiver vazio, o frontend valida e não permite salvar.

## Compatibilidade

- Integrações existentes recebem nomes auto-gerados na migration (ex: "hotmart #1").
- Webhook processors não mudam — já buscam integração por token, não por plataforma.
- `use_commission_value` funciona normalmente por integração.
- `plan_rules.max_checkout_integrations` já existe e controla o limite total.

## O que NÃO muda

- Tabela `sales` permanece inalterada.
- Webhook processors inalterados.
- Endpoints de webhook inalterados (a URL é por plataforma, não por integração).
- Lógica de matching de ads inalterada.
