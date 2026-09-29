import { Injectable, Logger, Inject, forwardRef } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SupabaseService } from '../../shared/services/supabase.service';
import { HotmartProcessor } from './processors/hotmart.processor';
import { KiwifyProcessor } from './processors/kiwify.processor';
import { KirvanoProcessor } from './processors/kirvano.processor';
import { PerfectPayProcessor } from './processors/perfectpay.processor';
import { TictoProcessor } from './processors/ticto.processor';
import { CaktoProcessor } from './processors/cakto.processor';
import { PaytProcessor } from './processors/payt.processor';
import { HublaProcessor } from './processors/hubla.processor';
import { CartPandaProcessor } from './processors/cartpanda.processor';
import { GGCheckoutProcessor } from './processors/ggcheckout.processor';
import { LastLinkProcessor } from './processors/lastlink.processor';
import { GuruProcessor } from './processors/guru.processor';
import { EduzzProcessor } from './processors/eduzz.processor';
import { MundpayProcessor } from './processors/mundpay.processor';
import { MonetizzeProcessor } from './processors/monetizze.processor';
import { GreennProcessor } from './processors/greenn.processor';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';
import { MetaCapiService } from '../meta-capi/meta-capi.service';
import { GenericCheckoutProcessor } from './processors/generic/generic-checkout.processor';
import { GENERIC_PLATFORMS } from './processors/generic/checkout-specs';
import {
  extractTrackingRef,
  WebhookContext,
  webhookContext,
} from '../../shared/helpers/webhook-context';

/** All checkout platforms processed directly (no queue). */
const QUEUED_PLATFORMS = new Set([
  'hotmart',
  'kiwify',
  'kirvano',
  'perfectpay',
  'ticto',
  'cakto',
  'payt',
  'hubla',
  'cartpanda',
  'ggcheckout',
  'lastlink',
  'guru',
  'eduzz',
  'mundpay',
  'monetizze',
  'greenn',
]);

export interface WebhookQueuePayload {
  platform: string;
  body: any;
  authToken: string | null;
  headers?: Record<string, string | string[] | undefined>;
  rawBody?: string;
  queryParams?: Record<string, string>;
}

@Injectable()
export class WebhookQueueService {
  private readonly logger = new Logger(WebhookQueueService.name);

  constructor(
    private readonly supabase: SupabaseService,
    @Inject(forwardRef(() => HotmartProcessor))
    private readonly hotmart: HotmartProcessor,
    @Inject(forwardRef(() => KiwifyProcessor))
    private readonly kiwify: KiwifyProcessor,
    @Inject(forwardRef(() => KirvanoProcessor))
    private readonly kirvano: KirvanoProcessor,
    @Inject(forwardRef(() => PerfectPayProcessor))
    private readonly perfectpay: PerfectPayProcessor,
    @Inject(forwardRef(() => TictoProcessor))
    private readonly ticto: TictoProcessor,
    @Inject(forwardRef(() => CaktoProcessor))
    private readonly cakto: CaktoProcessor,
    @Inject(forwardRef(() => PaytProcessor))
    private readonly payt: PaytProcessor,
    @Inject(forwardRef(() => HublaProcessor))
    private readonly hubla: HublaProcessor,
    @Inject(forwardRef(() => CartPandaProcessor))
    private readonly cartpanda: CartPandaProcessor,
    @Inject(forwardRef(() => GGCheckoutProcessor))
    private readonly ggcheckout: GGCheckoutProcessor,
    @Inject(forwardRef(() => LastLinkProcessor))
    private readonly lastlink: LastLinkProcessor,
    @Inject(forwardRef(() => GuruProcessor))
    private readonly guru: GuruProcessor,
    @Inject(forwardRef(() => EduzzProcessor))
    private readonly eduzz: EduzzProcessor,
    @Inject(forwardRef(() => MundpayProcessor))
    private readonly mundpay: MundpayProcessor,
    @Inject(forwardRef(() => MonetizzeProcessor))
    private readonly monetizze: MonetizzeProcessor,
    @Inject(forwardRef(() => GreennProcessor))
    private readonly greenn: GreennProcessor,
    private readonly discordLogger: DiscordLoggerService,
    private readonly metaCapi: MetaCapiService,
    private readonly generic: GenericCheckoutProcessor,
  ) {}

