-- ============================================================
-- DIAGNÓSTICO — por que o dashboard está zerado
-- ============================================================
-- Rode no SQL Editor e me mande o resultado das DUAS consultas.
--
-- A primeira mostra onde a esteira parou. Ela vai do token até o número na
-- tela, e a primeira linha com 0 é o ponto de parada:
--
--   token conectado -> contas ativas -> campanhas -> anúncios -> métricas
--
-- Se "contas ATIVAS" for 0, o sync não tem o que buscar: as contas foram
-- descobertas mas nenhuma foi ligada na tela de Integrações.

SELECT 'conexoes do Facebook'        AS etapa, count(*)::text AS qtd FROM public.facebook_connections
UNION ALL SELECT 'conexoes ATIVAS',   count(*)::text FROM public.facebook_connections WHERE is_active
UNION ALL SELECT 'conexoes validas',  count(*)::text FROM public.facebook_connections WHERE is_valid
UNION ALL SELECT 'campanhas',         count(*)::text FROM public.campaigns
UNION ALL SELECT 'conjuntos',         count(*)::text FROM public.ad_sets
UNION ALL SELECT 'anuncios',          count(*)::text FROM public.ads
UNION ALL SELECT 'linhas de gasto diario', count(*)::text FROM public.daily_ad_spend
UNION ALL SELECT 'gasto total registrado', COALESCE(SUM(spend), 0)::text FROM public.daily_ad_spend
UNION ALL SELECT 'periodo com gasto',
  COALESCE(MIN(date)::text || ' ate ' || MAX(date)::text, '(nenhum)') FROM public.daily_ad_spend
UNION ALL SELECT 'gasto HOJE',
  COALESCE((SELECT SUM(spend)::text FROM public.daily_ad_spend WHERE date = CURRENT_DATE), '0')
UNION ALL SELECT 'vendas',            count(*)::text FROM public.sales
UNION ALL SELECT 'integracoes de checkout', count(*)::text FROM public.checkout_integrations;

-- ------------------------------------------------------------
-- O que aconteceu nas ultimas sincronizacoes
-- ------------------------------------------------------------
-- status 'processing' parado ha muito tempo = o trabalho morreu no meio, que
-- era o bug do fire-and-forget em serverless.
-- status 'failed' = o erro real fica na coluna error, e e ele que interessa.
SELECT
  job_type,
  status,
  progress,
  error,
  created_at,
  updated_at
FROM public.processing_jobs
ORDER BY created_at DESC
LIMIT 10;
