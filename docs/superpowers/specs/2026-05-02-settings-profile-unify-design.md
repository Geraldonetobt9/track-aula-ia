# Spec — Configurações / Perfil unificado

**Data:** 2026-05-02
**Autor:** Brainstorm com `mozo1926@gmail.com`
**Status:** Aguardando review final do usuário (pré-plano)

---

## 1. Contexto e motivação

A tela `/settings` hoje tem 4 abas: **Perfil**, **Segurança**, **Plano**, **Custos**. A aba Perfil só permite editar nome (e mostra e-mail bloqueado); a aba Segurança só troca senha. O usuário entende as duas como o mesmo conceito ("minha conta") e a separação por abas adiciona atrito desnecessário, especialmente para o público de suporte (não-técnico, baixa familiaridade com formulários).

Adicionalmente, hoje o usuário não consegue alterar **CPF/CNPJ** após o cadastro, mesmo que tenha mudado de pessoa física para empresa (ou vice-versa) — o documento influencia faturas Stripe e por isso precisa ser editável e estar em sincronia com o customer Stripe. O e-mail também é imutável após cadastro, o que cria fricção real (typo no signup, mudança de domínio etc.).

## 2. Objetivo

Unificar Perfil + Segurança em uma única aba "Perfil" estilo **ficha de informações** (read-only com ação de Editar inline por campo), permitindo que o usuário altere:

- **Nome** completo
- **E-mail** (com modal de confirmação + logout forçado)
- **Documento** (CPF ↔ CNPJ, com sincronização imediata na Stripe)
- **Senha** (apenas nova + confirmação, sem pedir senha atual)

Toda alteração — sucesso ou erro — gera um log estruturado no Discord, num canal interno dedicado.

## 3. Não-objetivos

- Reformular as abas Plano e Custos.
- Implementar foto de perfil real (botão "Alterar foto" continua presente, mas apenas como placeholder visual).
- Criar tela de auditoria/histórico de mudanças no app (somente log Discord).
- Adicionar verificação 2FA ou re-autenticação por senha no modal de e-mail.
- Criar rotina assíncrona de retry/ressincronização Stripe.
- Adicionar rate-limit por usuário nos endpoints `/me/*`.

## 4. Decisões-chave (validadas com o usuário)

| Decisão | Escolha |
|---|---|
| Layout da nova tela | **Opção A** — ficha empilhada em card único; cada item em linha com botão "Editar" |
| Senha pede senha atual? | **Não** — apenas nova + confirmação |
| Campos editáveis individualmente? | **Sim** — view por padrão, edit inline ao clicar Editar; um item por vez |
| E-mail tem confirmação? | **Sim, via modal** — após confirmar, sistema atualiza tudo e desloga o usuário, redirecionando para `/login` |
| Documento sincroniza com Stripe? | **Sim, imediatamente** — DB → Stripe (best-effort) na mesma request |
| Logs Discord em sucesso e erro | **Sim** — canal único `accountChanges` com embeds verde (sucesso) ou vermelho (erro) |
| Mascaramento de CPF/CNPJ no log | **Não** — log completo (canal admin interno) |

## 5. Frontend — UX e fluxos

### 5.1. Estrutura geral

A aba `Perfil` continua sendo a primeira de `/settings`. A aba `Segurança` é **removida**. O TabsList passa a ter: `Perfil`, `Plano`, `Custos`.

Dentro da aba Perfil, um único card glass (radius 16, padding consistente com `CurrentPlanCard`) contém:

1. Strip superior: avatar + nome + e-mail + chip "Conta ativa" + botão "Alterar foto" (placeholder).
2. Lista de itens em modo read-only com botão "Editar" (ou "Alterar senha") inline:
   - Nome completo
   - E-mail (com chip "Bloqueado" não — agora é editável)
   - Documento (`CPF · 529.982.247-25` ou `CNPJ · ...`)
   - Senha (`••••••••••••` + meta "Última alteração há X")

Apenas **um item edita por vez**; clicar Editar em outro item fecha o aberto. Cancelar restaura o valor original; Salvar comita e volta ao display.

### 5.2. Fluxo Nome

