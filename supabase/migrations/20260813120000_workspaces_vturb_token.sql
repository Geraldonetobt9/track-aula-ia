-- VTurb Analytics API token, per workspace.
--
-- Stored encrypted (EncryptionService, AES-256-GCM) like the Facebook access
-- tokens, and never returned to the browser: every VTurb call is proxied by the
-- backend. A key in the frontend bundle would be readable by anyone who opens
-- devtools, and VTurb has no CORS allowance for browser calls anyway.
ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS vturb_api_token text;
