import { Module } from '@nestjs/common';
import { TrackingCollectController } from './tracking-collect.controller';
import { TrackingController } from './tracking.controller';
import { TrackingIngestService } from './tracking-ingest.service';
import { TrackingService } from './tracking.service';
import { VisitorMatchingService } from './visitor-matching.service';
import { MetaCapiModule } from '../meta-capi/meta-capi.module';

/**
 * Rastreio de visitantes: o snippet da página de vendas, a ingestão, a
 * leitura para o painel e o casamento com a venda.
 *
 * Sem fila (BullMQ/Redis): a API roda como função da Vercel, que não mantém
 * um worker de pé. A ingestão grava direto, numa chamada só ao banco, e o
 * casamento roda dentro do próprio webhook. A retenção é um job do pg_cron.
 */
@Module({
  imports: [MetaCapiModule],
  controllers: [TrackingCollectController, TrackingController],
  providers: [TrackingIngestService, TrackingService, VisitorMatchingService],
  exports: [VisitorMatchingService],
})
export class TrackingModule {}
