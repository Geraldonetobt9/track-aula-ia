import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';
import { createUnlabelledJsonParser } from './common/parsers/unlabelled-json.parser';

/** Route allowed to post a body without a usable Content-Type. See the parser below. */
const GTM_INGEST_PATH = '/api/gtm/events';

async function bootstrap() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  app.enableCors({
    origin: frontendUrl,
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );
  app.setGlobalPrefix('api', { exclude: ['health'] });
  const fastifyInstance = app.getHttpAdapter().getInstance();
  fastifyInstance.addHook('onSend', (_request: any, reply: any, _payload: any, done: () => void) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    done();
  });
  await fastifyInstance.register(require('fastify-raw-body'), {
    field: 'rawBody',
    encoding: 'utf8',
    runFirst: true,
    global: false,
    routes: ['/api/stripe/webhook'],
  });
  await fastifyInstance.register(require('@fastify/multipart'), {
    limits: {
      fileSize: 5 * 1024 * 1024, // 5 MB
      files: 1,
      fields: 5,
    },
  });

  // Lets the sGTM tag post without a Content-Type. See the parser for why.
  fastifyInstance.addContentTypeParser(
    '*',
    { parseAs: 'string' },
    createUnlabelledJsonParser(GTM_INGEST_PATH) as any,
  );
  const port = process.env.PORT || 3001;
  await app.listen(port, '0.0.0.0');
  console.log(`Backend running on http://localhost:${port}`);
}
bootstrap();
