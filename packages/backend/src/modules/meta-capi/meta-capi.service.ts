import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { buildUserData, MetaUserData, explainUserData, UserDataInput } from './meta-user-data';
import { META_API_VERSION } from '../../shared/constants/meta-api';

const GRAPH_VERSION = META_API_VERSION;
const CONFIG_TTL_MS = 60_000;
/** O webhook e o /collect esperam o envio; o Meta não pode segurá-los. */
const GRAPH_TIMEOUT_MS = 4_000;
const MAX_ATTEMPTS = 5;
/** O Meta recusa event_time com mais de 7 dias. */
const MAX_EVENT_AGE_S = 7 * 24 * 60 * 60 - 3600;

export const TRACKING_PARAMS = ['sck', 'src', 'xcod', 'trk', 'utm_term'] as const;
export type TrackingParam = (typeof TRACKING_PARAMS)[number];

export interface WorkspaceTrackingConfig {
  workspaceId: string;
  userId: string;
  platform: string | null;
  param: TrackingParam;
  domain: string | null;
  pixelId: string | null;
  token: string | null;
  testEventCode: string | null;
}

export interface MetaEvent {
  event_name: string;
  event_time: number;
  event_id: string;
  action_source: 'website';
  event_source_url?: string;
  user_data: MetaUserData;
  custom_data?: Record<string, unknown>;
}

/** Um evento do snippet já validado, com o que o servidor sabe da requisição. */
export interface WebEventInput {
  type: 'pageview' | 'checkout_click';
  eventId: string;
  url: string | null;
  visitorId: string;
  sessionId: string;
  ip: string | null;
  userAgent: string | null;
  fbp: string | null;
  fbc: string | null;
  city: string | null;
  region: string | null;
  country: string | null;
}

interface SendResult {
  ok: boolean;
  response: unknown;
  fbtraceId: string | null;
  error: string | null;
}

const WEB_EVENT_NAME: Record<WebEventInput['type'], string> = {
  pageview: 'PageView',
  checkout_click: 'InitiateCheckout',
};

function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

@Injectable()
export class MetaCapiService {
  private readonly logger = new Logger(MetaCapiService.name);

  /**
   * capi_events.pixel_id vem de uma migration aplicada à mão no SQL Editor,
   * que pode chegar depois do deploy. Enquanto a coluna não existir, grava e
   * lê sem ela — o registro dos envios não pode quebrar por isso.
   */
  private pixelColumn = true;

  private missingPixelColumn(error: { message?: string } | null | undefined): boolean {
    if (!error || !/pixel_id/.test(error.message ?? '')) return false;
    this.pixelColumn = false;
    this.logger.warn('capi_events.pixel_id nao existe: rode a migration 20261002130000_capi_events_pixel.sql');
    return true;
  }

  private withPixel<T extends Record<string, unknown>>(row: T, pixelId: string | null): T {
    return this.pixelColumn ? { ...row, pixel_id: pixelId } : row;
  }

