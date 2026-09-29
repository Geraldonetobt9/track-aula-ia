import { Controller, Get, Param, ParseUUIDPipe, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../../common/guards/auth.guard';
import { CurrentUser } from '../../common/decorators/current-user.decorator';
import { TrackingService } from './tracking.service';
import {
  TrackingBreakdownQueryDto,
  TrackingQueryDto,
  TrackingStatusQueryDto,
} from './dto/tracking-query.dto';

/** Leitura do rastreio, para o painel. Tudo escopado ao dono da área. */
@Controller('tracking')
@UseGuards(AuthGuard)
export class TrackingController {
  constructor(private readonly trackingService: TrackingService) {}

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

  /** Jornada do comprador de uma venda. */
  @Get('journey/:saleId')
  getJourney(
    @CurrentUser('id') userId: string,
    @Param('saleId', new ParseUUIDPipe()) saleId: string,
  ) {
    return this.trackingService.getJourney(userId, saleId);
  }
}
