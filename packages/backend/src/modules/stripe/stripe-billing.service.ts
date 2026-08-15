// packages/backend/src/modules/stripe/stripe-billing.service.ts
import { BadRequestException, ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import { SupabaseService } from '../../shared/services/supabase.service';

export type InvoiceDto = {
  id: string;
  number: string | null;
  status: Stripe.Invoice.Status | 'unknown';
  amount_due_cents: number;
  amount_paid_cents: number;
  total_cents: number;
  currency: string;
  created: string;
  period_start: string | null;
  period_end: string | null;
  hosted_invoice_url: string | null;
  invoice_pdf: string | null;
};

export type PaymentMethodDto = {
  id: string;
  brand: string;
  last4: string;
  exp_month: number;
  exp_year: number;
  is_default: boolean;
};

export type PaymentMethodsResponse = {
  default_payment_method_id: string | null;
  payment_methods: PaymentMethodDto[];
};

const INVOICE_LIMIT = 12;

@Injectable()
export class StripeBillingService {
  private readonly logger = new Logger(StripeBillingService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
  ) {}

  async listInvoices(userId: string): Promise<InvoiceDto[]> {
    const customerId = await this.requireCustomerId(userId);

    const invoices = await this.stripe.getClient().invoices.list({
      customer: customerId,
      limit: INVOICE_LIMIT,
    });

    return invoices.data.map((invoice) => this.toInvoiceDto(invoice));
  }

  async listPaymentMethods(userId: string): Promise<PaymentMethodsResponse> {
    const customerId = await this.requireCustomerId(userId);
    const stripe = this.stripe.getClient();

    const [customer, paymentMethods] = await Promise.all([
      stripe.customers.retrieve(customerId),
      stripe.paymentMethods.list({ customer: customerId, type: 'card' }),
    ]);

    if (customer.deleted) {
      throw new BadRequestException('Stripe customer foi removido');
    }

    const defaultId =
      typeof customer.invoice_settings?.default_payment_method === 'string'
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id ?? null;

    const items = paymentMethods.data.map((pm) => this.toPaymentMethodDto(pm, defaultId));

    items.sort((a, b) => Number(b.is_default) - Number(a.is_default));

    return { default_payment_method_id: defaultId, payment_methods: items };
  }

  async attachPaymentMethod(
    userId: string,
    paymentMethodId: string,
    opts: { setAsDefault: boolean },
  ): Promise<{ success: true; is_default: boolean }> {
    const customerId = await this.requireCustomerId(userId);
    await this.assertPaymentMethodOwnedBy(paymentMethodId, customerId);

    const list = await this.stripe.getClient().paymentMethods.list({
      customer: customerId,
      type: 'card',
    });
    const isFirstPm = list.data.length === 1 && list.data[0]?.id === paymentMethodId;
    const shouldBeDefault = opts.setAsDefault || isFirstPm;

    if (shouldBeDefault) {
      await this.stripe.getClient().customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId },
      });
      this.logger.log(`Set ${paymentMethodId} as default for ${customerId}`);
    }

    return { success: true, is_default: shouldBeDefault };
  }

  async setDefaultPaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
    const customerId = await this.requireCustomerId(userId);
    await this.assertPaymentMethodOwnedBy(paymentMethodId, customerId);

    await this.stripe.getClient().customers.update(customerId, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    this.logger.log(`Default payment method set to ${paymentMethodId} for customer ${customerId}`);
  }

  async detachPaymentMethod(userId: string, paymentMethodId: string): Promise<void> {
    const customerId = await this.requireCustomerId(userId);
    await this.assertPaymentMethodOwnedBy(paymentMethodId, customerId);

    await this.stripe.getClient().paymentMethods.detach(paymentMethodId);

    this.logger.log(`Detached payment method ${paymentMethodId} from customer ${customerId}`);
  }

  async createSetupIntent(userId: string): Promise<{ clientSecret: string }> {
    const customerId = await this.requireCustomerId(userId);

    const intent = await this.stripe.getClient().setupIntents.create({
      customer: customerId,
      payment_method_types: ['card'],
      usage: 'off_session',
      metadata: { user_id: userId },
    });

    if (!intent.client_secret) {
      throw new Error('Stripe did not return client_secret');
    }

    this.logger.log(`Created SetupIntent ${intent.id} for customer ${customerId}`);
    return { clientSecret: intent.client_secret };
  }

  private async requireCustomerId(userId: string): Promise<string> {
    const { data, error } = await this.supabase.getClient()
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!data?.stripe_customer_id) {
      throw new NotFoundException('Nenhum cliente Stripe associado a este usuário');
    }
    return data.stripe_customer_id;
  }

  private async assertPaymentMethodOwnedBy(paymentMethodId: string, customerId: string): Promise<void> {
    const pm = await this.stripe.getClient().paymentMethods.retrieve(paymentMethodId);
    const ownerId = typeof pm.customer === 'string' ? pm.customer : pm.customer?.id ?? null;
    if (ownerId !== customerId) {
      throw new ForbiddenException('Método de pagamento não pertence a este usuário');
    }
  }

  private toInvoiceDto(invoice: Stripe.Invoice): InvoiceDto {
    return {
      id: invoice.id,
      number: invoice.number ?? null,
      status: invoice.status ?? 'unknown',
      amount_due_cents: invoice.amount_due ?? 0,
      amount_paid_cents: invoice.amount_paid ?? 0,
      total_cents: invoice.total ?? 0,
      currency: invoice.currency ?? 'brl',
      created: new Date(invoice.created * 1000).toISOString(),
      period_start: invoice.period_start
        ? new Date(invoice.period_start * 1000).toISOString()
        : null,
      period_end: invoice.period_end
        ? new Date(invoice.period_end * 1000).toISOString()
        : null,
      hosted_invoice_url: invoice.hosted_invoice_url ?? null,
      invoice_pdf: invoice.invoice_pdf ?? null,
    };
  }

  private toPaymentMethodDto(pm: Stripe.PaymentMethod, defaultId: string | null): PaymentMethodDto {
    const card = pm.card;
    return {
      id: pm.id,
      brand: card?.brand ?? 'unknown',
      last4: card?.last4 ?? '••••',
      exp_month: card?.exp_month ?? 0,
      exp_year: card?.exp_year ?? 0,
      is_default: pm.id === defaultId,
    };
  }
}
