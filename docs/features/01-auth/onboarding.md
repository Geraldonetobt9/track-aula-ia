# Onboarding

## 1. Proposito

Guiar novos usuarios pelos passos essenciais de configuracao da plataforma Sentinela apos o cadastro: conectar conta do Facebook Ads, configurar webhook do checkout e verificar que tudo esta funcional. O fluxo e um wizard de 3 etapas que garante que o usuario tenha o minimo necessario para comecar a rastrear metricas.

---

## 2. Comportamento para o Usuario

### 2.1 Pontos de Entrada

| Rota          | Descricao                                 | Protegida |
|---------------|-------------------------------------------|-----------|
| `/onboarding` | Wizard de 3 etapas pos-cadastro           | Sim       |

O usuario e redirecionado para `/onboarding` automaticamente apos registro bem-sucedido. A rota e protegida pelo `ProtectedRoute` (requer autenticacao).

### 2.2 Fluxo de UI

**Etapa 1 - Conectar Facebook Ads:**
1. Exibe formulario com dois campos: User Access Token (long-lived) e Ad Account ID
2. Campo Access Token e do tipo password (oculto por padrao)
3. Ad Account ID aceita formato `act_XXXXXXXXX`
4. Botao "Salvar Credenciais" chama `useFacebookConnection.saveConnection()` com app_id e app_secret fixos como `onboarding_default`
5. Apos salvar, executa `validateConnection()` automaticamente
6. Se sucesso, exibe estado de "Facebook configurado com sucesso!" com icone de check verde
7. Exibe texto "Credenciais validadas" ou "Aguardando validacao" conforme `isValid`
8. Botao "Proximo" habilitado somente se `isConfigured === true`

**Etapa 2 - Configurar Checkout:**
1. Select com opcoes: Hotmart, Kiwify, Kirvano
2. Apos selecionar plataforma, exibe URL de webhook gerada: `https://api.sentinel.app/webhook/{plataforma}/abc123`
3. Botao de copiar URL para clipboard com feedback visual (icone muda para check por 2s)
4. Toast de confirmacao "URL copiada! Cole essa URL nas configuracoes do seu checkout."
5. Instrucao textual orientando a colar a URL na plataforma selecionada
6. Botao "Proximo" habilitado somente se uma plataforma foi selecionada

**Etapa 3 - Verificar Conexoes:**
1. Exibe card do Facebook Ads com badge "Conectado"
2. Exibe card do checkout selecionado com badge "Ativo"
3. Mensagem de conclusao: "Tudo pronto! Agora voce pode acompanhar o ROI real das suas campanhas."
4. Botao "Ir para Dashboard" remove `sentinel_needsOnboarding` do localStorage e navega para `/dashboard`

**Navegacao geral do wizard:**
- Barra de progresso no topo com 3 circulos numerados e linhas conectoras
- Circulos preenchidos para etapas concluidas (com icone check), vazios para pendentes
- Botao "Voltar" disponivel a partir da etapa 2
- Labels abaixo dos circulos: "Conectar Facebook", "Configurar Checkout", "Verificar Dados"

### 2.3 Permissoes

| Acao                       | Permissao Necessaria |
|----------------------------|----------------------|
| Acessar `/onboarding`      | Qualquer usuario autenticado |
| Salvar conexao Facebook    | Qualquer usuario autenticado |
| Gerar webhook URL          | Qualquer usuario autenticado |

---

## 3. Regras de Negocio

