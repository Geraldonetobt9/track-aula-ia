# Settings/Profile Unify — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unificar abas Perfil + Segurança em uma única ficha read-only com edição inline por campo, permitindo trocar nome / e-mail / CPF↔CNPJ / senha; sincronizar mudanças com Stripe e Supabase Auth; logar tudo no Discord.

**Architecture:** Novo módulo NestJS `account` com 4 PATCH endpoints `/me/*` consumindo `SupabaseService` + `StripeService` + `DiscordLoggerService`. Frontend reorganiza `Settings.tsx` para usar um novo `ProfileCard` composto de `EditableRow`s. Trigger SQL garante sync `auth.users.email` → `profiles.email`.

**Tech Stack:** NestJS 10 + Fastify, Supabase JS (auth + DB), Stripe Node SDK, React 18, TanStack Query, shadcn/ui (AlertDialog), Tailwind, class-validator.

**Spec:** [`docs/superpowers/specs/2026-05-02-settings-profile-unify-design.md`](../specs/2026-05-02-settings-profile-unify-design.md)

---

## File map

**Backend (create):**
- `packages/backend/src/modules/account/account.module.ts`
- `packages/backend/src/modules/account/account.controller.ts`
- `packages/backend/src/modules/account/account.service.ts`
- `packages/backend/src/modules/account/dto/update-profile.dto.ts`
- `packages/backend/src/modules/account/dto/update-tax-id.dto.ts`
- `packages/backend/src/modules/account/dto/update-email.dto.ts`
- `packages/backend/src/modules/account/dto/update-password.dto.ts`
- `packages/backend/src/modules/account/__tests__/account.service.spec.ts`

**Backend (modify):**
- `packages/backend/src/config/discord-webhooks.config.ts` (add `accountChanges`)
- `packages/backend/src/config/discord-webhooks.config.example.ts` (add `accountChanges`)
- `packages/backend/src/shared/services/discord-logger.service.ts` (2 new methods)
- `packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts` (tests)
- `packages/backend/src/app.module.ts` (register AccountModule)

**Database (create):**
- `supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql`

**Frontend (create):**
- `packages/frontend/src/components/profile/ProfileCard.tsx`
- `packages/frontend/src/components/profile/EditableRow.tsx`
- `packages/frontend/src/components/profile/rows/NameRow.tsx`
- `packages/frontend/src/components/profile/rows/EmailRow.tsx`
- `packages/frontend/src/components/profile/rows/TaxIdRow.tsx`
- `packages/frontend/src/components/profile/rows/PasswordRow.tsx`
- `packages/frontend/src/components/profile/ConfirmEmailChangeDialog.tsx`
- `packages/frontend/src/hooks/useUpdateProfile.ts`
- `packages/frontend/src/hooks/useUpdateTaxId.ts`
- `packages/frontend/src/hooks/useUpdateEmail.ts`
- `packages/frontend/src/hooks/useUpdatePassword.ts`

**Frontend (modify):**
- `packages/frontend/src/pages/Settings.tsx` (remove security tab, plug ProfileCard)
- `packages/frontend/src/pages/Login.tsx` (add `?email_changed=1` banner)

**Docs (modify):**
- `docs/features/10-settings/settings.md`
- `SQL_DATABASE.md`
- `docs/features/13-discord-logs/` (add `accountChanges` channel info)

---

## Phase 1 — Foundation: Discord channel + DB trigger

### Task 1: Add `accountChanges` channel to Discord config

**Files:**
- Modify: `packages/backend/src/config/discord-webhooks.config.ts`
- Modify: `packages/backend/src/config/discord-webhooks.config.example.ts`

- [ ] **Step 1: Add real URL to live config**

Add at the end of the `DISCORD_WEBHOOKS` object in `packages/backend/src/config/discord-webhooks.config.ts`, after the `executions` entry:

```ts
  // ── Account / Profile changes ─────────────────────────────────────
  accountChanges:
    'https://discord.com/api/webhooks/1500261344463814676/MqUt8QuelEgVVFLdxiJyRC9p0klig7vZ7LoavRrdxQnsYe76r_jClF4DZ14OY-2DhR_e',
```

- [ ] **Step 2: Add placeholder to example config**

Add at the end of the `DISCORD_WEBHOOKS` object in `packages/backend/src/config/discord-webhooks.config.example.ts`, after `dataIntegrity`:

```ts

  // ── Account / Profile changes ─────────────────────────────────────
  accountChanges: '',
```

- [ ] **Step 3: Verify type compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: no errors. The `DiscordChannel` type now includes `'accountChanges'`.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/config/discord-webhooks.config.ts \
        packages/backend/src/config/discord-webhooks.config.example.ts
git commit -m "feat(discord): add accountChanges webhook channel"
```

---

### Task 2: Add `logAccountChangeSuccess` and `logAccountChangeError` to DiscordLoggerService (TDD)

**Files:**
- Modify: `packages/backend/src/shared/services/discord-logger.service.ts`
- Modify: `packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts`

- [ ] **Step 1: Write failing test for `logAccountChangeSuccess`**

Append to `packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts` (before the closing `});` of the outer `describe`):

```ts
  describe('logAccountChangeSuccess', () => {
    it('emits a green embed with before/after for tax_id changes', async () => {
      service.logAccountChangeSuccess({
        userId: 'user-1',
        userEmail: 'mozo1926@gmail.com',
        field: 'tax_id',
        before: 'CPF · 529.982.247-25',
        after: 'CNPJ · 12.345.678/0001-90',
        stripeSynced: true,
      });

      await flushQueue(service);

      expect(mockFetch).toHaveBeenCalledTimes(1);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0x00cc66);
      expect(embed.title).toContain('Conta alterada');
      const fieldNames = embed.fields.map((f: any) => f.name);
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldNames.some((n: string) => n.includes('Usuário'))).toBe(true);
      expect(fieldValues).toContain('mozo1926@gmail.com');
      expect(fieldValues).toContain('CPF · 529.982.247-25');
      expect(fieldValues).toContain('CNPJ · 12.345.678/0001-90');
      expect(fieldValues.some((v: string) => v.includes('sincronizado'))).toBe(true);
    });

    it('omits before/after for password changes', async () => {
      service.logAccountChangeSuccess({
        userId: 'user-2',
        userEmail: 'a@b.com',
        field: 'password',
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldNames = embed.fields.map((f: any) => f.name);
      expect(fieldNames.some((n: string) => n.includes('De') || n.includes('Para'))).toBe(false);
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues.some((v: string) => v === 'Senha alterada')).toBe(true);
    });

    it('marks stripe as pending when stripeSynced is false', async () => {
      service.logAccountChangeSuccess({
        userId: 'user-3',
        userEmail: 'a@b.com',
        field: 'email',
        before: 'a@b.com',
        after: 'c@d.com',
        stripeSynced: false,
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues.some((v: string) => v.includes('pendente'))).toBe(true);
    });
  });

  describe('logAccountChangeError', () => {
    it('emits a red embed with stage and reason', async () => {
      service.logAccountChangeError({
        userId: 'user-1',
        userEmail: 'mozo1926@gmail.com',
        field: 'email',
        attempted: 'novo@email.com',
        errorMessage: 'Supabase Admin: User already registered',
        stage: 'auth',
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      expect(embed.color).toBe(0xff4444);
      expect(embed.title).toContain('Falha ao alterar conta');
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues).toContain('novo@email.com');
      expect(fieldValues).toContain('auth');
      expect(fieldValues).toContain('Supabase Admin: User already registered');
    });

    it('omits attempted value for password errors', async () => {
      service.logAccountChangeError({
        userId: 'user-2',
        userEmail: 'a@b.com',
        field: 'password',
        attempted: 'should-not-appear',
        errorMessage: 'Auth API failure',
        stage: 'auth',
      });
      await flushQueue(service);
      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      const embed = body.embeds[0];
      const fieldValues = embed.fields.map((f: any) => f.value);
      expect(fieldValues).not.toContain('should-not-appear');
      expect(fieldValues).toContain('Auth API failure');
    });
  });
```

- [ ] **Step 2: Run test, expect failures**

Run: `cd packages/backend && npx jest discord-logger -t "logAccountChange"`
Expected: 5 tests fail with `service.logAccountChangeSuccess is not a function` (or similar).

- [ ] **Step 3: Add public DTOs and method bodies in `discord-logger.service.ts`**

Insert these interfaces after the existing `RuleExecutionLogData` interface (around line 70 of `discord-logger.service.ts`):

```ts
export interface AccountChangeSuccessData {
  userId: string;
  userEmail: string;
  field: 'name' | 'email' | 'tax_id' | 'password';
  before?: string;
  after?: string;
  stripeSynced?: boolean;
}

export interface AccountChangeErrorData {
  userId: string;
  userEmail: string;
  field: 'name' | 'email' | 'tax_id' | 'password';
  attempted?: string;
  errorMessage: string;
  stage: 'validation' | 'auth' | 'profile' | 'stripe' | 'revoke_sessions';
}
```

Insert these methods inside the `DiscordLoggerService` class, immediately after `logRuleExecution` (before `sendDailySummary`):

```ts
  // ═══════════════════════════════════════════════════════════════════
  // Account / profile changes
  // ═══════════════════════════════════════════════════════════════════

  logAccountChangeSuccess(data: AccountChangeSuccessData): void {
    const fieldLabel = this.accountFieldLabel(data.field);
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: '👤 Usuário', value: data.userEmail, inline: true },
      { name: '🆔 ID', value: data.userId, inline: true },
      { name: '🔧 Campo', value: fieldLabel, inline: true },
    ];

    if (data.field === 'password') {
      fields.push({ name: 'Status', value: 'Senha alterada' });
    } else {
      if (data.before !== undefined) {
        fields.push({ name: '↩️ De', value: data.before, inline: true });
      }
      if (data.after !== undefined) {
        fields.push({ name: '↪️ Para', value: data.after, inline: true });
      }
    }

    if (data.stripeSynced !== undefined) {
      fields.push({
        name: '☁️ Stripe',
        value: data.stripeSynced ? '✅ sincronizado' : '⚠️ pendente',
        inline: true,
      });
    }

    const embed = {
      title: '✏️ Conta alterada',
      color: COLOR_GREEN,
      fields,
      timestamp: new Date().toISOString(),
    };
    this.send('accountChanges', { embeds: [embed] });
  }

  logAccountChangeError(data: AccountChangeErrorData): void {
    const fieldLabel = this.accountFieldLabel(data.field);
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: '👤 Usuário', value: data.userEmail, inline: true },
      { name: '🆔 ID', value: data.userId, inline: true },
      { name: '🔧 Campo', value: fieldLabel, inline: true },
    ];

    if (data.field !== 'password' && data.attempted !== undefined) {
      fields.push({ name: '🎯 Tentou', value: data.attempted });
    }

    fields.push({ name: '🪜 Etapa', value: data.stage, inline: true });
    fields.push({ name: '📋 Motivo', value: data.errorMessage });

    const embed = {
      title: '❌ Falha ao alterar conta',
      color: COLOR_RED,
      fields,
      timestamp: new Date().toISOString(),
    };
    this.send('accountChanges', { embeds: [embed] });
  }

  private accountFieldLabel(field: 'name' | 'email' | 'tax_id' | 'password'): string {
    switch (field) {
      case 'name': return 'Nome';
      case 'email': return 'E-mail';
      case 'tax_id': return 'Documento (CPF/CNPJ)';
      case 'password': return 'Senha';
    }
  }
