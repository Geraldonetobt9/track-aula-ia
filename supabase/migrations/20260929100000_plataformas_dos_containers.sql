-- ============================================================
-- Nove plataformas novas de checkout
-- ============================================================
-- Wiven, Frendz, Herospark, Kavoo, PagTrust, Assiny, Yampi, Wiapy e Doppus,
-- que até aqui só existiam nos containers do sGTM. O webhook delas é lido pelo
-- GenericCheckoutProcessor (packages/backend/src/modules/webhooks/processors/
-- generic), a partir dos mesmos caminhos que os containers usavam.
--
-- Sem esta migration, criar a integração em Integrações falha no CHECK.

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
    'greenn'::text,
    'wiven'::text,
    'frendz'::text,
    'herospark'::text,
    'kavoo'::text,
    'pagtrust'::text,
    'assiny'::text,
    'yampi'::text,
    'wiapy'::text,
    'doppus'::text
  ]));
