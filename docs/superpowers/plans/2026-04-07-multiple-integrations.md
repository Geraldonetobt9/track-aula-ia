# Multiple Integrations Per Platform — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow users to create N integrations of the same checkout platform per workspace, each identified by a mandatory name, with proper edit/delete flows and plan-based limits.

**Architecture:** Add `name` column to `checkout_integrations`, refactor the frontend from a fixed platform grid to a dynamic integration list with a two-step add flow (select platform → configure), and fix the edit flow to send the integration `id` for updates. Backend enforces plan limits via `plan_rules.max_checkout_integrations`.

**Tech Stack:** Supabase migration (SQL), NestJS (DTO + service), React (components + hook)

---

### Task 1: Database Migration — Add `name` Column

**Files:**
- Create: `supabase/migrations/20260407000004_integration_name_column.sql`

- [ ] **Step 1: Create migration file**

```sql
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
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260407000004_integration_name_column.sql
git commit -m "feat(db): add name column to checkout_integrations"
```

---

### Task 2: Backend — DTO and Service Updates

**Files:**
- Modify: `packages/backend/src/modules/integrations/dto/save-checkout.dto.ts`
- Modify: `packages/backend/src/modules/integrations/integrations.service.ts`
- Modify: `packages/backend/src/modules/integrations/integrations.module.ts`

- [ ] **Step 1: Add `name` field to SaveCheckoutDto**

In `packages/backend/src/modules/integrations/dto/save-checkout.dto.ts`, add after the `platform` field:

```typescript
@IsOptional()
@IsString()
name?: string;
```

It's `@IsOptional()` because on UPDATE the user might only change the token. The frontend will enforce it as required on creation.

- [ ] **Step 2: Add `name` to the select in `listCheckoutIntegrations`**

In `packages/backend/src/modules/integrations/integrations.service.ts`, update the select string in `listCheckoutIntegrations` (line 15) to include `name`:

Change from:
```typescript
.select('id, user_id, platform, webhook_secret, is_active, last_webhook_at, created_at, updated_at, webhook_url, api_token, use_commission_value')
```
to:
```typescript
.select('id, user_id, platform, webhook_secret, is_active, last_webhook_at, created_at, updated_at, webhook_url, api_token, use_commission_value, name')
```

- [ ] **Step 3: Add plan limit check to `saveCheckoutIntegration`**

In `integrations.service.ts`, add the plan limit check at the beginning of `saveCheckoutIntegration`, only for new integrations (when `body.id` is not provided):

First, import `ForbiddenException` at the top:
```typescript
import { Injectable, ForbiddenException } from '@nestjs/common';
```

Then update the `saveCheckoutIntegration` method. Add the limit check before the existing insert logic (after line 31, before `const insertPayload`):

```typescript
async saveCheckoutIntegration(userId: string, body: any) {
  const db = this.supabase.getClient();
  if (body.id) {
    const { id, ...updates } = body;
    const { data, error } = await db.from('checkout_integrations').update(updates).eq('id', id).eq('user_id', userId).select().single();
    if (error) throw error;
    return data;
  }

  // Check plan limit for new integrations
  if (body.workspace_id) {
    const { count, error: countError } = await db
      .from('checkout_integrations')
      .select('id', { count: 'exact', head: true })
      .eq('workspace_id', body.workspace_id);

    if (!countError && count !== null) {
      const { data: profile } = await db
        .from('profiles')
        .select('plan_id')
        .eq('id', userId)
        .single();

      if (profile?.plan_id) {
        const { data: planRule } = await db
          .from('plan_rules')
          .select('max_checkout_integrations')
          .eq('id', profile.plan_id)
          .single();

        const limit = planRule?.max_checkout_integrations ?? 1;
        if (limit !== -1 && count >= limit) {
          throw new ForbiddenException(
            `Limite de integrações atingido (${limit}). Faça upgrade do plano para adicionar mais.`,
          );
        }
      }
    }
  }

  const insertPayload: Record<string, unknown> = { ...body, user_id: userId };
  if (body.workspace_id) {
    insertPayload.workspace_id = body.workspace_id;
  }
  const { data, error } = await db.from('checkout_integrations').insert(insertPayload).select().single();
  if (error) throw error;

  // Discord log — fire-and-forget
  this.logIntegrationEvent(db, userId, body.workspace_id, body.platform, 'created');

  return data;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/integrations/dto/save-checkout.dto.ts packages/backend/src/modules/integrations/integrations.service.ts
git commit -m "feat(backend): add name field and plan limit check to integrations"
```

