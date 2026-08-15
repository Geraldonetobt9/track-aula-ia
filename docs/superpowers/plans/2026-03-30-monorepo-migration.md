> **STATUS: EXECUTADO em 2026-03-30.** Este plano foi implementado com sucesso. Mantido como referencia historica.

# Monorepo Migration & Supabase Consolidation Plan

**Goal:** Transform the Sentinel project from a single Supabase-based app into a monorepo with a NestJS backend (Fastify adapter) and a React frontend, consolidating two Supabase projects into one.

**Architecture:** The current project uses two Supabase instances (External `picgyetvkjymfrgsjozt` for business data + Cloud `obmkhvzargmcgndaioxb` for workspace/financial data) with 27 Edge Functions in Deno. We consolidate into one Supabase, move all server logic into a NestJS backend with Fastify, and refactor the React frontend to call the backend API instead of Supabase directly. Auth stays in Supabase Auth; the backend validates JWTs via a Guard.

**Tech Stack:** NestJS 10 + Fastify, @nestjs/schedule, @nestjs/config, @supabase/supabase-js, npm workspaces, Turborepo, Vite + React 18 + React Query

---

## Scope Note

This plan covers 4 phases that MUST be executed sequentially:
1. **Phase 1** (Tasks 1-2): SQL migration + monorepo scaffold
2. **Phase 2** (Tasks 3-10): NestJS backend — shared services, helpers, guards, modules
3. **Phase 3** (Tasks 11-13): Frontend refactor — API client, hooks, cleanup
4. **Phase 4** (Task 14): Monorepo config + verification

Each phase produces working, testable code. Later phases depend on earlier ones.

---

## File Structure

### Root (monorepo)
```
/
├── packages/
│   ├── frontend/     ← All current src/ content moves here
│   └── backend/      ← New NestJS app
├── supabase/         ← Stays at root (migrations + config)
├── package.json      ← Root workspaces config
├── turbo.json        ← Turborepo config
└── tsconfig.json     ← Base shared TS config
```

### packages/backend/
```
packages/backend/
├── src/
│   ├── main.ts
│   ├── app.module.ts
│   ├── config/
│   │   └── supabase.config.ts
│   ├── common/
│   │   ├── guards/
│   │   │   ├── auth.guard.ts
│   │   │   └── admin.guard.ts
│   │   ├── decorators/
│   │   │   └── current-user.decorator.ts
│   │   └── filters/
│   │       └── http-exception.filter.ts
│   ├── modules/
│   │   ├── webhooks/
│   │   │   ├── webhooks.module.ts
│   │   │   ├── webhooks.controller.ts
│   │   │   ├── webhooks.service.ts
│   │   │   ├── processors/
│   │   │   │   ├── kirvano.processor.ts
│   │   │   │   ├── hotmart.processor.ts
│   │   │   │   ├── guru.processor.ts
│   │   │   │   ├── perfectpay.processor.ts
│   │   │   │   ├── kiwify.processor.ts
│   │   │   │   ├── ticto.processor.ts
│   │   │   │   ├── cakto.processor.ts
│   │   │   │   ├── payt.processor.ts
│   │   │   │   ├── balaclava.processor.ts
│   │   │   │   └── n8n-profiles.processor.ts
│   │   │   └── webhook-queue.service.ts
│   │   ├── facebook/
│   │   │   ├── facebook.module.ts
│   │   │   ├── facebook.controller.ts
│   │   │   ├── facebook.service.ts
│   │   │   ├── insights.service.ts
│   │   │   ├── sync.service.ts
│   │   │   └── sale-matcher.service.ts
│   │   ├── admin/
│   │   │   ├── admin.module.ts
│   │   │   ├── admin.controller.ts
│   │   │   └── admin.service.ts
│   │   ├── workspaces/
│   │   │   ├── workspaces.module.ts
│   │   │   ├── workspaces.controller.ts
│   │   │   └── workspaces.service.ts
│   │   ├── financial/
│   │   │   ├── financial.module.ts
│   │   │   ├── financial.controller.ts
│   │   │   └── financial.service.ts
│   │   ├── plans/
│   │   │   ├── plans.module.ts
│   │   │   ├── plans.controller.ts
│   │   │   └── plans.service.ts
│   │   ├── sales/
│   │   │   ├── sales.module.ts
│   │   │   ├── sales.controller.ts
│   │   │   └── sales.service.ts
│   │   ├── metrics/
│   │   │   ├── metrics.module.ts
│   │   │   ├── metrics.controller.ts
│   │   │   └── metrics.service.ts
│   │   └── utils/
│   │       ├── utils.module.ts
│   │       ├── genderize.service.ts
│   │       └── email.service.ts
│   ├── shared/
│   │   ├── services/
│   │   │   ├── supabase.service.ts
│   │   │   └── encryption.service.ts
│   │   └── helpers/
│   │       ├── normalize-state.ts
│   │       ├── ddd-to-state.ts
│   │       ├── currency.ts
│   │       └── extract-webhook-token.ts
│   └── types/
│       └── index.ts
├── package.json
├── tsconfig.json
├── nest-cli.json
├── .env.example
└── Dockerfile
```

### packages/frontend/
```
packages/frontend/
├── src/
│   ├── lib/
│   │   └── api.ts           ← NEW: HTTP client for backend
│   ├── integrations/
│   │   └── supabase/
│   │       ├── client.ts    ← KEEP (auth only, rewritten)
│   │       └── types.ts     ← KEEP
│   ├── hooks/               ← All hooks refactored
│   ├── contexts/            ← Refactored
│   ├── components/          ← Unchanged
│   ├── pages/               ← Unchanged
│   └── ...
├── package.json
├── tsconfig.json
├── tsconfig.app.json
├── vite.config.ts
└── index.html
```

---

## Phase 1: Database Migration & Monorepo Scaffold

### Task 1: SQL Migration — Consolidate Cloud Tables into Main Supabase

The Cloud Supabase (`obmkhvzargmcgndaioxb`) has tables: workspaces, workspace_connections, workspace_checkout_integrations, workspace_products, financial_entries, plan_rules, company_costs, welcome_emails_sent. Some of these already exist in migrations for the Cloud project. We need ONE new migration that creates them in the main Supabase project (`picgyetvkjymfrgsjozt`).

**Important:** The `types.ts` file shows these tables exist in the Cloud schema. The existing migrations in `supabase/migrations/` are for the Cloud project (the `config.toml` points to `obmkhvzargmcgndaioxb`). The main/external Supabase already has: profiles, user_roles, facebook_connections, campaigns, ad_sets, ads, sales, daily_ad_spend, checkout_integrations, sync_schedules, sync_logs, processing_jobs. We must NOT recreate those.

**Files:**
- Create: `supabase/migrations/20260330120000_consolidate_cloud_tables.sql`

- [ ] **Step 1: Create the consolidation migration**

```sql
-- Migration: Bring Cloud tables into the main Supabase project
-- These tables previously lived in a separate Supabase project (obmkhvzargmcgndaioxb)
-- and are now consolidated into the primary project (picgyetvkjymfrgsjozt).

-- ============================================================
-- workspaces
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own workspaces"
  ON public.workspaces FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own workspaces"
  ON public.workspaces FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own workspaces"
  ON public.workspaces FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own workspaces"
  ON public.workspaces FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all workspaces"
  ON public.workspaces FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_workspaces_user_id ON public.workspaces(user_id);

-- ============================================================
-- workspace_connections
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  facebook_connection_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, facebook_connection_id)
);

ALTER TABLE public.workspace_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own workspace connections"
  ON public.workspace_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces
      WHERE workspaces.id = workspace_connections.workspace_id
        AND workspaces.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all workspace connections"
  ON public.workspace_connections FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- ============================================================
-- workspace_checkout_integrations
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_checkout_integrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  checkout_integration_id TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, checkout_integration_id)
);

ALTER TABLE public.workspace_checkout_integrations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces
      WHERE workspaces.id = workspace_checkout_integrations.workspace_id
        AND workspaces.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all workspace checkout integrations"
  ON public.workspace_checkout_integrations FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- ============================================================
-- workspace_products
-- ============================================================
CREATE TABLE IF NOT EXISTS public.workspace_products (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  product_name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now(),
  UNIQUE(workspace_id, product_name)
);

ALTER TABLE public.workspace_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can manage own workspace products"
  ON public.workspace_products FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.workspaces
      WHERE workspaces.id = workspace_products.workspace_id
        AND workspaces.user_id = auth.uid()
    )
  );

CREATE POLICY "Admins can manage all workspace products"
  ON public.workspace_products FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- ============================================================
-- financial_entries
-- ============================================================
CREATE TABLE IF NOT EXISTS public.financial_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('expense', 'revenue')),
  name TEXT NOT NULL,
  amount NUMERIC DEFAULT 0,
  reference_month DATE NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.financial_entries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own financial entries"
  ON public.financial_entries FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own financial entries"
  ON public.financial_entries FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own financial entries"
  ON public.financial_entries FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own financial entries"
  ON public.financial_entries FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all financial entries"
  ON public.financial_entries FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_financial_entries_user_id ON public.financial_entries(user_id);
CREATE INDEX IF NOT EXISTS idx_financial_entries_workspace_id ON public.financial_entries(workspace_id);

-- ============================================================
-- plan_rules (global config — no RLS needed for reads)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.plan_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan TEXT NOT NULL UNIQUE,
  max_campaigns INTEGER DEFAULT -1,
  max_sales INTEGER DEFAULT -1,
  max_checkout_integrations INTEGER DEFAULT 1,
  max_ad_accounts INTEGER DEFAULT 1,
  max_workspaces INTEGER DEFAULT 1,
  sync_interval_minutes INTEGER DEFAULT 60,
  feature_sales_globe BOOLEAN DEFAULT false,
  feature_advanced_reports BOOLEAN DEFAULT false,
  feature_conversion_funnel BOOLEAN DEFAULT false,
  feature_auto_sync BOOLEAN DEFAULT false,
  feature_api_access BOOLEAN DEFAULT false,
  created_at TIMESTAMPTZ DEFAULT now(),
  updated_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.plan_rules ENABLE ROW LEVEL SECURITY;

-- Everyone can read plan rules
CREATE POLICY "Anyone can read plan rules"
  ON public.plan_rules FOR SELECT
  USING (true);

-- Only admins can modify plan rules
CREATE POLICY "Admins can manage plan rules"
  ON public.plan_rules FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- Seed default plan rules
INSERT INTO public.plan_rules (plan, max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts, max_workspaces, sync_interval_minutes, feature_sales_globe, feature_advanced_reports, feature_conversion_funnel, feature_auto_sync, feature_api_access)
VALUES
  ('free',       5,    100,  1, 1, 1, 60,  false, false, false, false, false),
  ('starter',   -1,   -1,   3, 2, 2, 30,  false, true,  false, true,  false),
  ('pro',       -1,   -1,   5, 5, 5, 15,  true,  true,  true,  true,  false),
  ('enterprise',-1,   -1,  -1,-1,-1, 15,  true,  true,  true,  true,  true),
  ('unlimited', -1,   -1,  -1,-1,-1, 15,  true,  true,  true,  true,  true)
ON CONFLICT (plan) DO NOTHING;

-- ============================================================
-- company_costs
-- ============================================================
CREATE TABLE IF NOT EXISTS public.company_costs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL,
  name TEXT NOT NULL,
  type TEXT NOT NULL CHECK (type IN ('percentage', 'fixed')),
  value NUMERIC NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.company_costs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own company costs"
  ON public.company_costs FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own company costs"
  ON public.company_costs FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own company costs"
  ON public.company_costs FOR UPDATE
  USING (auth.uid() = user_id);

CREATE POLICY "Users can delete own company costs"
  ON public.company_costs FOR DELETE
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can manage all company costs"
  ON public.company_costs FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_company_costs_user_id ON public.company_costs(user_id);

-- ============================================================
-- welcome_emails_sent
-- ============================================================
CREATE TABLE IF NOT EXISTS public.welcome_emails_sent (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT NOT NULL UNIQUE,
  sent_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.welcome_emails_sent ENABLE ROW LEVEL SECURITY;

-- Service role only — no user-level access needed
CREATE POLICY "Admins can manage welcome emails"
  ON public.welcome_emails_sent FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

-- ============================================================
-- webhook_queue (if not already created in main project)
-- ============================================================
CREATE TABLE IF NOT EXISTS public.webhook_queue (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  platform TEXT NOT NULL,
  payload JSONB NOT NULL,
  status TEXT DEFAULT 'pending',
  attempts INTEGER DEFAULT 0,
  max_attempts INTEGER DEFAULT 3,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now(),
  processed_at TIMESTAMPTZ,
  next_retry_at TIMESTAMPTZ DEFAULT now()
);

ALTER TABLE public.webhook_queue ENABLE ROW LEVEL SECURITY;

-- Service role only
CREATE POLICY "Admins can manage webhook queue"
  ON public.webhook_queue FOR ALL
  USING (
    EXISTS (
      SELECT 1 FROM public.user_roles
      WHERE user_roles.user_id = auth.uid()
        AND user_roles.role = 'admin'
    )
  );

CREATE INDEX IF NOT EXISTS idx_webhook_queue_status ON public.webhook_queue(status);
CREATE INDEX IF NOT EXISTS idx_webhook_queue_next_retry ON public.webhook_queue(next_retry_at);
```

- [ ] **Step 2: Verify migration is valid SQL**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && cat supabase/migrations/20260330120000_consolidate_cloud_tables.sql | head -5`
Expected: Shows the first lines of the migration file.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260330120000_consolidate_cloud_tables.sql
git commit -m "feat: add migration to consolidate Cloud tables into main Supabase"
```

---

### Task 2: Monorepo Scaffold — Root config + move frontend + backend skeleton

**Files:**
- Create: `package.json` (root — replace current)
- Create: `turbo.json`
- Create: `tsconfig.json` (root — replace current)
- Move: all frontend files into `packages/frontend/`
- Create: `packages/frontend/package.json`
- Create: `packages/frontend/tsconfig.json`
- Create: `packages/frontend/tsconfig.app.json`
- Move: `vite.config.ts` → `packages/frontend/vite.config.ts`
- Move: `index.html` → `packages/frontend/index.html`
- Move: `tailwind.config.ts` → `packages/frontend/tailwind.config.ts`
- Move: `postcss.config.js` → `packages/frontend/postcss.config.js`
- Move: `components.json` → `packages/frontend/components.json`
- Move: `vitest.config.ts` → `packages/frontend/vitest.config.ts`
- Move: `vercel.json` → `packages/frontend/vercel.json`
- Move: `public/` → `packages/frontend/public/`
- Move: `src/` → `packages/frontend/src/`
- Create: `packages/backend/package.json`
- Create: `packages/backend/tsconfig.json`
- Create: `packages/backend/nest-cli.json`
- Create: `packages/backend/.env.example`
- Create: `packages/backend/Dockerfile`
- Create: `packages/backend/src/main.ts`
- Create: `packages/backend/src/app.module.ts`

