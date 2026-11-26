import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrackingService } from './tracking.service';
import { JourneyService } from './journey.service';
import {
  TrackingBreakdownQueryDto,
  TrackingCustomersQueryDto,
  TrackingQueryDto,
  TrackingStatusQueryDto,
} from './dto/tracking-query.dto';

/** Leitura do rastreio, para o painel. Tudo escopado ao dono da área. */
@Controller('tracking')
@UseGuards(AuthGuard)
export class TrackingController {
  constructor(
    private readonly trackingService: TrackingService,
    private readonly journeyService: JourneyService,
  ) {}

  /** Cards, funil e série diária. O funil vem junto porque sai da mesma consulta. */
  @Get('stats')
  getStats(@CurrentUser('id') userId: string, @Query() query: TrackingQueryDto) {
    return this.trackingService.getStats(userId, query.workspace_id, query);
  }

  /** Mesmos dados, só o funil — para quem precisa apenas das etapas. */
  @Get('funnel')
  async getFunnel(@CurrentUser('id') userId: string, @Query() query: TrackingQueryDto) {
    const { funnel } = await this.trackingService.getStats(userId, query.workspace_id, query);
    return funnel;
  }

  /** Quebra por página de entrada, origem ou campanha. */
  @Get('breakdown')
  getBreakdown(@CurrentUser('id') userId: string, @Query() query: TrackingBreakdownQueryDto) {
    return this.trackingService.getBreakdown(userId, query.workspace_id, query.by, query);
  }

  /** Estado do snippet: eventos de hoje e o último recebido. */
  @Get('status')
  getStatus(@CurrentUser('id') userId: string, @Query() query: TrackingStatusQueryDto) {
    return this.trackingService.getStatus(userId, query.workspace_id);
  }

    /** Jornada do cliente: por criativo (último clique, contribuição, gasto, ROI). */
  @Get('journey-overview/creatives')
  getJourneyCreatives(@CurrentUser('id') userId: string, @Query() query: TrackingQueryDto) {
    return this.journeyService.getOverview(userId, query.workspace_id, query);
  }

  /** Jornada do cliente: linha do tempo por cliente. */
  @Get('journey-overview/customers')
  getJourneyCustomers(@CurrentUser('id') userId: string, @Query() query: TrackingCustomersQueryDto) {
    return this.journeyService.getCustomers(userId, query.workspace_id, query, query.q);
  }

/** Jornada do comprador de uma venda. */
  @Get('journey/:saleId')
  getJourney(
    @CurrentUser('id') userId: string,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
  ) {
    return this.trackingService.getJourney(userId, saleId);
  }
}
