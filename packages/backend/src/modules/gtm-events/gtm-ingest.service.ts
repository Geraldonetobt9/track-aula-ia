import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';
import {
  GtmEventInput,
  NormalizedGtmEvent,
  normalizeGtmEvent,
} from './gtm-event-normalizer';

/** Token -> workspace resolution happens on every event; 60s keeps it off the DB. */
const TOKEN_CACHE_TTL_MS = 60_000;
const TOKEN_CACHE_PREFIX = 'gtm:token:';

/** Caps a single request, so one misconfigured tag cannot push an unbounded insert. */
const MAX_BATCH_SIZE = 200;

interface WorkspaceRef {
  workspaceId: string;
  userId: string;
}

@Injectable()
export class GtmIngestService {
  private readonly logger = new Logger(GtmIngestService.name);
  private readonly visitorSalt: string;

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
    config: ConfigService,
  ) {
    // Falls back to the service role key so a missing env var degrades to
    // "hashes are still stable and still secret" instead of crashing ingestion.
    // It is not a substitute for setting GTM_VISITOR_SALT: rotating the service
    // role key would break visitor continuity.
    this.visitorSalt =
      config.get<string>('GTM_VISITOR_SALT') ??
      config.get<string>('SUPABASE_SERVICE_ROLE_KEY') ??
      '';
  }

  /**
   * Stores a batch of events. Returns how many rows were accepted for insert.
   *
   * Never throws: the caller answers 200 regardless (RN-07). A retry from the
   * sGTM container on our own failure would only multiply load.
   */
  async ingest(token: string | undefined, payload: unknown): Promise<number> {
    const workspace = await this.resolveWorkspace(token);
    if (!workspace) return 0;

    const items = this.toItems(payload);
    if (items.length === 0) return 0;

    const rows = items
      .map((item) =>
        normalizeGtmEvent(item, {
          workspaceId: workspace.workspaceId,
          userId: workspace.userId,
          visitorSalt: this.visitorSalt,
        }),
      )
      .filter((row): row is NormalizedGtmEvent => row !== null);

    if (rows.length === 0) return 0;

    return this.insert(rows);
  }

  /** Resolves the ingestion token to its workspace, or null when unknown. */
  async resolveWorkspace(token: string | undefined): Promise<WorkspaceRef | null> {
    const trimmed = token?.trim();
    if (!trimmed) return null;

    const cacheKey = `${TOKEN_CACHE_PREFIX}${trimmed}`;
    const cached = this.cache.get<WorkspaceRef>(cacheKey);
    if (cached) return cached;

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('id, user_id')
      .eq('gtm_ingest_token', trimmed)
      .is('archived_at', null)
      .maybeSingle();

    if (error || !data) return null;

    const workspace: WorkspaceRef = { workspaceId: data.id, userId: data.user_id };
    this.cache.set(cacheKey, workspace, TOKEN_CACHE_TTL_MS);
    return workspace;
  }

  /** Accepts either a single event object or an array of them (RN-04). */
  private toItems(payload: unknown): GtmEventInput[] {
    if (Array.isArray(payload)) return payload.slice(0, MAX_BATCH_SIZE) as GtmEventInput[];
    if (payload && typeof payload === 'object') return [payload as GtmEventInput];
    return [];
  }

  private async insert(rows: NormalizedGtmEvent[]): Promise<number> {
    // ignoreDuplicates makes a replayed event_id a no-op instead of an error,
    // which is what deduplication against the browser pixel needs (RN-03).
    const { error } = await this.supabase
      .getClient()
      .from('gtm_events')
      .upsert(rows, { onConflict: 'workspace_id,event_id', ignoreDuplicates: true });

    if (error) {
      this.logger.error(`Failed to store ${rows.length} GTM event(s): ${error.message}`);
      return 0;
    }
    return rows.length;
  }
}