- [ ] **Step 1: Create root package.json**

```json
{
  "name": "sentinel",
  "private": true,
  "workspaces": [
    "packages/*"
  ],
  "scripts": {
    "dev": "turbo dev",
    "build": "turbo build",
    "dev:frontend": "turbo dev --filter=@sentinel/frontend",
    "dev:backend": "turbo dev --filter=@sentinel/backend",
    "lint": "turbo lint",
    "test": "turbo test"
  },
  "devDependencies": {
    "turbo": "^2.4.0"
  }
}
```

- [ ] **Step 2: Create turbo.json**

```json
{
  "$schema": "https://turbo.build/schema.json",
  "tasks": {
    "dev": {
      "persistent": true,
      "cache": false
    },
    "build": {
      "outputs": ["dist/**"]
    },
    "lint": {},
    "test": {}
  }
}
```

- [ ] **Step 3: Create root tsconfig.json**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "resolveJsonModule": true,
    "isolatedModules": true
  }
}
```

- [ ] **Step 4: Move frontend files**

```bash
mkdir -p packages/frontend

# Move source files
mv src packages/frontend/
mv public packages/frontend/
mv index.html packages/frontend/

# Move config files
mv vite.config.ts packages/frontend/
mv vitest.config.ts packages/frontend/
mv tailwind.config.ts packages/frontend/
mv postcss.config.js packages/frontend/
mv components.json packages/frontend/
mv vercel.json packages/frontend/
mv tsconfig.app.json packages/frontend/
mv tsconfig.node.json packages/frontend/
mv eslint.config.js packages/frontend/
```

- [ ] **Step 5: Create packages/frontend/package.json**

Take the current root `package.json` dependencies and scripts, rename to `@sentinel/frontend`:

```json
{
  "name": "@sentinel/frontend",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "vite build",
    "build:dev": "vite build --mode development",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "@hookform/resolvers": "^3.10.0",
    "@radix-ui/react-accordion": "^1.2.11",
    "@radix-ui/react-alert-dialog": "^1.1.14",
    "@radix-ui/react-aspect-ratio": "^1.1.7",
    "@radix-ui/react-avatar": "^1.1.10",
    "@radix-ui/react-checkbox": "^1.3.2",
    "@radix-ui/react-collapsible": "^1.1.11",
    "@radix-ui/react-context-menu": "^2.2.15",
    "@radix-ui/react-dialog": "^1.1.14",
    "@radix-ui/react-dropdown-menu": "^2.1.15",
    "@radix-ui/react-hover-card": "^1.1.14",
    "@radix-ui/react-label": "^2.1.7",
    "@radix-ui/react-menubar": "^1.1.15",
    "@radix-ui/react-navigation-menu": "^1.2.13",
    "@radix-ui/react-popover": "^1.1.14",
    "@radix-ui/react-progress": "^1.1.7",
    "@radix-ui/react-radio-group": "^1.3.7",
    "@radix-ui/react-scroll-area": "^1.2.9",
    "@radix-ui/react-select": "^2.2.5",
    "@radix-ui/react-separator": "^1.1.7",
    "@radix-ui/react-slider": "^1.3.5",
    "@radix-ui/react-slot": "^1.2.3",
    "@radix-ui/react-switch": "^1.2.5",
    "@radix-ui/react-tabs": "^1.1.12",
    "@radix-ui/react-toast": "^1.2.14",
    "@radix-ui/react-toggle": "^1.1.9",
    "@radix-ui/react-toggle-group": "^1.1.10",
    "@radix-ui/react-tooltip": "^1.2.7",
    "@supabase/supabase-js": "^2.95.3",
    "@tanstack/react-query": "^5.83.0",
    "class-variance-authority": "^0.7.1",
    "clsx": "^2.1.1",
    "cmdk": "^1.1.1",
    "date-fns": "^3.6.0",
    "embla-carousel-react": "^8.6.0",
    "input-otp": "^1.4.2",
    "lucide-react": "^0.462.0",
    "next-themes": "^0.3.0",
    "react": "18.2.0",
    "react-day-picker": "^8.10.1",
    "react-dom": "18.2.0",
    "react-hook-form": "^7.61.1",
    "react-resizable-panels": "^2.1.9",
    "react-router-dom": "^6.30.1",
    "recharts": "^2.15.4",
    "sonner": "^1.7.4",
    "tailwind-merge": "^2.6.0",
    "tailwindcss-animate": "^1.0.7",
    "topojson-client": "^3.1.0",
    "vaul": "^0.9.9",
    "world-atlas": "^2.0.2",
    "zod": "^3.25.76"
  },
  "devDependencies": {
    "@eslint/js": "^9.32.0",
    "@tailwindcss/typography": "^0.5.16",
    "@testing-library/jest-dom": "^6.6.0",
    "@testing-library/react": "^16.0.0",
    "@types/node": "^22.16.5",
    "@types/react": "^18.3.23",
    "@types/react-dom": "^18.3.7",
    "@types/topojson-client": "^3.1.5",
    "@vitejs/plugin-react-swc": "^3.11.0",
    "autoprefixer": "^10.4.21",
    "eslint": "^9.32.0",
    "eslint-plugin-react-hooks": "^5.2.0",
    "eslint-plugin-react-refresh": "^0.4.20",
    "globals": "^15.15.0",
    "jsdom": "^20.0.3",
    "lovable-tagger": "^1.1.13",
    "postcss": "^8.5.6",
    "tailwindcss": "^3.4.17",
    "typescript": "^5.8.3",
    "typescript-eslint": "^8.38.0",
    "vite": "^5.4.19",
    "vitest": "^3.2.4"
  }
}
```

- [ ] **Step 6: Create packages/frontend/tsconfig.json**

```json
{
  "files": [],
  "references": [
    { "path": "./tsconfig.app.json" },
    { "path": "./tsconfig.node.json" }
  ]
}
```

Note: `tsconfig.app.json` and `tsconfig.node.json` were already moved in Step 4. No changes needed to their content — the `@/` alias resolution is handled by vite.config.ts.

- [ ] **Step 7: Create backend package.json**

```json
{
  "name": "@sentinel/backend",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "nest start --watch",
    "build": "nest build",
    "start": "node dist/main",
    "start:prod": "node dist/main",
    "lint": "eslint \"{src,test}/**/*.ts\"",
    "test": "jest",
    "test:watch": "jest --watch"
  },
  "dependencies": {
    "@nestjs/common": "^10.4.0",
    "@nestjs/config": "^3.3.0",
    "@nestjs/core": "^10.4.0",
    "@nestjs/platform-fastify": "^10.4.0",
    "@nestjs/schedule": "^4.1.0",
    "@supabase/supabase-js": "^2.95.3",
    "fastify": "^4.28.0",
    "reflect-metadata": "^0.2.2",
    "rxjs": "^7.8.1"
  },
  "devDependencies": {
    "@nestjs/cli": "^10.4.0",
    "@nestjs/schematics": "^10.2.0",
    "@nestjs/testing": "^10.4.0",
    "@types/node": "^22.16.5",
    "jest": "^29.7.0",
    "ts-jest": "^29.3.0",
    "typescript": "^5.8.3"
  }
}
```

- [ ] **Step 8: Create packages/backend/tsconfig.json**

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "declaration": true,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "target": "ES2022",
    "sourceMap": true,
    "outDir": "./dist",
    "baseUrl": "./",
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "forceConsistentCasingInFileNames": true,
    "noFallthroughCasesInSwitch": true,
    "resolveJsonModule": true,
    "esModuleInterop": true,
    "paths": {
      "@/*": ["src/*"]
    }
  },
  "include": ["src/**/*"],
  "exclude": ["node_modules", "dist"]
}
```

- [ ] **Step 9: Create packages/backend/nest-cli.json**

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

- [ ] **Step 10: Create packages/backend/.env.example**

```env
# Server
PORT=3001
NODE_ENV=development
FRONTEND_URL=http://localhost:5173

# Supabase (single project — no more Cloud separation)
SUPABASE_URL=https://picgyetvkjymfrgsjozt.supabase.co
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
SUPABASE_JWT_SECRET=

# Encryption
ENCRYPTION_KEY=

# Facebook
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=

# External APIs
GENDERIZE_API_KEY=
RESEND_API_KEY=
```

- [ ] **Step 11: Create packages/backend/src/main.ts**

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  app.enableCors({
    origin: process.env.FRONTEND_URL || 'http://localhost:5173',
    credentials: true,
  });

  app.setGlobalPrefix('api');

  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
```

- [ ] **Step 12: Create packages/backend/src/app.module.ts (minimal scaffold)**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),
    ScheduleModule.forRoot(),
  ],
})
export class AppModule {}
```

- [ ] **Step 13: Create packages/backend/Dockerfile**

```dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "dist/main"]
```

- [ ] **Step 14: Install dependencies and verify**

```bash
cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel
rm -f package-lock.json bun.lock
npm install
```

Expected: `node_modules` created with workspaces linked.

- [ ] **Step 15: Verify frontend dev server starts**

```bash
cd packages/frontend && npx vite --port 5173 &
sleep 3
curl -s http://localhost:5173 | head -5
kill %1
```

Expected: HTML output from Vite dev server.

- [ ] **Step 16: Verify backend compiles**

```bash
cd packages/backend && npx nest build
```

Expected: `dist/` directory created with compiled JS.

- [ ] **Step 17: Commit**

```bash
git add -A
git commit -m "feat: scaffold monorepo with npm workspaces + Turborepo, move frontend, create backend skeleton"
```

---

## Phase 2: NestJS Backend

### Task 3: Shared Services — SupabaseService + EncryptionService

**Files:**
- Create: `packages/backend/src/shared/services/supabase.service.ts`
- Create: `packages/backend/src/shared/services/encryption.service.ts`
- Create: `packages/backend/src/shared/shared.module.ts`

- [ ] **Step 1: Create SupabaseService**

```typescript
// packages/backend/src/shared/services/supabase.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

@Injectable()
export class SupabaseService {
  private readonly client: SupabaseClient;

  constructor(private config: ConfigService) {
    this.client = createClient(
      this.config.getOrThrow<string>('SUPABASE_URL'),
      this.config.getOrThrow<string>('SUPABASE_SERVICE_ROLE_KEY'),
    );
  }

  /** Service-role client — bypasses RLS. Use for all backend operations. */
  getClient(): SupabaseClient {
    return this.client;
  }

  /** Validate a JWT and return the user, or null if invalid. */
  async getUserFromToken(token: string) {
    const { data, error } = await this.client.auth.getUser(token);
    if (error || !data?.user) return null;
    return data.user;
  }

  /** Check if a user has admin role */
  async isAdmin(userId: string): Promise<boolean> {
    const { data } = await this.client
      .from('user_roles')
      .select('role')
      .eq('user_id', userId)
      .eq('role', 'admin')
      .maybeSingle();
    return !!data;
  }
}
```

- [ ] **Step 2: Create EncryptionService**

```typescript
// packages/backend/src/shared/services/encryption.service.ts
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

@Injectable()
export class EncryptionService {
  private readonly key: Buffer;

  constructor(private config: ConfigService) {
    const encKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
    this.key = createHash('sha256').update(encKey).digest();
  }

  encrypt(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${iv.toString('base64')}:${Buffer.concat([encrypted, tag]).toString('base64')}`;
  }

  decrypt(stored: string): string {
    const [ivB64, ctB64] = stored.split(':');
    if (!ivB64 || !ctB64) throw new Error('Invalid encrypted format');

    const iv = Buffer.from(ivB64, 'base64');
    const combined = Buffer.from(ctB64, 'base64');
    const tag = combined.subarray(combined.length - 16);
    const encrypted = combined.subarray(0, combined.length - 16);

    const decipher = createDecipheriv('aes-256-gcm', this.key, iv);
    decipher.setAuthTag(tag);
    return decipher.update(encrypted) + decipher.final('utf8');
  }

  isEncrypted(value: string): boolean {
    if (!value || !value.includes(':')) return false;
    const parts = value.split(':');
    if (parts.length !== 2) return false;
    try {
      Buffer.from(parts[0], 'base64');
      Buffer.from(parts[1], 'base64');
      return parts[0].length >= 16;
    } catch {
      return false;
    }
  }

  decryptIfNeeded(value: string): string {
    if (this.isEncrypted(value)) {
      return this.decrypt(value);
    }
    return value;
  }
}
```

- [ ] **Step 3: Create SharedModule**

```typescript
// packages/backend/src/shared/shared.module.ts
import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './services/supabase.service';
import { EncryptionService } from './services/encryption.service';

@Global()
@Module({
  providers: [SupabaseService, EncryptionService],
  exports: [SupabaseService, EncryptionService],
})
export class SharedModule {}
```

- [ ] **Step 4: Register SharedModule in AppModule**

Update `packages/backend/src/app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from './shared/shared.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    SharedModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 5: Verify compilation**

```bash
cd packages/backend && npx nest build
```

Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/shared/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add SupabaseService and EncryptionService"
```

---

### Task 4: Shared Helpers — Migrate Deno helpers to Node.js

**Files:**
- Create: `packages/backend/src/shared/helpers/normalize-state.ts`
- Create: `packages/backend/src/shared/helpers/ddd-to-state.ts`
- Create: `packages/backend/src/shared/helpers/currency.ts`
- Create: `packages/backend/src/shared/helpers/extract-webhook-token.ts`

- [ ] **Step 1: Create normalize-state.ts**

This is a direct copy — no Deno-specific APIs used.

```typescript
// packages/backend/src/shared/helpers/normalize-state.ts
const STATE_MAP: Record<string, string> = {
  'acre': 'AC', 'alagoas': 'AL', 'amapa': 'AP', 'amazonas': 'AM',
  'bahia': 'BA', 'ceara': 'CE', 'distrito federal': 'DF',
  'espirito santo': 'ES', 'goias': 'GO', 'maranhao': 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG',
  'para': 'PA', 'paraiba': 'PB', 'parana': 'PR', 'pernambuco': 'PE',
  'piaui': 'PI', 'rio de janeiro': 'RJ', 'rio grande do norte': 'RN',
  'rio grande do sul': 'RS', 'rondonia': 'RO', 'roraima': 'RR',
  'santa catarina': 'SC', 'sao paulo': 'SP', 'sergipe': 'SE', 'tocantins': 'TO',
  'amapá': 'AP', 'ceará': 'CE', 'espírito santo': 'ES', 'goiás': 'GO',
  'maranhão': 'MA', 'paraná': 'PR', 'paraíba': 'PB', 'piauí': 'PI',
  'rondônia': 'RO', 'são paulo': 'SP',
};