1. Editar → input simples com valor atual pré-preenchido.
2. Salvar → `PATCH /me/profile` com `{ name }`.
3. Sucesso: atualiza display, toast "Nome atualizado".
4. Erro: toast destructive com mensagem; permanece em modo edit.

### 5.3. Fluxo Documento (CPF/CNPJ)

1. Editar → form com:
   - Toggle CPF / CNPJ (mesmo radio do `SignupForm`)
   - Input mascarado dinamicamente (`formatTaxId` de `lib/tax-id.ts`)
   - Validação por dígitos verificadores em `onBlur` e ao tentar salvar
2. Trocar tipo limpa o input.
3. Salvar → `PATCH /me/tax-id` com `{ type: 'cpf' | 'cnpj', value }`.
4. Sucesso: display vira `CPF · 529.982.247-25` ou `CNPJ · 12.345.678/0001-90`; toast "Documento atualizado".
5. Erro: toast com motivo (validação, conflito de unicidade, etc.).

### 5.4. Fluxo E-mail (com confirmação + logout)

1. Editar → input de e-mail.
2. Salvar → frontend abre modal:

   > **Confirmar troca de e-mail**
   >
   > Vamos alterar seu e-mail de **`mozo1926@gmail.com`** para **`novo@email.com`**.
   >
   > Após confirmar, você vai ser **deslogado** e precisará fazer login novamente com o novo e-mail.
   >
   > [Cancelar] [Confirmar troca]

3. Cancelar: fecha modal, mantém modo edit.
4. Confirmar troca → `PATCH /me/email` com `{ email }`.
5. Sucesso (200):
   - Toast "E-mail alterado. Faça login com `novo@email.com`."
   - `await supabase.auth.signOut()` (limpa sessão local)
   - `queryClient.clear()` (limpa cache TanStack Query)
   - `navigate('/login?email_changed=1')`
6. `/login` lê `?email_changed=1` e mostra banner verde:
   > Seu e-mail foi alterado. Use **o novo endereço** para entrar.
7. Erros possíveis:
   - 409 (e-mail já em uso por outro usuário) → toast "Este e-mail já está em uso."
   - 400 (formato inválido) → toast "E-mail inválido."
   - 5xx → toast genérico "Não foi possível alterar agora. Tente novamente."

### 5.5. Fluxo Senha

1. Alterar senha → form com:
   - Nova senha (placeholder "Mínimo 8 caracteres")
   - Confirmar nova senha (validação inline "as senhas não coincidem")
2. Salvar → `PATCH /me/password` com `{ password }`.
3. Sucesso: toast "Senha alterada", display volta a `••••••••••••` com meta "Alterada agora há pouco".
4. Erro: toast com motivo.

### 5.6. Componentes

- `Settings.tsx` — remove TabsTrigger "security", remove TabsContent "security", remove estado `currentPassword`/`newPassword`/`confirmPassword`/`savingSecurity`, remove `handleChangePassword`. A aba Perfil passa a delegar para um novo componente.
- `components/profile/ProfileCard.tsx` (novo) — card com strip + lista de `EditableRow`.
- `components/profile/EditableRow.tsx` (novo) — primitivo: label, view-pane, edit-pane com slot para form custom, botões Salvar/Cancelar. Garante "um item edita por vez" via context interno do card.
- `components/profile/rows/NameRow.tsx`, `EmailRow.tsx`, `TaxIdRow.tsx`, `PasswordRow.tsx` (novos) — cada um implementa view + edit form do seu campo.
- `components/profile/ConfirmEmailChangeDialog.tsx` (novo) — usa `<AlertDialog>` (já no projeto).
- `hooks/useUpdateProfile.ts`, `useUpdateTaxId.ts`, `useUpdateEmail.ts`, `useUpdatePassword.ts` (novos) — TanStack Query mutations encapsulando os PATCHes; invalidam `['me']` em sucesso.
- `pages/Login.tsx` — ler `?email_changed=1` e renderizar banner. Limpar query string após exibir.

## 6. Backend — endpoints

Todos os endpoints abaixo são **autenticados** (`@UseGuards(AuthGuard)` que já existe). Body validado via DTOs com `class-validator`. Implementados em um novo módulo `account` (controller `AccountController`, service `AccountService`).