---

### Task 3: Frontend — Update Types and Hook

**Files:**
- Modify: `packages/frontend/src/types/checkout.ts`
- Modify: `packages/frontend/src/hooks/useCheckoutIntegrations.ts`

- [ ] **Step 1: Add `name` to CheckoutIntegration interface**

In `packages/frontend/src/types/checkout.ts`, add to the `CheckoutIntegration` interface after `platform`:

```typescript
name: string;
```

- [ ] **Step 2: Refactor `saveIntegration` to accept an object**

In `packages/frontend/src/hooks/useCheckoutIntegrations.ts`, change the `saveIntegration` function. Replace the current implementation (lines 65-108) with:

```typescript
interface SaveIntegrationParams {
  id?: string;
  platform: CheckoutPlatform;
  name: string;
  token: string;
  useCommissionValue: boolean;
}

const saveIntegration = async (params: SaveIntegrationParams): Promise<boolean> => {
  if (!user?.id) return false;
  if (!params.token.trim()) {
    toast({
      title: 'Token obrigatório',
      description: 'Cole o token da plataforma de checkout para continuar.',
      variant: 'destructive',
    });
    return false;
  }
  if (!params.name.trim()) {
    toast({
      title: 'Nome obrigatório',
      description: 'Dê um nome para identificar esta integração.',
      variant: 'destructive',
    });
    return false;
  }

  setSaving(true);

  try {
    const webhookUrl = generateWebhookUrl(params.platform);

    await api.post('/integrations/checkout', {
      ...(params.id ? { id: params.id } : {}),
      platform: params.platform,
      name: params.name.trim(),
      webhook_url: webhookUrl,
      webhook_secret: params.token.trim(),
      workspace_id: activeWorkspaceId || undefined,
      use_commission_value: params.useCommissionValue,
    });

    queryClient.invalidateQueries({ queryKey: ['workspaces'] });

    toast({
      title: params.id ? 'Integração atualizada!' : 'Integração salva!',
      description: `${params.name} configurado com sucesso.`,
    });

    await fetchIntegrations();
    return true;
  } catch (err: any) {
    console.error('Error saving integration:', err);
    const message = err?.response?.data?.message || err.message;
    toast({
      title: 'Erro ao salvar integração',
      description: message,
      variant: 'destructive',
    });
    return false;
  } finally {
    setSaving(false);
  }
};
```

- [ ] **Step 3: Remove `getIntegration` helper and update return**

Remove the `getIntegration` function (lines 152-154) and remove it from the return object. The final return should be:

```typescript
return {
  integrations: filteredIntegrations,
  loading,
  saving,
  saveIntegration,
  toggleIntegration,
  deleteIntegration,
  generateWebhookUrl,
  refetch: fetchIntegrations,
};
```

Also export the `SaveIntegrationParams` interface so the modal can use it:

```typescript
export interface SaveIntegrationParams {
  id?: string;
  platform: CheckoutPlatform;
  name: string;
  token: string;
  useCommissionValue: boolean;
}
```

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/types/checkout.ts packages/frontend/src/hooks/useCheckoutIntegrations.ts
git commit -m "feat(frontend): refactor hook for multi-integration support"
```

---

### Task 4: Frontend — Update CheckoutConfigModal

**Files:**
- Modify: `packages/frontend/src/components/integrations/CheckoutConfigModal.tsx`

- [ ] **Step 1: Update props interface and add name state**

Replace the props interface and update the component:

```typescript
interface CheckoutConfigModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: CheckoutPlatform;
  integration: CheckoutIntegration | undefined;
  webhookUrl: string;
  onSave: (params: { name: string; token: string; useCommissionValue: boolean }) => Promise<boolean>;
  onToggle: (active: boolean) => Promise<void>;
  onDelete: () => Promise<void>;
  saving: boolean;
}
```

Add the `name` state after the existing state declarations:

```typescript
const [name, setName] = useState('');
```

Update the `useEffect` to reset the name:

```typescript
useEffect(() => {
  if (open) {
    setToken(integration?.webhook_secret || '');
    setName(integration?.name || '');
    setUseCommissionValue(integration?.use_commission_value ?? false);
  }
}, [open, integration?.webhook_secret, integration?.use_commission_value, integration?.name]);
```

Update `handleSave`:

```typescript
const handleSave = async () => {
  const success = await onSave({ name, token, useCommissionValue });
  if (success) {
    onOpenChange(false);
  }
};
```

- [ ] **Step 2: Add name input field to the modal body**

Add this section before the Webhook URL section (before line 103, the `{/* Webhook URL */}` comment):

```tsx
{/* Integration Name */}
<div className="space-y-2">
  <Label>Nome da integração</Label>
  <Input
    value={name}
    onChange={(e) => setName(e.target.value)}
    placeholder="Ex: Produto Digital A"
  />
