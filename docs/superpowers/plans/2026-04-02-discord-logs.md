# Discord Logs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Real-time Discord logging for all webhook processors — per-platform channels with sale/refund/error embeds, a consolidated error channel, and a daily summary cron.

**Architecture:** A `DiscordLoggerService` in `SharedModule` with an in-memory queue (rate-limited to 30 msg/min per URL). Each processor calls `logSale()`, `logRefund()`, or `logError()` after processing. A cron job sends a daily summary at 08:00 BRT.

**Tech Stack:** NestJS 10, native `fetch` (Node 18+), `@nestjs/schedule` for cron

---

## File Structure

### Files to Create
- `packages/backend/src/shared/services/discord-logger.service.ts` — Core service: queue, rate limit, embed formatting, send
- `packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts` — Tests

### Files to Modify
- `packages/backend/src/shared/shared.module.ts` — Register DiscordLoggerService
- `packages/backend/src/modules/webhooks/processors/balaclava.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/cakto.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/cartpanda.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/ggcheckout.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/hotmart.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/hubla.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/kirvano.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/kiwify.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/lastlink.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/payt.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/perfectpay.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/processors/ticto.processor.ts` — Add Discord logging
- `packages/backend/src/modules/webhooks/webhook-queue.service.ts` — Add Discord logging to Guru processing

---

## Task 1: Create DiscordLoggerService

**Files:**
- Create: `packages/backend/src/shared/services/discord-logger.service.ts`

- [ ] **Step 1: Create the service**