  /**
   * Returns true if the given platform uses queue-based async processing.
   */
  isQueuedPlatform(platform: string): boolean {
    return QUEUED_PLATFORMS.has(platform);
  }

  /**
   * Processes a webhook directly (synchronously) without enqueuing.
   * Routes to the appropriate platform processor and returns its result.
   */
  async processDirect(
    data: WebhookQueuePayload,
  ): Promise<{ status: number; body: any }> {
    // O processor roda dentro do contexto: SalesService lê dali o indexador
    // do rastreio e anota as vendas aprovadas. Terminado o processor, sai um
    // Purchase por pedido para a CAPI — aguardado, porque na Vercel nada roda
    // depois da resposta. sendPurchases nunca lança.
    const ctx: WebhookContext = {
      trackingRef: extractTrackingRef(data.rawBody ?? JSON.stringify(data.body ?? {})),
      approvedSaleIds: [],
    };
    return webhookContext.run(ctx, async () => {
      const result = await this.dispatchDirect(data);
      if (ctx.approvedSaleIds.length > 0) {
        await this.metaCapi.sendPurchases(ctx.approvedSaleIds);
      }
      return result;
    });
  }

  private async dispatchDirect(
    data: WebhookQueuePayload,
  ): Promise<{ status: number; body: any }> {
    const { platform, body, authToken, headers, rawBody, queryParams } = data;

    // As plataformas que vieram dos containers do sGTM: um processor só,
    // dirigido por especificação (processors/generic/checkout-specs.ts).
    if (GENERIC_PLATFORMS.has(platform)) {
      return this.generic.process(platform, body, authToken, queryParams ?? {});
    }

    const processorMap: Record<string, any> = {
      hotmart: this.hotmart,
      kiwify: this.kiwify,
      kirvano: this.kirvano,
      perfectpay: this.perfectpay,
      ticto: this.ticto,
      cakto: this.cakto,
      payt: this.payt,
      hubla: this.hubla,
      cartpanda: this.cartpanda,
      ggcheckout: this.ggcheckout,
      lastlink: this.lastlink,
      guru: this.guru,
      eduzz: this.eduzz,
      mundpay: this.mundpay,
      monetizze: this.monetizze,
      greenn: this.greenn,
    };

    const processor = processorMap[platform];
    if (!processor) {
      return {
        status: 404,
        body: { error: `No processor found for platform: ${platform}` },
      };
    }

    if (platform === 'hotmart') {
      return processor.process(body, authToken, headers ?? undefined);
    }
    if (platform === 'kiwify') {
      return processor.process(
        body,
        authToken,
        rawBody ?? JSON.stringify(body),
        queryParams ?? {},
      );
    }
    if (platform === 'eduzz') {
      // Eduzz HMAC validation needs the raw body to compute the signature.
      return processor.process(body, authToken, rawBody ?? JSON.stringify(body));
    }
    if (platform === 'mundpay') {
      // Mundpay's token comes via ?token= query param (handled inside processor).
      return processor.process(body, authToken, rawBody ?? JSON.stringify(body), queryParams ?? {});
    }
    return processor.process(body, authToken);
  }

  /**
   * Inserts a webhook into the queue for async processing.
   * @deprecated Use processDirect() instead. Kept for manual retry of failed items.
   */
  async enqueue(data: WebhookQueuePayload): Promise<{ error: any }> {
    const supabaseAdmin = this.supabase.getClient();

    const { error } = await supabaseAdmin
      .from('webhook_queue')
      .insert({
        platform: data.platform,
        payload: {
          body: data.body,
          authToken: data.authToken,
          headers: data.headers ?? null,
          rawBody: data.rawBody ?? null,
          queryParams: data.queryParams ?? null,
        },
        status: 'pending',
      });

    if (error) {
      this.logger.error(
        `Failed to enqueue ${data.platform} webhook: ${error.message}`,
      );
    }

    return { error };
  }

