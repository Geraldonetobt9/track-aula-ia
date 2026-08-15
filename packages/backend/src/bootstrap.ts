import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module';

/**
 * Montagem da aplicação, compartilhada pelo servidor local (main.ts) e pela
 * função serverless da Vercel (api/index.ts).
 *
 * Existe para os dois não divergirem: quando o bootstrap estava só no main.ts,
 * qualquer header ou pipe adicionado lá não valia em produção.
 */
export async function createApp(): Promise<NestFastifyApplication> {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter(),
  );

  // Na Vercel o frontend e a API moram na mesma origem, então CORS só importa
  // em desenvolvimento, quando o Vite serve em outra porta.
  const frontendUrl = (process.env.FRONTEND_URL || 'http://localhost:5173').replace(/\/+$/, '');
  app.enableCors({ origin: frontendUrl, credentials: true });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  app.setGlobalPrefix('api', { exclude: ['health'] });

  const fastify = app.getHttpAdapter().getInstance();

  fastify.addHook('onSend', (_request: any, reply: any, _payload: any, done: () => void) => {
    reply.header('X-Content-Type-Options', 'nosniff');
    reply.header('X-Frame-Options', 'DENY');
    reply.header('X-XSS-Protection', '1; mode=block');
    reply.header('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    reply.header('X-Permitted-Cross-Domain-Policies', 'none');
    reply.header('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
    reply.header('Referrer-Policy', 'strict-origin-when-cross-origin');
    done();
  });

  await fastify.register(require('@fastify/multipart'), {
    limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 5 },
  });

  return app;
}