```

- [ ] **Step 4: Run tests, expect pass**

Run: `cd packages/backend && npx jest discord-logger -t "logAccountChange"`
Expected: all 5 tests pass.

- [ ] **Step 5: Run full discord-logger suite to ensure nothing broke**

Run: `cd packages/backend && npx jest discord-logger.service`
Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/shared/services/discord-logger.service.ts \
        packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts
git commit -m "feat(discord): logAccountChangeSuccess and logAccountChangeError"
```

---

### Task 3: Migration — sync `profiles.email` from `auth.users.email`

**Files:**
- Create: `supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql`
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Create migration file**

Write `supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql`:

```sql
-- supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql
--
-- Defesa em profundidade para a feature "Settings/Profile unify".
-- Garante que qualquer UPDATE em auth.users.email reflete em profiles.email,
-- mesmo se um endpoint futuro alterar o auth sem passar pelo backend.

CREATE OR REPLACE FUNCTION public.sync_profile_email()
  RETURNS trigger
  LANGUAGE plpgsql
  SECURITY DEFINER
  SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.email IS DISTINCT FROM OLD.email THEN
    UPDATE public.profiles
       SET email = NEW.email,
           updated_at = now()
     WHERE user_id = NEW.id;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS on_auth_user_email_changed ON auth.users;

CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email();
```

- [ ] **Step 2: Apply migration to local Supabase**

Run: `npx supabase db push`
Expected: "Applied migration 20260502170000_sync_profile_email_on_auth_update". If using remote project: `npx supabase db push --linked`.

- [ ] **Step 3: Sanity-test the trigger via SQL**

Run via `npx supabase db remote commit` console or psql against your dev database:

```sql
-- Pick a real user with a profile
SELECT user_id, email FROM public.profiles LIMIT 1;
-- Note the user_id, then update auth.users.email
UPDATE auth.users SET email = email WHERE id = '<user_id>'; -- no-op email triggers no-op
-- Verify trigger exists
SELECT tgname FROM pg_trigger WHERE tgname = 'on_auth_user_email_changed';
```
Expected: trigger row returned.

- [ ] **Step 4: Update `SQL_DATABASE.md`**

Append to the "Triggers" section of `SQL_DATABASE.md`:

```markdown
### `on_auth_user_email_changed` (auth.users)

After every UPDATE on `auth.users`, syncs `profiles.email` when the email changes.
Defends against future code paths that bypass the backend's `PATCH /me/email` endpoint.

```sql
CREATE TRIGGER on_auth_user_email_changed
  AFTER UPDATE ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.sync_profile_email();
```
```

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/20260502170000_sync_profile_email_on_auth_update.sql SQL_DATABASE.md
git commit -m "feat(db): sync profiles.email when auth.users.email changes"
```

---

## Phase 2 — Backend: Account module

### Task 4: Account module skeleton + DTOs

**Files:**
- Create: `packages/backend/src/modules/account/account.module.ts`
- Create: `packages/backend/src/modules/account/account.controller.ts`
- Create: `packages/backend/src/modules/account/account.service.ts`
- Create: `packages/backend/src/modules/account/dto/update-profile.dto.ts`
- Create: `packages/backend/src/modules/account/dto/update-tax-id.dto.ts`
- Create: `packages/backend/src/modules/account/dto/update-email.dto.ts`
- Create: `packages/backend/src/modules/account/dto/update-password.dto.ts`
- Modify: `packages/backend/src/app.module.ts`

- [ ] **Step 1: Write DTOs**

`packages/backend/src/modules/account/dto/update-profile.dto.ts`:

```ts
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class UpdateProfileDto {
  @IsString()
  @IsNotEmpty({ message: 'Nome é obrigatório' })
  @MaxLength(120)
  name!: string;
}
```

`packages/backend/src/modules/account/dto/update-tax-id.dto.ts`:

```ts
import { IsIn, IsNotEmpty, IsString } from 'class-validator';

export class UpdateTaxIdDto {
  @IsIn(['cpf', 'cnpj'], { message: 'Tipo de documento inválido' })
  type!: 'cpf' | 'cnpj';

  @IsString()
  @IsNotEmpty()
  value!: string;
}
```

`packages/backend/src/modules/account/dto/update-email.dto.ts`:

```ts
import { IsEmail } from 'class-validator';

export class UpdateEmailDto {
  @IsEmail({}, { message: 'E-mail inválido' })
  email!: string;
}
```

`packages/backend/src/modules/account/dto/update-password.dto.ts`:

```ts
import { IsString, MinLength } from 'class-validator';

export class UpdatePasswordDto {
  @IsString()
  @MinLength(8, { message: 'Senha precisa ter no mínimo 8 caracteres' })
  password!: string;
}
```

- [ ] **Step 2: Write empty service**

`packages/backend/src/modules/account/account.service.ts`:

```ts
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';
import { StripeService } from '../stripe/stripe.service';

@Injectable()
export class AccountService {
  private readonly logger = new Logger(AccountService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly stripe: StripeService,
    private readonly discord: DiscordLoggerService,
  ) {}

  // Methods will be implemented in Tasks 5–8.
}
```

- [ ] **Step 3: Write controller**

`packages/backend/src/modules/account/account.controller.ts`:

```ts
import { Body, Controller, HttpCode, Patch, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AccountService } from './account.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { UpdateTaxIdDto } from './dto/update-tax-id.dto';
import { UpdateEmailDto } from './dto/update-email.dto';
import { UpdatePasswordDto } from './dto/update-password.dto';

@Controller('me')
@UseGuards(AuthGuard)
export class AccountController {
  constructor(private readonly account: AccountService) {}

  @Patch('profile')
  @HttpCode(200)
  async updateProfile(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdateProfileDto,
  ): Promise<{ name: string }> {
    return this.account.updateProfile(userId, userEmail, dto);
  }

  @Patch('tax-id')
  @HttpCode(200)
  async updateTaxId(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdateTaxIdDto,
  ): Promise<{ type: 'cpf' | 'cnpj'; value: string; stripeSynced: boolean }> {
    return this.account.updateTaxId(userId, userEmail, dto);
  }

  @Patch('email')
  @HttpCode(200)
  async updateEmail(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdateEmailDto,
  ): Promise<{ email: string; stripeSynced: boolean }> {
    return this.account.updateEmail(userId, userEmail, dto);
  }

  @Patch('password')
  @HttpCode(200)
  async updatePassword(
    @CurrentUser('id') userId: string,
    @CurrentUser('email') userEmail: string,
    @Body() dto: UpdatePasswordDto,
  ): Promise<{ ok: true }> {
    return this.account.updatePassword(userId, userEmail, dto);
  }
}
```

- [ ] **Step 4: Write module**

`packages/backend/src/modules/account/account.module.ts`:

```ts
import { Module } from '@nestjs/common';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';
import { StripeModule } from '../stripe/stripe.module';