</div>
```

- [ ] **Step 3: Update the save button disabled condition**

Change the save button from:

```tsx
<Button onClick={handleSave} disabled={saving || !token.trim()}>
```

to:

```tsx
<Button onClick={handleSave} disabled={saving || !token.trim() || !name.trim()}>
```

- [ ] **Step 4: Add import for SaveIntegrationParams (if needed by the onSave type)**

Add the import at the top if needed. The `onSave` prop now receives `{ name, token, useCommissionValue }`.

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/components/integrations/CheckoutConfigModal.tsx
git commit -m "feat(frontend): add name field to checkout config modal"
```

---

### Task 5: Frontend — Create PlatformSelectorModal

**Files:**
- Create: `packages/frontend/src/components/integrations/PlatformSelectorModal.tsx`

- [ ] **Step 1: Create the platform selector modal**

This is the first step of the two-step add flow. It shows a grid of platform icons for the user to choose from.

```tsx
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { CheckoutPlatform, CHECKOUT_PLATFORMS } from '@/types/checkout';

interface PlatformSelectorModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelectPlatform: (platform: CheckoutPlatform) => void;
}

const PLATFORM_LOGOS: Partial<Record<CheckoutPlatform, { src: string; alt: string }>> = {
  hotmart: { src: '/hotmart-logo.png', alt: 'Hotmart' },
  kiwify: { src: '/kiwify-logo.jpg', alt: 'Kiwify' },
  kirvano: { src: '/kirvano-logo.png', alt: 'Kirvano' },
  guru: { src: '/guru-logo.jpg', alt: 'Guru Digital' },
  perfectpay: { src: '/perfectpay-logo.png', alt: 'Perfect Pay' },
  ticto: { src: '/ticto-logo.png', alt: 'Ticto' },
  payt: { src: '/payt-logo.png', alt: 'PayT' },
  cakto: { src: '/cakto-logo.jpg', alt: 'Cakto' },
  balaclava: { src: '/balaclava-logo.png', alt: 'Balaclava' },
};

const ALL_PLATFORMS: CheckoutPlatform[] = [
  'hotmart', 'kiwify', 'kirvano', 'guru', 'perfectpay', 'ticto', 'payt', 'cakto', 'balaclava',
];

export function PlatformSelectorModal({
  open,
  onOpenChange,
  onSelectPlatform,
}: PlatformSelectorModalProps) {
  const handleSelect = (platform: CheckoutPlatform) => {
    onOpenChange(false);
    onSelectPlatform(platform);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[500px]">
        <DialogHeader>
          <DialogTitle>Adicionar integração</DialogTitle>
          <DialogDescription>
            Selecione a plataforma de checkout
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-3 py-4">
          {ALL_PLATFORMS.map((platform) => {
            const config = CHECKOUT_PLATFORMS[platform];
            const logo = PLATFORM_LOGOS[platform];

            return (
              <button
                key={platform}
                onClick={() => handleSelect(platform)}
                className="flex flex-col items-center gap-2 rounded-lg border border-white/5 p-4 hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                {logo ? (
                  <img src={logo.src} alt={logo.alt} className="h-10 w-10 rounded-lg object-cover" />
                ) : (
                  <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.color} text-sm font-bold text-white`}>
                    {config.name.substring(0, 2)}
                  </div>
                )}
                <span className="text-xs font-medium">{config.name}</span>
              </button>
            );
          })}
        </div>
      </DialogContent>
    </Dialog>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/integrations/PlatformSelectorModal.tsx
