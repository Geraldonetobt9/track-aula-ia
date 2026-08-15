# Self-serve billing — E2E test plan

> **Para:** validação manual via Playwright contra `localhost:5173` + `localhost:3001` em Stripe test mode.
> **Pre-reqs:** `npm run dev` rodando, `STRIPE_SECRET_KEY=sk_test_...` no backend, `VITE_STRIPE_PUBLISHABLE_KEY=pk_test_...` no frontend, `stripe listen --forward-to http://localhost:3001/api/stripe/webhook` ativo, `STRIPE_WEBHOOK_SECRET` correspondente, plan_rules em test mode com price IDs populados.

---

## Cenários

### Phase 1 — Setup (cria o usuário Pro que vamos usar)

**S1. Signup → primeiro upgrade Free → Pro via Stripe Checkout**
- Sign up novo user `e2e-test-{timestamp}@test.local` / senha forte
- Settings → aba Plano → "Fazer upgrade" no card Pro
- Stripe Checkout abre (em `checkout.stripe.com` ou tab nova)
- Cartão: `4242 4242 4242 4242`, expiração futura, CVC `123`, ZIP qualquer
- Submit → retorna pra `/settings?tab=plan&status=success`
- ✅ Card "Plano atual" mostra Pro
- ✅ "Próxima cobrança" populada
- ✅ "Adicionar cartão" agora visível
- ✅ Histórico de faturas mostra fatura inicial

### Phase 2 — Cancelamento

**S2. Cancelar assinatura in-app**
- `CurrentPlanCard` → botão "Cancelar assinatura" (variant ghost destructive)
- ✅ AlertDialog abre com plano correto + data formatada (DD de mês de YYYY)
- Confirma "Sim, cancelar"
- ✅ Toast "Cancelamento agendado para DD/MM/AAAA"
- ✅ Card transita pra chip "Cancelamento agendado" + botão "Reativar assinatura"

**S3. Reativar assinatura cancelada**
- Botão "Reativar assinatura" (success colored)
- ✅ AlertDialog confirma data
- Confirma "Sim, reativar"
- ✅ Card volta pra estado ativo

### Phase 3 — Adicionar cartão in-app

**S4. Adicionar cartão via PaymentElement**
- `PaymentMethodsCard` → "Adicionar cartão"
- ✅ Modal abre, "Preparando formulário..." enquanto SetupIntent é criado
- ✅ Stripe Elements carrega com tema dark
- Preenche `4242 4242 4242 4242`, expiração, CVC, ZIP
- Marca "Definir como cartão padrão" (já é o único, mas testa o checkbox)
- Click "Salvar cartão"
- ✅ Modal fecha, card aparece na lista, badge "Padrão"

**S5. Adicionar 2º cartão (Mastercard)**
- Adiciona `5555 5555 5555 4444` sem marcar default
- ✅ Card aparece na lista, sem badge "Padrão"

### Phase 4 — Gerenciamento de cartões

**S6. Definir 2º cartão como padrão**
- Botão "Definir como padrão" no Mastercard
- ✅ Toast, badge "Padrão" muda

**S7. Remoção de cartão**
- Tenta remover o cartão default → ✅ botão de lixeira desabilitado (tooltip)
- Remove o cartão não-default → confirmação → toast → card some

### Phase 5 — Upgrade com diff

**S8. Upgrade Pro → Starter (cobra R$ 60,00)**
- `PlanCards` → card Starter → "Trocar plano"
- ✅ `PlanSwitchDialog` carrega "Calculando..."
- ✅ Mostra "Diferença a pagar agora: R$ 60,00"
- ✅ Mostra "Próxima cobrança · DD/MM" preservada com R$ 119,90
- ✅ Copy: "A troca é imediata. Você paga a diferença do plano agora..."
- "Confirmar troca"
- ✅ Plano vira Starter
- ✅ Histórico de faturas mostra fatura nova R$ 60,00

### Phase 6 — Downgrade

**S9. Downgrade Starter → Pro**
- Card Pro → "Trocar plano"
- ✅ Modal mostra "Vai virar plano pro em DD/MM"
- ✅ Copy de downgrade: "Sem cobrança extra agora. A próxima fatura sai por R$ 59,90"
- ✅ NÃO mostra "Diferença a pagar agora"
- "Confirmar troca"
- ✅ Card mostra alerta de "Alteração agendada"

### Phase 7 — Edge cases

**S10. Add card 3DS** (`4000 0027 6000 3184`)
- Adicionar cartão → preenche este número
- ✅ Stripe abre challenge 3DS no iframe
- "Complete authentication" → ✅ cartão adicionado
- Limpa: remove esse cartão depois

---

## UX/UI a avaliar em paralelo

- **`CurrentPlanCard` action buttons:** ordem (Manage → Cancel ou Cancel → Manage?), cor destructive faz sentido?
- **Stripe Elements integração visual:** `theme: 'night'` casa com a paleta lime/dark do app? Border, focus states, espaçamento do iframe.
- **Modal sizing:** fica confortável no desktop? Em ~400px? Testar resize.
- **Loading states:** "Preparando formulário..." e "Calculando..." são claros? Tempo aceitável?
- **Copy:** mensagens de erro em pt-BR são claras? Toast timing apropriado?
- **Histórico de faturas:** a invoice avulsa de upgrade aparece com PDF + link?
- **Hierarquia visual:** botão "Confirmar troca" no `PlanSwitchDialog` se destaca o suficiente?
- **Estados desabilitados:** lixeira no cartão default é claramente desabilitada (tooltip explicativo)?
- **Empty state:** sem cartão adicionado, o `PaymentMethodsCard` tem texto adequado?
- **Acessibilidade:** foco no modal vai pro primeiro elemento? Esc fecha?

---

## Como reportar resultados

Pra cada cenário, marcar:
- ✅ Passou — comportamento conforme esperado
- ⚠️ Funcionou com observação — descrever a observação UX/UI
- ❌ Falhou — descrever o gap, capturar screenshot

UX findings agregados no fim com prioridade (Crítico / Importante / Polir).
