-- ============================================================
-- ATUALIZAÇÃO — para um banco que JÁ recebeu a primeira versão
-- ============================================================
-- Rode UMA VEZ, no SQL Editor, se você já aplicou o schema_completo.sql antigo
-- (o de 22 tabelas, com app_owner). Faz duas coisas:
--
--   1. Remove GTM e VTurb — saíram junto com as abas de Eventos e VTurb.
--   2. Troca o dono único por lista de usuários permitidos, para o admin poder
--      criar mais contas pelo painel do Supabase.
--
-- O usuário que você já criou é preservado: ele é copiado de app_owner para
-- app_users e continua com acesso.
--
-- Em um projeto Supabase novo, NÃO rode este arquivo — o schema_completo.sql
-- atual já nasce assim.
--
-- É seguro rodar mais de uma vez.

BEGIN;

-- ============================================================
-- PARTE 1 — Remover GTM e VTurb
-- ============================================================

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-gtm-events');
    RAISE NOTICE 'Job purge-gtm-events desagendado.';
  END IF;
EXCEPTION
  WHEN OTHERS THEN RAISE NOTICE 'Nada a desagendar (%).', SQLERRM;
END;
$$;

DROP FUNCTION IF EXISTS public.gtm_top_visitors(timestamptz, timestamptz, int);
DROP FUNCTION IF EXISTS public.gtm_events_page(timestamptz, text, int, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.gtm_visit_metrics(timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.purge_old_gtm_events();

DROP TABLE IF EXISTS public.gtm_events CASCADE;

-- app_secrets existia só para o token do GTM e o da VTurb. Sem os dois, fica sem
-- conteúdo: os segredos que sobram já moram em meta_credentials e checkout_secrets.
DROP TABLE IF EXISTS public.app_secrets CASCADE;

-- ============================================================
-- PARTE 2 — De dono único para usuários permitidos
-- ============================================================

-- 2.1 — A nova tabela.
CREATE TABLE IF NOT EXISTS public.app_users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  name       text,
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_app_users_active
  ON public.app_users (user_id) WHERE is_active = true;

DROP TRIGGER IF EXISTS touch_app_users ON public.app_users;
CREATE TRIGGER touch_app_users
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.app_users ENABLE ROW LEVEL SECURITY;

-- 2.2 — Traz o usuário que já existe.
-- Preferimos app_owner como origem; se ela já tiver sumido (script rodado duas
-- vezes), cai para auth.users, que é a fonte real de qualquer jeito.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_owner') THEN
    INSERT INTO public.app_users (user_id, email, name)
    SELECT user_id, email, name FROM public.app_owner
    ON CONFLICT (user_id) DO NOTHING;
    RAISE NOTICE 'Usuários copiados de app_owner.';
  ELSE
    INSERT INTO public.app_users (user_id, email, name)
    SELECT id, email, COALESCE(raw_user_meta_data ->> 'name', split_part(email, '@', 1))
    FROM auth.users
    ON CONFLICT (user_id) DO NOTHING;
    RAISE NOTICE 'Usuários copiados de auth.users.';
  END IF;
END;
$$;

-- 2.3 — Derrubar as policies antigas ANTES da função.
-- Elas dependem de is_owner(): sem tirar as policies primeiro, o DROP FUNCTION
-- falha com "cannot drop function because other objects depend on it".
DO $$
DECLARE
  p record;
BEGIN
  FOR p IN SELECT schemaname, tablename, policyname
           FROM pg_policies
           WHERE schemaname = 'public' AND policyname IN ('owner_read', 'user_read')
  LOOP
    EXECUTE format('DROP POLICY %I ON %I.%I', p.policyname, p.schemaname, p.tablename);
  END LOOP;
END;
$$;

-- 2.4 — A nova função de autorização.
DROP FUNCTION IF EXISTS public.is_owner();

CREATE OR REPLACE FUNCTION public.is_allowed_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.app_users
    WHERE user_id = (SELECT auth.uid()) AND is_active
  );
$$;

REVOKE EXECUTE ON FUNCTION public.is_allowed_user() FROM PUBLIC;
GRANT  EXECUTE ON FUNCTION public.is_allowed_user() TO authenticated, service_role;

-- 2.5 — Recriar as policies de leitura sobre as 17 tabelas.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'app_users', 'app_settings', 'ad_accounts', 'campaigns', 'ad_sets', 'ads',
    'ad_insights_daily', 'checkout_integrations', 'sales', 'company_costs',
    'financial_entries', 'automation_rules', 'automation_rule_conditions',
    'automation_rule_executions', 'sync_state', 'sync_logs', 'processing_jobs'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY user_read ON public.%I FOR SELECT TO authenticated USING (public.is_allowed_user())',
      t
    );
  END LOOP;
END;
$$;

-- 2.6 — Trocar o gatilho que bloqueava o segundo usuário.
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
DROP FUNCTION IF EXISTS public.claim_ownership();

CREATE OR REPLACE FUNCTION public.register_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.app_users (user_id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.register_new_user();

-- 2.7 — Sincronização de e-mail passa a apontar para app_users.
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
DROP FUNCTION IF EXISTS public.sync_owner_email();

CREATE OR REPLACE FUNCTION public.sync_user_email()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.app_users SET email = NEW.email WHERE user_id = NEW.id;
  RETURN NEW;
END;
$$;

CREATE TRIGGER on_auth_user_email_updated
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (OLD.email IS DISTINCT FROM NEW.email)
  EXECUTE FUNCTION public.sync_user_email();

-- 2.8 — Fora a tabela antiga.
DROP TABLE IF EXISTS public.app_owner CASCADE;

COMMIT;

-- ============================================================
-- Conferência
-- ============================================================
-- Esperado: 20 tabelas, todas com rowsecurity = true.
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;

-- Esperado: o usuário que você já tinha criado, com is_active = true.
SELECT email, is_active, created_at FROM public.app_users ORDER BY created_at;
