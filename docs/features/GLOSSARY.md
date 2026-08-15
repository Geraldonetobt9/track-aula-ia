# Glossario

Termos usados em toda a documentacao do Sentinela.

---

## Metricas

| Termo | Definicao | Formula |
|-------|-----------|---------|
| **Faturamento Bruto** | Soma dos valores de todas as vendas aprovadas no periodo | `SUM(amount) WHERE status = 'approved'` |
| **Gasto com Anuncios** | Total investido em anuncios Facebook Ads no periodo | `SUM(spend) FROM daily_ad_spend` |
| **Faturamento Liquido** | Receita apos descontar o gasto com anuncios | `Faturamento Bruto - Gasto com Anuncios` |
| **Lucro** | Resultado final apos todas as deducoes | `Faturamento Bruto - Gasto com Anuncios - Despesas - Custos da Empresa + Outras Receitas` |
| **ROAS** | Return on Ad Spend — retorno sobre investimento em anuncios | `Faturamento Bruto / Gasto com Anuncios` |
| **CPA** | Cost Per Acquisition — custo por venda | `Gasto com Anuncios / Quantidade de Vendas Aprovadas` |
| **ROI** | Return on Investment | `(Faturamento Liquido / Gasto com Anuncios) * 100` |
| **Taxa de Reembolso** | Percentual de vendas reembolsadas | `(Reembolsos / Aprovadas) * 100%` |
| **Ticket Medio** | Valor medio por venda | `Faturamento Bruto / Quantidade de Vendas` |

## Atribuicao

| Termo | Definicao |
|-------|-----------|
| **Last Click** | Modelo de atribuicao que credita a venda ao ultimo anuncio clicado, baseado no ad_id extraido dos parametros UTM da venda |
| **Meta Attribution** | Modelo de atribuicao reportado pelo pixel do Facebook, baseado em conversoes registradas pela plataforma Meta |
| **Venda Paga** | Venda que possui `campaign_id` (foi atribuida a um anuncio) |
| **Venda Organica** | Venda sem `campaign_id` ou com `utm_source = 'organico'` |
| **Rematch** | Processo de re-associar vendas que chegaram sem atribuicao a anuncios sincronizados posteriormente |
| **ad_id** | Identificador numerico do anuncio Facebook, extraido de `utm_content` ou `utm_term` |

## Parametros UTM

| Parametro | Uso no Sentinela |
|-----------|------------------|
| `utm_source` | Origem do trafego (ex: facebook, google, organico) |
| `utm_medium` | Meio (ex: cpc, social). No Guru, pode conter o `facebook_campaign_id` |
| `utm_campaign` | Nome ou ID da campanha. Usado como fallback de atribuicao |
| `utm_content` | Conteudo do anuncio. Frequentemente contem o `facebook_ad_id` em formato composto (ex: `vid34\|120245519580910309`) |
| `utm_term` | Termo. Alternativa ao `utm_content` para conter o `facebook_ad_id` |

## Hierarquia Facebook Ads

| Nivel | Tabela | ID Facebook | Descricao |
|-------|--------|-------------|-----------|
| **Campanha** | `campaigns` | `facebook_campaign_id` | Nivel mais alto. Define objetivo e orcamento geral |
| **Conjunto de Anuncios** | `ad_sets` | `facebook_adset_id` | Define publico-alvo, posicionamento e orcamento diario |
| **Anuncio** | `ads` | `facebook_ad_id` | Criativo individual (imagem, video, texto) |

## Status de Venda

| Status | Descricao |
|--------|-----------|
| `approved` | Venda confirmada e paga |
| `pending` | Aguardando confirmacao de pagamento (boleto, pix) |
| `refunded` | Venda reembolsada ou estornada |
| `chargeback` | Contestacao de cobranca (tratado como refunded) |

## Plataformas de Checkout

| Plataforma | Autenticacao | Observacao |
|------------|-------------|------------|
| **Hotmart** | Hottok (header) | Deduz comissao do marketplace. Suporta moeda estrangeira |
| **Kiwify** | HMAC-SHA1 (assinatura) | Verificacao criptografica do payload |
| **Kirvano** | Token (header) | Token customizado |
| **Guru** | API Token (body) | Processamento assincrono via fila |
| **PerfectPay** | Token (header) | Status mapeados por codigo numerico |
| **Ticto** | Token (header) | Formato v2.0. Valores em centavos |
| **PayT** | Token (header) | Filtra webhooks de teste. Valores em centavos |
| **Cakto** | Token (header) | Filtro por evento (purchase_approved, refund) |
| **Hubla** | Token (header) | Token gerado pela Hubla na aba "Autenticacao" da regra de webhook |
| **CartPanda** | Token (header) | Token unico do usuario; webhooks separados por evento (Pedido pago, Pedido Atualizado, Pedido Reembolsado) |
| **GG Checkout** | Secret definido pelo usuario | Mesmo valor colado no campo "Secret" da GG Checkout e no Sentinela |
| **LastLink** | Token (header) | Integracao por produto: cria-se uma integracao no Sentinela para cada produto rastreado |
| **Eduzz** | x-eduzz-token (header) ou x-signature (HMAC SHA-256 do raw body) | Token chamado "Chave de acesso" no painel Eduzz |
| **Mundpay** | Token via query param `?token=...` na URL | Mundpay nao permite headers customizados; o usuario gera o token no Sentinela e cola a URL completa |
| **Monetizze** | x-monetizze-token (header) | Token chamado "Chave Unica" no painel Monetizze |
| **Greenn** | x-webhook-token (header) | Webhook Token global por conta; webhook configurado em CADA produto na Greenn (mesmo token) |

## Workspaces

| Termo | Definicao |
|-------|-----------|
| **Workspace (Area)** | Agrupamento logico de conexoes Facebook, integracoes de checkout e produtos. Isola dados para visualizacao |
| **Conexao** | Associacao entre workspace e conta de anuncio Facebook |
| **Integracao de Checkout** | Associacao entre workspace e plataforma de pagamento |
| **Produto** | Nome de produto mapeado dentro de um workspace |

## Planos

| Plano | Descricao |
|-------|-----------|
| `free` | Plano gratuito com limites basicos |
| `starter` | Plano inicial com sync automatico |
| `pro` | Plano profissional com funcionalidades avancadas |
| `enterprise` | Plano empresarial sem limites |
| `unlimited` | Plano ilimitado (uso interno/especial) |

## Termos Tecnicos

| Termo | Definicao |
|-------|-----------|
| **RLS** | Row Level Security — politicas no Supabase que garantem que cada usuario so ve seus proprios dados |
| **Service Role** | Chave administrativa do Supabase que bypassa RLS. Usada apenas no backend |
| **JWT** | JSON Web Token — token de autenticacao emitido pelo Supabase Auth |
| **Guard** | Middleware NestJS que valida autenticacao/autorizacao antes de processar a requisicao |
| **Edge Function** | Funcao serverless do Supabase (Deno). Legado — substituido pelo backend NestJS |
| **Webhook** | Notificacao HTTP enviada pela plataforma de checkout quando uma venda ocorre |
| **Backoff Exponencial** | Estrategia de retry que aumenta o intervalo entre tentativas (30s, 60s, 90s...) |
