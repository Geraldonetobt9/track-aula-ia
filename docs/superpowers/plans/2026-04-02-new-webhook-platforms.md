# New Webhook Platforms Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add 4 new checkout platform webhook integrations (Hubla, CartPanda, GGCheckout, LastLink) to the Sentinela system.

**Architecture:** Each platform gets its own `@Injectable()` processor following the established pattern (see `balaclava.processor.ts` as reference). All 4 use the async queue. The controller, module, and queue service are updated to register the new platforms. Each platform also gets a documentation file.

**Tech Stack:** NestJS 10, Fastify, Supabase (service role), TypeScript strict mode

---

## File Structure

### Files to Create
- `packages/backend/src/modules/webhooks/processors/hubla.processor.ts` — Hubla webhook processor
- `packages/backend/src/modules/webhooks/processors/cartpanda.processor.ts` — CartPanda webhook processor
- `packages/backend/src/modules/webhooks/processors/ggcheckout.processor.ts` — GGCheckout webhook processor
- `packages/backend/src/modules/webhooks/processors/lastlink.processor.ts` — LastLink webhook processor
- `docs/features/08-webhook-processing/hubla.md` — Hubla documentation
- `docs/features/08-webhook-processing/cartpanda.md` — CartPanda documentation
- `docs/features/08-webhook-processing/ggcheckout.md` — GGCheckout documentation
- `docs/features/08-webhook-processing/lastlink.md` — LastLink documentation

### Files to Modify
- `packages/backend/src/modules/webhooks/webhooks.controller.ts` — Add 4 platforms to `KNOWN_PLATFORMS`
- `packages/backend/src/modules/webhooks/webhooks.module.ts` — Import and register 4 processors
- `packages/backend/src/modules/webhooks/webhook-queue.service.ts` — Add 4 platforms to `QUEUED_PLATFORMS`, inject processors, add to `processorMap`
- `WEBHOOKS.md` — Add documentation links for new platforms

---

## Task 1: Hubla Processor

**Files:**
- Create: `packages/backend/src/modules/webhooks/processors/hubla.processor.ts`

- [ ] **Step 1: Create the Hubla processor**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';
import { normalizeState } from '../../../shared/helpers/normalize-state';

const APPROVED_EVENTS = new Set(['invoice.payment_succeeded']);
const REFUNDED_EVENTS = new Set(['refund_request.accepted']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class HublaProcessor {
  private readonly logger = new Logger(HublaProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook Hubla received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    if (!authToken) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            'Webhook endpoint active. No authentication token found in request.',
        },
      };
    }

    const eventType = (payload.type || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(eventType)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${eventType}" not processed (only invoice.payment_succeeded, refund_request.accepted)`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active')
      .eq('platform', 'hubla')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const workspaceId = integration.workspace_id;

    const event = payload.event || {};
    const invoice = event.invoice || {};
    const user = event.user || {};
    const product = event.product || {};
    const products = event.products || [];
    const billingAddress = invoice.billingAddress || {};
    const utm = (invoice.firstPaymentSession || {}).utm || {};
    const amountObj = invoice.amount || {};

    const status = APPROVED_EVENTS.has(eventType) ? 'approved' : 'refunded';

    const customerName = [user.firstName, user.lastName]
      .filter(Boolean)
      .join(' ') || null;

    const amount =
      typeof amountObj.totalCents === 'number'
        ? amountObj.totalCents / 100
        : 0;

    const utmSource = utm.source || null;
    const utmMedium = utm.medium || null;
    const utmCampaign = utm.campaign || null;
    const utmContent = utm.content || null;
    const utmTerm = utm.term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerState = normalizeState(billingAddress.state) ||
      this.webhooksService.getStateFromPhone(user.phone);

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: invoice.id || `hubla_${Date.now()}`,
      amount,
      product_name: product.name || (products[0] && products[0].name) || null,
      customer_name: customerName,
      customer_email: user.email || null,
      customer_phone: user.phone || null,
      customer_doc: user.document || null,
      customer_state: customerState,
      customer_city: billingAddress.city || null,
      customer_country: billingAddress.countryCode || 'BR',
      status,
      payment_method: invoice.paymentMethod || null,
      currency: invoice.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      platform: 'hubla',
      integration_id: integrationId,
      sale_date: invoice.saleDate || new Date().toISOString(),
      raw_data: {
        event_type: eventType,
        invoice_id: invoice.id,
        subscription_id: invoice.subscriptionId,
        seller_id: invoice.sellerId,
        installments: invoice.installments,
        subtotal_cents: amountObj.subtotalCents,
        discount_cents: amountObj.discountCents,
        installment_fee_cents: amountObj.installmentFeeCents,
        coupon: invoice.coupon || null,
        ip: (invoice.firstPaymentSession || {}).ip || null,
        product_id: product.id || (products[0] && products[0].id) || null,
        offers: products[0] && products[0].offers ? products[0].offers : null,
        refund: event.refund || null,
      },
    };

    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .upsert(saleData, { onConflict: 'external_id,user_id' })
      .select('id')
      .single();

    if (saleError) {
      this.logger.error('Error upserting sale:', saleError);
      throw saleError;
    }

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status },
    };
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | head -20`

Expected: No errors related to `hubla.processor.ts` (module registration errors are expected until Task 5).

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/hubla.processor.ts
git commit -m "feat(webhooks): add Hubla webhook processor"
```