@Module({
  imports: [StripeModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
```

- [ ] **Step 5: Register `AccountModule` in `app.module.ts`**

Add the import at the top of `packages/backend/src/app.module.ts`:

```ts
import { AccountModule } from './modules/account/account.module';
```

Add `AccountModule` to the `imports` array of `@Module({ ... })`, right after `AuthModule`.

- [ ] **Step 6: Verify type compiles**

Run: `cd packages/backend && npx tsc --noEmit`
Expected: no errors. The service has empty stubs that will fail at runtime — Tasks 5-8 implement them.

- [ ] **Step 7: Commit**

```bash
git add packages/backend/src/modules/account packages/backend/src/app.module.ts
git commit -m "feat(account): scaffold module with controller, service, DTOs"
```

---

### Task 5: Implement `PATCH /me/profile` (TDD)

**Files:**
- Modify: `packages/backend/src/modules/account/account.service.ts`
- Create: `packages/backend/src/modules/account/__tests__/account.service.spec.ts`

- [ ] **Step 1: Write the failing test for updateProfile**

Create `packages/backend/src/modules/account/__tests__/account.service.spec.ts`:

```ts
import { Test, TestingModule } from '@nestjs/testing';
import { AccountService } from '../account.service';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { StripeService } from '../../stripe/stripe.service';
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';

describe('AccountService.updateProfile', () => {
  let service: AccountService;
  let updateFn: jest.Mock;
  let selectFn: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    updateFn = jest.fn().mockResolvedValue({ data: null, error: null });
    selectFn = jest.fn().mockResolvedValue({
      data: { name: 'Old Name' },
      error: null,
    });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        from: () => ({
          select: () => ({ eq: () => ({ maybeSingle: selectFn }) }),
          update: () => ({ eq: updateFn }),
        }),
      }),
    };
    const stripe = { getClient: () => ({}) };
    const discord = {
      logAccountChangeSuccess: logSuccess,
      logAccountChangeError: logError,
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('updates the name and emits Discord success log with before/after', async () => {
    const result = await service.updateProfile('user-1', 'a@b.com', {
      name: 'New Name',
    });

    expect(result).toEqual({ name: 'New Name' });
    expect(updateFn).toHaveBeenCalled();
    expect(logSuccess).toHaveBeenCalledWith({
      userId: 'user-1',
      userEmail: 'a@b.com',
      field: 'name',
      before: 'Old Name',
      after: 'New Name',
    });
  });

  it('emits Discord error log on DB failure', async () => {
    updateFn.mockResolvedValueOnce({ data: null, error: { message: 'DB down' } });
    await expect(
      service.updateProfile('user-1', 'a@b.com', { name: 'New' }),
    ).rejects.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'name',
        stage: 'profile',
        errorMessage: expect.stringContaining('DB down'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd packages/backend && npx jest account.service`
Expected: tests fail because `updateProfile` doesn't exist.

- [ ] **Step 3: Implement `updateProfile` in `account.service.ts`**

Replace the comment placeholder in `account.service.ts` with:

```ts
  async updateProfile(
    userId: string,
    userEmail: string,
    dto: { name: string },
  ): Promise<{ name: string }> {
    const client = this.supabase.getClient();
    const newName = dto.name.trim();

    // Read previous value for the Discord log
    const { data: prev, error: readErr } = await client
      .from('profiles')
      .select('name')
      .eq('user_id', userId)
      .maybeSingle();
    if (readErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'name',
        attempted: newName,
        errorMessage: readErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to read profile: ${readErr.message}`);
    }
    const prevName = prev?.name ?? '';

    // Idempotent no-op
    if (prevName === newName) {
      return { name: newName };
    }

    const { error: updateErr } = await client
      .from('profiles')
      .update({ name: newName, updated_at: new Date().toISOString() })
      .eq('user_id', userId);

    if (updateErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'name',
        attempted: newName,
        errorMessage: updateErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to update profile: ${updateErr.message}`);
    }

    this.discord.logAccountChangeSuccess({
      userId, userEmail, field: 'name',
      before: prevName, after: newName,
    });

    return { name: newName };
  }
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd packages/backend && npx jest account.service -t "updateProfile"`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/account/account.service.ts \
        packages/backend/src/modules/account/__tests__/account.service.spec.ts
git commit -m "feat(account): PATCH /me/profile updates name + Discord log"
```

---

### Task 6: Implement `PATCH /me/password` (TDD)

**Files:**
- Modify: `packages/backend/src/modules/account/account.service.ts`
- Modify: `packages/backend/src/modules/account/__tests__/account.service.spec.ts`

- [ ] **Step 1: Append failing test for updatePassword**

Append to `account.service.spec.ts` (after the `updateProfile` describe):

```ts
describe('AccountService.updatePassword', () => {
  let service: AccountService;
  let adminUpdateUser: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    adminUpdateUser = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        auth: { admin: { updateUserById: adminUpdateUser } },
      }),
    };
    const stripe = { getClient: () => ({}) };
    const discord = { logAccountChangeSuccess: logSuccess, logAccountChangeError: logError };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('updates password via Supabase admin and logs success', async () => {
    const result = await service.updatePassword('user-1', 'a@b.com', { password: 'NewPass123!' });
    expect(adminUpdateUser).toHaveBeenCalledWith('user-1', { password: 'NewPass123!' });
    expect(logSuccess).toHaveBeenCalledWith({
      userId: 'user-1', userEmail: 'a@b.com', field: 'password',
    });
    expect(result).toEqual({ ok: true });
  });

  it('emits Discord error log on Auth failure', async () => {
    adminUpdateUser.mockResolvedValueOnce({ data: null, error: { message: 'Auth API failure' } });
    await expect(
      service.updatePassword('user-1', 'a@b.com', { password: 'NewPass123!' }),
    ).rejects.toThrow();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'password', stage: 'auth',
        errorMessage: expect.stringContaining('Auth API failure'),
      }),
    );
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd packages/backend && npx jest account.service -t "updatePassword"`
Expected: tests fail because `updatePassword` doesn't exist.

- [ ] **Step 3: Implement `updatePassword`**

Append to `account.service.ts`, inside the class:

```ts
  async updatePassword(
    userId: string,
    userEmail: string,
    dto: { password: string },
  ): Promise<{ ok: true }> {
    const client = this.supabase.getClient();
    const { error } = await client.auth.admin.updateUserById(userId, {
      password: dto.password,
    });

    if (error) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'password',
        errorMessage: error.message,
        stage: 'auth',
      });
      throw new Error(`Failed to update password: ${error.message}`);
    }

    this.discord.logAccountChangeSuccess({
      userId, userEmail, field: 'password',
    });
    return { ok: true };
  }
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd packages/backend && npx jest account.service -t "updatePassword"`
Expected: both tests pass.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/account/account.service.ts \
        packages/backend/src/modules/account/__tests__/account.service.spec.ts
git commit -m "feat(account): PATCH /me/password updates Supabase auth + Discord log"
```

---

### Task 7: Implement `PATCH /me/tax-id` with Stripe sync (TDD)

**Files:**
- Modify: `packages/backend/src/modules/account/account.service.ts`
- Modify: `packages/backend/src/modules/account/__tests__/account.service.spec.ts`

- [ ] **Step 1: Append failing tests for updateTaxId**

Append to `account.service.spec.ts`:

```ts
describe('AccountService.updateTaxId', () => {
  let service: AccountService;
  let profileUpdateFn: jest.Mock;
  let profileSelectFn: jest.Mock;
  let subSelectFn: jest.Mock;
  let stripeTaxIdsList: jest.Mock;
  let stripeTaxIdsCreate: jest.Mock;
  let stripeTaxIdsDel: jest.Mock;
  let stripeCustomerUpdate: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    profileUpdateFn = jest.fn().mockResolvedValue({ data: null, error: null });
    profileSelectFn = jest.fn().mockResolvedValue({
      data: { cpf: '52998224725', cnpj: null },
      error: null,
    });
    subSelectFn = jest.fn().mockResolvedValue({
      data: { stripe_customer_id: 'cus_123' },
      error: null,
    });
    stripeTaxIdsList = jest.fn().mockResolvedValue({
      data: [{ id: 'txi_old', type: 'br_cpf', value: '52998224725' }],
    });
    stripeTaxIdsCreate = jest.fn().mockResolvedValue({ id: 'txi_new' });
    stripeTaxIdsDel = jest.fn().mockResolvedValue({ deleted: true });
    stripeCustomerUpdate = jest.fn().mockResolvedValue({ id: 'cus_123' });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        from: (table: string) => {
          if (table === 'profiles') return {
            select: () => ({ eq: () => ({ maybeSingle: profileSelectFn }) }),
            update: () => ({ eq: profileUpdateFn }),
          };
          if (table === 'subscriptions') return {
            select: () => ({ eq: () => ({ maybeSingle: subSelectFn }) }),
          };
          return {};
        },
      }),
    };
    const stripe = {
      getClient: () => ({
        customers: {
          taxIds: {
            list: stripeTaxIdsList,
            create: stripeTaxIdsCreate,
            del: stripeTaxIdsDel,
          },
          update: stripeCustomerUpdate,
        },
      }),
    };
    const discord = { logAccountChangeSuccess: logSuccess, logAccountChangeError: logError };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('rejects invalid CPF', async () => {
    await expect(
      service.updateTaxId('u', 'a@b.com', { type: 'cpf', value: '111.111.111-11' }),
    ).rejects.toThrow(/CPF inválido/);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tax_id', stage: 'validation' }),
    );
  });

  it('switches CPF→CNPJ in DB and replaces Stripe tax_id', async () => {
    const result = await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cnpj',
      value: '12.345.678/0001-90',
    });

    expect(profileUpdateFn).toHaveBeenCalled();
    expect(stripeTaxIdsList).toHaveBeenCalledWith('cus_123');
    expect(stripeTaxIdsDel).toHaveBeenCalledWith('cus_123', 'txi_old');
    expect(stripeTaxIdsCreate).toHaveBeenCalledWith('cus_123', {
      type: 'br_cnpj',
      value: '12345678000190',
    });
    expect(stripeCustomerUpdate).toHaveBeenCalledWith('cus_123', {
      metadata: expect.objectContaining({ cnpj: '12345678000190' }),
    });
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'tax_id', stripeSynced: true,
      }),
    );
    expect(result).toEqual({ type: 'cnpj', value: '12345678000190', stripeSynced: true });
  });

  it('returns stripeSynced=false when Stripe call fails (best effort)', async () => {
    stripeTaxIdsCreate.mockRejectedValueOnce(new Error('Stripe down'));
    const result = await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cnpj',
      value: '12.345.678/0001-90',
    });
    expect(result.stripeSynced).toBe(false);
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tax_id', stripeSynced: false }),
    );
    // No separate error log — represented in success embed as ⚠️ pendente.
    expect(logError).not.toHaveBeenCalled();
  });

  it('skips Stripe entirely when no stripe_customer_id', async () => {
    subSelectFn.mockResolvedValueOnce({ data: { stripe_customer_id: null }, error: null });
    const result = await service.updateTaxId('user-1', 'a@b.com', {
      type: 'cnpj',
      value: '12.345.678/0001-90',
    });
    expect(stripeTaxIdsList).not.toHaveBeenCalled();
    expect(result.stripeSynced).toBe(false);
    // When there is no customer, log without stripeSynced field
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'tax_id' }),
    );
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd packages/backend && npx jest account.service -t "updateTaxId"`
Expected: failures because `updateTaxId` not implemented.

- [ ] **Step 3: Implement `updateTaxId`**

Add to top of `account.service.ts` imports:

```ts
import { BadRequestException, ConflictException } from '@nestjs/common';
import { isValidTaxId, normalizeDigits, TaxIdType } from '../../shared/helpers/tax-id';
```

Append inside the class:

```ts
  async updateTaxId(
    userId: string,
    userEmail: string,
    dto: { type: TaxIdType; value: string },
  ): Promise<{ type: TaxIdType; value: string; stripeSynced: boolean }> {
    const digits = normalizeDigits(dto.value);

    if (!isValidTaxId(dto.type, digits)) {
      const msg = dto.type === 'cpf' ? 'CPF inválido' : 'CNPJ inválido';
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'tax_id',
        attempted: this.formatTaxIdForLog(dto.type, digits),
        errorMessage: msg,
        stage: 'validation',
      });
      throw new BadRequestException(msg);
    }

    const client = this.supabase.getClient();

    // Read previous values
    const { data: prev, error: readErr } = await client
      .from('profiles')
      .select('cpf, cnpj')
      .eq('user_id', userId)
      .maybeSingle();
    if (readErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'tax_id',
        attempted: this.formatTaxIdForLog(dto.type, digits),
        errorMessage: readErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to read profile: ${readErr.message}`);
    }

    const beforeLabel = this.taxIdLabelFromProfile(prev?.cpf, prev?.cnpj);
    const newPair = dto.type === 'cpf'
      ? { cpf: digits, cnpj: null }
      : { cpf: null, cnpj: digits };

    // Idempotent no-op
    if (
      (dto.type === 'cpf' && prev?.cpf === digits) ||
      (dto.type === 'cnpj' && prev?.cnpj === digits)
    ) {
      // Already up to date — return without logging Discord.
      return { type: dto.type, value: digits, stripeSynced: true };
    }

    // Update profile
    const { error: updErr } = await client
      .from('profiles')
      .update({ ...newPair, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (updErr) {
      // Postgres unique violation code is 23505
      const isConflict = (updErr as any).code === '23505';
      const errMsg = isConflict
        ? (dto.type === 'cpf' ? 'Este CPF já está cadastrado' : 'Este CNPJ já está cadastrado')
        : updErr.message;
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'tax_id',
        attempted: this.formatTaxIdForLog(dto.type, digits),
        errorMessage: errMsg,
        stage: 'profile',
      });
      if (isConflict) throw new ConflictException(errMsg);
      throw new Error(`Failed to update tax_id: ${updErr.message}`);
    }

    // Sync Stripe (best-effort)
    const { data: sub } = await client
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();

    const customerId = sub?.stripe_customer_id ?? null;
    let stripeSynced = false;
    let hasCustomer = !!customerId;

    if (customerId) {
      try {
        const stripe = this.stripe.getClient();
        const existing = await stripe.customers.taxIds.list(customerId);
        for (const t of existing.data ?? []) {
          if (t.type === 'br_cpf' || t.type === 'br_cnpj') {
            await stripe.customers.taxIds.del(customerId, t.id);
          }
        }
        await stripe.customers.taxIds.create(customerId, {
          type: dto.type === 'cpf' ? 'br_cpf' : 'br_cnpj',
          value: digits,
        });
        await stripe.customers.update(customerId, {
          metadata: {
            cpf: newPair.cpf ?? '',
            cnpj: newPair.cnpj ?? '',
          },
        });
        stripeSynced = true;
      } catch (err: any) {
        this.logger.warn(`Stripe tax_id sync failed for user ${userId}: ${err?.message}`);
        stripeSynced = false;
      }
    }

    const afterLabel = this.taxIdLabelFromProfile(newPair.cpf, newPair.cnpj);
    const successPayload: any = {
      userId, userEmail, field: 'tax_id',
      before: beforeLabel, after: afterLabel,
    };
    if (hasCustomer) successPayload.stripeSynced = stripeSynced;
    this.discord.logAccountChangeSuccess(successPayload);

    return { type: dto.type, value: digits, stripeSynced };
  }

  private formatTaxIdForLog(type: TaxIdType, digits: string): string {
    if (type === 'cpf' && digits.length === 11) {
      return `CPF · ${digits.slice(0,3)}.${digits.slice(3,6)}.${digits.slice(6,9)}-${digits.slice(9)}`;
    }
    if (type === 'cnpj' && digits.length === 14) {
      return `CNPJ · ${digits.slice(0,2)}.${digits.slice(2,5)}.${digits.slice(5,8)}/${digits.slice(8,12)}-${digits.slice(12)}`;
    }
    return `${type.toUpperCase()} · ${digits}`;
  }

  private taxIdLabelFromProfile(cpf?: string | null, cnpj?: string | null): string {
    if (cpf) return this.formatTaxIdForLog('cpf', cpf);
    if (cnpj) return this.formatTaxIdForLog('cnpj', cnpj);
    return '—';
  }
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd packages/backend && npx jest account.service -t "updateTaxId"`
Expected: all 4 tests pass.

- [ ] **Step 5: Run full account suite**

Run: `cd packages/backend && npx jest account.service`
Expected: all tests so far pass.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/account/account.service.ts \
        packages/backend/src/modules/account/__tests__/account.service.spec.ts
git commit -m "feat(account): PATCH /me/tax-id with Stripe sync + Discord log"
```

---

### Task 8: Implement `PATCH /me/email` with Auth + DB + Stripe + revoke (TDD)

**Files:**
- Modify: `packages/backend/src/modules/account/account.service.ts`
- Modify: `packages/backend/src/modules/account/__tests__/account.service.spec.ts`

- [ ] **Step 1: Append failing tests for updateEmail**

Append to `account.service.spec.ts`:

```ts
describe('AccountService.updateEmail', () => {
  let service: AccountService;
  let listUsers: jest.Mock;
  let adminUpdateUser: jest.Mock;
  let signOut: jest.Mock;
  let profileUpdate: jest.Mock;
  let subSelect: jest.Mock;
  let stripeCustomerUpdate: jest.Mock;
  let logSuccess: jest.Mock;
  let logError: jest.Mock;

  beforeEach(async () => {
    listUsers = jest.fn().mockResolvedValue({ data: { users: [] }, error: null });
    adminUpdateUser = jest.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null });
    signOut = jest.fn().mockResolvedValue({ error: null });
    profileUpdate = jest.fn().mockResolvedValue({ data: null, error: null });
    subSelect = jest.fn().mockResolvedValue({ data: { stripe_customer_id: 'cus_1' }, error: null });
    stripeCustomerUpdate = jest.fn().mockResolvedValue({ id: 'cus_1' });
    logSuccess = jest.fn();
    logError = jest.fn();

    const supabase = {
      getClient: () => ({
        auth: { admin: { listUsers, updateUserById: adminUpdateUser, signOut } },
        from: (table: string) => {
          if (table === 'profiles') return {
            update: () => ({ eq: profileUpdate }),
          };
          if (table === 'subscriptions') return {
            select: () => ({ eq: () => ({ maybeSingle: subSelect }) }),
          };
          return {};
        },
      }),
    };
    const stripe = {
      getClient: () => ({ customers: { update: stripeCustomerUpdate } }),
    };
    const discord = { logAccountChangeSuccess: logSuccess, logAccountChangeError: logError };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        AccountService,
        { provide: SupabaseService, useValue: supabase },
        { provide: StripeService, useValue: stripe },
        { provide: DiscordLoggerService, useValue: discord },
      ],
    }).compile();
    service = module.get(AccountService);
  });

  it('changes email across Auth, DB, Stripe and revokes sessions', async () => {
    const result = await service.updateEmail('user-1', 'old@x.com', { email: 'new@x.com' });

    expect(adminUpdateUser).toHaveBeenCalledWith('user-1', {
      email: 'new@x.com', email_confirm: true,
    });
    expect(profileUpdate).toHaveBeenCalled();
    expect(stripeCustomerUpdate).toHaveBeenCalledWith('cus_1', { email: 'new@x.com' });
    expect(signOut).toHaveBeenCalledWith('user-1', 'global');
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({
        field: 'email', before: 'old@x.com', after: 'new@x.com', stripeSynced: true,
      }),
    );
    expect(result).toEqual({ email: 'new@x.com', stripeSynced: true });
  });

  it('returns 200 idempotent no-op when email matches current', async () => {
    const result = await service.updateEmail('user-1', 'same@x.com', { email: 'same@x.com' });
    expect(adminUpdateUser).not.toHaveBeenCalled();
    expect(logSuccess).not.toHaveBeenCalled();
    expect(result).toEqual({ email: 'same@x.com', stripeSynced: false });
  });

  it('throws Conflict when another user has the email', async () => {
    listUsers.mockResolvedValueOnce({
      data: { users: [{ id: 'someone-else', email: 'taken@x.com' }] },
      error: null,
    });
    await expect(
      service.updateEmail('user-1', 'old@x.com', { email: 'taken@x.com' }),
    ).rejects.toThrow(/já está em uso|already/i);
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'email', stage: 'validation' }),
    );
  });

  it('aborts and logs error when Auth admin update fails', async () => {
    adminUpdateUser.mockResolvedValueOnce({ data: null, error: { message: 'Auth error' } });
    await expect(
      service.updateEmail('user-1', 'old@x.com', { email: 'new@x.com' }),
    ).rejects.toThrow();
    expect(profileUpdate).not.toHaveBeenCalled();
    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({ field: 'email', stage: 'auth' }),
    );
  });

  it('returns stripeSynced=false when Stripe update fails (best effort)', async () => {
    stripeCustomerUpdate.mockRejectedValueOnce(new Error('Stripe down'));
    const result = await service.updateEmail('user-1', 'old@x.com', { email: 'new@x.com' });
    expect(result.stripeSynced).toBe(false);
    expect(signOut).toHaveBeenCalled(); // signOut still happens
    expect(logSuccess).toHaveBeenCalledWith(
      expect.objectContaining({ stripeSynced: false }),
    );
    expect(logError).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test, expect failure**

Run: `cd packages/backend && npx jest account.service -t "updateEmail"`
Expected: failures because `updateEmail` not implemented.

- [ ] **Step 3: Implement `updateEmail`**

Append inside the `AccountService` class:

```ts
  async updateEmail(
    userId: string,
    userEmail: string,
    dto: { email: string },
  ): Promise<{ email: string; stripeSynced: boolean }> {
    const newEmail = dto.email.trim().toLowerCase();

    // Idempotent no-op: same email
    if (userEmail.toLowerCase() === newEmail) {
      return { email: newEmail, stripeSynced: false };
    }

    const client = this.supabase.getClient();

    // 1) Duplicidade (validation stage)
    try {
      const { data: list, error: listErr } = await client.auth.admin.listUsers({ email: newEmail } as any);
      if (listErr) throw new Error(listErr.message);
      const taken = list?.users?.find((u: any) => u.email?.toLowerCase() === newEmail && u.id !== userId);
      if (taken) {
        const msg = 'Este e-mail já está em uso';
        this.discord.logAccountChangeError({
          userId, userEmail, field: 'email',
          attempted: newEmail,
          errorMessage: msg,
          stage: 'validation',
        });
        throw new ConflictException(msg);
      }
    } catch (err: any) {
      if (err instanceof ConflictException) throw err;
      // listUsers itself failed — log and continue (Auth update is the real gate).
      this.logger.warn(`listUsers failed during email duplicity check: ${err?.message}`);
    }

    // 2) Auth update (mandatory)
    const { error: authErr } = await client.auth.admin.updateUserById(userId, {
      email: newEmail,
      email_confirm: true,
    } as any);
    if (authErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'email',
        attempted: newEmail,
        errorMessage: authErr.message,
        stage: 'auth',
      });
      throw new Error(`Failed to update auth email: ${authErr.message}`);
    }

    // 3) DB update (the trigger from migration 20260502170000 also covers this,
    //    but we update explicitly to keep response and downstream consistent).
    const { error: dbErr } = await client
      .from('profiles')
      .update({ email: newEmail, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    if (dbErr) {
      this.discord.logAccountChangeError({
        userId, userEmail, field: 'email',
        attempted: newEmail,
        errorMessage: dbErr.message,
        stage: 'profile',
      });
      throw new Error(`Failed to update profile email: ${dbErr.message}`);
    }

    // 4) Stripe (best-effort)
    const { data: sub } = await client
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    const customerId = sub?.stripe_customer_id ?? null;
    let stripeSynced = false;
    let hasCustomer = !!customerId;
    if (customerId) {
      try {
        await this.stripe.getClient().customers.update(customerId, { email: newEmail });
        stripeSynced = true;
      } catch (err: any) {
        this.logger.warn(`Stripe email sync failed for user ${userId}: ${err?.message}`);
        stripeSynced = false;
      }
    }

    // 5) Revoke sessions (best-effort but loud)
    try {
      await (client.auth.admin as any).signOut(userId, 'global');
    } catch (err: any) {
      this.logger.warn(`signOut(global) failed for user ${userId}: ${err?.message}`);
    }

    const successPayload: any = {
      userId, userEmail, field: 'email',
      before: userEmail, after: newEmail,
    };
    if (hasCustomer) successPayload.stripeSynced = stripeSynced;
    this.discord.logAccountChangeSuccess(successPayload);

    return { email: newEmail, stripeSynced };
  }
```

- [ ] **Step 4: Run test, expect pass**

Run: `cd packages/backend && npx jest account.service -t "updateEmail"`
Expected: all 5 tests pass.

- [ ] **Step 5: Run full backend test suite (smoke)**

Run: `cd packages/backend && npx jest`
Expected: no regressions.

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/account/account.service.ts \
        packages/backend/src/modules/account/__tests__/account.service.spec.ts
git commit -m "feat(account): PATCH /me/email with Auth+DB+Stripe sync and global signOut"
```

---

## Phase 3 — Frontend: hooks + components + screen

### Task 9: Frontend mutation hooks

**Files:**
- Create: `packages/frontend/src/hooks/useUpdateProfile.ts`
- Create: `packages/frontend/src/hooks/useUpdateTaxId.ts`
- Create: `packages/frontend/src/hooks/useUpdateEmail.ts`
- Create: `packages/frontend/src/hooks/useUpdatePassword.ts`

- [ ] **Step 1: Create `useUpdateProfile.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function useUpdateProfile() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { name: string }) =>
      api.patch<{ name: string }>('/me/profile', input),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast({ title: 'Nome atualizado' });
    },
    onError: (err: any) => {
      toast({
        title: 'Não foi possível atualizar',
        description: err?.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 2: Create `useUpdateTaxId.ts`**

```ts
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';
import { TaxIdType } from '@/lib/tax-id';

export function useUpdateTaxId() {
  const qc = useQueryClient();
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { type: TaxIdType; value: string }) =>
      api.patch<{ type: TaxIdType; value: string; stripeSynced: boolean }>('/me/tax-id', input),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['profile'] });
      toast({
        title: 'Documento atualizado',
        description: data.stripeSynced
          ? undefined
          : 'Sincronização com Stripe pendente — tentaremos novamente em breve.',
      });
    },
    onError: (err: any) => {
      toast({
        title: 'Não foi possível atualizar',
        description: err?.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 3: Create `useUpdateEmail.ts`**

```ts
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useUpdateEmail() {
  return useMutation({
    mutationFn: (input: { email: string }) =>
      api.patch<{ email: string; stripeSynced: boolean }>('/me/email', input),
  });
}
```

(Toast and signOut handled in the row component because the success effect is destructive — page redirect.)

- [ ] **Step 4: Create `useUpdatePassword.ts`**

```ts
import { useMutation } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export function useUpdatePassword() {
  const { toast } = useToast();
  return useMutation({
    mutationFn: (input: { password: string }) =>
      api.patch<{ ok: true }>('/me/password', input),
    onSuccess: () => {
      toast({ title: 'Senha alterada' });
    },
    onError: (err: any) => {
      toast({
        title: 'Não foi possível alterar a senha',
        description: err?.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
    },
  });
}
```

- [ ] **Step 5: Verify type compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useUpdateProfile.ts \
        packages/frontend/src/hooks/useUpdateTaxId.ts \
        packages/frontend/src/hooks/useUpdateEmail.ts \
        packages/frontend/src/hooks/useUpdatePassword.ts
git commit -m "feat(profile): mutation hooks for /me/* endpoints"
```

---

### Task 10: `EditableRow` primitive

**Files:**
- Create: `packages/frontend/src/components/profile/EditableRow.tsx`

- [ ] **Step 1: Write component**

```tsx
import { ReactNode, useState, useEffect, useRef } from 'react';
import { Button } from '@/components/ui/button';
import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

interface EditableRowProps {
  label: string;
  view: ReactNode;
  triggerLabel?: string;             // default "Editar"
  editForm: (helpers: { close: () => void }) => ReactNode;
  onSave: () => Promise<void> | void;
  onCancel?: () => void;
  saving?: boolean;
  saveLabel?: string;                 // default "Salvar"
  saveDisabled?: boolean;
  locked?: boolean;                   // hides the edit trigger
  lockedLabel?: string;               // chip label, e.g. "Bloqueado"
}

export function EditableRow(props: EditableRowProps) {
  const [editing, setEditing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  function close() {
    setEditing(false);
    props.onCancel?.();
  }

  async function handleSave() {
    try {
      await props.onSave();
      setEditing(false);
    } catch {
      // Toast handled by mutation hook; stay in edit mode.
    }
  }

  // ESC to cancel
  useEffect(() => {
    if (!editing) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') close();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editing]);

  return (
    <div
      ref={containerRef}
      className={cn(
        'border-b border-white/5 py-4 last:border-b-0 transition-colors',
        editing && 'bg-[#d1fe17]/5 -mx-3 px-3 rounded-xl border-b-transparent',
      )}
    >
      <div className="text-[11px] font-medium text-muted-foreground uppercase tracking-[0.06em] mb-1.5">
        {props.label}
      </div>

      {!editing ? (
        <div className="flex items-center justify-between gap-4 min-h-[28px]">
          <div className="flex-1">{props.view}</div>
          {props.locked ? (
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground px-2.5 py-1 rounded-full bg-white/[0.03] border border-white/[0.06]">
              {props.lockedLabel ?? 'Bloqueado'}
            </span>
          ) : (
            <Button
              size="sm"
              variant="ghost"
              className="text-[#d1fe17] hover:text-[#d1fe17] hover:bg-[#d1fe17]/[0.08]"
              onClick={() => setEditing(true)}
            >
              {props.triggerLabel ?? 'Editar'}
            </Button>
          )}
        </div>
      ) : (
        <div className="space-y-3 pt-1">
          {props.editForm({ close })}
          <div className="flex gap-2">
            <Button size="sm" onClick={handleSave} disabled={props.saveDisabled || props.saving}>
              {props.saving && <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />}
              {props.saveLabel ?? 'Salvar'}
            </Button>
            <Button size="sm" variant="ghost" onClick={close} disabled={props.saving}>
              Cancelar
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/profile/EditableRow.tsx
git commit -m "feat(profile): EditableRow primitive with view/edit toggle"
```

---

### Task 11: Row implementations (Name / Email / TaxId / Password)

**Files:**
- Create: `packages/frontend/src/components/profile/rows/NameRow.tsx`
- Create: `packages/frontend/src/components/profile/rows/EmailRow.tsx` (skeleton — modal flow added in Task 12)
- Create: `packages/frontend/src/components/profile/rows/TaxIdRow.tsx`
- Create: `packages/frontend/src/components/profile/rows/PasswordRow.tsx`

- [ ] **Step 1: NameRow**

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableRow } from '../EditableRow';
import { useUpdateProfile } from '@/hooks/useUpdateProfile';

export function NameRow({ name }: { name: string }) {
  const [draft, setDraft] = useState(name);
  const mutation = useUpdateProfile();

  return (
    <EditableRow
      label="Nome completo"
      view={<div className="text-[15px] font-medium">{name || '—'}</div>}
      saving={mutation.isPending}
      saveDisabled={!draft.trim()}
      onCancel={() => setDraft(name)}
      onSave={() => mutation.mutateAsync({ name: draft.trim() })}
      editForm={() => (
        <div className="space-y-1.5">
          <Label htmlFor="profile-name">Nome completo</Label>
          <Input
            id="profile-name"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            autoFocus
          />
        </div>
      )}
    />
  );
}
```

- [ ] **Step 2: EmailRow (skeleton — modal flow injected in Task 12)**

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableRow } from '../EditableRow';
import { ConfirmEmailChangeDialog } from '../ConfirmEmailChangeDialog';

export function EmailRow({ email }: { email: string }) {
  const [draft, setDraft] = useState(email);
  const [confirming, setConfirming] = useState(false);

  return (
    <>
      <EditableRow
        label="E-mail"
        view={
          <div>
            <div className="text-[15px] font-medium">{email}</div>
            <div className="text-xs text-muted-foreground mt-1">
              Alterar o e-mail desconecta sua conta automaticamente.
            </div>
          </div>
        }
        saveLabel="Salvar"
        saveDisabled={!draft.trim() || draft.trim().toLowerCase() === email.toLowerCase()}
        onCancel={() => setDraft(email)}
        onSave={async () => {
          // Open the confirmation dialog instead of submitting directly.
          setConfirming(true);
        }}
        editForm={() => (
          <div className="space-y-1.5">
            <Label htmlFor="profile-email">Novo e-mail</Label>
            <Input
              id="profile-email"
              type="email"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              autoFocus
            />
          </div>
        )}
      />
      <ConfirmEmailChangeDialog
        open={confirming}
        currentEmail={email}
        newEmail={draft.trim()}
        onCancel={() => setConfirming(false)}
      />
    </>
  );
}
```

- [ ] **Step 3: TaxIdRow**

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group';
import { EditableRow } from '../EditableRow';
import { useUpdateTaxId } from '@/hooks/useUpdateTaxId';
import { formatTaxId, isValidTaxId, stripDigits, TaxIdType } from '@/lib/tax-id';

interface Props {
  initialType: TaxIdType;
  initialValue: string; // digits-only
}

export function TaxIdRow({ initialType, initialValue }: Props) {
  const [type, setType] = useState<TaxIdType>(initialType);
  const [value, setValue] = useState<string>(formatTaxId(initialType, initialValue));
  const mutation = useUpdateTaxId();

  const isValid = isValidTaxId(type, value);
  const formatted = initialValue
    ? `${initialType === 'cpf' ? 'CPF' : 'CNPJ'} · ${formatTaxId(initialType, initialValue)}`
    : '—';

  return (
    <EditableRow
      label="Documento"
      view={
        <div>
          <div className="text-[15px] font-medium">{formatted}</div>
          <div className="text-xs text-muted-foreground mt-1">
            {initialType === 'cpf' ? 'Pessoa física' : 'Empresa'} — usado em recibos e faturas.
          </div>
        </div>
      }
      saving={mutation.isPending}
      saveDisabled={!isValid}
      onCancel={() => {
        setType(initialType);
        setValue(formatTaxId(initialType, initialValue));
      }}
      onSave={() => mutation.mutateAsync({ type, value: stripDigits(value) })}
      editForm={() => (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label>Tipo de documento</Label>
            <RadioGroup
              value={type}
              onValueChange={(v) => {
                setType(v as TaxIdType);
                setValue('');
              }}
              className="flex gap-6"
            >
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="cpf" id="tax-cpf" />
                <span className="text-sm">CPF</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <RadioGroupItem value="cnpj" id="tax-cnpj" />
                <span className="text-sm">CNPJ</span>
              </label>
            </RadioGroup>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="profile-tax-id">{type === 'cpf' ? 'CPF' : 'CNPJ'}</Label>
            <Input
              id="profile-tax-id"
              inputMode="numeric"
              autoFocus
              placeholder={type === 'cpf' ? '000.000.000-00' : '00.000.000/0000-00'}
              value={value}
              onChange={(e) => setValue(formatTaxId(type, e.target.value))}
            />
            {value && !isValid && (
              <p className="text-xs text-destructive">
                {type === 'cpf' ? 'CPF inválido' : 'CNPJ inválido'}
              </p>
            )}
          </div>
        </div>
      )}
    />
  );
}
```

- [ ] **Step 4: PasswordRow**

```tsx
import { useState } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { EditableRow } from '../EditableRow';
import { useUpdatePassword } from '@/hooks/useUpdatePassword';

export function PasswordRow() {
  const [pwd, setPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const mutation = useUpdatePassword();

  const mismatch = confirm.length > 0 && confirm !== pwd;
  const tooShort = pwd.length > 0 && pwd.length < 8;
  const canSave = pwd.length >= 8 && pwd === confirm;

  return (
    <EditableRow
      label="Senha"
      triggerLabel="Alterar senha"
      saveLabel="Salvar nova senha"
      saving={mutation.isPending}
      saveDisabled={!canSave}
      onCancel={() => { setPwd(''); setConfirm(''); }}
      onSave={async () => {
        await mutation.mutateAsync({ password: pwd });
        setPwd(''); setConfirm('');
      }}
      view={
        <div>
          <div className="text-[15px] font-medium text-muted-foreground">••••••••••••</div>
        </div>
      }
      editForm={() => (
        <div className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="new-pwd">Nova senha</Label>
            <Input
              id="new-pwd"
              type="password"
              autoFocus
              value={pwd}
              onChange={(e) => setPwd(e.target.value)}
              placeholder="Mínimo 8 caracteres"
            />
            {tooShort && <p className="text-xs text-destructive">Mínimo 8 caracteres</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirm-pwd">Confirmar nova senha</Label>
            <Input
              id="confirm-pwd"
              type="password"
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
            />
            {mismatch && <p className="text-xs text-destructive">As senhas não coincidem</p>}
          </div>
        </div>
      )}
    />
  );
}
```

- [ ] **Step 5: Verify compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: failures only on `ConfirmEmailChangeDialog` import (created in Task 12). Other rows compile.

- [ ] **Step 6: Commit (defer EmailRow — depends on dialog)**

```bash
git add packages/frontend/src/components/profile/rows/NameRow.tsx \
        packages/frontend/src/components/profile/rows/TaxIdRow.tsx \
        packages/frontend/src/components/profile/rows/PasswordRow.tsx \
        packages/frontend/src/components/profile/rows/EmailRow.tsx
git commit -m "feat(profile): NameRow, TaxIdRow, PasswordRow, EmailRow skeleton"
```

---

### Task 12: ConfirmEmailChangeDialog + signOut redirect

**Files:**
- Create: `packages/frontend/src/components/profile/ConfirmEmailChangeDialog.tsx`

- [ ] **Step 1: Write the dialog**

```tsx
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { Loader2 } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useUpdateEmail } from '@/hooks/useUpdateEmail';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';

interface Props {
  open: boolean;
  currentEmail: string;
  newEmail: string;
  onCancel: () => void;
}

export function ConfirmEmailChangeDialog({ open, currentEmail, newEmail, onCancel }: Props) {
  const mutation = useUpdateEmail();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { toast } = useToast();
  const [running, setRunning] = useState(false);

  async function handleConfirm() {
    setRunning(true);
    try {
      await mutation.mutateAsync({ email: newEmail });
      toast({
        title: 'E-mail alterado',
        description: `Faça login novamente com ${newEmail}.`,
      });
      // Tear down the local session and redirect.
      await supabase.auth.signOut();
      qc.clear();
      navigate(`/login?email_changed=1`, { replace: true });
    } catch (err: any) {
      toast({
        title: 'Não foi possível alterar o e-mail',
        description: err?.message ?? 'Tente novamente.',
        variant: 'destructive',
      });
    } finally {
      setRunning(false);
    }
  }

  return (
    <AlertDialog open={open}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Confirmar troca de e-mail</AlertDialogTitle>
          <AlertDialogDescription className="space-y-3">
            <p>
              Vamos alterar seu e-mail de <strong>{currentEmail}</strong> para{' '}
              <strong>{newEmail}</strong>.
            </p>
            <p>
              Após confirmar, você vai ser <strong>deslogado</strong> e precisará fazer login
              novamente com o novo e-mail.
            </p>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={running} onClick={onCancel}>
            Cancelar
          </AlertDialogCancel>
          <AlertDialogAction disabled={running} onClick={handleConfirm}>
            {running && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Confirmar troca
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/profile/ConfirmEmailChangeDialog.tsx
git commit -m "feat(profile): ConfirmEmailChangeDialog with global signOut redirect"
```

---

### Task 13: ProfileCard

**Files:**
- Create: `packages/frontend/src/components/profile/ProfileCard.tsx`

- [ ] **Step 1: Write component**

```tsx
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/contexts/AuthContext';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { NameRow } from './rows/NameRow';
import { EmailRow } from './rows/EmailRow';
import { TaxIdRow } from './rows/TaxIdRow';
import { PasswordRow } from './rows/PasswordRow';

interface ProfileRow {
  name: string | null;
  email: string | null;
  cpf: string | null;
  cnpj: string | null;
}

function getInitials(name: string): string {
  return name.split(' ').map((n) => n[0]).join('').toUpperCase().slice(0, 2);
}

export function ProfileCard() {
  const { user } = useAuth();

  const { data, isLoading } = useQuery<ProfileRow | null>({
    queryKey: ['profile', user?.id],
    enabled: !!user?.id,
    staleTime: 30_000,
    queryFn: async () => {
      const { data, error } = await supabase
        .from('profiles')
        .select('name, email, cpf, cnpj')
        .eq('user_id', user!.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
  });

  if (isLoading || !data) {
    return (
      <Card>
        <CardContent className="py-10 text-center text-sm text-muted-foreground">
          Carregando…
        </CardContent>
      </Card>
    );
  }

  const taxIdType = data.cnpj ? 'cnpj' : 'cpf';
  const taxIdValue = data.cnpj ?? data.cpf ?? '';

  return (
    <Card>
      <CardHeader>
        <CardTitle>Perfil</CardTitle>
        <CardDescription>
          Suas informações pessoais e segurança da conta. Clique em Editar para alterar um item.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        <div className="flex items-center gap-4">
          <Avatar className="h-20 w-20">
            <AvatarFallback className="bg-primary text-primary-foreground text-2xl">
              {data.name ? getInitials(data.name) : 'U'}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1">
            <div className="text-base font-semibold tracking-tight">{data.name || '—'}</div>
            <div className="text-sm text-muted-foreground mt-0.5">{data.email}</div>
          </div>
          <Button variant="outline" disabled>Alterar foto</Button>
        </div>

        <div className="flex flex-col">
          <NameRow name={data.name ?? ''} />
          <EmailRow email={data.email ?? ''} />
          <TaxIdRow initialType={taxIdType} initialValue={taxIdValue} />
          <PasswordRow />
        </div>
      </CardContent>
    </Card>
  );
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/profile/ProfileCard.tsx
git commit -m "feat(profile): ProfileCard with editable rows"
```

---

### Task 14: Wire ProfileCard into Settings.tsx (remove Security tab)

**Files:**
- Modify: `packages/frontend/src/pages/Settings.tsx`

- [ ] **Step 1: Replace Settings.tsx content**

Overwrite `packages/frontend/src/pages/Settings.tsx`:

```tsx
import { useState } from 'react';
import { DashboardLayout } from '@/components/DashboardLayout';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Plus, Trash2 } from 'lucide-react';
import { useCompanyCosts } from '@/hooks/useCompanyCosts';
import { PlanUsageCard } from '@/components/PlanUsageCard';
import { CurrentPlanCard } from '@/components/PlanTab/CurrentPlanCard';
import { PlanCards } from '@/components/PlanTab/PlanCards';
import { CheckoutReturnHandler } from '@/components/PlanTab/CheckoutReturnHandler';
import { PaymentMethodsCard } from '@/components/PlanTab/PaymentMethodsCard';
import { InvoicesCard } from '@/components/PlanTab/InvoicesCard';
import { ProfileCard } from '@/components/profile/ProfileCard';

export default function Settings() {
  const { costs, addCost, removeCost } = useCompanyCosts();
  const [newCostName, setNewCostName] = useState('');
  const [newCostType, setNewCostType] = useState<'percentage' | 'fixed'>('percentage');
  const [newCostValue, setNewCostValue] = useState('');

  const handleAddCost = () => {
    if (!newCostName || !newCostValue) return;
    addCost(newCostName, newCostType, parseFloat(newCostValue));
    setNewCostName('');
    setNewCostValue('');
  };

  return (
    <DashboardLayout>
      <div className="space-y-6 animate-sentinel-in">
        <div>
          <h1 className="text-xl font-semibold text-white">Configurações</h1>
          <p className="text-sm text-[#a1a4a5]/70 mt-1">Gerencie sua conta e preferências</p>
        </div>

        <Tabs defaultValue="profile" className="space-y-6">
          <TabsList>
            <TabsTrigger value="profile">Perfil</TabsTrigger>
            <TabsTrigger value="plan">Plano</TabsTrigger>
            <TabsTrigger value="taxes">Custos</TabsTrigger>
          </TabsList>

          <TabsContent value="profile">
            <ProfileCard />
          </TabsContent>

          <TabsContent value="plan">
            <div className="space-y-6">
              <CheckoutReturnHandler />
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.3fr_1fr]">
                <CurrentPlanCard />
                <PlanUsageCard />
              </div>
              <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
                <PaymentMethodsCard />
                <InvoicesCard />
              </div>
              <PlanCards />
            </div>
          </TabsContent>

          <TabsContent value="taxes">
            <Card>
              <CardHeader>
                <CardTitle>Custos da Empresa</CardTitle>
                <CardDescription>
                  Configure custos que serão descontados do faturamento bruto
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-6">
                <div className="space-y-3">
                  {costs.map((cost) => (
                    <div
                      key={cost.id}
                      className="flex items-center justify-between rounded-lg border border-white/5 p-4"
                    >
                      <div>
                        <p className="font-medium">{cost.name}</p>
                        <p className="text-sm text-muted-foreground">
                          {cost.type === 'percentage'
                            ? `${cost.value}% do faturamento`
                            : `R$ ${cost.value.toFixed(2)} fixo`}
                        </p>
                      </div>
                      <Button variant="ghost" size="icon" onClick={() => removeCost(cost.id)}>
                        <Trash2 className="h-4 w-4 text-[#a1a4a5]/60" />
                      </Button>
                    </div>
                  ))}
                </div>

                <div className="border-t border-white/5 pt-6">
                  <h4 className="mb-4 font-medium">Adicionar novo custo</h4>
                  <div className="grid gap-4 sm:grid-cols-4">
                    <div className="space-y-2">
                      <Label>Nome</Label>
                      <Input
                        placeholder="Ex: Taxa Gateway"
                        value={newCostName}
                        onChange={(e) => setNewCostName(e.target.value)}
                      />
                    </div>
                    <div className="space-y-2">
                      <Label>Tipo</Label>
                      <select
                        className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                        value={newCostType}
                        onChange={(e) => setNewCostType(e.target.value as 'percentage' | 'fixed')}
                      >
                        <option value="percentage">Percentual</option>
                        <option value="fixed">Valor Fixo</option>
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label>Valor</Label>
                      <Input
                        type="number"
                        placeholder={newCostType === 'percentage' ? '10' : '50.00'}
                        value={newCostValue}
                        onChange={(e) => setNewCostValue(e.target.value)}
                      />
                    </div>
                    <div className="flex items-end">
                      <Button onClick={handleAddCost} className="w-full">
                        <Plus className="mr-2 h-4 w-4" />
                        Adicionar
                      </Button>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </DashboardLayout>
  );
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/pages/Settings.tsx
git commit -m "feat(settings): unify Profile + Security into single Profile tab"
```

---

### Task 15: Login banner for `?email_changed=1`

**Files:**
- Modify: `packages/frontend/src/pages/Login.tsx`

- [ ] **Step 1: Add banner**

Open `packages/frontend/src/pages/Login.tsx`. At the top of the component, add:

```tsx
import { useSearchParams } from 'react-router-dom';
```

Inside the component, add (right after existing hooks):

```tsx
const [searchParams, setSearchParams] = useSearchParams();
const emailChanged = searchParams.get('email_changed') === '1';
```

Right before the form (or wherever the layout has space at the top of the card), insert:

```tsx
{emailChanged && (
  <div
    className="mb-4 rounded-md border border-[#d1fe17]/30 bg-[#d1fe17]/10 px-4 py-3 text-sm"
    role="status"
  >
    <p className="font-medium text-[#d1fe17]">Seu e-mail foi alterado.</p>
    <p className="text-muted-foreground mt-1">
      Use o <strong>novo endereço</strong> para entrar.
    </p>
  </div>
)}
```

After successful login (in the success branch of `handleSubmit`), clear the param:

```tsx
if (emailChanged) {
  setSearchParams({}, { replace: true });
}
```

- [ ] **Step 2: Verify compiles**

Run: `cd packages/frontend && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Manual check via dev server**

Run: `npm run dev`
Open `http://localhost:5173/login?email_changed=1`. Expected: green banner visible.

- [ ] **Step 4: Commit**

```bash
git add packages/frontend/src/pages/Login.tsx
git commit -m "feat(login): show banner when redirected from email change"
```

---

## Phase 4 — Manual end-to-end + docs

### Task 16: End-to-end manual smoke test

**Files:** none (manual verification)

- [ ] **Step 1: Start dev servers**

Run: `npm run dev`
Wait until both Vite (`:5173`) and NestJS (`:3001`) are listening.

- [ ] **Step 2: Edit name**

1. Login → Settings → Perfil.
2. Click Editar next to Nome → change → Salvar.
3. Expect: toast "Nome atualizado", display updates, Discord channel `accountChanges` shows green embed `Nome` De/Para.

- [ ] **Step 3: Edit CPF→CNPJ for a paid user**

1. Click Editar next to Documento → toggle CNPJ → enter valid CNPJ (e.g. `12.345.678/0001-90`) → Salvar.
2. Expect: toast "Documento atualizado", display shows CNPJ, Discord embed green with Stripe ✅.
3. Verify in Stripe dashboard that the customer now has tax_id `br_cnpj` and the old `br_cpf` is gone.

- [ ] **Step 4: Edit CPF for a free user (no Stripe customer)**

Use a user without `stripe_customer_id`. Same as above but Discord embed should NOT show the Stripe field.

- [ ] **Step 5: Edit email (full flow)**

1. Click Editar next to E-mail → enter new e-mail → Salvar.
2. Modal opens. Click Confirmar troca.
3. Expect: toast "E-mail alterado", redirect to `/login?email_changed=1`, banner visible.
4. Login with new e-mail succeeds; with old e-mail fails.
5. Verify `auth.users.email`, `profiles.email`, and Stripe `customer.email` all match.

- [ ] **Step 6: Edit password**

Same flow; verify the new password works on next login.

- [ ] **Step 7: Sad paths**

- Invalid CPF (`111.111.111-11`) → submit blocked, error message visible.
- Email already in use by another account → toast "Este e-mail já está em uso", Discord embed red `validation`.
- Stop the backend mid-save (network error) → toast destructive shows up.

- [ ] **Step 8: No commit (manual step)**

If anything misbehaves, fix the responsible task before continuing.

---

### Task 17: Update feature documentation

**Files:**
- Modify: `docs/features/10-settings/settings.md`
- Modify: `docs/features/13-discord-logs/` (whatever file exists; or create `account-changes.md`)

- [ ] **Step 1: Update `docs/features/10-settings/settings.md`**

Replace the existing Profile/Security section with:

```markdown
## Aba Perfil (unificada)

A aba "Perfil" é a única página de edição de dados da conta. A aba "Segurança"
foi removida em maio/2026 e seu conteúdo (alterar senha) foi incorporado aqui.

### Itens editáveis

Cada item aparece em modo leitura. Clicar em **Editar** abre o formulário inline
do item. Apenas um item edita por vez.

| Item | Endpoint | Sincroniza com |
|---|---|---|
| Nome | `PATCH /api/me/profile` | — |
| E-mail | `PATCH /api/me/email` | Supabase Auth + Stripe (via `stripe_customer_id`) |
| Documento (CPF/CNPJ) | `PATCH /api/me/tax-id` | Stripe `customers.taxIds` + `customers.metadata` |
| Senha | `PATCH /api/me/password` | Supabase Auth |

### Fluxo especial — troca de e-mail

1. Usuário digita novo e-mail e clica **Salvar**.
2. Modal de confirmação mostra `<email atual>` → `<email novo>` e avisa que vai deslogar.
3. Confirmar dispara `PATCH /api/me/email`. O backend:
   - Atualiza `auth.users.email` (com `email_confirm: true`)
   - Atualiza `profiles.email`
   - Atualiza `stripe.customers.email` (best-effort)
   - Revoga todas as sessões com `auth.admin.signOut(userId, 'global')`
4. Frontend faz `supabase.auth.signOut()` e redireciona para `/login?email_changed=1`.
5. `/login` exibe banner verde "Seu e-mail foi alterado. Use o novo endereço."

### Validação CPF/CNPJ

Reusa `packages/frontend/src/lib/tax-id.ts` (espelho de `packages/backend/src/shared/helpers/tax-id.ts`).
Backend é autoritativo — frontend é só feedback rápido.

### Logs Discord

Toda mudança bem-sucedida emite embed verde no canal `accountChanges`. Erros
de operação (validação, conflito de unicidade, falha Auth/DB) emitem embed
vermelho com `stage`. Falhas parciais de Stripe não geram embed vermelho —
ficam representadas como `⚠️ Stripe pendente` no embed verde de sucesso.
```

- [ ] **Step 2: Document the new Discord channel**

Create `docs/features/13-discord-logs/account-changes.md` (or append if a similar file exists):

```markdown
# Canal `accountChanges`

Logs estruturados de mudanças no perfil do usuário (nome, e-mail, CPF/CNPJ, senha),
disparados pelos endpoints `PATCH /api/me/*`.

## Embed verde — sucesso

```
✏️ Conta alterada
👤 Usuário      <email>
🆔 ID            <user_id>
🔧 Campo        Nome | E-mail | Documento (CPF/CNPJ) | Senha
↩️ De             <valor antigo>      (omitido em senha)
↪️ Para           <valor novo>        (omitido em senha)
☁️ Stripe        ✅ sincronizado | ⚠️ pendente   (apenas em e-mail e tax_id quando há customer)
🕐 Horário      <iso>
```

Para `field=password`, exibe apenas "Senha alterada" — nunca o valor.

## Embed vermelho — erro

```
❌ Falha ao alterar conta
👤 Usuário      <email>
🆔 ID            <user_id>
🔧 Campo        ...
🎯 Tentou       <valor tentado>     (omitido em senha)
🪜 Etapa        validation | auth | profile
📋 Motivo       <mensagem do erro>
🕐 Horário      <iso>
```

Falhas de Stripe / revoke_sessions não aparecem como embed vermelho — são
representadas como `⚠️ Stripe pendente` no embed verde de sucesso, e o
detalhe técnico vai para o log do servidor (Logger Nest).

## Origem

`packages/backend/src/shared/services/discord-logger.service.ts`
- `logAccountChangeSuccess(data)`
- `logAccountChangeError(data)`

URL configurada em `packages/backend/src/config/discord-webhooks.config.ts` sob a chave `accountChanges`.
```

- [ ] **Step 3: Commit**

```bash
git add docs/features/10-settings/settings.md docs/features/13-discord-logs/account-changes.md
git commit -m "docs: settings/profile unify + accountChanges Discord channel"
```

---

## Self-Review (run before declaring done)

- [ ] **Spec coverage:**
  - [ ] §5 (Frontend): Tasks 9–15 ✓
  - [ ] §6 (Backend endpoints): Tasks 4–8 ✓
  - [ ] §7 (DB trigger): Task 3 ✓
  - [ ] §8 (Discord): Tasks 1, 2 ✓
  - [ ] §9 (Docs): Task 17 ✓

- [ ] **Placeholder scan:** All steps have concrete code. No "TODO/TBD". Migration timestamp is hard-coded.

- [ ] **Type consistency:**
  - `AccountChangeSuccessData` / `AccountChangeErrorData` defined in Task 2 and used by Tasks 5–8.
  - `EditableRow` props (`view`, `editForm`, `onSave`, `triggerLabel`, `saveLabel`, `saveDisabled`, `locked`) used consistently across NameRow/EmailRow/TaxIdRow/PasswordRow.
  - `useUpdateTaxId` returns `{ type, value, stripeSynced }` matching backend return type.

- [ ] **Risks documented in spec §11 are mitigated:**
  - Concurrent PATCH on `profiles`: idempotency check covers happy path; full `SELECT FOR UPDATE` is implicit through PostgREST single-row update — acceptable for now (low conflict rate; tasks 7 and 8 update one row each).
  - Stripe drift: Tests in Task 7 (`returns stripeSynced=false when Stripe call fails`) and Task 8 (`returns stripeSynced=false when Stripe update fails`) cover the path.
  - `email_confirm: true` skip: documented in Task 8 step 3 inline comment and in spec §11.
