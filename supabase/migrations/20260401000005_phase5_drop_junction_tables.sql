-- Phase 5C: Drop junction tables — no longer needed since
-- workspace_id is directly on facebook_connections, checkout_integrations, etc.

DROP TABLE IF EXISTS public.workspace_products;
DROP TABLE IF EXISTS public.workspace_checkout_integrations;
DROP TABLE IF EXISTS public.workspace_connections;
