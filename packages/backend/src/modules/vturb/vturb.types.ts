/** Raw shapes returned by the VTurb Analytics API, per its OpenAPI spec. */

export interface VturbPlayer {
  id: string;
  name: string;
  pitch_time: number;
  duration: number;
  created_at: string;
}

/** `/sessions/stats` — carries every metric the video detail screen shows. */
export interface VturbStats {
  total_viewed?: number;
  total_viewed_device_uniq?: number;
  total_started?: number;
  total_started_device_uniq?: number;
  total_finished?: number;
  engagement_rate?: number;
  total_clicked?: number;
  total_over_pitch?: number;
  over_pitch_rate?: number;
  total_conversions?: number;
  overall_conversion_rate?: number;
  play_rate?: number;
  total_amount_brl?: number;
  total_amount_usd?: number;
}

/** One bucket of `/sessions/stats_by_field`, e.g. grouped by country. */
export interface VturbFieldBucket {
  [key: string]: unknown;
  total_viewed?: number;
  total_started?: number;
}

/**
 * One row of `/events/total_by_company_players` — a (player, event) pair.
 *
 * Cheap enough to rank the whole library in a single request, which is what
 * makes it possible to fetch the expensive per-video stats for the top few only.
 */
export interface VturbPlayerEventTotal {
  player_id: string;
  event: string;
  total: number;
  total_uniq_sessions?: number;
  total_uniq_device?: number;
}

// ---------------------------------------------------------------------------
// Shapes this backend returns to the frontend
// ---------------------------------------------------------------------------

export interface VturbVideoRow {
  playerId: string;
  name: string;
  durationSeconds: number;
  views: number;
  uniqueViews: number;
  plays: number;
  uniquePlays: number;
  conversions: number;
  revenue: number;
  conversionRate: number;
}

export interface VturbCountryRow {
  country: string;
  views: number;
  percentage: number;
}

export interface VturbOverview {
  revenue: number;
  views: number;
  plays: number;
  conversions: number;
  conversionRate: number;
  videos: VturbVideoRow[];
  countries: VturbCountryRow[];
  /** How many videos fed the country breakdown, since it is capped. */
  countriesFromVideos: number;
  /** Videos whose stats call failed and were left out of the totals. */
  failedVideos: number;
  /** How many videos exist in the account, of which only the top ones are detailed. */
  totalVideosInAccount: number;
}

export interface VturbVideoDetail {
  playerId: string;
  name: string;
  durationSeconds: number;
  pitchTimeSeconds: number;
  views: number;
  uniqueViews: number;
  plays: number;
  uniquePlays: number;
  playRate: number;
  pitchRetentionRate: number;
  pitchAudience: number;
  engagementRate: number;
  buttonClicks: number;
  conversions: number;
  conversionRate: number;
  revenue: number;
}
