import type { IncomingMessage, ServerResponse } from 'node:http';

/**
 * GET /api/diag — funcao minima, de proposito.
 *
 * Nao importa NestJS, nem o backend, nem nada pesado. Serve para separar duas
 * hipoteses quando /api/* devolve FUNCTION_INVOCATION_FAILED:
 *
 *   diag responde 200  -> a plataforma esta ok; o problema e o boot do Nest
 *                         (variavel de ambiente faltando, ou o bundle do
 *                         backend nao chegou na funcao)
 *   diag tambem 500    -> o problema e anterior: runtime, build ou roteamento
 *
 * Reporta apenas SE cada variavel existe e o tamanho dela. Nunca o valor.
 */
export default function handler(_req: IncomingMessage, res: ServerResponse) {
  const vars = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_ANON_KEY',
    'ENCRYPTION_KEY',
    'FRONTEND_URL',
    'META_API_VERSION',
  ];

  const env: Record<string, string> = {};
  for (const name of vars) {
    const value = process.env[name];
    env[name] = value ? `presente (${value.length} chars)` : 'AUSENTE';
  }

  // As tres que sao getOrThrow no boot do Nest: faltando qualquer uma, a
  // aplicacao inteira falha ao subir, e nao so o modulo que a usa.
  const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY'];
  const faltando = obrigatorias.filter((n) => !process.env[n]);

  let backendBundle: string;
  try {
    require.resolve('../packages/backend/dist/bootstrap');
    backendBundle = 'encontrado';
  } catch (err) {
    backendBundle = `NAO ENCONTRADO — ${(err as Error).message}`;
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');
  res.end(
    JSON.stringify(
      {
        ok: faltando.length === 0,
        node: process.version,
        regiao: process.env.VERCEL_REGION ?? '(local)',
        obrigatorias_faltando: faltando,
        backend_bundle: backendBundle,
        env,
      },
      null,
      2,
    ),
  );
}
