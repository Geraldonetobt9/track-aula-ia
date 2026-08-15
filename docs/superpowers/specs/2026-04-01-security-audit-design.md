# Security Audit & Hardening — Design Spec

**Date**: 2026-04-01
**Status**: Approved
**Type**: Security audit (test-first) + vulnerability fixes

---

## 1. Objetivo

Executar auditoria de segurança completa do Sentinela, cobrindo 13 categorias de ataque, com testes automatizados contra o backend local e Supabase real. Gerar relatório PASS/FAIL, depois corrigir as vulnerabilidades encontradas e re-testar.

## 2. Decisões de Design

| Decisão | Escolha | Motivo |
|---------|---------|--------|
| Abordagem | Test-first, fix-after | Gera baseline antes das correções para documentação |
| Alvo dos testes | Server local + Supabase real | Mais próximo do ambiente de produção |
| Webhook rate limit | Removido do escopo | Risco de bloquear webhooks legítimos em alta demanda |
| Webhook token | Obrigatório (exceto Guru) | Guru é exceção conhecida — processa sem token |
| HMAC verification | TODO futuro | Precisa documentação clara de cada plataforma |
| Facebook DTOs | Validam inputs enviados, não responses | Facebook pode mudar response sem aviso |
| Webhook body | Mantém `any` — sem DTO rígido | Plataformas mudam payload sem aviso |

## 3. Fases

### Fase 1: Testes de Segurança Automatizados

Script em `scripts/security-audit.ts` que roda contra:
- **Supabase REST API** diretamente (RLS, signup, funções expostas)
- **Backend local** em `localhost:3001` (endpoints, headers, validação, error handling)

Gera relatório em `scripts/security-audit-report.md` com PASS/FAIL por teste.

### Fase 2: Correções

Implementar fix para cada FAIL, re-testar para confirmar.

## 4. Categorias de Teste (Fase 1)

### 4.1 Autenticação (AUTH)

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| AUTH-01 | Request sem header Authorization | GET /api/metrics/dashboard | 401 |
| AUTH-02 | Request com token inválido (string aleatória) | GET /api/metrics/dashboard | 401 |
| AUTH-03 | Request com token expirado | GET /api/metrics/dashboard | 401 |
| AUTH-04 | Request com JWT fabricado (assinatura inválida) | GET /api/metrics/dashboard | 401 |
| AUTH-05 | Request com Bearer prefix malformado ("bearer", "BEARER", "Token") | GET /api/metrics/dashboard | 401 |
| AUTH-06 | Signup sem confirmação de email → tentar usar token | GET /api/workspaces | 401 ou 0 rows |

### 4.2 Autorização e IDOR

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| IDOR-01 | User A tenta GET workspace de User B via ID | GET /api/workspaces (com workspace_id de outro) | 0 rows ou 403 |
| IDOR-02 | User A tenta DELETE workspace de User B | DELETE /api/workspaces/:idDeOutro | 404 ou 403 |
| IDOR-03 | User A tenta PATCH profile de User B | PATCH /api/profiles (com user_id de outro) | Bloqueado |
| IDOR-04 | User normal tenta acessar rota admin | GET /api/admin/stats | 403 |
| IDOR-05 | User normal tenta GET /api/admin/users | GET /api/admin/users | 403 |
| IDOR-06 | User normal tenta POST /api/admin/proxy | POST /api/admin/proxy | 403 |
| IDOR-07 | User A tenta ver histórico de regra de User B | GET /api/automation-rules/:idDeOutro/history | 0 rows |
| IDOR-08 | User A tenta toggle regra de User B | PATCH /api/automation-rules/:idDeOutro/toggle | 404 ou 403 |

### 4.3 RLS (Row Level Security)

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| RLS-01 | SELECT anônimo em todas as 21 tabelas | REST API direto | 0 rows (exceto plan_rules) |
| RLS-02 | INSERT anônimo em tabelas sensíveis | REST API direto | 401 |
| RLS-03 | UPDATE anônimo em todas as tabelas | REST API direto | 0 rows afetadas |
| RLS-04 | DELETE anônimo em todas as tabelas | REST API direto | 0 rows afetadas |
| RLS-05 | User autenticado tenta SELECT dados de outro user | REST API com token | 0 rows |
| RLS-06 | User autenticado tenta INSERT com user_id de outro | REST API com token | Bloqueado |
| RLS-07 | User autenticado tenta UPDATE dados de outro | REST API com token | 0 rows afetadas |
| RLS-08 | Foreign key join para vazar dados (plan_rules → profiles) | REST API | profiles não vaza |

