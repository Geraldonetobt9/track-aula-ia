import { Injectable, NotFoundException } from '@nestjs/common';
import { SupabaseService } from '../../shared/services/supabase.service';
import { toExclusiveEndDate, toStartOfDayUTC } from '../../shared/helpers/date-range';

export interface RangeQuery {
  from?: string;
  to?: string;
  period?: string;
}

interface PeriodNumbers {
  visitors: number;
  sessions: number;
  pageviews: number;
  avg_duration: number;
  bounced: number;
  checkout_sessions: number;
  checkout_visitors: number;
  sales: number;
  matched_sales: number;
}

interface StatsRpc {
  current: PeriodNumbers;
  previous: PeriodNumbers;
  today_visitors: number;
  daily: { date: string; visitors: number; checkout_sessions: number; sales: number }[];
}

const DEFAULT_RANGE_DAYS = 7;

/** Percentual com uma casa, sem dividir por zero. */
function pct(part: number, whole: number): number {
  return whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0;
}

/** Variação percentual contra o período anterior; null quando não há base. */
function change(current: number, previous: number): number | null {
  return previous > 0 ? Math.round(((current - previous) / previous) * 1000) / 10 : null;
}

function todayInSaoPaulo(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

function shiftDays(date: string, days: number): string {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

@Injectable()
export class TrackingService {
  constructor(private readonly supabase: SupabaseService) {}

  /** Métricas de visitante + funil + série diária, para /tracking e os cards do Dashboard. */
  async getStats(userId: string, workspaceId: string, range: RangeQuery) {
    const { from, to } = await this.resolveRange(workspaceId, range);
    const { data, error } = await this.supabase.getClient().rpc('tracking_stats', {
      p_user_id: userId,
      p_workspace_id: workspaceId,
      p_from: from,
      p_to: to,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Area nao encontrada');

    const { current: cur, previous: prev, today_visitors, daily } = data as StatsRpc;
    const conversionRate = pct(cur.sales, cur.visitors);

    return {
      stats: {
        totalVisitors: cur.visitors,
        totalSessions: cur.sessions,
        totalPageviews: cur.pageviews,
        uniqueVisitorsToday: today_visitors,
        averageSessionDuration: cur.avg_duration,
        averagePageviewsPerSession:
          cur.sessions > 0 ? Math.round((cur.pageviews / cur.sessions) * 10) / 10 : 0,
        bounceRate: pct(cur.bounced, cur.sessions),
        checkoutClickRate: pct(cur.checkout_sessions, cur.sessions),
        conversionRate,
        sales: cur.sales,
        matchedSales: cur.matched_sales,
        visitorsChange: change(cur.visitors, prev.visitors),
        conversionRateChange: change(conversionRate, pct(prev.sales, prev.visitors)),
      },
      // Todas as etapas em visitantes únicos, para as barras serem comparáveis.
      funnel: {
        visitors: cur.visitors,
        checkoutClicks: cur.checkout_visitors,
        sales: cur.sales,
        checkoutRate: pct(cur.checkout_visitors, cur.visitors),
        purchaseRate: pct(cur.sales, cur.visitors),
      },
      daily: daily.map((d) => ({
        date: d.date,
        visitors: d.visitors,
        checkoutClicks: d.checkout_sessions,
        sales: d.sales,
      })),
    };
  }

  async getBreakdown(
    userId: string,
    workspaceId: string,
    by: 'page' | 'source' | 'campaign',
    range: RangeQuery,
  ) {
    const { from, to } = await this.resolveRange(workspaceId, range);
    const { data, error } = await this.supabase.getClient().rpc('tracking_breakdown', {
      p_user_id: userId,
      p_workspace_id: workspaceId,
      p_from: from,
      p_to: to,
      p_group: by,
      p_limit: 50,
    });
    if (error) throw new Error(error.message);
    if (!data) throw new NotFoundException('Area nao encontrada');

    return (data as any[]).map((r) => ({
      key: r.key as string,
      visitors: r.visitors as number,
      sessions: r.sessions as number,
      averageDuration: r.avg_duration as number,
      bounceRate: pct(r.bounced, r.sessions),
      checkoutClicks: r.checkout_sessions as number,
      checkoutRate: pct(r.checkout_sessions, r.sessions),
      sales: r.sales as number,
      conversionRate: pct(r.sales, r.visitors),
    }));
  }

  /**
   * O snippet está instalado? Conta os eventos de hoje e o último recebido.
   * O dono é conferido antes, porque a service role enxerga todas as áreas.
   */
  async getStatus(userId: string, workspaceId: string) {
    await this.assertOwner(userId, workspaceId);
    const client = this.supabase.getClient();
    const since = toStartOfDayUTC(todayInSaoPaulo());

    const [{ count, error: countError }, { data: last, error: lastError }] = await Promise.all([
      client
        .from('tracking_events')
        .select('id', { count: 'exact', head: true })
        .eq('workspace_id', workspaceId)
        .gte('occurred_at', since),
      client
        .from('tracking_events')
        .select('occurred_at')
        .eq('workspace_id', workspaceId)
        .order('occurred_at', { ascending: false })
        .limit(1)
        .maybeSingle(),
    ]);
    if (countError) throw new Error(countError.message);
    if (lastError) throw new Error(lastError.message);

    return {
      eventsToday: count ?? 0,
      lastEventAt: (last?.occurred_at as string | undefined) ?? null,
    };
  }

  /** A visita que levou à venda, em ordem: chegada, eventos, saída. */
  async getJourney(userId: string, saleId: string) {
    const client = this.supabase.getClient();

    const { data: sale, error: saleError } = await client
      .from('sales')
      .select('id, workspace_id, session_id, visitor_id, match_method, sold_at')
      .eq('id', saleId)
      .eq('user_id', userId)
      .maybeSingle();
    if (saleError) throw new Error(saleError.message);
    if (!sale) throw new NotFoundException('Venda nao encontrada');
    if (!sale.session_id) return { matched: false as const };

    const [sessionRes, eventsRes, visitorRes] = await Promise.all([
      client
        .from('tracking_sessions')
        .select(
          'session_id, started_at, ended_at, duration_seconds, landing_page, referrer, utm_source, utm_medium, utm_campaign, utm_content, device_type, city, region, pageviews, checkout_clicked_at',
        )
        .eq('workspace_id', sale.workspace_id)
        .eq('session_id', sale.session_id)
        .maybeSingle(),
      client
        .from('tracking_events')
        .select('event_type, event_name, url, metadata, occurred_at')
        .eq('workspace_id', sale.workspace_id)
        .eq('session_id', sale.session_id)
        .order('occurred_at', { ascending: true })
        .limit(200),
      client
        .from('tracking_visitors')
        .select('first_seen_at, total_sessions')
        .eq('workspace_id', sale.workspace_id)
        .eq('visitor_id', sale.visitor_id)
        .maybeSingle(),
    ]);
    if (sessionRes.error) throw new Error(sessionRes.error.message);
    if (eventsRes.error) throw new Error(eventsRes.error.message);

    return {
      matched: true as const,
      matchMethod: sale.match_method as string,
      soldAt: sale.sold_at as string,
      // A sessão pode ter saído pela retenção; os eventos, depois de 90 dias.
      session: sessionRes.data ?? null,
      visitor: visitorRes.data ?? null,
      events: eventsRes.data ?? [],
    };
  }

  private async assertOwner(userId: string, workspaceId: string): Promise<void> {
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

  /**
   * Datas do painel (YYYY-MM-DD, calendário de São Paulo) → intervalo em UTC.
   * "Todo período" começa na primeira sessão registrada: começar em 2015,
   * como no Dashboard, geraria milhares de dias vazios no gráfico.
   */
  private async resolveRange(workspaceId: string, range: RangeQuery): Promise<{ from: string; to: string }> {
    const today = todayInSaoPaulo();

    if (range.period === 'all') {
      const { data } = await this.supabase
        .getClient()
        .from('tracking_sessions')
        .select('started_at')
        .eq('workspace_id', workspaceId)
        .order('started_at', { ascending: true })
        .limit(1)
        .maybeSingle();
      const first = data?.started_at
        ? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date(data.started_at))
        : today;
      return { from: toStartOfDayUTC(first), to: toExclusiveEndDate(today) };
    }

    const to = range.to ?? today;
    const from = range.from ?? shiftDays(to, -(DEFAULT_RANGE_DAYS - 1));
    return { from: toStartOfDayUTC(from), to: toExclusiveEndDate(to) };
  }
}