git commit -m "feat(frontend): create platform selector modal for two-step add flow"
```

---

### Task 6: Frontend — Refactor CheckoutIntegrationsSection

**Files:**
- Modify: `packages/frontend/src/components/integrations/CheckoutIntegrationsSection.tsx`

This is the main UI refactoring — changing from fixed platform cards to dynamic integration cards.

- [ ] **Step 1: Rewrite the component**

Replace the entire contents of `CheckoutIntegrationsSection.tsx` with:

```tsx
import { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Plus, Settings, Clock, MoreHorizontal, Trash2 } from 'lucide-react';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { CheckoutPlatform, CHECKOUT_PLATFORMS, CheckoutIntegration } from '@/types/checkout';
import { useCheckoutIntegrations } from '@/hooks/useCheckoutIntegrations';
import { CheckoutConfigModal } from './CheckoutConfigModal';
import { PlatformSelectorModal } from './PlatformSelectorModal';
import { Skeleton } from '@/components/ui/skeleton';

const PLATFORM_LOGOS: Partial<Record<CheckoutPlatform, { src: string; alt: string }>> = {
  hotmart: { src: '/hotmart-logo.png', alt: 'Hotmart' },
  kiwify: { src: '/kiwify-logo.jpg', alt: 'Kiwify' },
  kirvano: { src: '/kirvano-logo.png', alt: 'Kirvano' },
  guru: { src: '/guru-logo.jpg', alt: 'Guru Digital' },
  perfectpay: { src: '/perfectpay-logo.png', alt: 'Perfect Pay' },
  ticto: { src: '/ticto-logo.png', alt: 'Ticto' },
  payt: { src: '/payt-logo.png', alt: 'PayT' },
  cakto: { src: '/cakto-logo.jpg', alt: 'Cakto' },
  balaclava: { src: '/balaclava-logo.png', alt: 'Balaclava' },
};

