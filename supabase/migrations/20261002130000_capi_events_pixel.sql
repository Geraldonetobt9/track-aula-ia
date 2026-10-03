-- ============================================================
-- Pixel de cada envio à CAPI
-- ============================================================
-- A lista "Últimos eventos" mostra o pixel que recebeu cada envio. Antes
-- ele não era gravado: a lista usava o pixel configurado na área, que
-- muda para todos os envios quando o pixel é trocado.
--
-- Os envios que já estão na tabela (no máximo 10 dias, pela retenção)
-- recebem o pixel configurado hoje na área: é o melhor palpite disponível.
ALTER TABLE public.capi_events ADD COLUMN IF NOT EXISTS pixel_id TEXT;

UPDATE public.capi_events e
SET pixel_id = w.meta_pixel_id
FROM public.workspaces w
WHERE e.workspace_id = w.id
  AND e.pixel_id IS NULL
  AND w.meta_pixel_id IS NOT NULL;
