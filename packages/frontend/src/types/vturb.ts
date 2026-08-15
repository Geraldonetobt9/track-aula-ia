/** One video in the ranking, ordered by views. */
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

/** Account totals plus the ranking, from a single request. */
export interface VturbOverview {
  revenue: number;
  views: number;
  plays: number;
  conversions: number;
  conversionRate: number;
  videos: VturbVideoRow[];
  countries: VturbCountryRow[];
  /**
   * How many videos fed the country split.
   *
   * Countries are only available per video, so the breakdown samples the top
   * ones instead of paying a request per video in the library.
   */
  countriesFromVideos: number;
  /** Videos whose stats call failed and were left out of the totals. */
  failedVideos: number;
  /** Total videos in the account; only the top ones are detailed. */
  totalVideosInAccount: number;
}

/** The per-video panel: everything VTurb's own metrics strip shows. */
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
