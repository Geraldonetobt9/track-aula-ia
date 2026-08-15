-- Auto-create a default workspace when a new user signs up.
-- This ensures every user can immediately set up integrations
-- without having to manually create a workspace first.

CREATE OR REPLACE FUNCTION public.handle_new_user()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
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

  INSERT INTO public.workspaces (user_id, name)
  VALUES (NEW.id, 'Principal');

  RETURN NEW;
END;
$function$;
