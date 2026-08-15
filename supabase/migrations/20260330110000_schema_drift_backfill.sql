-- ============================================================
-- Desvio de schema: colunas que existem no banco mas em nenhuma migration
-- ============================================================
-- O banco original acumulou colunas criadas fora do controle de versão —
-- pelo painel do Supabase, provavelmente. O resultado é que replayar as
-- migrations num banco vazio NÃO reproduz o schema real: migrations
-- posteriores referenciam colunas que nenhuma delas cria, e a aplicação
-- quebra com "column ... does not exist".
--
-- Foi assim que apareceu o erro 42703 em campaigns.facebook_connection_id.
--
-- Este arquivo fecha o buraco. As colunas vêm do dump real (SQL_DATABASE.md),
-- e ele roda antes da primeira migration que as usa (20260330120000).
--
-- Cada bloco checa se a tabela existe. Sem isso, a ordem entre este arquivo e
-- a criação de cada tabela viraria uma dependência frágil, e um ALTER numa
-- tabela ainda inexistente derrubaria o script inteiro.

DO $$
BEGIN
  -- ----------------------------------------------------------
  -- Vínculo com a conexão do Facebook, na hierarquia e nas métricas
  -- ----------------------------------------------------------
  IF to_regclass('public.campaigns') IS NOT NULL THEN
    ALTER TABLE public.campaigns
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid;
  END IF;

  IF to_regclass('public.ad_sets') IS NOT NULL THEN
    ALTER TABLE public.ad_sets
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid;
  END IF;

  IF to_regclass('public.ads') IS NOT NULL THEN
    ALTER TABLE public.ads
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid;
  END IF;

  IF to_regclass('public.daily_ad_spend') IS NOT NULL THEN
    ALTER TABLE public.daily_ad_spend
      ADD COLUMN IF NOT EXISTS facebook_connection_id uuid,
      ADD COLUMN IF NOT EXISTS purchase_value numeric DEFAULT 0;
  END IF;

  -- ----------------------------------------------------------
  -- Credenciais de app do Facebook
  -- ----------------------------------------------------------
  -- A migration de simplificação derruba as duas no fim. Elas existem aqui
  -- porque migrations intermediárias as referenciam.
  IF to_regclass('public.facebook_connections') IS NOT NULL THEN
    ALTER TABLE public.facebook_connections
      ADD COLUMN IF NOT EXISTS app_id text,
      ADD COLUMN IF NOT EXISTS app_secret text;
  END IF;

  -- ----------------------------------------------------------
  -- Localização do cliente, usada no mapa de vendas por região
  -- ----------------------------------------------------------
  IF to_regclass('public.sales') IS NOT NULL THEN
    ALTER TABLE public.sales
      ADD COLUMN IF NOT EXISTS customer_state   text,
      ADD COLUMN IF NOT EXISTS customer_city    text,
      ADD COLUMN IF NOT EXISTS customer_country text DEFAULT 'BR';
  END IF;

  -- ----------------------------------------------------------
  -- Perfil
  -- ----------------------------------------------------------
  -- cpf e active seguem em uso; as duas de assinatura são derrubadas depois,
  -- junto com a cobrança.
  IF to_regclass('public.profiles') IS NOT NULL THEN
    ALTER TABLE public.profiles
      ADD COLUMN IF NOT EXISTS cpf                text,
      ADD COLUMN IF NOT EXISTS active             boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS subscription_start date,
      ADD COLUMN IF NOT EXISTS subscription_end   date;
  END IF;

END;
$$;