---

## Task 2: CartPanda Processor

**Files:**
- Create: `packages/backend/src/modules/webhooks/processors/cartpanda.processor.ts`

- [ ] **Step 1: Create the CartPanda processor**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';

const APPROVED_EVENTS = new Set(['order.paid']);
const REFUNDED_EVENTS = new Set(['order.refunded']);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class CartPandaProcessor {
  private readonly logger = new Logger(CartPandaProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook CartPanda received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    if (!authToken) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            'Webhook endpoint active. No authentication token found in request.',
        },
      };
    }

    const eventName = (payload.event || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(eventName)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${eventName}" not processed (only order.paid, order.refunded)`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active')
      .eq('platform', 'cartpanda')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const workspaceId = integration.workspace_id;

    const order = payload.order || {};
    const customer = order.customer || {};
    const payment = order.payment || {};
    const lineItems = order.line_items || [];
    const trackingParams: Array<{ parameter_name: string; parameter_value: string }> =
      order.tracking_parameters || [];

    const status = APPROVED_EVENTS.has(eventName) ? 'approved' : 'refunded';

    const getTrackingParam = (name: string): string | null => {
      const param = trackingParams.find(
        (p) => p.parameter_name === name,
      );
      return param ? param.parameter_value : null;
    };

    const utmSource = getTrackingParam('utm_source');
    const utmMedium = getTrackingParam('utm_medium');
    const utmCampaign = getTrackingParam('utm_campaign');
    const utmContent = getTrackingParam('utm_content');
    const utmTerm = getTrackingParam('utm_term');

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerPhone = customer.phone || null;
    const customerState =
      this.webhooksService.getStateFromPhone(customerPhone);

    const amount =
      typeof payment.amount === 'number'
        ? payment.amount
        : parseFloat(payment.amount) || 0;

    // CartPanda dates are local time without timezone
    const rawDate = order.created_at || '';
    const soldAt = rawDate
      ? rawDate.includes('T') || rawDate.includes('+') || rawDate.includes('Z')
        ? rawDate
        : `${rawDate.replace(' ', 'T')}-03:00`
      : new Date().toISOString();

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: order.id
        ? String(order.id)
        : `cartpanda_${Date.now()}`,
      amount,
      product_name: lineItems[0]?.title || lineItems[0]?.name || null,
      customer_name: customer.full_name || null,
      customer_email: customer.email || order.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.cpf || null,
      customer_state: customerState,
      customer_city: null as string | null,
      customer_country: 'BR',
      status,
      payment_method: payment.payment_type || payment.type || null,
      currency: order.currency || 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      platform: 'cartpanda',
      integration_id: integrationId,
      sale_date: soldAt,
      raw_data: {
        event: eventName,
        order_id: order.id,
        order_number: order.order_number || order.number,
        click_id: order.click_id,
        shop_id: order.shop_id,
        line_items_count: lineItems.length,
        coproducer_slug: order.coproducer_slug || null,
        coproducer_amount: order.coproducer_amount || null,
        gateway: payment.gateway || null,
        installments: order.no_of_installments || null,
      },
    };

    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .upsert(saleData, { onConflict: 'external_id,user_id' })
      .select('id')
      .single();

    if (saleError) {
      this.logger.error('Error upserting sale:', saleError);
      throw saleError;
    }

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status },
    };
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/cartpanda.processor.ts
git commit -m "feat(webhooks): add CartPanda webhook processor"
```

---

## Task 3: GGCheckout Processor

**Files:**
- Create: `packages/backend/src/modules/webhooks/processors/ggcheckout.processor.ts`

- [ ] **Step 1: Create the GGCheckout processor**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';

const APPROVED_EVENTS = new Set(['pix.paid', 'card.paid']);
const REFUNDED_EVENTS = new Set([
  'pix.refunded',
  'card.refunded',
  'pix.chargeback',
  'card.chargeback',
]);
const ACCEPTED_EVENTS = new Set([...APPROVED_EVENTS, ...REFUNDED_EVENTS]);

@Injectable()
export class GGCheckoutProcessor {
  private readonly logger = new Logger(GGCheckoutProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook GGCheckout received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    if (!authToken) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            'Webhook endpoint active. No authentication token found in request.',
        },
      };
    }

    const eventName = (payload.event || '').toLowerCase().trim();
    if (!ACCEPTED_EVENTS.has(eventName)) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `Event "${eventName}" not processed`,
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active')
      .eq('platform', 'ggcheckout')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const workspaceId = integration.workspace_id;

    const paymentObj = payload.payment || {};
    const customer = payload.customer || {};
    const product = payload.product || {};
    const products = payload.products || [];
    const params = payload.params || {};
    const createdAt = payload.createdAt || {};

    const status = APPROVED_EVENTS.has(eventName) ? 'approved' : 'refunded';

    const utmSource = params.utm_source || null;
    const utmMedium = params.utm_medium || null;
    const utmCampaign = params.utm_campaign || null;
    const utmContent = params.utm_content || null;
    const utmTerm = params.utm_term || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerPhone = customer.phone || null;
    const customerState =
      this.webhooksService.getStateFromPhone(customerPhone);

    const amount =
      typeof paymentObj.amount === 'number'
        ? paymentObj.amount
        : parseFloat(paymentObj.amount) || 0;

    // Firestore timestamp: { _seconds, _nanoseconds } -> ISO string
    const soldAt =
      typeof createdAt._seconds === 'number'
        ? new Date(createdAt._seconds * 1000).toISOString()
        : new Date().toISOString();

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: paymentObj.id || `ggcheckout_${Date.now()}`,
      amount,
      product_name: product.title || (products[0] && products[0].title) || null,
      customer_name: customer.name || null,
      customer_email: customer.email || null,
      customer_phone: customerPhone,
      customer_doc: customer.document || null,
      customer_state: customerState,
      customer_city: null as string | null,
      customer_country: 'BR',
      status,
      payment_method: paymentObj.paymentMethod || null,
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      platform: 'ggcheckout',
      integration_id: integrationId,
      sale_date: soldAt,
      raw_data: {
        event: eventName,
        payment_id: paymentObj.id,
        payment_status: paymentObj.status,
        payment_gateway: paymentObj.gateway,
        product_id: product.id || (products[0] && products[0].id) || null,
        product_type: product.type || null,
        webhook_id: (payload.webhook || {}).id || null,
        business_id: (payload.webhook || {}).businessId || null,
        sck: params.sck || null,
        src: params.src || null,
        gclid: params.gclid || null,
        customer_ip: customer.ip || null,
      },
    };

    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .upsert(saleData, { onConflict: 'external_id,user_id' })
      .select('id')
      .single();

    if (saleError) {
      this.logger.error('Error upserting sale:', saleError);
      throw saleError;
    }

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status },
    };
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/ggcheckout.processor.ts
git commit -m "feat(webhooks): add GGCheckout webhook processor"
```

