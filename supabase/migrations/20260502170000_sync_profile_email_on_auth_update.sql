-- supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql
--
-- Defesa em profundidade para a feature "Settings/Profile unify".
-- Garante que qualquer UPDATE em auth.users.email reflete em profiles.email,
-- mesmo se um endpoint futuro alterar o auth sem passar pelo backend.

CREATE OR REPLACE FUNCTION public.sync_profile_email()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
       SET email = NEW.email,
           updated_at = now()
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE OF email ON auth.users
  FOR EACH ROW
  WHEN (NEW.email IS DISTINCT FROM OLD.email)
  EXECUTE FUNCTION public.sync_profile_email();
