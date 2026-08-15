# Autenticacao e Autorizacao

## 1. Proposito

Gerenciar o ciclo completo de autenticacao dos usuarios da plataforma Sentinela: cadastro, login, logout, recuperacao de senha e controle de acesso baseado em roles (user/admin). A autenticacao e delegada ao Supabase Auth com JWT, enquanto a autorizacao e implementada via guards no backend NestJS e ProtectedRoute no frontend React.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Rota               | Descricao                                      | Protegida |
|--------------------|-------------------------------------------------|-----------|
| `/login`           | Formulario de login com email e senha           | Nao       |
| `/register`        | Redireciona para `/login` (registro desativado) | Nao       |
| `/forgot-password` | Solicitar link de recuperacao de senha por email | Nao       |
| `/reset-password`  | Definir nova senha via token de recuperacao      | Nao       |
| `/onboarding`      | Wizard pos-cadastro (3 etapas)                  | Sim       |
| `/dashboard`       | Rota padrao apos login de usuario comum          | Sim       |
| `/admin`           | Rota padrao apos login de administrador          | Sim (admin)|

### 2.2 Fluxo de UI

**Login:**
1. Usuario acessa `/login`
2. Preenche email e senha
3. Clica em "Entrar"
4. `AuthContext.login()` chama `supabase.auth.signInWithPassword()`
5. Se sucesso, busca perfil na tabela `profiles` e role na tabela `user_roles`
6. Se `role === 'admin'`, redireciona para `/admin`; caso contrario, para `/dashboard`
7. Se falha, exibe toast "E-mail ou senha incorretos"

**Registro (fluxo original, atualmente desativado via redirect):**
1. Usuario preenche nome, email, senha e confirmacao de senha
2. Aceita termos de uso e politica de privacidade (checkbox obrigatorio)
3. `AuthContext.register()` chama `supabase.auth.signUp()` com `emailRedirectTo`
4. Define `localStorage('adsTracker_needsOnboarding', 'true')`
5. Redireciona para `/onboarding`

**Recuperacao de Senha:**
1. Usuario acessa `/forgot-password`, informa email
2. `AuthContext.resetPassword()` chama `supabase.auth.resetPasswordForEmail()` com `redirectTo: /reset-password`
3. Email enviado com link contendo token de recuperacao
4. Usuario clica no link, abre `/reset-password`
5. Pagina valida sessao via `supabase.auth.onAuthStateChange` (evento `PASSWORD_RECOVERY`)
6. Usuario define nova senha (minimo 6 caracteres) e confirma
7. `supabase.auth.updateUser({ password })` atualiza a senha
8. Redireciona para `/dashboard` apos 2 segundos

**Logout:**
1. `AuthContext.logout()` chama `supabase.auth.signOut()`
2. Limpa estado local: user, session, supabaseUser
3. Remove `adsTracker_needsOnboarding` do localStorage
4. Remove `sentinel_auto_synced` do sessionStorage

### 2.3 Permissoes

| Role    | Acesso                                                        |
|---------|---------------------------------------------------------------|
| `user`  | Dashboard, Campanhas, Vendas, Integracoes, Financeiro, Config |
| `admin` | Tudo acima + painel admin (`/admin`, `/admin/users`, etc.)     |

---

## 3. Regras de Negocio

| #  | Regra                                  | Condicao                                          | Resultado Esperado                                                |
|----|----------------------------------------|---------------------------------------------------|-------------------------------------------------------------------|
| 1  | Autenticacao via JWT                   | Toda requisicao ao backend                        | Header `Authorization: Bearer <token>` obrigatorio                |
| 2  | Token invalido ou expirado             | `supabase.getUserFromToken()` retorna null         | HTTP 401 UnauthorizedException                                    |
| 3  | Acesso admin                           | Rota protegida com AdminGuard                     | Verifica `user_roles.role = 'admin'`; se nao, HTTP 403            |
| 4  | Role padrao no cadastro                | Novo usuario registrado                           | Role `user` atribuido por padrao                                  |
| 5  | Plano padrao no cadastro               | Novo usuario registrado                           | Plano `free` atribuido por padrao                                 |
| 6  | Confirmacao de senha                   | Registro e reset de senha                         | `password === confirmPassword`, senao exibe erro                  |
| 7  | Senha minima                           | Registro e reset de senha                         | Minimo 6 caracteres (validacao HTML + backend Supabase)           |
| 8  | Aceite de termos                       | Registro                                          | Checkbox obrigatorio; sem aceite, exibe toast de erro             |
| 9  | Timeout de inicializacao de auth       | Carregamento do AuthProvider                      | 12 segundos de timeout; se exceder, libera UI com isLoading=false |
| 10 | ProtectedRoute timeout                 | Carregamento de rota protegida                    | 12 segundos; apos timeout, exibe opcao de recarregar ou ir ao login |
| 11 | Redirecionamento admin no login        | `login()` retorna `isAdmin: true`                 | Redireciona para `/admin` em vez de `/dashboard`                  |
| 12 | RLS em todas as tabelas                | Qualquer query Supabase                           | `user_id = auth.uid()` filtra automaticamente                    |
| 13 | Link de recuperacao expirado           | URL sem hash `type=recovery` ou sessao invalida    | Redireciona para `/forgot-password` com toast de erro             |

