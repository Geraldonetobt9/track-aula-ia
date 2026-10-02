import { Body, Controller, Get, Logger, Post, Query, Req, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { FastifyReply, FastifyRequest } from 'fastify';
import { TrackingIngestService } from './tracking-ingest.service';
import { CollectBatch, isBot, parseCollectBody } from './collect-payload';
import { buildTrackerScript, NOOP_TRACKER_SCRIPT } from './tracker-script';
import { MetaCapiService, WebEventInput } from '../meta-capi/meta-capi.service';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const HOST = /^[a-z0-9.-]+(:\d{1,5})?$/i;

/** Limite do /collect por IP. Uma visita manda de 2 a 5 requisições. */
const COLLECT_LIMIT_PER_MINUTE = 100;
const RATE_WINDOW_MS = 60_000;

const YEAR_S = 365 * 24 * 3600;
const FB_COOKIE_S = 90 * 24 * 3600;

type Headers = Record<string, string | string[] | undefined>;

function header(headers: Headers, name: string): string | null {
  const value = headers[name];
  const first = Array.isArray(value) ? value[0] : value;
  return first?.trim() || null;
}

/** Headers de geolocalização da Vercel vêm com URL encoding ("S%C3%A3o%20Paulo"). */
function geoHeader(headers: Headers, name: string): string | null {
  const value = header(headers, name);
  if (!value) return null;
  try {
    return decodeURIComponent(value).slice(0, 100);
  } catch {
    return value.slice(0, 100);
  }
}

/**
 * IP do visitante. Na Vercel o socket é da borda — o IP real vem no
 * x-forwarded-for. Com o snippet no subdomínio do cliente, a requisição sai
 * direto do navegador, então esse é o IP que a CAPI espera.
 */
function clientIp(req: FastifyRequest): string | null {
  const headers = req.headers as Headers;
  const forwarded = header(headers, 'x-forwarded-for')?.split(',')[0].trim();
  const ip = forwarded || header(headers, 'x-real-ip') || req.ip || null;
  return ip && /^[0-9a-f.:]{3,45}$/i.test(ip) ? ip : null;
}

function hostOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * Domínio raiz comum entre o subdomínio de rastreio (track.loja.com.br) e a
 * página (www.loja.com.br): "loja.com.br". É nele que o servidor grava os
 * cookies, para a página enxergá-los. Sem domínio em comum — o snippet servido
 * pelo domínio da Vercel, por exemplo — não há cookie de servidor.
 */
export function sharedCookieDomain(requestHost: string | null, pageHost: string | null): string | null {
  if (!requestHost || !pageHost || requestHost === pageHost) return null;
  const labels = requestHost.split('.');
  if (labels.length < 3) return null;
  const parent = labels.slice(1).join('.');
  return pageHost === parent || pageHost.endsWith(`.${parent}`) ? parent : null;
}

/**
 * Endpoints públicos do snippet: o script, a ingestão e a verificação do
 * subdomínio.
 *
 * Fora do ThrottlerGuard global: ele conta por req.ip, que na Vercel é o IP
 * da borda — todos os visitantes dividiriam os mesmos 60 por minuto. O limite
 * daqui conta pelo IP real, por instância da função.
 */
@SkipThrottle()
@Controller('t')
export class TrackingCollectController {
  private readonly logger = new Logger(TrackingCollectController.name);
  private readonly hits = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly ingestService: TrackingIngestService,
    private readonly capi: MetaCapiService,
  ) {}

  @Get('tracker.js')
  async trackerScript(
    @Query('tid') tid: string | undefined,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    res.header('Content-Type', 'application/javascript; charset=utf-8');

    const workspaceId = tid?.trim().toLowerCase() ?? '';
    const valid = UUID.test(workspaceId);
    const config = valid ? await this.capi.getConfig(workspaceId) : null;
    const exists = !!config || (valid && (await this.ingestService.workspaceExists(workspaceId)));

    if (!exists) {
      // 200 com script vazio, e não 404: um 404 aparece como erro no console
      // da página do cliente, para os visitantes dele.
      res.header('Cache-Control', 'public, max-age=300');
      res.status(200).send(NOOP_TRACKER_SCRIPT);
      return;
    }

    // Cache curto: trocar a plataforma em Integrações muda o parâmetro do
    // indexador, e a página do cliente precisa pegar isso logo.
    res.header('Cache-Control', 'public, max-age=300');
    res.status(200).send(
      buildTrackerScript(workspaceId, this.collectUrl(req), {
        param: config?.param ?? 'sck',
        pixelId: config?.pixelId ?? null,
        xcodUtm: config?.platform === 'hotmart',
      }),
    );
  }

  /**
   * Recebe o lote do snippet, grava e manda PageView/InitiateCheckout para a
   * CAPI. Sempre 200 e corpo vazio: sendBeacon ignora a resposta, e um erro
   * não daria ao navegador do visitante nada a fazer.
   */
  @Post('collect')
  async collect(
    @Body() body: unknown,
    @Req() req: FastifyRequest,
    @Res() res: FastifyReply,
  ): Promise<void> {
    res.header('Access-Control-Allow-Origin', '*');
    const headers = req.headers as Headers;
    const ip = clientIp(req);

    try {
      if (!this.allow(ip ?? 'unknown')) {
        res.status(200).send();
        return;
      }

      const userAgent = header(headers, 'user-agent')?.slice(0, 500) ?? null;
      const batch = isBot(userAgent) ? null : parseCollectBody(body);

      if (batch) {
        const ctx = {
          ip,
          userAgent,
          country: geoHeader(headers, 'x-vercel-ip-country'),
          region: geoHeader(headers, 'x-vercel-ip-country-region'),
          city: geoHeader(headers, 'x-vercel-ip-city'),
        };

        // Gravação e envio ao Meta em paralelo: um não depende do outro, e os
        // dois precisam terminar antes da resposta (a função congela depois).
        await Promise.all([
          this.ingestService.ingest(batch, ctx),
          this.capi.sendWebEvents(batch.workspaceId, this.webEvents(batch, ctx)),
        ]);

        this.setFirstPartyCookies(req, res, batch);
      }
    } catch (error: any) {
      this.logger.error(`Erro no collect: ${error?.message}`, error?.stack);
    }

    res.status(200).send();
  }

  /**
   * O painel usa para conferir se o CNAME do subdomínio já aponta para cá:
   * busca https://<subdomínio>/api/t/ping direto do navegador.
   */
  @Get('ping')
  ping(@Res() res: FastifyReply): void {
    res.header('Access-Control-Allow-Origin', '*');
    res.header('Cache-Control', 'no-store');
    res.status(200).send({ ok: true, service: 'sentinela-tracking' });
  }

  private webEvents(
    batch: CollectBatch,
    ctx: { ip: string | null; userAgent: string | null; country: string | null; region: string | null; city: string | null },
  ): WebEventInput[] {
    return batch.events
      .filter((e) => (e.type === 'pageview' || e.type === 'checkout_click') && e.event_id)
      .map((e) => ({
        type: e.type as WebEventInput['type'],
        eventId: e.event_id!,
        url: e.url,
        visitorId: batch.visitorId,
        sessionId: batch.sessionId,
        ip: ctx.ip,
        userAgent: ctx.userAgent,
        fbp: batch.fbp,
        fbc: batch.fbc,
        city: ctx.city,
        region: ctx.region,
        country: ctx.country,
      }));
  }

  /**
   * Regrava _stl_vid, _fbp e _fbc pelo servidor, no domínio raiz da página.
   * Cookie gravado por JavaScript o Safari corta para 7 dias; gravado pela
   * resposta do próprio domínio, vale o prazo pedido (com a ressalva de IP
   * descrita na documentação).
   */
  private setFirstPartyCookies(req: FastifyRequest, res: FastifyReply, batch: CollectBatch): void {
    const headers = req.headers as Headers;
    const requestHost = (header(headers, 'x-forwarded-host') || header(headers, 'host') || '')
      .split(',')[0]
      .split(':')[0]
      .toLowerCase();
    const pageHost = hostOf(header(headers, 'origin')) ?? hostOf(header(headers, 'referer'));
    const domain = sharedCookieDomain(requestHost || null, pageHost);
    if (!domain) return;

    const cookie = (name: string, value: string, maxAge: number) =>
      `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Domain=${domain}; Path=/; SameSite=Lax; Secure`;

    const cookies = [cookie('_stl_vid', batch.visitorId, YEAR_S)];
    if (batch.fbp) cookies.push(cookie('_fbp', batch.fbp, FB_COOKIE_S));
    if (batch.fbc) cookies.push(cookie('_fbc', batch.fbc, FB_COOKIE_S));
    res.header('Set-Cookie', cookies);
  }

  /**
   * URL absoluta do /collect, montada a partir de onde o próprio script foi
   * pedido: com o snippet no subdomínio do cliente, o /collect também fica
   * nele. O host passa por uma checagem de formato antes de entrar no script.
   */
  private collectUrl(req: FastifyRequest): string {
    const headers = req.headers as Headers;
    const forwardedHost = header(headers, 'x-forwarded-host')?.split(',')[0].trim();
    const rawHost = forwardedHost || header(headers, 'host') || '';
    const host = HOST.test(rawHost) ? rawHost : 'localhost';
    const forwardedProto = header(headers, 'x-forwarded-proto')?.split(',')[0].trim();
    const proto = forwardedProto === 'http' || forwardedProto === 'https'
      ? forwardedProto
      : host.startsWith('localhost') || host.startsWith('127.') ? 'http' : 'https';
    return `${proto}://${host}/api/t/collect`;
  }

  private allow(ip: string): boolean {
    const now = Date.now();

    // Limpeza preguiçosa: a instância vive enquanto está quente, e o mapa não
    // pode crescer sem fim com IPs que nunca voltam.
    if (this.hits.size > 10_000) {
      for (const [key, entry] of this.hits) {
        if (entry.resetAt <= now) this.hits.delete(key);
      }
    }

    const entry = this.hits.get(ip);
    if (!entry || entry.resetAt <= now) {
      this.hits.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
      return true;
    }
    entry.count += 1;
    return entry.count <= COLLECT_LIMIT_PER_MINUTE;
  }
}
