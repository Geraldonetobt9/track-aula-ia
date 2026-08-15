-- Add 4 new platforms to checkout_integrations.platform CHECK:
-- eduzz, mundpay, monetizze, greenn.
-- Their backend processors are now implemented (see
-- packages/backend/src/modules/webhooks/processors/{eduzz,mundpay,monetizze,greenn}.processor.ts).

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
    'lastlink'::text,
    'eduzz'::text,
    'mundpay'::text,
    'monetizze'::text,
    'greenn'::text
  ]));
