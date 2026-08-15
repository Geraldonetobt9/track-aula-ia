import { Injectable, Logger } from '@nestjs/common';
import { LiveMetricsService } from '../metrics/live-metrics.service';

interface RuleForEvaluation {
  id: string;
  workspace_id: string;
  connection_id: string | null;
  target_entity: string;
  target_status: string;
  name_filter: string | null;
  evaluation_period: string;
  custom_start_date: string | null;
}

interface Condition {
  metric: string;
  operator: string;
  value: number;
}

interface MatchedEntity {
  id: string;
  name: string;
  ad_account_id?: string;
  metricsSnapshot: Record<string, number>;
}

const METRIC_KEY_MAP: Record<string, string> = {
  spend: 'spend',
  cpa: 'cpa_real',
  roi: 'roi',
  roas: 'roas',
  profit: 'profit',
  profit_margin: 'profit_margin',
  cpc: 'cpc',
  ctr: 'ctr',
  cpm: 'cpm',
  impressions: 'impressions',
  clicks: 'clicks',
  conversions: 'conversions',
};

@Injectable()
export class RuleEvaluatorService {
  private readonly logger = new Logger(RuleEvaluatorService.name);

  constructor(private readonly liveMetrics: LiveMetricsService) {}

  async evaluate(userId: string, rule: RuleForEvaluation, conditions: Condition[]): Promise<MatchedEntity[]> {
    const { from, to } = this.resolveDateRange(rule.evaluation_period, rule.custom_start_date);
    const filters: any = { from, to, workspace_id: rule.workspace_id };
    if (rule.connection_id) filters.connection_ids = [rule.connection_id];

    const entities = await this.fetchEntities(userId, rule.target_entity, filters);

    const matched = entities.filter((entity) => {
      if (rule.target_status !== 'any' && entity.status !== rule.target_status) return false;
      if (rule.name_filter && !entity.name.toLowerCase().includes(rule.name_filter.toLowerCase())) return false;
      return this.matchesAllConditions(entity, conditions);
    });

    return matched.map((entity) => ({
      id: entity.id,
      name: entity.name,
      ad_account_id: entity.ad_account_id,
      metricsSnapshot: this.extractMetrics(entity),
    }));
  }

  private async fetchEntities(userId: string, targetEntity: string, filters: any): Promise<any[]> {
    switch (targetEntity) {
      case 'campaign': return this.liveMetrics.getCampaigns(userId, filters);
      case 'adset': return this.liveMetrics.getAdSets(userId, filters);
      case 'ad': return this.liveMetrics.getAds(userId, filters);
      default: return [];
    }
  }

  private matchesAllConditions(entity: any, conditions: Condition[]): boolean {
    return conditions.every((condition) => {
      const metricValue = this.getMetricValue(entity, condition.metric);
      return this.compareValues(metricValue, condition.operator, condition.value);
    });
  }

  private getMetricValue(entity: any, metric: string): number {
    const key = METRIC_KEY_MAP[metric] ?? metric;
    const value = entity[key];
    return typeof value === 'number' ? value : 0;
  }

  private compareValues(actual: number, operator: string, expected: number): boolean {
    switch (operator) {
      case 'gt': return actual > expected;
      case 'lt': return actual < expected;
      case 'gte': return actual >= expected;
      case 'lte': return actual <= expected;
      default: return false;
    }
  }

  private extractMetrics(entity: any): Record<string, number> {
    return {
      spend: entity.spend || 0,
      cpa: entity.cpa_real || 0,
      roi: entity.roi || 0,
      roas: entity.roas || 0,
      cpc: entity.cpc || 0,
      ctr: entity.ctr || 0,
      cpm: entity.cpm || 0,
      impressions: entity.impressions || 0,
      clicks: entity.clicks || 0,
      conversions: entity.conversions || 0,
      revenue: entity.revenue || 0,
      sales: entity.sales || 0,
      daily_budget: entity.daily_budget || 0,
      lifetime_budget: entity.lifetime_budget || 0,
    };
  }

  private resolveDateRange(period: string, customStartDate: string | null): { from: string; to: string } {
    const today = new Date();
    const toStr = (d: Date) => d.toISOString().split('T')[0];
    const to = toStr(today);

    switch (period) {
      case 'today':
        return { from: to, to };
      case 'yesterday': {
        const d = new Date(today);
        d.setDate(d.getDate() - 1);
        const yest = toStr(d);
        return { from: yest, to: yest };
      }
      case 'last_7d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 7);
        return { from: toStr(d), to };
      }
      case 'last_30d': {
        const d = new Date(today);
        d.setDate(d.getDate() - 30);
        return { from: toStr(d), to };
      }
      case 'custom':
        return { from: customStartDate ?? to, to };
      default:
        return { from: to, to };
    }
  }
}
