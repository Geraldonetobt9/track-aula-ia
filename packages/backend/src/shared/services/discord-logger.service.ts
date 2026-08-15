import { Injectable, Logger } from '@nestjs/common';
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

export interface IntegrationLogData {
  userEmail: string;
  workspaceName: string;
  platform: string;
}

export interface ApiErrorLogData {
  route: string;
  statusCode: number;
  errorMessage: string;
  userEmail?: string | null;
}

export interface RuleExecutionEntity {
  entityName: string;
  actionTaken: string;
  status: 'success' | 'error';
  errorMessage?: string;
  metrics?: Record<string, number>;
}

export interface RuleExecutionLogData {
  ruleName: string;
  userEmail?: string | null;
  workspaceName?: string | null;
  targetEntity: string;
  targetStatus?: string;
  evaluationPeriod?: string;
  entities: RuleExecutionEntity[];
}

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

interface QueuedMessage {
  payload: Record<string, any>;
  retryCount: number;
}

const MAX_REQUESTS_PER_MINUTE = 30;
const QUEUE_PROCESSOR_INTERVAL_MS = 2000;
const MAX_BATCH_PER_CYCLE = 5;
const MAX_QUEUE_SIZE = 200;
const MAX_RETRIES = 3;
const RATE_LIMIT_WINDOW_MS = 60_000;

@Injectable()
export class DiscordLoggerService {
  private readonly logger = new Logger(DiscordLoggerService.name);

  /** Per-webhook-URL message queue */
  private readonly messageQueue = new Map<string, QueuedMessage[]>();

  /** Per-webhook-URL request timestamps for rate limiting */
  private readonly requestTimestamps = new Map<string, number[]>();

  /** Prevents concurrent queue processing */
  private processing = false;

  /** Queue processor interval handle */
  private readonly queueInterval: ReturnType<typeof setInterval>;

  /** Cache cleanup interval handle */
  private readonly cleanupInterval: ReturnType<typeof setInterval>;

  constructor(private readonly supabase: SupabaseService) {
    this.queueInterval = setInterval(
      () => this.processQueue(),
      QUEUE_PROCESSOR_INTERVAL_MS,
    );
    this.queueInterval.unref();

    this.cleanupInterval = setInterval(
      () => this.cleanupStaleEntries(),
      RATE_LIMIT_WINDOW_MS,
    );
    this.cleanupInterval.unref();
  }

  // ═══════════════════════════════════════════════════════════════════
  // Public API
  // ═══════════════════════════════════════════════════════════════════