---

## Task 4: LastLink Processor

**Files:**
- Create: `packages/backend/src/modules/webhooks/processors/lastlink.processor.ts`

- [ ] **Step 1: Create the LastLink processor**

```typescript
import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../../shared/services/supabase.service';
import { WebhooksService } from '../webhooks.service';

@Injectable()
export class LastLinkProcessor {
  private readonly logger = new Logger(LastLinkProcessor.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly webhooksService: WebhooksService,
  ) {}

  async process(
    body: any,
    authToken: string | null,
  ): Promise<{ status: number; body: any }> {
    const payload = body;

    this.logger.log(
      'Webhook LastLink received: ' +
        JSON.stringify(payload).substring(0, 500),
    );

    if (!authToken) {
      return {
        status: 200,
        body: {
          success: true,
          message:
            'Webhook endpoint active. No authentication token found in request.',
        },
      };
    }

    // Detect event type from payload structure
    const isRefund =
      (payload.Action || '').toLowerCase() === 'remove' ||
      (payload.action || '').toLowerCase() === 'remove';
    const isPurchase = !!payload.Purchase;

    if (!isPurchase && !isRefund) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Payload has no Purchase and no Action=Remove — ignored',
        },
      };
    }

    // Ignore test events
    if (payload.IsTest === true) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Test event ignored',
        },
      };
    }

    const supabaseAdmin = this.supabase.getClient();

    const { data: integration, error: integrationError } = await supabaseAdmin
      .from('checkout_integrations')
      .select('id, user_id, workspace_id, is_active')
      .eq('platform', 'lastlink')
      .eq('is_active', true)
      .eq('webhook_secret', authToken)
      .single();

    if (integrationError || !integration) {
      return {
        status: 401,
        body: { error: 'Invalid token or integration not found' },
      };
    }

    const userId = integration.user_id;
    const integrationId = integration.id;
    const workspaceId = integration.workspace_id;

    if (isRefund) {
      return this.processRefund(
        supabaseAdmin,
        payload,
        userId,
        integrationId,
      );
    }

    return this.processPurchase(
      supabaseAdmin,
      payload,
      userId,
      workspaceId,
      integrationId,
    );
  }

  private async processPurchase(
    supabaseAdmin: ReturnType<SupabaseService['getClient']>,
    payload: any,
    userId: string,
    workspaceId: string,
    integrationId: string,
  ): Promise<{ status: number; body: any }> {
    const buyer = payload.Buyer || {};
    const purchase = payload.Purchase || {};
    const products = payload.Products || [];
    const product = payload.Product || products[0] || {};
    const payment = purchase.Payment || {};
    const utm = payload.Utm || {};
    const commissions = payload.Commissions || [];
    const subscriptions = payload.Subscriptions || [];
    const deviceInfo = payload.DeviceInfo || {};

    const utmSource = utm.UtmSource || null;
    const utmMedium = utm.UtmMedium || null;
    const utmCampaign = utm.UtmCampaign || null;
    const utmContent = utm.UtmContent || null;
    const utmTerm = utm.UtmTerm || null;

    const adId = this.webhooksService.extractNumericAdId(utmContent);

    const customerPhone = buyer.PhoneNumber || null;
    const customerState =
      this.webhooksService.getStateFromPhone(customerPhone);

    const priceObj = purchase.Price || {};
    const amount =
      typeof priceObj.Value === 'number'
        ? priceObj.Value
        : parseFloat(priceObj.Value) || 0;

    // LastLink dates are local time without timezone
    const rawDate = purchase.PaymentDate || '';
    const soldAt = rawDate
      ? rawDate.includes('T') && (rawDate.includes('+') || rawDate.includes('Z'))
        ? rawDate
        : rawDate.includes('T')
          ? `${rawDate}-03:00`
          : `${rawDate.replace(' ', 'T')}-03:00`
      : new Date().toISOString();

    const subscriptionId = subscriptions[0]?.Id || null;

    const saleData = {
      user_id: userId,
      workspace_id: workspaceId,
      external_id: purchase.PaymentId || `lastlink_${Date.now()}`,
      amount,
      product_name: product.Name || null,
      customer_name: buyer.Name ? buyer.Name.trim() : null,
      customer_email: buyer.Email || null,
      customer_phone: customerPhone,
      customer_doc: buyer.Document || null,
      customer_state: customerState,
      customer_city: null as string | null,
      customer_country: 'BR',
      status: 'approved',
      payment_method: payment.PaymentMethod || null,
      currency: 'BRL',
      utm_source: utmSource,
      utm_medium: utmMedium,
      utm_campaign: utmCampaign,
      utm_content: utmContent,
      utm_term: utmTerm,
      platform: 'lastlink',
      integration_id: integrationId,
      sale_date: soldAt,
      raw_data: {
        event: 'purchase',
        payment_id: purchase.PaymentId,
        subscription_id: subscriptionId,
        utm_id: utm.UtmId || null,
        offer_id: (payload.Offer || {}).Id || null,
        offer_name: (payload.Offer || {}).Name || null,
        seller_id: (payload.Seller || {}).Id || null,
        recurrency: purchase.Recurrency,
        installments: payment.NumberOfInstallments,
        interest_rate: payment.InterestRateAmount,
        original_price: (purchase.OriginalPrice || {}).Value,
        commissions,
        product_id: product.Id || null,
        ip: deviceInfo.ip || null,
        user_agent: deviceInfo.UserAgent || null,
      },
    };

    const { data: sale, error: saleError } = await supabaseAdmin
      .from('sales')
      .upsert(saleData, { onConflict: 'external_id,user_id' })
      .select('id')
      .single();

    if (saleError) {
      this.logger.error('Error upserting sale:', saleError);
      throw saleError;
    }

    if (sale?.id) {
      this.webhooksService.matchAndUpdateSale(sale.id, userId, {
        adId,
        utmCampaign,
        utmContent,
        utmTerm,
      });
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: { success: true, sale_id: sale?.id, status: 'approved' },
    };
  }

  private async processRefund(
    supabaseAdmin: ReturnType<SupabaseService['getClient']>,
    payload: any,
    userId: string,
    integrationId: string,
  ): Promise<{ status: number; body: any }> {
    const subscriptionId =
      (payload.Subscription || {}).Id || null;

    if (!subscriptionId) {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Refund event without Subscription.Id — cannot match sale',
        },
      };
    }

    // Find the original sale by subscription_id stored in raw_data
    const { data: existingSale } = await supabaseAdmin
      .from('sales')
      .select('id, status')
      .eq('user_id', userId)
      .eq('platform', 'lastlink')
      .filter('raw_data->>subscription_id', 'eq', subscriptionId)
      .maybeSingle();

    if (!existingSale) {
      this.logger.warn(
        `LastLink refund: no sale found for subscription_id=${subscriptionId}`,
      );
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: `No sale found for subscription_id ${subscriptionId}`,
        },
      };
    }

    if (existingSale.status === 'refunded') {
      return {
        status: 200,
        body: {
          success: true,
          ignored: true,
          reason: 'Sale already refunded',
        },
      };
    }

    const { error: updateError } = await supabaseAdmin
      .from('sales')
      .update({ status: 'refunded' })
      .eq('id', existingSale.id);

    if (updateError) {
      this.logger.error('Error updating sale to refunded:', updateError);
      throw updateError;
    }

    await supabaseAdmin
      .from('checkout_integrations')
      .update({ last_webhook_at: new Date().toISOString() })
      .eq('id', integrationId);

    return {
      status: 200,
      body: {
        success: true,
        sale_id: existingSale.id,
        status: 'refunded',
      },
    };
  }
}
```

