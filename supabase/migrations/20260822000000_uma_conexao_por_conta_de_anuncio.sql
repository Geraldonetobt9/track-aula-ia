-- ============================================================
-- Facebook: uma conexão por conta de anúncio, não por usuário
-- ============================================================
-- A tabela nasceu em fevereiro com UNIQUE (user_id): na época era uma conexão
-- por pessoa. Depois o produto passou a guardar uma linha por conta de
-- anúncio — é o que o código faz hoje, tanto ao conectar quanto ao atualizar —
-- mas nenhuma migration derrubou a trava antiga.
--
-- O efeito: a primeira conta entrava e todas as outras batiam em
--
--   23505 duplicate key value violates unique constraint
--         "facebook_connections_user_id_key"
--
-- O token via cinco contas e o painel gravava uma. O erro ficava no log do
-- servidor, e na tela só faltava a conta.
--
-- A trava certa é (user_id, ad_account_id): a mesma conta não se repete para a
-- mesma pessoa, e continuam cabendo quantas contas o token trouxer. É também o
-- que o código já assume ao montar o mapa de existentes por ad_account_id.

ALTER TABLE public.facebook_connections
  DROP CONSTRAINT IF EXISTS facebook_connections_user_id_key;

-- Defensivo: a linha duplicada impediria a criação do índice. Não existe hoje,
-- mas a migration precisa poder rodar em qualquer cópia do banco.
DELETE FROM public.facebook_connections a
USING public.facebook_connections b
WHERE a.user_id = b.user_id
  AND a.ad_account_id = b.ad_account_id
  AND a.ctid > b.ctid;

CREATE UNIQUE INDEX IF NOT EXISTS idx_facebook_connections_user_account
  ON public.facebook_connections (user_id, ad_account_id);
