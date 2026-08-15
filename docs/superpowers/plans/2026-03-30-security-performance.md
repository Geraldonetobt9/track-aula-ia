# Security & Performance Improvements — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Harden security and optimize performance across the Sentinela monorepo without changing business logic.

**Architecture:** Five sequential phases — critical security (DTOs, ownership, webhook auth), medium security (rate limiting, headers, health check), backend performance (explicit selects, N+1 fixes, async webhooks, caching), frontend performance (staleTime, debounce, memoization, chunks), and database performance (indexes, BRIN, cursor pagination).

**Tech Stack:** NestJS 10 + Fastify, React 18 + Vite + TanStack Query, Supabase PostgreSQL, class-validator, @nestjs/throttler

**Spec:** `docs/superpowers/specs/2026-03-30-security-performance-design.md`

---

## Phase 1 — Security Critical

### Task 1: Install validation dependencies and configure global ValidationPipe

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/backend/src/main.ts`

- [ ] **Step 1: Install class-validator and class-transformer**

```bash
cd packages/backend && npm install class-validator class-transformer
```

- [ ] **Step 2: Add global ValidationPipe to main.ts**

In `packages/backend/src/main.ts`, add the import and pipe configuration:

```typescript
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { ValidationPipe } from '@nestjs/common';
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
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
```

- [ ] **Step 3: Verify the backend still starts**

```bash
cd packages/backend && npm run build
```

Expected: Build succeeds with no errors.

- [ ] **Step 4: Commit**

```bash
git add packages/backend/package.json packages/backend/package-lock.json packages/backend/src/main.ts
git commit -m "feat(backend): add global ValidationPipe with class-validator"
```

---

### Task 2: Create DTOs for Workspaces module

**Files:**
- Create: `packages/backend/src/modules/workspaces/dto/create-workspace.dto.ts`
- Create: `packages/backend/src/modules/workspaces/dto/add-connection.dto.ts`
- Create: `packages/backend/src/modules/workspaces/dto/add-checkout.dto.ts`
- Create: `packages/backend/src/modules/workspaces/dto/set-products.dto.ts`
- Modify: `packages/backend/src/modules/workspaces/workspaces.controller.ts`

- [ ] **Step 1: Create workspace DTOs**

`packages/backend/src/modules/workspaces/dto/create-workspace.dto.ts`:
```typescript
import { IsString, MinLength } from 'class-validator';

export class CreateWorkspaceDto {
  @IsString()
  @MinLength(1)
  name: string;
}
```

`packages/backend/src/modules/workspaces/dto/add-connection.dto.ts`:
```typescript
import { IsUUID } from 'class-validator';

export class AddConnectionDto {
  @IsUUID()
  facebook_connection_id: string;
}
```

`packages/backend/src/modules/workspaces/dto/add-checkout.dto.ts`:
```typescript
import { IsUUID } from 'class-validator';

export class AddCheckoutDto {
  @IsUUID()
  checkout_integration_id: string;
}
```

`packages/backend/src/modules/workspaces/dto/set-products.dto.ts`:
```typescript
import { IsArray, IsString, ArrayMinSize } from 'class-validator';

export class SetProductsDto {
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(0)
  product_names: string[];
}
```

- [ ] **Step 2: Update workspaces controller to use DTOs**

Replace the controller in `packages/backend/src/modules/workspaces/workspaces.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { WorkspacesService } from './workspaces.service';
import { CreateWorkspaceDto } from './dto/create-workspace.dto';
import { AddConnectionDto } from './dto/add-connection.dto';
import { AddCheckoutDto } from './dto/add-checkout.dto';
import { SetProductsDto } from './dto/set-products.dto';

@Controller('workspaces')
@UseGuards(AuthGuard)
export class WorkspacesController {
  constructor(private readonly workspacesService: WorkspacesService) {}

  @Get()
  list(
    @CurrentUser('id') userId: string,
    @Query('target_user_id') targetUserId?: string,
  ) {
    return this.workspacesService.list(userId, targetUserId);
  }

  @Post()
  create(
    @CurrentUser('id') userId: string,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.create(userId, dto.name);
  }

  @Patch(':id')
  update(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CreateWorkspaceDto,
  ) {
    return this.workspacesService.update(userId, id, dto.name);
  }

  @Delete(':id')
  remove(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.workspacesService.remove(userId, id);
  }

  @Post(':id/connections')
  addConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Body() dto: AddConnectionDto,
  ) {
    return this.workspacesService.addConnection(userId, workspaceId, dto.facebook_connection_id);
  }

  @Delete(':id/connections/:connId')
  removeConnection(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('connId', ParseUUIDPipe) connId: string,
  ) {
    return this.workspacesService.removeConnection(userId, workspaceId, connId);
  }

  @Post(':id/checkouts')
  addCheckout(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Body() dto: AddCheckoutDto,
  ) {
    return this.workspacesService.addCheckout(userId, workspaceId, dto.checkout_integration_id);
  }

  @Delete(':id/checkouts/:checkoutId')
  removeCheckout(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Param('checkoutId', ParseUUIDPipe) checkoutId: string,
  ) {
    return this.workspacesService.removeCheckout(userId, workspaceId, checkoutId);
  }

  @Post(':id/products')
  setProducts(
    @CurrentUser('id') userId: string,
    @Param('id', ParseUUIDPipe) workspaceId: string,
    @Body() dto: SetProductsDto,
  ) {
    return this.workspacesService.setProducts(userId, workspaceId, dto.product_names);
  }
}
```

Note: All destructive endpoints now pass `userId` for ownership validation (Task 3 implements the service side).

- [ ] **Step 3: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/workspaces/
git commit -m "feat(workspaces): add DTOs with class-validator for input validation"
```

---

### Task 3: Add workspace ownership validation to service

**Files:**
- Modify: `packages/backend/src/modules/workspaces/workspaces.service.ts`

- [ ] **Step 1: Add private ownership check method and update all destructive methods**

Replace `packages/backend/src/modules/workspaces/workspaces.service.ts`:

