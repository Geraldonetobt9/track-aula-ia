import { BadRequestException, ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { EncryptionService } from '../../shared/services/encryption.service';
import { CacheService } from '../../shared/services/cache.service';
import {
  VturbApiClient,
  VturbApiError,
  VTURB_MAX_CONCURRENCY,
  mapWithConcurrency,
} from './vturb-api.client';
import {
  VturbCountryRow,
  VturbFieldBucket,
  VturbOverview,
  VturbPlayer,
  VturbPlayerEventTotal,
  VturbStats,
  VturbVideoDetail,
  VturbVideoRow,
} from './vturb.types';

/** VTurb data is not real time and the fan-out is expensive; minutes are fine. */
const OVERVIEW_CACHE_TTL_MS = 5 * 60_000;
const DETAIL_CACHE_TTL_MS = 60_000;

const CACHE_PREFIX = 'vturb:';

/**
 * How many videos get the full metrics treatment.
 *
 * `/sessions/stats` is one request per video and the heavy ones are slow — on a
 * 22-video library the two busiest timed out, silently dropping the bulk of the
 * account's revenue from the totals. The tail is almost always zeros anyway, so
 * the ranking is decided cheaply first and only the top few are detailed.
 */
const TOP_VIDEOS = 5;

/** Dates are interpreted in the operator's timezone, not UTC. */
const REPORT_TIMEZONE = 'America/Sao_Paulo';

/**
 * Money comes back in cents.
 *
 * Verified against the operator's own VTurb dashboard: `total_amount_brl` of
 * 1828715 is displayed there as R$ 18.287,15. Nothing in the spec says this —
 * the field is typed `integer` with example `1000`, which reads as reais.
 */
const CENTS_PER_UNIT = 100;

/**
 * VTurb rejects date-only values on `/sessions/stats`, despite the spec listing
 * "2023-10-26" as an accepted example. It answers:
 *
 *   "Start date must be a valid datetime with hours, minutes, and seconds"
 *
 * The ISO form the spec also gives ("2023-10-26T18:24:05.000+00:00") is rejected
 * too. `YYYY-MM-DD HH:MM:SS` is what actually works.
 */
function toStartOfDay(day: string): string {
  return day.includes(':') ? day : `${day} 00:00:00`;
}

/**
 * End of day, because VTurb filters `end_date` with `<=`.
 *
 * Sending midnight would silently drop the entire last day of every range.
 */
function toEndOfDay(day: string): string {
  return day.includes(':') ? day : `${day} 23:59:59`;
}

interface DateRange {
  from: string;
  to: string;
}

@Injectable()
export class VturbService {
  private readonly logger = new Logger(VturbService.name);

  constructor(
    private readonly supabase: SupabaseService,
    private readonly encryption: EncryptionService,
    private readonly cache: CacheService,
    private readonly api: VturbApiClient,
  ) {}

  // -------------------------------------------------------------------------
  // Token
  // -------------------------------------------------------------------------

  /** Whether the workspace has a token. The token itself never leaves the backend. */
  async isConfigured(userId: string, workspaceId: string): Promise<boolean> {
    return (await this.readToken(userId, workspaceId)) !== null;
  }

  async saveToken(userId: string, workspaceId: string, token: string): Promise<void> {
    const trimmed = token.trim();
    if (!trimmed) throw new BadRequestException('Token vazio');

    const { data, error } = await this.supabase
      .getClient()
      .from('workspaces')
      .update({ vturb_api_token: this.encryption.encrypt(trimmed) })
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .select('id')
      .maybeSingle();

    if (error) throw new Error(`Falha ao salvar o token da VTurb: ${error.message}`);
    // The service role bypasses RLS, so the affected row is the ownership proof.
    if (!data) throw new ForbiddenException('Area nao encontrada para este usuario');

    this.invalidate(workspaceId);
  }

  async removeToken(userId: string, workspaceId: string): Promise<void> {
    await this.supabase
      .getClient()
      .from('workspaces')
      .update({ vturb_api_token: null })
      .eq('id', workspaceId)
      .eq('user_id', userId);

    this.invalidate(workspaceId);
  }

  /**
   * Confirms the token works before the user leaves the settings screen.
   *
   * `/players/list` is the cheapest authenticated call in this API, so it is
   * the one used to tell "wrong key" apart from "no data yet".
   */
  async testToken(userId: string, workspaceId: string): Promise<{ players: number }> {
    const token = await this.requireToken(userId, workspaceId);
    const players = await this.listPlayers(token);
    return { players: players.length };
  }

  // -------------------------------------------------------------------------
  // Reads
  // -------------------------------------------------------------------------

  /**
   * Account totals plus every video ranked by views.
   *
   * Both come from the same per-player `/sessions/stats` fan-out. That endpoint
   * already carries views, plays, conversions and revenue, so asking the events
   * endpoints separately would spend quota for numbers we already have — and
   * risk the ranking disagreeing with the totals printed above it.
   */
  async getOverview(
    userId: string,
    workspaceId: string,
    range: DateRange,
  ): Promise<VturbOverview> {
    const cacheKey = `${CACHE_PREFIX}overview:${workspaceId}:${range.from}:${range.to}`;
    const cached = this.cache.get<VturbOverview>(cacheKey);
    if (cached) return cached;

    const token = await this.requireToken(userId, workspaceId);
    const players = await this.listPlayers(token);

    // Rank first, cheaply, then detail only the top. Detailing everything is
    // what broke the totals: the busiest videos take longest, so they were
    // exactly the ones that timed out.
    const ranked = await this.rankPlayers(token, players, range);
    const shortlist = ranked.slice(0, TOP_VIDEOS);

    // One failing video must not blank the whole screen. But if every one fails
    // the problem is systemic, and hiding it behind a page of zeros would be
    // worse than showing the error.
    const settled = await mapWithConcurrency(shortlist, VTURB_MAX_CONCURRENCY, async (player) => {
      try {
        const stats = await this.fetchStats(token, player, range);
        return { row: this.toVideoRow(player, stats), error: null as Error | null };
      } catch (error) {
        this.logger.warn(`Falha ao ler stats do player ${player.id}: ${(error as Error).message}`);
        return { row: null, error: error as Error };
      }
    });

    const videos = settled
      .map((result) => result.row)
      .filter((row): row is VturbVideoRow => row !== null);

    const failures = settled.filter((result) => result.error !== null);
    if (shortlist.length > 0 && videos.length === 0) throw failures[0].error;

    videos.sort((a, b) => b.views - a.views);

    const totals = videos.reduce(
      (acc, video) => ({
        revenue: acc.revenue + video.revenue,
        views: acc.views + video.views,
        plays: acc.plays + video.plays,
        uniquePlays: acc.uniquePlays + video.uniquePlays,
        conversions: acc.conversions + video.conversions,
      }),
      { revenue: 0, views: 0, plays: 0, uniquePlays: 0, conversions: 0 },
    );

    const countries = await this.aggregateCountries(token, videos, players, range);

    const overview: VturbOverview = {
      revenue: totals.revenue,
      views: totals.views,
      plays: totals.plays,
      conversions: totals.conversions,
      // VTurb's own dashboard divides by unique plays, not raw plays. Matching
      // that keeps this screen from disagreeing with theirs on the same day.
      conversionRate: this.rate(totals.conversions, totals.uniquePlays),
      videos,
      countries,
      countriesFromVideos: videos.length,
      failedVideos: failures.length,
      totalVideosInAccount: players.length,
    };

    this.cache.set(cacheKey, overview, OVERVIEW_CACHE_TTL_MS);
    return overview;
  }

  /** Every metric the video detail screen shows, from a single `/sessions/stats`. */
  async getVideoDetail(
    userId: string,
    workspaceId: string,
    playerId: string,
    range: DateRange,
  ): Promise<VturbVideoDetail> {
    const cacheKey = `${CACHE_PREFIX}detail:${workspaceId}:${playerId}:${range.from}:${range.to}`;
    const cached = this.cache.get<VturbVideoDetail>(cacheKey);
    if (cached) return cached;

    const token = await this.requireToken(userId, workspaceId);
    const players = await this.listPlayers(token);
    const player = players.find((candidate) => candidate.id === playerId);
    if (!player) throw new BadRequestException('Video nao encontrado nesta conta VTurb');

    const stats = await this.fetchStats(token, player, range);

    const uniqueViews = this.int(stats.total_viewed_device_uniq);
    const uniquePlays = this.int(stats.total_started_device_uniq);
    const conversions = this.int(stats.total_conversions);

    const detail: VturbVideoDetail = {
      playerId: player.id,
      name: player.name,
      durationSeconds: this.int(player.duration),
      pitchTimeSeconds: this.int(player.pitch_time),
      views: this.int(stats.total_viewed),
      uniqueViews,
      plays: this.int(stats.total_started),
      uniquePlays,
      // Prefer the rates VTurb computes. Recomputing them here would drift from
      // their dashboard wherever their definition differs from the obvious one.
      playRate: this.num(stats.play_rate) || this.rate(uniquePlays, uniqueViews),
      pitchRetentionRate: this.num(stats.over_pitch_rate),
      pitchAudience: this.int(stats.total_over_pitch),
      engagementRate: this.num(stats.engagement_rate),
      buttonClicks: this.int(stats.total_clicked),
      conversions,
      conversionRate:
        this.num(stats.overall_conversion_rate) || this.rate(conversions, uniquePlays),
      revenue: this.num(stats.total_amount_brl) / CENTS_PER_UNIT,
    };

    this.cache.set(cacheKey, detail, DETAIL_CACHE_TTL_MS);
    return detail;
  }

  // -------------------------------------------------------------------------
  // Internals
  // -------------------------------------------------------------------------

  private async listPlayers(token: string): Promise<VturbPlayer[]> {
    const players = await this.api.get<VturbPlayer[]>(token, '/players/list');
    return Array.isArray(players) ? players : [];
  }

  /**
   * Orders the library by views using one aggregate request instead of one per
   * video.
   *
   * `/events/total_by_company_players` returns a (player, event) total for the
   * whole company at once, which is all the ranking needs. The expensive
   * `/sessions/stats` is then spent only on the videos that made the cut.
   *
   * Falls back to the players' own order if that endpoint misbehaves: a wrong
   * order is a far smaller problem than a screen that will not load, and this
   * response shape has not been verified against the live API.
   */
  private async rankPlayers(
    token: string,
    players: VturbPlayer[],
    range: DateRange,
  ): Promise<VturbPlayer[]> {
    if (players.length <= TOP_VIDEOS) return players;

    try {
      const totals = await this.api.post<VturbPlayerEventTotal[]>(
        token,
        '/events/total_by_company_players',
        {
          // VTurb's own event vocabulary here — not the sGTM names.
          events: ['viewed'],
          start_date: toStartOfDay(range.from),
          end_date: toEndOfDay(range.to),
        },
      );

      if (!Array.isArray(totals) || totals.length === 0) return players;

      const viewsByPlayer = new Map<string, number>();
      for (const row of totals) {
        if (!row?.player_id) continue;
        viewsByPlayer.set(
          row.player_id,
          (viewsByPlayer.get(row.player_id) ?? 0) + this.int(row.total),
        );
      }

      return [...players].sort(
        (a, b) => (viewsByPlayer.get(b.id) ?? 0) - (viewsByPlayer.get(a.id) ?? 0),
      );
    } catch (error) {
      this.logger.warn(`Falha ao ranquear os players: ${(error as Error).message}`);
      return players;
    }
  }

  /**
   * `video_duration` is sent even though the spec marks it optional here.
   *
   * The same field is *required* on `/sessions/stats_by_field`, which says the
   * session maths needs it — "optional" only means VTurb will look it up. When
   * that lookup comes back empty the endpoint answers zeros instead of failing,
   * which is how a video with real audience showed up in the ranking and then
   * reported nothing. We already have the true value from `/players/list`, so
   * there is no reason to rely on their lookup.
   *
   * `pitch_time` only goes when the player actually has one: sending 0 would
   * assert "the pitch is at second zero" rather than "I don't know".
   */
  private fetchStats(token: string, player: VturbPlayer, range: DateRange): Promise<VturbStats> {
    const pitchTime = this.int(player.pitch_time);

    return this.api.post<VturbStats>(token, '/sessions/stats', {
      player_id: player.id,
      start_date: toStartOfDay(range.from),
      end_date: toEndOfDay(range.to),
      timezone: REPORT_TIMEZONE,
      ...(this.int(player.duration) > 0 ? { video_duration: this.int(player.duration) } : {}),
      ...(pitchTime > 0 ? { pitch_time: pitchTime } : {}),
    });
  }

  private toVideoRow(player: VturbPlayer, stats: VturbStats): VturbVideoRow {
    const uniquePlays = this.int(stats.total_started_device_uniq);
    const conversions = this.int(stats.total_conversions);

    return {
      playerId: player.id,
      name: player.name,
      durationSeconds: this.int(player.duration),
      views: this.int(stats.total_viewed),
      uniqueViews: this.int(stats.total_viewed_device_uniq),
      plays: this.int(stats.total_started),
      uniquePlays,
      conversions,
      revenue: this.num(stats.total_amount_brl) / CENTS_PER_UNIT,
      conversionRate:
        this.num(stats.overall_conversion_rate) || this.rate(conversions, uniquePlays),
    };
  }

  /**
   * Country split, summed over the top videos.
   *
   * Never fatal: countries are a secondary card, and the `field` name is the
   * one part of this integration the spec does not pin down. If VTurb rejects
   * it, the rest of the screen still renders.
   */
  private async aggregateCountries(
    token: string,
    videos: VturbVideoRow[],
    players: VturbPlayer[],
    range: DateRange,
  ): Promise<VturbCountryRow[]> {
    const byPlayer = new Map(players.map((player) => [player.id, player]));
    const totals = new Map<string, number>();

    await mapWithConcurrency(videos, VTURB_MAX_CONCURRENCY, async (video) => {
      const player = byPlayer.get(video.playerId);
      if (!player) return;

      try {
        const response = await this.api.post<VturbFieldBucket | VturbFieldBucket[]>(
          token,
          '/sessions/stats_by_field',
          {
            player_id: player.id,
            start_date: toStartOfDay(range.from),
            end_date: toEndOfDay(range.to),
            // Valid values, per VTurb's own 400: src, sck, utm_source, utm_term,
            // utm_campaign, utm_content, utm_medium, no_attribution, country,
            // device_type, browser.
            field: 'country',
            // Required by the spec even though VTurb knows the duration itself.
            video_duration: this.int(player.duration),
            timezone: REPORT_TIMEZONE,
          },
        );

        // The spec types this as an object, but each bucket carries its own
        // `grouped_field`, so an array is what actually comes back. Accept both.
        const buckets = Array.isArray(response) ? response : [response];
        for (const bucket of buckets) {
          const label = typeof bucket?.grouped_field === 'string' ? bucket.grouped_field : null;
          if (!label) continue;
          totals.set(label, (totals.get(label) ?? 0) + this.int(bucket.total_viewed));
        }
      } catch (error) {
        this.logger.warn(
          `Falha ao agrupar paises do player ${player.id}: ${(error as Error).message}`,
        );
      }
    });

    const grandTotal = Array.from(totals.values()).reduce((sum, value) => sum + value, 0);
    if (grandTotal === 0) return [];

    return Array.from(totals.entries())
      .map(([country, views]) => ({
        country,
        views,
        percentage: this.rate(views, grandTotal),
      }))
      .sort((a, b) => b.views - a.views)
      .slice(0, 6);
  }

  private async requireToken(userId: string, workspaceId: string): Promise<string> {
    const token = await this.readToken(userId, workspaceId);
    if (!token) {
      throw new VturbApiError('Nenhuma chave da VTurb configurada nesta area', 428);
    }
    return token;
  }

  private async readToken(userId: string, workspaceId: string): Promise<string | null> {
    const { data } = await this.supabase
      .getClient()
      .from('workspaces')
      .select('vturb_api_token')
      .eq('id', workspaceId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!data?.vturb_api_token) return null;
    return this.encryption.decryptIfNeeded(data.vturb_api_token);
  }

  private invalidate(workspaceId: string): void {
    this.cache.invalidateByPrefix(`${CACHE_PREFIX}overview:${workspaceId}`);
    this.cache.invalidateByPrefix(`${CACHE_PREFIX}detail:${workspaceId}`);
  }

  private int(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? Math.round(parsed) : 0;
  }

  private num(value: unknown): number {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private rate(part: number, whole: number): number {
    if (!whole) return 0;
    return (part / whole) * 100;
  }
}