- [ ] **Step 2: Verify the file compiles**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json 2>&1 | head -20`

- [ ] **Step 3: Commit**

```bash
git add packages/backend/src/modules/webhooks/processors/lastlink.processor.ts
git commit -m "feat(webhooks): add LastLink webhook processor"
```

---

## Task 5: Register All 4 Processors in the System

**Files:**
- Modify: `packages/backend/src/modules/webhooks/webhooks.controller.ts`
- Modify: `packages/backend/src/modules/webhooks/webhooks.module.ts`
- Modify: `packages/backend/src/modules/webhooks/webhook-queue.service.ts`

- [ ] **Step 1: Update the controller — add platforms to KNOWN_PLATFORMS**

In `packages/backend/src/modules/webhooks/webhooks.controller.ts`, add the 4 new platforms to the `KNOWN_PLATFORMS` set:

```typescript
// Find:
const KNOWN_PLATFORMS = new Set([
  'kirvano',
  'hotmart',
  'guru',
  'perfectpay',
  'kiwify',
  'ticto',
  'cakto',
  'payt',
  'balaclava',
  'n8n-profiles',
]);

// Replace with:
const KNOWN_PLATFORMS = new Set([
  'kirvano',
  'hotmart',
  'guru',
  'perfectpay',
  'kiwify',
  'ticto',
  'cakto',
  'payt',
  'balaclava',
  'n8n-profiles',
  'hubla',
  'cartpanda',
  'ggcheckout',
  'lastlink',
]);
```

- [ ] **Step 2: Update the module — import and register processors**

In `packages/backend/src/modules/webhooks/webhooks.module.ts`, add imports and providers:

```typescript
// Add these imports after the existing processor imports:
import { HublaProcessor } from './processors/hubla.processor';
import { CartPandaProcessor } from './processors/cartpanda.processor';
import { GGCheckoutProcessor } from './processors/ggcheckout.processor';
import { LastLinkProcessor } from './processors/lastlink.processor';

