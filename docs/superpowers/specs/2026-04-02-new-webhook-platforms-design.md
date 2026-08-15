# Design: New Webhook Platform Integrations

**Date:** 2026-04-02
**Platforms:** Hubla, CartPanda, GGCheckout, LastLink
**Approach:** Individual processors (same pattern as existing 9 platforms)

---

## Overview

Add 4 new checkout platform webhook integrations to the Sentinela system. Each platform follows the established processor pattern: an `@Injectable()` NestJS service with a `process()` method that normalizes platform-specific webhook payloads into the `sales` table format, including UTM/tracking extraction for Facebook Ads campaign linking.

All 4 platforms send UTM data in their webhook payloads, enabling full ad attribution.

---

## Architecture

### Files to Create (per platform)

```
packages/backend/src/modules/webhooks/processors/{platform}.processor.ts
docs/features/08-webhook-processing/{platform}.md
```

### Files to Modify

```
packages/backend/src/modules/webhooks/webhooks.controller.ts   # Add routes
packages/backend/src/modules/webhooks/webhooks.module.ts        # Register processors
packages/backend/src/modules/webhooks/webhook-queue.service.ts  # Add to queue platforms
```

### Processing Model

All 4 platforms use the **async queue** pattern (same as Hotmart, Kiwify, etc.):
- Controller receives webhook, validates auth, enqueues to `webhook_queue`
- Returns `202 Accepted` immediately
- Queue processor picks up and processes via cron

---

## Platform Specifications

### 1. Hubla

**Events:**
| Webhook Event | Internal Status |
|---------------|----------------|
| `invoice.payment_succeeded` | `approved` |
| `refund_request.accepted` | `refunded` |

**Authentication:** Generic token headers

**Field Mapping:**

| sales column | Payload source |
|--------------|----------------|
| `external_id` | `event.invoice.id` |
| `amount` | `event.invoice.amount.totalCents / 100` |
| `currency` | `event.invoice.currency` |
| `customer_name` | `event.user.firstName + " " + event.user.lastName` |
| `customer_email` | `event.user.email` |
| `customer_phone` | `event.user.phone` |
| `customer_doc` | `event.user.document` |
| `customer_state` | `event.invoice.billingAddress.state` (normalize to UF) |
| `customer_city` | `event.invoice.billingAddress.city` |
| `customer_country` | `event.invoice.billingAddress.countryCode` |
| `product_name` | `event.product.name` or `event.products[0].name` |
| `payment_method` | `event.invoice.paymentMethod` |
| `sold_at` | `event.invoice.saleDate` (ISO 8601) |
| `utm_source` | `event.invoice.firstPaymentSession.utm.source` |
| `utm_medium` | `event.invoice.firstPaymentSession.utm.medium` |
| `utm_campaign` | `event.invoice.firstPaymentSession.utm.campaign` |
| `utm_content` | `event.invoice.firstPaymentSession.utm.content` |
| `utm_term` | `event.invoice.firstPaymentSession.utm.term` |
| `ad_id` | Extract from pipe-separated UTM values |

**Notes:**
- Amounts in **centavos** (divide by 100)
- Has `billingAddress` with real state/city (no DDD fallback needed)
- UTMs in clean structure: `firstPaymentSession.utm`
- Refund comes as separate event type (`refund_request.accepted`)

---

### 2. CartPanda

**Events:**
| Webhook Event | Internal Status |
|---------------|----------------|
| `order.paid` | `approved` |
| `order.refunded` | `refunded` |

**Authentication:** Generic token headers

**Field Mapping:**

| sales column | Payload source |
|--------------|----------------|
| `external_id` | `order.id` |
| `amount` | `order.payment.amount` |
| `currency` | `order.currency` |
| `customer_name` | `order.customer.full_name` |
| `customer_email` | `order.customer.email` or `order.email` |
| `customer_phone` | `order.customer.phone` |
| `customer_doc` | `order.customer.cpf` |
| `customer_state` | Derive from phone DDD |
| `customer_city` | `null` (not available) |
| `customer_country` | `BR` |
| `product_name` | `order.line_items[0].title` |
| `payment_method` | `order.payment.payment_type` |
| `sold_at` | `order.created_at` (local time, append `-03:00`) |
| `utm_source` | `tracking_parameters` where `parameter_name === 'utm_source'` |
| `utm_medium` | `tracking_parameters` where `parameter_name === 'utm_medium'` |
| `utm_campaign` | `tracking_parameters` where `parameter_name === 'utm_campaign'` |
| `utm_content` | `tracking_parameters` where `parameter_name === 'utm_content'` |
| `utm_term` | `tracking_parameters` where `parameter_name === 'utm_term'` |
| `ad_id` | Extract from pipe-separated UTM values |

**Notes:**
- UTMs in **array of objects** `[{parameter_name, parameter_value}]` — needs lookup by name
- `tracking_parameters` is at `order.tracking_parameters`
- Dates in local time without timezone, append `-03:00`
- Amount already in BRL (not centavos)
- Can have multiple `line_items` (order bumps) — use first as `product_name`
- State derived from phone DDD (no structured address)

