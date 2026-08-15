-- Add name column to checkout_integrations for identifying multiple integrations of the same platform
ALTER TABLE public.checkout_integrations
ADD COLUMN name TEXT NOT NULL DEFAULT '';

-- Backfill existing integrations with auto-generated names
WITH ranked AS (
  SELECT id, platform,
    ROW_NUMBER() OVER (PARTITION BY workspace_id, platform ORDER BY created_at) AS rn
  FROM public.checkout_integrations
  WHERE name = ''
)
UPDATE public.checkout_integrations ci
SET name = ranked.platform || ' #' || ranked.rn
FROM ranked
WHERE ci.id = ranked.id;

-- Remove default after backfill so new inserts require a name
ALTER TABLE public.checkout_integrations
ALTER COLUMN name DROP DEFAULT;
