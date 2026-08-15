import { ExceptionFilter, Catch, ArgumentsHost, HttpException, HttpStatus, Logger, Inject, Optional } from '@nestjs/common';
import { FastifyReply, FastifyRequest } from 'fastify';
import { DiscordLoggerService } from '../../shared/services/discord-logger.service';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  constructor(
    @Optional() @Inject(DiscordLoggerService)
    private readonly discordLogger?: DiscordLoggerService,
  ) {}

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const reply = ctx.getResponse<FastifyReply>();
    const request = ctx.getRequest<FastifyRequest>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let message = 'Internal server error';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const response = exception.getResponse();
      message = typeof response === 'string' ? response : (response as any).message || message;
    } else if (exception instanceof Error) {
      // Log full error server-side, return generic message to client
      this.logger.error(`Unhandled exception: ${exception.message}`, exception.stack);
    }

    // Discord log for 5xx errors
    if (status >= 500 && this.discordLogger) {
      const route = request
        ? `${request.method} ${request.url}`
        : 'unknown';
      const userEmail = (request as any)?.user?.email || null;

      this.discordLogger.logApiError({
        route,
        statusCode: status,
        errorMessage: exception instanceof Error ? exception.message : message,
        userEmail,
      });
    }

    reply.status(status).send({ error: message, statusCode: status });
  }
}