```typescript
import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { SupabaseService } from './supabase.service';
import {
  DISCORD_WEBHOOKS,
  DiscordChannel,
} from '../../config/discord-webhooks.config';

// ── Embed colors (decimal for Discord API) ──────────────────────────
const COLOR_GREEN = 0x00cc66;
const COLOR_RED = 0xff4444;
const COLOR_ORANGE = 0xff8c00;
const COLOR_GRAY = 0x808080;
const COLOR_BLUE = 0x4a90d9;

// ── Rate-limit: Discord allows 30 msg/min per webhook URL ───────────
const FLUSH_INTERVAL_MS = 2_000;
const MAX_PER_FLUSH = 5; // per URL, per flush cycle (≈ 150/min max)

// ── Public DTOs ─────────────────────────────────────────────────────
export interface SaleLogData {
  amount: number;
  customerName: string | null;
  customerEmail: string | null;
  productName: string | null;
  paymentMethod: string | null;
  adMatched: boolean;
  utmSource: string | null;
  utmMedium: string | null;
  utmCampaign: string | null;
  utmContent: string | null;
  utmTerm: string | null;
}

export interface ErrorLogData {
  errorType: 'token_invalid' | 'save_failed' | 'unknown_event' | 'missing_fields';
  message: string;
  suggestion: string;
  tokenPartial?: string | null;
  customerName?: string | null;
  amount?: number | null;
  productName?: string | null;
}

// ── Internal queue item ─────────────────────────────────────────────
interface QueueItem {
  url: string;
  payload: Record<string, any>;
}

@Injectable()
export class DiscordLoggerService implements OnModuleDestroy {
  private readonly logger = new Logger(DiscordLoggerService.name);
  private readonly queue: QueueItem[] = [];
  private flushTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly supabase: SupabaseService) {
    this.flushTimer = setInterval(() => this.flush(), FLUSH_INTERVAL_MS);
  }

  onModuleDestroy(): void {
    if (this.flushTimer) clearInterval(this.flushTimer);
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  logSale(platform: string, data: SaleLogData): void {
    const utmLine = this.formatUtmLine(data);
    const adMatch = data.adMatched ? '✅' : '❌';
    const description = [
      `✅ R$ ${this.fmt(data.amount)} | ${data.customerName || '—'} | ${data.customerEmail || '—'} | ${data.productName || '—'} | ${(data.paymentMethod || '—').toUpperCase()} | Ad Match: ${adMatch}`,
      utmLine ? `UTM: ${utmLine}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const embed = { description, color: COLOR_GREEN };
    this.enqueue(platform as DiscordChannel, { embeds: [embed] });
  }

  logRefund(platform: string, data: SaleLogData): void {
    const utmLine = this.formatUtmLine(data);
    const description = [
      `🔄 R$ ${this.fmt(data.amount)} | ${data.customerName || '—'} | ${data.customerEmail || '—'} | ${data.productName || '—'} | ${(data.paymentMethod || '—').toUpperCase()} | Reembolso`,
      utmLine ? `UTM: ${utmLine}` : null,
    ]
      .filter(Boolean)
      .join('\n');

    const embed = { description, color: COLOR_RED };
    this.enqueue(platform as DiscordChannel, { embeds: [embed] });
  }

  logError(platform: string, data: ErrorLogData): void {
    const titleMap: Record<string, string> = {
      token_invalid: '⚠️ Token Inválido',
      save_failed: '🔴 Falha ao Salvar Venda',
      unknown_event: '🔇 Evento Desconhecido',
      missing_fields: '⚠️ Campos Obrigatórios Ausentes',
    };

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: '📦 Plataforma', value: platform, inline: true },
      { name: '🕐 Horário', value: this.nowBRT(), inline: true },
    ];

    if (data.tokenPartial) {
      fields.push({ name: '🔑 Token', value: `...${data.tokenPartial}`, inline: true });
    }

    const customerParts = [
      data.customerName ? `👤 ${data.customerName}` : null,
      data.amount != null ? `💰 R$ ${this.fmt(data.amount)}` : null,
      data.productName ? `📦 ${data.productName}` : null,
    ]
      .filter(Boolean)
      .join(' | ');

    if (customerParts) {
      fields.push({ name: 'Dados do Payload', value: customerParts });
    }

    fields.push({ name: '💡 O que isso significa', value: data.message });
    fields.push({ name: '🔧 Ação sugerida', value: data.suggestion });

    const embed = {
      title: titleMap[data.errorType] || '⚠️ Erro',
      color: data.errorType === 'unknown_event' ? COLOR_GRAY : COLOR_ORANGE,
      fields,
    };

    // Send to platform channel
    this.enqueue(platform as DiscordChannel, { embeds: [embed] });

    // Also send to consolidated error channel (except unknown_event which is informational)
    if (data.errorType !== 'unknown_event') {
      this.enqueue('webhookErrors', { embeds: [embed] });
    }
  }

  logTestIgnored(platform: string): void {
    const embed = {
      description: `🔇 Webhook de teste ignorado\n📦 Plataforma: ${platform} | 🕐 ${this.nowBRT()}`,
      color: COLOR_GRAY,
    };
    this.enqueue(platform as DiscordChannel, { embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Daily summary cron — 11:00 UTC = 08:00 BRT
  // ═══════════════════════════════════════════════════════════════════

  @Cron('0 11 * * *')
  async sendDailySummary(): Promise<void> {
    try {
      const supabaseAdmin = this.supabase.getClient();
      const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

      // Sales stats
      const { data: sales } = await supabaseAdmin
        .from('sales')
        .select('platform, status, amount')
        .gte('created_at', since);

      const salesArr = sales || [];
      const totalReceived = salesArr.length;
      const approved = salesArr.filter((s: any) => s.status === 'approved');
      const refunded = salesArr.filter((s: any) => s.status === 'refunded');
      const approvedTotal = approved.reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);
      const refundedTotal = refunded.reduce((sum: number, s: any) => sum + (Number(s.amount) || 0), 0);

      // Per-platform counts
      const platformCounts: Record<string, number> = {};
      for (const s of salesArr) {
        const p = (s as any).platform || 'unknown';
        platformCounts[p] = (platformCounts[p] || 0) + 1;
      }
      const platformLines = Object.entries(platformCounts)
        .sort((a, b) => b[1] - a[1])
        .map(([p, c]) => `   ${p}: ${c}`)
        .join('\n');

      // Null fields check
      const { count: nullCount } = await supabaseAdmin
        .from('sales')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since)
        .or('amount.is.null,customer_email.is.null');

      // Integrations created/removed
      const { count: intCreated } = await supabaseAdmin
        .from('checkout_integrations')
        .select('id', { count: 'exact', head: true })
        .gte('created_at', since);

      const today = new Date().toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' });

      const description = [
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        `📊 **Resumo Diário — ${today}**`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
        ``,
        `🔔 **WEBHOOKS**`,
        `   Recebidos: ${totalReceived}`,
        `   Vendas: ${approved.length} (R$ ${this.fmt(approvedTotal)})`,
        `   Reembolsos: ${refunded.length} (R$ ${this.fmt(refundedTotal)})`,
        platformLines ? `\n📦 **Por plataforma:**\n${platformLines}` : '',
        ``,
        `⚙️ **INTEGRAÇÕES**`,
        `   Criadas (últimas 24h): ${intCreated || 0}`,
        ``,
        `🛡️ **DADOS**`,
        `   Vendas com campos nulos: ${nullCount || 0}`,
        `━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`,
      ].join('\n');

      const embed = { description, color: COLOR_BLUE };
      this.enqueue('resumoDiario', { embeds: [embed] });
    } catch (err: any) {
      this.logger.error(`Daily summary failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Internal queue & rate-limited flush
  // ═══════════════════════════════════════════════════════════════════

  private enqueue(channel: DiscordChannel | string, payload: Record<string, any>): void {
    const url = DISCORD_WEBHOOKS[channel as DiscordChannel];
    if (!url) {
      this.logger.warn(`No Discord webhook URL for channel: ${channel}`);
      return;
    }
    this.queue.push({ url, payload });
  }

  private async flush(): Promise<void> {
    if (this.queue.length === 0) return;

    // Group by URL, take at most MAX_PER_FLUSH per URL
    const byUrl = new Map<string, QueueItem[]>();
    for (const item of this.queue) {
      const group = byUrl.get(item.url) || [];
      group.push(item);
      byUrl.set(item.url, group);
    }

    const sent: QueueItem[] = [];
    for (const [url, items] of byUrl) {
      const batch = items.slice(0, MAX_PER_FLUSH);
      for (const item of batch) {
        try {
          await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(item.payload),
          });
        } catch (err: any) {
          this.logger.warn(`Discord send failed: ${err.message}`);
        }
        sent.push(item);
      }
    }

    // Remove sent items from queue
    for (const item of sent) {
      const idx = this.queue.indexOf(item);
      if (idx !== -1) this.queue.splice(idx, 1);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Helpers
  // ═══════════════════════════════════════════════════════════════════

  private fmt(value: number | null | undefined): string {
    if (value == null) return '0,00';
    return value.toLocaleString('pt-BR', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
  }

  private formatUtmLine(data: SaleLogData): string | null {
    const parts: string[] = [];
    if (data.utmSource) parts.push(`source=${data.utmSource}`);
    if (data.utmMedium) parts.push(`medium=${data.utmMedium}`);
    if (data.utmCampaign) parts.push(`campaign=${data.utmCampaign}`);
    if (data.utmContent) parts.push(`content=${data.utmContent}`);
    if (data.utmTerm) parts.push(`term=${data.utmTerm}`);
    return parts.length > 0 ? parts.join(' | ') : null;
  }

  private nowBRT(): string {
    return new Date().toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' });
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/shared/services/discord-logger.service.ts
git commit -m "feat(discord): add DiscordLoggerService with queue, rate limit, and daily summary"
```

---

## Task 2: Register in SharedModule

**Files:**
- Modify: `packages/backend/src/shared/shared.module.ts`

- [ ] **Step 1: Add import and register provider**

```typescript
import { Global, Module } from '@nestjs/common';
import { SupabaseService } from './services/supabase.service';
import { EncryptionService } from './services/encryption.service';
import { CacheService } from './services/cache.service';
import { DiscordLoggerService } from './services/discord-logger.service';

@Global()
@Module({
  providers: [SupabaseService, EncryptionService, CacheService, DiscordLoggerService],
  exports: [SupabaseService, EncryptionService, CacheService, DiscordLoggerService],
})
export class SharedModule {}
```

- [ ] **Step 2: Verify compilation**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/shared/shared.module.ts
git commit -m "feat(discord): register DiscordLoggerService in SharedModule"
```

---

## Task 3: Tests for DiscordLoggerService

**Files:**
- Create: `packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts`

- [ ] **Step 1: Create the test file**

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { DiscordLoggerService, SaleLogData, ErrorLogData } from '../discord-logger.service';
import { SupabaseService } from '../supabase.service';

// Mock global fetch
const mockFetch = jest.fn().mockResolvedValue({ ok: true });
(global as any).fetch = mockFetch;

describe('DiscordLoggerService', () => {
  let service: DiscordLoggerService;

  beforeEach(async () => {
    mockFetch.mockClear();

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        DiscordLoggerService,
        {
          provide: SupabaseService,
          useValue: { getClient: jest.fn() },
        },
      ],
    }).compile();

    service = module.get(DiscordLoggerService);
  });

  afterEach(() => {
    service.onModuleDestroy();
  });

  const saleData: SaleLogData = {
    amount: 297,
    customerName: 'João Silva',
    customerEmail: 'joao@test.com',
    productName: 'Curso Marketing',
    paymentMethod: 'pix',
    adMatched: true,
    utmSource: 'FBjLj696',
    utmMedium: 'CJ|120241',
    utmCampaign: 'CAMP|120241',
    utmContent: 'AD|120241',
    utmTerm: 'Instagram_Stories',
  };

  describe('logSale', () => {
    it('should enqueue a green embed with sale data and UTMs', () => {
      service.logSale('hotmart', saleData);

      // Access internal queue
      const queue = (service as any).queue;
      expect(queue).toHaveLength(1);
      expect(queue[0].payload.embeds[0].color).toBe(0x00cc66); // green
      expect(queue[0].payload.embeds[0].description).toContain('297,00');
      expect(queue[0].payload.embeds[0].description).toContain('João Silva');
      expect(queue[0].payload.embeds[0].description).toContain('joao@test.com');
      expect(queue[0].payload.embeds[0].description).toContain('Curso Marketing');
      expect(queue[0].payload.embeds[0].description).toContain('PIX');
      expect(queue[0].payload.embeds[0].description).toContain('Ad Match: ✅');
      expect(queue[0].payload.embeds[0].description).toContain('UTM:');
      expect(queue[0].payload.embeds[0].description).toContain('source=FBjLj696');
    });

    it('should show Ad Match ❌ when adMatched is false', () => {
      service.logSale('hotmart', { ...saleData, adMatched: false });

      const queue = (service as any).queue;
      expect(queue[0].payload.embeds[0].description).toContain('Ad Match: ❌');
    });

    it('should handle null fields gracefully', () => {
      service.logSale('kiwify', {
        amount: 0,
        customerName: null,
        customerEmail: null,
        productName: null,
        paymentMethod: null,
        adMatched: false,
        utmSource: null,
        utmMedium: null,
        utmCampaign: null,
        utmContent: null,
        utmTerm: null,
      });

      const queue = (service as any).queue;
      expect(queue[0].payload.embeds[0].description).toContain('—');
      expect(queue[0].payload.embeds[0].description).not.toContain('UTM:');
    });
  });

  describe('logRefund', () => {
    it('should enqueue a red embed with refund data', () => {
      service.logRefund('kiwify', saleData);

      const queue = (service as any).queue;
      expect(queue).toHaveLength(1);
      expect(queue[0].payload.embeds[0].color).toBe(0xff4444); // red
      expect(queue[0].payload.embeds[0].description).toContain('🔄');
      expect(queue[0].payload.embeds[0].description).toContain('Reembolso');
    });
  });

  describe('logError', () => {
    it('should enqueue to both platform channel and webhookErrors', () => {
      const errorData: ErrorLogData = {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto',
        tokenPartial: 'x9z2',
        customerName: 'João',
        amount: 297,
        productName: 'Curso',
      };

      service.logError('hotmart', errorData);

      const queue = (service as any).queue;
      // Should have 2 entries: platform + webhookErrors
      expect(queue).toHaveLength(2);
      expect(queue[0].payload.embeds[0].color).toBe(0xff8c00); // orange
      expect(queue[0].payload.embeds[0].title).toBe('⚠️ Token Inválido');
    });

    it('should NOT send unknown_event to webhookErrors (informational only)', () => {
      service.logError('hotmart', {
        errorType: 'unknown_event',
        message: 'Evento "order.updated" não é processado',
        suggestion: 'Informativo, sem ação',
      });

      const queue = (service as any).queue;
      // Only 1 entry (platform channel), NOT webhookErrors
      expect(queue).toHaveLength(1);
      expect(queue[0].payload.embeds[0].color).toBe(0x808080); // gray
    });
  });

  describe('logTestIgnored', () => {
    it('should enqueue a gray embed', () => {
      service.logTestIgnored('balaclava');

      const queue = (service as any).queue;
      expect(queue).toHaveLength(1);
      expect(queue[0].payload.embeds[0].color).toBe(0x808080);
      expect(queue[0].payload.embeds[0].description).toContain('teste ignorado');
    });
  });

  describe('flush (rate limiting)', () => {
    it('should send queued items via fetch', async () => {
      service.logSale('hotmart', saleData);

      // Trigger flush manually
      await (service as any).flush();

      expect(mockFetch).toHaveBeenCalledTimes(1);
      expect(mockFetch).toHaveBeenCalledWith(
        expect.stringContaining('discord.com'),
        expect.objectContaining({ method: 'POST' }),
      );

      // Queue should be empty after flush
      expect((service as any).queue).toHaveLength(0);
    });

    it('should limit items per URL per flush to MAX_PER_FLUSH', async () => {
      // Enqueue 10 items for the same platform
      for (let i = 0; i < 10; i++) {
        service.logSale('hotmart', { ...saleData, amount: i });
      }

      await (service as any).flush();

      // Should only send MAX_PER_FLUSH (5) in one flush
      expect(mockFetch).toHaveBeenCalledTimes(5);
      // 5 remaining in queue
      expect((service as any).queue).toHaveLength(5);
    });

    it('should silently handle fetch errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));
      service.logSale('hotmart', saleData);

      // Should not throw
      await expect((service as any).flush()).resolves.not.toThrow();
    });

    it('should skip if no webhook URL for channel', () => {
      service.logSale('nonexistent_platform' as any, saleData);

      const queue = (service as any).queue;
      expect(queue).toHaveLength(0); // Not enqueued
    });
  });
});
```

- [ ] **Step 2: Run tests**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx jest --config packages/backend/jest.config.js packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts --verbose`

Expected: All tests pass.

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/shared/services/__tests__/discord-logger.service.spec.ts
git commit -m "test(discord): add tests for DiscordLoggerService"
```

---

## Task 4: Integrate Discord Logging into All Processors

**Files:**
- Modify: All 12 checkout processors + webhook-queue.service.ts (Guru)

This task adds 3 lines to each processor:
1. Inject `DiscordLoggerService` in constructor
2. Call `logSale()`/`logRefund()` after successful upsert
3. Call `logError()` on token invalid / save failure

**The pattern is identical for every processor.** Below shows the exact changes for each file.

- [ ] **Step 1: Add Discord logging to Balaclava processor**

In `packages/backend/src/modules/webhooks/processors/balaclava.processor.ts`:

**Add import (after existing imports):**
```typescript
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
```

**Add to constructor:**
```typescript
  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
    private readonly discordLogger: DiscordLoggerService,
  ) {}
```

**After the test event ignore block (`payload.test === true`), add:**
```typescript
      // (existing code returns { status: 200, body: { ... ignored ... } })
      // ADD after return:
      // No — this is already returning. Add logTestIgnored BEFORE the return:
```

Actually, the test ignored block already returns. Add `this.discordLogger.logTestIgnored('balaclava');` before the return inside that block:

```typescript
    if (payload.test === true || payload.status === 'test') {
      this.discordLogger.logTestIgnored('balaclava');
      return {
        status: 200,
        body: { success: true, ignored: true, reason: 'Test event ignored' },
      };
    }
```

**After the integration lookup fails (401 return), add logError before the return:**
```typescript
    if (integrationError || !integration) {
      this.discordLogger.logError('balaclava', {
        errorType: 'token_invalid',
        message: 'Token não corresponde a nenhuma integração ativa',
        suggestion: 'Verificar com o usuário se o token está correto',
        tokenPartial: authToken ? authToken.slice(-4) : null,
        customerName: (payload.customer || {}).name,
        amount: typeof (payload.purchase || {}).total === 'number' ? payload.purchase.total : null,
        productName: (payload.purchase || {}).product_name,
      });
      return { status: 401, body: { error: 'Invalid token or integration not found' } };
    }
```

**After successful upsert + matchAndUpdateSale, before updating last_webhook_at:**
```typescript
    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, { adId, utmCampaign, utmContent, utmTerm });

      const logData = {
        amount, customerName: customer.name || null, customerEmail: customer.email || null,
        productName: purchase.product_name || null, paymentMethod: purchase.payment_method || null,
        adMatched: !!adId, utmSource: utmSource, utmMedium: utmMedium,
        utmCampaign: utmCampaign, utmContent: utmContent, utmTerm: utmTerm,
      };
      if (status === 'approved') {
        this.discordLogger.logSale('balaclava', logData);
      } else {
        this.discordLogger.logRefund('balaclava', logData);
      }
    }
```

**After the saleError throw, add logError:**
```typescript
    if (saleError) {
      this.logger.error('Error upserting sale:', saleError);
      this.discordLogger.logError('balaclava', {
        errorType: 'save_failed',
        message: 'Erro ao inserir/atualizar venda no banco de dados',
        suggestion: 'Verificar logs do servidor e status do Supabase',
        customerName: customer.name || null,
        amount,
        productName: purchase.product_name || null,
      });
      throw saleError;
    }
```

- [ ] **Step 2: Repeat for ALL other processors**

Apply the exact same pattern to each processor. The only things that change per processor are:
- The platform string (`'hotmart'`, `'kiwify'`, etc.)
- The field paths for extracting customerName, amount, productName from the payload (which vary by platform)

**Files to modify (12 total):**

| Processor | Platform string | Customer name field | Amount field | Product name field |
|-----------|----------------|--------------------|--------------|--------------------|
| `hotmart.processor.ts` | `'hotmart'` | `buyer.name` | `amount` | `product.name` |
| `kiwify.processor.ts` | `'kiwify'` | `customerName` | `amount` | `productName` |
| `kirvano.processor.ts` | `'kirvano'` | `customerName` | `amount` | `productName` |
| `perfectpay.processor.ts` | `'perfectpay'` | `customerName` | `amount` | `productName` |
| `ticto.processor.ts` | `'ticto'` | `customerName` | `amount` | `productName` |
| `cakto.processor.ts` | `'cakto'` | `customer.name` | `amount` | `data.product?.name` |
| `payt.processor.ts` | `'payt'` | `customerName` | `amount` | `productName` |
| `hubla.processor.ts` | `'hubla'` | `customerName` | `amount` | `product.name` |
| `cartpanda.processor.ts` | `'cartpanda'` | `customer.full_name` | `amount` | `lineItems[0]?.title` |
| `ggcheckout.processor.ts` | `'ggcheckout'` | `customer.name` | `amount` | `product.title` |
| `lastlink.processor.ts` | `'lastlink'` | `buyer.Name` | `amount` | `product.Name` |

For each processor:
1. Add `import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';`
2. Add `private readonly discordLogger: DiscordLoggerService` to constructor
3. Add `logError()` at token invalid / save failure points
4. Add `logSale()` or `logRefund()` after successful processing
5. Add `logTestIgnored()` at test detection points (where applicable)

- [ ] **Step 3: Add Discord logging to Guru processing (webhook-queue.service.ts)**

In `packages/backend/src/modules/webhooks/webhook-queue.service.ts`:

**Add import:**
```typescript
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';
```

**Add to constructor (after existing injections, before closing brace):**
```typescript
    private readonly discordLogger: DiscordLoggerService,
```

**In `processGuru()`, after the successful insert + matchAndUpdateSale block, before `last_webhook_at` update:**
```typescript
    const logData = {
      amount: saleData.amount, customerName: contact.name || null,
      customerEmail: contact.email || null, productName: product.name || null,
      paymentMethod: payment.method || null, adMatched: !!adId,
      utmSource: source.utm_source || null, utmMedium: source.utm_medium || null,
      utmCampaign: source.utm_campaign || null, utmContent: source.utm_content || null,
      utmTerm: source.utm_term || null,
    };
    if (status === 'approved') {
      this.discordLogger.logSale('guru', logData);
    } else if (status === 'refunded') {
      this.discordLogger.logRefund('guru', logData);
    }
```

- [ ] **Step 4: Verify compilation**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json`

Expected: No errors.

- [ ] **Step 5: Run all webhook tests**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx jest --config packages/backend/jest.config.js packages/backend/src/modules/webhooks/ --verbose 2>&1 | tail -30`

Expected: Tests may need DiscordLoggerService mock added to their test modules. If tests fail, add this to each test's providers:
```typescript
{ provide: DiscordLoggerService, useValue: { logSale: jest.fn(), logRefund: jest.fn(), logError: jest.fn(), logTestIgnored: jest.fn() } }
```

- [ ] **Step 6: Commit**

```bash
git add packages/backend/src/modules/webhooks/ packages/backend/src/shared/services/discord-logger.service.ts
git commit -m "feat(discord): integrate Discord logging into all 13 webhook processors"
```

---

## Task 5: Update Existing Tests

**Files:**
- Modify: `packages/backend/src/modules/webhooks/__tests__/new-platforms.spec.ts`
- Modify: `packages/backend/src/modules/webhooks/__tests__/webhooks.service.spec.ts`

- [ ] **Step 1: Add DiscordLoggerService mock to new-platforms.spec.ts**

After the `createMockWebhooksService()` function, add:

```typescript
function createMockDiscordLogger() {
  return {
    logSale: jest.fn(),
    logRefund: jest.fn(),
    logError: jest.fn(),
    logTestIgnored: jest.fn(),
  };
}
```

Then in each `beforeEach` block for HublaProcessor, CartPandaProcessor, GGCheckoutProcessor, LastLinkProcessor, add to providers:

```typescript
{ provide: DiscordLoggerService, useValue: createMockDiscordLogger() },
```

And add the import at the top:
```typescript
import { DiscordLoggerService } from '../../../shared/services/discord-logger.service';
```

- [ ] **Step 2: Run tests to verify they pass**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx jest --config packages/backend/jest.config.js --verbose 2>&1 | tail -40`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/__tests__/
git commit -m "test: add DiscordLoggerService mock to webhook processor tests"
```

---

## Task 6: Build Verification

- [ ] **Step 1: Full TypeScript compilation**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json`

Expected: No errors.

- [ ] **Step 2: Run all tests**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx jest --config packages/backend/jest.config.js --verbose 2>&1 | tail -40`

Expected: All tests pass (except the pre-existing FacebookOAuthService failure).

- [ ] **Step 3: Quick smoke test — verify Discord receives a message**

Temporarily add to any processor's top-level (or run via a test):
```typescript
await fetch('https://discord.com/api/webhooks/1489344437074137361/jk41wSAiouTB_LCwoIlbM0dJMOD5tmKNpiWDbJ0tUTpqtMFvSKgjEbNvpjpXX65DUNOh', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ embeds: [{ description: '🧪 Teste de integração Discord — Sentinela', color: 0x4A90D9 }] }),
});
```

Expected: Message appears in the #hotmart Discord channel. **Remove the test code after verifying.**