### 6.1. `PATCH /me/profile`

```ts
{ name: string }   // 1..120 chars, trimmed
```

1. Atualiza `profiles.name`.
2. `logAccountChangeSuccess({ field: 'name', before, after })`.
3. Retorna `{ name }`.

### 6.2. `PATCH /me/tax-id`

```ts
{ type: 'cpf' | 'cnpj', value: string }
```

1. Validar com `isValidTaxId(type, value)` de `shared/helpers/tax-id.ts` → 400 se inválido.
2. Normalizar para dígitos (`stripDigits`).
3. **Idempotência**: se valor atual no `profiles` já bate (mesmo type e mesmo value), retorna 200 sem efeito colateral e sem logar Discord.
4. `SELECT user_id, cpf, cnpj FROM profiles WHERE user_id = $1 FOR UPDATE` (serializa PATCHs paralelos).
5. `UPDATE profiles SET cpf = ?, cnpj = NULL` (se type=cpf) ou inverso. Captura erro de conflito de partial unique index → 409.
6. Carregar `subscriptions.stripe_customer_id`.
   - Se nulo: pular sincronização Stripe (será aplicada na criação do customer pelo `stripe-checkout.service`, que já lê CPF/CNPJ do profile).
   - Se presente:
     - `stripe.customers.taxIds.list(customerId)`.
     - Para cada tax_id retornado com `type in ('br_cpf', 'br_cnpj')`: `stripe.customers.taxIds.del(customerId, taxIdId)`.
     - `stripe.customers.taxIds.create(customerId, { type: 'br_cpf' | 'br_cnpj', value })`.
     - `stripe.customers.update(customerId, { metadata: { cpf, cnpj } })` para manter o metadata coerente.
7. Falha em qualquer chamada Stripe: log warning no servidor (Logger Nest), mas **resposta 200** com `stripeSynced: false`. O frontend exibe "Documento atualizado (sincronização externa pendente)". Não dispara `logAccountChangeError` Discord — isso seria duplicação, já que o passo 8 emite o embed de sucesso com `⚠️ Stripe pendente` no próprio campo.
8. `logAccountChangeSuccess({ field: 'tax_id', before, after, stripeSynced })`.
9. Retorna `{ type, value, stripeSynced }`.

### 6.3. `PATCH /me/email`

```ts
{ email: string }   // @IsEmail
```

Sequência (ordem importa — abortar a primeira falha não-recuperável):

1. Validar formato (`@IsEmail`).
2. **Duplicidade**: `auth.admin.listUsers({ email })` ou query em `profiles.email`. Se outro usuário já tem esse e-mail (não o próprio): 409. Se for o próprio (mesmo e-mail), retorna 200 sem efeito (idempotente, sem logar Discord).
3. **Auth**: `supabase.auth.admin.updateUserById(userId, { email, email_confirm: true })`. O `email_confirm: true` evita o fluxo de double-confirm do Supabase (já fizemos a confirmação via modal). Falha aqui aborta tudo → 500 + log Discord erro.
4. **DB**: `UPDATE profiles SET email = ? WHERE user_id = ?`. Falha aqui é incomum (race com trigger da seção 7). Se falhar, log Discord erro mas continua (Auth já mudou; trigger AFTER UPDATE em `auth.users` da seção 7 já cobre).
5. **Stripe** (best-effort): se há `stripe_customer_id`, `stripe.customers.update(customerId, { email })`. Falha aqui: log warning no servidor (Logger Nest), mas **não aborta** — resposta tem `stripeSynced: false` e o embed de sucesso (passo 7) representa o estado com `⚠️ Stripe pendente`. Sem chamada a `logAccountChangeError` (evita duplicação).
6. **Revoke sessions**: `supabase.auth.admin.signOut(userId, 'global')`. Invalida todos refresh tokens. Falha aqui é loggada mas não aborta — frontend faz signOut local mesmo assim.
7. `logAccountChangeSuccess({ field: 'email', before, after, stripeSynced })`.
8. Retorna 200 com `{ email, stripeSynced }`.

### 6.4. `PATCH /me/password`

```ts
{ password: string }   // min 8 chars
```

