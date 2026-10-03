# Dashboard de Tracking

Painel de ROI de Facebook Ads: cruza o gasto de mídia com as vendas reais dos checkouts brasileiros, rastreia os visitantes da página de vendas e manda PageView, InitiateCheckout e Purchase para a API de Conversões do Meta — tudo server-side, no domínio do cliente.

**Implantar leva uns 20 minutos, em 4 etapas.** Você precisa de conta no [Supabase](https://supabase.com), no [GitHub](https://github.com) e na [Vercel](https://vercel.com) (as três grátis), e acesso ao DNS do domínio do site.

| Etapa | Onde | O que sai dela |
|---|---|---|
| [1. Banco de dados](#etapa-1--banco-de-dados-supabase) | Supabase | o banco pronto e 3 chaves copiadas |
| [2. Código no GitHub](#etapa-2--código-no-github) | GitHub | o repositório com o código |
| [3. Publicar](#etapa-3--publicar-vercel) | Vercel | o painel no ar |
| [4. Seu domínio](#etapa-4--seu-domínio) | Vercel + DNS | `painel.seudominio.com.br` servindo painel, rastreio e webhooks |

---

## Etapa 1 — Banco de dados (Supabase)

**1.1 Criar o projeto.** Em [supabase.com/dashboard](https://supabase.com/dashboard) → **New project**. Região **South America (São Paulo)**. Guarde a senha do banco em algum lugar.

**1.2 Rodar o SQL inteiro.** No menu lateral, **SQL Editor** → **New query**. Abra o arquivo

```
supabase/schema_completo.sql
```

copie **tudo** (Ctrl+A, Ctrl+C), cole no editor e clique **Run**. Espere o `Success`. É uma vez só, num projeto novo e vazio — o arquivo cria as 22 tabelas, as regras de acesso e as rotinas de limpeza.

> Deu erro porque o banco já tinha algo? Rode `supabase/reset.sql` e depois o `schema_completo.sql` de novo.

**1.3 Fechar o cadastro.** **Authentication** → **Sign In / Providers** → **Email**: desligue **Allow new users to sign up** e salve. Só quem você criar consegue entrar.

**1.4 Criar o seu usuário.** **Authentication** → **Users** → **Add user** → **Create new user**: seu e-mail, uma senha, e **Auto Confirm User** marcado.

**1.5 Copiar as chaves.** **Project Settings** (engrenagem) → **API Keys** → aba **Legacy API Keys**, e **Data API** para a URL:

| No Supabase | Copie para a variável |
|---|---|
| Project URL (`https://xxxx.supabase.co`) | `SUPABASE_URL` |
| `anon` `public` | `SUPABASE_ANON_KEY` |
| `service_role` (clique em **Reveal**) | `SUPABASE_SERVICE_ROLE_KEY` |

Deixe as três num bloco de notas, neste formato — é o que você vai colar na Vercel na Etapa 3:

```
SUPABASE_URL=https://xxxx.supabase.co
SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
ADMIN_EMAILS=seu@email.com
```

`ADMIN_EMAILS` é o e-mail do usuário que você criou no 1.4. Quem estiver nela cria os outros usuários pelo próprio painel.

> A `service_role` abre o banco inteiro. Ela vai **só** na Vercel — nunca no código, nunca num arquivo que vá para o GitHub, nunca com prefixo `VITE_`.

---

## Etapa 2 — Código no GitHub

**2.1 Criar o repositório.** Em [github.com/new](https://github.com/new): um nome (ex.: `painel-tracking`), **Private**, e **nada** marcado embaixo (sem README, sem .gitignore). **Create repository.** Copie a URL que aparece, `https://github.com/SEU-USUARIO/painel-tracking.git`.

**2.2 Enviar o código.** Abra um terminal **dentro desta pasta** e rode, trocando a URL pela sua:

```bash
git init -b main
git add -A
git commit -m "Primeira versão"
git remote remove origin
git remote add origin https://github.com/SEU-USUARIO/painel-tracking.git
git push -u origin main
```

O `git remote remove origin` pode responder `error: No such remote` — tudo bem, é só porque a pasta veio sem remoto. Os arquivos de senha (`.env*`) nunca sobem: o `.gitignore` já barra.

Atualizar depois é só `git add -A`, `git commit -m "..."` e `git push`: a Vercel publica sozinha a cada push.

---

## Etapa 3 — Publicar (Vercel)

**3.1 Importar.** Em [vercel.com/new](https://vercel.com/new) → **Import** no repositório da Etapa 2 (na primeira vez, autorize a Vercel a ver seus repositórios do GitHub).

**3.2 Não mexa em Framework, Build nem Output.** O `vercel.json` do projeto já define tudo, inclusive a região São Paulo.

**3.3 Variáveis.** Abra **Environment Variables** e cole o bloco da Etapa 1.5 inteiro no primeiro campo — a Vercel separa as quatro sozinha.

**3.4 Deploy.** Clique **Deploy** e espere uns 3 minutos. Para conferir, abra

```
https://SEU-PROJETO.vercel.app/health
```

Tem que aparecer `"status":"ok"`. Se aparecer `degraded`, alguma chave do Supabase está errada: corrija em **Settings → Environment Variables** e faça **Redeploy** (aba Deployments → ⋯ → Redeploy).

---

## Etapa 4 — Seu domínio

O **único** ponto de DNS. Um subdomínio aponta para a Vercel e passa a servir o painel, o código de rastreio e os webhooks dos checkouts. Isso é o que deixa o rastreio *first-party*: as requisições saem do domínio do próprio site, com o IP real do visitante, e bloqueador de anúncio não barra.

Use um subdomínio **do mesmo domínio da página de vendas**. Página em `seudominio.com.br` → `painel.seudominio.com.br`.

**4.1 Na Vercel.** Projeto → **Settings** → **Domains** → digite `painel.seudominio.com.br` → **Add**.

**4.2 No DNS.** Onde o domínio é gerenciado (Registro.br, Cloudflare, Hostinger, GoDaddy…), crie:

| Tipo | Nome | Valor |
|---|---|---|
| `CNAME` | `painel` | `cname.vercel-dns.com` |

No **Cloudflare**, deixe a nuvem **cinza** (*DNS only*). Com a nuvem laranja a Vercel não emite o certificado.

**4.3 Esperar.** Em alguns minutos a Vercel mostra **Valid Configuration** ao lado do domínio.

**4.4 Avisar o Supabase.** **Authentication** → **URL Configuration**:
- **Site URL:** `https://painel.seudominio.com.br`
- **Redirect URLs** → **Add URL:** `https://painel.seudominio.com.br/**`

É o que faz o link de "esqueci minha senha" voltar para o painel certo.

**4.5 Pronto.** Entre em `https://painel.seudominio.com.br` com o usuário da Etapa 1.4 e use sempre esse endereço. Em **Integrações**, o código de rastreio e as URLs de webhook já saem com o seu domínio — não há mais nada de domínio para configurar.

---

## Depois de entrar: Integrações

Tudo pela tela, nesta ordem:

1. **Facebook Ads** — cole o access token do Meta; as contas de anúncio aparecem sozinhas.
2. **Checkout e rastreio** — um passo a passo só, no mesmo card:
   1. **Escolha seu checkout** — a plataforma onde você vende.
   2. **Domínio first-party** — aberto pelo seu domínio (Etapa 4), já vem pronto.
   3. **Código da página** — copie para antes do `</body>` da página de vendas.
   4. **Criar o webhook** — o botão abre o checkout escolhido; cole a URL e o token na plataforma, como a tela mostra.
   5. **Padrão de UTM** — cole no campo *Parâmetros de URL* de cada anúncio.
3. **API de Conversões do Meta** — ID do pixel e token de acesso. Para testar, preencha o código de teste e veja os eventos em *Eventos de teste* no Gerenciador de Eventos; apague o código depois.

---

## Opcionais

Variáveis que você pode acrescentar na Vercel depois (Settings → Environment Variables, e Redeploy):

| Variável | Para quê |
|---|---|
| `CRON_SECRET` | Reenvio automático, uma vez por dia, dos eventos que o Meta recusou. Sem ela, o reenvio é pelo botão em Integrações. |
| `ENCRYPTION_KEY` | Chave que cifra os tokens salvos. Sem ela, é derivada da `service_role`. Defina **desde o início** se um dia for trocar a `service_role`: trocar a chave depois obriga a colar os tokens de novo. |
| `META_API_VERSION` | Versão da Graph API do Meta (Ads e API de Conversões). Padrão: `v25.0`. Só preencha para usar outra. |

Para gerar um valor aleatório para `CRON_SECRET` ou `ENCRYPTION_KEY`:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

---

## Já tem o painel no ar e está atualizando?

Não rode o `schema_completo.sql` nem a migration base: os dois são para banco vazio.

Em `supabase/migrations/`, a primeira migration (`20261002120000_base.sql`) é o banco inteiro até 2026-10-02. Toda mudança no banco depois disso vira uma migration nova, com data posterior. Para atualizar, rode no SQL Editor só as que vieram depois da última que você aplicou, em ordem de data.

Depois, `git push` para a Vercel publicar o código novo.

### Mudou o banco? Regere o schema

Crie a migration nova em `supabase/migrations/` (nome `AAAAMMDDHHMMSS_o_que_muda.sql`) e rode:

```bash
node scripts/gerar-schema.js
```

Ele refaz o `supabase/schema_completo.sql` a partir das migrations. Não edite o schema à mão.

---

## Problemas comuns

| Sintoma | Causa provável |
|---|---|
| Tela branca ao abrir o painel | `SUPABASE_URL` ou `SUPABASE_ANON_KEY` ausente na Vercel. Cadastre e faça **Redeploy** — elas entram no build. |
| `/health` responde `degraded` | `SUPABASE_SERVICE_ROLE_KEY` errada, ou o SQL da Etapa 1.2 não rodou. |
| Login diz credencial inválida | Usuário criado sem **Auto Confirm User**. Recrie com a opção marcada. |
| Não aparece a aba de criar usuários | Seu e-mail não está em `ADMIN_EMAILS`. |
| Domínio fica em *Invalid Configuration* | CNAME com nome ou valor errado, ou nuvem laranja no Cloudflare. |
| "Esqueci minha senha" leva para outro endereço | Etapa 4.4 pendente. |

---

## Documentação

- [`docs/features/`](docs/features/README.md) — cada funcionalidade, com regras de negócio e testes
- [`docs/features/18-visitor-tracking/meta-capi.md`](docs/features/18-visitor-tracking/meta-capi.md) — rastreio, API de Conversões e as plataformas de checkout
- `supabase/migrations/` — o histórico do banco; `node scripts/gerar-schema.js` regenera o `schema_completo.sql` a partir delas