const VALID_UFS = new Set([
  'AC','AL','AP','AM','BA','CE','DF','ES','GO','MA','MT','MS','MG',
  'PA','PB','PR','PE','PI','RJ','RN','RS','RO','RR','SC','SP','SE','TO'
]);

export function normalizeState(input: string | null | undefined): string | null {
  if (!input) return null;
  const trimmed = input.trim();
  if (!trimmed) return null;
  const upper = trimmed.toUpperCase();
  if (upper.length === 2 && VALID_UFS.has(upper)) return upper;
  const lower = trimmed.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const mapped = STATE_MAP[lower] || STATE_MAP[trimmed.toLowerCase()];
  if (mapped) return mapped;
  if (upper.length === 2 && /^[A-Z]{2}$/.test(upper)) return upper;
  return null;
}

export function normalizeCity(city: string | null | undefined): string | null {
  if (!city) return null;
  const trimmed = city.trim();
  if (!trimmed) return null;
  return trimmed.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
```

- [ ] **Step 2: Create ddd-to-state.ts**

Direct copy — no Deno APIs.

```typescript
// packages/backend/src/shared/helpers/ddd-to-state.ts
const DDD_TO_STATE: Record<string, string> = {
  '11': 'SP', '12': 'SP', '13': 'SP', '14': 'SP', '15': 'SP',
  '16': 'SP', '17': 'SP', '18': 'SP', '19': 'SP',
  '21': 'RJ', '22': 'RJ', '24': 'RJ',
  '27': 'ES', '28': 'ES',
  '31': 'MG', '32': 'MG', '33': 'MG', '34': 'MG', '35': 'MG',
  '37': 'MG', '38': 'MG',
  '41': 'PR', '42': 'PR', '43': 'PR', '44': 'PR', '45': 'PR', '46': 'PR',
  '47': 'SC', '48': 'SC', '49': 'SC',
  '51': 'RS', '53': 'RS', '54': 'RS', '55': 'RS',
  '61': 'DF',
  '62': 'GO', '64': 'GO',
  '63': 'TO',
  '67': 'MS',
  '65': 'MT', '66': 'MT',
  '68': 'AC',
  '69': 'RO',
  '71': 'BA', '73': 'BA', '74': 'BA', '75': 'BA', '77': 'BA',
  '79': 'SE',
  '81': 'PE', '87': 'PE',
  '82': 'AL',
  '83': 'PB',
  '84': 'RN',
  '85': 'CE', '88': 'CE',
  '86': 'PI', '89': 'PI',
  '98': 'MA', '99': 'MA',
  '91': 'PA', '93': 'PA', '94': 'PA',
  '92': 'AM', '97': 'AM',
  '95': 'RR',
  '96': 'AP',
};

export function getStateFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  if (digits.length < 10) return null;
  let ddd: string;
  if (digits.length >= 12 && digits.startsWith('55')) {
    ddd = digits.substring(2, 4);
  } else {
    ddd = digits.substring(0, 2);
  }
  return DDD_TO_STATE[ddd] || null;
}

export function getStateFromDDD(ddd: string | null | undefined): string | null {
  if (!ddd) return null;
  const cleaned = ddd.replace(/\D/g, '');
  return DDD_TO_STATE[cleaned] || null;
}
```

- [ ] **Step 3: Create currency.ts**

Replaces `fetch` (available globally in Node 18+) — same logic, no Deno APIs.

```typescript
// packages/backend/src/shared/helpers/currency.ts
const rateCache = new Map<string, { rate: number; fetchedAt: number }>();
const CACHE_TTL_MS = 30 * 60 * 1000;

export async function getExchangeRate(fromCurrency: string): Promise<number> {
  const from = fromCurrency.toUpperCase();
  if (from === 'BRL') return 1.0;
  const cacheKey = `${from}_BRL`;
  const cached = rateCache.get(cacheKey);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) return cached.rate;
  try {
    const response = await fetch(`https://api.exchangerate-api.com/v4/latest/${from}`);
    if (!response.ok) return await getFallbackRate(from);
    const data = await response.json();
    const rate = data.rates?.BRL;
    if (!rate || typeof rate !== 'number') return await getFallbackRate(from);
    rateCache.set(cacheKey, { rate, fetchedAt: Date.now() });
    return rate;
  } catch {
    return await getFallbackRate(from);
  }
}

async function getFallbackRate(from: string): Promise<number> {
  try {
    const response = await fetch(`https://open.er-api.com/v6/latest/${from}`);
    if (!response.ok) throw new Error('Fallback API error');
    const data = await response.json();
    const rate = data.rates?.BRL;
    if (rate && typeof rate === 'number') {
      rateCache.set(`${from}_BRL`, { rate, fetchedAt: Date.now() });
      return rate;
    }
    throw new Error('No rate in fallback');
  } catch {
    if (from === 'USD') return 5.0;
    return 1.0;
  }
}

export function convertToBRL(value: number, exchangeRate: number): number {
  if (exchangeRate === 1.0) return value;
  return Math.round(value * exchangeRate * 100) / 100;
}

export function convertFromBRL(brlValue: number, exchangeRate: number): number {
  if (exchangeRate === 1.0) return brlValue;
  return Math.round((brlValue / exchangeRate) * 100) / 100;
}

export async function getAccountCurrency(
  adAccountId: string,
  accessToken: string,
  fbApiVersion = 'v22.0',
): Promise<string> {
  try {
    const url = `https://graph.facebook.com/${fbApiVersion}/${adAccountId}?fields=currency&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();
    if (data.error) return 'BRL';
    return data.currency || 'BRL';
  } catch {
    return 'BRL';
  }
}
```

- [ ] **Step 4: Create extract-webhook-token.ts**

The original uses `Request` from Deno. In NestJS with Fastify, we receive `FastifyRequest`. We adapt the interface:

```typescript
// packages/backend/src/shared/helpers/extract-webhook-token.ts
import { FastifyRequest } from 'fastify';

export function extractWebhookToken(
  req: FastifyRequest,
  payload: any,
  platform: string,
): string | null {
  const headers = req.headers;

  switch (platform) {
    case 'hotmart':
      if (headers['x-hotmart-hottok']) return headers['x-hotmart-hottok'] as string;
      if (headers['x-hottok']) return headers['x-hottok'] as string;
      break;
    case 'kirvano':
      if (headers['x-kirvano-token']) return headers['x-kirvano-token'] as string;
      break;
    case 'guru':
      if (payload?.api_token) return payload.api_token;
      break;
  }

  const genericHeaders = ['x-webhook-token', 'x-api-token', 'authorization-token'];
  for (const header of genericHeaders) {
    const value = headers[header];
    if (value) return value as string;
  }

  if (payload?.token) return payload.token;
  if (payload?.signature) return payload.signature;
  if (payload?.hottok) return payload.hottok;
  if (payload?.api_token) return payload.api_token;

  const query = req.query as Record<string, string>;
  if (query?.key) return query.key;
  if (query?.token) return query.token;
  if (query?.signature) return query.signature;

  return null;
}
```

- [ ] **Step 5: Verify compilation**

```bash
cd packages/backend && npx nest build
```

Expected: Compiles without errors.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/shared/helpers/
git commit -m "feat(backend): migrate shared helpers from Deno to Node.js"
```

---

### Task 5: Auth Guards + Decorators

**Files:**
- Create: `packages/backend/src/common/guards/auth.guard.ts`
- Create: `packages/backend/src/common/guards/admin.guard.ts`
- Create: `packages/backend/src/common/decorators/current-user.decorator.ts`
- Create: `packages/backend/src/common/filters/http-exception.filter.ts`

- [ ] **Step 1: Create auth.guard.ts**

```typescript
// packages/backend/src/common/guards/auth.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const authHeader = request.headers.authorization;

    if (!authHeader?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Missing or invalid authorization header');
    }

    const token = authHeader.replace('Bearer ', '');
    const user = await this.supabase.getUserFromToken(token);

    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    request.user = user;
    return true;
  }
}
```

- [ ] **Step 2: Create admin.guard.ts**

```typescript
// packages/backend/src/common/guards/admin.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(private supabase: SupabaseService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest();
    const user = request.user;

    if (!user) {
      throw new ForbiddenException('User not authenticated');
    }

    const isAdmin = await this.supabase.isAdmin(user.id);
    if (!isAdmin) {
      throw new ForbiddenException('Admin access required');
    }

    return true;
  }
}
```

- [ ] **Step 3: Create current-user.decorator.ts**

```typescript
// packages/backend/src/common/decorators/current-user.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';

