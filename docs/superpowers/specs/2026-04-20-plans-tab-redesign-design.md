# Redesign — Aba "Plano" em Settings

**Status:** Design approved (option A)
**Escopo:** Frontend somente (`packages/frontend/src/components/PlanTab/*` + `PlanUsageCard.tsx`). Sem mudanças em backend, hooks, banco ou contratos de API.

## Objetivo

Reorganizar a aba **Plano** em `Settings` para melhorar hierarquia visual, reduzir scroll, e dar destaque ao plano atual. O layout atual empilha 3 blocos (current plan banner → usage bars → plan cards) de forma linear, sem hierarquia clara entre "o que eu tenho" e "o que eu posso ter".

## Estrutura visual (Layout A — Focus & Glance)

Substituir o empilhamento linear por duas seções:

### 1. Hero em duas colunas (current plan + uso)

Linha com duas cartas lado a lado, proporção ~1.3 : 1 em desktop, empilhada em mobile:

**Esquerda — hero do plano atual:**
- Chip "Plano atual" com cor de destaque (lime).
- Nome do plano grande (ex: "Pro", 32px).
- Subtítulo com preço base + overage (ex: "R$ 59,90/mês · + R$ 0,14 por venda extra").
- Linha divisória + bloco inline de metadados com 2 items: **Próxima cobrança** (data) e **Status** (ativa/pausada/cancelada agendada, com ponto colorido).
- Botões de ação à direita do cabeçalho: "Gerenciar assinatura" (primário) e "Cancelar" (secundário), quando aplicável.
- Fundo com gradient sutil e um radial-gradient lime no canto superior direito para destaque.

**Direita — card de uso compacto:**
- Título "Uso do ciclo" + subtexto "reseta em N dias" (calculado de `period.end`).
- Lista vertical com 5 métricas (vendas, workspaces, contas de anúncio, integrações, regras). Cada linha: label à esquerda, valor `used / limit` à direita, mini-barra abaixo (6px de altura).
- Barras usam lime preenchido quando há uso, cinza escuro quando zeradas.
- Alertas existentes (`sales.blocked`, `overage`) ficam empilhados abaixo da lista, dentro da mesma carta.

### 2. Trocar de plano

- Cabeçalho de seção: "Trocar de plano" + subtítulo + (opcional, fora do escopo inicial) toggle Mensal/Anual.
- Grid de 4 cards (`repeat(4, 1fr)` em desktop, 2 colunas em md, 1 em mobile).
- Cards têm border radius 14px, padding ~22px, hover com leve `translateY(-2px)`.
- Estados visuais:
  - **Plano atual:** borda lime + gradient de fundo sutil lime + badge "Plano atual" no topo esquerdo + botão "Plano atual" desabilitado.
  - **Recomendado (Starter):** borda branca mais forte + badge "Mais popular".
  - **Outros:** borda padrão `rgba(255,255,255,0.08)`.
- Cada card: nome, tagline, preço grande, overage, divider, lista de features com ícone lime (✓ ou ∞), botão de ação (contextual — "Fazer upgrade", "Fazer downgrade", "Plano atual", etc).

## Componentes impactados

### Modificar
- **`packages/frontend/src/components/PlanTab/CurrentPlanCard.tsx`** — redesenhar como hero com gradient + metadados inline + botões na mesma linha. Mantém toda a lógica de `cancel_at_period_end`, `scheduled_plan`, reactivate e portal.
- **`packages/frontend/src/components/PlanUsageCard.tsx`** — reduzir padding, ajustar tipografia para caber como coluna lateral mais estreita, manter a lista de métricas e os alertas (blocked/overage).
- **`packages/frontend/src/components/PlanTab/PlanCards.tsx`** — ajustar estilo dos cards: border radius, hover, hierarquia do preço, badges reposicionados, ícones com visual mais refinado.
- **`packages/frontend/src/pages/Settings.tsx`** — dentro de `<TabsContent value="plan">`, trocar o empilhamento vertical por um wrapper de duas colunas (hero + usage) + full-width abaixo (plan cards). Manter `<CheckoutReturnHandler />` no topo.

### Não tocar
- Hooks (`usePlanUsage`, `useStripeCheckout`, `useStripePortal`, `useStripeReactivate`).
- Endpoints, DTOs, ou estrutura de dados.
- Outros tabs (Perfil, Segurança, Custos).

## Responsividade

- **Desktop (≥1024px):** duas colunas no hero, 4 colunas no grid de planos.
- **Tablet (≥768px, <1024px):** hero empilhado (usage card abaixo do current plan), 2 colunas no grid de planos.
- **Mobile (<768px):** tudo empilhado, botões do hero vão para linha separada abaixo do nome/preço, 1 coluna no grid.

## Fora do escopo (follow-ups possíveis)

- Toggle Mensal/Anual — backend hoje só tem preço mensal. Se quiser, é spec separada.
- Exibir método de pagamento (ex: "Visa •••• 4242") — requer novo endpoint ou extensão do `/plan-limits/usage` retornando dados do Stripe. Não implementar agora.
- Histórico de faturas — fora do escopo.

## Critérios de aceite

- [ ] Aba Plano carrega sem regressão comparado ao atual (dados, loading states, erros).
- [ ] Hero mostra plano atual, próxima cobrança, status, overage por venda e botões de ação funcionando (portal do Stripe, cancelar, reativar).
- [ ] Card de uso exibe as 5 métricas corretamente com barras proporcionais e tratamento de `limit === -1` (ilimitado).
- [ ] Alertas `sales.blocked` e `overage.count` continuam aparecendo dentro do card de uso.
- [ ] Cards de plano têm 3 estados visuais (atual, popular, padrão) claramente distintos.
- [ ] Botões de ação dos cards seguem a lógica existente: upgrade, downgrade via portal, "Plano atual" desabilitado, "Alteração agendada" quando aplicável.
- [ ] Layout responsivo funciona nos breakpoints acima.
- [ ] Sem novos warnings/errors de TypeScript ou ESLint.
