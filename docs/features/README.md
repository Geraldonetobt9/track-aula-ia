# Documentacao de Funcionalidades — Sentinela

Documentacao completa de todas as funcionalidades e regras de negocio da plataforma Sentinela.

## Como usar esta documentacao

- **Desenvolvedores**: Consulte os endpoints, hooks e modelos de dados de cada feature antes de modificar
- **Product Managers**: Leia o Proposito e Regras de Negocio de cada feature para entender o comportamento esperado
- **QA / Testers**: Use o Checklist de Testes e a tabela de Regras de Negocio para criar casos de teste

Cada documento segue o [template padrao](TEMPLATE.md). Consulte o [glossario](GLOSSARY.md) para definicoes de termos.

---

## Indice

### Fundamentos
| Doc | Descricao |
|-----|-----------|
| [Autenticacao e Autorizacao](01-auth/auth-and-authorization.md) | Login, JWT, guards, roles, RLS |
| [Onboarding](01-auth/onboarding.md) | Wizard de configuracao inicial |
| [Workspaces](02-workspaces/workspaces.md) | Areas de trabalho, isolamento de dados |

### Core — Visualizacao de Dados
| Doc | Descricao |
|-----|-----------|
| [Dashboard e Metricas](03-dashboard/dashboard-and-metrics.md) | Painel principal com ROAS, CPA, graficos |
| [Campanhas](04-campaigns/campaigns-overview.md) | Listagem de campanhas com metricas |
| [Conjuntos de Anuncios](04-campaigns/ad-sets.md) | Ad sets com orcamento e metricas |
| [Anuncios](04-campaigns/ads.md) | Anuncios individuais e performance |

### Core — Dados de Vendas
| Doc | Descricao |
|-----|-----------|
| [Vendas](05-sales/sales.md) | Listagem, filtros, detalhes de vendas |
| [Atribuicao de Vendas](05-sales/sale-attribution.md) | Logica de matching UTM → anuncio |
| [Rastreio de Visitantes](18-visitor-tracking/visitor-tracking.md) | Snippet da pagina de vendas, funil, jornada do comprador |
| [API de Conversoes do Meta](18-visitor-tracking/meta-capi.md) | PageView, InitiateCheckout e Purchase pelo servidor, no subdominio do cliente |

### Core — Financeiro
| Doc | Descricao |
|-----|-----------|
| [Financeiro](06-financial/financial.md) | DRE mensal, despesas, receitas, lucro |

### Integracoes
| Doc | Descricao |
|-----|-----------|
| [Visao Geral](07-integrations/integrations-overview.md) | Pagina de integracoes e como funciona |
| [Conexao Facebook](07-integrations/facebook-connection.md) | Configuracao de conta de anuncios |
| [Integracoes de Checkout](07-integrations/checkout-integrations.md) | 9 plataformas de pagamento |

### Webhooks (por plataforma)
| Doc | Descricao |
|-----|-----------|
| [Visao Geral dos Webhooks](08-webhook-processing/webhook-processing-overview.md) | Fluxo comum, fila, retry |
| [Hotmart](08-webhook-processing/hotmart.md) | Regras especificas Hotmart |
| [Kiwify](08-webhook-processing/kiwify.md) | Regras especificas Kiwify |
| [Kirvano](08-webhook-processing/kirvano.md) | Regras especificas Kirvano |
| [Guru](08-webhook-processing/guru.md) | Regras especificas Guru |
| [PerfectPay](08-webhook-processing/perfectpay.md) | Regras especificas PerfectPay |
| [Ticto](08-webhook-processing/ticto.md) | Regras especificas Ticto |
| [PayT](08-webhook-processing/payt.md) | Regras especificas PayT |
| [Cakto](08-webhook-processing/cakto.md) | Regras especificas Cakto |
| [Hubla](08-webhook-processing/hubla.md) | Regras especificas Hubla |
| [CartPanda](08-webhook-processing/cartpanda.md) | Regras especificas CartPanda |
| [GG Checkout](08-webhook-processing/ggcheckout.md) | Regras especificas GG Checkout |
| [LastLink](08-webhook-processing/lastlink.md) | Regras especificas LastLink (integracao por produto) |
| [Eduzz](08-webhook-processing/eduzz.md) | Regras especificas Eduzz (HMAC SHA-256) |
| [Mundpay](08-webhook-processing/mundpay.md) | Regras especificas Mundpay (token via ?token= query param) |
| [Monetizze](08-webhook-processing/monetizze.md) | Regras especificas Monetizze (codigos de status numericos) |
| [Greenn](08-webhook-processing/greenn.md) | Regras especificas Greenn (UTMs em saleMetas) |

### Sincronizacao
| Doc | Descricao |
|-----|-----------|
| [Sync Facebook Ads](09-facebook-sync/facebook-ads-sync.md) | Auto-sync, insights, rematch |

### Configuracoes
| Doc | Descricao |
|-----|-----------|
| [Configuracoes](10-settings/settings.md) | Perfil, seguranca, plano, custos |
| [Planos e Limites](11-plans-and-limits/plan-rules.md) | Tiers, feature gates, limites |

### Administracao
| Doc | Descricao |
|-----|-----------|
| [Dashboard Admin](12-admin/admin-dashboard.md) | Estatisticas do sistema |
| [Gestao de Usuarios](12-admin/admin-users.md) | CRUD de usuarios |
| [Detalhe do Usuario](12-admin/admin-user-detail.md) | Visao individual + metricas |
| [Gestao de Planos](12-admin/admin-plans.md) | Edicao de regras de planos |
| [Impersonacao](12-admin/admin-impersonation.md) | Visualizar como outro usuario |