  logSale(platform: string, data: SaleLogData): void {
    const adMatch = data.adMatched ? '✅' : '❌';

    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: '💰 Valor', value: `R$ ${this.fmt(data.amount)}`, inline: true },
      { name: '📦 Produto', value: data.productName || '—', inline: true },
      { name: '💳 Pagamento', value: (data.paymentMethod || '—').toUpperCase(), inline: true },
      { name: '👤 Cliente', value: data.customerName || '—', inline: true },
      { name: '📧 Email', value: data.customerEmail || '—', inline: true },
      { name: '🎯 Ad Match', value: adMatch, inline: true },
    ];

    const utmLine = this.formatUtmLine(data);
    if (utmLine) {
      fields.push({ name: '📊 UTMs', value: utmLine });
    }

    const embed = {
      title: `✅ Venda Aprovada — ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
      color: COLOR_GREEN,
      fields,
      timestamp: new Date().toISOString(),
    };
    this.send(platform as DiscordChannel, { embeds: [embed] });
  }

  logRefund(platform: string, data: SaleLogData): void {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: '💰 Valor', value: `R$ ${this.fmt(data.amount)}`, inline: true },
      { name: '📦 Produto', value: data.productName || '—', inline: true },
      { name: '💳 Pagamento', value: (data.paymentMethod || '—').toUpperCase(), inline: true },
      { name: '👤 Cliente', value: data.customerName || '—', inline: true },
      { name: '📧 Email', value: data.customerEmail || '—', inline: true },
    ];

    const utmLine = this.formatUtmLine(data);
    if (utmLine) {
      fields.push({ name: '📊 UTMs', value: utmLine });
    }

    const embed = {
      title: `🔄 Reembolso — ${platform.charAt(0).toUpperCase() + platform.slice(1)}`,
      color: COLOR_RED,
      fields,
      timestamp: new Date().toISOString(),
    };
    this.send(platform as DiscordChannel, { embeds: [embed] });
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
    this.send(platform as DiscordChannel, { embeds: [embed] });

    // Also send to consolidated error channel (except unknown_event which is informational)
    if (data.errorType !== 'unknown_event') {
      this.send('webhookErrors', { embeds: [embed] });
    }
  }

  logTestIgnored(platform: string): void {
    const embed = {
      description: `🔇 Webhook de teste ignorado\n📦 Plataforma: ${platform} | 🕐 ${this.nowBRT()}`,
      color: COLOR_GRAY,
    };
    this.send(platform as DiscordChannel, { embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Integrations lifecycle
  // ═══════════════════════════════════════════════════════════════════

  logIntegrationCreated(data: IntegrationLogData): void {
    const embed = {
      title: '🟢 Nova Integração Criada',
      color: COLOR_GREEN,
      fields: [
        { name: '👤 Usuário', value: data.userEmail, inline: true },
        { name: '🏢 Workspace', value: data.workspaceName, inline: true },
        { name: '📦 Plataforma', value: data.platform, inline: true },
      ],
      timestamp: new Date().toISOString(),
    };
    this.send('integrations', { embeds: [embed] });
  }

  logIntegrationRemoved(data: IntegrationLogData): void {
    const embed = {
      title: '🔴 Integração Removida',
      color: COLOR_RED,
      fields: [
        { name: '👤 Usuário', value: data.userEmail, inline: true },
        { name: '🏢 Workspace', value: data.workspaceName, inline: true },
        { name: '📦 Plataforma', value: data.platform, inline: true },
        {
          name: '⚠️ Atenção',
          value: 'Webhooks desta plataforma para este workspace não serão mais processados.',
        },
      ],
      timestamp: new Date().toISOString(),
    };
    this.send('integrations', { embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // API errors (5xx only)
  // ═══════════════════════════════════════════════════════════════════

  logApiError(data: ApiErrorLogData): void {
    const fields: Array<{ name: string; value: string; inline?: boolean }> = [
      { name: '🌐 Rota', value: data.route, inline: true },
      { name: '🕐 Horário', value: this.nowBRT(), inline: true },
    ];

    if (data.userEmail) {
      fields.push({ name: '👤 Usuário', value: data.userEmail, inline: true });
    }

    fields.push({ name: '📋 Erro', value: data.errorMessage || 'Internal server error' });
    fields.push({
      name: '🔧 Ação sugerida',
      value: 'Verificar logs do servidor e status do Supabase.',
    });

    const embed = {
      title: `🔴 Erro no Servidor (${data.statusCode})`,
      color: COLOR_RED,
      fields,
      timestamp: new Date().toISOString(),
    };
    this.send('apiErrors', { embeds: [embed] });
  }

  // ═══════════════════════════════════════════════════════════════════
  // Rule executions
  // ═══════════════════════════════════════════════════════════════════

  logRuleExecution(data: RuleExecutionLogData): void {
    const successCount = data.entities.filter((e) => e.status === 'success').length;
    const errorCount = data.entities.filter((e) => e.status === 'error').length;
    const total = data.entities.length;

    // No matched entities
    if (total === 0) {
      const embed = {
        title: `📋 Regra Executada: "${data.ruleName}"`,
        color: COLOR_GRAY,
        fields: [
          ...(data.userEmail ? [{ name: '👤 Usuário', value: data.userEmail, inline: true }] : []),
          { name: '🕐 Horário', value: this.nowBRT(), inline: true },
          { name: 'Resultado', value: 'Nenhuma entidade atendeu às condições.\n0 entidades afetadas.' },
        ],
        timestamp: new Date().toISOString(),
      };
      this.send('executions', { embeds: [embed] });
      return;
    }

    const color = errorCount > 0 ? COLOR_ORANGE : COLOR_GREEN;

    const headerFields: Array<{ name: string; value: string; inline?: boolean }> = [];
    if (data.userEmail) {
      headerFields.push({ name: '👤 Usuário', value: data.userEmail, inline: true });
    }
    if (data.workspaceName) {
      headerFields.push({ name: '🏢 Workspace', value: data.workspaceName, inline: true });
    }

    const targetLabel = data.targetEntity === 'campaign' ? 'Campanhas' : data.targetEntity === 'adset' ? 'Ad Sets' : 'Ads';
    const statusLabel = data.targetStatus === 'active' ? 'ativos' : data.targetStatus === 'paused' ? 'pausados' : '';
    headerFields.push({ name: '🎯 Alvo', value: `${targetLabel} ${statusLabel}`.trim(), inline: true });

    if (data.evaluationPeriod) {
      const periodMap: Record<string, string> = {
        today: 'Hoje',
        yesterday: 'Ontem',
        last_7d: 'Últimos 7 dias',
        last_30d: 'Últimos 30 dias',
        custom: 'Período personalizado',
      };
      headerFields.push({ name: '⏱️ Período', value: periodMap[data.evaluationPeriod] || data.evaluationPeriod, inline: true });
    }

    const summaryValue = errorCount > 0
      ? `✅ ${successCount} sucesso | ❌ ${errorCount} erro`
      : `✅ ${successCount} entidades afetadas`;
    headerFields.push({ name: '📊 Resultado', value: summaryValue });

    // Entity details (limit to 10 to stay within Discord embed limits)
    const entityLines = data.entities.slice(0, 10).map((e) => {
      const icon = e.status === 'success' ? '✅' : '❌';
      let line = `• ${icon} **${e.entityName}** → ${e.status === 'error' ? 'Erro' : e.actionTaken}`;
      if (e.status === 'error' && e.errorMessage) {
        line += `\n  Erro: ${e.errorMessage}`;
      }
      if (e.status === 'success' && e.metrics) {
        const metricParts: string[] = [];
        if (e.metrics.cpa_real != null) metricParts.push(`CPA: R$ ${this.fmt(e.metrics.cpa_real)}`);
        if (e.metrics.roas != null) metricParts.push(`ROAS: ${e.metrics.roas.toFixed(1)}`);
        if (e.metrics.spend != null) metricParts.push(`Spend: R$ ${this.fmt(e.metrics.spend)}`);
        if (e.metrics.roi != null) metricParts.push(`ROI: ${e.metrics.roi.toFixed(1)}`);
        if (metricParts.length > 0) line += `\n  ${metricParts.join(' | ')}`;
      }
      return line;
    }).join('\n\n');

    const remaining = total > 10 ? `\n\n... e mais ${total - 10} entidades` : '';

    headerFields.push({ name: 'Entidades', value: entityLines + remaining });

    const embed = {
      title: `📋 Regra Executada: "${data.ruleName}"`,
      color,
      fields: headerFields,
      timestamp: new Date().toISOString(),
    };
    this.send('executions', { embeds: [embed] });
  }

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

      // Integrations created
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
      this.send('resumoDiario', { embeds: [embed] });
    } catch (err: any) {
      this.logger.error(`Daily summary failed: ${err.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════════════
  // Queue-based send with rate limiting
  // ═══════════════════════════════════════════════════════════════════

  private send(channel: DiscordChannel | string, payload: Record<string, any>): void {
    const url = DISCORD_WEBHOOKS[channel as DiscordChannel];
    if (!url) {
      this.logger.warn(`No Discord webhook URL for channel: ${channel}`);
      return;
    }

    const queue = this.messageQueue.get(url) || [];

    if (queue.length >= MAX_QUEUE_SIZE) {
      const discarded = queue.shift();
      const title = discarded?.payload?.embeds?.[0]?.title || 'unknown';
      this.logger.warn(`Discord queue full (${channel}), discarding oldest: ${title}`);
    }

    queue.push({ payload, retryCount: 0 });
    this.messageQueue.set(url, queue);
  }

  // ── Rate limiting helpers ────────────────────────────────────────

  private isRateLimited(webhookUrl: string): boolean {
    const now = Date.now();
    const timestamps = this.requestTimestamps.get(webhookUrl) || [];
    const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
    this.requestTimestamps.set(webhookUrl, recent);
    return recent.length >= MAX_REQUESTS_PER_MINUTE;
  }

  private recordRequest(webhookUrl: string): void {
    const timestamps = this.requestTimestamps.get(webhookUrl) || [];
    timestamps.push(Date.now());
    this.requestTimestamps.set(webhookUrl, timestamps);
  }

  // ── Queue processor ──────────────────────────────────────────────

  private async processQueue(): Promise<void> {
    if (this.processing) return;
    this.processing = true;

    try {
      const tasks: Promise<void>[] = [];

      for (const [webhookUrl, messages] of this.messageQueue.entries()) {
        if (messages.length === 0) {
          this.messageQueue.delete(webhookUrl);
          continue;
        }
        if (this.isRateLimited(webhookUrl)) continue;
        tasks.push(this.processWebhookQueue(webhookUrl, messages));
      }

      if (tasks.length > 0) {
        await Promise.allSettled(tasks);
      }
    } catch {
      // Failure in this cycle — will retry on the next interval
    } finally {
      this.processing = false;
    }
  }

  private async processWebhookQueue(
    webhookUrl: string,
    messages: QueuedMessage[],
  ): Promise<void> {
    const batch = Math.min(messages.length, MAX_BATCH_PER_CYCLE);

    for (let i = 0; i < batch; i++) {
      if (this.isRateLimited(webhookUrl)) break;

      const message = messages.shift();
      if (!message) break;

      try {
        await this.sendToDiscord(webhookUrl, message.payload);
      } catch {
        if (message.retryCount < MAX_RETRIES) {
          messages.push({
            payload: message.payload,
            retryCount: message.retryCount + 1,
          });
        } else {
          const title = message.payload?.embeds?.[0]?.title || 'unknown';
          this.logger.warn(
            `Discord message discarded after ${MAX_RETRIES} retries: ${title}`,
          );
        }
        break; // Stop processing this webhook on failure
      }
    }
  }

  private async sendToDiscord(
    webhookUrl: string,
    payload: Record<string, any>,
  ): Promise<void> {
    const res = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      const body = await res.text().catch(() => '');
      this.logger.warn(
        `Discord HTTP ${res.status}: ${body.substring(0, 200)}`,
      );
      throw new Error(`Discord HTTP ${res.status}`);
    }

    this.recordRequest(webhookUrl);
  }

  // ── Cleanup ──────────────────────────────────────────────────────

  private cleanupStaleEntries(): void {
    const now = Date.now();

    for (const [url, timestamps] of this.requestTimestamps.entries()) {
      const recent = timestamps.filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
      if (recent.length === 0) this.requestTimestamps.delete(url);
      else this.requestTimestamps.set(url, recent);
    }

    for (const [url, messages] of this.messageQueue.entries()) {
      if (messages.length === 0) this.messageQueue.delete(url);
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