---

## 4. Modelo de Dados

### 4.1 Tabelas

**profiles**
| Coluna            | Tipo      | Descricao                        |
|-------------------|-----------|----------------------------------|
| user_id           | uuid (PK) | FK para auth.users.id            |
| name              | text      | Nome completo do usuario         |
| email             | text      | Email do usuario                 |
| plan              | text      | Plano atual (free, starter, pro, enterprise, unlimited) |
| avatar_url        | text      | URL do avatar                    |
| active            | boolean   | Se a conta esta ativa            |
| subscription_end  | timestamp | Data de fim da assinatura        |
| created_at        | timestamp | Data de criacao                  |

**user_roles**
| Coluna  | Tipo      | Descricao                  |
|---------|-----------|----------------------------|
| user_id | uuid (PK) | FK para auth.users.id      |
| role    | text      | `user` ou `admin`          |

### 4.2 Relacionamentos

- `profiles.user_id` -> `auth.users.id` (1:1)
- `user_roles.user_id` -> `auth.users.id` (1:1)

### 4.3 Constraints

- `profiles.user_id` e `user_roles.user_id` sao chaves primarias e foreign keys para `auth.users.id`
- RLS habilitado: `user_id = auth.uid()` em leitura e escrita
- `user_roles.role` aceita apenas `user` ou `admin`
- Supabase Auth gerencia hash de senha, tokens JWT e refresh tokens

---

## 5. API / Backend

### 5.1 Endpoints

Autenticacao e gerenciada diretamente pelo Supabase Auth SDK (sem endpoints custom no backend). O backend valida tokens via guards.

| Metodo | Path                                | Guard      | Descricao                          |
|--------|-------------------------------------|------------|------------------------------------|
| -      | `supabase.auth.signInWithPassword`  | -          | Login via SDK (frontend direto)    |
| -      | `supabase.auth.signUp`              | -          | Registro via SDK (frontend direto) |
| -      | `supabase.auth.signOut`             | -          | Logout via SDK (frontend direto)   |
| -      | `supabase.auth.resetPasswordForEmail`| -         | Solicitar reset via SDK            |
| -      | `supabase.auth.updateUser`          | -          | Atualizar senha via SDK            |

### 5.2 Logica do Service

**AuthGuard** (`packages/backend/src/common/guards/auth.guard.ts`):
1. Extrai header `Authorization: Bearer <token>`
2. Se ausente ou mal formatado, lanca `UnauthorizedException`
3. Chama `supabase.getUserFromToken(token)` para validar JWT
4. Se usuario nulo, lanca `UnauthorizedException`
5. Injeta `user` no objeto `request` para uso nos controllers

**AdminGuard** (`packages/backend/src/common/guards/admin.guard.ts`):
1. Verifica se `request.user` existe (depende de AuthGuard ter sido executado antes)
2. Chama `supabase.isAdmin(user.id)` para verificar na tabela `user_roles`
3. Se nao for admin, lanca `ForbiddenException`

**CurrentUser Decorator** (`packages/backend/src/common/decorators/current-user.decorator.ts`):
1. Decorator de parametro que extrai `request.user`
2. Aceita propriedade opcional: `@CurrentUser('id')` retorna apenas o id

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente             | Arquivo                                    | Descricao                                    |
|------------------------|--------------------------------------------|----------------------------------------------|
| Login                  | `src/pages/Login.tsx`                      | Formulario email/senha com toggle de visibilidade |
| Register               | `src/pages/Register.tsx`                   | Nome, email, senha, confirmar, termos (desativado) |
| ForgotPassword         | `src/pages/ForgotPassword.tsx`             | Campo email + envio de link de recuperacao   |
| ResetPassword          | `src/pages/ResetPassword.tsx`              | Nova senha + confirmacao com validacao de sessao |
| ProtectedRoute         | `src/components/ProtectedRoute.tsx`        | Wrapper que redireciona para `/login` se nao autenticado |

