// packages/backend/src/modules/stripe/stripe-checkout.service.ts
import { BadRequestException, HttpException, Injectable, Logger } from '@nestjs/common';
import Stripe from 'stripe';
import { StripeService } from './stripe.service';
import { SupabaseService } from '../../shared/services/supabase.service';
import { PlanLimitsService } from '../plan-limits/plan-limits.service';

export type CheckoutResult =
  | { url: string }
  | { redirectTo: string }
  | { changed: true; plan: string };

export type PlanChangePreview = {
  kind: 'upgrade' | 'downgrade' | 'same';
  currentPlan: string;
  targetPlan: string;
  chargeNowCents: number;
  nextChargeCents: number;
  effectiveDate: string;
  currency: string;
};

@Injectable()
export class StripeCheckoutService {
  private readonly logger = new Logger(StripeCheckoutService.name);

  constructor(
    private readonly stripe: StripeService,
    private readonly supabase: SupabaseService,
    private readonly planLimits: PlanLimitsService,
  ) {}

  async createCheckoutSession(userId: string, planId: string): Promise<CheckoutResult> {
    const client = this.supabase.getClient();

    // 1. Load plan
    const { data: plan, error: planErr } = await client
      .from('plan_rules')
      .select('id, plan, stripe_price_id_base, stripe_price_id_metered, max_sales_monthly, overage_price_cents')
      .eq('id', planId)
      .maybeSingle();
    if (planErr) throw planErr;
    if (!plan) throw new BadRequestException('Plan not found');
    if (!plan.stripe_price_id_base || !plan.stripe_price_id_metered) {
      throw new BadRequestException(`Plan ${plan.plan} is not available for subscription`);
    }

    // 2. Load current subscription
    const { data: sub, error: subErr } = await client
      .from('subscriptions')
      .select('id, plan_id, stripe_customer_id, stripe_subscription_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!sub) throw new BadRequestException('Subscription not found — signup flow incomplete');

    // 3. Already has paid subscription → swap plan items in place.
    if (sub.stripe_subscription_id) {
      if (sub.plan_id === plan.id) {
        throw new BadRequestException('Você já está neste plano');
      }
      if (!sub.stripe_customer_id) {
        throw new BadRequestException('Subscription sem customer Stripe associado');
      }
      await this.changeExistingPlan(
        userId,
        sub.stripe_customer_id,
        sub.stripe_subscription_id,
        {
          id: plan.id,
          plan: plan.plan,
          basePriceId: plan.stripe_price_id_base,
          meteredPriceId: plan.stripe_price_id_metered,
          maxSalesMonthly: plan.max_sales_monthly,
          overagePriceCents: plan.overage_price_cents,
        },
      );
      return { changed: true, plan: plan.plan };
    }

    // 4. Resolve customer — create if missing
    let customerId = sub.stripe_customer_id;
    if (!customerId) {
      const { data: profile, error: profileErr } = await client
        .from('profiles')
        .select('email, name, cpf, cnpj')
        .eq('user_id', userId)
        .maybeSingle();
      if (profileErr) throw profileErr;
      if (!profile) throw new BadRequestException('Profile not found');

      // Brazilian tax ID: user has CPF xor CNPJ. Prefer whichever is set and
      // valid; omit tax_id_data if neither is present. Stripe renders the ID
      // on invoices and the Customer Portal.
      const cpfDigits = (profile.cpf ?? '').replace(/\D/g, '');
      const cnpjDigits = (profile.cnpj ?? '').replace(/\D/g, '');
      const taxIdData =
        cnpjDigits.length === 14
          ? [{ type: 'br_cnpj' as const, value: cnpjDigits }]
          : cpfDigits.length === 11
          ? [{ type: 'br_cpf' as const, value: cpfDigits }]
          : undefined;

      const customer = await this.stripe.getClient().customers.create({
        email: profile.email ?? undefined,
        name: profile.name ?? undefined,
        tax_id_data: taxIdData,
        metadata: {
          user_id: userId,
          cpf: cpfDigits,
          cnpj: cnpjDigits,
        },
      });
      customerId = customer.id;

      const { error: updateErr } = await client
        .from('subscriptions')
        .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
        .eq('user_id', userId);
      if (updateErr) throw updateErr;
    }

    // 5. Create Checkout Session
    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const session = await this.stripe.getClient().checkout.sessions.create({
      mode: 'subscription',
      customer: customerId,
      payment_method_types: ['card'],
      line_items: [
        { price: plan.stripe_price_id_base, quantity: 1 },
        { price: plan.stripe_price_id_metered },
      ],
      subscription_data: {
        metadata: { user_id: userId, plan_id: plan.id },
      },
      success_url: `${frontendUrl}/settings?tab=plan&status=success&session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${frontendUrl}/settings?tab=plan&status=cancel`,
      locale: 'pt-BR',
    });

    if (!session.url) {
      throw new Error('Stripe did not return a session URL');
    }

    return { url: session.url };
  }

  async previewPlanChange(userId: string, planId: string): Promise<PlanChangePreview> {
    const client = this.supabase.getClient();

    const { data: target, error: targetErr } = await client
      .from('plan_rules')
      .select('id, plan, stripe_price_id_base, stripe_price_id_metered, max_sales_monthly, overage_price_cents')
      .eq('id', planId)
      .maybeSingle();
    if (targetErr) throw targetErr;
    if (!target) throw new BadRequestException('Plan not found');
    if (!target.stripe_price_id_base || !target.stripe_price_id_metered) {
      throw new BadRequestException(`Plan ${target.plan} is not available for subscription`);
    }

    const { data: sub, error: subErr } = await client
      .from('subscriptions')
      .select('plan_id, stripe_customer_id, stripe_subscription_id, plan_rules:plan_id(plan, stripe_price_id_base)')
      .eq('user_id', userId)
      .maybeSingle();
    if (subErr) throw subErr;
    if (!sub?.stripe_subscription_id || !sub.stripe_customer_id) {
      throw new BadRequestException('Sem assinatura Stripe ativa');
    }
    if (sub.plan_id === target.id) {
      throw new BadRequestException('Você já está neste plano');
    }
    const currentRule = sub.plan_rules as { plan?: string; stripe_price_id_base?: string } | null;
    if (!currentRule?.stripe_price_id_base) {
      throw new BadRequestException('Plano atual sem price ID configurado');
    }

    const stripe = this.stripe.getClient();
    const [targetPrice, currentPrice, current] = await Promise.all([
      stripe.prices.retrieve(target.stripe_price_id_base),
      stripe.prices.retrieve(currentRule.stripe_price_id_base),
      stripe.subscriptions.retrieve(sub.stripe_subscription_id),
    ]);

    const targetUnit = targetPrice.unit_amount ?? 0;
    const currentUnit = currentPrice.unit_amount ?? 0;
    const diff = targetUnit - currentUnit;

    const kind: PlanChangePreview['kind'] =
      diff > 0 ? 'upgrade' : diff < 0 ? 'downgrade' : 'same';

    // Projeta overage do ciclo sob o novo plano (mesma lógica de changeExistingPlan).
    let overageCents = 0;
    if (kind === 'upgrade' && (target as any).max_sales_monthly !== -1) {
      const periodStartIso = new Date(current.current_period_start * 1000).toISOString();
      const periodEndIso = new Date(current.current_period_end * 1000).toISOString();
      const { count: totalSales } = await client
        .from('sales')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'approved')
        .eq('blocked_by_limit', false)
        .eq('source', 'webhook')
        .gte('sold_at', periodStartIso)
        .lt('sold_at', periodEndIso);
      const overageUnits = Math.max(0, (totalSales ?? 0) - (target as any).max_sales_monthly);
      overageCents = overageUnits * (target as any).overage_price_cents;
    }

    this.logger.log(
      `Preview plan change user=${userId} ${currentRule.plan} → ${target.plan} kind=${kind} diff=${diff} overage=${overageCents}`,
    );

    return {
      kind,
      currentPlan: currentRule.plan ?? '',
      targetPlan: target.plan,
      chargeNowCents: kind === 'upgrade' ? diff + overageCents : 0,
      nextChargeCents: targetUnit,
      effectiveDate: new Date(current.current_period_end * 1000).toISOString(),
      currency: targetPrice.currency ?? 'brl',
    };
  }