  /**
   * @deprecated Queue processing disabled — webhooks are now processed inline.
   * Kept for draining any remaining items. Can be re-enabled temporarily if needed.
   */
  // @Cron(CronExpression.EVERY_MINUTE)
  async processQueue(): Promise<void> {
    const supabaseAdmin = this.supabase.getClient();

    try {
      // Fetch pending items (batch of 10)
      const { data: items, error: fetchErr } = await supabaseAdmin
        .from('webhook_queue')
        .select('id, platform, payload, attempts, max_attempts')
        .eq('status', 'pending')
        .lte('next_retry_at', new Date().toISOString())
        .order('created_at', { ascending: true })
        .limit(10);

      if (fetchErr) throw fetchErr;
      if (!items || items.length === 0) return;

      this.logger.log(`Processing ${items.length} queued webhooks...`);
      let processed = 0;
      let failed = 0;

      for (const item of items) {
        try {
          if (QUEUED_PLATFORMS.has(item.platform)) {
            await this.dispatchToProcessor(item.platform, item.payload);
          } else {
            throw new Error(`Unknown platform: ${item.platform}`);
          }

          // Mark as completed
          await supabaseAdmin
            .from('webhook_queue')
            .update({
              status: 'completed',
              processed_at: new Date().toISOString(),
            })
            .eq('id', item.id);

          processed++;
        } catch (err: any) {
          this.logger.error(
            `Error processing queue item ${item.id}: ${err.message}`,
          );
          const newAttempts = (item.attempts || 0) + 1;
          const isExhausted = newAttempts >= (item.max_attempts || 3);

          await supabaseAdmin
            .from('webhook_queue')
            .update({
              status: isExhausted ? 'failed' : 'pending',
              attempts: newAttempts,
              error_message: err.message,
              next_retry_at: isExhausted
                ? null
                : new Date(
                    Date.now() + newAttempts * 30000,
                  ).toISOString(),
            })
            .eq('id', item.id);

          failed++;
        }
      }

      this.logger.log(
        `Queue processed: ${processed} succeeded, ${failed} failed, ${items.length} total`,
      );
    } catch (error: any) {
      this.logger.error('Queue processor error:', error.message);
    }
  }

  /**
   * Dispatches a queued webhook to the appropriate platform processor.
   * The payload stored in the queue includes body, authToken, headers, rawBody, and queryParams.
   */
  private async dispatchToProcessor(
    platform: string,
    queuedPayload: any,
  ): Promise<void> {
    const { body, authToken, headers, rawBody, queryParams } = queuedPayload;

    const processorMap: Record<string, any> = {
      hotmart: this.hotmart,
      kiwify: this.kiwify,
      kirvano: this.kirvano,
      perfectpay: this.perfectpay,
      ticto: this.ticto,
      cakto: this.cakto,
      payt: this.payt,
      hubla: this.hubla,
      cartpanda: this.cartpanda,
      ggcheckout: this.ggcheckout,
      lastlink: this.lastlink,
      eduzz: this.eduzz,
      mundpay: this.mundpay,
      monetizze: this.monetizze,
      greenn: this.greenn,
    };

    const processor = processorMap[platform];
    if (!processor) {
      throw new Error(`No processor found for platform: ${platform}`);
    }

    let result: { status: number; body: any };

    if (platform === 'hotmart') {
      result = await processor.process(body, authToken, headers ?? undefined);
    } else if (platform === 'kiwify') {
      result = await processor.process(
        body,
        authToken,
        rawBody ?? JSON.stringify(body),
        queryParams ?? {},
      );
    } else if (platform === 'eduzz') {
      result = await processor.process(body, authToken, rawBody ?? JSON.stringify(body));
    } else if (platform === 'mundpay') {
      result = await processor.process(body, authToken, rawBody ?? JSON.stringify(body), queryParams ?? {});
    } else {
      result = await processor.process(body, authToken);
    }

    // A processor returning 4xx/5xx indicates a processing failure
    if (result.status >= 400) {
      throw new Error(
        `Processor ${platform} returned ${result.status}: ${JSON.stringify(result.body)}`,
      );
    }

    this.logger.log(
      `Queue: ${platform} webhook processed with status ${result.status}`,
    );
  }

}
