-- supabase/migrations/20260420100000_profiles_add_cnpj_and_signup_trigger.sql
--
-- 1. Add `cnpj` column to profiles (sibling of cpf; a user has CPF XOR CNPJ).
-- 2. Enforce uniqueness via partial unique indexes on non-null values.
-- 3. Update handle_new_user trigger to:
--    - read cpf/cnpj from user_metadata (signup form sends them there)
--    - default new users to the Free plan (was: starter)
--    - auto-create the subscriptions row so onboarding flow works

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS cnpj text;

COMMENT ON COLUMN public.profiles.cnpj IS
  'Brazilian CNPJ (14 digits). NULL when user registered with CPF instead.';

CREATE UNIQUE INDEX IF NOT EXISTS idx_profiles_cnpj_unique
  ON public.profiles(cnpj)
  WHERE cnpj IS NOT NULL;

-- Updated trigger
CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
DECLARE
  v_free_plan_id uuid;
  v_cpf text;
  v_cnpj text;
  v_now timestamptz := now();
BEGIN
  SELECT id INTO v_free_plan_id FROM public.plan_rules WHERE plan = 'free' LIMIT 1;

  -- Normalize cpf/cnpj to digits-only if present in metadata
  v_cpf := NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'cpf', ''), '\D', '', 'g'), '');
  v_cnpj := NULLIF(regexp_replace(COALESCE(NEW.raw_user_meta_data->>'cnpj', ''), '\D', '', 'g'), '');

  INSERT INTO public.profiles (user_id, email, name, plan_id, cpf, cnpj)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    v_free_plan_id,
    v_cpf,
    v_cnpj
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  INSERT INTO public.workspaces (user_id, name)
  VALUES (NEW.id, 'Principal');

  INSERT INTO public.subscriptions (user_id, plan_id, status, current_period_start, current_period_end)
  VALUES (
    NEW.id,
    v_free_plan_id,
    'active',
    v_now,
    v_now + interval '30 days'
  );

  RETURN NEW;
END;
$function$;
