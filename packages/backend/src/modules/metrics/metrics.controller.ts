import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { LiveMetricsService } from './live-metrics.service';
import { MetricsService } from './metrics.service';
import { DashboardQueryDto } from './dto/dashboard-query.dto';
import { DateRangeQueryDto } from './dto/date-range-query.dto';
import { AdSetsQueryDto } from './dto/ad-sets-query.dto';
import { AdsQueryDto } from './dto/ads-query.dto';
import { SyncLogsQueryDto } from './dto/sync-logs-query.dto';

@Controller('metrics')
@UseGuards(AuthGuard)
export class MetricsController {
  constructor(
    private readonly liveMetrics: LiveMetricsService,
    private readonly metricsService: MetricsService,
  ) {}

  @Get('dashboard')
  getDashboardData(
    @CurrentUser('id') userId: string,
    @Query() query: DashboardQueryDto,
  ) {
    return this.liveMetrics.getDashboardData(userId, {
      from: query.from,
      to: query.to,
      period: query.period,
      workspace_id: query.workspace_id,
      connection_ids: query.connection_ids ? query.connection_ids.split(',') : undefined,
      checkout_ids: query.checkout_ids ? query.checkout_ids.split(',') : undefined,
      product_names: query.product_names ? query.product_names.split(',') : undefined,
    });
  }

  @Get('campaigns')
  getCampaigns(
    @CurrentUser('id') userId: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.liveMetrics.getCampaigns(userId, {
      from: query.from,
      to: query.to,
      workspace_id: query.workspace_id,
      connection_ids: query.connection_ids ? query.connection_ids.split(',') : undefined,
    });
  }

  @Get('ad-sets')
  getAdSets(
    @CurrentUser('id') userId: string,
    @Query() query: AdSetsQueryDto,
  ) {
    const campaignIds = query.campaign_ids
      ? query.campaign_ids.split(',')
      : query.campaign_id
        ? [query.campaign_id]
        : undefined;

    return this.liveMetrics.getAdSets(userId, {
      from: query.from,
      to: query.to,
      workspace_id: query.workspace_id,
      campaign_ids: campaignIds,
      connection_ids: query.connection_ids ? query.connection_ids.split(',') : undefined,
    });
  }

  @Get('ads')
  getAds(
    @CurrentUser('id') userId: string,
    @Query() query: AdsQueryDto,
  ) {
    const adSetIds = query.ad_set_ids
      ? query.ad_set_ids.split(',')
      : query.ad_set_id
        ? [query.ad_set_id]
        : undefined;

    const campaignIds = query.campaign_ids
      ? query.campaign_ids.split(',')
      : undefined;

    return this.liveMetrics.getAds(userId, {
      from: query.from,
      to: query.to,
      workspace_id: query.workspace_id,
      ad_set_ids: adSetIds,
      campaign_ids: campaignIds,
      connection_ids: query.connection_ids ? query.connection_ids.split(',') : undefined,
    });
  }

  @Get('daily-spend')
  getDailyAdSpend(
    @CurrentUser('id') userId: string,
    @Query() query: DateRangeQueryDto,
  ) {
    return this.liveMetrics.getDailyAdSpend(userId, {
      from: query.from,
      to: query.to,
      workspace_id: query.workspace_id,
    });
  }

  @Get('sync-schedules')
  getSyncSchedules(
    @CurrentUser('id') userId: string,
    @Query('workspace_id') workspaceId?: string,
  ) {
    return this.metricsService.getSyncSchedules(userId, workspaceId);
  }

  @Get('sync-logs')
  getSyncLogs(
    @CurrentUser('id') userId: string,
    @Query() query: SyncLogsQueryDto,
  ) {
    return this.metricsService.getSyncLogs(userId, {
      limit: query.limit ? parseInt(query.limit, 10) : undefined,
      workspace_id: query.workspace_id,
    });
  }
}
