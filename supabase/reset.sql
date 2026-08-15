-- ============================================================
-- RESET — apaga tudo no schema public
-- ============================================================
-- Rode ANTES do schema_completo.sql, para trocar o schema que está lá hoje
-- (as 20 tabelas da primeira tentativa) pelo schema real do projeto.
--
-- O QUE ESTE SCRIPT APAGA
--   Tudo dentro do schema `public`: tabelas, funções, tipos, triggers e as
--   políticas de RLS que dependem delas.
--
-- O QUE ELE NÃO TOCA
--   `auth.users`. Os usuários que você criou pelo painel continuam existindo,
--   com a mesma senha e o mesmo id. É por isso que dá para recriar o schema
--   sem precisar recadastrar ninguém.
--
--   Os triggers que o schema instala em auth.users são removidos aqui, e o
--   schema_completo.sql os recria — inclusive o handle_new_user, que passa a
--   criar profile + área única.
--
-- NÃO EXISTE VOLTA. Confira que não há dado que você queira antes de rodar.

BEGIN;

-- ------------------------------------------------------------
-- 1. Triggers que o schema instalou em auth.users
-- ------------------------------------------------------------
-- Precisam sair antes das funções que eles chamam.
DROP TRIGGER IF EXISTS on_auth_user_created       ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_email_updated ON auth.users;
DROP TRIGGER IF EXISTS on_auth_user_updated       ON auth.users;

-- ------------------------------------------------------------
-- 2. Job de limpeza do GTM, se tiver sido agendado
-- ------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    PERFORM cron.unschedule('purge-gtm-events');
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'Nada a desagendar (%).', SQLERRM;
END;
$$;

-- ------------------------------------------------------------
-- 3. O schema public inteiro
-- ------------------------------------------------------------
-- Recriar o schema é mais confiável do que derrubar objeto por objeto: leva
-- junto tabelas, views, funções, tipos, sequences e políticas, sem depender de
-- acertar a ordem das dependências.
DROP SCHEMA public CASCADE;
CREATE SCHEMA public;

-- Devolve os grants que o Supabase espera encontrar no schema.
GRANT USAGE  ON SCHEMA public TO postgres, anon, authenticated, service_role;
GRANT ALL    ON SCHEMA public TO postgres, service_role;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON TABLES TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON FUNCTIONS TO postgres, anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT ALL ON SEQUENCES TO postgres, anon, authenticated, service_role;

COMMIT;

-- ------------------------------------------------------------
-- Conferência
-- ------------------------------------------------------------
-- Esperado: nenhuma linha (o schema está vazio).
SELECT tablename FROM pg_tables WHERE schemaname = 'public';

-- Esperado: os usuários que você criou continuam aqui.
SELECT email, created_at FROM auth.users ORDER BY created_at;