  private withoutPixel<T extends Record<string, unknown>>(row: T): T {
    const { pixel_id: _pixel, ...rest } = row as Record<string, unknown>;
    return rest as T;
  }

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
    private readonly encryption: EncryptionService,
  ) {}

  // -------------------------------------------------------------------------
  // Configuração
  // -------------------------------------------------------------------------

  /** Configuração da área, cacheada: é lida em todo /collect e todo tracker.js. */
  async getConfig(workspaceId: string): Promise<WorkspaceTrackingConfig | null> {
    const key = `capi:config:${workspaceId}`;
    const cached = this.cache.get<WorkspaceTrackingConfig | 'none'>(key);
    if (cached) return cached === 'none' ? null : cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select(
        'id, user_id, tracking_platform, tracking_param, tracking_domain, meta_pixel_id, meta_capi_token, meta_test_event_code, meta_mirror_browser',
      )
      .eq('id', workspaceId)
      .maybeSingle();

    // Sem a migration (coluna inexistente) ou área desconhecida: sem CAPI, e
    // o rastreio segue funcionando com os padrões.
    if (error || !data) {
      if (error) this.logger.warn(`Config da area ${workspaceId}: ${error.message}`);
      this.cache.set(key, 'none', CONFIG_TTL_MS);
      return null;
    }

    let token: string | null = null;
    if (data.meta_capi_token) {
      try {
        token = this.encryption.decryptIfNeeded(data.meta_capi_token);
      } catch {
        this.logger.error(`Token da CAPI ilegivel na area ${workspaceId} (ENCRYPTION_KEY trocada?)`);
      }
    }

    const config: WorkspaceTrackingConfig = {
      workspaceId: data.id,
      userId: data.user_id,
      platform: data.tracking_platform ?? null,
      param: (TRACKING_PARAMS as readonly string[]).includes(data.tracking_param) ? data.tracking_param : 'sck',
      domain: data.tracking_domain ?? null,
      pixelId: data.meta_pixel_id ?? null,
      token,
      testEventCode: data.meta_test_event_code ?? null,
    };
    this.cache.set(key, config, CONFIG_TTL_MS);
    return config;
  }

  invalidateConfig(workspaceId: string) {
    this.cache.invalidate(`capi:config:${workspaceId}`);
  }

  private enabled(config: WorkspaceTrackingConfig | null): config is WorkspaceTrackingConfig & { pixelId: string; token: string } {
    return !!config?.pixelId && !!config.token;
  }

  // -------------------------------------------------------------------------
  // PageView e InitiateCheckout (vindos do /collect)
  // -------------------------------------------------------------------------

  /**
   * Manda os eventos web de um lote numa chamada só ao Meta e registra o
   * resultado. Nunca lança: o /collect responde 200 de qualquer jeito.
   */
  async sendWebEvents(workspaceId: string, inputs: WebEventInput[]): Promise<void> {
    if (inputs.length === 0) return;
    try {
      const config = await this.getConfig(workspaceId);
      if (!this.enabled(config)) return;

      const events: MetaEvent[] = inputs.map((e) => ({
        event_name: WEB_EVENT_NAME[e.type],
        event_time: nowSeconds(),
        event_id: e.eventId,
        action_source: 'website',
        ...(e.url ? { event_source_url: e.url } : {}),
        user_data: buildUserData({
          externalId: e.visitorId,
          ip: e.ip,
          userAgent: e.userAgent,
          fbp: e.fbp,
          fbc: e.fbc,
          state: e.region,
          country: e.country,
        }),
      }));

      const result = await this.post(config, events);
      await this.record(
        events.map((ev, i) => ({
          workspace_id: workspaceId,
          event_name: ev.event_name,
          event_id: ev.event_id,
          session_id: inputs[i].sessionId,
          status: result.ok ? 'sent' : 'failed',
          attempts: 1,
          payload: ev,
          response: result.response,
          fbtrace_id: result.fbtraceId,
          error: result.error,
          sent_at: result.ok ? new Date().toISOString() : null,
          pixel_id: config.pixelId,
        })),
      );
    } catch (err: any) {
      this.logger.warn(`sendWebEvents ${workspaceId}: ${err?.message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Purchase (vindo do webhook)
  // -------------------------------------------------------------------------

  /**
   * Um Purchase por pedido, com o valor somado das linhas (a Hubla grava uma
   * linha por produto). Comprador do webhook + navegação da sessão casada.
   *
   * Reserva a linha em capi_events antes de enviar: se o webhook for
   * reentregue, a reserva bate na unicidade e nada sai de novo. Nunca lança —
   * a venda já está gravada, e um erro aqui faria a plataforma reenviar.
   */
  async sendPurchases(saleIds: string[]): Promise<void> {
    if (saleIds.length === 0) return;
    try {
      const client = this.supabase.getClient();
      const { data: rows, error } = await client
        .from('sales')
        .select(
          'id, workspace_id, external_id, order_external_id, status, amount, currency, product_name, customer_name, customer_email, customer_phone, customer_city, customer_state, customer_country, session_id, visitor_id, sold_at, metadata',
        )
        .in('id', saleIds)
        .eq('status', 'approved');
      if (error) throw new Error(error.message);

      const orders = new Map<string, any[]>();
      for (const row of rows ?? []) {
        if (!row.workspace_id) continue;
        const key = `${row.workspace_id}|${row.order_external_id || row.external_id || row.id}`;
        orders.set(key, [...(orders.get(key) ?? []), row]);
      }

      for (const [, lines] of orders) {
        await this.sendPurchase(lines);
      }
    } catch (err: any) {
      this.logger.warn(`sendPurchases: ${err?.message}`);
    }
  }

  private async sendPurchase(lines: any[]): Promise<void> {
    const first = lines[0];
    const config = await this.getConfig(first.workspace_id);
    if (!this.enabled(config)) return;

    const client = this.supabase.getClient();
    const withSession = lines.find((l) => l.session_id);
    let session: any = null;
    if (withSession) {
      const { data } = await client
        .from('tracking_sessions')
        .select('visitor_id, session_id, landing_page, fbp, fbc, ip_address, user_agent, city, region, country')
        .eq('workspace_id', first.workspace_id)
        .eq('session_id', withSession.session_id)
        .maybeSingle();
      session = data;
    }

    const orderId = first.order_external_id || first.external_id || first.id;
    const soldAt = Math.floor(new Date(first.sold_at).getTime() / 1000);
    const now = nowSeconds();
    const value = lines.reduce((sum, l) => sum + Number(l.amount || 0), 0);
    const itemId = (l: any): string => (l.metadata?.product_id != null ? String(l.metadata.product_id) : l.product_name || 'produto');
    // O produto principal é a primeira linha do pedido; os bumps vêm em contents.
    const mainProductId = first.metadata?.product_id != null ? String(first.metadata.product_id) : null;
    const event: MetaEvent = {
      event_name: 'Purchase',
      // Pagamento de boleto/pix pode chegar dias depois; fora da janela do
      // Meta, vale o momento do envio.
      event_time: Number.isFinite(soldAt) && now - soldAt < MAX_EVENT_AGE_S ? Math.min(soldAt, now) : now,
      event_id: `purchase:${orderId}`,
      action_source: 'website',
      ...(session?.landing_page ? { event_source_url: session.landing_page } : {}),
      user_data: buildUserData(purchaseUserInput(first, session, withSession)),
      custom_data: {
        currency: (first.currency || 'BRL').toUpperCase(),
        value: Math.round(value * 100) / 100,
        order_id: String(orderId),
        content_type: 'product',
        content_ids: lines.map(itemId),
        contents: lines.map((l) => ({
          id: itemId(l),
          quantity: 1,
          item_price: Number(l.amount || 0),
        })),
        content_name: lines.map((l) => l.product_name).filter(Boolean).join(' + ') || undefined,
        // Parâmetros próprios, além dos padrão do Meta: o produto principal.
        // Sem o id na venda (plataforma que não o manda), vai só o nome.
        ...(mainProductId ? { product_id: mainProductId } : {}),
        ...(first.product_name ? { product_name: first.product_name } : {}),
      },
    };

    // Reserva: a unicidade (área, nome, event_id) barra o reenvio do webhook.
    const reservation = {
      workspace_id: first.workspace_id,
      event_name: 'Purchase',
      event_id: event.event_id,
      session_id: session?.session_id ?? null,
      sale_id: first.id,
      status: 'pending',
      attempts: 0,
      payload: event,
    };
    const reserve = (row: Record<string, unknown>) =>
      client.from('capi_events').insert(row).select('id').maybeSingle();
    let { data: reserved, error: reserveError } = await reserve(this.withPixel(reservation, config.pixelId));
    if (this.missingPixelColumn(reserveError)) {
      ({ data: reserved, error: reserveError } = await reserve(reservation));
    }

    if (reserveError) {
      if (!/duplicate|unique/i.test(reserveError.message)) {
        this.logger.warn(`Reserva do Purchase ${orderId}: ${reserveError.message}`);
      }
      return;
    }

    const result = await this.post(config, [event]);
    await client
      .from('capi_events')
      .update({
        status: result.ok ? 'sent' : 'failed',
        attempts: 1,
        response: result.response,
        fbtrace_id: result.fbtraceId,
        error: result.error,
        sent_at: result.ok ? new Date().toISOString() : null,
      })
      .eq('id', reserved!.id);

    this.logger.log(
      `[CAPI] Purchase ${orderId} ${result.ok ? 'enviado' : `falhou: ${result.error}`} (sessao: ${session ? 'sim' : 'nao'})`,
    );
  }

  // -------------------------------------------------------------------------
  // Reenvio e leitura
  // -------------------------------------------------------------------------

  /**
   * Reenvia o que falhou (e reservas presas há mais de 10 minutos, de uma
   * função que morreu no meio). Com workspaceId, só aquela área.
   */
  async retryFailed(workspaceId?: string): Promise<{ retried: number; sent: number }> {
    const client = this.supabase.getClient();
    let query = client
      .from('capi_events')
      .select('id, workspace_id, payload, attempts, status, created_at')
      .in('status', ['failed', 'pending'])
      .lt('attempts', MAX_ATTEMPTS)
      .gte('created_at', new Date(Date.now() - 7 * 86_400_000).toISOString())
      .order('created_at', { ascending: true })
      .limit(200);
    if (workspaceId) query = query.eq('workspace_id', workspaceId);

    const { data, error } = await query;
    if (error) throw new Error(error.message);

    const staleBefore = Date.now() - 10 * 60_000;
    const due = (data ?? []).filter(
      (r) => r.status === 'failed' || new Date(r.created_at).getTime() < staleBefore,
    );

    let sent = 0;
    for (const row of due) {
      const config = await this.getConfig(row.workspace_id);
      if (!this.enabled(config)) continue;

      const event = row.payload as MetaEvent;
      // O Meta recusa evento velho; nesse caso vale a hora do reenvio.
      if (nowSeconds() - event.event_time > MAX_EVENT_AGE_S) event.event_time = nowSeconds();

      const result = await this.post(config, [event]);
      if (result.ok) sent += 1;
      await client
        .from('capi_events')
        .update({
          status: result.ok ? 'sent' : 'failed',
          attempts: (row.attempts ?? 0) + 1,
          payload: event,
          response: result.response,
          fbtrace_id: result.fbtraceId,
          error: result.error,
          sent_at: result.ok ? new Date().toISOString() : null,
        })
        .eq('id', row.id);
    }
    return { retried: due.length, sent };
  }

  /**
   * Últimos envios da área e contadores de hoje, para o card Últimos eventos.
   *
   * pixel_id de cada envio: o gravado na hora do envio. Envios de antes da
   * coluna existir não têm, e mostram o pixel configurado hoje na área.
   */
  async listEvents(userId: string, workspaceId: string, limit = 50) {
    await this.assertOwner(userId, workspaceId);
    const config = await this.getConfig(workspaceId);
    const client = this.supabase.getClient();
    const since = new Date(Date.now() - 24 * 3600_000).toISOString();

    const columns = 'id, event_name, event_id, status, attempts, error, fbtrace_id, created_at, sent_at, sale_id';
    const listRecent = (withPixel: boolean) =>
      client
        .from('capi_events')
        .select(withPixel ? `${columns}, pixel_id` : columns)
        .eq('workspace_id', workspaceId)
        .order('created_at', { ascending: false })
        .limit(Math.min(Math.max(limit, 1), 200));

    const [firstTry, last24h] = await Promise.all([
      listRecent(this.pixelColumn),
      client
        .from('capi_events')
        .select('event_name, status')
        .eq('workspace_id', workspaceId)
        .gte('created_at', since)
        .limit(10_000),
    ]);
    const recent = this.missingPixelColumn(firstTry.error) ? await listRecent(false) : firstTry;
    if (recent.error) throw new Error(recent.error.message);
    if (last24h.error) throw new Error(last24h.error.message);

    const summary: Record<string, { sent: number; failed: number }> = {};
    for (const r of last24h.data ?? []) {
      const s = (summary[r.event_name] ??= { sent: 0, failed: 0 });
      if (r.status === 'sent') s.sent += 1;
      else if (r.status === 'failed') s.failed += 1;
    }
    const events = ((recent.data ?? []) as any[]).map((e) => ({ ...e, pixel_id: e.pixel_id ?? config?.pixelId ?? null }));
    return { summary, events };
  }

  /**
   * Um envio com o corpo mandado ao Meta e a resposta. Separado da lista para
   * ela não carregar 50 payloads a cada atualização.
   *
   * O corpo é remontado como sai em post(): { data: [evento] }, sem o
   * access_token — ele nunca sai do servidor.
   */
  async getEvent(userId: string, workspaceId: string, id: string) {
    await this.assertOwner(userId, workspaceId);
    const client = this.supabase.getClient();
    const { data, error } = await client
      .from('capi_events')
      .select('id, event_name, event_id, status, attempts, error, fbtrace_id, created_at, sent_at, payload, response, session_id, sale_id')
      .eq('workspace_id', workspaceId)
      .eq('id', id)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Envio nao encontrado');

    const { payload, session_id, sale_id, ...rest } = data;

    // Os originais são remontados do banco, não guardados no envio: a venda
    // e a visita já têm os dados, e assim nada além do hash vai junto no
    // payload. explainUserData confere cada um contra o hash que saiu.
    const session = session_id
      ? (
          await client
            .from('tracking_sessions')
            .select(
              'visitor_id, fbp, fbc, ip_address, user_agent, region, country',
            )
            .eq('workspace_id', workspaceId)
            .eq('session_id', session_id)
            .maybeSingle()
        ).data
      : null;

    const sentUserData = (payload as MetaEvent | null)?.user_data ?? null;
    const base = { ...rest, request: { data: [payload] } };

    if (data.event_name !== 'Purchase') {
      const input: UserDataInput = {
        externalId: session?.visitor_id ?? null,
        ip: session?.ip_address ?? null,
        userAgent: session?.user_agent ?? null,
        fbp: session?.fbp ?? null,
        fbc: session?.fbc ?? null,
        state: session?.region ?? null,
        country: session?.country ?? null,
      };
      return { ...base, original: explainUserData(input, sentUserData) };
    }

    const sale = sale_id
      ? (
          await client
            .from('sales')
            .select('customer_name, customer_email, customer_phone, customer_state, customer_country, session_id, visitor_id, metadata')
            .eq('workspace_id', workspaceId)
            .eq('id', sale_id)
            .maybeSingle()
        ).data
      : null;
    const input = sale ? purchaseUserInput(sale, session, sale.session_id ? sale : null) : {};

    // No Purchase, o comprador vem do webhook (gravado na venda); navegação,
    // estado e país vêm da visita no banco (purchaseUserInput).
    const fromDb = new Set<string>();
    if (session) {
      ['client_ip_address', 'client_user_agent', 'fbp', 'fbc', 'external_id'].forEach((k) => fromDb.add(k));
      if (session.region) fromDb.add('st');
      if (session.country) fromDb.add('country');
    }
    return { ...base, original: explainUserData(input, sentUserData, fromDb) };
  }

  async assertOwner(userId: string, workspaceId: string): Promise<void> {
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Area nao encontrada');
  }

  // -------------------------------------------------------------------------
  // Graph API
  // -------------------------------------------------------------------------

  private async post(
    config: WorkspaceTrackingConfig & { pixelId: string; token: string },
    events: MetaEvent[],
  ): Promise<SendResult> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), GRAPH_TIMEOUT_MS);
    try {
      const res = await fetch(
        `https://graph.facebook.com/${GRAPH_VERSION}/${encodeURIComponent(config.pixelId)}/events`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            data: events,
            access_token: config.token,
            ...(config.testEventCode ? { test_event_code: config.testEventCode } : {}),
          }),
          signal: controller.signal,
        },
      );
      const body: any = await res.json().catch(() => null);
      if (res.ok && body && !body.error) {
        return { ok: true, response: body, fbtraceId: body.fbtrace_id ?? null, error: null };
      }
      return {
        ok: false,
        response: body,
        fbtraceId: body?.error?.fbtrace_id ?? null,
        error: body?.error?.error_user_msg || body?.error?.message || `HTTP ${res.status}`,
      };
    } catch (err: any) {
      return {
        ok: false,
        response: null,
        fbtraceId: null,
        error: err?.name === 'AbortError' ? `Meta nao respondeu em ${GRAPH_TIMEOUT_MS}ms` : err?.message ?? 'erro de rede',
      };
    } finally {
      clearTimeout(timer);
    }
  }

  private async record(rows: Record<string, unknown>[]): Promise<void> {
    // Um reenvio do mesmo lote pelo navegador bateria na unicidade; ignora.
    const upsert = (batch: Record<string, unknown>[]) =>
      this.supabase
        .getClient()
        .from('capi_events')
        .upsert(batch, { onConflict: 'workspace_id,event_name,event_id', ignoreDuplicates: true });
    let { error } = await upsert(this.pixelColumn ? rows : rows.map((r) => this.withoutPixel(r)));
    if (this.missingPixelColumn(error)) ({ error } = await upsert(rows.map((r) => this.withoutPixel(r))));
    if (error) this.logger.warn(`Registro da CAPI: ${error.message}`);
  }
}

/**
 * O comprador do Purchase: dados da venda, navegação da visita casada. Uma
 * função só para o envio e para a tela de detalhe remontarem o mesmo input.
 *
 * Estado e país vêm primeiro da visita (geolocalização do IP, no banco): o
 * endereço que o checkout manda no webhook nem sempre está certo. O do
 * webhook só vale quando não há visita casada ou ela não tem o dado.
 */
function purchaseUserInput(sale: any, session: any, withSession: any): UserDataInput {
  return {
    email: sale.customer_email,
    phone: sale.customer_phone,
    fullName: sale.customer_name,
    state: session?.region ?? sale.customer_state,
    country: session?.country ?? sale.customer_country ?? 'br',
    zip: sale.metadata?.zipcode ?? sale.metadata?.zip ?? sale.metadata?.cep ?? null,
    externalId: session?.visitor_id ?? withSession?.visitor_id ?? null,
    ip: session?.ip_address ?? null,
    userAgent: session?.user_agent ?? null,
    fbp: session?.fbp ?? null,
    fbc: session?.fbc ?? null,
  };
}