export const CurrentUser = createParamDecorator(
  (data: string | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
```

- [ ] **Step 4: Create http-exception.filter.ts**

```typescript
// packages/backend/src/common/filters/http-exception.filter.ts
import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus } from '@nestjs/common';
import { FastifyReply } from 'fastify';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      message = typeof response === 'string' ? response : (response as any).message || message;
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    reply.status(status).send({ error: message, statusCode: status });
  }
}
```

- [ ] **Step 5: Verify compilation**

```bash
cd packages/backend && npx nest build
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/common/
git commit -m "feat(backend): add AuthGuard, AdminGuard, CurrentUser decorator, exception filter"
```

---

### Task 6: Webhooks Module

This is the largest module. It migrates all 10 webhook handlers + the queue processor.

**Files:**
- Create: `packages/backend/src/modules/webhooks/webhooks.module.ts`
- Create: `packages/backend/src/modules/webhooks/webhooks.controller.ts`
- Create: `packages/backend/src/modules/webhooks/webhooks.service.ts`
- Create: `packages/backend/src/modules/webhooks/webhook-queue.service.ts`
- Create: `packages/backend/src/modules/webhooks/processors/kirvano.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/hotmart.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/guru.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/perfectpay.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/kiwify.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/ticto.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/cakto.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/payt.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/balaclava.processor.ts`
- Create: `packages/backend/src/modules/webhooks/processors/n8n-profiles.processor.ts`

**CRITICAL:** Webhook routes must match current Supabase Edge Function paths for backward compatibility. Current paths are: `POST /functions/v1/webhook-{platform}`. The new paths will be: `POST /api/webhooks/{platform}`. The frontend's `vercel.json` rewrite that forwards `/functions/v1/*` to Supabase must be updated — AND checkout platform configs must be updated to point to the new webhook URLs. However, during migration we can support BOTH by keeping the old paths as aliases.

- [ ] **Step 1: Create WebhooksService (shared logic)**

This contains the sale-matching logic migrated from `_shared/match-sale-to-ads.ts`:

```typescript
// packages/backend/src/modules/webhooks/webhooks.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { normalizeState, normalizeCity } from '../../shared/helpers/normalize-state';
import { getStateFromPhone } from '../../shared/helpers/ddd-to-state';

export interface MatchResult {
  campaign_id: string | null;
  ad_set_id: string | null;
  ad_internal_id: string | null;
}

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(private supabase: SupabaseService) {}

  extractNumericAdId(raw: string | null): string | null {
    if (!raw) return null;
    const parts = raw.split(/[|\/]/);
    const numericPart = parts.find(p => /^\d{6,}$/.test(p.trim()));
    return numericPart?.trim() || raw;
  }

  extractAdId(tracking: Record<string, any>): string | null {
    return tracking?.ad_id || tracking?.utm_term || tracking?.utm_content || tracking?.src || tracking?.sck || null;
  }

  async matchSaleToAds(
    userId: string,
    adId: string | null,
    utmCampaign: string | null,
    utmContent: string | null,
    utmTerm: string | null,
    adSetFbId?: string | null,
    campaignFbId?: string | null,
  ): Promise<MatchResult> {
    const db = this.supabase.getClient();
    const result: MatchResult = { campaign_id: null, ad_set_id: null, ad_internal_id: null };

    const rawAdId = adId || utmTerm || utmContent || null;
    const effectiveAdId = this.extractNumericAdId(rawAdId);

    if (effectiveAdId) {
      const { data: adMatch } = await db
        .from('ads')
        .select('id, ad_set_id, ad_sets!inner(id, campaign_id)')
        .eq('user_id', userId)
        .eq('facebook_ad_id', effectiveAdId)
        .maybeSingle();

      if (adMatch) {
        result.ad_internal_id = adMatch.id;
        result.ad_set_id = adMatch.ad_set_id;
        result.campaign_id = (adMatch.ad_sets as any)?.campaign_id || null;
        return result;
      }

      const { data: adSetMatch } = await db
        .from('ad_sets')
        .select('id, campaign_id')
        .eq('user_id', userId)
        .eq('facebook_adset_id', effectiveAdId)
        .maybeSingle();

      if (adSetMatch) {
        result.ad_set_id = adSetMatch.id;
        result.campaign_id = adSetMatch.campaign_id;
        return result;
      }
    }

    if (adSetFbId) {
      const { data: adSetByFbId } = await db
        .from('ad_sets')
        .select('id, campaign_id')
        .eq('user_id', userId)
        .eq('facebook_adset_id', adSetFbId)
        .maybeSingle();
      if (adSetByFbId) {
        result.ad_set_id = adSetByFbId.id;
        result.campaign_id = adSetByFbId.campaign_id;
        return result;
      }
    }

    if (campaignFbId) {
      const { data: campaignByFbId } = await db
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('facebook_campaign_id', campaignFbId)
        .maybeSingle();
      if (campaignByFbId) {
        result.campaign_id = campaignByFbId.id;
        return result;
      }
    }

    if (utmCampaign) {
      const { data: campaignById } = await db
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .eq('facebook_campaign_id', utmCampaign)
        .maybeSingle();
      if (campaignById) {
        result.campaign_id = campaignById.id;
        return result;
      }

      const { data: campaignByName } = await db
        .from('campaigns')
        .select('id')
        .eq('user_id', userId)
        .ilike('name', `%${utmCampaign}%`)
        .limit(1)
        .maybeSingle();
      if (campaignByName) {
        result.campaign_id = campaignByName.id;
        return result;
      }
    }

    return result;
  }

  mapStatus(status: string, platform: string): string {
    const s = status.toLowerCase();
    const maps: Record<string, Record<string, string>> = {
      hotmart: {
        approved: 'approved', purchase_approved: 'approved', completed: 'approved',
        purchase_complete: 'approved', refunded: 'refunded', purchase_refunded: 'refunded',
        canceled: 'refunded', purchase_canceled: 'refunded', protest: 'refunded',
        purchase_protest: 'refunded', chargeback: 'refunded', purchase_chargeback: 'refunded',
        billet_printed: 'pending', waiting_payment: 'pending', pending: 'pending',
      },
      kiwify: {
        paid: 'approved', approved: 'approved', completed: 'approved',
        refunded: 'refunded', chargedback: 'refunded', cancelled: 'refunded',
        waiting: 'pending', pending: 'pending',
      },
      kirvano: {
        approved: 'approved', paid: 'approved', completed: 'approved',
        refunded: 'refunded', chargeback: 'refunded', cancelled: 'refunded',
        pending: 'pending', waiting: 'pending',
      },
    };
    return maps[platform]?.[s] || 'pending';
  }

  normalizeState(input: string | null | undefined) { return normalizeState(input); }
  normalizeCity(input: string | null | undefined) { return normalizeCity(input); }
  getStateFromPhone(phone: string | null | undefined) { return getStateFromPhone(phone); }
}
```

- [ ] **Step 2: Create KirvanoProcessor (representative example)**

Each processor follows the same pattern as the original Edge Function but as an injectable service. I show Kirvano as the template — all other processors follow the same structure with platform-specific parsing.

```typescript
// packages/backend/src/modules/webhooks/processors/kirvano.processor.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';

@Injectable()
export class KirvanoProcessor {
  private readonly logger = new Logger(KirvanoProcessor.name);

  constructor(
    private supabase: SupabaseService,
    private webhooks: WebhooksService,
  ) {}

  async process(body: any, authToken: string) {
    const db = this.supabase.getClient();

    const { data: integration } = await db
      .from('checkout_integrations')
      .select('*')
      .eq('platform', 'kirvano')
      .eq('webhook_secret', authToken)
      .eq('is_active', true)
      .maybeSingle();

    if (!integration) {
      return { status: 401, body: { error: 'Invalid token or integration not found' } };
    }

    const userId = integration.user_id;
    const sale = body.sale || body.data?.sale || body;
    const customer = body.customer || body.data?.customer || sale.customer || {};
    const product = body.product || body.data?.product || sale.product || {};
    const tracking = body.tracking || body.data?.tracking || sale.tracking || {};

    const externalId = sale.transaction_id || sale.sale_id || sale.id || body.transaction_id || null;
    if (!externalId) {
      return { status: 400, body: { error: 'Missing transaction_id' } };
    }

    const status = this.webhooks.mapStatus(sale.status || body.status || 'pending', 'kirvano');
    const adId = this.webhooks.extractAdId(tracking);

    const { data: existingSale } = await db
      .from('sales')
      .select('id, status')
      .eq('external_id', externalId)
      .eq('user_id', userId)
      .maybeSingle();

    if (existingSale) {
      if (status !== existingSale.status) {
        await db.from('sales').update({ status }).eq('id', existingSale.id);
      }
      await db.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integration.id);
      return { status: 200, body: { success: true, action: 'updated' } };
    }

    const matchResult = await this.webhooks.matchSaleToAds(
      userId, adId,
      tracking.utm_campaign || null,
      tracking.utm_content || null,
      tracking.utm_term || null,
    );

    const buyer = body.buyer || {};
    const address = buyer.address || customer.address || {};
    let customerState = this.webhooks.normalizeState(address.state || address.uf);
    const customerCity = this.webhooks.normalizeCity(address.city);
    const customerPhone = customer.phone || null;
    if (!customerState && customerPhone) {
      customerState = this.webhooks.getStateFromPhone(customerPhone);
    }

    const saleData = {
      user_id: userId,
      external_id: externalId,
      checkout_integration_id: integration.id,
      customer_state: customerState,
      customer_city: customerCity,
      customer_country: address.country || 'BR',
      campaign_id: matchResult.campaign_id,
      ad_set_id: matchResult.ad_set_id,
      ad_internal_id: matchResult.ad_internal_id,
      ad_id: adId || tracking.utm_term || tracking.utm_content || null,
      product_name: product.name || sale.product_name || null,
      customer_name: customer.name || customer.full_name || null,
      customer_email: customer.email || null,
      amount: Number(sale.amount || sale.value || body.amount || 0),
      currency: sale.currency || 'BRL',
      status,
      payment_method: sale.payment_method || body.payment_method || null,
      utm_source: tracking.utm_source || tracking.src || null,
      utm_medium: tracking.utm_medium || null,
      utm_campaign: tracking.utm_campaign || null,
      utm_content: tracking.utm_content || null,
      utm_term: tracking.utm_term || null,
      sold_at: sale.date || sale.created_at || body.created_at || new Date().toISOString(),
    };

    const { error: insertError } = await db.from('sales').insert(saleData);
    if (insertError) {
      this.logger.error('Error inserting sale:', insertError);
      return { status: 500, body: { error: 'Failed to save sale', details: insertError.message } };
    }

    await db.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integration.id);
    return { status: 200, body: { success: true, action: 'created', matched: !!matchResult.campaign_id } };
  }
}
```

- [ ] **Step 3: Create remaining processors**

Create the following processor files, each following the same pattern as KirvanoProcessor but with platform-specific parsing logic migrated 1:1 from the corresponding Edge Function:

- `hotmart.processor.ts` — from `webhook-hotmart/index.ts` (includes parseXcod, marketplace fee deduction, currency conversion)
- `guru.processor.ts` — from `webhook-guru/index.ts` (queue-only: inserts into webhook_queue)
- `perfectpay.processor.ts` — from `webhook-perfectpay/index.ts` (status enum mapping, metadata UTM extraction)
- `kiwify.processor.ts` — from `webhook-kiwify/index.ts` (HMAC-SHA1 validation using Node.js `crypto.createHmac`)
- `ticto.processor.ts` — from `webhook-ticto/index.ts` (v2.0 format, BRT timezone handling)
- `cakto.processor.ts` — from `webhook-cakto/index.ts` (event filtering, pipe/slash ad ID extraction)
- `payt.processor.ts` — from `webhook-payt/index.ts` (test mode filtering, link sources parsing)
- `balaclava.processor.ts` — from `webhook-balaclava/index.ts` (event filtering, rich tracking metadata)
- `n8n-profiles.processor.ts` — from `webhook-n8n-profiles/index.ts` (profile upsert, welcome email trigger)

Each processor MUST be an `@Injectable()` class with a `process(body: any, authToken: string | null)` method that returns `{ status: number; body: any }`.

**Key Deno→Node.js conversions for each:**
- `Deno.env.get(...)` → injected via `ConfigService` or `SupabaseService`
- `createClient(...)` → `this.supabase.getClient()`
- Deno `crypto.subtle` → Node.js `crypto` module (for Kiwify HMAC: use `crypto.createHmac('sha1', secret).update(rawBody).digest('hex')`)
- `serve()` / `Deno.serve()` → handled by the controller

- [ ] **Step 4: Create WebhookQueueService**

```typescript
// packages/backend/src/modules/webhooks/webhook-queue.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../shared/services/supabase.service';
import { WebhooksService } from './webhooks.service';

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    private supabase: SupabaseService,
    private webhooks: WebhooksService,
  ) {}

  @Cron(CronExpression.EVERY_MINUTE)
  async processQueue() {
    const db = this.supabase.getClient();

    const { data: items } = await db
      .from('webhook_queue')
      .select('*')
      .eq('status', 'pending')
      .lte('next_retry_at', new Date().toISOString())
      .order('created_at', { ascending: true })
      .limit(10);

    if (!items || items.length === 0) return;

    for (const item of items) {
      try {
        await this.processItem(item);
        await db.from('webhook_queue').update({
          status: 'completed',
          processed_at: new Date().toISOString(),
          attempts: item.attempts + 1,
        }).eq('id', item.id);
      } catch (error: any) {
        const newAttempts = item.attempts + 1;
        if (newAttempts >= item.max_attempts) {
          await db.from('webhook_queue').update({
            status: 'failed',
            error_message: error.message,
            attempts: newAttempts,
          }).eq('id', item.id);
        } else {
          const backoffSeconds = 30 * newAttempts;
          const nextRetry = new Date(Date.now() + backoffSeconds * 1000).toISOString();
          await db.from('webhook_queue').update({
            error_message: error.message,
            attempts: newAttempts,
            next_retry_at: nextRetry,
          }).eq('id', item.id);
        }
      }
    }
  }

  private async processItem(item: any) {
    // Currently only processes Guru webhooks — same as original process-webhook-queue
    if (item.platform === 'guru') {
      await this.processGuru(item.payload);
    }
  }

  private async processGuru(payload: any) {
    const db = this.supabase.getClient();
    // Migrate the processGuru logic from process-webhook-queue/index.ts
    // This involves: token validation, status mapping, sale upsert, ad matching
    const token = payload.api_token;
    if (!token) throw new Error('No api_token in payload');

    const { data: integration } = await db
      .from('checkout_integrations')
      .select('*')
      .eq('platform', 'guru')
      .eq('webhook_secret', token)
      .eq('is_active', true)
      .maybeSingle();

    if (!integration) throw new Error('Integration not found');

    const userId = integration.user_id;
    const transaction = payload.transaction || payload;
    const externalId = transaction.id || transaction.transaction_id || payload.id;
    if (!externalId) throw new Error('No external ID');

    const statusRaw = (transaction.status || payload.status || '').toString().toLowerCase();
    const statusMap: Record<string, string> = {
      approved: 'approved', paid: 'approved', completed: 'approved',
      refunded: 'refunded', chargeback: 'refunded', cancelled: 'refunded',
    };
    const status = statusMap[statusRaw] || 'pending';

    const { data: existing } = await db
      .from('sales')
      .select('id, status')
      .eq('external_id', String(externalId))
      .eq('user_id', userId)
      .maybeSingle();

    if (existing) {
      if (status !== existing.status) {
        await db.from('sales').update({ status }).eq('id', existing.id);
      }
      await db.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integration.id);
      return;
    }

    const customer = transaction.contact || payload.contact || {};
    const dates = transaction.dates || payload.dates || {};
    const utmSource = transaction.utm_source || payload.utm_source || null;
    const utmMedium = transaction.utm_medium || payload.utm_medium || null;
    const utmCampaign = transaction.utm_campaign || payload.utm_campaign || null;
    const utmContent = transaction.utm_content || payload.utm_content || null;
    const utmTerm = transaction.utm_term || payload.utm_term || null;

    const matchResult = await this.webhooks.matchSaleToAds(
      userId, null, utmCampaign, utmContent, utmTerm, utmCampaign, utmMedium,
    );

    const saleData = {
      user_id: userId,
      external_id: String(externalId),
      checkout_integration_id: integration.id,
      campaign_id: matchResult.campaign_id,
      ad_set_id: matchResult.ad_set_id,
      ad_internal_id: matchResult.ad_internal_id,
      ad_id: utmContent || utmTerm || null,
      product_name: transaction.product?.name || payload.product?.name || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customer.phone_number || customer.phone || null,
      amount: Number(transaction.payment?.total || transaction.amount || payload.amount || 0) / 100,
      currency: 'BRL',
      status,
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      sold_at: dates.ordered_at || dates.confirmed_at || new Date().toISOString(),
    };

    await db.from('sales').insert(saleData);
    await db.from('checkout_integrations').update({ last_webhook_at: new Date().toISOString() }).eq('id', integration.id);
  }
}
```

- [ ] **Step 5: Create WebhooksController**

```typescript
// packages/backend/src/modules/webhooks/webhooks.controller.ts
import { Controller, Post, Req, Res, Param, Logger } from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { extractWebhookToken } from '../../shared/helpers/extract-webhook-token';
import { KirvanoProcessor } from './processors/kirvano.processor';
import { HotmartProcessor } from './processors/hotmart.processor';
import { GuruProcessor } from './processors/guru.processor';
import { PerfectpayProcessor } from './processors/perfectpay.processor';
import { KiwifyProcessor } from './processors/kiwify.processor';
import { TictoProcessor } from './processors/ticto.processor';
import { CaktoProcessor } from './processors/cakto.processor';
import { PaytProcessor } from './processors/payt.processor';
import { BalaclavaProcessor } from './processors/balaclava.processor';
import { N8nProfilesProcessor } from './processors/n8n-profiles.processor';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);
  private readonly processors: Record<string, any>;

  constructor(
    kirvano: KirvanoProcessor,
    hotmart: HotmartProcessor,
    guru: GuruProcessor,
    perfectpay: PerfectpayProcessor,
    kiwify: KiwifyProcessor,
    ticto: TictoProcessor,
    cakto: CaktoProcessor,
    payt: PaytProcessor,
    balaclava: BalaclavaProcessor,
    n8nProfiles: N8nProfilesProcessor,
  ) {
    this.processors = {
      kirvano, hotmart, guru, perfectpay, kiwify,
      ticto, cakto, payt, balaclava, 'n8n-profiles': n8nProfiles,
    };
  }

  @Post(':platform')
  async handleWebhook(
    @Param('platform') platform: string,
    @Req() req: FastifyRequest,
    @Res() reply: FastifyReply,
  ) {
    const processor = this.processors[platform];
    if (!processor) {
      return reply.status(404).send({ error: `Unknown platform: ${platform}` });
    }

    try {
      const body = req.body as any;
      const token = extractWebhookToken(req, body, platform);

      if (!token && platform !== 'n8n-profiles') {
        return reply.status(200).send({
          success: true,
          message: 'Webhook endpoint active. No authentication token found.',
        });
      }

      const result = await processor.process(body, token);
      return reply.status(result.status).send(result.body);
    } catch (error: any) {
      this.logger.error(`Webhook error [${platform}]:`, error.message);
      return reply.status(500).send({ error: 'Internal server error', details: error.message });
    }
  }
}
```

- [ ] **Step 6: Create WebhooksModule**

```typescript
// packages/backend/src/modules/webhooks/webhooks.module.ts
import { Module } from '@nestjs/common';
import { WebhooksController } from './webhooks.controller';
import { WebhooksService } from './webhooks.service';
import { WebhookQueueService } from './webhook-queue.service';
import { KirvanoProcessor } from './processors/kirvano.processor';
import { HotmartProcessor } from './processors/hotmart.processor';
import { GuruProcessor } from './processors/guru.processor';
import { PerfectpayProcessor } from './processors/perfectpay.processor';
import { KiwifyProcessor } from './processors/kiwify.processor';
import { TictoProcessor } from './processors/ticto.processor';
import { CaktoProcessor } from './processors/cakto.processor';
import { PaytProcessor } from './processors/payt.processor';
import { BalaclavaProcessor } from './processors/balaclava.processor';
import { N8nProfilesProcessor } from './processors/n8n-profiles.processor';

@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookQueueService,
    KirvanoProcessor,
    HotmartProcessor,
    GuruProcessor,
    PerfectpayProcessor,
    KiwifyProcessor,
    TictoProcessor,
    CaktoProcessor,
    PaytProcessor,
    BalaclavaProcessor,
    N8nProfilesProcessor,
  ],
  exports: [WebhooksService],
})
export class WebhooksModule {}
```

- [ ] **Step 7: Register in AppModule**

Add `WebhooksModule` to the imports array in `app.module.ts`.

- [ ] **Step 8: Verify compilation**

```bash
cd packages/backend && npx nest build
```

- [ ] **Step 9: Commit**

```bash
git add packages/backend/src/modules/webhooks/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add webhooks module with all platform processors"
```

---

### Task 7: Facebook Module

Migrates: `fetch-meta-insights`, `manage-facebook-connection`, `auto-sync`, `rematch-sales`, `update-budget`, `update-campaign-status`

**Files:**
- Create: `packages/backend/src/modules/facebook/facebook.module.ts`
- Create: `packages/backend/src/modules/facebook/facebook.controller.ts`
- Create: `packages/backend/src/modules/facebook/facebook.service.ts`
- Create: `packages/backend/src/modules/facebook/insights.service.ts`
- Create: `packages/backend/src/modules/facebook/sync.service.ts`
- Create: `packages/backend/src/modules/facebook/sale-matcher.service.ts`

- [ ] **Step 1: Create FacebookService**

Migrates `manage-facebook-connection/index.ts` — connection CRUD with encryption.

```typescript
// packages/backend/src/modules/facebook/facebook.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';

@Injectable()
export class FacebookService {
  private readonly logger = new Logger(FacebookService.name);
  private readonly FB_API = 'https://graph.facebook.com/v22.0';

  constructor(
    private supabase: SupabaseService,
    private encryption: EncryptionService,
  ) {}

  async saveConnection(userId: string, data: any) {
    const db = this.supabase.getClient();
    const encryptedToken = this.encryption.encrypt(data.access_token);
    const encryptedSecret = data.app_secret ? this.encryption.encrypt(data.app_secret) : null;

    const record: any = {
      user_id: userId,
      app_id: data.app_id,
      app_secret: encryptedSecret || data.app_secret,
      access_token: encryptedToken,
      ad_account_id: data.ad_account_id,
      is_valid: true,
      last_validated_at: new Date().toISOString(),
    };

    if (data.connection_id) {
      const { error } = await db.from('facebook_connections').update(record).eq('id', data.connection_id).eq('user_id', userId);
      if (error) throw error;
      return { success: true, action: 'updated' };
    }

    const { error } = await db.from('facebook_connections').insert(record);
    if (error) throw error;
    return { success: true, action: 'created' };
  }

  async getConnections(userId: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('facebook_connections').select('*').eq('user_id', userId).order('created_at');
    if (error) throw error;
    return (data || []).map((c: any) => ({
      ...c,
      ad_account_id_masked: c.ad_account_id ? `***${c.ad_account_id.slice(-4)}` : null,
      access_token: '***',
      app_secret: '***',
    }));
  }

  async deleteConnection(userId: string, connectionId: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('facebook_connections').delete().eq('id', connectionId).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }

  async validateConnection(userId: string, connectionId: string) {
    const db = this.supabase.getClient();
    const { data: conn } = await db.from('facebook_connections').select('*').eq('id', connectionId).eq('user_id', userId).single();
    if (!conn) throw new Error('Connection not found');

    const token = this.encryption.decryptIfNeeded(conn.access_token);
    const resp = await fetch(`${this.FB_API}/me?access_token=${token}`);
    const fbData = await resp.json();

    const isValid = !fbData.error;
    await db.from('facebook_connections').update({
      is_valid: isValid,
      last_validated_at: new Date().toISOString(),
    }).eq('id', connectionId);

    return { is_valid: isValid, error: fbData.error?.message };
  }

  async listAccounts(accessToken: string) {
    const token = this.encryption.isEncrypted(accessToken) ? this.encryption.decryptIfNeeded(accessToken) : accessToken;
    const resp = await fetch(`${this.FB_API}/me/adaccounts?fields=id,name,account_status,currency&access_token=${token}&limit=100`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return data.data || [];
  }

  async updateBudget(userId: string, payload: { type: string; facebook_id: string; budget_type: string; amount: number }) {
    // Migrated from update-budget/index.ts
    const db = this.supabase.getClient();
    const { data: conn } = await db.from('facebook_connections').select('*').eq('user_id', userId).limit(1).single();
    if (!conn) throw new Error('No Facebook connection');

    const token = this.encryption.decryptIfNeeded(conn.access_token);
    const { getAccountCurrency, getExchangeRate, convertFromBRL } = await import('../../shared/helpers/currency');
    const currency = await getAccountCurrency(conn.ad_account_id, token);
    const rate = await getExchangeRate(currency);
    const nativeAmount = Math.round(convertFromBRL(payload.amount, rate) * 100);

    const field = payload.budget_type === 'daily' ? 'daily_budget' : 'lifetime_budget';
    const params = new URLSearchParams({ [field]: String(nativeAmount), access_token: token });

    const resp = await fetch(`${this.FB_API}/${payload.facebook_id}`, { method: 'POST', body: params });
    const result = await resp.json();
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  }

  async updateStatus(userId: string, payload: { facebook_id: string; status: string; type: string }) {
    // Migrated from update-campaign-status/index.ts
    const db = this.supabase.getClient();
    const { data: conn } = await db.from('facebook_connections').select('*').eq('user_id', userId).limit(1).single();
    if (!conn) throw new Error('No Facebook connection');

    const token = this.encryption.decryptIfNeeded(conn.access_token);
    const params = new URLSearchParams({ status: payload.status, access_token: token });
    const resp = await fetch(`${this.FB_API}/${payload.facebook_id}`, { method: 'POST', body: params });
    const result = await resp.json();
    if (result.error) throw new Error(result.error.message);
    return { success: true };
  }

  /** Get decrypted access token for a connection */
  async getDecryptedToken(connectionId: string): Promise<string> {
    const db = this.supabase.getClient();
    const { data } = await db.from('facebook_connections').select('access_token').eq('id', connectionId).single();
    if (!data) throw new Error('Connection not found');
    return this.encryption.decryptIfNeeded(data.access_token);
  }
}
```

- [ ] **Step 2: Create InsightsService**

Migrates `fetch-meta-insights/index.ts` — the background sync engine. This is a large service. The implementation must preserve all the logic from the original Edge Function including:
- Campaign, ad set, ad syncing with batch upserts
- Daily insights tracking at all 3 levels
- Funnel metrics extraction
- Job progress tracking via `processing_jobs` table
- Rate limiting with retry logic
- Currency detection and BRL conversion

```typescript
// packages/backend/src/modules/facebook/insights.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { getExchangeRate, convertToBRL, getAccountCurrency } from '../../shared/helpers/currency';

