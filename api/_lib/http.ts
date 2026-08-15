import type { VercelRequest, VercelResponse } from '@vercel/node';
import { db } from './supabase.js';

export type Handler = (req: VercelRequest, res: VercelResponse, ctx: Context) => Promise<unknown>;

export interface Context {
  userId: string;
  email: string;
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export const badRequest = (m: string) => new HttpError(400, m);
export const unauthorized = (m = 'Não autenticado') => new HttpError(401, m);
export const forbidden = (m = 'Sem acesso') => new HttpError(403, m);
export const notFound = (m = 'Não encontrado') => new HttpError(404, m);

/**
 * Valida o token do usuário e confirma que ele está ativo em app_users.
 *
 * A validação é server-side via auth.getUser(): decodificar o JWT no cliente
 * não detecta sessão revogada, e é justamente esse o caso que importa quando
 * alguém perde o acesso.
 */
async function authenticate(req: VercelRequest): Promise<Context> {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) throw unauthorized();

  const { data, error } = await db().auth.getUser(header.slice(7));
  if (error || !data.user) throw unauthorized('Sessão inválida ou expirada');

  // Estar no Supabase Auth não basta: a pessoa precisa estar liberada aqui.
  const { data: allowed } = await db()
    .from('app_users')
    .select('user_id, email')
    .eq('user_id', data.user.id)
    .eq('is_active', true)
    .maybeSingle();

  if (!allowed) throw forbidden('Este usuário não tem acesso ao dashboard');

  return { userId: allowed.user_id, email: allowed.email };
}

/**
 * Envelopa um handler: valida método, autentica, trata erro e responde JSON.
 * Todo endpoint privado passa por aqui — é o que garante que nenhum esqueça
 * a checagem de acesso.
 */
export function protectedRoute(methods: string[], handler: Handler) {
  return async (req: VercelRequest, res: VercelResponse) => {
    res.setHeader('Cache-Control', 'no-store');

    if (!methods.includes(req.method ?? '')) {
      return res.status(405).json({ error: `Método ${req.method} não permitido` });
    }

    try {
      const ctx = await authenticate(req);
      const body = await handler(req, res, ctx);
      if (!res.writableEnded) res.status(200).json(body ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) {
        return res.status(err.status).json({ error: err.message });
      }
      // Nunca devolve a mensagem crua de um erro inesperado: ela pode conter
      // detalhe de conexão, nome de coluna ou trecho de query.
      console.error('Erro não tratado:', err);
      return res.status(500).json({ error: 'Erro interno' });
    }
  };
}

/** Para rotas públicas (webhooks, health). Sem autenticação, com tratamento de erro. */
export function publicRoute(methods: string[], handler: (req: VercelRequest, res: VercelResponse) => Promise<unknown>) {
  return async (req: VercelRequest, res: VercelResponse) => {
    if (!methods.includes(req.method ?? '')) {
      return res.status(405).json({ error: `Método ${req.method} não permitido` });
    }
    try {
      const body = await handler(req, res);
      if (!res.writableEnded) res.status(200).json(body ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return res.status(err.status).json({ error: err.message });
      console.error('Erro não tratado:', err);
      return res.status(500).json({ error: 'Erro interno' });
    }
  };
}