| #  | Regra                                    | Condicao                                    | Resultado Esperado                                       |
|----|------------------------------------------|---------------------------------------------|----------------------------------------------------------|
| 1  | Campos obrigatorios no Step 1            | Access Token ou Ad Account ID vazios        | Toast "Campos obrigatorios" e botao de salvar desabilitado |
| 2  | Validacao de conexao pos-save            | Credenciais salvas com sucesso              | `validateConnection()` executado automaticamente         |
| 3  | Progresso controlado                     | Step 1 nao concluido                        | Botao "Proximo" desabilitado                             |
| 4  | Selecao de checkout obrigatoria          | Step 2 sem plataforma selecionada           | Botao "Proximo" desabilitado                             |
| 5  | Webhook URL gerada dinamicamente         | Plataforma selecionada                      | URL com nome da plataforma em lowercase                  |
| 6  | Finalizacao remove flag de onboarding    | Usuario clica "Ir para Dashboard" no Step 3 | `localStorage.removeItem('sentinel_needsOnboarding')`    |
| 7  | Redirecionamento pos-onboarding          | Flag de onboarding removida                 | Navegacao para `/dashboard`                              |
| 8  | Credenciais fixas de app no onboarding   | Salvamento de conexao no Step 1             | `app_id` e `app_secret` definidos como `onboarding_default` |

---

## 4. Modelo de Dados

### 4.1 Tabelas

O onboarding utiliza as mesmas tabelas da feature de Integracoes do Facebook:

**facebook_connections**
| Coluna        | Tipo      | Descricao                              |
|---------------|-----------|----------------------------------------|
| id            | uuid (PK) | Identificador unico                    |
| user_id       | uuid (FK) | Dono da conexao                        |
| app_id        | text      | Facebook App ID (ou `onboarding_default`) |
| app_secret    | text      | Facebook App Secret                    |
| access_token  | text      | User Access Token long-lived           |
| ad_account_id | text      | ID da conta de anuncios (act_xxx)      |
| is_valid      | boolean   | Se a conexao foi validada com sucesso  |
| created_at    | timestamp | Data de criacao                        |

### 4.2 Relacionamentos

- `facebook_connections.user_id` -> `auth.users.id`

### 4.3 Constraints

- RLS: `user_id = auth.uid()`
- `ad_account_id` deve comecar com `act_` (validacao no frontend)
- `access_token` nao pode ser vazio

---

## 5. API / Backend

### 5.1 Endpoints

| Metodo | Path                                    | Guard     | Descricao                             |
|--------|-----------------------------------------|-----------|---------------------------------------|
| GET    | `/api/facebook/auth/connect`            | Token via query | Inicia OAuth — redireciona para o Facebook |
| GET    | `/api/facebook/auth/callback`           | State CSRF | Callback do Facebook — salva conexoes |
| GET    | `/api/facebook/connections`             | AuthGuard | Lista conexoes do usuario             |

> **Nota:** o fluxo manual antigo (POST `/connections` com app_id/secret/token) e o endpoint `POST /connections/:id/validate` foram substituidos pelo OAuth. O restante deste documento ainda descreve a versao anterior do wizard.

### 5.2 Logica do Service

**saveConnection:**
1. Recebe `app_id`, `app_secret`, `access_token`, `ad_account_id`
2. Faz upsert na tabela `facebook_connections` para o `user_id`
3. Retorna o registro criado/atualizado

**validateConnection:**
1. Busca a conexao pelo `connection_id` e `user_id`
2. Faz chamada de teste a API do Facebook com o `access_token`
3. Atualiza campo `is_valid` conforme resultado

---

## 6. Implementacao no Frontend

### 6.1 Paginas/Componentes

| Componente | Arquivo                      | Descricao                                    |
|------------|------------------------------|----------------------------------------------|
| Onboarding | `src/pages/Onboarding.tsx`   | Pagina principal com wizard de 3 etapas      |

Componentes UI utilizados: Card, CardHeader, CardTitle, CardDescription, CardContent, Select, Input, Label, Badge, Button (todos de `@/components/ui/`)

### 6.2 Hooks

| Hook                  | Arquivo                              | Descricao                                |
|-----------------------|--------------------------------------|------------------------------------------|
| useFacebookConnection | `src/hooks/useFacebookConnection.ts` | saveConnection, validateConnection, saving, isConfigured, isValid |
| useToast              | `src/hooks/use-toast.ts`             | Exibicao de notificacoes toast           |

