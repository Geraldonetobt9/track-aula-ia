-- ============================================================
-- Simplificação para usuário único
-- ============================================================
-- Roda DEPOIS de todas as migrations anteriores, num banco novo.
--
-- O que muda: sai a cobrança, sai o painel admin, sai o GTM, e o seletor de
-- área some da tela. O que NÃO muda: a forma do schema. workspace_id continua
-- em todas as tabelas, com uma única área criada automaticamente.
--
-- Essa escolha é deliberada. Arrancar workspace_id exigiria refatorar 146
-- arquivos de frontend e backend, e o ganho seria estético: uma coluna a menos
-- numa base que só tem um dono. Manter a coluna deixa todo o código existente
-- funcionando sem alteração.

BEGIN;

-- ------------------------------------------------------------
-- 1. Cobrança
-- ------------------------------------------------------------
-- Não há mais plano, assinatura, excedente nem Stripe.
DROP TABLE IF EXISTS public.usage_overage         CASCADE;
DROP TABLE IF EXISTS public.stripe_webhook_events CASCADE;
DROP TABLE IF EXISTS public.subscriptions         CASCADE;

-- profiles.plan_id aponta para plan_rules; solta o vínculo antes de derrubar.
ALTER TABLE public.profiles DROP COLUMN IF EXISTS plan_id;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_start;
ALTER TABLE public.profiles DROP COLUMN IF EXISTS subscription_end;

DROP FUNCTION IF EXISTS public.default_starter_plan_id() CASCADE;
DROP TABLE    IF EXISTS public.plan_rules CASCADE;

-- Coluna que existia só para marcar venda acima do limite do plano.
ALTER TABLE public.sales DROP COLUMN IF EXISTS blocked_by_limit;

-- ------------------------------------------------------------
-- 2. Painel admin e papéis
-- ------------------------------------------------------------
-- Não há mais admin dentro do produto: quem administra usa o painel do Supabase.
DROP FUNCTION IF EXISTS public.admin_dashboard_stats()        CASCADE;
DROP FUNCTION IF EXISTS public.admin_list_users(text, int, int) CASCADE;
DROP FUNCTION IF EXISTS public.admin_user_detail(uuid)         CASCADE;
DROP FUNCTION IF EXISTS public.has_role(uuid, app_role)        CASCADE;
DROP FUNCTION IF EXISTS public.mask_secret(text)               CASCADE;

DROP TABLE IF EXISTS public.user_roles          CASCADE;
DROP TABLE IF EXISTS public.welcome_emails_sent CASCADE;
DROP TYPE  IF EXISTS public.app_role;

-- ------------------------------------------------------------
-- 3. GTM / VTurb
-- ------------------------------------------------------------
-- As abas de Eventos e VTurb saíram do produto.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-gtm-events');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nada a desagendar (%).', SQLERRM;
END;
$$;

DROP FUNCTION IF EXISTS public.gtm_top_visitors(uuid, uuid, timestamptz, timestamptz, int) CASCADE;
DROP FUNCTION IF EXISTS public.gtm_events_page(uuid, uuid, timestamptz, text, int, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.gtm_events_page(uuid, uuid, timestamptz, text, int) CASCADE;
DROP FUNCTION IF EXISTS public.gtm_visit_metrics(uuid, uuid, timestamptz, timestamptz) CASCADE;
DROP FUNCTION IF EXISTS public.purge_old_gtm_events() CASCADE;

DROP TABLE IF EXISTS public.gtm_events CASCADE;

ALTER TABLE public.workspaces DROP COLUMN IF EXISTS gtm_ingest_token;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS vturb_token;

-- ------------------------------------------------------------
-- 4. Área única
-- ------------------------------------------------------------
-- O seletor de área sai da tela, mas a coluna fica. Para isso funcionar, cada
-- usuário precisa ter exatamente uma área, criada sozinha no cadastro.
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS archived_at;
ALTER TABLE public.workspaces DROP COLUMN IF EXISTS archived_by_system;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data ->> 'name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (user_id) DO NOTHING;

  -- A área única. O nome não aparece em lugar nenhum da interface.
  INSERT INTO public.workspaces (user_id, name)
  VALUES (NEW.id, 'Principal');

  RETURN NEW;
END;
$$;

-- Garante uma área para quem já existe (o usuário criado antes desta migration).
DO $$
DECLARE
  u record;
BEGIN
  FOR u IN SELECT id, email FROM auth.users LOOP
    INSERT INTO public.profiles (user_id, email)
    VALUES (u.id, u.email)
    ON CONFLICT (user_id) DO NOTHING;

    IF NOT EXISTS (SELECT 1 FROM public.workspaces WHERE user_id = u.id) THEN
      INSERT INTO public.workspaces (user_id, name)
      VALUES (u.id, 'Principal');
    END IF;
  END LOOP;
END;
$$;

-- Trava: uma área por usuário. Sem isso, "área única" seria só uma convenção
-- da interface, e um bug no backend poderia criar a segunda.
CREATE UNIQUE INDEX IF NOT EXISTS idx_workspaces_one_per_user
  ON public.workspaces (user_id);

-- ------------------------------------------------------------
-- 5. Facebook por token colado
-- ------------------------------------------------------------
-- Não há mais app do Facebook: o cliente cola o token e o sistema descobre as
-- contas. Estas duas colunas guardavam credencial de app e não têm mais uso.
ALTER TABLE public.facebook_connections DROP COLUMN IF EXISTS app_id;
ALTER TABLE public.facebook_connections DROP COLUMN IF EXISTS app_secret;

COMMIT;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
SELECT tablename, rowsecurity
FROM pg_tables
WHERE schemaname = 'public'
ORDER BY tablename;
