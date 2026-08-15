import type { IncomingMessage, ServerResponse } from 'node:http';
// Importa o JS COMPILADO, nao o fonte. O esbuild da Vercel nao emite
// emitDecoratorMetadata, e sem esse metadata a injecao de dependencia do
// NestJS quebra em tempo de execucao. O nest build (tsc) emite; por isso o
// buildCommand compila o backend antes.
import { createApp } from '../packages/backend/dist/bootstrap';

/**
 * A aplicacao NestJS inteira dentro de uma funcao serverless.
 *
 * Alternativa a reescrever os 19 modulos como handlers avulsos: o Nest sobe
 * uma vez e e reaproveitado enquanto a instancia estiver quente. So a primeira
 * requisicao depois de um periodo ocioso paga o boot.
 *
 * A promise e guardada (e nao a app pronta) de proposito: duas requisicoes
 * simultaneas numa instancia fria pegam a MESMA promise em vez de dispararem
 * dois boots concorrentes.
 */
let appPromise: Promise<{ emit: (req: any, res: any) => void }> | null = null;

async function getApp() {
  const app = await createApp();
  await app.init();

  const fastify = app.getHttpAdapter().getInstance();
  await fastify.ready();

  return {
    emit: (req: any, res: any) => fastify.server.emit('request', req, res),
  };
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  if (!appPromise) appPromise = getApp();

  try {
    const app = await appPromise;
    app.emit(req, res);
  } catch (error) {
    // Boot falhou: descarta o cache para a proxima requisicao tentar de novo,
    // em vez de servir uma promise rejeitada para sempre.
    appPromise = null;
    console.error('Falha ao iniciar a aplicacao:', error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Erro interno' }));
  }
}
