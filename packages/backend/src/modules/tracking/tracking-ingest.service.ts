import { Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import { CollectBatch, deviceType } from './collect-payload';

/** Existência da área muda quase nunca; 5 minutos poupa o banco a cada tracker.js. */
const WORKSPACE_CACHE_TTL_MS = 5 * 60_000;

export interface RequestContext {
  /** IP do visitante. Vai para a sessão porque a CAPI precisa dele (client_ip_address). */
  ip: string | null;
  userAgent: string | null;
  country: string | null;
  region: string | null;
  city: string | null;
}

@Injectable()
export class TrackingIngestService {
  private readonly logger = new Logger(TrackingIngestService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Grava o lote numa ida só ao banco (RPC tracking_ingest). Devolve quantos
   * eventos entraram.
   *
   * Aguarda a gravação antes de o controller responder, ao contrário do que
   * o desenho "responde e enfileira" sugeriria: na Vercel a função congela
   * assim que a resposta sai, e o trabalho pendente morre junto (ver o fix
   * da sincronização do Meta, c03642e). Nunca lança — o visitante não tem o
   * que fazer com um erro nosso.
   */
  async ingest(batch: CollectBatch, ctx: RequestContext): Promise<number> {
    try {
      const { data, error } = await this.supabase.getClient().rpc('tracking_ingest', {
        p_workspace_id: batch.workspaceId,
        p_visitor_id: batch.visitorId,
        p_session_id: batch.sessionId,
        p_ctx: {
          user_agent: ctx.userAgent,
          screen_resolution: batch.screenResolution,
          language: batch.language,
          device_type: deviceType(ctx.userAgent),
          country: ctx.country,
          region: ctx.region,
          city: ctx.city,
          fbp: batch.fbp,
          fbc: batch.fbc,
          ip_address: ctx.ip,
        },
        p_events: batch.events,
      });

      if (error) {
        this.logger.warn(`tracking_ingest falhou: ${error.message}`);
        return 0;
      }
      return typeof data === 'number' ? data : 0;
    } catch (err: any) {
      this.logger.warn(`tracking_ingest erro: ${err?.message}`);
      return 0;
    }
  }

  /** A área existe? Cacheado, porque o tracker.js é pedido em toda visita sem cache do navegador. */
  async workspaceExists(workspaceId: string): Promise<boolean> {
    const key = `tracking:ws:${workspaceId}`;
    const cached = this.cache.get<boolean>(key);
    if (cached !== null) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id')
      .eq('id', workspaceId)
      .maybeSingle();

    // Erro de banco não vira "não existe" no cache: senão uma instabilidade
    // de segundos desligaria o rastreio da área por 5 minutos.
    if (error) {
      this.logger.warn(`Falha ao conferir area ${workspaceId}: ${error.message}`);
      return true;
    }

    const exists = !!data;
    this.cache.set(key, exists, WORKSPACE_CACHE_TTL_MS);
    return exists;
  }
}