---

### 3. GGCheckout

**Events:**
| Webhook Event | Internal Status |
|---------------|----------------|
| `pix.paid` | `approved` |
| `card.paid` | `approved` |
| `pix.refunded` | `refunded` |
| `card.refunded` | `refunded` |
| `pix.chargeback` | `refunded` |
| `card.chargeback` | `refunded` |

**Authentication:** Generic token headers

**Field Mapping:**

| sales column | Payload source |
|--------------|----------------|
| `external_id` | `payment.id` |
| `amount` | `payment.amount` |
| `currency` | `BRL` |
| `customer_name` | `customer.name` |
| `customer_email` | `customer.email` |
| `customer_phone` | `customer.phone` |
| `customer_doc` | `customer.document` |
| `customer_state` | Derive from phone DDD |
| `customer_city` | `null` (not available) |
| `customer_country` | `BR` |
| `product_name` | `product.title` or `products[0].title` |
| `payment_method` | `payment.paymentMethod` |
| `sold_at` | `createdAt._seconds` (Unix timestamp to ISO 8601) |
| `utm_source` | `params.utm_source` |
| `utm_medium` | `params.utm_medium` |
| `utm_campaign` | `params.utm_campaign` |
| `utm_content` | `params.utm_content` |
| `utm_term` | `params.utm_term` |
| `ad_id` | Extract from pipe-separated UTM values |

**Notes:**
- `params.sck` and `params.src` are extra tracking fields (store in `metadata`)
- Date in **Firestore timestamp** format (`{_seconds, _nanoseconds}`) — convert to ISO 8601
- Amount already in BRL
- Event combines method + action (`pix.paid`, `card.refunded`)
- State derived from DDD
- Document may come masked (`***.763.104-**`) — save as-is

---

### 4. LastLink

**Events:**
| Webhook Pattern | Internal Status |
|-----------------|----------------|
| Payload has `Purchase` + `Utm` | `approved` |
| Payload has `Action: "Remove"` | `refunded` |

**Authentication:** Generic token headers

**Field Mapping (Purchase/Approved):**

| sales column | Payload source |
|--------------|----------------|
| `external_id` | `Purchase.PaymentId` |
| `amount` | `Purchase.Price.Value` |
| `currency` | `BRL` |
| `customer_name` | `Buyer.Name` |
| `customer_email` | `Buyer.Email` |
| `customer_phone` | `Buyer.PhoneNumber` |
| `customer_doc` | `Buyer.Document` |
| `customer_state` | Derive from phone DDD |
| `customer_city` | `null` (not available) |
| `customer_country` | `BR` |
| `product_name` | `Products[0].Name` or `Product.Name` |
| `payment_method` | `Purchase.Payment.PaymentMethod` |
| `sold_at` | `Purchase.PaymentDate` (local time, append `-03:00`) |
| `utm_source` | `Utm.UtmSource` |
| `utm_medium` | `Utm.UtmMedium` |
| `utm_campaign` | `Utm.UtmCampaign` |
| `utm_content` | `Utm.UtmContent` |
| `utm_term` | `Utm.UtmTerm` |
| `ad_id` | Extract from pipe-separated UTM values |

**Refund Handling:**
- Refund payload has `Action: "Remove"` with `Subscription.Id` but **no `Purchase.PaymentId`**
- On purchase: store `Subscriptions[0].Id` in `metadata.subscription_id`
- On refund: find sale where `metadata->>'subscription_id' = Subscription.Id`, update status to `refunded`

**Notes:**
- Two distinct payload formats: purchase vs revocation
- PascalCase in all fields (unique among platforms)
- `Utm.UtmId` contains Facebook campaign ID directly (store in `metadata`)
- Commissions available (`Commissions[]`) — store marketplace fee in `metadata`
- Dates in local time without timezone, append `-03:00`

---

## Shared Patterns (all 4 platforms)

1. **Ad ID extraction:** Use existing `WebhooksService.extractNumericAdId()` to extract Facebook ad IDs from pipe-separated UTM values (e.g., `"CAMPANHA|120239247454700535"` → `"120239247454700535"`)
2. **Ad matching:** Call `WebhooksService.matchAndUpdateSale()` after insert (fire-and-forget)
3. **Deduplication:** Check `external_id + user_id` before inserting, use `upsert` with `onConflict`
4. **State normalization:** Use `normalizeState()` helper for Hubla; use `dddToState()` for others
5. **Test detection:** Skip test webhooks (check platform-specific flags)
6. **Queue processing:** All platforms added to `webhook-queue.service.ts` platform list
7. **Controller routing:** Add platform names to the controller's platform enum/validation

## Documentation

Each platform gets a doc file in `docs/features/08-webhook-processing/{platform}.md` following the format of existing platform docs (events, payload structure, authentication, field mapping, edge cases).

Update `WEBHOOKS.md` at root with documentation links for the new platforms (where available).