```typescript
import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';

@Injectable()
export class WorkspacesService {
  constructor(private readonly supabase: SupabaseService) {}

  private async verifyOwnership(userId: string, workspaceId: string): Promise<void> {
    const { data } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!data) {
      throw new ForbiddenException('Workspace not found or access denied');
    }
  }

  async list(userId: string, targetUserId?: string) {
    const effectiveUserId = targetUserId ?? userId;

    if (targetUserId && targetUserId !== userId) {
      const isAdmin = await this.supabase.isAdmin(userId);
      if (!isAdmin) {
        throw new ForbiddenException('Admin access required');
      }
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select(
        '*, workspace_connections(*), workspace_checkout_integrations(*), workspace_products(*)',
      )
      .eq('user_id', effectiveUserId)
      .order('created_at', { ascending: true });

    if (error) throw error;
    return data;
  }

  async create(userId: string, name: string) {
    if (!name) {
      throw new BadRequestException('name is required');
    }

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .insert({ user_id: userId, name })
      .select()
      .single();

    if (error) throw error;
    return data;
  }

  async update(userId: string, workspaceId: string, name: string) {
    if (!workspaceId || !name) {
      throw new BadRequestException('workspace_id and name required');
    }

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ name })
      .eq('id', workspaceId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  }

  async remove(userId: string, workspaceId: string) {
    if (!workspaceId) {
      throw new BadRequestException('workspace_id required');
    }

    const { error } = await this.supabase
      .getClient()
      .from('workspaces')
      .delete()
      .eq('id', workspaceId)
      .eq('user_id', userId);

    if (error) throw error;
    return { success: true };
  }

  async addConnection(
    userId: string,
    workspaceId: string,
    facebookConnectionId: string,
  ) {
    if (!workspaceId || !facebookConnectionId) {
      throw new BadRequestException(
        'workspace_id and facebook_connection_id required',
      );
    }

    await this.verifyOwnership(userId, workspaceId);

    const { error } = await this.supabase
      .getClient()
      .from('workspace_connections')
      .upsert(
        {
          workspace_id: workspaceId,
          facebook_connection_id: facebookConnectionId,
        },
        { onConflict: 'workspace_id,facebook_connection_id' },
      );

    if (error) throw error;
    return { success: true };
  }

  async removeConnection(userId: string, workspaceId: string, facebookConnectionId: string) {
    await this.verifyOwnership(userId, workspaceId);

    const { error } = await this.supabase
      .getClient()
      .from('workspace_connections')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('facebook_connection_id', facebookConnectionId);

    if (error) throw error;
    return { success: true };
  }

  async addCheckout(userId: string, workspaceId: string, checkoutIntegrationId: string) {
    if (!workspaceId || !checkoutIntegrationId) {
      throw new BadRequestException(
        'workspace_id and checkout_integration_id required',
      );
    }

    await this.verifyOwnership(userId, workspaceId);

    const { error } = await this.supabase
      .getClient()
      .from('workspace_checkout_integrations')
      .upsert(
        {
          workspace_id: workspaceId,
          checkout_integration_id: checkoutIntegrationId,
        },
        { onConflict: 'workspace_id,checkout_integration_id' },
      );

    if (error) throw error;
    return { success: true };
  }

  async removeCheckout(userId: string, workspaceId: string, checkoutIntegrationId: string) {
    await this.verifyOwnership(userId, workspaceId);

    const { error } = await this.supabase
      .getClient()
      .from('workspace_checkout_integrations')
      .delete()
      .eq('workspace_id', workspaceId)
      .eq('checkout_integration_id', checkoutIntegrationId);

    if (error) throw error;
    return { success: true };
  }

  async setProducts(userId: string, workspaceId: string, productNames: string[]) {
    if (!workspaceId || !Array.isArray(productNames)) {
      throw new BadRequestException('workspace_id and product_names[] required');
    }

    await this.verifyOwnership(userId, workspaceId);

    const client = this.supabase.getClient();

    await client
      .from('workspace_products')
      .delete()
      .eq('workspace_id', workspaceId);

    if (productNames.length > 0) {
      const rows = productNames.map((name) => ({
        workspace_id: workspaceId,
        product_name: name,
      }));
      const { error } = await client.from('workspace_products').insert(rows);
      if (error) throw error;
    }

    return { success: true };
  }
}
```

- [ ] **Step 2: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/workspaces/workspaces.service.ts
git commit -m "fix(workspaces): add ownership validation to all destructive operations"
```

---

### Task 4: Create DTOs for Admin module and add proxy query whitelist

**Files:**
- Create: `packages/backend/src/modules/admin/dto/list-users.dto.ts`
- Create: `packages/backend/src/modules/admin/dto/create-user.dto.ts`
- Create: `packages/backend/src/modules/admin/dto/update-user.dto.ts`
- Create: `packages/backend/src/modules/admin/dto/proxy-query.dto.ts`
- Modify: `packages/backend/src/modules/admin/admin.controller.ts`
- Modify: `packages/backend/src/modules/admin/admin.service.ts`

- [ ] **Step 1: Create admin DTOs**

`packages/backend/src/modules/admin/dto/list-users.dto.ts`:
```typescript
import { IsOptional, IsString, IsNumberString } from 'class-validator';

export class ListUsersDto {
  @IsOptional()
  @IsNumberString()
  page?: string;

  @IsOptional()
  @IsNumberString()
  limit?: string;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  facebook_status?: string;
}
```

`packages/backend/src/modules/admin/dto/create-user.dto.ts`:
```typescript
import { IsEmail, IsOptional, IsString, MinLength } from 'class-validator';

export class CreateUserDto {
  @IsString()
  @MinLength(1)
  name: string;

  @IsEmail()
  email: string;

  @IsString()
  @MinLength(6)
  password: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  subscription_start?: string;

  @IsOptional()
  @IsString()
  subscription_end?: string;
}
```

`packages/backend/src/modules/admin/dto/update-user.dto.ts`:
```typescript
import { IsOptional, IsString } from 'class-validator';

export class UpdateUserDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsString()
  plan?: string;

  @IsOptional()
  @IsString()
  role?: string;

  @IsOptional()
  @IsString()
  cpf?: string;

  @IsOptional()
  @IsString()
  subscription_start?: string;

  @IsOptional()
  @IsString()
  subscription_end?: string;
}
```

`packages/backend/src/modules/admin/dto/proxy-query.dto.ts`:
```typescript
import { Type } from 'class-transformer';
import {
  IsArray,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  ValidateNested,
} from 'class-validator';

const ALLOWED_TABLES = [
  'sales',
  'campaigns',
  'ad_sets',
  'ads',
  'daily_ad_spend',
  'checkout_integrations',
  'facebook_connections',
  'sync_schedules',
  'sync_logs',
  'workspace_connections',
  'workspace_checkout_integrations',
  'workspace_products',
  'workspaces',
  'financial_entries',
] as const;

const ALLOWED_OPS = [
  'eq', 'neq', 'gt', 'gte', 'lt', 'lte', 'in', 'is', 'like', 'ilike', 'not_is',
] as const;

class ProxyFilterDto {
  @IsString()
  column: string;