  private async changeExistingPlan(
    userId: string,
    stripeCustomerId: string,
    stripeSubscriptionId: string,
    targetPlan: {
      id: string;
      plan: string;
      basePriceId: string;
      meteredPriceId: string;
      maxSalesMonthly: number;
      overagePriceCents: number;
    },
  ): Promise<void> {
    const stripe = this.stripe.getClient();

    // 1. Lê estado atual: customer (pra default PM), subscription (pra status + items + cancel flag).
    const [customer, current] = await Promise.all([
      stripe.customers.retrieve(stripeCustomerId),
      stripe.subscriptions.retrieve(stripeSubscriptionId, { expand: ['items.data.price'] }),
    ]);
    if ((customer as Stripe.Customer | Stripe.DeletedCustomer).deleted) {
      throw new BadRequestException('Customer Stripe foi removido');
    }
    const customerObj = customer as Stripe.Customer;

    if (current.status === 'past_due') {
      throw new BadRequestException(
        'Sua assinatura está com pagamento pendente. Resolva a fatura aberta antes de trocar de plano.',
      );
    }

    const existingBase = current.items.data.find(
      (item) => item.price.recurring?.usage_type === 'licensed',
    );
    const existingMetered = current.items.data.find(
      (item) => item.price.recurring?.usage_type === 'metered',
    );
    const currentBasePriceId =
      typeof existingBase?.price === 'string'
        ? existingBase.price
        : existingBase?.price.id;
    if (!currentBasePriceId) {
      throw new BadRequestException('Subscription sem price base');
    }

    // 2. Classifica upgrade/downgrade comparando unit_amount.
    const [targetPriceObj, currentPriceObj] = await Promise.all([
      stripe.prices.retrieve(targetPlan.basePriceId),
      stripe.prices.retrieve(currentBasePriceId),
    ]);
    const diffCents = (targetPriceObj.unit_amount ?? 0) - (currentPriceObj.unit_amount ?? 0);

    const targetItems: Array<{ id?: string; price: string }> = [];
    if (existingBase) targetItems.push({ id: existingBase.id, price: targetPlan.basePriceId });
    else targetItems.push({ price: targetPlan.basePriceId });
    if (existingMetered) targetItems.push({ id: existingMetered.id, price: targetPlan.meteredPriceId });
    else targetItems.push({ price: targetPlan.meteredPriceId });

    if (diffCents <= 0) {
      // DOWNGRADE: schedule item swap for end of current period.
      // User keeps higher plan until current_period_end, then auto-switches.
      const schedule = await stripe.subscriptionSchedules.create({
        from_subscription: stripeSubscriptionId,
      });

      const currentPhase = schedule.phases[0];
      if (!currentPhase) {
        throw new Error(`Schedule ${schedule.id} has no current phase`);
      }

      await stripe.subscriptionSchedules.update(schedule.id, {
        end_behavior: 'release',
        phases: [
          {
            items: currentPhase.items.map((item) => ({
              price: typeof item.price === 'string' ? item.price : item.price.id,
              quantity: item.quantity ?? undefined,
            })),
            start_date: currentPhase.start_date,
            end_date: currentPhase.end_date ?? undefined,
            proration_behavior: 'none',
          },
          {
            items: [
              { price: targetPlan.basePriceId },
              { price: targetPlan.meteredPriceId },
            ],
            iterations: 1,
            proration_behavior: 'none',
          },
        ],
      });

      // Persist scheduled state locally for immediate UX feedback.
      const scheduledChangesAt = new Date(current.current_period_end * 1000).toISOString();
      const { error: updateErr } = await this.supabase.getClient()
        .from('subscriptions')
        .update({
          scheduled_plan_id: targetPlan.id,
          scheduled_changes_at: scheduledChangesAt,
          updated_at: new Date().toISOString(),
        })
        .eq('stripe_subscription_id', stripeSubscriptionId);
      if (updateErr) throw updateErr;
      await this.planLimits.invalidate(userId);

      this.logger.log(
        `Scheduled downgrade for subscription ${stripeSubscriptionId} → ${targetPlan.plan} at ${scheduledChangesAt}`,
      );
      return;
    }

    // UPGRADE
    // 2a. Pré-condição: customer tem default PM.
    const defaultPmId =
      typeof customerObj.invoice_settings?.default_payment_method === 'string'
        ? customerObj.invoice_settings.default_payment_method
        : customerObj.invoice_settings?.default_payment_method?.id ?? null;
    if (!defaultPmId) {
      throw new BadRequestException('Adicione um cartão antes de fazer upgrade');
    }

    // 2b. Reativa cancel_at_period_end se aplicável (descarta agendamento de cancel).
    const wasCanceling = current.cancel_at_period_end === true;
    if (wasCanceling) {
      await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: false });
      this.logger.log(
        `Reactivated subscription ${stripeSubscriptionId} (was canceling) before upgrade`,
      );
    }

    // 2c. Calcula overage do ciclo sob o NOVO plano (Solução B).
    // Modelo: ao fazer upgrade no meio do ciclo, re-avaliamos o overage acumulado
    // usando o limite e preço do plano alvo. As rows antigas em usage_overage são
    // marcadas como settled (não vão pra fatura via meter; cobrança vai inline).
    const periodStartIso = new Date(current.current_period_start * 1000).toISOString();
    const periodEndIso = new Date(current.current_period_end * 1000).toISOString();

    let overageUnits = 0;
    let overageCents = 0;
    if (targetPlan.maxSalesMonthly !== -1) {
      const { count: totalSales, error: salesErr } = await this.supabase.getClient()
        .from('sales')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', userId)
        .eq('status', 'approved')
        .eq('blocked_by_limit', false)
        .eq('source', 'webhook')
        .gte('sold_at', periodStartIso)
        .lt('sold_at', periodEndIso);
      if (salesErr) throw salesErr;
      overageUnits = Math.max(0, (totalSales ?? 0) - targetPlan.maxSalesMonthly);
      overageCents = overageUnits * targetPlan.overagePriceCents;
    }

    // 2d. Cria invoice item da diff.
    let invoiceItem: Stripe.InvoiceItem;
    try {
      invoiceItem = await stripe.invoiceItems.create(
        {
          customer: stripeCustomerId,
          amount: diffCents,
          currency: targetPriceObj.currency ?? 'brl',
          description: `Upgrade plano ${targetPlan.plan} (diferença)`,
          metadata: {
            kind: 'plan_upgrade_diff',
            user_id: userId,
            target_plan_id: targetPlan.id,
          },
        },
        { idempotencyKey: `invoiceItem:${userId}:${targetPlan.id}:${current.current_period_end}` },
      );
    } catch (err) {
      this.logger.error(`Failed to create invoice item for upgrade ${stripeSubscriptionId}`, err);
      throw err;
    }

    // 2e. Cria invoice item de overage settle se aplicável.
    let overageInvoiceItem: Stripe.InvoiceItem | null = null;
    if (overageCents > 0) {
      try {
        const formattedPrice = (targetPlan.overagePriceCents / 100).toFixed(2).replace('.', ',');
        overageInvoiceItem = await stripe.invoiceItems.create(
          {
            customer: stripeCustomerId,
            amount: overageCents,
            currency: targetPriceObj.currency ?? 'brl',
            description: `Excedente do ciclo · ${overageUnits} vendas × R$ ${formattedPrice}`,
            metadata: {
              kind: 'plan_upgrade_overage_settle',
              user_id: userId,
              target_plan_id: targetPlan.id,
              overage_units: String(overageUnits),
            },
          },
          { idempotencyKey: `overageItem:${userId}:${targetPlan.id}:${current.current_period_end}` },
        );
      } catch (err) {
        // Rollback do invoice item da diff que acabou de ser criado.
        try {
          if (invoiceItem.id) await stripe.invoiceItems.del(invoiceItem.id);
        } catch (delErr) {
          this.logger.error(`Failed to delete orphan diff item ${invoiceItem.id}`, delErr);
        }
        this.logger.error(`Failed to create overage settle item for upgrade ${stripeSubscriptionId}`, err);
        throw err;
      }
    }

    // 2f. Cria + finaliza + paga invoice avulsa, com idempotency key derivada do estado.
    const idempotencyKey = `upgrade:${userId}:${targetPlan.id}:${current.current_period_end}`;
    let paidInvoiceId: string | null = null;
    try {
      const invoice = await stripe.invoices.create(
        {
          customer: stripeCustomerId,
          auto_advance: false,
          collection_method: 'charge_automatically',
          pending_invoice_items_behavior: 'include',
          metadata: {
            kind: 'plan_upgrade_diff',
            user_id: userId,
            target_plan_id: targetPlan.id,
          },
        },
        { idempotencyKey },
      );
      if (!invoice.id) {
        throw new Error('Stripe did not return invoice id');
      }
      await stripe.invoices.finalizeInvoice(invoice.id);
      await stripe.invoices.pay(invoice.id);
      paidInvoiceId = invoice.id;
    } catch (err) {
      // Roll back invoice items órfãos (diff + overage).
      try {
        if (invoiceItem.id) await stripe.invoiceItems.del(invoiceItem.id);
      } catch (delErr) {
        this.logger.error(`Failed to delete orphan invoice item ${invoiceItem.id}`, delErr);
      }
      if (overageInvoiceItem?.id) {
        try {
          await stripe.invoiceItems.del(overageInvoiceItem.id);
        } catch (delErr) {
          this.logger.error(`Failed to delete orphan overage item ${overageInvoiceItem.id}`, delErr);
        }
      }
      // Restaura cancel_at_period_end se reativação foi aplicada antes da cobrança.
      if (wasCanceling) {
        try {
          await stripe.subscriptions.update(stripeSubscriptionId, { cancel_at_period_end: true });
        } catch (revertErr) {
          this.logger.error(
            `Failed to restore cancel_at_period_end after charge failure ${stripeSubscriptionId}`,
            revertErr,
          );
        }
      }
      const stripeErr = err as { code?: string };
      const declineCode = typeof stripeErr.code === 'string' ? stripeErr.code : undefined;
      throw new HttpException(
        {
          statusCode: 402,
          message: 'Não foi possível cobrar a diferença do upgrade. Verifique seu cartão.',
          declineCode,
        },
        402,
      );
    }

    // 2g. Marca usage_overage rows do ciclo como settled.
    // Mesmo se overageCents=0: os events que foram para o meter do plano antigo
    // ficam órfãos (não serão cobrados pela Stripe), e queremos que o cron de
    // reconciliação pare de tentar disparar meter events pendentes desse ciclo.
    // Filter: rows do ciclo atual. SalesService grava period_start/end com
    // os bounds exatos da subscription, então usamos eq pra match preciso.
    await this.supabase.getClient()
      .from('usage_overage')
      .update({
        settled_at: new Date().toISOString(),
        settled_by_invoice_id: paidInvoiceId,
      })
      .eq('user_id', userId)
      .eq('period_start', periodStartIso)
      .eq('period_end', periodEndIso)
      .is('settled_at', null);

    // 2h. Troca itens da subscription (preserva billing_cycle_anchor).
    await stripe.subscriptions.update(stripeSubscriptionId, {
      items: targetItems,
      proration_behavior: 'none',
    });
    await this.planLimits.invalidate(userId);
    this.logger.log(
      `Upgraded subscription ${stripeSubscriptionId} → ${targetPlan.plan} ` +
      `(diff ${diffCents} cents + overage ${overageCents} cents from ${overageUnits} sales)`,
    );
  }

  async cancelSubscription(userId: string): Promise<{
    canceled_at: string;
    ends_at: string;
    already_scheduled: boolean;
  }> {
    const { data: sub, error } = await this.supabase.getClient()
      .from('subscriptions')
      .select('stripe_subscription_id, cancel_at_period_end, plan_rules:plan_id(plan)')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.stripe_subscription_id) {
      throw new BadRequestException('Nenhuma assinatura Stripe ativa');
    }
    const planSlug = (sub.plan_rules as { plan?: string } | null)?.plan ?? '';
    if (planSlug === 'unlimited') {
      throw new BadRequestException('Plano Unlimited é gerenciado pelo suporte');
    }

    const stripe = this.stripe.getClient();
    const current = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    const endsAtIso = new Date(current.current_period_end * 1000).toISOString();
    const nowIso = new Date().toISOString();

    if (current.cancel_at_period_end) {
      return { canceled_at: nowIso, ends_at: endsAtIso, already_scheduled: true };
    }

    await stripe.subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: true,
    });
    this.logger.log(`Scheduled cancel for subscription ${sub.stripe_subscription_id} (user ${userId})`);

    // Write-through: update local DB immediately so the UI reflects the change
    // before the Stripe webhook fires (which can take 1-3+ seconds).
    await this.supabase.getClient()
      .from('subscriptions')
      .update({ cancel_at_period_end: true, updated_at: nowIso })
      .eq('user_id', userId);
    await this.planLimits.invalidate(userId);

    return { canceled_at: nowIso, ends_at: endsAtIso, already_scheduled: false };
  }

  async reactivateSubscription(userId: string): Promise<{ success: true }> {
    const { data: sub, error } = await this.supabase.getClient()
      .from('subscriptions')
      .select('stripe_subscription_id, cancel_at_period_end')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.stripe_subscription_id) {
      throw new BadRequestException('Nenhuma assinatura Stripe ativa');
    }
    if (!sub.cancel_at_period_end) {
      throw new BadRequestException('Assinatura já está ativa');
    }

    await this.stripe.getClient().subscriptions.update(sub.stripe_subscription_id, {
      cancel_at_period_end: false,
    });
    this.logger.log(`Reactivated subscription ${sub.stripe_subscription_id} for user ${userId}`);

    // Write-through: update local DB immediately so the UI reflects the change
    // before the Stripe webhook fires (which can take 1-3+ seconds).
    await this.supabase.getClient()
      .from('subscriptions')
      .update({ cancel_at_period_end: false, updated_at: new Date().toISOString() })
      .eq('user_id', userId);
    await this.planLimits.invalidate(userId);

    return { success: true };
  }

  async createPortalSession(userId: string): Promise<{ url: string }> {
    const { data: sub, error } = await this.supabase.getClient()
      .from('subscriptions')
      .select('stripe_customer_id')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw error;
    if (!sub?.stripe_customer_id) {
      throw new BadRequestException('Nenhuma assinatura Stripe ativa');
    }

    const frontendUrl = process.env.FRONTEND_URL ?? 'http://localhost:5173';
    const session = await this.stripe.getClient().billingPortal.sessions.create({
      customer: sub.stripe_customer_id,
      return_url: `${frontendUrl}/settings?tab=plan`,
      locale: 'pt-BR',
    });

    return { url: session.url };
  }

}