export function CheckoutIntegrationsSection() {
  const [showPlatformSelector, setShowPlatformSelector] = useState(false);
  const [selectedIntegration, setSelectedIntegration] = useState<CheckoutIntegration | null>(null);
  const [selectedPlatformForNew, setSelectedPlatformForNew] = useState<CheckoutPlatform | null>(null);

  const {
    integrations,
    loading,
    saving,
    saveIntegration,
    toggleIntegration,
    deleteIntegration,
    generateWebhookUrl,
  } = useCheckoutIntegrations();

  // Open config modal to EDIT an existing integration
  const handleEdit = (integration: CheckoutIntegration) => {
    setSelectedIntegration(integration);
    setSelectedPlatformForNew(null);
  };

  // Open config modal to CREATE a new integration (after platform selection)
  const handlePlatformSelected = (platform: CheckoutPlatform) => {
    setSelectedPlatformForNew(platform);
    setSelectedIntegration(null);
  };

  const handleCloseConfig = () => {
    setSelectedIntegration(null);
    setSelectedPlatformForNew(null);
  };

  const handleDelete = async (integration: CheckoutIntegration) => {
    await deleteIntegration(integration.id);
  };

  // Determine which platform and integration to pass to the config modal
  const isConfigOpen = !!(selectedIntegration || selectedPlatformForNew);
  const configPlatform = selectedIntegration?.platform || selectedPlatformForNew;
  const configIntegration = selectedIntegration || undefined;

  const handleSave = async (params: { name: string; token: string; useCommissionValue: boolean }) => {
    if (!configPlatform) return false;
    return await saveIntegration({
      id: selectedIntegration?.id,
      platform: configPlatform,
      name: params.name,
      token: params.token,
      useCommissionValue: params.useCommissionValue,
    });
  };

  const handleToggle = async (active: boolean) => {
    if (selectedIntegration) {
      await toggleIntegration(selectedIntegration.id, active);
    }
  };

  const handleDeleteFromModal = async () => {
    if (selectedIntegration) {
      await deleteIntegration(selectedIntegration.id);
    }
  };

  if (loading) {
    return (
      <div className="space-y-4">
        <h2 className="text-lg font-semibold">Integrações de Checkout</h2>
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {[1, 2, 3].map((i) => (
            <Card key={i}>
              <CardHeader>
                <div className="flex items-center gap-3">
                  <Skeleton className="h-10 w-10 rounded-lg" />
                  <div className="space-y-2">
                    <Skeleton className="h-4 w-24" />
                    <Skeleton className="h-3 w-32" />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <Skeleton className="h-9 w-full" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold">Integrações de Checkout</h2>
          <p className="text-sm text-muted-foreground">
            Configure webhooks para receber vendas automaticamente
          </p>
        </div>
        <Button onClick={() => setShowPlatformSelector(true)}>
          <Plus className="mr-2 h-4 w-4" />
          Adicionar integração
        </Button>
      </div>

      {integrations.length === 0 ? (
        <Card className="border-dashed">
          <CardContent className="flex flex-col items-center justify-center py-12">
            <Settings className="h-12 w-12 text-muted-foreground/50 mb-4" />
            <p className="text-muted-foreground mb-4">Nenhuma integração configurada</p>
            <Button onClick={() => setShowPlatformSelector(true)}>
              <Plus className="mr-2 h-4 w-4" />
              Adicionar primeira integração
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {integrations.map((integration) => {
            const config = CHECKOUT_PLATFORMS[integration.platform];
            const logo = PLATFORM_LOGOS[integration.platform];
            const isConnected = integration.is_active;

            return (
              <Card key={integration.id}>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {logo ? (
                        <img src={logo.src} alt={logo.alt} className="h-10 w-10 rounded-lg object-cover" />
                      ) : (
                        <div className={`flex h-10 w-10 items-center justify-center rounded-lg ${config.color} text-sm font-bold text-white`}>
                          {config.name.substring(0, 2)}
                        </div>
                      )}
                      <div>
                        <CardTitle className="text-base">{integration.name}</CardTitle>
                        <p className="text-xs text-muted-foreground">{config.name}</p>
                      </div>
                    </div>
                    <Badge
                      variant={isConnected ? 'default' : 'secondary'}
                      className={isConnected ? 'bg-[#d1fe17] text-black' : ''}
                    >
                      {isConnected ? 'Conectado' : 'Desativado'}
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {integration.last_webhook_at && (
                    <div className="flex items-center gap-2 text-xs text-muted-foreground">
                      <Clock className="h-3 w-3" />
                      <span>
                        Último webhook:{' '}
                        {format(new Date(integration.last_webhook_at), "dd/MM 'às' HH:mm", {
                          locale: ptBR,
                        })}
                      </span>
                    </div>
                  )}
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      onClick={() => handleEdit(integration)}
                    >
                      <Settings className="mr-2 h-4 w-4" />
                      Editar
                    </Button>
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="icon">
                          <MoreHorizontal className="h-4 w-4" />
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent align="end">
                        <DropdownMenuItem
                          className="text-destructive"
                          onClick={() => handleDelete(integration)}
                        >
                          <Trash2 className="mr-2 h-4 w-4" />
                          Remover
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Step 1: Platform Selector */}
      <PlatformSelectorModal
        open={showPlatformSelector}
        onOpenChange={setShowPlatformSelector}
        onSelectPlatform={handlePlatformSelected}
      />

      {/* Step 2: Config Modal (for both create and edit) */}
      {configPlatform && (
        <CheckoutConfigModal
          open={isConfigOpen}
          onOpenChange={(open) => !open && handleCloseConfig()}
          platform={configPlatform}
          integration={configIntegration}
          webhookUrl={generateWebhookUrl(configPlatform)}
          onSave={handleSave}
          onToggle={handleToggle}
          onDelete={handleDeleteFromModal}
          saving={saving}
        />
      )}
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add packages/frontend/src/components/integrations/CheckoutIntegrationsSection.tsx
git commit -m "feat(frontend): refactor integrations section to show integration cards with two-step add flow"
```

---

### Task 7: Documentation

**Files:**
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Add `name` column to checkout_integrations in SQL_DATABASE.md**

In `SQL_DATABASE.md`, find the `checkout_integrations` table definition and add after the `use_commission_value` line:

```
  name text NOT NULL,
```

- [ ] **Step 2: Commit**

```bash
git add SQL_DATABASE.md
git commit -m "docs: add name column to checkout_integrations in SQL_DATABASE.md"
```
