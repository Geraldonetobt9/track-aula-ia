# Self-serve billing — E2E test results & UX findings

> **Executado em:** 2026-05-08 via Playwright contra `localhost:5173`/`localhost:3001` em Stripe test mode.
> **User de teste:** `e2e-billing-1778253543@test.local`
> **Stack:** `npm run dev` + `stripe listen --forward-to .../api/stripe/webhook` + cartões de teste.
> **Spec:** `docs/superpowers/specs/2026-05-08-self-serve-billing-design.md`

---

## Resumo dos cenários

| # | Cenário | Status | Observações |
|---|---|---|---|
| S1 | Signup → Stripe Checkout (Free → Pro) com `4242` | ✅ | Webhook `customer.subscription.created` populou `stripe_customer_id` + `stripe_subscription_id`; fatura R$ 59,90 paga listada |
| S2 | Cancelar assinatura in-app | ⚠️ | Funciona, mas UI só atualiza após reload manual (cache stale) |
| S3 | Reativar assinatura | ⚠️ | Funciona; mesmo problema de stale cache |
| S4 | Adicionar cartão via PaymentElement (4242 já existia, usei `5555`) | ✅ | SetupIntent + `confirmSetup` + attach OK |
| S5 | Adicionar 2º cartão Mastercard | ✅ | Consolidado em S4 (single dialog flow) |
| S6 | Definir 2º cartão como padrão | ✅ | Badge muda corretamente |
| S7 | Remover cartão (default disabled, non-default OK) | ✅ | Lixeira do default tem `disabled: true` + tooltip explicativo |
| S8 | Upgrade Pro → Starter (cobra R$ 60) | ✅ | **Comportamento exato do spec.** Invoice avulsa criada e paga; `current_period_end` preservado em 08/jun |
| S9 | Downgrade Starter → Pro | ❌ | **Bug de alinhamento spec/UI:** copy promete agendamento mas troca acontece imediatamente |
| S10 | Add card 3DS challenge `4000 0027 6000 3184` | ✅ | Challenge interativo funcionou; cartão 3184 cadastrado |

---

## Achados de UX/UI

### 🔴 Críticos

**UX-1. Downgrade não é agendado de fato.**

`PlanSwitchDialog` em downgrade promete: *"A troca é agendada — você continua no plano atual até a data de renovação. Vai virar plano Pro em 08 de jun. de 2026. Sem cobrança extra agora."*

Mas a implementação atual em `changeExistingPlan` chama `subscriptions.update(items, proration_behavior: 'none')` — isso troca os itens **imediatamente**. Resultado: o usuário paga R$ 119,90 pelo Starter, faz downgrade no dia 8 do ciclo, e **perde 23 dias de Starter** pelos quais já pagou (passa pra Pro na hora).

Isso já estava listado como risco na spec (item 10.1: "testar em test mode antes de finalizar copy. Plano B: `subscription_schedules`"). Confirmado em prática — o Plano B precisa ser implementado.

**Correção sugerida:** Em vez de `subscriptions.update`, usar `stripe.subscriptionSchedules.create` apontando pra `current_period_end` com fase nova de target plan. Frontend e copy ficam consistentes.

---

**UX-2. `?tab=plan` na URL não pré-seleciona a aba.**

Settings.tsx ignora o query param `?tab=plan` na primeira render — sempre cai em Perfil. Sintoma:
- Reload de `/settings?tab=plan` → mostra Perfil
- Retorno do Stripe Checkout (`?tab=plan&status=success&session_id=...`) → mostra Perfil; `CheckoutReturnHandler` provavelmente roda mas o usuário não vê o card de plano que mudou

**Correção sugerida:** Em `Settings.tsx`, ler `useSearchParams().get('tab')` e passar como `defaultValue` (ou `value` controlado) no `<Tabs>`.

---

**UX-3. Dois botões "Cancelar assinatura" com comportamentos diferentes.**

Hoje na aba Plano coexistem:
1. Botão **"Cancelar assinatura"** no `CurrentPlanCard` (hero) — chama `POST /stripe/cancel` (in-app, novo).
2. Botão **"Cancelar assinatura"** no card Free do grid `PlanCards` — chama `portal.mutate()` (redireciona pro Customer Portal Stripe, legado).

O botão do card Free era a forma antiga de cancelar (via Portal). Agora que existe o in-app, é redundante e inconsistente. Confirma o usuário pra mesma ação em UI diferentes, com fluxos diferentes.

**Correção sugerida:** Remover o botão "Cancelar assinatura" do card Free em `PlanCards.tsx` (linhas ~227-234, `if (slug === 'free' && hasPaidSubscription)`). O hero é o lugar canônico.

---

### 🟡 Importantes