@Injectable()
export class InsightsService {
  private readonly logger = new Logger(InsightsService.name);
  private readonly FB_API = 'https://graph.facebook.com/v22.0';

  constructor(
    private supabase: SupabaseService,
    private encryption: EncryptionService,
  ) {}

  // Migrate the entire fetch-meta-insights/index.ts logic here.
  // Key methods:
  // - validate(userId, connectionId)
  // - fetchInsights(userId, connectionId, dateRange)
  // - startSync(userId, connectionId) → creates processing_job, runs in background
  // - checkJob(jobId)
  // - performSync(userId, connection, jobId) — the main sync loop
  //
  // The implementation is a 1:1 port of the ~1088 line Edge Function.
  // All Deno.env.get() calls become this.encryption / this.supabase injections.
  // All createClient() calls become this.supabase.getClient().

  async validate(userId: string, connectionId: string) {
    const db = this.supabase.getClient();
    const { data: conn } = await db.from('facebook_connections').select('*').eq('id', connectionId).eq('user_id', userId).single();
    if (!conn) throw new Error('Connection not found');
    const token = this.encryption.decryptIfNeeded(conn.access_token);
    const resp = await fetch(`${this.FB_API}/${conn.ad_account_id}?fields=name,account_status,currency&access_token=${token}`);
    const data = await resp.json();
    if (data.error) throw new Error(data.error.message);
    return { valid: true, account: data };
  }

  async startSync(userId: string, connectionId: string) {
    const db = this.supabase.getClient();
    const { data: job } = await db.from('processing_jobs').insert({
      user_id: userId,
      job_type: 'sync',
      status: 'processing',
      progress: 0,
    }).select().single();

    // Run sync in background (non-blocking)
    this.performSync(userId, connectionId, job!.id).catch(err => {
      this.logger.error('Sync failed:', err.message);
      db.from('processing_jobs').update({ status: 'failed', error: err.message }).eq('id', job!.id);
    });

    return { job_id: job!.id };
  }

  async checkJob(jobId: string) {
    const db = this.supabase.getClient();
    const { data } = await db.from('processing_jobs').select('*').eq('id', jobId).single();
    return data;
  }

  private async performSync(userId: string, connectionId: string, jobId: string) {
    // Full sync implementation — migrated 1:1 from fetch-meta-insights/index.ts
    // Steps: sync campaigns → ad sets → ads → daily insights
    // Uses batch upserts, pagination, rate limiting, currency conversion
    // Updates job progress at each step
    const db = this.supabase.getClient();
    const { data: conn } = await db.from('facebook_connections').select('*').eq('id', connectionId).single();
    if (!conn) throw new Error('Connection not found');

    const token = this.encryption.decryptIfNeeded(conn.access_token);
    const currency = await getAccountCurrency(conn.ad_account_id, token);
    const exchangeRate = await getExchangeRate(currency);

    // ... Full sync implementation follows the exact same logic as the Edge Function
    // This is the largest single piece of logic to migrate.
    // Each step updates processing_jobs.progress.

    await db.from('processing_jobs').update({ status: 'completed', progress: 100 }).eq('id', jobId);
  }
}
```

- [ ] **Step 3: Create SyncService**

Migrates `auto-sync/index.ts` — the scheduled cron job.

```typescript
// packages/backend/src/modules/facebook/sync.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from '../../shared/services/supabase.service';
import { InsightsService } from './insights.service';
import { SaleMatcherService } from './sale-matcher.service';

@Injectable()
export class SyncService {
  private readonly logger = new Logger(SyncService.name);

  constructor(
    private supabase: SupabaseService,
    private insights: InsightsService,
    private saleMatcher: SaleMatcherService,
  ) {}

  @Cron('*/5 * * * *') // Every 5 minutes — check for due syncs
  async autoSync() {
    const db = this.supabase.getClient();
    const now = new Date().toISOString();

    const { data: schedules } = await db
      .from('sync_schedules')
      .select('*, profiles!inner(id, user_id)')
      .eq('is_active', true)
      .lte('next_sync_at', now)
      .lt('consecutive_errors', 3);

    if (!schedules || schedules.length === 0) return;

    for (const schedule of schedules) {
      try {
        const userId = schedule.user_id;
        const { data: connections } = await db
          .from('facebook_connections')
          .select('id')
          .eq('user_id', userId)
          .eq('is_valid', true);

        if (!connections || connections.length === 0) continue;

        for (const conn of connections) {
          await this.insights.startSync(userId, conn.id);
        }

        // Rematch unmatched sales
        await this.saleMatcher.rematchSales(userId);

        // Update schedule
        const nextSync = new Date(Date.now() + schedule.interval_minutes * 60 * 1000).toISOString();
        await db.from('sync_schedules').update({
          last_sync_at: now,
          next_sync_at: nextSync,
          last_sync_status: 'success',
          consecutive_errors: 0,
        }).eq('id', schedule.id);
      } catch (error: any) {
        this.logger.error(`Auto-sync failed for schedule ${schedule.id}:`, error.message);
        await db.from('sync_schedules').update({
          last_sync_status: 'error',
          last_sync_error: error.message,
          consecutive_errors: schedule.consecutive_errors + 1,
        }).eq('id', schedule.id);
      }
    }
  }
}
```

- [ ] **Step 4: Create SaleMatcherService**

Migrates `rematch-sales/index.ts`.

```typescript
// packages/backend/src/modules/facebook/sale-matcher.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class SaleMatcherService {
  private readonly logger = new Logger(SaleMatcherService.name);

  constructor(private supabase: SupabaseService) {}

  private extractNumericId(raw: string | null): string | null {
    if (!raw) return null;
    const parts = raw.split(/[|\/]/);
    const numericPart = parts.find(p => /^\d{6,}$/.test(p.trim()));
    return numericPart?.trim() || null;
  }

  async rematchSales(userId: string) {
    const db = this.supabase.getClient();

    // Step 0: Fill missing ad_id from utm_content
    const { data: salesNoAdId } = await db
      .from('sales')
      .select('id, utm_content, utm_term')
      .eq('user_id', userId)
      .is('ad_id', null)
      .not('utm_content', 'is', null);

    if (salesNoAdId) {
      for (const sale of salesNoAdId) {
        const extracted = this.extractNumericId(sale.utm_content) || this.extractNumericId(sale.utm_term);
        if (extracted) {
          await db.from('sales').update({ ad_id: extracted }).eq('id', sale.id);
        }
      }
    }

    // Step 1: Build lookup map
    const { data: ads } = await db
      .from('ads')
      .select('id, facebook_ad_id, ad_set_id, ad_sets!inner(id, campaign_id)')
      .eq('user_id', userId);

    const adMap = new Map<string, any>();
    if (ads) {
      for (const ad of ads) {
        if (ad.facebook_ad_id) adMap.set(ad.facebook_ad_id, ad);
      }
    }

    // Step 2: Fetch unmatched sales
    const { data: unmatched } = await db
      .from('sales')
      .select('id, ad_id, utm_content, utm_term')
      .eq('user_id', userId)
      .is('campaign_id', null)
      .not('ad_id', 'is', null);

    let rematched = 0;
    if (unmatched) {
      for (const sale of unmatched) {
        const adId = this.extractNumericId(sale.ad_id);
        if (!adId) continue;
        const ad = adMap.get(adId);
        if (ad) {
          await db.from('sales').update({
            ad_internal_id: ad.id,
            ad_set_id: ad.ad_set_id,
            campaign_id: (ad.ad_sets as any)?.campaign_id,
          }).eq('id', sale.id);
          rematched++;
        }
      }
    }

    return { total_unmatched: unmatched?.length || 0, rematched };
  }
}
```

- [ ] **Step 5: Create FacebookController**

```typescript
// packages/backend/src/modules/facebook/facebook.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FacebookService } from './facebook.service';
import { InsightsService } from './insights.service';
import { SaleMatcherService } from './sale-matcher.service';

