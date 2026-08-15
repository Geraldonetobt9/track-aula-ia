# Canal `accountChanges`

> **Modulo:** `packages/backend/src/shared/services/discord-logger.service.ts`
> **Ultima atualizacao:** 2026-05-02
> **Status:** Implementado

---

## 1. Proposito

Logs estruturados de mudancas no perfil do usuario (nome, e-mail, CPF/CNPJ, senha),
disparados pelos endpoints `PATCH /api/me/*`.

---

## 2. Embed Verde — Sucesso

Formato basico:

```
✏️ Conta alterada
👤 Usuário       <email>
🆔 ID             <user_id>
🔧 Campo         Nome | E-mail | Documento (CPF/CNPJ) | Senha
↩️ De             <valor antigo>      (omitido em senha)
↪️ Para           <valor novo>        (omitido em senha)
☁️ Stripe        ✅ sincronizado | ⚠️ pendente   (apenas em e-mail e tax_id quando ha customer)
🕐 Horário       <iso>
```

**Notas:**
- Para `field=password`, exibe apenas "Senha alterada" — nunca o valor.
- Para `field=email` ou `field=tax_id` com `stripe_customer_id`, inclui status de sincronizacao.
- Se Stripe falhar (best-effort), exibe `⚠️ pendente` e a mudanca nao e considerada erro — o usuario ve sucesso no frontend.

---

## 3. Embed Vermelho — Erro

Formato para falhas:

```
❌ Falha ao alterar conta
👤 Usuário       <email>
🆔 ID             <user_id>
🔧 Campo         Nome | E-mail | Documento (CPF/CNPJ) | Senha
🎯 Tentou        <valor tentado>     (omitido em senha)
🪜 Etapa         validation | auth | profile | stripe | revoke_sessions
📋 Motivo        <mensagem do erro>
🕐 Horário       <iso>
```

**Etapas logadas:**
- `validation` — validacao falhou (ex: email duplicado, CPF invalido)
- `auth` — falha ao atualizar Supabase Auth
- `profile` — falha ao atualizar tabela `profiles`
- `stripe` — falha ao sincronizar com Stripe (NAO gera embed vermelho, vira `⚠️ pendente` no verde)
- `revoke_sessions` — falha ao revogar sessoes ativas apos mudanca de email/senha

---

## 4. Causas de Erro

| Etapa | Exemplo de Motivo |
|-------|---|
| validation | Email already exists in `profiles.email` |
| validation | Invalid tax ID format |
| auth | Supabase Auth: email already in use (outro usuario) |
| auth | Supabase Auth: unable to revoke sessions |
| profile | Database constraint violation |
| stripe | Stripe customer not found (best-effort, nao e erro) |

---

## 5. Origem

### 5.1 Service

`packages/backend/src/shared/services/discord-logger.service.ts`

Metodos:
- `logAccountChangeSuccess(data: AccountChangeSuccessData)`
- `logAccountChangeError(data: AccountChangeErrorData)`

### 5.2 Configuracao

URL do webhook configurada em `packages/backend/src/config/discord-webhooks.config.ts` sob a chave `accountChanges`.

### 5.3 Dispatcher

Account controller dispara logs apos cada `PATCH /api/me/*`:

```typescript
// Pseudocodigo
try {
  const result = await this.accountService.updateProfile(userId, dto);
  await this.discordLogger.logAccountChangeSuccess({
    userId,
    userEmail,
    field: 'name',  // or 'email', 'tax_id', 'password'
    before: oldValue,
    after: newValue,
    stripeSynced: true  // or false, or omit if not applicable
  });
} catch (error) {
  await this.discordLogger.logAccountChangeError({
    userId,
    userEmail,
    field: 'name',  // or 'email', 'tax_id', 'password'
    stage: 'profile',  // or 'validation', 'auth', 'stripe', 'revoke_sessions'
    attempted: dto.name,
    errorMessage: error.message
  });
  throw error;
}
```

---

## 6. Tipos de Dados

Definidos em `packages/backend/src/shared/services/discord-logger.service.ts`:

```typescript
export interface AccountChangeSuccessData {
  userId: string;
  userEmail: string;
  field: 'name' | 'email' | 'tax_id' | 'password';
  before?: string;     // omitido para password
  after?: string;      // omitido para password
  stripeSynced?: boolean;  // apenas para email/tax_id com Stripe customer
}

export interface AccountChangeErrorData {
  userId: string;
  userEmail: string;
  field: 'name' | 'email' | 'tax_id' | 'password';
  attempted?: string;  // omitido para password
  errorMessage: string;
  stage: 'validation' | 'auth' | 'profile' | 'stripe' | 'revoke_sessions';
}
```

**Campo `field`**: 
- `'name'` — alteracao de nome completo
- `'email'` — alteracao de email da conta
- `'tax_id'` — alteracao de CPF/CNPJ (documento)
- `'password'` — alteracao de senha

**Campo `stripeSynced`** (sucesso apenas):
- `true` — mudanca foi sincronizada com sucesso no Stripe
- `false` — mudanca nao foi sincronizada (best-effort, nao bloqueia operacao)
- ausente — nao e aplicavel (ex: campo 'password' ou sem Stripe customer)

**Campo `stage`** (erro apenas):
- `'validation'` — validacao dos dados de entrada falhou
- `'auth'` — falha ao atualizar Supabase Auth
- `'profile'` — falha ao atualizar tabela `profiles`
- `'stripe'` — falha ao sincronizar com Stripe (best-effort, nao gera embed vermelho)
- `'revoke_sessions'` — falha ao revogar sessoes ativas

---

## 7. Rate Limiting e Silenciamento

O canal `accountChanges` nao e critico — mudancas de perfil nao sao operacoes de alta frequencia.

- Sem rate limiting especial: tipicamente < 10 mensagens/hora
- Se um usuario faz muitas tentativas falhadas em curto tempo, cada uma dispara um embed vermelho (comportamento esperado para auditoria)

---

## 8. Interpretacao pelo Time de Suporte

| Caso | O que fazer |
|---|---|
| Usuario reporta "nao consigo alterar email" | Ver embeds vermelhos recentes para `field=email`, filtrar por email do usuario |
| Email duplicado | Embed vermelho com `stage=validation` indicando conflito. Verificar se outro usuario existe com esse email |
| Mudanca nao apareceu no Discord | Frontend pode ter falhado antes de disparar a mutacao, ou timeout na chamada ao Discord. Verificar logs do servidor (Logger Nest) |

---

## 9. Exemplo de Payload Real

### Sucesso — Alteracao de Nome

```json
{
  "userId": "f336d0bc-b841-465b-8045-024475c079dd",
  "userEmail": "carlos@example.com",
  "field": "name",
  "before": "Carlos Silva",
  "after": "Carlos Eduardo Silva"
}
```

### Sucesso — Alteracao de Email com Stripe

```json
{
  "userId": "f336d0bc-b841-465b-8045-024475c079dd",
  "userEmail": "carlos@example.com",
  "field": "email",
  "before": "carlos@example.com",
  "after": "carlo.silva@example.com",
  "stripeSynced": false
}
```

### Sucesso — Alteracao de Senha

```json
{
  "userId": "f336d0bc-b841-465b-8045-024475c079dd",
  "userEmail": "carlos@example.com",
  "field": "password"
}
```

### Erro — CPF Invalido

```json
{
  "userId": "f336d0bc-b841-465b-8045-024475c079dd",
  "userEmail": "carlos@example.com",
  "field": "tax_id",
  "attempted": "123.456.789-00",
  "stage": "validation",
  "errorMessage": "Invalid tax ID format (expected 11 digits for CPF)"
}
```

### Erro — Falha ao Revogar Sessoes

```json
{
  "userId": "f336d0bc-b841-465b-8045-024475c079dd",
  "userEmail": "carlos@example.com",
  "field": "email",
  "attempted": "carlo.silva@example.com",
  "stage": "revoke_sessions",
  "errorMessage": "Supabase Auth: unable to revoke sessions"
}
```

---

## 10. Evolucao Futura

- [ ] Adicionar hash/checksum para deteccao de mudancas nao esperadas (ex: alguem alterou email via SQL direto, sem passar pela API)
- [ ] Audit trail: salvar log estruturado em tabela `audit_logs` alem do Discord (para compliance)
- [ ] Rate limit por usuario: se 5+ tentativas falhadas em 10min, bloquear por 5min (protecao contra brute-force)
