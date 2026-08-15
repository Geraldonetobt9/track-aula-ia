import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * GET /api/diag — a funcao mais simples possivel.
 *
 * Nao importa NestJS, nao toca no banco, nao usa require dinamico. Se ESTA
 * falha, o problema nao esta em nenhum codigo nosso: esta no build ou no
 * runtime da funcao.
 *
 * Reporta apenas SE cada variavel existe e o tamanho dela. Nunca o valor.
 */
export default function handler(_req: VercelRequest, res: VercelResponse) {
  const nomes = [
    'SUPABASE_URL',
    'SUPABASE_SERVICE_ROLE_KEY',
    'SUPABASE_JWT_SECRET',
    'SUPABASE_ANON_KEY',
    'ENCRYPTION_KEY',
    'FRONTEND_URL',
  ];

  const env: Record<string, string> = {};
  for (const nome of nomes) {
    const valor = process.env[nome];
    env[nome] = valor ? `presente (${valor.length} chars)` : 'AUSENTE';
  }

  // As tres que o Nest exige no boot: faltando qualquer uma, a aplicacao
  // inteira nao sobe — nao apenas o modulo que a usa.
  const obrigatorias = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ENCRYPTION_KEY'];

  res.status(200).json({
    ok: true,
    node: process.version,
    regiao: process.env.VERCEL_REGION ?? '(local)',
    commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? '(desconhecido)',
    faltando: obrigatorias.filter((n) => !process.env[n]),
    env,
  });
}