@Controller('facebook')
@UseGuards(AuthGuard)
export class FacebookController {
  constructor(
    private facebook: FacebookService,
    private insights: InsightsService,
    private saleMatcher: SaleMatcherService,
  ) {}

  @Post('connections')
  async saveConnection(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.saveConnection(userId, body);
  }

  @Get('connections')
  async getConnections(@CurrentUser('id') userId: string) {
    return this.facebook.getConnections(userId);
  }

  @Delete('connections/:id')
  async deleteConnection(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.facebook.deleteConnection(userId, id);
  }

  @Post('connections/:id/validate')
  async validateConnection(@CurrentUser('id') userId: string, @Param('id') id: string) {
    return this.facebook.validateConnection(userId, id);
  }

  @Post('connections/list-accounts')
  async listAccounts(@Body('access_token') token: string) {
    return this.facebook.listAccounts(token);
  }

  @Post('insights/validate')
  async validateInsights(@CurrentUser('id') userId: string, @Body('connection_id') connectionId: string) {
    return this.insights.validate(userId, connectionId);
  }

  @Post('insights/sync')
  async startSync(@CurrentUser('id') userId: string, @Body('connection_id') connectionId: string) {
    return this.insights.startSync(userId, connectionId);
  }

  @Get('insights/job/:jobId')
  async checkJob(@Param('jobId') jobId: string) {
    return this.insights.checkJob(jobId);
  }

  @Patch('budget')
  async updateBudget(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.updateBudget(userId, body);
  }

  @Patch('campaigns/status')
  async updateStatus(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.updateStatus(userId, body);
  }

  @Post('rematch')
  async rematchSales(@CurrentUser('id') userId: string) {
    return this.saleMatcher.rematchSales(userId);
  }
}
```

- [ ] **Step 6: Create FacebookModule and register**

```typescript
// packages/backend/src/modules/facebook/facebook.module.ts
import { Module } from '@nestjs/common';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';
import { InsightsService } from './insights.service';
import { SyncService } from './sync.service';
import { SaleMatcherService } from './sale-matcher.service';

@Module({
  controllers: [FacebookController],
  providers: [FacebookService, InsightsService, SyncService, SaleMatcherService],
  exports: [FacebookService, InsightsService, SaleMatcherService],
})
export class FacebookModule {}
```

Add `FacebookModule` to `app.module.ts` imports.

- [ ] **Step 7: Verify compilation and commit**

```bash
cd packages/backend && npx nest build
git add packages/backend/src/modules/facebook/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add Facebook module (connections, insights, sync, sale-matcher)"
```

---

### Task 8: Workspaces, Financial, Plans Modules

**Files:**
- Create: `packages/backend/src/modules/workspaces/workspaces.module.ts`
- Create: `packages/backend/src/modules/workspaces/workspaces.controller.ts`
- Create: `packages/backend/src/modules/workspaces/workspaces.service.ts`
- Create: `packages/backend/src/modules/financial/financial.module.ts`
- Create: `packages/backend/src/modules/financial/financial.controller.ts`
- Create: `packages/backend/src/modules/financial/financial.service.ts`
- Create: `packages/backend/src/modules/plans/plans.module.ts`
- Create: `packages/backend/src/modules/plans/plans.controller.ts`
- Create: `packages/backend/src/modules/plans/plans.service.ts`

- [ ] **Step 1: Create WorkspacesService**

Migrated 1:1 from `manage-workspaces/index.ts`. Now all queries go to ONE Supabase.

```typescript
// packages/backend/src/modules/workspaces/workspaces.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class WorkspacesService {
  constructor(private supabase: SupabaseService) {}

  async list(userId: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db
      .from('workspaces')
      .select('*, workspace_connections(*), workspace_checkout_integrations(*), workspace_products(*)')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    return data || [];
  }

  async create(userId: string, name: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('workspaces').insert({ user_id: userId, name }).select().single();
    if (error) throw error;
    return data;
  }

  async update(userId: string, workspaceId: string, name: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('workspaces').update({ name }).eq('id', workspaceId).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }

  async remove(userId: string, workspaceId: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('workspaces').delete().eq('id', workspaceId).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }

  async addConnection(userId: string, workspaceId: string, facebookConnectionId: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('workspace_connections')
      .upsert({ workspace_id: workspaceId, facebook_connection_id: facebookConnectionId }, { onConflict: 'workspace_id,facebook_connection_id' });
    if (error) throw error;
    return { success: true };
  }

  async removeConnection(workspaceId: string, facebookConnectionId: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('workspace_connections').delete()
      .eq('workspace_id', workspaceId).eq('facebook_connection_id', facebookConnectionId);
    if (error) throw error;
    return { success: true };
  }

  async addCheckout(workspaceId: string, checkoutIntegrationId: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('workspace_checkout_integrations')
      .upsert({ workspace_id: workspaceId, checkout_integration_id: checkoutIntegrationId }, { onConflict: 'workspace_id,checkout_integration_id' });
    if (error) throw error;
    return { success: true };
  }

  async removeCheckout(workspaceId: string, checkoutIntegrationId: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('workspace_checkout_integrations').delete()
      .eq('workspace_id', workspaceId).eq('checkout_integration_id', checkoutIntegrationId);
    if (error) throw error;
    return { success: true };
  }

  async setProducts(workspaceId: string, productNames: string[]) {
    const db = this.supabase.getClient();
    await db.from('workspace_products').delete().eq('workspace_id', workspaceId);
    if (productNames.length > 0) {
      const rows = productNames.map(name => ({ workspace_id: workspaceId, product_name: name }));
      const { error } = await db.from('workspace_products').insert(rows);
      if (error) throw error;
    }
    return { success: true };
  }
}
```

- [ ] **Step 2: Create WorkspacesController**

```typescript
// packages/backend/src/modules/workspaces/workspaces.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspacesService } from './workspaces.service';

@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private workspaces: WorkspacesService) {}

  @Get()
  list(@CurrentUser('id') userId: string) { return this.workspaces.list(userId); }

  @Post()
  create(@CurrentUser('id') userId: string, @Body('name') name: string) { return this.workspaces.create(userId, name); }

  @Patch(':id')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body('name') name: string) { return this.workspaces.update(userId, id, name); }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.workspaces.remove(userId, id); }

  @Post(':id/connections')
  addConnection(@CurrentUser('id') userId: string, @Param('id') id: string, @Body('facebook_connection_id') connId: string) {
    return this.workspaces.addConnection(userId, id, connId);
  }

  @Delete(':id/connections/:connId')
  removeConnection(@Param('id') id: string, @Param('connId') connId: string) {
    return this.workspaces.removeConnection(id, connId);
  }

  @Post(':id/checkouts')
  addCheckout(@Param('id') id: string, @Body('checkout_integration_id') checkoutId: string) {
    return this.workspaces.addCheckout(id, checkoutId);
  }

  @Delete(':id/checkouts/:checkoutId')
  removeCheckout(@Param('id') id: string, @Param('checkoutId') checkoutId: string) {
    return this.workspaces.removeCheckout(id, checkoutId);
  }

  @Post(':id/products')
  setProducts(@Param('id') id: string, @Body('product_names') names: string[]) {
    return this.workspaces.setProducts(id, names);
  }
}
```

- [ ] **Step 3: Create FinancialService and Controller**

Migrated 1:1 from `manage-financial-entries/index.ts`.

```typescript
// packages/backend/src/modules/financial/financial.service.ts
import { Injectable, ForbiddenException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class FinancialService {
  constructor(private supabase: SupabaseService) {}

  private async verifyWorkspaceOwner(workspaceId: string, userId: string) {
    const db = this.supabase.getClient();
    const { data } = await db.from('workspaces').select('id').eq('id', workspaceId).eq('user_id', userId).maybeSingle();
    if (!data) throw new ForbiddenException('Not workspace owner');
  }

  async list(userId: string, workspaceId: string, referenceMonth?: string) {
    await this.verifyWorkspaceOwner(workspaceId, userId);
    const db = this.supabase.getClient();
    let query = db.from('financial_entries').select('id, type, name, amount, reference_month')
      .eq('workspace_id', workspaceId).order('created_at', { ascending: true });
    if (referenceMonth) query = query.eq('reference_month', referenceMonth);
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }

  async add(userId: string, body: { workspace_id: string; type: string; name: string; amount: number; reference_month: string }) {
    await this.verifyWorkspaceOwner(body.workspace_id, userId);
    const db = this.supabase.getClient();
    const { data, error } = await db.from('financial_entries').insert({
      user_id: userId, workspace_id: body.workspace_id, type: body.type,
      name: body.name.trim(), amount: body.amount, reference_month: body.reference_month,
    }).select('id, type, name, amount, reference_month').single();
    if (error) throw error;
    return data;
  }

  async update(userId: string, id: string, workspaceId: string, updates: { name?: string; amount?: number }) {
    await this.verifyWorkspaceOwner(workspaceId, userId);
    const db = this.supabase.getClient();
    const upd: any = {};
    if (updates.name !== undefined) upd.name = updates.name.trim();
    if (updates.amount !== undefined) upd.amount = updates.amount;
    const { data, error } = await db.from('financial_entries').update(upd)
      .eq('id', id).eq('workspace_id', workspaceId).eq('user_id', userId)
      .select('id, type, name, amount, reference_month').single();
    if (error) throw error;
    return data;
  }

  async importEntries(userId: string, workspaceId: string, sourceMonth: string, targetMonth: string) {
    await this.verifyWorkspaceOwner(workspaceId, userId);
    const db = this.supabase.getClient();
    const { data: sources } = await db.from('financial_entries').select('type, name, amount')
      .eq('workspace_id', workspaceId).eq('user_id', userId).eq('reference_month', sourceMonth);
    if (!sources || sources.length === 0) return [];
    const rows = sources.map(e => ({ user_id: userId, workspace_id: workspaceId, type: e.type, name: e.name, amount: e.amount, reference_month: targetMonth }));
    const { data, error } = await db.from('financial_entries').insert(rows).select('id, type, name, amount, reference_month');
    if (error) throw error;
    return data || [];
  }

  async remove(userId: string, id: string, workspaceId: string) {
    await this.verifyWorkspaceOwner(workspaceId, userId);
    const db = this.supabase.getClient();
    const { error } = await db.from('financial_entries').delete().eq('id', id).eq('workspace_id', workspaceId).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }
}
```

```typescript
// packages/backend/src/modules/financial/financial.controller.ts
import { Controller, Get, Post, Patch, Delete, Body, Query, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { FinancialService } from './financial.service';

@Controller('financial')
@UseGuards(AuthGuard)
export class FinancialController {
  constructor(private financial: FinancialService) {}

  @Get()
  list(@CurrentUser('id') userId: string, @Query('workspace_id') wsId: string, @Query('reference_month') month?: string) {
    return this.financial.list(userId, wsId, month);
  }

  @Post()
  add(@CurrentUser('id') userId: string, @Body() body: any) { return this.financial.add(userId, body); }

  @Patch(':id')
  update(@CurrentUser('id') userId: string, @Param('id') id: string, @Body() body: any) {
    return this.financial.update(userId, id, body.workspace_id, body);
  }

  @Post('import')
  importEntries(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.financial.importEntries(userId, body.workspace_id, body.source_month, body.target_month);
  }

  @Delete(':id')
  remove(@CurrentUser('id') userId: string, @Param('id') id: string, @Query('workspace_id') wsId: string) {
    return this.financial.remove(userId, id, wsId);
  }
}
```

- [ ] **Step 4: Create PlansService and Controller**

```typescript
// packages/backend/src/modules/plans/plans.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class PlansService {
  constructor(private supabase: SupabaseService) {}

  async list() {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('plan_rules').select('*').order('plan');
    if (error) throw error;
    return data;
  }

  async update(plan: string, updates: Record<string, any>) {
    const db = this.supabase.getClient();
    const allowed = ['max_campaigns', 'max_sales', 'max_checkout_integrations', 'max_ad_accounts',
      'sync_interval_minutes', 'feature_sales_globe', 'feature_advanced_reports',
      'feature_conversion_funnel', 'feature_auto_sync', 'feature_api_access', 'max_workspaces'];
    const safe: Record<string, any> = { updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (updates[key] !== undefined) safe[key] = updates[key];
    }
    const { error } = await db.from('plan_rules').update(safe).eq('plan', plan);
    if (error) throw error;
    return { success: true };
  }

  async getRulesForPlan(plan: string) {
    const db = this.supabase.getClient();
    const { data } = await db.from('plan_rules').select('*').eq('plan', plan).single();
    return data;
  }
}
```

```typescript
// packages/backend/src/modules/plans/plans.controller.ts
import { Controller, Get, Patch, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { PlansService } from './plans.service';

@Controller('plans')
export class PlansController {
  constructor(private plans: PlansService) {}

  @Get('rules')
  @UseGuards(AuthGuard)
  list() { return this.plans.list(); }

  @Get('rules/:plan')
  @UseGuards(AuthGuard)
  getByPlan(@Param('plan') plan: string) { return this.plans.getRulesForPlan(plan); }

  @Patch('rules/:plan')
  @UseGuards(AuthGuard, AdminGuard)
  update(@Param('plan') plan: string, @Body() body: any) { return this.plans.update(plan, body); }
}
```

- [ ] **Step 5: Create module files and register all three**

Create `workspaces.module.ts`, `financial.module.ts`, `plans.module.ts` — each wrapping their controller + service. Add all three to `app.module.ts` imports.

- [ ] **Step 6: Verify compilation and commit**

```bash
cd packages/backend && npx nest build
git add packages/backend/src/modules/workspaces/ packages/backend/src/modules/financial/ packages/backend/src/modules/plans/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add workspaces, financial, and plans modules"
```

---

### Task 9: Admin Module + Sales Module + Metrics Module + Utils Module

**Files:**
- Create: `packages/backend/src/modules/admin/admin.module.ts`
- Create: `packages/backend/src/modules/admin/admin.controller.ts`
- Create: `packages/backend/src/modules/admin/admin.service.ts`
- Create: `packages/backend/src/modules/sales/sales.module.ts`
- Create: `packages/backend/src/modules/sales/sales.controller.ts`
- Create: `packages/backend/src/modules/sales/sales.service.ts`
- Create: `packages/backend/src/modules/metrics/metrics.module.ts`
- Create: `packages/backend/src/modules/metrics/metrics.controller.ts`
- Create: `packages/backend/src/modules/metrics/metrics.service.ts`
- Create: `packages/backend/src/modules/utils/utils.module.ts`
- Create: `packages/backend/src/modules/utils/genderize.service.ts`
- Create: `packages/backend/src/modules/utils/email.service.ts`
- Create: `packages/backend/src/modules/utils/utils.controller.ts`

- [ ] **Step 1: Create AdminService**

Migrates `admin-users/index.ts` and `admin-proxy/index.ts`. The admin-proxy functionality becomes the admin service querying on behalf of users using service_role.

```typescript
// packages/backend/src/modules/admin/admin.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class AdminService {
  constructor(private supabase: SupabaseService) {}

  async getStats() {
    // Migrated from admin-users action='stats'
    const db = this.supabase.getClient();
    // Execute multiple count queries in parallel
    const [users, connections, sales, profiles] = await Promise.all([
      db.from('profiles').select('id', { count: 'exact', head: true }),
      db.from('facebook_connections').select('id', { count: 'exact', head: true }),
      db.from('sales').select('id', { count: 'exact', head: true }),
      db.from('profiles').select('plan'),
    ]);
    // Return aggregated stats
    return {
      total_users: users.count || 0,
      total_connections: connections.count || 0,
      total_sales: sales.count || 0,
      plans: this.countByPlan(profiles.data || []),
    };
  }

  private countByPlan(profiles: any[]) {
    const counts: Record<string, number> = {};
    for (const p of profiles) { counts[p.plan] = (counts[p.plan] || 0) + 1; }
    return counts;
  }

  async listUsers(filters: { page?: number; limit?: number; plan?: string; role?: string; facebook_status?: string }) {
    // Migrated from admin-users action='list'
    const db = this.supabase.getClient();
    const page = filters.page || 1;
    const limit = filters.limit || 20;
    const from = (page - 1) * limit;
    const to = from + limit - 1;

    let query = db.from('profiles').select('*, user_roles(role)', { count: 'exact' });
    if (filters.plan) query = query.eq('plan', filters.plan);
    const { data, error, count } = await query.range(from, to).order('created_at', { ascending: false });
    if (error) throw error;
    return { users: data || [], total: count || 0, page, limit };
  }

  async getUserDetail(userId: string) {
    // Migrated from admin-users action='get'
    const db = this.supabase.getClient();
    const { data: profile } = await db.from('profiles').select('*, user_roles(role)').eq('user_id', userId).single();
    const { data: connections } = await db.from('facebook_connections').select('*').eq('user_id', userId);
    const { data: syncLogs } = await db.from('sync_logs').select('*').eq('user_id', userId).order('created_at', { ascending: false }).limit(10);
    return { profile, connections, sync_logs: syncLogs };
  }

  async proxyQuery(targetUserId: string, queries: any[]) {
    // Migrated from admin-proxy — queries on behalf of a user
    const db = this.supabase.getClient();
    const results: Record<string, any> = {};
    for (const q of queries) {
      try {
        let query = db.from(q.table).select(q.select || '*').eq('user_id', targetUserId);
        if (q.filters) {
          for (const f of q.filters) {
            switch (f.op) {
              case 'eq': query = query.eq(f.column, f.value); break;
              case 'neq': query = query.neq(f.column, f.value); break;
              case 'gt': query = query.gt(f.column, f.value); break;
              case 'gte': query = query.gte(f.column, f.value); break;
              case 'lt': query = query.lt(f.column, f.value); break;
              case 'lte': query = query.lte(f.column, f.value); break;
              case 'in': query = query.in(f.column, f.value); break;
              case 'is': query = query.is(f.column, f.value); break;
              case 'like': query = query.like(f.column, f.value); break;
              case 'ilike': query = query.ilike(f.column, f.value); break;
              case 'not_is': query = query.not(f.column, 'is', f.value); break;
            }
          }
        }
        if (q.order) query = query.order(q.order.column, { ascending: q.order.ascending ?? true });
        if (q.limit) query = query.limit(q.limit);
        if (q.range) query = query.range(q.range.from, q.range.to);
        const { data, error } = await query;
        results[q.key] = { data: data || [], error: error?.message || null };
      } catch (e: any) {
        results[q.key] = { data: [], error: e.message };
      }
    }
    return results;
  }
}
```

- [ ] **Step 2: Create AdminController**

```typescript
// packages/backend/src/modules/admin/admin.controller.ts
import { Controller, Get, Post, Body, Param, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { AdminService } from './admin.service';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private admin: AdminService) {}

  @Get('stats')
  stats() { return this.admin.getStats(); }

  @Get('users')
  listUsers(@Query() filters: any) { return this.admin.listUsers(filters); }

  @Get('users/:id')
  getUserDetail(@Param('id') id: string) { return this.admin.getUserDetail(id); }

  @Post('proxy')
  proxyQuery(@Body() body: { user_id: string; queries: any[] }) {
    return this.admin.proxyQuery(body.user_id, body.queries);
  }
}
```

- [ ] **Step 3: Create SalesService and SalesController**

The frontend currently queries sales directly from Supabase. The backend needs to expose sales endpoints.

```typescript
// packages/backend/src/modules/sales/sales.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class SalesService {
  constructor(private supabase: SupabaseService) {}

  async getSales(userId: string, filters: { from?: string; to?: string; status?: string; checkout_ids?: string[]; product_names?: string[] }) {
    const db = this.supabase.getClient();
    let query = db.from('sales').select('*').eq('user_id', userId);
    if (filters.from) query = query.gte('sold_at', filters.from);
    if (filters.to) query = query.lte('sold_at', filters.to);
    if (filters.status) query = query.eq('status', filters.status);
    if (filters.checkout_ids?.length) query = query.in('checkout_integration_id', filters.checkout_ids);
    query = query.order('sold_at', { ascending: false });
    const { data, error } = await query;
    if (error) throw error;
    return data || [];
  }
}
```

```typescript
// packages/backend/src/modules/sales/sales.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SalesService } from './sales.service';

