-- ============================================================
-- 0002 — Usuários permitidos e configurações globais
-- ============================================================
-- Não existe cadastro público. As contas são criadas à mão pelo admin, no
-- painel do Supabase (Authentication > Users > Add user), com o signup por
-- e-mail desligado.
--
-- Todos os usuários enxergam os mesmos dados: não há separação por usuário,
-- workspace, plano ou papel. A lista existe para responder uma pergunta só —
-- "esta pessoa pode entrar?".

-- ------------------------------------------------------------
-- app_users — quem tem acesso.
-- ------------------------------------------------------------
CREATE TABLE public.app_users (
  id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid        NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  email      text        NOT NULL,
  name       text,
  -- Desligar aqui tira o acesso na hora, sem apagar a conta no Auth nem perder
  -- o histórico. Apagar do Auth também funciona, mas é irreversível.
  is_active  boolean     NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_app_users_active ON public.app_users (user_id) WHERE is_active = true;

CREATE TRIGGER touch_app_users
  BEFORE UPDATE ON public.app_users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- ------------------------------------------------------------
-- is_allowed_user() — usada por TODAS as policies de RLS.
-- ------------------------------------------------------------
-- SECURITY DEFINER porque app_users tem RLS: a policy precisa poder ler a
-- tabela sem cair em recursão. STABLE e com auth.uid() dentro de subselect para
-- o Postgres avaliar uma vez por statement, não uma vez por linha.
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

-- ------------------------------------------------------------
-- Toda conta criada pelo admin entra na lista automaticamente.
-- ------------------------------------------------------------
-- Com o signup desligado no painel, a única origem de um INSERT em auth.users é
-- o próprio admin. Então registrar aqui é seguro: quem chegou até este ponto já
-- foi autorizado por quem tem acesso ao painel do Supabase.
--
-- Se o signup for reaberto um dia, esta é a linha a mudar: passe a inserir com
-- is_active = false e libere cada um à mão.
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

-- Mantém o e-mail em sincronia quando alguém o troca pelo Supabase Auth.
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

-- ------------------------------------------------------------
-- app_settings — o que antes eram colunas espalhadas em workspaces.
-- ------------------------------------------------------------
-- Linha única, garantida pelo PK booleano com CHECK.
CREATE TABLE public.app_settings (
  id                      boolean     PRIMARY KEY DEFAULT true CHECK (id),
  ad_spend_tax_percentage numeric     NOT NULL DEFAULT 0
                            CHECK (ad_spend_tax_percentage >= 0 AND ad_spend_tax_percentage <= 100),
  timezone                text        NOT NULL DEFAULT 'America/Sao_Paulo',
  currency                text        NOT NULL DEFAULT 'BRL',
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now()
);

CREATE TRIGGER touch_app_settings
  BEFORE UPDATE ON public.app_settings
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

-- A linha única já nasce criada, para o app nunca precisar tratar "não existe".
INSERT INTO public.app_settings (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Não existe uma tabela app_secrets: os únicos segredos do sistema são o token
-- do Meta (em meta_credentials) e os tokens dos checkouts (em checkout_secrets),
-- e os dois já ficam isolados nas suas próprias tabelas sem policy de RLS.
