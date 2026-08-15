-- ============================================================
-- 0001 — Extensões e funções auxiliares
-- ============================================================
-- Roda uma vez, em um projeto Supabase novo e vazio.

CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Mantém updated_at sempre correto sem depender do código da aplicação.
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

-- Extrai o primeiro trecho numérico (>= 6 dígitos) de uma string com | ou /.
-- Usado na atribuição de vendas: o ad_id às vezes chega dentro do utm_content
-- no formato "campanha|conjunto|123456789".
CREATE OR REPLACE FUNCTION public.extract_numeric_ad_id(raw text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT trim(p)
  FROM regexp_split_to_table(coalesce(raw, ''), '[|/]') AS p
  WHERE trim(p) ~ '^[0-9]{6,}$'
  LIMIT 1;
$$;