1. Valida tamanho mínimo.
2. `supabase.auth.admin.updateUserById(userId, { password })`.
3. `logAccountChangeSuccess({ field: 'password' })` (sem before/after).
4. Retorna 200.

## 7. Banco — migration

**Nova migration:** `supabase/migrations/<TIMESTAMP>_sync_profile_email_on_auth_update.sql`

```sql
-- Defesa em profundidade: se algum endpoint futuro alterar
-- auth.users.email sem passar pelo backend, profiles.email
-- não fica para trás.
CREATE OR REPLACE FUNCTION public.sync_profile_email()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
       SET email = NEW.email,
           updated_at = now()
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email();
```

Atualizar `SQL_DATABASE.md` — seção de triggers.

## 8. Discord — canal `accountChanges`

### 8.1. Configuração

Adicionar entry em `packages/backend/src/config/discord-webhooks.config.ts`:

```ts
accountChanges:
  'https://discord.com/api/webhooks/1500261344463814676/MqUt8QuelEgVVFLdxiJyRC9p0klig7vZ7LoavRrdxQnsYe76r_jClF4DZ14OY-2DhR_e',
```

E o mesmo no `discord-webhooks.config.example.ts` (placeholder).

### 8.2. Métodos novos no `DiscordLoggerService`

```ts
interface AccountChangeSuccessData {
  userId: string;
  userEmail: string;
  field: 'name' | 'email' | 'tax_id' | 'password';
  before?: string;
  after?: string;
  stripeSynced?: boolean;   // só relevante em email e tax_id quando há customer
}

interface AccountChangeErrorData {
  userId: string;
  userEmail: string;
  field: 'name' | 'email' | 'tax_id' | 'password';
  attempted?: string;
  errorMessage: string;
  stage: 'validation' | 'auth' | 'profile' | 'stripe' | 'revoke_sessions';
}

logAccountChangeSuccess(data: AccountChangeSuccessData): void;
logAccountChangeError(data: AccountChangeErrorData): void;
```

### 8.3. Formato do embed — sucesso (cor verde 0x00cc66)

```
✏️ Conta alterada
👤 Usuário      mozo1926@gmail.com
🆔 ID            d3a8f1e0-...
🔧 Campo        E-mail
↩️ De             mozo1926@gmail.com
↪️ Para           novo@email.com
☁️ Stripe        ✅ sincronizado
🕐 Horário      02/05/2026 14:33 BRT
```

Variações:
- `field=name`: De/Para mostram o nome.
- `field=tax_id`: De/Para mostram `CPF · 529.982.247-25` ou `CNPJ · 12.345.678/0001-90` (log **completo**, sem máscara).
- `field=password`: omite De/Para; campos exibem apenas "Senha alterada".
- `stripeSynced` só aparece em `email` e `tax_id`. Quando há customer Stripe e a sync falhou: `☁️ Stripe ⚠️ pendente`.

### 8.4. Formato do embed — erro (cor vermelha 0xff4444)

```
❌ Falha ao alterar conta
👤 Usuário      mozo1926@gmail.com
🆔 ID            d3a8f1e0-...
🔧 Campo        E-mail
🎯 Tentou       novo@email.com
🪜 Etapa        auth
📋 Motivo       Supabase Admin: User already registered
🕐 Horário      02/05/2026 14:33 BRT
```

`stage` possíveis em embed vermelho: `validation`, `auth`, `profile`. (Falhas de Stripe ou revoke_sessions não aparecem aqui — ficam só nos logs do servidor; a falha parcial de Stripe vira `⚠️ pendente` no embed verde.)

Para `field=password` em erro: `🎯 Tentou` é omitido (nunca logar valor de senha); `📋 Motivo` traz a mensagem do erro de Auth.

### 8.5. Pontos de chamada

Regra geral: **uma operação = um embed**. Sucesso parcial (Stripe falhou mas DB ok) é representado como embed verde com `⚠️ Stripe pendente`, não como dois embeds. Embeds vermelhos só aparecem quando a operação principal foi abortada e o usuário recebeu erro HTTP.