// Add to providers array (after BalaclavaProcessor):
    HublaProcessor,
    CartPandaProcessor,
    GGCheckoutProcessor,
    LastLinkProcessor,
```

- [ ] **Step 3: Update the queue service — add platforms, inject processors, update processorMap**

In `packages/backend/src/modules/webhooks/webhook-queue.service.ts`:

**3a. Add imports:**
```typescript
// Add after existing processor imports:
import { HublaProcessor } from './processors/hubla.processor';
import { CartPandaProcessor } from './processors/cartpanda.processor';
import { GGCheckoutProcessor } from './processors/ggcheckout.processor';
import { LastLinkProcessor } from './processors/lastlink.processor';
```

**3b. Add to QUEUED_PLATFORMS set:**
```typescript
// Find:
const QUEUED_PLATFORMS = new Set([
  'hotmart',
  'kiwify',
  'kirvano',
  'perfectpay',
  'ticto',
  'cakto',
  'payt',
  'balaclava',
]);

// Replace with:
const QUEUED_PLATFORMS = new Set([
  'hotmart',
  'kiwify',
  'kirvano',
  'perfectpay',
  'ticto',
  'cakto',
  'payt',
  'balaclava',
  'hubla',
  'cartpanda',
  'ggcheckout',
  'lastlink',
]);
```

**3c. Add constructor injections (after `balaclava`):**
```typescript
    @Inject(forwardRef(() => HublaProcessor))
    private readonly hubla: HublaProcessor,
    @Inject(forwardRef(() => CartPandaProcessor))
    private readonly cartpanda: CartPandaProcessor,
    @Inject(forwardRef(() => GGCheckoutProcessor))
    private readonly ggcheckout: GGCheckoutProcessor,
    @Inject(forwardRef(() => LastLinkProcessor))
    private readonly lastlink: LastLinkProcessor,
```

**3d. Add to processorMap in `dispatchToProcessor()`:**
```typescript
// Find:
    const processorMap: Record<string, any> = {
      hotmart: this.hotmart,
      kiwify: this.kiwify,
      kirvano: this.kirvano,
      perfectpay: this.perfectpay,
      ticto: this.ticto,
      cakto: this.cakto,
      payt: this.payt,
      balaclava: this.balaclava,
    };

// Replace with:
    const processorMap: Record<string, any> = {
      hotmart: this.hotmart,
      kiwify: this.kiwify,
      kirvano: this.kirvano,
      perfectpay: this.perfectpay,
      ticto: this.ticto,
      cakto: this.cakto,
      payt: this.payt,
      balaclava: this.balaclava,
      hubla: this.hubla,
      cartpanda: this.cartpanda,
      ggcheckout: this.ggcheckout,
      lastlink: this.lastlink,
    };
```

- [ ] **Step 4: Verify everything compiles**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json`

Expected: No errors.

- [ ] **Step 5: Commit**

```bash
git add packages/backend/src/modules/webhooks/webhooks.controller.ts \
       packages/backend/src/modules/webhooks/webhooks.module.ts \
       packages/backend/src/modules/webhooks/webhook-queue.service.ts
git commit -m "feat(webhooks): register Hubla, CartPanda, GGCheckout, LastLink in controller, module, and queue"
```

---

## Task 6: Documentation — Hubla

**Files:**
- Create: `docs/features/08-webhook-processing/hubla.md`

- [ ] **Step 1: Create the documentation file**

```markdown
# Webhook - Hubla

## 1. Proposito

Processar notificacoes de vendas da plataforma Hubla, capturando dados de fatura, assinatura e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'hubla'` e `is_active = true`.

## 3. Eventos Aceitos

Hubla envia o tipo de notificacao no campo `type`:

| Evento Hubla | Acao |
|-------------|------|
| `invoice.payment_succeeded` | Criar venda com status `approved` |
| `refund_request.accepted` | Criar venda com status `refunded` |

Eventos fora desta lista sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Evento Hubla | Status Interno |
|-------------|---------------|
| `invoice.payment_succeeded` | `approved` |
| `refund_request.accepted` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `event.invoice.id` | `external_id` (fallback: `hubla_` + timestamp) |
| `event.product.name` ou `event.products[0].name` | `product_name` |
| `event.user.firstName + " " + event.user.lastName` | `customer_name` |
| `event.user.email` | `customer_email` |
| `event.user.phone` | `customer_phone` |
| `event.user.document` | `customer_doc` |
| `event.invoice.billingAddress.state` (normalizado para UF) | `customer_state` |
| `event.invoice.billingAddress.city` | `customer_city` |
| `event.invoice.billingAddress.countryCode` | `customer_country` (padrao: `'BR'`) |
| `event.invoice.paymentMethod` | `payment_method` |
| `event.invoice.currency` | `currency` (padrao: `'BRL'`) |
| `event.invoice.saleDate` | `sold_at` |