### 6.3 Estado

Estado local do componente Onboarding:
- `currentStep: number` (1, 2 ou 3)
- `selectedCheckout: string` (plataforma selecionada)
- `copied: boolean` (feedback de copia da URL)
- `accessToken: string` (input do token)
- `adAccountId: string` (input do ad account)

Estado derivado do hook:
- `saving: boolean` (salvando conexao)
- `isConfigured: boolean` (conexao existe)
- `isValid: boolean` (conexao validada)
- `facebookConnected` (alias para `isConfigured`)

---

## 7. Pontos de Integracao

| Sistema             | Tipo       | Descricao                                              |
|---------------------|------------|--------------------------------------------------------|
| Facebook Graph API  | REST       | Validacao do access token e ad account                 |
| Supabase            | DB         | Persistencia das credenciais na tabela facebook_connections |
| Backend NestJS      | REST API   | Endpoints de conexao via FacebookController            |
| localStorage        | Browser    | Flag `sentinel_needsOnboarding` para controle de fluxo |

---

## 8. Edge Cases e Tratamento de Erros

| Cenario                                    | Tratamento                                                  |
|--------------------------------------------|-------------------------------------------------------------|
| Token do Facebook invalido                 | Validacao falha; `isValid` permanece false; usuario pode tentar novamente |
| Ad Account ID em formato incorreto         | Nenhuma validacao de formato no frontend (apenas orientacao textual) |
| Perda de conexao durante save              | Erro capturado; toast de erro exibido                       |
| Usuario sai do onboarding antes de terminar| Flag permanece no localStorage; pode voltar depois          |
| Clipboard API indisponivel                 | `navigator.clipboard.writeText` falha silenciosamente       |
| Botao "Salvar" clicado com campos vazios   | Botao desabilitado por `disabled={saving \|\| !accessToken \|\| !adAccountId}` |
| Webhook URL com placeholder                | URL gerada com `abc123` como identificador (placeholder)    |

---

## 9. Checklist de Testes

- [ ] Step 1: formulario exibe campos de Access Token e Ad Account ID
- [ ] Step 1: botao "Salvar Credenciais" desabilitado com campos vazios
- [ ] Step 1: salvar credenciais chama `saveConnection` com payload correto
- [ ] Step 1: validacao automatica apos save bem-sucedido
- [ ] Step 1: estado de sucesso exibe icone check e mensagem de confirmacao
- [ ] Step 1: botao "Proximo" desabilitado ate conexao configurada
- [ ] Step 2: select exibe opcoes Hotmart, Kiwify, Kirvano
- [ ] Step 2: selecionar plataforma gera URL de webhook correta
- [ ] Step 2: botao copiar copia URL para clipboard e exibe feedback
- [ ] Step 2: botao "Proximo" desabilitado sem selecao de plataforma
- [ ] Step 3: exibe cards de Facebook e checkout com status correto
- [ ] Step 3: botao "Ir para Dashboard" remove flag e navega para `/dashboard`
- [ ] Navegacao: botao "Voltar" funciona nos steps 2 e 3
- [ ] Barra de progresso reflete step atual corretamente

---

## 10. Questoes Abertas / TODOs

- [ ] A URL de webhook gerada no onboarding usa placeholder `abc123` em vez de um identificador real do usuario. Necessario integrar com a geracao real de webhook.
- [ ] `app_id` e `app_secret` sao salvos como `onboarding_default`. O fluxo de Integracoes permite configurar valores reais depois.
- [ ] Considerar adicionar Step 4 para primeira sincronizacao automatica de dados do Facebook.
- [ ] O onboarding nao verifica se o webhook realmente foi configurado no checkout. Considerar ping de verificacao.
- [ ] Registro de usuarios esta desativado (`/register` redireciona para `/login`), o que torna o onboarding inacessivel para novos usuarios via fluxo publico.