  @IsIn([...ALLOWED_OPS])
  op: string;

  value: any;
}

class ProxyOrderDto {
  @IsString()
  column: string;

  @IsOptional()
  ascending?: boolean;
}

class ProxyRangeDto {
  @IsNumber()
  from: number;

  @IsNumber()
  to: number;
}

export class ProxyQueryItemDto {
  @IsString()
  key: string;

  @IsIn([...ALLOWED_TABLES])
  table: string;

  @IsOptional()
  @IsString()
  select?: string;

  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProxyFilterDto)
  filters?: ProxyFilterDto[];

  @IsOptional()
  @ValidateNested()
  @Type(() => ProxyOrderDto)
  order?: ProxyOrderDto;

  @IsOptional()
  @IsNumber()
  limit?: number;

  @IsOptional()
  @ValidateNested()
  @Type(() => ProxyRangeDto)
  range?: ProxyRangeDto;
}

export class ProxyQueryDto {
  @IsUUID()
  user_id: string;

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ProxyQueryItemDto)
  queries: ProxyQueryItemDto[];
}
```

- [ ] **Step 2: Update admin controller to use DTOs**

Replace `packages/backend/src/modules/admin/admin.controller.ts`:

```typescript
import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { AdminGuard } from '../../common/guards/admin.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { AdminService } from './admin.service';
import { ListUsersDto } from './dto/list-users.dto';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { ProxyQueryDto } from './dto/proxy-query.dto';

@Controller('admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(private readonly adminService: AdminService) {}

  @Get('stats')
  getStats() {
    return this.adminService.getStats();
  }

  @Get('users')
  listUsers(@Query() dto: ListUsersDto) {
    return this.adminService.listUsers({
      page: dto.page ? parseInt(dto.page, 10) : undefined,
      limit: dto.limit ? parseInt(dto.limit, 10) : undefined,
      search: dto.search,
      plan: dto.plan,
      role: dto.role,
      facebook_status: dto.facebook_status,
    });
  }

  @Get('users/:id')
  getUserDetail(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Post('users')
  createUser(@Body() dto: CreateUserDto) {
    return this.adminService.createUser(dto);
  }

  @Patch('users/:id')
  updateUser(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateUserDto,
  ) {
    return this.adminService.updateUser(id, dto);
  }

  @Delete('users/:id')
  deleteUser(
    @Param('id', ParseUUIDPipe) id: string,
    @CurrentUser('id') callerUserId: string,
  ) {
    return this.adminService.deleteUser(id, callerUserId);
  }

  @Post('users/:id/force-sync')
  forceSync(@Param('id', ParseUUIDPipe) id: string) {
    return this.adminService.forceSync(id);
  }

  @Post('proxy')
  proxyQuery(@Body() dto: ProxyQueryDto) {
    return this.adminService.proxyQuery(dto.user_id, dto.queries);
  }
}
```

- [ ] **Step 3: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/admin/
git commit -m "feat(admin): add DTOs with whitelist validation for proxy query"
```

---

### Task 5: Create DTOs for remaining modules (Sales, Metrics, Integrations, Financial, Plans, Webhooks)

**Files:**
- Create: `packages/backend/src/modules/webhooks/dto/webhook-payload.dto.ts`
- Create: `packages/backend/src/modules/sales/dto/get-sales.dto.ts`
- Create: `packages/backend/src/modules/metrics/dto/metrics-query.dto.ts`
- Create: `packages/backend/src/modules/integrations/dto/` (multiple DTOs)
- Create: `packages/backend/src/modules/financial/dto/` (multiple DTOs)
- Create: `packages/backend/src/modules/plans/dto/update-plan.dto.ts`
- Modify: corresponding controllers

- [ ] **Step 1: Create DTOs for each module**

Create DTOs matching the query parameters and body types used by each controller. For each controller, read the current parameters and create a DTO class with appropriate validators. Follow the same pattern as Tasks 2 and 4.

Key DTOs to create:

`packages/backend/src/modules/webhooks/dto/webhook-payload.dto.ts`:
```typescript
import { IsString } from 'class-validator';

export class WebhookParamsDto {
  @IsString()
  platform: string;
}
```

Note: Webhook body is intentionally unvalidated (`any`) because each platform sends different schemas. The platform-specific processors handle validation internally.

`packages/backend/src/modules/sales/dto/get-sales.dto.ts`:
```typescript
import { IsOptional, IsString } from 'class-validator';

export class GetSalesDto {
  @IsOptional()
  @IsString()
  from?: string;

  @IsOptional()
  @IsString()
  to?: string;

  @IsOptional()
  @IsString()
  status?: string;

  @IsOptional()
  @IsString()
  checkout_ids?: string;

  @IsOptional()
  @IsString()
  product_names?: string;
}
```

`packages/backend/src/modules/plans/dto/update-plan.dto.ts`:
```typescript
import { IsBoolean, IsNumber, IsOptional } from 'class-validator';

export class UpdatePlanDto {
  @IsOptional() @IsNumber() max_campaigns?: number;
  @IsOptional() @IsNumber() max_sales?: number;
  @IsOptional() @IsNumber() max_checkout_integrations?: number;
  @IsOptional() @IsNumber() max_ad_accounts?: number;
  @IsOptional() @IsNumber() max_workspaces?: number;
  @IsOptional() @IsNumber() sync_interval_minutes?: number;
  @IsOptional() @IsBoolean() feature_sales_globe?: boolean;
  @IsOptional() @IsBoolean() feature_advanced_reports?: boolean;
  @IsOptional() @IsBoolean() feature_conversion_funnel?: boolean;
  @IsOptional() @IsBoolean() feature_auto_sync?: boolean;
  @IsOptional() @IsBoolean() feature_api_access?: boolean;
}
```

Continue creating DTOs for integrations and financial modules following the same pattern — one DTO per endpoint body/query shape.

- [ ] **Step 2: Update all controllers to use DTOs**

Update each controller to import and use the new DTOs instead of raw `@Body()` and `@Query()` parameters. Add `ParseUUIDPipe` to all `@Param('id')` where the param is a UUID.

- [ ] **Step 3: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/
git commit -m "feat(backend): add DTOs for sales, metrics, integrations, financial, plans, webhooks"
```

---

### Task 6: Harden webhook token extraction

**Files:**
- Modify: `packages/backend/src/shared/helpers/extract-webhook-token.ts`

- [ ] **Step 1: Remove query param fallback**

Replace `packages/backend/src/shared/helpers/extract-webhook-token.ts`:

```typescript
/**
 * Extracts the authentication token from the request.
 * Each platform sends the token differently (headers, body).
 * Query param tokens are NOT accepted — they leak in logs and proxy caches.
 */
export function extractWebhookToken(
  req: { headers: Record<string, string | string[] | undefined>; query: Record<string, string> },
  payload: any,
  platform: string,
): string | null {
  // Platform-specific headers first
  switch (platform) {
    case 'hotmart':
      if (req.headers['x-hotmart-hottok']) return req.headers['x-hotmart-hottok'] as string;
      if (req.headers['x-hottok']) return req.headers['x-hottok'] as string;
      break;
    case 'kirvano':
      if (req.headers['x-kirvano-token']) return req.headers['x-kirvano-token'] as string;
      break;
    case 'guru':
      if (payload?.api_token) return payload.api_token;
      break;
  }

  // Generic header checks
  const genericHeaders = ['x-webhook-token', 'x-api-token', 'authorization-token'];
  for (const header of genericHeaders) {
    const value = req.headers[header];
    if (value) return value as string;
  }

  // Body token fields (platform-specific payload structures)
  if (payload?.token) return payload.token;
  if (payload?.signature) return payload.signature;
  if (payload?.hottok) return payload.hottok;
  if (payload?.api_token) return payload.api_token;

  return null;
}
```

- [ ] **Step 2: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/shared/helpers/extract-webhook-token.ts
git commit -m "fix(webhooks): remove query param token fallback — headers and body only"
```

---

## Phase 2 — Security Medium

### Task 7: Add rate limiting with @nestjs/throttler

**Files:**
- Modify: `packages/backend/package.json`
- Modify: `packages/backend/src/app.module.ts`
- Modify: `packages/backend/src/main.ts`
- Modify: `packages/backend/src/modules/webhooks/webhooks.controller.ts`

- [ ] **Step 1: Install throttler**

```bash
cd packages/backend && npm install @nestjs/throttler
```

- [ ] **Step 2: Configure ThrottlerModule in app.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';
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
import { IntegrationsModule } from './modules/integrations/integrations.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, envFilePath: '.env' }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 60 }]),
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
    IntegrationsModule,
  ],
})
export class AppModule {}
```

- [ ] **Step 3: Add ThrottlerGuard globally in main.ts**

Add after the ValidationPipe in `main.ts`:

```typescript
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
```

Note: For Fastify, the ThrottlerGuard must be registered as a global provider in `app.module.ts` instead of `main.ts`. Add to `app.module.ts` providers:

```typescript
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard } from '@nestjs/throttler';

