-- ============================================================
-- DIAGNÓSTICO — por que o login não passa
-- ============================================================
-- Rode no SQL Editor e me mande o resultado. Cada linha responde uma pergunta
-- específica; a que vier com `false` é a causa.

SELECT
  'usuário existe no Auth' AS verificacao,
  (SELECT count(*) FROM auth.users)::text AS valor,
  (SELECT count(*) FROM auth.users) > 0 AS ok

UNION ALL SELECT
  'tem linha em profiles',
  (SELECT count(*) FROM public.profiles)::text,
  (SELECT count(*) FROM public.profiles) > 0

UNION ALL SELECT
  'profile casa com o usuário do Auth',
  COALESCE((
    SELECT string_agg(p.email, ', ')
    FROM public.profiles p
    JOIN auth.users u ON u.id = p.user_id
  ), '(nenhum)'),
  EXISTS (SELECT 1 FROM public.profiles p JOIN auth.users u ON u.id = p.user_id)

UNION ALL SELECT
  'tem área (workspace)',
  (SELECT count(*) FROM public.workspaces)::text,
  (SELECT count(*) FROM public.workspaces) > 0

UNION ALL SELECT
  'profiles.active é true',
  COALESCE((SELECT bool_and(active)::text FROM public.profiles), '(sem linhas)'),
  COALESCE((SELECT bool_and(active) FROM public.profiles), false)

UNION ALL SELECT
  'RLS de leitura em profiles existe',
  COALESCE((
    SELECT string_agg(policyname, ', ')
    FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('SELECT', 'ALL')
  ), '(nenhuma)'),
  EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'profiles' AND cmd IN ('SELECT', 'ALL')
  )

UNION ALL SELECT
  'colunas que o app lê existem',
  COALESCE((
    SELECT string_agg(column_name, ', ' ORDER BY column_name)
    FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('name', 'email', 'avatar_url', 'created_at', 'active')
  ), '(nenhuma)'),
  (
    SELECT count(*) FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'profiles'
      AND column_name IN ('name', 'email', 'avatar_url', 'created_at', 'active')
  ) = 5

UNION ALL SELECT
  'tabelas no schema public',
  (SELECT count(*)::text FROM pg_tables WHERE schemaname = 'public'),
  (SELECT count(*) FROM pg_tables WHERE schemaname = 'public') >= 19;

-- ------------------------------------------------------------
-- Conserto, se faltar profile ou área
-- ------------------------------------------------------------
-- Seguro rodar mesmo que já exista: não duplica.
INSERT INTO public.profiles (user_id, email, name)
SELECT u.id, u.email, COALESCE(u.raw_user_meta_data ->> 'name', split_part(u.email, '@', 1))
FROM auth.users u
ON CONFLICT (user_id) DO NOTHING;

INSERT INTO public.workspaces (user_id, name)
SELECT u.id, 'Principal'
FROM auth.users u
WHERE NOT EXISTS (SELECT 1 FROM public.workspaces w WHERE w.user_id = u.id);

SELECT p.email, p.active, w.name AS area
FROM public.profiles p
LEFT JOIN public.workspaces w ON w.user_id = p.user_id;