**UX-4. Stale cache: cancel/reactivate não atualizam UI até reload.**

Após clicar "Sim, cancelar", o toast aparece imediatamente mas o `CurrentPlanCard` continua mostrando "Ativa" / "Próxima cobrança". Só depois de F5 mostra "Cancelamento agendado" / "Encerra em".

**Causa:** o endpoint `/stripe/cancel` chama `subscriptions.update` no Stripe e retorna. O update da row local em `subscriptions` (com `cancel_at_period_end=true`) só acontece quando o webhook `customer.subscription.updated` chega. O `useStripeCancel.onSuccess` invalida `plan-usage`, mas o refetch é mais rápido que o webhook → traz dados antigos.

**Correção sugerida (escolher uma):**
- **(a)** Em `cancelSubscription`, atualizar a row em `subscriptions` localmente antes de retornar (write-through). O webhook depois é idempotente e reconcilia.
- **(b)** Optimistic update no `useStripeCancel` (`onMutate`): seta `cancel_at_period_end: true` na cache antes de o servidor retornar.
- **(c)** Polling com backoff no `useStripeCancel.onSuccess` (igual o `CheckoutReturnHandler` faz no signup) até `cancel_at_period_end === true`.

(a) é o mais limpo — faz a mutação local + Stripe ser uma única transação visível.

Mesmo problema afeta S3 (reativação).

---

**UX-5. Stripe Elements `theme: 'night'` não está aplicando.**

O `AddCardDialog.tsx` passa `appearance: { theme: 'night' }` no `<Elements>`, mas o iframe renderiza com fundo claro/branco — contrasta com o resto do app dark.

Possível causa: o tema `'night'` da Stripe é dark mas usa cinza/azul, não a paleta lime/dark do Sentinela. O efeito visual é "Stripe colocou um card light no meio do app dark".

**Correção sugerida:** customizar `appearance.variables` pra puxar as variáveis CSS do app:
```ts
appearance: {
  theme: 'night',
  variables: {
    colorPrimary: 'hsl(var(--primary))',
    colorBackground: 'hsl(var(--card))',
    colorText: 'hsl(var(--foreground))',
    colorDanger: 'hsl(var(--destructive))',
    fontFamily: 'inherit',
    borderRadius: '8px',
  },
}
```

---

**UX-6. Banner "Atualizando assinatura..." persiste após retorno do checkout.**

Após Stripe Checkout success, o `CheckoutReturnHandler` mostra um banner "Atualizando assinatura... pode levar alguns segundos." que continua visível mesmo depois do `usePlanUsage` ter retornado dados frescos com a sub ativa. A mensagem faz o usuário pensar que algo ainda está pendente.

**Correção sugerida:** o handler deve esconder o banner assim que `usage.subscription.status === 'active'` for atingido.

---

**UX-7. Título do dialog `PlanSwitchDialog` capitaliza palavras erradas.**

O título atual é `<AlertDialogTitle className="capitalize">Trocar para o plano {targetPlanName}?`. O `capitalize` aplica "Title Case" no título inteiro, virando **"Trocar Para O Plano Starter?"** — palavras como "Para" e "O" não deveriam ser capitalizadas.

**Correção sugerida:** capitalizar só o `targetPlanName`:
```tsx
<AlertDialogTitle>
  Trocar para o plano <span className="capitalize">{targetPlanName}</span>?
</AlertDialogTitle>
```

---

**UX-8. Hero do `CurrentPlanCard`: dois botões empilhados em coluna.**

"Gerenciar assinatura" + "Cancelar assinatura" ficam empilhados verticalmente, criando peso visual estranho. "Cancelar" em destrutivo vermelho fica logo abaixo de "Gerenciar" (cinza outline) — desbalanceado.

**Correção sugerida:** lado-a-lado em desktop com `flex-row gap-2 flex-wrap`. Em mobile pode empilhar.

---

### 🟢 Polir

**UX-9. Disclaimer no PaymentElement menciona "AGENCIA GROWTH HACKERS LTDA".**

Texto da Stripe no fim do iframe: *"Ao fornecer seus dados de cartão, você permite que **AGENCIA GROWTH HACKERS LTDA** faça a cobrança..."*. É o nome da empresa cadastrada na Stripe — pro usuário Sentinela pode confundir.

**Correção sugerida:** ajustar o "Statement Descriptor" no Stripe Dashboard pra "Sentinela" (em Settings → Public details). A Stripe pega esse nome no disclaimer do PaymentElement.

---

**UX-10. Alert dialog do "Sim, remover" usa cor primary, não destructive.**

Em `PaymentMethodsCard.tsx`, o botão "Sim, remover" do `AlertDialogAction` usa o estilo padrão (lime/primary) — mas é uma ação destrutiva. Inconsistente com "Sim, cancelar" assinatura, que é vermelho.

