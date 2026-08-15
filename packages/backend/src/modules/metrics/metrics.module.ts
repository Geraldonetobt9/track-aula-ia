import { Module } from '@nestjs/common';
import { MetricsController } from './metrics.controller';
import { MetricsService } from './metrics.service';
import { LiveMetricsService } from './live-metrics.service';
import { FacebookModule } from '../facebook/facebook.module';

@Module({
  imports: [FacebookModule],
  controllers: [MetricsController],
  providers: [MetricsService, LiveMetricsService],
  exports: [MetricsService, LiveMetricsService],
})
export class MetricsModule {}