### Metadata adicional (salvo em `raw_data`)
- `invoice_id`, `subscription_id`, `seller_id`
- `installments`
- `subtotal_cents`, `discount_cents`, `installment_fee_cents`
- `coupon`
- `ip` (de `firstPaymentSession`)
- `product_id`, `offers`
- `refund` (dados de reembolso quando aplicavel)

## 6. Regras de Negocio Especificas

### Calculo de valor
Valores vem em **centavos** no campo `amount.totalCents`. O sistema divide por 100:
```
amount = amountObj.totalCents / 100
```

### Estado do cliente
Hubla envia `billingAddress.state` que e normalizado para UF via `normalizeState()`. Se nao disponivel, usa fallback por DDD do telefone.

### Cidade disponivel
Hubla fornece `billingAddress.city` — diferente da maioria das plataformas.

### Nome do cliente
Composto de `firstName` + `lastName` concatenados.

### Upsert em vez de insert
Usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda lida de `invoice.currency`, padrao `'BRL'`
- Valor em centavos (dividir por 100)
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido do campo `firstPaymentSession.utm.content` usando `extractNumericAdId()`.

## 9. Deteccao de Teste

Nao ha deteccao explicita de eventos de teste.

## 10. Endpoint

```
POST /api/webhooks/hubla
```

