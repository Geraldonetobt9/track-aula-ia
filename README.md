# Dashboard Anibal

Dashboard de ROI de Facebook Ads: cruza o gasto de mídia com as vendas reais dos checkouts brasileiros.

Versão enxuta: um projeto só, sem workspaces, sem planos e sem cobrança.

## Diferenças principais

**Contas criadas só pelo admin.** Não existe página de registro. As contas são criadas à mão no painel do Supabase, e quem entra vê os mesmos dados — não há separação por usuário nem papéis.

**Conexão com o Meta por token.** O cliente cola o access token na tela de Integrações e o sistema descobre as contas de anúncio sozinho. Não existe mais app do Facebook, OAuth, `APP_ID` nem `APP_SECRET` para configurar.

**Um deploy só.** Frontend e API rodam juntos na Vercel.

## Telas

| Tela | Situação |
|---|---|
| Login | sem link para registro |
| Dashboard | |
| Campanhas | |
| Vendas | |
| Financeiro | |
| Regras de automação | |
| Integrações | conexão do Meta por token + checkouts |
| Configurações | |

Sem página de registro, sem aba VTurb, sem aba Eventos, sem painel admin.

## Fases

| # | Fase | Situação |
|---|---|---|
| 1 | Criação do banco de dados | ✅ pronta |
| 2 | Deploy no GitHub | ⏳ `anibal-riveros/dashboard-anibal` |
| 3 | Deploy na Vercel | ⏳ |

---

## Fase 1 — Criação do banco de dados

### 1. Criar o projeto no Supabase

Em [supabase.com/dashboard](https://supabase.com/dashboard), **New project**. Região **South America (São Paulo)**, para ficar perto dos usuários. Guarde a senha do banco.

### 2. Aplicar o schema

SQL Editor do painel: cole `supabase/schema_completo.sql` inteiro e execute uma vez.

Ou, se preferir em partes, os arquivos de `supabase/migrations/` na ordem, do `0001` ao `0010`. Pelo CLI:

```bash
supabase link --project-ref SEU_REF
supabase db push
```

> **Já aplicou a versão anterior, de 22 tabelas?** Rode `supabase/atualizacao_banco.sql` uma vez. Ele remove `gtm_events` e `app_secrets` (que saíram com as abas de Eventos e VTurb) e troca o dono único pela lista `app_users`, preservando o usuário que você já criou.

### 3. Fechar o cadastro

**Authentication → Providers → Email**: desligue **Enable signups**.

É o que garante que só o admin cria contas. Sem isso, qualquer pessoa com a chave anon poderia se cadastrar e entrar.

### 4. Criar os usuários

**Authentication → Users → Add user**, com o e-mail da pessoa e **Auto Confirm User** ligado. Repita para cada pessoa que precisar de acesso.

O trigger `register_new_user` registra cada uma em `app_users` na hora. Confira em **Table Editor → app_users**.

Para tirar o acesso de alguém sem apagar a conta, marque `is_active = false` nessa tabela.

### 5. Preencher as credenciais

```bash
cp .env.example .env.local
```

Preencha com os dados de **Settings → API** do seu projeto. Gere as duas chaves de criptografia:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`.env.local` está no `.gitignore` e nunca vai para o GitHub.

### 6. Conferir

Em **Database → Tables**: 20 tabelas, todas com *RLS enabled* marcado.

Teste rápido de que o vazamento está barrado — com a chave **anon**, sem login:

```bash
curl "$VITE_SUPABASE_URL/rest/v1/meta_credentials" \
  -H "apikey: $VITE_SUPABASE_ANON_KEY"
```

Tem que voltar `[]` ou erro de permissão. Se voltar dados, **pare** e revise `0010_rls_policies.sql`.

---

## Fase 2 — Deploy no GitHub

A fazer. Repositório de destino: `https://github.com/anibal-riveros/dashboard-anibal.git`

## Fase 3 — Deploy na Vercel

### 1. Importar o repositório

Em [vercel.com/new](https://vercel.com/new), importe `anibal-riveros/dashboard-anibal`.

A Vercel detecta Vite sozinha, e o `vercel.json` já fixa build, região `gru1` (São Paulo), rewrite de SPA e os headers de segurança. Não mude nada na tela de configuração.

### 2. Cadastrar as variáveis de ambiente

Antes do primeiro deploy, em **Environment Variables**, cadastre para *Production*, *Preview* e *Development*. Os valores são os mesmos do seu `.env.local`:

| Variável | Natureza |
|---|---|
| `SUPABASE_URL` | servidor |
| `SUPABASE_SERVICE_ROLE_KEY` | **secreta** — ignora RLS |
| `SUPABASE_JWT_SECRET` | **secreta** |
| `ENCRYPTION_KEY` | **secreta** — cifra os tokens |
| `VITE_SUPABASE_URL` | pública, entra no bundle |
| `VITE_SUPABASE_ANON_KEY` | pública, entra no bundle |
| `META_API_VERSION` | servidor |
| `APP_URL` | a URL da Vercel, depois do primeiro deploy |

As `VITE_` precisam existir **antes** do build: elas são embutidas no JavaScript, não lidas em tempo de execução. Se faltar uma, o site sobe e quebra no navegador.

Nunca cadastre a `SUPABASE_SERVICE_ROLE_KEY` com prefixo `VITE_`. Isso a publicaria no bundle e daria acesso total ao banco para qualquer visitante.

### 3. Deploy e verificação

Depois que o deploy terminar:

```bash
curl https://SEU-APP.vercel.app/api/health
```

Esperado: `{"status":"ok","database":"ok"}`. Se vier `degraded`, as variáveis do Supabase estão erradas.

Depois entre no dashboard com o e-mail cadastrado e vá em **Integrações** para colar o token do Meta.

---

## Documentação

- [`docs/BANCO_DE_DADOS.md`](docs/BANCO_DE_DADOS.md) — schema, decisões de índice e o modelo de segurança
