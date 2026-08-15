-- ============================================================
-- 0010 — Row Level Security
-- ============================================================
-- O modelo é simples e fechado:
--
--   1. RLS ligado em TODAS as tabelas, sem exceção.
--   2. O usuário logado (role `authenticated`) tem SOMENTE LEITURA, e só se
--      estiver na lista de permitidos — is_allowed_user(). Toda escrita passa
--      pelo backend, que usa a service_role e valida o token antes.
--   3. Tabelas de segredo (tokens, chaves de webhook, fila de webhook) ficam com
--      RLS ligado e NENHUMA policy. Sem policy, ninguém passa: nem a chave anon,
--      nem o usuário logado. Só a service_role, que ignora RLS por definição.
--
-- Por que leitura direta e escrita pela API: as telas leem muita coisa e o
-- PostgREST faz isso bem; escrita precisa de validação, atribuição e chamada ao
-- Meta, que é trabalho de backend. Deixar o frontend escrever direto no banco
-- seria dar poder que ele não precisa ter.

-- ------------------------------------------------------------
-- 1. Liga RLS em tudo
-- ------------------------------------------------------------
ALTER TABLE public.app_users                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.app_settings               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meta_credentials           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_accounts                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.campaigns                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_sets                    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ads                        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ad_insights_daily          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_integrations      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.checkout_secrets           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sales                      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.webhook_queue              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_costs              ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.financial_entries          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rules           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_conditions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.automation_rule_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_state                 ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.sync_logs                  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.processing_jobs            ENABLE ROW LEVEL SECURITY;

-- ------------------------------------------------------------
-- 2. Leitura para os usuários permitidos
-- ------------------------------------------------------------
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_users', 'app_settings', 'ad_accounts', 'campaigns', 'ad_sets', 'ads',
    'ad_insights_daily', 'checkout_integrations', 'sales', 'company_costs',
    'financial_entries', 'automation_rules', 'automation_rule_conditions',
    'automation_rule_executions', 'sync_state', 'sync_logs',
    'processing_jobs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY user_read ON public.%I FOR SELECT TO authenticated USING (public.is_allowed_user())',
      t
    );
  END LOOP;
END;
$$;

-- ------------------------------------------------------------
-- 3. Tabelas de segredo: RLS ligado, nenhuma policy, grants removidos
-- ------------------------------------------------------------
-- O REVOKE é redundante em relação ao RLS (sem policy já bloqueia), mas custa
-- nada e protege contra alguém criar uma policy aqui sem pensar depois.
REVOKE ALL ON public.meta_credentials FROM anon, authenticated;
REVOKE ALL ON public.checkout_secrets FROM anon, authenticated;
REVOKE ALL ON public.webhook_queue    FROM anon, authenticated;

-- ------------------------------------------------------------
-- 4. Escrita: nunca pela chave anon
-- ------------------------------------------------------------
-- Sem policies de INSERT/UPDATE/DELETE, qualquer escrita vinda do browser é
-- rejeitada pelo RLS. O backend usa a service_role e não é afetado.
--
-- Se um dia alguma tela precisar escrever direto, a policy correta é:
--
--   CREATE POLICY user_write ON public.<tabela>
--     FOR ALL TO authenticated
--     USING (public.is_allowed_user()) WITH CHECK (public.is_allowed_user());
--
-- Nunca use USING (true): isso libera a tabela para qualquer usuário
-- autenticado que venha a existir no projeto.

-- ------------------------------------------------------------
-- 5. Trava de novas tabelas
-- ------------------------------------------------------------
-- Event trigger: toda tabela nova em `public` já nasce com RLS ligado. Evita o
-- erro clássico de criar uma tabela, esquecer o ALTER e deixá-la aberta.
CREATE OR REPLACE FUNCTION public.force_rls_on_new_tables()
RETURNS event_trigger
LANGUAGE plpgsql
AS $$
DECLARE
  obj record;
BEGIN
  FOR obj IN SELECT * FROM pg_event_trigger_ddl_commands()
             WHERE command_tag = 'CREATE TABLE' AND schema_name = 'public'
  LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY', obj.object_identity);
  END LOOP;
END;
$$;

-- Event trigger exige superusuário, e dependendo do plano o papel `postgres` do
-- Supabase não tem esse direito. Se não der, a migration continua: é uma rede de
-- proteção, não um requisito. O aviso fica no log para você saber que não pegou.
DO $$
BEGIN
  CREATE EVENT TRIGGER force_rls
    ON ddl_command_end
    WHEN TAG IN ('CREATE TABLE')
    EXECUTE FUNCTION public.force_rls_on_new_tables();
EXCEPTION
  WHEN insufficient_privilege OR duplicate_object THEN
    RAISE NOTICE 'Event trigger force_rls não criado (%). Ligue RLS à mão em tabelas novas.', SQLERRM;
END;
$$;