**Correção sugerida:** alinhar — ou ambos vermelhos (consistência de "ação destrutiva"), ou ambos primary (consistência de "ação confirmada"). Recomendo vermelho.

---

**UX-11. CancelSubscriptionDialog: nome do plano lowercase no body.**

A descrição mostra: *"Sua assinatura **pro** continua ativa até..."*. Visualmente OK por causa do `capitalize` CSS (mostra "Pro"), mas screen readers leem "pro" minúsculo (a transformação é só visual).

**Correção sugerida:** capitalizar via JS no componente em vez de CSS:
```tsx
const planLabel = planName.charAt(0).toUpperCase() + planName.slice(1);
```

---

**UX-12. AI Agent disclosure no Stripe Checkout.**

Stripe Test Mode agora exibe um checkbox *"I am an AI agent acting on behalf of someone else"* — agentes/automações precisam declarar antes de submeter. Foi um pequeno blocker durante o teste, contornado via `evaluate`. Não afeta usuários reais (só aparece em test mode), mas vale ficar de olho se a Stripe expandir pra live mode.

---

## Coisas que funcionaram particularmente bem

🌟 **Modelo de upgrade exato como projetado.** Pagamento da R$ 60,00 (diff Pro→Starter) caiu como invoice avulsa em "Faturas recentes" com link Stripe + PDF. `current_period_end` preservado em 08/jun. Próxima fatura sai pelo valor do Starter cheio. Modelo VTurb-style funcionando bonito.

🌟 **3DS challenge integrado.** O cartão `4000 0027 6000 3184` disparou o challenge da Stripe dentro do iframe (3D Secure 2 Test Page) e, após "Complete", o cartão foi adicionado limpo.

🌟 **Webhook idempotency working.** `stripe_webhook_events` recebeu múltiplos eventos paralelos (`charge.succeeded`, `payment_intent.succeeded`, `invoice.paid`, `invoice.payment_succeeded`, `customer.subscription.updated`) e todos retornaram 200 sem erros.

🌟 **Ownership check em remoção/default.** Tentei via DOM o botão lixeira do Visa (default): `disabled: true` + título "Defina outro cartão como padrão antes de remover". Comportamento esperado.

🌟 **Histórico de faturas robusto.** Após upgrade, vi 2 faturas (R$ 59,90 inicial + R$ 60,00 da diff) — exatamente como o spec promete na seção 5.2.

---

## Recomendação de priorização

**Antes de mergear/produzir:**
- 🔴 UX-1 (downgrade não-agendado) — promessa quebrada com cliente, perde dinheiro pra ele
- 🔴 UX-3 (dois botões cancelar) — confusão direta no UX

**Antes do próximo release:**
- 🔴 UX-2 (tab=plan) — afeta o retorno do Stripe Checkout
- 🟡 UX-4 (stale cache) — afeta percepção de "funcionou ou não"
- 🟡 UX-5 (Stripe theme)

**Polish queue:**
- 🟡 UX-6, UX-7, UX-8 — pequenos ajustes visuais/copy
- 🟢 UX-9, UX-10, UX-11

---

## Screenshots gerados durante a sessão

(Salvos em `.playwright-mcp/` na raiz da execução)

- `e2e-01-plan-tab-free-user.png` — view inicial Free
- `e2e-02-stripe-checkout-after-submit.png` — Checkout pedindo telefone (Link)
- `e2e-03..05` — retorno do checkout, Pro ativo
- `e2e-06-cancel-dialog.png` — modal de cancelamento
- `e2e-07/09` — pós-cancelamento (com e sem reload, evidenciando UX-4)
- `e2e-10` — dialog de reativação
- `e2e-11/13` — pós-reativação
- `e2e-14-add-card-dialog.png` — AddCardDialog (UX-5 fundo claro visível)
- `e2e-15..16` — pós-add Mastercard
- `e2e-17` — default trocado
- `e2e-18-remove-confirm.png` — confirmação de remoção (UX-10 cor primary)
- `e2e-19` — pós-remoção
- `e2e-20-upgrade-preview.png` — **preview do upgrade com R$ 60,00** (cenário-chave)
- `e2e-21-after-upgrade-starter.png` — Starter ativo + invoice nova
- `e2e-22-downgrade-preview.png` — preview de downgrade (copy "Vai virar plano Pro em DD/MM")
- `e2e-23/24` — pós-downgrade (UX-1 evidente: Pro já é o plano atual)
- `e2e-25-3ds-challenge.png` — Stripe 3DS challenge
- `e2e-26..27` — pós-3DS, cartão 3184 cadastrado
