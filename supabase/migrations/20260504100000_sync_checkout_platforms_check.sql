-- Sync the checkout_integrations.platform CHECK with the application's
-- supported platforms.
--
-- - Removes 'balaclava' (integration deleted from the codebase; no rows
--   reference this value, verified before running this migration).
-- - Adds 'hubla', 'cartpanda', 'ggcheckout', 'lastlink' so the frontend can
--   register integrations for those platforms (their backend processors
--   already exist).
-- - 'n8n-profiles' is intentionally excluded — it is a profile-only
--   processor, not a checkout integration.

ALTER TABLE public.checkout_integrations
  DROP CONSTRAINT IF EXISTS checkout_integrations_platform_check;

ALTER TABLE public.checkout_integrations
  ADD CONSTRAINT checkout_integrations_platform_check
  CHECK (platform = ANY (ARRAY[
    'hotmart'::text,
    'kiwify'::text,
    'kirvano'::text,
    'guru'::text,
    'perfectpay'::text,
    'ticto'::text,
    'payt'::text,
    'cakto'::text,
    'hubla'::text,
    'cartpanda'::text,
    'ggcheckout'::text,
    'lastlink'::text
  ]));
