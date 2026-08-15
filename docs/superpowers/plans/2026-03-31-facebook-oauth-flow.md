# Facebook OAuth Flow Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace manual Facebook token input with a standard OAuth 2.0 "Connect with Facebook" flow that obtains and exchanges tokens automatically.

**Architecture:** New `FacebookOAuthService` handles OAuth URL generation, code-to-token exchange, and long-lived token exchange. Two new unguarded routes (`GET /facebook/auth/connect` and `GET /facebook/auth/callback`) drive the redirect flow. The callback saves encrypted tokens to the existing `facebook_connections` table (with 2 new columns), then auto-discovers ad accounts. Frontend replaces the manual token form with a single "Conectar com Facebook" button.

**Tech Stack:** NestJS 10, Fastify, Supabase PostgreSQL, React 18, Facebook Graph API v22.0, AES-256-GCM encryption (existing `EncryptionService`), HMAC-SHA256 for state signing.

---

## File Structure

| Action | File | Responsibility |
|--------|------|----------------|
| Create | `packages/backend/src/modules/facebook/facebook-oauth.service.ts` | OAuth URL generation, code→token exchange, short→long-lived token exchange, state signing/validation |
| Modify | `packages/backend/src/modules/facebook/facebook.controller.ts` | Add 2 new GET routes for `/auth/connect` and `/auth/callback` |
| Modify | `packages/backend/src/modules/facebook/facebook.module.ts` | Register `FacebookOAuthService` as provider |
| Modify | `packages/backend/src/modules/facebook/facebook.service.ts` | Add `saveOAuthConnection()` method to save OAuth-obtained tokens |
| Create | `supabase/migrations/20260331120000_facebook_oauth_columns.sql` | Add `token_expires_at` and `facebook_user_id` columns |
| Modify | `packages/frontend/src/components/integrations/FacebookConnectionForm.tsx` | Replace manual token form with OAuth button + success banner |
| Create | `packages/backend/test/facebook-oauth.service.spec.ts` | Unit tests for OAuth service |

---

### Task 1: Database Migration — Add OAuth Columns

**Files:**
- Create: `supabase/migrations/20260331120000_facebook_oauth_columns.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- Add OAuth-specific columns to facebook_connections
ALTER TABLE public.facebook_connections
  ADD COLUMN IF NOT EXISTS token_expires_at TIMESTAMP WITH TIME ZONE,
  ADD COLUMN IF NOT EXISTS facebook_user_id TEXT;

-- Make app_id and app_secret nullable (OAuth flow doesn't use per-user app credentials)
ALTER TABLE public.facebook_connections
  ALTER COLUMN app_id DROP NOT NULL,
  ALTER COLUMN app_secret DROP NOT NULL;

-- Index facebook_user_id for lookups during OAuth callback
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_facebook_connections_fb_user_id
  ON public.facebook_connections (facebook_user_id)
  WHERE facebook_user_id IS NOT NULL;

COMMENT ON COLUMN public.facebook_connections.token_expires_at IS 'Expiry of the long-lived token (60 days from exchange)';
COMMENT ON COLUMN public.facebook_connections.facebook_user_id IS 'Facebook user ID that authorized the token';
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `npx supabase db push --dry-run` (or apply locally if using local Supabase)
Expected: Migration applies without errors. The two columns are added, app_id/app_secret are now nullable.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260331120000_facebook_oauth_columns.sql
git commit -m "feat(db): add token_expires_at and facebook_user_id columns to facebook_connections"
```

---

### Task 2: Create `FacebookOAuthService`

**Files:**
- Create: `packages/backend/src/modules/facebook/facebook-oauth.service.ts`
- Create: `packages/backend/test/facebook-oauth.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Create `packages/backend/test/facebook-oauth.service.spec.ts`:

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { FacebookOAuthService } from '../src/modules/facebook/facebook-oauth.service';

describe('FacebookOAuthService', () => {
  let service: FacebookOAuthService;
  const mockConfig = {
    getOrThrow: jest.fn((key: string) => {
      const map: Record<string, string> = {
        FACEBOOK_APP_ID: '1314325524090040',
        FACEBOOK_APP_SECRET: 'test_app_secret_123',
        FACEBOOK_REDIRECT_URI: 'http://localhost:3001/api/facebook/auth/callback',
        ENCRYPTION_KEY: 'test-encryption-key-for-hmac-signing',
      };
      return map[key];
    }),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FacebookOAuthService,
        { provide: ConfigService, useValue: mockConfig },
      ],
    }).compile();

    service = module.get<FacebookOAuthService>(FacebookOAuthService);
  });

  describe('buildAuthorizationUrl', () => {
    it('should generate a valid Facebook OAuth URL with correct params', () => {
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);

      expect(parsed.origin).toBe('https://www.facebook.com');
      expect(parsed.pathname).toBe('/v22.0/dialog/oauth');
      expect(parsed.searchParams.get('client_id')).toBe('1314325524090040');
      expect(parsed.searchParams.get('redirect_uri')).toBe(
        'http://localhost:3001/api/facebook/auth/callback',
      );
      expect(parsed.searchParams.get('scope')).toBe(
        'ads_read,read_insights,business_management,public_profile',
      );
      expect(parsed.searchParams.get('state')).toBeTruthy();
    });

    it('should include userId in the state that can be verified later', () => {
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;

      const userId = service.verifyState(state);
      expect(userId).toBe('user-uuid-123');
    });
  });

  describe('verifyState', () => {
    it('should return null for tampered state', () => {
      const url = service.buildAuthorizationUrl('user-uuid-123');
      const parsed = new URL(url);
      const state = parsed.searchParams.get('state')!;

      // Tamper with the state
      const tampered = 'tampered.' + state.split('.').slice(1).join('.');
      expect(service.verifyState(tampered)).toBeNull();
    });

    it('should return null for expired state (if we can test that)', () => {
      // State has a 10-minute TTL embedded
      const result = service.verifyState('invalid.state.value');
      expect(result).toBeNull();
    });

    it('should return null for empty or malformed state', () => {
      expect(service.verifyState('')).toBeNull();
      expect(service.verifyState('no-dots-here')).toBeNull();
    });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd packages/backend && npx jest test/facebook-oauth.service.spec.ts --verbose`