@Controller('sales')
@UseGuards(AuthGuard)
export class SalesController {
  constructor(private sales: SalesService) {}

  @Get()
  getSales(@CurrentUser('id') userId: string, @Query() filters: any) {
    return this.sales.getSales(userId, filters);
  }
}
```

- [ ] **Step 4: Create MetricsService and MetricsController**

Exposes dashboard metrics, profit evolution, sales by region — data currently fetched by frontend hooks via direct Supabase queries.

```typescript
// packages/backend/src/modules/metrics/metrics.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class MetricsService {
  constructor(private supabase: SupabaseService) {}

  async getDashboard(userId: string, filters: { from: string; to: string; checkout_ids?: string[]; product_names?: string[] }) {
    const db = this.supabase.getClient();
    // Fetch sales and spend data, compute metrics server-side
    let salesQuery = db.from('sales').select('*').eq('user_id', userId).gte('sold_at', filters.from).lte('sold_at', filters.to);
    if (filters.checkout_ids?.length) salesQuery = salesQuery.in('checkout_integration_id', filters.checkout_ids);
    const { data: sales } = await salesQuery;

    let spendQuery = db.from('daily_ad_spend').select('*').eq('user_id', userId).gte('date', filters.from.slice(0, 10)).lte('date', filters.to.slice(0, 10));
    const { data: spend } = await spendQuery;

    // Return raw data for frontend to compute (maintaining current behavior)
    return { sales: sales || [], daily_spend: spend || [] };
  }

  async getSalesByRegion(userId: string, filters: { from: string; to: string; checkout_ids?: string[] }) {
    const db = this.supabase.getClient();
    let query = db.from('sales').select('customer_state, customer_country, amount, status')
      .eq('user_id', userId).eq('status', 'approved')
      .gte('sold_at', filters.from).lte('sold_at', filters.to);
    if (filters.checkout_ids?.length) query = query.in('checkout_integration_id', filters.checkout_ids);
    const { data } = await query;
    return data || [];
  }
}
```

```typescript
// packages/backend/src/modules/metrics/metrics.controller.ts
import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { MetricsService } from './metrics.service';

@Controller('metrics')
@UseGuards(AuthGuard)
export class MetricsController {
  constructor(private metrics: MetricsService) {}

  @Get('dashboard')
  dashboard(@CurrentUser('id') userId: string, @Query() filters: any) {
    return this.metrics.getDashboard(userId, filters);
  }

  @Get('sales-by-region')
  salesByRegion(@CurrentUser('id') userId: string, @Query() filters: any) {
    return this.metrics.getSalesByRegion(userId, filters);
  }
}
```

- [ ] **Step 5: Create GenderizeService and EmailService**

```typescript
// packages/backend/src/modules/utils/genderize.service.ts
import { Injectable, Logger } from '@nestjs/common';

@Injectable()
export class GenderizeService {
  private readonly logger = new Logger(GenderizeService.name);