@Module({
  imports: [...],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
```

- [ ] **Step 4: Skip throttling on webhooks controller**

Add `@SkipThrottle()` to `packages/backend/src/modules/webhooks/webhooks.controller.ts`:

```typescript
import { SkipThrottle } from '@nestjs/throttler';

@SkipThrottle()
@Controller('webhooks')
export class WebhooksController {
  // ... existing code unchanged
}
```

- [ ] **Step 5: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/
git commit -m "feat(backend): add rate limiting with @nestjs/throttler, skip on webhooks"
```

---

### Task 8: Add security headers

**Files:**
- Modify: `packages/backend/src/main.ts`

- [ ] **Step 1: Add Fastify onSend hook for security headers**

In `main.ts`, after `app.setGlobalPrefix('api')`, add:

```typescript
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onSend', (_request, reply, _payload, done) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    done();
  });
```

- [ ] **Step 2: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/main.ts
git commit -m "feat(backend): add security headers via Fastify onSend hook"
```

---

### Task 9: Add health check endpoint

**Files:**
- Create: `packages/backend/src/modules/health/health.module.ts`
- Create: `packages/backend/src/modules/health/health.controller.ts`
- Modify: `packages/backend/src/app.module.ts`

- [ ] **Step 1: Create health controller**

`packages/backend/src/modules/health/health.controller.ts`:
```typescript
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { SupabaseService } from '../../shared/services/supabase.service';

@SkipThrottle()
@Controller('health')
export class HealthController {
  constructor(private readonly supabase: SupabaseService) {}

  @Get()
  async check() {
    const start = Date.now();
    const { error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select('id')
      .limit(1);

    return {
      status: error ? 'degraded' : 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      db_latency_ms: Date.now() - start,
    };
  }
}
```

`packages/backend/src/modules/health/health.module.ts`:
```typescript
import { Module } from '@nestjs/common';
import { HealthController } from './health.controller';

@Module({
  controllers: [HealthController],
})
export class HealthModule {}
```

- [ ] **Step 2: Register HealthModule in app.module.ts**

Add `import { HealthModule } from './modules/health/health.module';` and add `HealthModule` to the imports array.

- [ ] **Step 3: Verify build and test endpoint**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/health/ packages/backend/src/app.module.ts
git commit -m "feat(backend): add /api/health endpoint with DB latency check"
```

Note: The health endpoint doesn't use AuthGuard because it's not decorated with `@UseGuards(AuthGuard)`. Since the ThrottlerGuard is global, we add `@SkipThrottle()` to allow monitoring tools to check it freely.

---

### Task 10: Remove hardcoded Supabase anon key

**Files:**
- Modify: `packages/frontend/src/integrations/supabase/client.ts`
- Modify: `packages/frontend/.env.example`

- [ ] **Step 1: Remove hardcoded fallback**

Replace `packages/frontend/src/integrations/supabase/client.ts`:

```typescript
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  throw new Error(
    'Missing VITE_SUPABASE_URL or VITE_SUPABASE_ANON_KEY environment variables. ' +
    'Copy .env.example to .env and fill in the values.',
  );
}

/**
 * Supabase client — used ONLY for authentication (login, signup, session).
 * All business data goes through the backend API via src/lib/api.ts.
 */
export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: localStorage,
    persistSession: true,
    autoRefreshToken: true,
  },
});
```

- [ ] **Step 2: Update .env.example**

Replace `packages/frontend/.env.example`:

```
# Required — Supabase project URL
VITE_SUPABASE_URL=https://your-project.supabase.co

# Required — Supabase anon (public) key. Safe for frontend — RLS controls access.
VITE_SUPABASE_ANON_KEY=

# Backend API URL
VITE_API_URL=http://localhost:3001/api
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/integrations/supabase/client.ts packages/frontend/.env.example
git commit -m "fix(frontend): remove hardcoded Supabase anon key, require env vars"
```

---

## Phase 3 — Performance Backend

### Task 11: Replace select('*') with explicit columns

**Files:**
- Modify: `packages/backend/src/modules/metrics/metrics.service.ts`
- Modify: `packages/backend/src/modules/sales/sales.service.ts`
- Modify: `packages/backend/src/modules/integrations/integrations.service.ts`
- Modify: `packages/backend/src/modules/plans/plans.service.ts`
- Modify: `packages/backend/src/modules/facebook/sync.service.ts`
- Modify: `packages/backend/src/modules/webhooks/webhook-queue.service.ts`

- [ ] **Step 1: Audit each select('*') and determine minimum columns**

For each service file, read the code to see which columns are actually used after the query, then replace `select('*')` with only those columns.

Key replacements (determine exact columns by reading how data is used after query):

- `plans.service.ts` `list()`: Replace `.select('*')` with `.select('id, plan, max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts, max_workspaces, sync_interval_minutes, feature_sales_globe, feature_advanced_reports, feature_conversion_funnel, feature_auto_sync, feature_api_access, updated_at')`
- `plans.service.ts` `getRulesForPlan()`: Same as above
- `integrations.service.ts`: Replace each `select('*')` with the columns the frontend actually reads
- `facebook/sync.service.ts`: Replace with columns needed for sync logic
- `webhook-queue.service.ts`: Replace with columns needed for queue processing

**Exception:** Keep `select('*', { count: 'exact', head: true })` unchanged — these are count-only queries that don't return data.

- [ ] **Step 2: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/
git commit -m "perf(backend): replace select('*') with explicit column lists"
```

---

### Task 12: Resolve N+1 queries in admin service

**Files:**
- Modify: `packages/backend/src/modules/admin/admin.service.ts`

- [ ] **Step 1: Refactor getStats() to use joins instead of per-user queries**

Replace the `recentUsersEnriched` block (lines ~93-107) with a joined query:

```typescript
    // Recent users with Facebook status (joined, no N+1)
    const { data: recentUsers } = await client
      .from('profiles')
      .select('id, user_id, name, email, plan_rules:plan_id(plan), avatar_url, created_at, facebook_connections(is_valid)')
      .order('created_at', { ascending: false })
      .limit(10);

    const recentUsersEnriched = (recentUsers || []).map((u: any) => {
      const fcList = u.facebook_connections || [];
      const hasConnection = fcList.length > 0;
      const anyValid = fcList.some((c: any) => c.is_valid);
      const { plan_rules, facebook_connections, ...rest } = u;
      return {
        ...rest,
        plan: (plan_rules as any)?.plan || 'starter',
        facebook_connected: hasConnection ? anyValid : null,
      };
    });
```

Replace the `usersWithSyncErrors` block (lines ~109-120) with a joined query:

```typescript
    // Users with sync errors (joined, no N+1)
    const { data: syncErrors } = await client
      .from('sync_schedules')
      .select('user_id, last_sync_error, last_sync_at, profiles!sync_schedules_user_id_fkey(name, email)')
      .eq('last_sync_status', 'error')
      .limit(10);

    const usersWithSyncErrors = (syncErrors || []).map((s: any) => ({
      user_id: s.user_id,
      name: (s.profiles as any)?.name,
      email: (s.profiles as any)?.email,
      last_sync_error: s.last_sync_error,
      last_sync_at: s.last_sync_at,
    }));
```

- [ ] **Step 2: Refactor listUsers() to batch-fetch instead of per-user queries**

Replace the `Promise.all(profiles.map(...))` block with batch fetches:

```typescript
    const userIds = (profiles || []).map((p: any) => p.user_id);

    // Batch fetch Facebook connections
    const { data: allFc } = await client
      .from('facebook_connections')
      .select('user_id, is_valid, ad_account_id')
      .in('user_id', userIds);
    const fcByUser = new Map<string, any[]>();
    (allFc || []).forEach((fc: any) => {
      const list = fcByUser.get(fc.user_id) || [];
      list.push(fc);
      fcByUser.set(fc.user_id, list);
    });

    // Batch fetch roles
    const { data: allRoles } = await client
      .from('user_roles')
      .select('user_id, role')
      .in('user_id', userIds);
    const roleByUser = new Map<string, string>();
    (allRoles || []).forEach((r: any) => roleByUser.set(r.user_id, r.role));

    // Batch fetch campaign counts
    const { data: campaignCounts } = await client
      .from('campaigns')
      .select('user_id')
      .in('user_id', userIds);
    const campaignCountByUser = new Map<string, number>();
    (campaignCounts || []).forEach((c: any) => {
      campaignCountByUser.set(c.user_id, (campaignCountByUser.get(c.user_id) || 0) + 1);
    });

    // Batch fetch approved sales with amounts
    const { data: salesData } = await client
      .from('sales')
      .select('user_id, amount')
      .in('user_id', userIds)
      .eq('status', 'approved');
    const salesByUser = new Map<string, { count: number; revenue: number }>();
    (salesData || []).forEach((s: any) => {
      const curr = salesByUser.get(s.user_id) || { count: 0, revenue: 0 };
      curr.count += 1;
      curr.revenue += parseFloat(s.amount) || 0;
      salesByUser.set(s.user_id, curr);
    });

    const enrichedUsers = (profiles || []).map((p: any) => {
      const fcList = fcByUser.get(p.user_id) || [];
      const sales = salesByUser.get(p.user_id) || { count: 0, revenue: 0 };
      const authUser = authUsersMap.get(p.user_id) as any;
      const { plan_rules: pr, plan_id: _planId, ...profileRest } = p;

      return {
        ...profileRest,
        plan: (pr as any)?.plan || 'starter',
        role: roleByUser.get(p.user_id) || 'user',
        facebook_connected: fcList.length > 0 ? fcList.some((c: any) => c.is_valid) : null,
        ad_account_id: fcList[0]?.ad_account_id ?? null,
        campaigns_count: campaignCountByUser.get(p.user_id) || 0,
        sales_count: sales.count,
        total_revenue: sales.revenue,
        last_sign_in_at: authUser?.last_sign_in_at || null,
      };
    });
```

- [ ] **Step 3: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 4: Commit**

```bash
git add packages/backend/src/modules/admin/admin.service.ts
git commit -m "perf(admin): resolve N+1 queries with joins and batch fetches"
```

---

### Task 13: Implement async webhook processing for all platforms

**Files:**
- Modify: `packages/backend/src/modules/webhooks/webhooks.controller.ts`
- Modify: `packages/backend/src/modules/webhooks/webhook-queue.service.ts`

- [ ] **Step 1: Refactor webhooks controller to queue all platforms**

Replace the `handleWebhook` method in `webhooks.controller.ts`:

```typescript
  @Post(':platform')
  async handleWebhook(
    @Param('platform') platform: string,
    @Body() body: any,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    this.logger.log(`Webhook received for platform: ${platform}`);

    const processor = this.processors[platform];
    if (!processor) {
      res.status(404).send({ error: `Unknown platform: ${platform}` });
      return;
    }

    try {
      const headers: Record<string, string | string[] | undefined> =
        req.headers as any;
      const query: Record<string, string> = (req.query as any) || {};
      const authToken = extractWebhookToken(
        { headers, query },
        body,
        platform,
      );

      // Platforms that already use queue pattern
      if (platform === 'guru') {
        const result = await processor.process(body, authToken);
        res.status(result.status).send(result.body);
        return;
      }

      // For all other platforms: validate token, then queue
      // Each processor must expose a validateToken method
      const isValid = await processor.validateToken(authToken, body, headers);
      if (!isValid) {
        res.status(401).send({ error: 'Invalid webhook token' });
        return;
      }

      // Queue the webhook for async processing
      const { error } = await this.webhookQueueService.enqueue({
        platform,
        payload: body,
        auth_token: authToken,
        raw_body: platform === 'kiwify' ? ((req as any).rawBody || JSON.stringify(body)) : null,
      });

      if (error) {
        this.logger.error(`Failed to queue ${platform} webhook: ${error}`);
        res.status(500).send({ error: 'Failed to queue webhook' });
        return;
      }

      res.status(202).send({ status: 'queued' });
    } catch (error: any) {
      this.logger.error(
        `Webhook ${platform} error: ${error.message}`,
        error.stack,
      );
      res.status(500).send({
        error: 'Internal server error',
        details: error.message,
      });
    }
  }
```

Note: This requires adding a `validateToken()` method to each processor that currently does token validation inline within `process()`. Extract the validation logic from each processor's `process()` method into a separate `validateToken()` method. Also inject `WebhookQueueService` into the controller constructor.

- [ ] **Step 2: Add enqueue method to WebhookQueueService**

Add to `webhook-queue.service.ts`:

```typescript
  async enqueue(data: {
    platform: string;
    payload: any;
    auth_token: string | null;
    raw_body?: string | null;
  }) {
    const { error } = await this.supabase
      .getClient()
      .from('webhook_queue')
      .insert({
        platform: data.platform,
        payload: data.payload,
        auth_token: data.auth_token,
        raw_body: data.raw_body,
        status: 'pending',
      });

    return { error: error?.message || null };
  }
```

- [ ] **Step 3: Update the cron processor to handle all platforms**

Extend the existing queue processing cron in `webhook-queue.service.ts` to dispatch to the correct processor based on `platform` column.

- [ ] **Step 4: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/webhooks/
git commit -m "perf(webhooks): queue all platforms for async processing"
```

---

### Task 14: Add backend in-memory cache for reference data

**Files:**
- Create: `packages/backend/src/shared/services/cache.service.ts`
- Modify: `packages/backend/src/shared/shared.module.ts`
- Modify: `packages/backend/src/modules/plans/plans.service.ts`

- [ ] **Step 1: Create CacheService**

`packages/backend/src/shared/services/cache.service.ts`:
```typescript
import { Injectable } from '@nestjs/common';

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

@Injectable()
export class CacheService {
  private readonly store = new Map<string, CacheEntry<any>>();

  get<T>(key: string): T | null {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (Date.now() > entry.expiresAt) {
      this.store.delete(key);
      return null;
    }
    return entry.value;
  }

  set<T>(key: string, value: T, ttlMs: number): void {
    this.store.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  invalidate(key: string): void {
    this.store.delete(key);
  }

  invalidateByPrefix(prefix: string): void {
    for (const key of this.store.keys()) {
      if (key.startsWith(prefix)) {
        this.store.delete(key);
      }
    }
  }
}
```

- [ ] **Step 2: Register CacheService in SharedModule**

`packages/backend/src/shared/shared.module.ts`:
```typescript
import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './services/supabase.service';
import { EncryptionService } from './services/encryption.service';
import { CacheService } from './services/cache.service';

@Global()
@Module({
  providers: [SupabaseService, EncryptionService, CacheService],
  exports: [SupabaseService, EncryptionService, CacheService],
})
export class SharedModule {}
```

- [ ] **Step 3: Use cache in PlansService**

Replace `packages/backend/src/modules/plans/plans.service.ts`:

```typescript
import { BadRequestException, Injectable } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';

const PLANS_CACHE_TTL = 60_000; // 60 seconds

const ALLOWED_FIELDS = [
  'max_campaigns',
  'max_sales',
  'max_checkout_integrations',
  'max_ad_accounts',
  'max_workspaces',
  'sync_interval_minutes',
  'feature_sales_globe',
  'feature_advanced_reports',
  'feature_conversion_funnel',
  'feature_auto_sync',
  'feature_api_access',
] as const;

@Injectable()
export class PlansService {
  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  async list() {
    const cached = this.cache.get<any[]>('plans:list');
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select('id, plan, max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts, max_workspaces, sync_interval_minutes, feature_sales_globe, feature_advanced_reports, feature_conversion_funnel, feature_auto_sync, feature_api_access, updated_at')
      .order('plan');

    if (error) throw error;
    this.cache.set('plans:list', data, PLANS_CACHE_TTL);
    return data;
  }

  async getRulesForPlan(plan: string) {
    const cacheKey = `plans:rules:${plan}`;
    const cached = this.cache.get<any>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .select('id, plan, max_campaigns, max_sales, max_checkout_integrations, max_ad_accounts, max_workspaces, sync_interval_minutes, feature_sales_globe, feature_advanced_reports, feature_conversion_funnel, feature_auto_sync, feature_api_access, updated_at')
      .eq('plan', plan)
      .single();

    if (error) throw error;
    this.cache.set(cacheKey, data, PLANS_CACHE_TTL);
    return data;
  }

  async update(plan: string, updates: Record<string, unknown>) {
    if (!plan || !updates) {
      throw new BadRequestException('plan and updates required');
    }

    const safeUpdates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };

    for (const key of ALLOWED_FIELDS) {
      if (updates[key] !== undefined) {
        safeUpdates[key] = updates[key];
      }
    }

    const { error } = await this.supabase
      .getClient()
      .from('plan_rules')
      .update(safeUpdates)
      .eq('plan', plan);

    if (error) throw error;

    // Invalidate cache on write
    this.cache.invalidateByPrefix('plans:');
    return { success: true };
  }
}
```

- [ ] **Step 4: Verify build**

```bash
cd packages/backend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/shared/ packages/backend/src/modules/plans/plans.service.ts
git commit -m "perf(backend): add in-memory cache service, cache plan rules with 60s TTL"
```

---

## Phase 4 — Performance Frontend

### Task 15: Configure staleTime on all useQuery hooks

**Files:**
- Modify: All hooks in `packages/frontend/src/hooks/` that use `useQuery`

- [ ] **Step 1: Add staleTime to each useQuery hook**

Based on the audit, only 7 hooks use `useQuery`. The rest use manual `useEffect`+`useState` (those don't need staleTime — they're already manually controlled).

Add `staleTime` to each hook:

`useWorkspaces.ts` — reference data, changes rarely:
```typescript
  const { data: workspaces = [], isLoading } = useQuery<Workspace[]>({
    queryKey: ['workspaces', effectiveUserId],
    queryFn: async () => {
      return api.get<Workspace[]>(`/workspaces${impersonationParam}`);
    },
    enabled: !!effectiveUserId,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
```

`useAdminUsers.ts` — user list, moderate freshness:
```typescript
  const { data, isLoading, error, refetch } = useQuery<AdminUsersListResponse>({
    // ...existing config...
    staleTime: 30 * 1000, // 30 seconds
  });
```

`useAdminDashboard.ts` — already has `staleTime: 1000 * 60 * 5`. No change needed.

`useAdminUserDetail.ts` — user detail:
```typescript
  const { data: user, isLoading, error, refetch } = useQuery({
    queryKey: ['admin-user-detail', userId],
    queryFn: () => api.get<AdminUserDetail>(`/admin/users/${userId}`),
    enabled: !!userId,
    staleTime: 30 * 1000, // 30 seconds
  });
```

`useAdminPlans.ts` — reference data:
```typescript
  const { data: planRules, isLoading } = useQuery<PlanRules[]>({
    queryKey: ['admin-plan-rules'],
    queryFn: () => api.get<PlanRules[]>('/plans/rules'),
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
```

`usePlanRules.ts` — reference data:
```typescript
  const { data: planRules, isLoading } = useQuery<PlanRules | null>({
    queryKey: ['plan-rules', userPlan],
    queryFn: async () => {
      const rules = await api.get<PlanRules[]>('/plans/rules');
      return rules.find((r) => r.plan === userPlan) || null;
    },
    enabled: !!userPlan,
    staleTime: 5 * 60 * 1000, // 5 minutes
  });
```

`useSyncSchedule.ts` — real-time data, already has `refetchInterval`. Add `staleTime: 0`:
```typescript
  const { data: schedule, isLoading: loadingSchedule, refetch: refetchSchedule } = useQuery({
    // ...existing config...
    staleTime: 0, // always refetch
  });
```

- [ ] **Step 2: Verify frontend build**

```bash
cd packages/frontend && npm run build
```

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/hooks/
git commit -m "perf(frontend): add staleTime to all useQuery hooks"
```

---

### Task 16: Create shared useDebounce hook and apply to search inputs

**Files:**
- Create: `packages/frontend/src/hooks/useDebounce.ts`
- Modify: `packages/frontend/src/pages/admin/AdminUsers.tsx`
- Modify: `packages/frontend/src/pages/Sales.tsx`
- Modify: `packages/frontend/src/pages/Campaigns.tsx`

- [ ] **Step 1: Create shared useDebounce hook**

`packages/frontend/src/hooks/useDebounce.ts`:
```typescript
import { useState, useEffect } from 'react';

export function useDebounce<T>(value: T, delayMs: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedValue(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);

  return debouncedValue;
}
```

- [ ] **Step 2: Refactor AdminUsers to use shared hook**

In `packages/frontend/src/pages/admin/AdminUsers.tsx`:
- Remove the local `useDebounceValue` function (lines 12-26)
- Import the shared hook: `import { useDebounce } from '@/hooks/useDebounce';`
- Replace `useDebounceValue(searchInput, 300)` with `useDebounce(searchInput, 300)`

- [ ] **Step 3: Add debounce to Sales.tsx search**

In `packages/frontend/src/pages/Sales.tsx`:
- Add import: `import { useDebounce } from '@/hooks/useDebounce';`
- After `const [search, setSearch] = useState('');` (line 32), add:
  ```typescript
  const debouncedSearch = useDebounce(search, 300);
  ```
- Replace all usages of `search` in the filter logic with `debouncedSearch`

- [ ] **Step 4: Add debounce to Campaigns.tsx search**

In `packages/frontend/src/pages/Campaigns.tsx`:
- Add import: `import { useDebounce } from '@/hooks/useDebounce';`
- After `const [search, setSearch] = useState('');` (line 54), add:
  ```typescript
  const debouncedSearch = useDebounce(search, 300);
  ```
- Replace all usages of `search` in the filter logic with `debouncedSearch`

- [ ] **Step 5: Verify build**

```bash
cd packages/frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add packages/frontend/src/hooks/useDebounce.ts packages/frontend/src/pages/
git commit -m "perf(frontend): add shared useDebounce hook, apply to all search inputs"
```

---

### Task 17: Fix memoization issues in WorkspaceContext and Dashboard

**Files:**
- Modify: `packages/frontend/src/contexts/WorkspaceContext.tsx`
- Modify: `packages/frontend/src/pages/Dashboard.tsx`

- [ ] **Step 1: Wrap derived arrays in useMemo in WorkspaceContext.tsx**

In `packages/frontend/src/contexts/WorkspaceContext.tsx`, add `useMemo` import and replace lines 59-63:

```typescript
import { createContext, useContext, useState, useEffect, useCallback, useMemo, ReactNode } from 'react';
```

Replace the three array derivations (lines 61-63):

```typescript
  const activeWorkspace = workspaces.find(w => w.id === activeWorkspaceId) || null;

  const activeConnectionIds = useMemo(
    () => activeWorkspace?.workspace_connections?.map(c => c.facebook_connection_id) || [],
    [activeWorkspace?.workspace_connections],
  );
  const activeCheckoutIds = useMemo(
    () => activeWorkspace?.workspace_checkout_integrations?.map(c => c.checkout_integration_id) || [],
    [activeWorkspace?.workspace_checkout_integrations],
  );
  const activeProductNames = useMemo(
    () => activeWorkspace?.workspace_products?.map(p => p.product_name) || [],
    [activeWorkspace?.workspace_products],
  );
```

- [ ] **Step 2: Move helper functions outside Dashboard component**

In `packages/frontend/src/pages/Dashboard.tsx`, move `parseDateRangeFromParams` (lines 293-326) and `serializeDateRangeToParams` (lines 329-341) to **before** the `export default function Dashboard()` line. These are pure functions with no component dependencies.

- [ ] **Step 3: Wrap MetricCard in React.memo**

In `Dashboard.tsx`, replace the MetricCard function declaration:

```typescript
const MetricCard = memo(function MetricCard({ title, value, change, icon, prefix, suffix, loading, valueColor }: MetricCardProps) {
  // ... existing implementation unchanged
});
```

Add `memo` to the imports: `import { useState, useMemo, useEffect, memo } from 'react';`

- [ ] **Step 4: Verify build**

```bash
cd packages/frontend && npm run build
```

- [ ] **Step 5: Commit**

```bash
git add packages/frontend/src/contexts/WorkspaceContext.tsx packages/frontend/src/pages/Dashboard.tsx
git commit -m "perf(frontend): memoize context arrays and Dashboard helpers"
```

---

### Task 18: Configure Vite manual chunks for better caching

**Files:**
- Modify: `packages/frontend/vite.config.ts`

- [ ] **Step 1: Add manualChunks configuration**

Replace `packages/frontend/vite.config.ts`:

```typescript
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig(() => ({
  server: {
    host: "::",
    port: 5173,
    hmr: {
      overlay: false,
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
  },
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom"],
  },
  optimizeDeps: {
    include: ["@tanstack/react-query"],
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom', 'react-router-dom'],
          'vendor-ui': ['lucide-react'],
          'vendor-charts': ['recharts'],
          'vendor-query': ['@tanstack/react-query'],
        },
      },
    },
  },
}));
```

Note: Radix UI packages are tree-shaken individually so we don't group them. `topojson` and `world-atlas` are only used by the SalesGlobe (lazy-loaded), so they naturally end up in their own chunk.

- [ ] **Step 2: Verify build produces separate chunks**

```bash
cd packages/frontend && npm run build
```

Expected: Build output shows separate chunk files for vendor-react, vendor-ui, vendor-charts, vendor-query.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/vite.config.ts
git commit -m "perf(frontend): configure Vite manual chunks for vendor caching"
```