Expected: FAIL — `Cannot find module '../src/modules/facebook/facebook-oauth.service'`

- [ ] **Step 3: Implement `FacebookOAuthService`**

Create `packages/backend/src/modules/facebook/facebook-oauth.service.ts`:

```typescript
import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';

const FB_API_VERSION = 'v22.0';
const OAUTH_SCOPES = 'ads_read,read_insights,business_management,public_profile';
const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

@Injectable()
export class FacebookOAuthService {
  private readonly logger = new Logger(FacebookOAuthService.name);
  private readonly appId: string;
  private readonly appSecret: string;
  private readonly redirectUri: string;
  private readonly signingKey: string;

  constructor(private readonly config: ConfigService) {
    this.appId = this.config.getOrThrow<string>('FACEBOOK_APP_ID');
    this.appSecret = this.config.getOrThrow<string>('FACEBOOK_APP_SECRET');
    this.redirectUri = this.config.getOrThrow<string>('FACEBOOK_REDIRECT_URI');
    this.signingKey = this.config.getOrThrow<string>('ENCRYPTION_KEY');
  }

  buildAuthorizationUrl(userId: string): string {
    const state = this.createState(userId);
    const params = new URLSearchParams({
      client_id: this.appId,
      redirect_uri: this.redirectUri,
      scope: OAUTH_SCOPES,
      response_type: 'code',
      state,
    });
    return `https://www.facebook.com/${FB_API_VERSION}/dialog/oauth?${params.toString()}`;
  }

  verifyState(state: string): string | null {
    try {
      const parts = state.split('.');
      if (parts.length !== 3) return null;

      const [payloadB64, timestampStr, signature] = parts;
      const payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
      const timestamp = parseInt(timestampStr, 10);

      // Check expiry
      if (Date.now() - timestamp > STATE_TTL_MS) {
        this.logger.warn('OAuth state expired');
        return null;
      }

      // Verify signature
      const expectedSig = this.sign(`${payloadB64}.${timestampStr}`);
      const sigBuffer = Buffer.from(signature, 'base64url');
      const expectedBuffer = Buffer.from(expectedSig, 'base64url');

      if (sigBuffer.length !== expectedBuffer.length) return null;
      if (!timingSafeEqual(sigBuffer, expectedBuffer)) {
        this.logger.warn('OAuth state signature mismatch');
        return null;
      }

      return payload;
    } catch {
      return null;
    }
  }

  async exchangeCodeForToken(code: string): Promise<string> {
    const params = new URLSearchParams({
      client_id: this.appId,
      client_secret: this.appSecret,
      redirect_uri: this.redirectUri,
      code,
    });

    const url = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      this.logger.error(`Token exchange failed: ${JSON.stringify(data.error)}`);
      throw new BadRequestException(
        data.error.message || 'Failed to exchange authorization code',
      );
    }

    return data.access_token;
  }

  async exchangeForLongLivedToken(shortLivedToken: string): Promise<{ accessToken: string; expiresAt: Date }> {
    const params = new URLSearchParams({
      grant_type: 'fb_exchange_token',
      client_id: this.appId,
      client_secret: this.appSecret,
      fb_exchange_token: shortLivedToken,
    });

    const url = `https://graph.facebook.com/${FB_API_VERSION}/oauth/access_token?${params.toString()}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      this.logger.error(`Long-lived token exchange failed: ${JSON.stringify(data.error)}`);
      throw new BadRequestException(
        data.error.message || 'Failed to exchange for long-lived token',
      );
    }

    const expiresInSeconds = data.expires_in || 5184000; // default 60 days
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);

    return { accessToken: data.access_token, expiresAt };
  }

  async getFacebookUserId(accessToken: string): Promise<{ id: string; name: string }> {
    const url = `https://graph.facebook.com/${FB_API_VERSION}/me?fields=id,name&access_token=${accessToken}`;
    const response = await fetch(url);
    const data = await response.json();

    if (data.error) {
      throw new BadRequestException(data.error.message || 'Failed to get Facebook user info');
    }

    return { id: data.id, name: data.name };
  }

  private createState(userId: string): string {
    const payloadB64 = Buffer.from(userId, 'utf8').toString('base64url');
    const timestamp = Date.now().toString();
    const signature = this.sign(`${payloadB64}.${timestamp}`);
    return `${payloadB64}.${timestamp}.${signature}`;
  }

  private sign(data: string): string {
    return createHmac('sha256', this.signingKey).update(data).digest('base64url');
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `cd packages/backend && npx jest test/facebook-oauth.service.spec.ts --verbose`
Expected: All 5 tests PASS

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/facebook/facebook-oauth.service.ts packages/backend/test/facebook-oauth.service.spec.ts
git commit -m "feat(backend): add FacebookOAuthService with state signing and token exchange"
```

---

### Task 3: Register `FacebookOAuthService` in the Module

**Files:**
- Modify: `packages/backend/src/modules/facebook/facebook.module.ts`

- [ ] **Step 1: Add the provider**

In `packages/backend/src/modules/facebook/facebook.module.ts`, add the import and register the provider:

```typescript
import { Module } from '@nestjs/common';
import { FacebookController } from './facebook.controller';
import { FacebookService } from './facebook.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { InsightsService } from './insights.service';
import { SyncService } from './sync.service';
import { SaleMatcherService } from './sale-matcher.service';

@Module({
  controllers: [FacebookController],
  providers: [FacebookService, FacebookOAuthService, InsightsService, SyncService, SaleMatcherService],
  exports: [FacebookService, InsightsService, SaleMatcherService],
})
export class FacebookModule {}
```

- [ ] **Step 2: Verify the app still compiles**

Run: `cd packages/backend && npx nest build`
Expected: Compilation succeeds (the service uses `ConfigService` which is globally available via `ConfigModule.forRoot({ isGlobal: true })` in `app.module.ts`).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/facebook/facebook.module.ts
git commit -m "feat(backend): register FacebookOAuthService in FacebookModule"
```

---

### Task 4: Add `saveOAuthConnection` to `FacebookService`

**Files:**
- Modify: `packages/backend/src/modules/facebook/facebook.service.ts`

- [ ] **Step 1: Add the `saveOAuthConnection` method**

Add this method to the `FacebookService` class, before the `// Private helpers` section (before line 744):

```typescript
  // ============================================
  // Save connection from OAuth flow
  // ============================================
  async saveOAuthConnection(
    userId: string,
    accessToken: string,
    facebookUserId: string,
    tokenExpiresAt: Date,
  ): Promise<{ connectionId: string }> {
    const client = this.supabase.getClient();

    // Encrypt the access token
    const encAccessToken = this.encryption.encrypt(accessToken);

    // Check if this user already has a connection with this Facebook user ID
    const { data: existing } = await client
      .from('facebook_connections')
      .select('id')
      .eq('user_id', userId)
      .eq('facebook_user_id', facebookUserId)
      .maybeSingle();

    if (existing) {
      // Update the existing connection's token
      await client
        .from('facebook_connections')
        .update({
          access_token: encAccessToken,
          token_expires_at: tokenExpiresAt.toISOString(),
          is_valid: true,
          last_validated_at: new Date().toISOString(),
        })
        .eq('id', existing.id);

      return { connectionId: existing.id };
    }

    // Check plan limits before creating a new connection
    await this.checkPlanLimits(userId);

    const { data: inserted, error } = await client
      .from('facebook_connections')
      .insert({
        user_id: userId,
        access_token: encAccessToken,
        ad_account_id: 'pending_oauth', // placeholder until account selection
        facebook_user_id: facebookUserId,
        token_expires_at: tokenExpiresAt.toISOString(),
        is_valid: true,
        last_validated_at: new Date().toISOString(),
      })
      .select('id')
      .single();

    if (error) throw error;

    return { connectionId: inserted.id };
  }
```

- [ ] **Step 2: Verify compilation**

Run: `cd packages/backend && npx nest build`
Expected: Compilation succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/facebook/facebook.service.ts
git commit -m "feat(backend): add saveOAuthConnection method to FacebookService"
```

---

### Task 5: Add OAuth Routes to `FacebookController`

**Files:**
- Modify: `packages/backend/src/modules/facebook/facebook.controller.ts`

This is the core of the flow. The two new routes do NOT use `AuthGuard` — `/auth/connect` reads the user token from the query param (passed by the frontend), and `/auth/callback` validates the signed state. We use `@Req()` and `@Res()` from Fastify for redirects.

- [ ] **Step 1: Update the controller with OAuth routes**

Replace the full contents of `packages/backend/src/modules/facebook/facebook.controller.ts`:

```typescript
import {
  Controller,
  Post,
  Get,
  Delete,
  Patch,
  Param,
  Body,
  Query,
  Req,
  Res,
  UseGuards,
  Logger,
  UnauthorizedException,
  BadRequestException,
} from '@nestjs/common';
import { FastifyRequest, FastifyReply } from 'fastify';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { SupabaseService } from '../../shared/services/supabase.service';
import { FacebookService } from './facebook.service';
import { FacebookOAuthService } from './facebook-oauth.service';
import { InsightsService } from './insights.service';
import { SaleMatcherService } from './sale-matcher.service';
import { ConfigService } from '@nestjs/config';

@Controller('facebook')
export class FacebookController {
  private readonly logger = new Logger(FacebookController.name);

  constructor(
    private readonly facebook: FacebookService,
    private readonly oauth: FacebookOAuthService,
    private readonly insights: InsightsService,
    private readonly saleMatcher: SaleMatcherService,
    private readonly supabase: SupabaseService,
    private readonly config: ConfigService,
  ) {}

  // ============================================
  // OAuth endpoints (no AuthGuard — redirect-based)
  // ============================================

  @Get('auth/connect')
  async authConnect(
    @Query('token') token: string,
    @Res() reply: FastifyReply,
  ) {
    if (!token) {
      throw new UnauthorizedException('Missing authentication token');
    }

    const user = await this.supabase.getUserFromToken(token);
    if (!user) {
      throw new UnauthorizedException('Invalid or expired token');
    }

    const authUrl = this.oauth.buildAuthorizationUrl(user.id);
    return reply.redirect(302, authUrl);
  }

  @Get('auth/callback')
  async authCallback(
    @Query('code') code: string,
    @Query('state') state: string,
    @Query('error') fbError: string,
    @Query('error_description') errorDescription: string,
    @Res() reply: FastifyReply,
  ) {
    const frontendUrl = this.config.getOrThrow<string>('FRONTEND_URL');

    // Handle Facebook authorization denial
    if (fbError) {
      this.logger.warn(`Facebook OAuth denied: ${fbError} — ${errorDescription}`);
      return reply.redirect(
        302,
        `${frontendUrl}/dashboard/integrations?error=${encodeURIComponent(errorDescription || fbError)}`,
      );
    }

    if (!code || !state) {
      return reply.redirect(
        302,
        `${frontendUrl}/dashboard/integrations?error=${encodeURIComponent('Parâmetros ausentes no callback')}`,
      );
    }

    // Validate state (CSRF protection)
    const userId = this.oauth.verifyState(state);
    if (!userId) {
      this.logger.warn('OAuth callback: invalid or expired state');
      return reply.redirect(
        302,
        `${frontendUrl}/dashboard/integrations?error=${encodeURIComponent('Sessão expirada. Tente novamente.')}`,
      );
    }

    try {
      // Step 1: Exchange code for short-lived token
      const shortLivedToken = await this.oauth.exchangeCodeForToken(code);

      // Step 2: Exchange for long-lived token (60 days)
      const { accessToken, expiresAt } =
        await this.oauth.exchangeForLongLivedToken(shortLivedToken);

      // Step 3: Get Facebook user info
      const fbUser = await this.oauth.getFacebookUserId(accessToken);

      // Step 4: Save encrypted token to database
      const { connectionId } = await this.facebook.saveOAuthConnection(
        userId,
        accessToken,
        fbUser.id,
        expiresAt,
      );

      this.logger.log(
        `OAuth connection saved for user ${userId}, FB user ${fbUser.id}, connection ${connectionId}`,
      );

      // Step 5: Auto-discover ad accounts in background (fire and forget)
      this.discoverAccountsInBackground(userId, accessToken, connectionId).catch(
        (err) => this.logger.error(`Auto-discover failed: ${err.message}`),
      );

      return reply.redirect(
        302,
        `${frontendUrl}/dashboard/integrations?connected=true`,
      );
    } catch (err: any) {
      this.logger.error(`OAuth callback error: ${err.message}`);
      return reply.redirect(
        302,
        `${frontendUrl}/dashboard/integrations?error=${encodeURIComponent('Erro ao conectar com o Facebook. Tente novamente.')}`,
      );
    }
  }

  // ============================================
  // Connection endpoints (AuthGuard protected)
  // ============================================

  @Post('connections')
  @UseGuards(AuthGuard)
  async saveConnection(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.saveConnection(userId, body);
  }

  @Get('connections')
  @UseGuards(AuthGuard)
  async getConnections(@CurrentUser('id') userId: string) {
    return this.facebook.getConnections(userId);
  }

  @Delete('connections/:id')
  @UseGuards(AuthGuard)
  async deleteConnection(
    @CurrentUser('id') userId: string,
    @Param('id') connectionId: string,
  ) {
    return this.facebook.deleteConnection(userId, connectionId);
  }

  @Post('connections/:id/validate')
  @UseGuards(AuthGuard)
  async validateConnection(
    @CurrentUser('id') userId: string,
    @Param('id') connectionId: string,
  ) {
    return this.facebook.validateConnection(userId, connectionId);
  }

  @Post('connections/list-accounts')
  @UseGuards(AuthGuard)
  async listAccounts(@Body() body: { access_token: string }) {
    return this.facebook.listAccounts(body.access_token);
  }

  @Post('connections/:id/list-accounts')
  @UseGuards(AuthGuard)
  async listAccountsFromConnection(
    @CurrentUser('id') userId: string,
    @Param('id') connectionId: string,
  ) {
    return this.facebook.listAccountsFromConnection(userId, connectionId);
  }

  @Post('connections/save-multiple')
  @UseGuards(AuthGuard)
  async saveMultiple(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.saveMultiple(userId, body);
  }

  @Patch('connections/:id/token')
  @UseGuards(AuthGuard)
  async updateToken(
    @CurrentUser('id') userId: string,
    @Param('id') connectionId: string,
    @Body() body: { access_token: string },
  ) {
    return this.facebook.updateToken(userId, connectionId, body.access_token);
  }

  // ============================================
  // Insights endpoints
  // ============================================

  @Post('insights/validate')
  @UseGuards(AuthGuard)
  async validateInsights(
    @CurrentUser('id') userId: string,
    @Body() body: { connection_id?: string },
  ) {
    return this.insights.validate(userId, body.connection_id);
  }

  @Post('insights/sync')
  @UseGuards(AuthGuard)
  async startSync(
    @CurrentUser('id') userId: string,
    @Body() body: { connection_id?: string; period?: string; since?: string; until?: string },
  ) {
    return this.insights.startSync(userId, body.connection_id, {
      period: body.period,
      since: body.since,
      until: body.until,
    });
  }

  @Get('insights/job/:jobId')
  @UseGuards(AuthGuard)
  async checkJob(
    @CurrentUser('id') userId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.insights.checkJob(jobId, userId);
  }

  // ============================================
  // Budget & status endpoints
  // ============================================

  @Patch('budget')
  @UseGuards(AuthGuard)
  async updateBudget(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.updateBudget(userId, body);
  }

  @Patch('campaigns/status')
  @UseGuards(AuthGuard)
  async updateStatus(@CurrentUser('id') userId: string, @Body() body: any) {
    return this.facebook.updateStatus(userId, body);
  }

  // ============================================
  // Rematch endpoint
  // ============================================

  @Post('rematch')
  @UseGuards(AuthGuard)
  async rematchSales(@CurrentUser('id') userId: string) {
    return this.saleMatcher.rematchSales(userId);
  }

  // ============================================
  // Private helpers
  // ============================================

  private async discoverAccountsInBackground(
    userId: string,
    accessToken: string,
    connectionId: string,
  ): Promise<void> {
    try {
      const { accounts } = await this.facebook.listAccounts(accessToken);
      if (accounts && accounts.length > 0) {
        this.logger.log(
          `Auto-discovered ${accounts.length} ad accounts for user ${userId}`,
        );
      }
    } catch (err: any) {
      this.logger.warn(
        `Auto-discover ad accounts failed for connection ${connectionId}: ${err.message}`,
      );
    }
  }
}
```

Key design decisions:
- `GET /auth/connect` accepts `?token=<supabase_jwt>` as query param because the frontend does a full redirect (no way to send Authorization header). It validates the token server-side via `supabase.getUserFromToken()`.
- `GET /auth/callback` validates the signed state instead of using AuthGuard.
- Both OAuth routes are OUTSIDE the class-level `@UseGuards(AuthGuard)` — the guard is now applied per-route.
- `FRONTEND_URL` env var is needed for the redirect. Add it to `.env`.

- [ ] **Step 2: Verify compilation**

Run: `cd packages/backend && npx nest build`
Expected: Compilation succeeds.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/facebook/facebook.controller.ts
git commit -m "feat(backend): add OAuth connect and callback routes to FacebookController"
```

---

### Task 6: Add Environment Variables

**Files:**
- Modify: `packages/backend/.env` (local only, never committed)

- [ ] **Step 1: Add the required variables to the local `.env` file**

Add these lines to `packages/backend/.env`:

```env
FACEBOOK_APP_ID=1314325524090040
FACEBOOK_APP_SECRET=<your_app_secret>
FACEBOOK_REDIRECT_URI=http://localhost:3001/api/facebook/auth/callback
FRONTEND_URL=http://localhost:5173
```

Note: `FRONTEND_URL` is used by the callback to redirect back to the frontend. In production (Render), this should be set to the Vercel domain.

- [ ] **Step 2: Verify the backend starts without errors**

Run: `cd packages/backend && npm run start:dev`
Expected: Server starts on port 3001 without crashing. The new `FacebookOAuthService` resolves its config values.

- [ ] **Step 3: No commit needed** (`.env` is gitignored)

---

### Task 7: Update Frontend — Replace Manual Form with OAuth Button

**Files:**
- Modify: `packages/frontend/src/components/integrations/FacebookConnectionForm.tsx`

- [ ] **Step 1: Replace the component**

Replace the full contents of `packages/frontend/src/components/integrations/FacebookConnectionForm.tsx`:

```tsx
import { useState, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Facebook, CheckCircle, AlertCircle, Loader2, Trash2, Layers, Search, Pencil, Save, ExternalLink } from 'lucide-react';
import { useFacebookConnection, FacebookConnectionInfo, FacebookAdAccount } from '@/hooks/useFacebookConnection';
import { usePlanRules } from '@/hooks/usePlanRules';
import { useWorkspaces } from '@/hooks/useWorkspaces';
import { useWorkspaceContext } from '@/contexts/WorkspaceContext';
import { useAuth } from '@/contexts/AuthContext';
import { useToast } from '@/hooks/use-toast';
import { supabase } from '@/integrations/supabase/client';
import { SyncScheduleSection } from './SyncScheduleSection';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3001/api';

const ACCOUNT_STATUS_MAP: Record<number, { label: string; className: string }> = {
  1: { label: 'Ativa', className: 'bg-[#d1fe17] text-black' },
  2: { label: 'Desativada', className: 'bg-red-500/20 text-red-400' },
  3: { label: 'Pendente', className: 'bg-yellow-500/20 text-yellow-400' },
  7: { label: 'Pendente', className: 'bg-yellow-500/20 text-yellow-400' },
  100: { label: 'Fechada', className: 'bg-white/10 text-[#a1a4a5]' },
  101: { label: 'Fechada', className: 'bg-white/10 text-[#a1a4a5]' },
};

function ConnectionCard({
  connection,
  index,
  saving,
  onValidate,
  onDelete,
  onListAccounts,
  onSaveMultiple,
  allConnections,
}: {
  connection: FacebookConnectionInfo;
  index: number;
  saving: boolean;
  onValidate: (connectionId: string) => Promise<boolean>;
  onDelete: (connectionId: string) => Promise<void>;
  onListAccounts: (connectionId: string) => Promise<FacebookAdAccount[]>;
  onSaveMultiple: (token: string, accounts: FacebookAdAccount[], sourceConnectionId?: string) => Promise<boolean>;
  allConnections: FacebookConnectionInfo[];
}) {
  const [editing, setEditing] = useState(false);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [adAccounts, setAdAccounts] = useState<FacebookAdAccount[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [initialSelectedIds, setInitialSelectedIds] = useState<Set<string>>(new Set());
  const [searchFilter, setSearchFilter] = useState('');

  const handleEdit = async () => {
    setEditing(true);
    setLoadingAccounts(true);
    const accounts = await onListAccounts(connection.id);
    setAdAccounts(accounts);
    const preSelected = new Set<string>();
    for (const acc of accounts) {
      const accLast4 = acc.id.replace('act_', '').slice(-4);
      for (const conn of allConnections) {
        if (conn.ad_account_id_masked?.endsWith(accLast4)) {
          preSelected.add(acc.id);
        }
      }
    }
    setSelectedIds(preSelected);
    setInitialSelectedIds(new Set(preSelected));
    setLoadingAccounts(false);
  };

  const toggleAccount = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const hasChanges = (() => {
    if (selectedIds.size !== initialSelectedIds.size) return true;
    for (const id of selectedIds) {
      if (!initialSelectedIds.has(id)) return true;
    }
    return false;
  })();

  const newAccountsToAdd = adAccounts.filter(a => selectedIds.has(a.id) && !initialSelectedIds.has(a.id));

  const handleSaveChanges = async () => {
    if (newAccountsToAdd.length === 0) return;
    setSavingEdit(true);
    const success = await onSaveMultiple('', newAccountsToAdd, connection.id);
    setSavingEdit(false);
    if (success) handleClose();
  };

  const filteredAccounts = adAccounts.filter(a => {
    const q = searchFilter.toLowerCase();
    return !q || a.name.toLowerCase().includes(q) || a.id.includes(q) || (a.business_name || '').toLowerCase().includes(q);
  });

  const handleClose = () => {
    setEditing(false);
    setAdAccounts([]);
    setSelectedIds(new Set());
    setInitialSelectedIds(new Set());
    setSearchFilter('');
  };

  return (
    <div className="rounded-lg border border-white/5 bg-white/[0.02] p-4 space-y-3">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium text-white">
            Conta {index + 1}: {connection.ad_account_id_masked || 'Não configurada'}
          </span>
          <Badge
            variant={connection.is_valid ? 'default' : 'secondary'}
            className={connection.is_valid ? 'bg-[#d1fe17] text-black text-[10px]' : 'bg-white/15 text-[#a1a4a5]/80 text-[10px]'}
          >
            {connection.is_valid ? 'Ativa' : 'Pendente'}
          </Badge>
        </div>
        <div className="flex items-center gap-1">
          {!connection.is_valid && !editing && (
            <Button variant="ghost" size="sm" onClick={() => onValidate(connection.id)} disabled={saving}
              className="text-xs text-[#d1fe17] hover:text-[#d1fe17]/80">
              {saving ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <CheckCircle className="mr-1 h-3 w-3" />}
              Validar
            </Button>
          )}
          <Button variant="ghost" size="icon" className="h-8 w-8 text-[#a1a4a5]/40 hover:text-white" onClick={editing ? handleClose : handleEdit}>
            <Pencil className="h-3.5 w-3.5" />
          </Button>
          <AlertDialog>
            <AlertDialogTrigger asChild>
              <Button variant="ghost" size="icon" className="h-8 w-8 text-[#a1a4a5]/40 hover:text-red-400">
                <Trash2 className="h-3.5 w-3.5" />
              </Button>
            </AlertDialogTrigger>
            <AlertDialogContent>
              <AlertDialogHeader>
                <AlertDialogTitle>Remover conexão?</AlertDialogTitle>
                <AlertDialogDescription>
                  Esta ação irá remover as credenciais desta conta de anúncios.
                </AlertDialogDescription>
              </AlertDialogHeader>
              <AlertDialogFooter>
                <AlertDialogCancel>Cancelar</AlertDialogCancel>
                <AlertDialogAction onClick={() => onDelete(connection.id)} className="bg-white/15 text-white hover:bg-white/20">
                  Remover
                </AlertDialogAction>
              </AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>
        </div>
      </div>

      {editing && loadingAccounts && (
        <div className="flex items-center justify-center py-6 gap-2">
          <Loader2 className="h-5 w-5 animate-spin text-[#d1fe17]" />
          <span className="text-sm text-[#a1a4a5]/70">Buscando contas de anúncios...</span>
        </div>
      )}

      {editing && !loadingAccounts && adAccounts.length > 0 && (
        <div className="space-y-3 pt-1">
          <p className="text-xs text-[#a1a4a5]/60">
            Contas de anúncios disponíveis no token atual ({adAccounts.length}):
          </p>

          {adAccounts.length > 5 && (
            <Input
              placeholder="Filtrar por nome ou ID..."
              value={searchFilter}
              onChange={(e) => setSearchFilter(e.target.value)}
              className="h-8 text-xs"
            />
          )}

          <div className="max-h-52 overflow-y-auto space-y-1 pr-1">
            {filteredAccounts.map(account => {
              const statusInfo = ACCOUNT_STATUS_MAP[account.account_status] || { label: `Status ${account.account_status}`, className: 'bg-white/10 text-[#a1a4a5]' };
              const isSelected = selectedIds.has(account.id);

              return (
                <label
                  key={account.id}
                  className={`flex items-center gap-3 p-3 rounded-lg cursor-pointer transition-colors ${
                    isSelected ? 'bg-[#d1fe17]/5 border border-[#d1fe17]/20' : 'bg-white/[0.02] border border-white/5 hover:bg-white/[0.04]'
                  }`}
                >
                  <Checkbox
                    checked={isSelected}
                    onCheckedChange={() => toggleAccount(account.id)}
                    className="data-[state=checked]:bg-[#d1fe17] data-[state=checked]:border-[#d1fe17]"
                  />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white truncate">{account.name}</span>
                      <Badge className={`text-[9px] px-1.5 py-0 ${statusInfo.className}`}>
                        {statusInfo.label}
                      </Badge>
                    </div>
                    <div className="flex items-center gap-2 mt-0.5">
                      <span className="text-[11px] text-[#a1a4a5]/50 font-mono">{account.id}</span>
                      {account.business_name && (
                        <span className="text-[11px] text-[#a1a4a5]/40">• {account.business_name}</span>
                      )}
                      <span className="text-[11px] text-[#a1a4a5]/40">• {account.currency}</span>
                    </div>
                  </div>
                </label>
              );
            })}
          </div>

          <div className="flex gap-2">
            <Button
              onClick={handleSaveChanges}
              disabled={!hasChanges || savingEdit}
              size="sm"
              className="bg-[#d1fe17] text-black hover:bg-[#d1fe17]/90 disabled:opacity-40"
            >
              {savingEdit ? <Loader2 className="mr-1 h-3 w-3 animate-spin" /> : <Save className="mr-1 h-3 w-3" />}
              {newAccountsToAdd.length > 0
                ? `Salvar (${newAccountsToAdd.length} nova${newAccountsToAdd.length !== 1 ? 's' : ''})`
                : 'Salvar'}
            </Button>
            <Button onClick={handleClose} variant="ghost" size="sm">Fechar</Button>
          </div>
        </div>
      )}

      {editing && !loadingAccounts && adAccounts.length === 0 && (
        <div className="py-4 text-center">
          <AlertCircle className="h-5 w-5 text-[#a1a4a5]/40 mx-auto mb-1" />
          <p className="text-xs text-[#a1a4a5]/50">Nenhuma conta encontrada. O token pode estar expirado.</p>
          <Button variant="ghost" size="sm" onClick={handleClose} className="mt-2 text-xs">Fechar</Button>
        </div>
      )}

      {!editing && connection.is_valid && connection.last_validated_at && (
        <p className="text-xs text-[#a1a4a5]/50">
          Última validação: {new Date(connection.last_validated_at).toLocaleString('pt-BR')}
        </p>
      )}
    </div>
  );
}

export function FacebookConnectionForm() {
  const {
    connections, allConnections, loading, saving,
    validateConnection, deleteConnection,
    listAdAccountsFromConnection, saveMultipleConnections,
  } = useFacebookConnection();
  const { getLimit } = usePlanRules();
  const maxAccounts = getLimit('max_ad_accounts');
  const { workspaces } = useWorkspaceContext();
  const { addConnection, removeConnection } = useWorkspaces();
  const { user } = useAuth();
  const { toast } = useToast();
  const [searchParams, setSearchParams] = useSearchParams();
  const [connecting, setConnecting] = useState(false);

  const canAddMore = connections.length < maxAccounts;

  // Handle OAuth callback query params
  useEffect(() => {
    const connected = searchParams.get('connected');
    const error = searchParams.get('error');

    if (connected === 'true') {
      toast({
        title: 'Facebook conectado com sucesso!',
        description: 'Suas contas de anúncios foram detectadas automaticamente.',
      });
      // Clean the URL
      searchParams.delete('connected');
      setSearchParams(searchParams, { replace: true });
    }

    if (error) {
      toast({
        title: 'Erro ao conectar',
        description: decodeURIComponent(error),
        variant: 'destructive',
      });
      searchParams.delete('error');
      setSearchParams(searchParams, { replace: true });
    }
  }, []);

  const handleConnectFacebook = async () => {
    setConnecting(true);
    try {
      const { data } = await supabase.auth.getSession();
      const token = data?.session?.access_token;
      if (!token) {
        toast({
          title: 'Erro',
          description: 'Você precisa estar autenticado.',
          variant: 'destructive',
        });
        setConnecting(false);
        return;
      }
      window.location.href = `${API_URL}/facebook/auth/connect?token=${encodeURIComponent(token)}`;
    } catch {
      setConnecting(false);
    }
  };

  const isConnectionInWorkspace = (connId: string, wsId: string) => {
    const ws = workspaces.find(w => w.id === wsId);
    return ws?.workspace_connections?.some(wc => wc.facebook_connection_id === connId) || false;
  };

  const toggleConnectionWorkspace = async (connId: string, wsId: string) => {
    if (isConnectionInWorkspace(connId, wsId)) {
      await removeConnection(wsId, connId);
    } else {
      await addConnection(wsId, connId);
    }
  };

  if (loading) {
    return (
      <Card>
        <CardContent className="flex items-center justify-center py-12">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Facebook className="h-8 w-8 text-[#a1a4a5]/60" />
            <div>
              <CardTitle className="text-lg">Facebook Ads - Contas de Anúncios</CardTitle>
              <CardDescription>
                Gerencie suas contas de anúncios ({connections.length}/{maxAccounts === Infinity ? '∞' : maxAccounts})
              </CardDescription>
            </div>
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Existing connections */}
        {connections.map((conn, index) => (
          <div key={conn.id} className="space-y-2">
            <ConnectionCard
              connection={conn}
              index={index}
              saving={saving}
              onValidate={validateConnection}
              onDelete={deleteConnection}
              onListAccounts={listAdAccountsFromConnection}
              onSaveMultiple={saveMultipleConnections}
              allConnections={allConnections || connections}
            />
            {workspaces.length > 0 && (
              <div className="flex items-center gap-3 px-4 py-2 rounded-lg bg-white/[0.02] border border-white/5">
                <Layers className="h-3.5 w-3.5 text-[#a1a4a5]/50 shrink-0" />
                <span className="text-[10px] uppercase tracking-wider text-[#a1a4a5]/50 font-medium shrink-0">Áreas:</span>
                <div className="flex flex-wrap gap-3">
                  {workspaces.map(ws => (
                    <label key={ws.id} className="flex items-center gap-1.5 cursor-pointer">
                      <Switch
                        checked={isConnectionInWorkspace(conn.id, ws.id)}
                        onCheckedChange={() => toggleConnectionWorkspace(conn.id, ws.id)}
                        className="h-4 w-7 data-[state=checked]:bg-[#d1fe17]"
                      />
                      <span className="text-xs text-[#a1a4a5]/70">{ws.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        ))}

        {/* Connect with Facebook button */}
        {canAddMore && (
          <Button
            onClick={handleConnectFacebook}
            disabled={connecting}
            className="w-full bg-[#1877F2] hover:bg-[#1877F2]/90 text-white font-medium py-5"
          >
            {connecting ? (
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
            ) : (
              <Facebook className="mr-2 h-5 w-5" />
            )}
            {connecting ? 'Redirecionando...' : 'Conectar com Facebook'}
          </Button>
        )}

        {!canAddMore && connections.length > 0 && (
          <p className="text-xs text-[#a1a4a5]/40 text-center">
            Limite de contas do seu plano atingido. Faça upgrade para conectar mais contas.
          </p>
        )}

        {connections.some(c => c.is_valid) && <SyncScheduleSection />}
      </CardContent>
    </Card>
  );
}
```

Key changes from the original:
- Removed: `FlowStep` state machine, `accessToken` input field, `handleFetchAccounts`, `token-input` step, `loading-accounts` step, `select-accounts` step, `saving` step, entire manual token flow
- Added: `handleConnectFacebook()` — gets Supabase session token, redirects to `/api/facebook/auth/connect?token=...`
- Added: `useSearchParams` to read `?connected=true` or `?error=...` from URL after OAuth callback
- Kept: `ConnectionCard` (for managing existing connections), workspace toggles, `SyncScheduleSection`, plan limit check
- Style: "Conectar com Facebook" button uses Facebook brand blue (#1877F2)

- [ ] **Step 2: Verify frontend compiles**

Run: `cd packages/frontend && npx vite build`
Expected: Build succeeds without errors.

- [ ] **Step 3: Commit**

```bash
git add packages/frontend/src/components/integrations/FacebookConnectionForm.tsx
git commit -m "feat(frontend): replace manual token form with OAuth 'Conectar com Facebook' button"
```

---

### Task 8: Update `SQL_DATABASE.md` Documentation

**Files:**
- Modify: `SQL_DATABASE.md`

- [ ] **Step 1: Add the new columns to the `facebook_connections` table documentation**

Find the `facebook_connections` table section in `SQL_DATABASE.md` and add the two new columns:

```markdown
| token_expires_at   | TIMESTAMP WITH TIME ZONE | NULL    | Expiry of the long-lived OAuth token (60 days) |
| facebook_user_id   | TEXT                     | NULL    | Facebook user ID that authorized the token      |
```

Also note that `app_id` and `app_secret` are now nullable (OAuth flow doesn't use per-user app credentials).

- [ ] **Step 2: Commit**

```bash
git add SQL_DATABASE.md
git commit -m "docs: update SQL_DATABASE.md with facebook_connections OAuth columns"
```

---

### Task 9: Update Feature Documentation

**Files:**
- Modify: `docs/features/07-integrations/facebook-connection.md` (or create if it doesn't exist)

- [ ] **Step 1: Update the Facebook connection documentation**

Add/update a section describing the OAuth flow:

```markdown
## Authentication Flow (OAuth 2.0)

The system uses Facebook's standard OAuth 2.0 flow to obtain access tokens:

1. User clicks "Conectar com Facebook" on the Integrations page
2. Frontend redirects to `GET /api/facebook/auth/connect?token=<supabase_jwt>`
3. Backend validates the JWT, generates a signed state parameter (HMAC-SHA256), and redirects to Facebook's authorization dialog
4. User authorizes the app on Facebook with scopes: `ads_read`, `read_insights`, `business_management`, `public_profile`
5. Facebook redirects to `GET /api/facebook/auth/callback?code=xxx&state=yyy`
6. Backend validates the state (CSRF protection), exchanges the code for a short-lived token, then exchanges for a long-lived token (60 days)
7. Token is encrypted with AES-256-GCM and saved to `facebook_connections`
8. Ad accounts are auto-discovered in background
9. User is redirected to `/dashboard/integrations?connected=true`

### Environment Variables

| Variable | Description | Example |
|----------|-------------|---------|
| `FACEBOOK_APP_ID` | Facebook App ID | `1314325524090040` |
| `FACEBOOK_APP_SECRET` | Facebook App Secret | (secret) |
| `FACEBOOK_REDIRECT_URI` | OAuth callback URL | `https://api.example.com/api/facebook/auth/callback` |
| `FRONTEND_URL` | Frontend URL for post-callback redirect | `https://app.example.com` |

### Token Lifecycle

- Long-lived tokens are valid for **60 days**
- `token_expires_at` column tracks expiry
- When a token expires, the user must re-authorize via the OAuth flow
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/07-integrations/
git commit -m "docs: update facebook-connection docs with OAuth flow"
```

---

### Task 10: End-to-End Smoke Test

- [ ] **Step 1: Start both services**

Run: `npm run dev` (starts both frontend and backend via Turborepo)

- [ ] **Step 2: Test the happy path**

1. Open `http://localhost:5173/dashboard/integrations`
2. Click "Conectar com Facebook"
3. Verify you are redirected to Facebook's authorization dialog
4. Authorize the app
5. Verify you are redirected back to `/dashboard/integrations?connected=true`
6. Verify the success toast appears
7. Verify the connection card appears with status "Ativa"

- [ ] **Step 3: Test error paths**

1. Try accessing `http://localhost:3001/api/facebook/auth/connect` without `?token=` — should return 401
2. Try accessing `http://localhost:3001/api/facebook/auth/callback?state=invalid` — should redirect to frontend with error
3. Deny the Facebook authorization — verify error message appears on frontend

- [ ] **Step 4: Verify existing functionality unchanged**

1. Existing connections still appear and can be edited/deleted
2. Manual sync still works
3. Auto-sync cron still runs
4. Workspace toggles still work

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "feat: migrate Facebook integration to OAuth 2.0 flow"
```

---

Plan complete and saved to `docs/superpowers/plans/2026-03-31-facebook-oauth-flow.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

Which approach?