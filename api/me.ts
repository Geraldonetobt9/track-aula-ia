import { protectedRoute } from './_lib/http.js';

/** GET /api/me — confirma a sessao e devolve quem esta logado. */
export default protectedRoute(['GET'], async (_req, _res, ctx) => ({
  user_id: ctx.userId,
  email: ctx.email,
}));
