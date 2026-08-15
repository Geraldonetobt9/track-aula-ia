import { Body, Controller, Headers, Logger, Post, Res } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { FastifyReply } from 'fastify';
import { GtmIngestService } from './gtm-ingest.service';

/**
 * Ingestion is far more frequent than any user-facing route, and every event
 * arrives from the same sGTM container IP — the global 60/min limit would
 * throttle a single busy page. Batching keeps this generous ceiling from
 * mattering in practice.
 */
const INGEST_RATE_LIMIT = { default: { limit: 1200, ttl: 60_000 } };

/**
 * Public endpoint for the server-side GTM container.
 *
 * Deliberately separate from GtmEventsController: that one is behind AuthGuard
 * and the allowlist, this one authenticates with a workspace token. Keeping
 * them apart means a route added to either can't silently inherit the wrong
 * protection.
 */
@Controller('gtm')
export class GtmIngestController {
  private readonly logger = new Logger(GtmIngestController.name);

  constructor(private readonly ingestService: GtmIngestService) {}

  /**
   * Accepts one event or an array of them.
   *
   * Always answers 200, even on an invalid token or a failed write (RN-07):
   * sGTM retries on error responses, and retrying our own failure would just
   * multiply load without ever succeeding. `received` tells the operator what
   * actually landed.
   */
  @Post('events')
  @Throttle(INGEST_RATE_LIMIT)
  async ingest(
    @Headers('x-sentinela-token') token: string | undefined,
    @Body() body: unknown,
    @Res() res: FastifyReply,
  ): Promise<void> {
    try {
      const received = await this.ingestService.ingest(token, body);
      res.status(200).send({ received });
    } catch (error: any) {
      this.logger.error(`GTM ingestion error: ${error?.message}`, error?.stack);
      res.status(200).send({ received: 0 });
    }
  }
}