---

## Phase 5 — Performance Database

### Task 19: Add composite indexes and BRIN indexes

**Files:**
- Create: `supabase/migrations/20260330140000_performance_indexes.sql`

- [ ] **Step 1: Create migration file**

`supabase/migrations/20260330140000_performance_indexes.sql`:
```sql
-- Performance indexes for common query patterns
-- All created CONCURRENTLY to avoid blocking writes

-- Dashboard and sales page: filter by user + date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sales_user_sold_at
  ON public.sales(user_id, sold_at DESC);

-- Daily ad spend: filter by user + date
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_daily_ad_spend_user_date_desc
  ON public.daily_ad_spend(user_id, date DESC);

-- Profile FK join on plan_id
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_profiles_plan_id
  ON public.profiles(plan_id);

-- BRIN indexes for append-only timestamp columns (10x smaller than B-tree)

-- Drop existing B-tree on webhook_queue.created_at if exists, replace with BRIN
DROP INDEX CONCURRENTLY IF EXISTS idx_webhook_queue_created;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_webhook_queue_created_brin
  ON public.webhook_queue USING brin(created_at);

-- BRIN on sync_logs.created_at
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_logs_created_brin
  ON public.sync_logs USING brin(created_at);
```

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260330140000_performance_indexes.sql
git commit -m "perf(db): add composite indexes and BRIN indexes for common query patterns"
```

---

### Task 20: Implement cursor-based pagination in admin

**Files:**
- Modify: `packages/backend/src/modules/admin/admin.service.ts`
- Modify: `packages/backend/src/modules/admin/admin.controller.ts`
- Modify: `packages/backend/src/modules/admin/dto/list-users.dto.ts`
- Modify: `packages/frontend/src/hooks/useAdminUsers.ts`

- [ ] **Step 1: Add cursor param to ListUsersDto**

In `packages/backend/src/modules/admin/dto/list-users.dto.ts`, add:

```typescript
  @IsOptional()
  @IsString()
  cursor?: string;