Respostas:
- `200` - Webhook processado (criado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/08-webhook-processing/hubla.md
git commit -m "docs: add Hubla webhook processing documentation"
```

---

## Task 7: Documentation — CartPanda

**Files:**
- Create: `docs/features/08-webhook-processing/cartpanda.md`

- [ ] **Step 1: Create the documentation file**

```markdown
# Webhook - CartPanda

## 1. Proposito

Processar notificacoes de vendas da plataforma CartPanda, capturando dados de pedido, cliente e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'cartpanda'` e `is_active = true`.

## 3. Eventos Aceitos

CartPanda envia o tipo de notificacao no campo `event`:

| Evento CartPanda | Acao |
|-----------------|------|
| `order.paid` | Criar venda com status `approved` |
| `order.refunded` | Criar venda com status `refunded` |

Eventos fora desta lista sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Evento CartPanda | Status Interno |
|-----------------|---------------|
| `order.paid` | `approved` |
| `order.refunded` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `order.id` (convertido para string) | `external_id` (fallback: `cartpanda_` + timestamp) |
| `order.line_items[0].title` | `product_name` |
| `order.customer.full_name` | `customer_name` |
| `order.customer.email` ou `order.email` | `customer_email` |
| `order.customer.phone` | `customer_phone` |
| `order.customer.cpf` | `customer_doc` |
| Derivado de `getStateFromPhone(customer.phone)` | `customer_state` |
| (nao disponivel) | `customer_city` = `null` |
| (fixo) | `customer_country` = `'BR'` |
| `order.payment.payment_type` ou `order.payment.type` | `payment_method` |
| `order.currency` | `currency` (padrao: `'BRL'`) |
| `order.created_at` (com offset `-03:00`) | `sold_at` |

### Tracking (UTMs)
UTMs sao enviados no array `order.tracking_parameters`:
```json
[
  { "parameter_name": "utm_source", "parameter_value": "FBjLj..." },
  { "parameter_name": "utm_medium", "parameter_value": "CRIATIVO 59|120239..." }
]
```
O sistema faz lookup por `parameter_name` para extrair cada UTM.

### Metadata adicional (salvo em `raw_data`)
- `order_id`, `order_number`, `click_id`, `shop_id`
- `line_items_count`
- `coproducer_slug`, `coproducer_amount`
- `gateway`, `installments`

## 6. Regras de Negocio Especificas

### Calculo de valor
O valor ja vem em reais (nao centavos) no campo `payment.amount`.

### Estado do cliente
CartPanda nao envia endereco estruturado. O estado e derivado exclusivamente do DDD do telefone via `getStateFromPhone()`.

### Cidade nao disponivel
CartPanda nao fornece dados de cidade. O campo `customer_city` e sempre `null`.

### Datas em horario local
Datas vem no formato `"2026-01-08 19:43:27"` (sem timezone). O sistema adiciona offset `-03:00`.

### Multiplos line_items
CartPanda pode enviar multiplos itens (order bumps). O `product_name` usa o titulo do primeiro item.

### Upsert em vez de insert
Usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda lida de `order.currency`, padrao `'BRL'`
- Valor ja em reais
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido do campo `utm_content` (do array `tracking_parameters`) usando `extractNumericAdId()`.

## 9. Deteccao de Teste

Nao ha deteccao explicita de eventos de teste.

## 10. Endpoint

```
POST /api/webhooks/cartpanda
```

Respostas:
- `200` - Webhook processado (criado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/08-webhook-processing/cartpanda.md
git commit -m "docs: add CartPanda webhook processing documentation"
```

---

## Task 8: Documentation — GGCheckout

**Files:**
- Create: `docs/features/08-webhook-processing/ggcheckout.md`

- [ ] **Step 1: Create the documentation file**

```markdown
# Webhook - GGCheckout

## 1. Proposito

Processar notificacoes de vendas da plataforma GGCheckout, capturando dados de pagamento, cliente e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'ggcheckout'` e `is_active = true`.

## 3. Eventos Aceitos

GGCheckout envia o tipo de notificacao no campo `event`, combinando metodo de pagamento + acao:

| Evento GGCheckout | Acao |
|------------------|------|
| `pix.paid` | Criar venda com status `approved` |
| `card.paid` | Criar venda com status `approved` |
| `pix.refunded` | Criar venda com status `refunded` |
| `card.refunded` | Criar venda com status `refunded` |
| `pix.chargeback` | Criar venda com status `refunded` |
| `card.chargeback` | Criar venda com status `refunded` |

Eventos fora desta lista sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Evento GGCheckout | Status Interno |
|------------------|---------------|
| `pix.paid`, `card.paid` | `approved` |
| `pix.refunded`, `card.refunded`, `pix.chargeback`, `card.chargeback` | `refunded` |

## 5. Extracao de Dados

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `payment.id` | `external_id` (fallback: `ggcheckout_` + timestamp) |
| `product.title` ou `products[0].title` | `product_name` |
| `customer.name` | `customer_name` |
| `customer.email` | `customer_email` |
| `customer.phone` | `customer_phone` |
| `customer.document` | `customer_doc` |
| Derivado de `getStateFromPhone(customer.phone)` | `customer_state` |
| (nao disponivel) | `customer_city` = `null` |
| (fixo) | `customer_country` = `'BR'` |
| `payment.paymentMethod` | `payment_method` |
| (fixo) | `currency` = `'BRL'` |
| `createdAt._seconds` (Unix timestamp convertido) | `sold_at` |

### Tracking (UTMs)
UTMs sao enviados no objeto `params`:
```json
{
  "sck": "1772387201341_17723875827815",
  "src": "FB",
  "utm_source": "FB",
  "utm_medium": "CJ|120240276410330446",
  "utm_campaign": "[15S]+[Bid+Cap]|120240276410310446",
  "utm_content": "33|120240276410340446",
  "utm_term": "Instagram_Stories"
}
```

### Metadata adicional (salvo em `raw_data`)
- `payment_id`, `payment_status`, `payment_gateway`
- `product_id`, `product_type`
- `webhook_id`, `business_id`
- `sck`, `src`, `gclid`
- `customer_ip`

## 6. Regras de Negocio Especificas

### Calculo de valor
O valor ja vem em reais no campo `payment.amount`.

### Estado do cliente
GGCheckout nao envia endereco. O estado e derivado exclusivamente do DDD do telefone via `getStateFromPhone()`.

### Cidade nao disponivel
GGCheckout nao fornece dados de cidade. O campo `customer_city` e sempre `null`.

### Data em formato Firestore
Datas vem como objeto Firestore `{ _seconds: 1774227284, _nanoseconds: 479000000 }`. O sistema converte usando `new Date(_seconds * 1000).toISOString()`.

### Documento pode vir mascarado
O CPF pode vir parcialmente oculto (ex: `"***.763.104-**"`). O sistema salva como esta.

### Campos extras de tracking
`params.sck` e `params.src` sao salvos no `raw_data` como metadata adicional.

### Upsert em vez de insert
Usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda fixa `'BRL'`
- Valor ja em reais
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido do campo `params.utm_content` usando `extractNumericAdId()`.

## 9. Deteccao de Teste

Nao ha deteccao explicita de eventos de teste.

## 10. Endpoint

```
POST /api/webhooks/ggcheckout
```

Respostas:
- `200` - Webhook processado (criado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/08-webhook-processing/ggcheckout.md
git commit -m "docs: add GGCheckout webhook processing documentation"
```

---

## Task 9: Documentation — LastLink

**Files:**
- Create: `docs/features/08-webhook-processing/lastlink.md`

- [ ] **Step 1: Create the documentation file**

```markdown
# Webhook - LastLink

## 1. Proposito

Processar notificacoes de vendas e reembolsos da plataforma LastLink, capturando dados de compra, assinatura e tracking UTM para vinculacao com campanhas do Facebook Ads.

## 2. Autenticacao

| Fonte | Campo |
|-------|-------|
| Headers genericos | `x-webhook-token`, `x-api-token`, `authorization-token` |
| Body | `payload.token` |

O token e comparado com `webhook_secret` na tabela `checkout_integrations` onde `platform = 'lastlink'` e `is_active = true`.

## 3. Eventos Aceitos

LastLink nao usa um campo `event` padrao. O tipo e detectado pela estrutura do payload:

| Estrutura do Payload | Acao |
|---------------------|------|
| Contém `Purchase` + `Utm` | Criar venda com status `approved` |
| Contém `Action: "Remove"` | Atualizar venda existente para `refunded` |

Payloads sem `Purchase` e sem `Action=Remove` sao ignorados com `200 OK`.

## 4. Mapeamento de Status

| Estrutura do Payload | Status Interno |
|---------------------|---------------|
| Payload com `Purchase` | `approved` |
| Payload com `Action: "Remove"` | `refunded` |

## 5. Extracao de Dados (Compra)

| Campo do Payload | Coluna no Banco |
|-----------------|----------------|
| `Purchase.PaymentId` | `external_id` (fallback: `lastlink_` + timestamp) |
| `Products[0].Name` ou `Product.Name` | `product_name` |
| `Buyer.Name` | `customer_name` |
| `Buyer.Email` | `customer_email` |
| `Buyer.PhoneNumber` | `customer_phone` |
| `Buyer.Document` | `customer_doc` |
| Derivado de `getStateFromPhone(Buyer.PhoneNumber)` | `customer_state` |
| (nao disponivel) | `customer_city` = `null` |
| (fixo) | `customer_country` = `'BR'` |
| `Purchase.Payment.PaymentMethod` | `payment_method` |
| (fixo) | `currency` = `'BRL'` |
| `Purchase.PaymentDate` (com offset `-03:00`) | `sold_at` |

### Tracking (UTMs)
UTMs sao enviados no objeto `Utm` com PascalCase:
```json
{
  "UtmId": "120241859179080404",
  "UtmTerm": "Instagram_Stories",
  "UtmMedium": "17+DEZ+CJ+1|120241859179090404",
  "UtmSource": "FBjLj...",
  "UtmContent": "AD+1+TEST+17+DEZ|120241859179100404::PAZXh0...",
  "UtmCampaign": "AD+TEST+QUIZ+17+DEZ|120241859179080404"
}
```

### Metadata adicional (salvo em `raw_data`)
- `payment_id`, `subscription_id`
- `utm_id` (ID direto da campanha Facebook)
- `offer_id`, `offer_name`, `seller_id`
- `recurrency`, `installments`, `interest_rate`, `original_price`
- `commissions` (array com valores por source: MARKETPLACE, PRODUCER, COPRODUCER, AFFILIATE)
- `product_id`, `ip`, `user_agent`

## 6. Regras de Negocio Especificas

### Dois formatos de payload
LastLink envia payloads com estruturas completamente diferentes para compra e reembolso:
- **Compra**: contem `Purchase`, `Utm`, `Products`, `Buyer`, `Commissions`
- **Reembolso**: contem `Action: "Remove"`, `Product`, `Subscription`, `Buyer`

### Refund via Subscription.Id
O payload de reembolso **nao contem** `Purchase.PaymentId`. O sistema usa `Subscription.Id` para encontrar a venda original:
1. Na compra: `Subscriptions[0].Id` e salvo em `raw_data.subscription_id`
2. No reembolso: busca a venda onde `raw_data->>'subscription_id'` = `Subscription.Id`
3. Atualiza o status para `refunded`

### PascalCase em todos os campos
Todos os campos do payload usam PascalCase (ex: `Buyer.PhoneNumber`, `Purchase.PaymentDate`).

### Calculo de valor
O valor ja vem em reais no campo `Purchase.Price.Value`.

### Estado do cliente
LastLink nao envia endereco. O estado e derivado exclusivamente do DDD do telefone via `getStateFromPhone()`.

### Datas em horario local
Datas vem no formato `"2026-01-08T23:00:51"` (sem timezone). O sistema adiciona offset `-03:00`.

### Upsert em vez de insert
Usa `upsert` com conflito em `external_id,user_id`.

## 7. Tratamento de Moeda

- Moeda fixa `'BRL'`
- Valor ja em reais
- Nao ha conversao de cambio

## 8. Extracao de Ad ID

O ad_id e extraido do campo `Utm.UtmContent` usando `extractNumericAdId()`.

Nota: `Utm.UtmId` contem o ID direto da campanha do Facebook, salvo no `raw_data` para referencia.

## 9. Deteccao de Teste

| Condicao | Verificacao |
|----------|-----------|
| Campo de teste | `payload.IsTest === true` |

Webhooks de teste retornam `200 OK` com `ignored: true`.

## 10. Endpoint

```
POST /api/webhooks/lastlink
```

Respostas:
- `200` - Webhook processado (criado, atualizado ou ignorado)
- `401` - Token invalido ou integracao nao encontrada
- `500` - Erro interno
```

- [ ] **Step 2: Commit**

```bash
git add docs/features/08-webhook-processing/lastlink.md
git commit -m "docs: add LastLink webhook processing documentation"
```

---

## Task 10: Update WEBHOOKS.md

**Files:**
- Modify: `WEBHOOKS.md`

- [ ] **Step 1: Add new platform links to the table**

In `WEBHOOKS.md`, add the 4 new platforms to the table:

```markdown
| Hubla       | https://hubla.gitbook.io/docs/webhooks/eventos-v2 |
| CartPanda   | — (sem documentacao publica disponivel) |
| GGCheckout  | — (sem documentacao publica disponivel) |
| LastLink    | — (sem documentacao publica disponivel) |
```

- [ ] **Step 2: Commit**

```bash
git add WEBHOOKS.md
git commit -m "docs: add Hubla, CartPanda, GGCheckout, LastLink to WEBHOOKS.md"
```

---

## Task 11: Build Verification

- [ ] **Step 1: Run full TypeScript compilation**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npx tsc --noEmit --project packages/backend/tsconfig.json`

Expected: No errors.

- [ ] **Step 2: Run existing tests to ensure no regressions**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npm run test --workspace=packages/backend 2>&1 | tail -30`

Expected: All existing tests pass.

- [ ] **Step 3: Run lint**

Run: `cd /Users/matheusvalois/Documents/GitHub/remix-of-sentinel && npm run lint 2>&1 | tail -30`

Expected: No new lint errors.