### 6.2 Hooks

| Hook      | Arquivo                           | Descricao                             |
|-----------|-----------------------------------|---------------------------------------|
| useAuth() | `src/contexts/AuthContext.tsx`     | Retorna user, session, isLoading, login, register, logout, resetPassword, updateUser |

### 6.3 Estado

**AuthContext** fornece:
- `user: User | null` - Perfil completo do usuario (id, name, email, role, plan, avatar_url, active, subscription_end)
- `supabaseUser: SupabaseUser | null` - Objeto nativo do Supabase Auth
- `session: Session | null` - Sessao ativa com access_token e refresh_token
- `isLoading: boolean` - True durante inicializacao do auth (ate 12s timeout)

**ProtectedRoute** controla:
- `timedOut: boolean` - True se loading exceder 12 segundos
- Redireciona para `/login` se `user === null`
- Redireciona para `/dashboard` se `requireAdmin === true` e `user.role !== 'admin'`

---

## 7. Pontos de Integracao

| Sistema         | Tipo        | Descricao                                              |
|-----------------|-------------|--------------------------------------------------------|
| Supabase Auth   | SDK direto  | signIn, signUp, signOut, resetPassword, updateUser     |
| Supabase DB     | RLS         | Todas as tabelas filtram por `auth.uid()`              |
| Backend NestJS  | JWT Bearer  | AuthGuard valida token em todas as rotas protegidas    |
| n8n Webhooks    | Fire-forget | Welcome email enviado automaticamente na criacao do perfil |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                    | Tratamento                                                    |
|--------------------------------------------|---------------------------------------------------------------|
| Token JWT expirado                         | Backend retorna 401; frontend redireciona para `/login`       |
| Sessao do Supabase perdida                 | `onAuthStateChange` detecta e limpa estado do AuthContext     |
| Email ja cadastrado no registro            | Toast "Este e-mail ja pode estar em uso ou ocorreu um erro"  |
| Senhas nao coincidem                       | Toast "As senhas nao coincidem" (validacao client-side)       |
| Termos nao aceitos                         | Toast "Voce precisa aceitar os termos de uso"                 |
| Inicializacao de auth demora > 12s         | AuthProvider libera UI; ProtectedRoute mostra opcao de reload |
| Link de recuperacao invalido/expirado      | Redireciona para `/forgot-password` com toast informativo     |
| Erro de rede no login                      | Toast generico "Ocorreu um erro ao fazer login"               |
| Conta inativa (active = false)             | Perfil retornado com `active: false`; UI pode restringir acesso |

---

## 9. Checklist de Testes

- [ ] Login com credenciais validas redireciona para `/dashboard`
- [ ] Login com credenciais de admin redireciona para `/admin`
- [ ] Login com credenciais invalidas exibe toast de erro
- [ ] Acesso a rota protegida sem autenticacao redireciona para `/login`
- [ ] Acesso a rota admin sem role admin redireciona para `/dashboard`
- [ ] Logout limpa estado e redireciona para `/login`
- [ ] Recuperacao de senha envia email e exibe confirmacao
- [ ] Reset de senha com token valido altera a senha
- [ ] Reset de senha com token invalido redireciona para `/forgot-password`
- [ ] Timeout de 12s no loading exibe opcao de recarregar
- [ ] AuthGuard rejeita request sem header Authorization
- [ ] AuthGuard rejeita request com token invalido
- [ ] AdminGuard rejeita usuario sem role admin
- [ ] CurrentUser decorator extrai user corretamente do request
- [ ] RLS impede acesso a dados de outros usuarios

---

## 10. Questoes Abertas / TODOs

- [ ] Registro esta desativado (rota `/register` redireciona para `/login`). Definir se sera reativado ou se o onboarding sera via convite.
- [ ] Implementar refresh automatico de token quando proximo da expiracao (atualmente depende do Supabase SDK).
- [ ] Avaliar implementacao de 2FA para contas admin.
- [ ] Definir politica de bloqueio apos tentativas de login falhas.
- [ ] Considerar implementacao de OAuth social (Google, Facebook) como alternativa ao email/senha.
- [ ] O campo `subscription_end` no perfil nao tem validacao ativa que bloqueie acesso apos expiracao.