```

- [ ] **Step 2: Support both offset and cursor in admin service**

In `admin.service.ts` `listUsers()`, add cursor support while keeping offset for backward compatibility:

```typescript
  async listUsers(filters: ListUsersFilters) {
    const client = this.supabase.getClient();
    const { page = 1, limit = 20, search, plan, role, facebook_status, cursor } = filters;

    let query = client
      .from('profiles')
      .select(
        'id, user_id, name, email, cpf, plan_id, plan_rules:plan_id(plan), avatar_url, subscription_start, subscription_end, created_at',
        { count: 'exact' },
      );

    if (search) {
      query = query.or(`name.ilike.%${search}%,email.ilike.%${search}%`);
    }

    query = query.order('created_at', { ascending: false });

    // Cursor-based pagination (preferred)
    if (cursor) {
      query = query.lt('created_at', cursor).limit(limit);
    } else {
      // Fallback to offset pagination
      const offset = (page - 1) * limit;
      query = query.range(offset, offset + limit - 1);
    }

    const { data: profiles, count, error } = await query;
    // ... rest of enrichment logic unchanged ...

    const lastItem = enrichedUsers[enrichedUsers.length - 1];
    return {
      users: filteredUsers,
      total_count: count || 0,
      page,
      total_pages: Math.ceil((count || 0) / limit),
      next_cursor: lastItem?.created_at || null,
    };
  }