  async genderize(names: string[]): Promise<Record<string, { gender: string; probability: number }>> {
    const uniqueNames = [...new Set(names.map(n => n.split(' ')[0].toLowerCase()))].slice(0, 100);
    const results: Record<string, { gender: string; probability: number }> = {};

    for (let i = 0; i < uniqueNames.length; i += 10) {
      const batch = uniqueNames.slice(i, i + 10);
      const params = batch.map((n, idx) => `name[${idx}]=${encodeURIComponent(n)}`).join('&');
      try {
        const resp = await fetch(`https://api.genderize.io?${params}&country_id=BR`);
        const data = await resp.json();
        for (const item of Array.isArray(data) ? data : [data]) {
          if (item.name && item.gender) {
            results[item.name.toLowerCase()] = { gender: item.gender, probability: item.probability };
          }
        }
      } catch (e: any) {
        this.logger.warn('Genderize API error:', e.message);
      }
      if (i + 10 < uniqueNames.length) await new Promise(r => setTimeout(r, 300));
    }
    return results;
  }
}
```

```typescript
// packages/backend/src/modules/utils/email.service.ts
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class EmailService {
  private readonly logger = new Logger(EmailService.name);

  constructor(private config: ConfigService, private supabase: SupabaseService) {}

  async sendWelcomeEmail(email: string, password: string) {
    const db = this.supabase.getClient();
    const { data: existing } = await db.from('welcome_emails_sent').select('id').eq('email', email).maybeSingle();
    if (existing) return { already_sent: true };

    const apiKey = this.config.get('RESEND_API_KEY');
    if (!apiKey) { this.logger.warn('No RESEND_API_KEY'); return { skipped: true }; }

    // Send via Resend API — same HTML template as send-welcome-email/index.ts
    const resp = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: 'Sentinela <noreply@sentinela.app>',
        to: email,
        subject: 'Bem-vindo ao Sentinela!',
        html: `<p>Seu acesso foi criado. Email: ${email}, Senha: ${password}</p>`,
      }),
    });

    if (resp.ok) {
      await db.from('welcome_emails_sent').insert({ email });
    }
    return { sent: resp.ok };
  }
}
```

- [ ] **Step 6: Create UtilsController and UtilsModule**

```typescript
// packages/backend/src/modules/utils/utils.controller.ts
import { Controller, Post, Body, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { GenderizeService } from './genderize.service';

@Controller('utils')
@UseGuards(AuthGuard)
export class UtilsController {
  constructor(private genderize: GenderizeService) {}

  @Post('genderize')
  genderizeNames(@Body('names') names: string[]) { return this.genderize.genderize(names); }
}
```

- [ ] **Step 7: Create all module files and register in AppModule**

Create `admin.module.ts`, `sales.module.ts`, `metrics.module.ts`, `utils.module.ts`. Register all in `app.module.ts`.

Final `app.module.ts`:

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { SharedModule } from './shared/shared.module';
import { WebhooksModule } from './modules/webhooks/webhooks.module';
import { FacebookModule } from './modules/facebook/facebook.module';
import { WorkspacesModule } from './modules/workspaces/workspaces.module';
import { FinancialModule } from './modules/financial/financial.module';
import { PlansModule } from './modules/plans/plans.module';
import { AdminModule } from './modules/admin/admin.module';
import { SalesModule } from './modules/sales/sales.module';
import { MetricsModule } from './modules/metrics/metrics.module';
import { UtilsModule } from './modules/utils/utils.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    SharedModule,
    WebhooksModule,
    FacebookModule,
    WorkspacesModule,
    FinancialModule,
    PlansModule,
    AdminModule,
    SalesModule,
    MetricsModule,
    UtilsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 8: Verify compilation and commit**

```bash
cd packages/backend && npx nest build
git add packages/backend/src/modules/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add admin, sales, metrics, and utils modules"
```

---

### Task 10: Integrations Module (checkout integrations + company costs)

**Files:**
- Create: `packages/backend/src/modules/integrations/integrations.module.ts`
- Create: `packages/backend/src/modules/integrations/integrations.controller.ts`
- Create: `packages/backend/src/modules/integrations/integrations.service.ts`

- [ ] **Step 1: Create IntegrationsService**

Currently the frontend queries `checkout_integrations` and `company_costs` directly from Supabase. We need endpoints for these.

```typescript
// packages/backend/src/modules/integrations/integrations.service.ts
import { Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class IntegrationsService {
  constructor(private supabase: SupabaseService) {}

  async listCheckoutIntegrations(userId: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('checkout_integrations').select('*').eq('user_id', userId).order('created_at');
    if (error) throw error;
    return data || [];
  }

  async saveCheckoutIntegration(userId: string, body: any) {
    const db = this.supabase.getClient();
    if (body.id) {
      const { data, error } = await db.from('checkout_integrations').update(body).eq('id', body.id).eq('user_id', userId).select().single();
      if (error) throw error;
      return data;
    }
    const { data, error } = await db.from('checkout_integrations').insert({ ...body, user_id: userId }).select().single();
    if (error) throw error;
    return data;
  }

  async deleteCheckoutIntegration(userId: string, id: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('checkout_integrations').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }

  // Company costs
  async listCompanyCosts(userId: string) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('company_costs').select('*').eq('user_id', userId).order('created_at');
    if (error) throw error;
    return data || [];
  }

  async addCompanyCost(userId: string, body: { name: string; type: string; value: number }) {
    const db = this.supabase.getClient();
    const { data, error } = await db.from('company_costs').insert({ user_id: userId, ...body }).select().single();
    if (error) throw error;
    return data;
  }

  async removeCompanyCost(userId: string, id: string) {
    const db = this.supabase.getClient();
    const { error } = await db.from('company_costs').delete().eq('id', id).eq('user_id', userId);
    if (error) throw error;
    return { success: true };
  }
}
```

- [ ] **Step 2: Create IntegrationsController**

```typescript
// packages/backend/src/modules/integrations/integrations.controller.ts
import { Controller, Get, Post, Delete, Body, Param, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { IntegrationsService } from './integrations.service';

@Controller('integrations')
@UseGuards(AuthGuard)
export class IntegrationsController {
  constructor(private integrations: IntegrationsService) {}

  @Get('checkout')
  listCheckout(@CurrentUser('id') userId: string) { return this.integrations.listCheckoutIntegrations(userId); }

  @Post('checkout')
  saveCheckout(@CurrentUser('id') userId: string, @Body() body: any) { return this.integrations.saveCheckoutIntegration(userId, body); }

  @Delete('checkout/:id')
  deleteCheckout(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.integrations.deleteCheckoutIntegration(userId, id); }

  @Get('company-costs')
  listCosts(@CurrentUser('id') userId: string) { return this.integrations.listCompanyCosts(userId); }

  @Post('company-costs')
  addCost(@CurrentUser('id') userId: string, @Body() body: any) { return this.integrations.addCompanyCost(userId, body); }

  @Delete('company-costs/:id')
  removeCost(@CurrentUser('id') userId: string, @Param('id') id: string) { return this.integrations.removeCompanyCost(userId, id); }
}
```

- [ ] **Step 3: Create module, register, verify, commit**

```bash
cd packages/backend && npx nest build
git add packages/backend/src/modules/integrations/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add integrations module (checkout + company costs)"
```

---

## Phase 3: Frontend Refactor

### Task 11: API Client

**Files:**
- Create: `packages/frontend/src/lib/api.ts`
- Modify: `packages/frontend/src/integrations/supabase/client.ts` (rewrite for auth-only)

- [ ] **Step 1: Create API client**

```typescript
// packages/frontend/src/lib/api.ts
import { supabase } from '@/integrations/supabase/client';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

async function getAuthHeaders(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession();
  const token = data?.session?.access_token;
  return {
    'Content-Type': 'application/json',
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = await getAuthHeaders();
  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers: { ...headers, ...options.headers },
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error || error.message || `HTTP ${response.status}`);
  }

  return response.json();
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, body?: any) => request<T>(path, { method: 'POST', body: body ? JSON.stringify(body) : undefined }),
  patch: <T>(path: string, body?: any) => request<T>(path, { method: 'PATCH', body: body ? JSON.stringify(body) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
```

- [ ] **Step 2: Rewrite client.ts for auth-only**

```typescript
// packages/frontend/src/integrations/supabase/client.ts
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL || 'https://picgyetvkjymfrgsjozt.supabase.co';
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InBpY2d5ZXR2a2p5bWZyZ3Nqb3p0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzA0NzIxMDAsImV4cCI6MjA4NjA0ODEwMH0.SgyU1m5jWArKvtCkxj3HbXVJmc-CoBGdulQVS1OjRY0';

/**
 * Supabase client — used ONLY for authentication (login, signup, session).
 * All business data goes through the backend API.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/lib/api.ts packages/frontend/src/integrations/supabase/client.ts
git commit -m "feat(frontend): add API client and rewrite Supabase client for auth-only"
```

---

### Task 12: Refactor All Hooks to Use API

This is the largest frontend task. Every hook that currently calls Supabase directly or uses `invokeCloudFunction` must be refactored to use `api`.

**Files to modify:** All 33 hooks in `packages/frontend/src/hooks/`

- [ ] **Step 1: Refactor hooks that use invokeCloudFunction**

These hooks currently use `invokeCloudFunction()` and need to use `api` instead:

**useWorkspaces.ts:**
```typescript
// Replace: invokeCloudFunction('manage-workspaces', { action: 'list' })
// With:    api.get('/workspaces')
import { api } from '@/lib/api';

// In queryFn:
const data = await api.get<Workspace[]>('/workspaces');
return data;

// createWorkspace:
const data = await api.post<Workspace>('/workspaces', { name });

// deleteWorkspace:
await api.delete(`/workspaces/${workspaceId}`);

// addConnection:
await api.post(`/workspaces/${workspaceId}/connections`, { facebook_connection_id: facebookConnectionId });

// etc.
```

**useFinancialEntries.ts:**
```typescript
// Replace: invokeCloudFunction('manage-financial-entries', { action: 'list', ... })
// With:    api.get('/financial?workspace_id=...&reference_month=...')
```

**usePlanRules.ts:**
```typescript
// Replace: invokeCloudFunction('manage-plan-rules', { action: 'list' })
// With:    api.get('/plans/rules')
```

**useAdminDashboard.ts:**
```typescript
// Replace: invokeCloudFunction('admin-users', { action: 'stats' })
// With:    api.get('/admin/stats')
```

**useAdminUsers.ts:**
```typescript
// Replace: invokeCloudFunction('admin-users', { action: 'list', ... })
// With:    api.get('/admin/users?page=...&limit=...')
```

**useAdminPlans.ts:**
```typescript
// Replace: invokeCloudFunction('manage-plan-rules', ...)
// With:    api.get/patch('/plans/rules/...')
```

**useGenderize.ts:**
```typescript
// Replace: invokeCloudFunction('genderize', { names })
// With:    api.post('/utils/genderize', { names })
```

**useFacebookConnection.ts:**
```typescript
// Replace: invokeCloudFunction('manage-facebook-connection', ...)
// With:    api.get/post/delete('/facebook/connections/...')
```

**useFacebookSync.ts:**
```typescript
// Replace: invokeCloudFunction('fetch-meta-insights', { action: 'sync', ... })
// With:    api.post('/facebook/insights/sync', { connection_id })
```

**useBudgetUpdate.ts:**
```typescript
// Replace: invokeCloudFunction('update-budget', ...)
// With:    api.patch('/facebook/budget', body)
```

**useCampaignStatusUpdate.ts:**
```typescript
// Replace: invokeCloudFunction('update-campaign-status', ...)
// With:    api.patch('/facebook/campaigns/status', body)
```

**useMetaInsights.ts:**
```typescript
// Replace: invokeCloudFunction('fetch-meta-insights', { action: 'insights' })
// With:    api.post('/facebook/insights/validate', ...)
```

**useCompanyCosts.ts:**
```typescript
// Replace: direct Supabase Cloud queries
// With:    api.get/post/delete('/integrations/company-costs/...')
```

- [ ] **Step 2: Refactor hooks that use direct Supabase queries**

These hooks currently import `db` from `db-helper.ts` or `supabase` from `db.ts` and query tables directly. They need to use `api`:

**useSales.ts:**
```typescript
// Replace: db.from('sales').select(...).eq('user_id', userId)...
// With:    api.get('/sales?from=...&to=...&status=...')
```

**useCampaigns.ts:**
```typescript
// Replace: db.from('campaigns').select(...)
// With:    api.get('/metrics/dashboard?from=...&to=...')
// Note: campaigns data can come from the dashboard metrics endpoint
```

**useDashboardMetrics.ts:**
```typescript
// Replace: Multiple db.from('sales'), db.from('daily_ad_spend') queries
// With:    api.get('/metrics/dashboard?from=...&to=...')
```

**useAds.ts, useAdSets.ts:**
```typescript
// These do complex joins. Keep the computation in the frontend
// but fetch raw data from:  api.get('/sales?...')  +  api.get('/metrics/dashboard?...')
```

**useSalesByRegion.ts:**
```typescript
// Replace: db.from('sales').select(...)
// With:    api.get('/metrics/sales-by-region?from=...&to=...')
```

**useCheckoutIntegrations.ts:**
```typescript
// Replace: db.from('checkout_integrations').select(...)
// With:    api.get('/integrations/checkout')
```

**useSyncSchedule.ts:**
```typescript
// This queries sync_schedules and sync_logs directly.
// Add endpoints to the backend or keep as a thin API call.
```

**useSupabase.ts:**
```typescript
// This returns either the real supabase client or proxied client.
// With the API approach, impersonation is handled by passing target_user_id to the backend.
// This hook may no longer be needed — or can return the api object.
```

- [ ] **Step 3: Update contexts**

**WorkspaceContext.tsx:**
- Currently receives workspaces from useWorkspaces hook — no direct Supabase dependency. No change needed if the hook is refactored.

**ImpersonationContext.tsx:**
- Keep as-is for state management. The `getEffectiveUserId` pattern changes: instead of creating a proxied Supabase client, hooks pass `target_user_id` as a query parameter to the API.

**AuthContext.tsx:**
- Already uses Supabase Auth directly — keep as-is. Remove any `db` imports if present.

- [ ] **Step 4: Verify no compile errors**

```bash
cd packages/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/hooks/ packages/frontend/src/contexts/
git commit -m "refactor(frontend): migrate all hooks from Supabase/Cloud to backend API"
```

---

### Task 13: Remove Cloud References + Cleanup

**Files to delete:**
- `packages/frontend/src/integrations/supabase/db.ts`
- `packages/frontend/src/integrations/supabase/db-helper.ts`
- `packages/frontend/src/integrations/supabase/proxied-client.ts`
- `packages/frontend/src/integrations/supabase/admin-query.ts`

**Files to keep:**
- `packages/frontend/src/integrations/supabase/client.ts` (rewritten in Task 11)
- `packages/frontend/src/integrations/supabase/types.ts` (keep for type references)
- `packages/frontend/src/integrations/supabase/fetchAll.ts` (may still be useful)

- [ ] **Step 1: Delete Cloud-related files**

```bash
rm packages/frontend/src/integrations/supabase/db.ts
rm packages/frontend/src/integrations/supabase/db-helper.ts
rm packages/frontend/src/integrations/supabase/proxied-client.ts
rm packages/frontend/src/integrations/supabase/admin-query.ts
```

- [ ] **Step 2: Update all imports**

Search the entire frontend codebase for any remaining imports of deleted files:

```bash
grep -r "db-helper\|db\.ts\|proxied-client\|admin-query\|invokeCloudFunction\|obmkhvzargmcgndaioxb" packages/frontend/src/
```

Fix all remaining imports:
- `from '@/integrations/supabase/db-helper'` → remove (should already be replaced)
- `from '@/integrations/supabase/db'` → `from '@/integrations/supabase/client'` (only for auth)
- `from '@/integrations/supabase/proxied-client'` → remove
- `from '@/integrations/supabase/admin-query'` → remove

- [ ] **Step 3: Verify ZERO references to Cloud Supabase**

```bash
grep -r "obmkhvzargmcgndaioxb" .
```

Expected: NO results.

```bash
grep -r "invokeCloudFunction" packages/frontend/
```

Expected: NO results.

```bash
grep -r "EXTERNAL_SUPABASE" packages/
```

Expected: NO results (backend uses single SUPABASE_URL).

- [ ] **Step 4: Verify frontend compiles**

```bash
cd packages/frontend && npx tsc --noEmit
```

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "refactor(frontend): remove all Cloud Supabase references and unused files"
```

---

## Phase 4: Final Configuration & Verification

### Task 14: Monorepo Configuration + Final Verification

- [ ] **Step 1: Update frontend vite.config.ts for API proxy in dev**

Add a proxy so frontend dev server forwards `/api` calls to the backend:

```typescript
// In packages/frontend/vite.config.ts, add to defineConfig:
server: {
  port: 5173,
  proxy: {
    '/api': {
      target: 'http://localhost:3001',
      changeOrigin: true,
    },
  },
},
```

With this proxy, the frontend's `VITE_API_URL` can be empty/relative in development.

- [ ] **Step 2: Update frontend vercel.json**

Remove the old Supabase function rewrite and add API rewrite:

```json
{
  "rewrites": [
    { "source": "/api/:path*", "destination": "https://your-backend-url.com/api/:path*" },
    { "source": "/(.*)", "destination": "/index.html" }
  ]
}
```

Note: The actual backend URL will be set when deploying. For now, use placeholder.

- [ ] **Step 3: Add VITE_API_URL to frontend env**

Create `packages/frontend/.env.example`:

```env
VITE_SUPABASE_URL=https://picgyetvkjymfrgsjozt.supabase.co
VITE_SUPABASE_ANON_KEY=
VITE_API_URL=http://localhost:3001/api
```

- [ ] **Step 4: Verify turbo dev starts both services**

```bash
cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel
npm run dev
```

Expected: Both frontend (port 5173) and backend (port 3001) start.

- [ ] **Step 5: Full grep verification**

Run these checks to ensure complete migration:

```bash
# No Cloud Supabase references
grep -r "obmkhvzargmcgndaioxb" --include="*.ts" --include="*.tsx" --include="*.js" .

# No invokeCloudFunction
grep -r "invokeCloudFunction" --include="*.ts" --include="*.tsx" .

# No EXTERNAL_SUPABASE in backend
grep -r "EXTERNAL_SUPABASE" packages/backend/

# No direct Supabase data queries in frontend (only auth)
grep -r "\.from(" packages/frontend/src/ --include="*.ts" --include="*.tsx" | grep -v "node_modules" | grep -v "types.ts"
```

All should return NO results (except possibly `types.ts` which has table definitions).

- [ ] **Step 6: Verify backend compiles and starts**

```bash
cd packages/backend && npx nest build && node dist/main.js &
sleep 2
curl http://localhost:3001/api/plans/rules
kill %1
```

Expected: Returns plan rules JSON (or 401 if auth required).

- [ ] **Step 7: Verify frontend compiles**

```bash
cd packages/frontend && npx vite build
```

Expected: Build succeeds.

- [ ] **Step 8: Final commit**

```bash
git add -A
git commit -m "feat: complete monorepo migration — single Supabase, NestJS backend, refactored frontend"
```

---

## API Route Summary

| Frontend Hook | Method | Backend Route | Module |
|---|---|---|---|
| useWorkspaces | GET/POST/PATCH/DELETE | /api/workspaces/* | workspaces |
| useFinancialEntries | GET/POST/PATCH/DELETE | /api/financial/* | financial |
| usePlanRules | GET | /api/plans/rules | plans |
| useAdminPlans | GET/PATCH | /api/plans/rules/:plan | plans |
| useAdminDashboard | GET | /api/admin/stats | admin |
| useAdminUsers | GET/POST/PATCH/DELETE | /api/admin/users/* | admin |
| useAdminUserDetail | GET | /api/admin/users/:id | admin |
| useSales | GET | /api/sales | sales |
| useDashboardMetrics | GET | /api/metrics/dashboard | metrics |
| useSalesByRegion | GET | /api/metrics/sales-by-region | metrics |
| useFacebookConnection | GET/POST/DELETE | /api/facebook/connections/* | facebook |
| useFacebookSync | POST/GET | /api/facebook/insights/sync, /job/:id | facebook |
| useBudgetUpdate | PATCH | /api/facebook/budget | facebook |
| useCampaignStatusUpdate | PATCH | /api/facebook/campaigns/status | facebook |
| useMetaInsights | POST | /api/facebook/insights/validate | facebook |
| useGenderize | POST | /api/utils/genderize | utils |
| useCheckoutIntegrations | GET/POST/DELETE | /api/integrations/checkout/* | integrations |
| useCompanyCosts | GET/POST/DELETE | /api/integrations/company-costs/* | integrations |
| Webhooks | POST | /api/webhooks/:platform | webhooks |