### 4.4 Injeção

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| INJ-01 | SQL injection via filtros PostgREST (OR injection) | REST API com or=(malicious) | RLS bloqueia |
| INJ-02 | SQL injection no campo name ao criar regra | POST /api/automation-rules com name="'; DROP TABLE--" | Tratado como string literal |
| INJ-03 | NoSQL injection via JSONB fields | POST com budget_adjustment contendo payload malicioso | Tratado como JSON |
| INJ-04 | Template literal injection nos filtros do admin proxy | POST /api/admin/proxy com column malicioso | Bloqueado ou tratado |
| INJ-05 | Path traversal no :platform param dos webhooks | POST /api/webhooks/../../admin | 400 ou 404 |

### 4.5 XSS (Cross-Site Scripting)

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| XSS-01 | Payload XSS em workspace name | POST /api/workspaces name="<script>alert(1)</script>" | Aceito como string (backend é API, não serve HTML) |
| XSS-02 | Payload XSS em product_name via webhook | POST /api/webhooks/hotmart | Armazenado sem executar (frontend deve escapar) |
| XSS-03 | Verificar Content-Type das respostas | Todos os endpoints | application/json (nunca text/html) |

Nota: como o backend é API pura (JSON), XSS stored é responsabilidade do frontend (React escapa por padrão). O teste verifica que o backend nunca retorna `text/html`.

### 4.6 Input Validation

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| VAL-01 | Campo obrigatório faltando (name em regra) | POST /api/automation-rules sem name | 400 |
| VAL-02 | Tipo errado (string onde espera number) | POST /api/automation-rules frequency_minutes="abc" | 400 |
| VAL-03 | Valor fora do enum (action_type="hack") | POST /api/automation-rules | 400 |
| VAL-04 | UUID inválido no workspace_id | POST /api/automation-rules workspace_id="not-uuid" | 400 |
| VAL-05 | Payload enorme (1MB+ de JSON) | POST /api/automation-rules com body de 2MB | 413 ou timeout |
| VAL-06 | Campos extras não permitidos (forbidNonWhitelisted) | POST /api/automation-rules com campo "hack": true | 400 |
| VAL-07 | Facebook updateBudget sem validação (body: any) | PATCH /api/facebook/budget com campos inválidos | Testar estado atual |
| VAL-08 | Facebook updateStatus com status inválido | PATCH /api/facebook/campaigns/status status="HACKED" | Testar estado atual |
| VAL-09 | Negative budget amount | PATCH /api/facebook/budget amount=-5000 | Testar estado atual |

### 4.7 Rate Limiting

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| RATE-01 | 61 requests em 60 segundos no mesmo endpoint | GET /api/metrics/dashboard x61 | 429 na 61a |
| RATE-02 | Burst de 100 requests simultâneos | GET /api/workspaces x100 concurrent | Maioria retorna 429 |
| RATE-03 | Verificar que health check não tem throttle | GET /api/health x100 | Todos 200 |
| RATE-04 | Verificar que webhooks não tem throttle | POST /api/webhooks/hotmart x100 | Nenhum 429 |
| RATE-05 | Tentar bypass via X-Forwarded-For header | Requests com X-Forwarded-For variado | Throttle mantém (não confia no header) |

### 4.8 Headers de Segurança

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| HDR-01 | X-Content-Type-Options: nosniff | Qualquer response | Presente |
| HDR-02 | X-Frame-Options: DENY | Qualquer response | Presente |
| HDR-03 | Strict-Transport-Security | Qualquer response | Presente, max-age >= 31536000 |
| HDR-04 | X-XSS-Protection | Qualquer response | Presente |
| HDR-05 | Content-Security-Policy | Qualquer response | **FAIL esperado** (não implementado) |
| HDR-06 | Referrer-Policy | Qualquer response | **FAIL esperado** (não implementado) |
| HDR-07 | X-Permitted-Cross-Domain-Policies | Qualquer response | Presente |
| HDR-08 | Content-Type: application/json | Todos os endpoints | Presente (nunca text/html) |

### 4.9 Error Handling

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| ERR-01 | Provocar erro de banco (query em tabela inexistente) | Via admin proxy | Mensagem genérica, sem stack trace |
| ERR-02 | Provocar erro de validação | POST com payload inválido | Mensagem clara de validação |
| ERR-03 | Provocar 500 interno | Request que causa exceção não tratada | "Internal server error", sem paths/stack |
| ERR-04 | Verificar que error responses não contêm file paths | Todos os erros | Nenhum path absoluto na response |

### 4.10 Tokens e Sessão

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| TOK-01 | JWT com payload modificado (sem re-assinar) | GET com JWT adulterado | 401 |
| TOK-02 | JWT com alg:none | GET com JWT sem assinatura | 401 |
| TOK-03 | Token de um projeto Supabase diferente | GET com token de outro projeto | 401 |
| TOK-04 | Reuso de token após password change | Após trocar senha, usar token antigo | 401 |