```

Add `cursor?: string` to the `ListUsersFilters` interface.

- [ ] **Step 3: Pass cursor param from controller**

In `admin.controller.ts` `listUsers()`, add `cursor: dto.cursor` to the filters object.

- [ ] **Step 4: Update frontend hook to use cursor**

In `packages/frontend/src/hooks/useAdminUsers.ts`, the frontend can continue using page-based navigation (the backend supports both). For a future improvement, switch to cursor-based by storing `next_cursor` from the response and passing it as a query param.

- [ ] **Step 5: Verify build**

```bash
cd packages/backend && npm run build && cd ../frontend && npm run build
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/admin/ packages/frontend/src/hooks/useAdminUsers.ts
git commit -m "perf(admin): add cursor-based pagination with offset fallback"
```

---

## Final Task: Update documentation

### Task 21: Update SQL_DATABASE.md with new indexes

**Files:**
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Add the new indexes to the indexes section of SQL_DATABASE.md**

Add entries for:
- `idx_sales_user_sold_at`
- `idx_daily_ad_spend_user_date_desc`
- `idx_profiles_plan_id`
- `idx_webhook_queue_created_brin`
- `idx_sync_logs_created_brin`

- [ ] **Step 2: Commit**

```bash
git add SQL_DATABASE.md
git commit -m "docs: update SQL_DATABASE.md with new performance indexes"
```