| Endpoint | Embed verde (sucesso) | Embed vermelho (erro) |
|---|---|---|
| `PATCH /me/profile` | após UPDATE bem-sucedido | falha de DB |
| `PATCH /me/tax-id` | após Stripe sync OU após DB se sem customer OU após DB com Stripe pendente (`stripeSynced=false`) | validação inválida, conflito unique constraint |
| `PATCH /me/email` | após `signOut(global)` (mesmo se Stripe falhou — vira `stripeSynced=false`) | duplicidade (409), falha Auth, falha DB |
| `PATCH /me/password` | após Auth update | falha Auth, validação |

`stage` no embed de erro indica onde quebrou: `validation`, `auth`, `profile`. Stripe e revoke_sessions nunca aparecem como `stage` em embed vermelho — falhas neles ficam refletidas como `stripeSynced=false` ou apenas no log do servidor.

### 8.6. Performance / robustez

Aproveita 100% a infra existente:
- Queue por URL com `MAX_QUEUE_SIZE=200` e descarte FIFO.
- Rate-limit `30/min` por webhook URL.
- Retry até 3x com queue position preservada.
- Batch 5 por ciclo (2s).
- `send()` é fire-and-forget; não bloqueia a resposta da API.
- Discord fora do ar nunca derruba a operação principal — fica na queue até voltar.

## 9. Documentação a atualizar

- `docs/features/10-settings/` — atualizar com:
  - Estrutura nova da aba Perfil
  - Endpoints `/me/*`
  - Fluxo de troca de e-mail (com modal + logout)
  - Fluxo de troca de tax_id (com sync Stripe)
  - Logs Discord
- `SQL_DATABASE.md` — incluir o trigger `on_auth_user_email_changed` e função `sync_profile_email`.
- `docs/features/13-discord-logs/` — adicionar canal `accountChanges` à lista, com exemplos de embed.

## 10. Critérios de aceite

- [ ] Aba "Segurança" não existe mais em `/settings`.
- [ ] Aba "Perfil" mostra nome, e-mail, documento e senha em modo read-only com botão Editar inline em cada um.
- [ ] Apenas um item entra em modo edit por vez.
- [ ] CPF/CNPJ tem toggle, máscara e validação por DV; trocar tipo limpa o input.
- [ ] Ao salvar documento válido, `profiles.cpf`/`profiles.cnpj` é atualizado e tax_id no Stripe customer é trocado (quando existe customer).
- [ ] Ao salvar e-mail, o modal de confirmação é exibido com os dois e-mails. Confirmar dispara `signOut(global)` e redireciona para `/login?email_changed=1`, que mostra banner.
- [ ] Após retornar à `/login`, o usuário consegue logar com o novo e-mail.
- [ ] `auth.users.email`, `profiles.email` e `customers.email` (Stripe) ficam consistentes após troca de e-mail.
- [ ] Senha pede apenas nova + confirmação (sem senha atual).
- [ ] Toda operação bem-sucedida gera embed verde no canal Discord `accountChanges`.
- [ ] Toda operação com falha (validação, conflito, erro de integração) gera embed vermelho no mesmo canal, indicando o `stage`.
- [ ] Discord fora do ar não derruba o endpoint.
- [ ] `EXPLAIN ANALYZE` nos `SELECT FOR UPDATE` em `profiles` continua usando `idx_profiles_user_id`.

## 11. Riscos e mitigações

| Risco | Mitigação |
|---|---|
| User digita e-mail errado e perde acesso | Modal de confirmação + banner em `/login` direcionando para suporte |
| Stripe out-of-sync após erro de rede | Log Discord erro com `stage='stripe'` para o operador agir; ações Stripe subsequentes (overage, checkout) reapresentam o tax_id atual |
| `email_confirm: true` no Supabase Admin pode pular validação importante | Aceitável — o gate de confirmação é o modal no frontend; a session revoke garante que o usuário antigo perde acesso imediatamente |
| Race condition entre dois PATCH /me/tax-id paralelos | `SELECT FOR UPDATE` no profile durante a operação |
| Discord rate-limit em pico de mudanças | Queue + descarte FIFO já tratam (perda silenciosa de logs antigos é aceitável neste canal) |
| Trigger AFTER UPDATE em `auth.users` pode quebrar fluxos do Supabase | Trigger é simples (UPDATE em uma única tabela); SECURITY DEFINER + search_path explícito; testar em staging antes |

---
