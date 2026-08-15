-- Adiciona coluna plan_id na tabela profiles como FK para plan_rules.id
-- Substitui a coluna textual "plan" por uma referência por ID

-- 1. Adicionar a coluna plan_id
ALTER TABLE public.profiles
  ADD COLUMN plan_id uuid;

-- 2. Preencher plan_id com base no valor textual atual
UPDATE public.profiles p
SET plan_id = pr.id
FROM public.plan_rules pr
WHERE p.plan = pr.plan;

-- 3. Para profiles cujo plano não existe em plan_rules, vincular ao 'starter' (default atual)
UPDATE public.profiles p
SET plan_id = (SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1)
WHERE p.plan_id IS NULL;

-- 4. Tornar a coluna NOT NULL e adicionar a FK
ALTER TABLE public.profiles
  ALTER COLUMN plan_id SET NOT NULL,
  ADD CONSTRAINT profiles_plan_id_fkey FOREIGN KEY (plan_id) REFERENCES public.plan_rules(id);

-- 4b. Criar função helper para o default e usar como default da coluna
CREATE OR REPLACE FUNCTION public.default_starter_plan_id()
RETURNS uuid
LANGUAGE sql
STABLE
AS $$ SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1; $$;

ALTER TABLE public.profiles
  ALTER COLUMN plan_id SET DEFAULT public.default_starter_plan_id();

-- 5. Remover a coluna textual plan e o CHECK constraint
ALTER TABLE public.profiles
  DROP COLUMN plan;

-- 6. Atualizar trigger handle_new_user para incluir plan_id
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.profiles (user_id, email, name, plan_id)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'name', NEW.email),
    (SELECT id FROM public.plan_rules WHERE plan = 'starter' LIMIT 1)
  );

  INSERT INTO public.user_roles (user_id, role)
  VALUES (NEW.id, 'user');

  RETURN NEW;
END;
$$;
