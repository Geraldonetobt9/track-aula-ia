import { Module } from '@nestjs/common';
import { GtmIngestController } from './gtm-ingest.controller';
import { GtmEventsController } from './gtm-events.controller';
import { GtmIngestService } from './gtm-ingest.service';
import { GtmEventsService } from './gtm-events.service';

/**
 * Retention is not here: the 30-day purge runs as a pg_cron job in Postgres.
 * It is a pure database operation, so routing it through this service would
 * only tie the purge to this process being awake.
 */
@Module({
  controllers: [GtmIngestController, GtmEventsController],
  providers: [GtmIngestService, GtmEventsService],
})
export class GtmEventsModule {}
