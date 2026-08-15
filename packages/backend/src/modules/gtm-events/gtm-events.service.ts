import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { randomBytes } from 'crypto';
import { SupabaseService } from '../../shared/services/supabase.service';
import { CacheService } from '../../shared/services/cache.service';

const DEFAULT_PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200;

const DEFAULT_VISITORS_LIMIT = 20;
const MAX_VISITORS_LIMIT = 100;

const TOKEN_BYTES = 32;
const TOKEN_PREFIX = 'stl_';

/** Must match the prefix GtmIngestService caches under, for rotation to invalidate it. */
const TOKEN_CACHE_PREFIX = 'gtm:token:';

@Injectable()
export class GtmEventsService {
  private readonly logger = new Logger(GtmEventsService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly cache: CacheService,
  ) {}

  /**
   * Recent events, newest first, keyset-paginated on `created_at`.
   *
   * `before` is the `created_at` of the last row the client already has. Offset
   * pagination would degrade as the table grows, and this table grows fast.
   *
   * Goes through an RPC rather than a plain select because each row carries the
   * visitor's visit number, which cannot be derived from a page of rows alone —
   * it depends on everything that visitor did before it.
   *
   * No ownership pre-check: the RPC filters on user_id, so a workspace the
   * caller doesn't own simply returns nothing.
   */
  async list(
    userId: string,
    workspaceId: string,
    options: {
      before?: string;
      eventName?: string;
      limit?: number;
      from?: string;
      to?: string;
    } = {},
  ) {
    const limit = Math.min(options.limit ?? DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE);

    const { data, error } = await this.supabase.getClient().rpc('gtm_events_page', {
      p_user_id: userId,
      p_workspace_id: workspaceId,
      p_before: options.before ?? null,
      p_event_name: options.eventName ?? null,
      p_limit: limit,
      p_from: options.from ?? null,
      p_to: options.to ?? null,
    });

    if (error) {
      this.logger.error(`Failed to list GTM events: ${error.message}`);
      return { events: [], nextCursor: null };
    }

    const events = (data as any[]) ?? [];
    const nextCursor =
      events.length === limit ? events[events.length - 1].created_at : null;

    return { events, nextCursor };
  }

  /**
   * People with the most visits in the window, most first.
   *
   * Counted inside the selected period, unlike the visit number on an
   * individual event: the question here is who showed up most in this window.
   */
  async topVisitors(
    userId: string,
    workspaceId: string,
    options: { from?: string; to?: string; limit?: number } = {},
  ) {
    const limit = Math.min(options.limit ?? DEFAULT_VISITORS_LIMIT, MAX_VISITORS_LIMIT);

    const { data, error } = await this.supabase.getClient().rpc('gtm_top_visitors', {
      p_user_id: userId,
      p_workspace_id: workspaceId,
      p_from: options.from ?? null,
      p_to: options.to ?? null,
      p_limit: limit,
    });

    if (error) {
      this.logger.error(`Failed to rank GTM visitors: ${error.message}`);
      return { visitors: [] };
    }

    return { visitors: (data as any[]) ?? [] };
  }

  /** Full payload for one event, for the detail drawer. */
  async getRaw(userId: string, workspaceId: string, eventId: string) {
    const { data } = await this.supabase
      .getClient()
      .from('gtm_events')
      .select('id, raw')
      .eq('id', eventId)
      .eq('workspace_id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    return data ?? null;
  }

  /** Current ingestion token, or null when the workspace has never generated one. */
  async getToken(userId: string, workspaceId: string): Promise<string | null> {
    // Scoped by user_id: this is a workspace secret, and unlike the event
    // queries there is no other filter making it safe.
    const { data } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('gtm_ingest_token')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    return data?.gtm_ingest_token ?? null;
  }

  /**
   * Generates a new ingestion token, replacing any existing one.
   *
   * Rotation drops the cached lookup immediately — otherwise the old token
   * would keep working for up to the cache TTL, which is exactly the window
   * that matters when rotating a leaked token.
   */
  async rotateToken(userId: string, workspaceId: string): Promise<string> {
    const previous = await this.getToken(userId, workspaceId);
    const token = `${TOKEN_PREFIX}${randomBytes(TOKEN_BYTES).toString('hex')}`;

    // The returned row doubles as the ownership check: the service role
    // bypasses RLS, so a workspace the caller doesn't own would otherwise
    // update nothing and still hand back a token that silently never works.
    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ gtm_ingest_token: token })
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(`Failed to rotate GTM token: ${error.message}`);
    if (!data) throw new ForbiddenException('Workspace not found for this user');

    if (previous) this.cache.invalidate(`${TOKEN_CACHE_PREFIX}${previous}`);
    return token;
  }
}