### 4.11 Race Conditions

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| RACE-01 | Toggle 5 regras simultaneamente (plano permite 3) | 5x PATCH /api/automation-rules/:id/toggle concurrent | No máximo 3 ativadas |
| RACE-02 | Criar 10 workspaces simultaneamente | 10x POST /api/workspaces concurrent | Respeitado limite do plano |
| RACE-03 | Duplicar mesma campanha 10x simultaneamente | 10x POST /api/facebook/duplicate concurrent | Sem duplicatas indevidas |

### 4.12 Webhook Abuse

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| WH-01 | Webhook sem token (não-Guru) | POST /api/webhooks/hotmart sem token | HTTP 200 + não enfileira (body: { success: false }) |
| WH-02 | Webhook sem token (Guru) | POST /api/webhooks/guru sem token | Enfileira (exceção) |
| WH-03 | Webhook com plataforma inválida | POST /api/webhooks/fakePlatform | 400 |
| WH-04 | Webhook com body vazio | POST /api/webhooks/hotmart body={} | Não enfileira (sem token) |
| WH-05 | Webhook com payload de 2MB | POST /api/webhooks/hotmart body=2MB | 413 |
| WH-06 | Replay attack (mesmo payload 100x) | POST /api/webhooks/hotmart x100 | Idempotência via external_id |

### 4.13 Funções RPC Expostas

| ID | Teste | Método | Esperado |
|----|-------|--------|----------|
| RPC-01 | Chamar has_role() sem autenticação | POST /rest/v1/rpc/has_role | 401 (após fix aplicado) |
| RPC-02 | Chamar handle_new_user() diretamente | POST /rest/v1/rpc/handle_new_user | 404 (trigger only) |
| RPC-03 | Chamar default_starter_plan_id() | POST /rest/v1/rpc/default_starter_plan_id | Avaliar se deve ser público |
| RPC-04 | Tentar chamar pg_try_advisory_lock diretamente | POST /rest/v1/rpc/pg_try_advisory_lock | 404 |

## 5. Correções Planejadas (Fase 2)

### 5.1 Facebook DTOs (VAL-07, VAL-08, VAL-09)

Criar DTOs para os 3 endpoints que aceitam `body: any`:

**`UpdateBudgetDto`**: valida type (campaign|adset), facebook_id (string), budget_type (daily|lifetime), amount (number, min 100). Não valida response do Facebook.

**`UpdateStatusDto`**: valida facebook_id (string), status (ACTIVE|PAUSED), type (campaign|adset|ad).

**`DuplicateObjectDto`**: valida facebook_id (string), type (campaign|adset|ad), rename_suffix (string opcional).

### 5.2 Error Handler (ERR-01 a ERR-04)

Modificar `AllExceptionsFilter`:
- Para erros não-HTTP: retornar `"Internal server error"` fixo
- Logar `exception.message` + `exception.stack` via Logger (server-side only)
- Nunca retornar file paths, stack traces, ou mensagens internas ao cliente

### 5.3 Security Headers (HDR-05, HDR-06)

Adicionar no hook `onSend` do `main.ts`:
- `Content-Security-Policy: default-src 'none'; frame-ancestors 'none'`
- `Referrer-Policy: strict-origin-when-cross-origin`

### 5.4 Webhook Token Obrigatório (WH-01)

Modificar `webhooks.controller.ts`:
- Após `extractWebhookToken()`, se retornar null e plataforma !== 'guru', retornar 200 (para evitar retentativas) com `{ success: false, message: 'Missing authentication token' }` e **não enfileirar**.
- Guru continua enfileirando sem token (exceção documentada).
- TODO futuro: implementar HMAC verification por plataforma.

### 5.5 Payload Size Limit (WH-05)

Configurar no Fastify adapter em `main.ts`:
```
bodyLimit: 1_048_576 // 1MB
```

### 5.6 Admin Proxy Column Whitelist (INJ-04)

Adicionar constante `ALLOWED_COLUMNS` por tabela no admin proxy DTO. Rejeitar requests com colunas não listadas.

### 5.7 Dockerfile Non-Root User

Adicionar `USER node` no estágio final do Dockerfile.

## 6. Relatório

O script gera:
- `scripts/security-audit-report.md` — relatório legível com PASS/FAIL, organizados por categoria
- Saída no console com cores (verde/vermelho)
- Contadores: total de testes, passes, fails, por categoria

## 7. Pré-requisitos para Execução

1. Backend rodando em `localhost:3001` com `.env` apontando para Supabase real
2. Pelo menos 2 contas de teste no Supabase (User A e User B) para testes IDOR
3. Uma conta admin para testes de autorização
4. Variáveis de ambiente: `SUPABASE_URL`, `SUPABASE_ANON_KEY` disponíveis para o script
