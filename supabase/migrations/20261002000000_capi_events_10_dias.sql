-- ============================================================
-- Envios à CAPI ("Últimos eventos") apagados aos 10 dias
-- ============================================================
-- Antes: 30 dias (PageView/InitiateCheckout) e 180 dias (Purchase). Agora
-- todos aos 10 dias, para a tabela capi_events não crescer.
--
-- A linha do Purchase também é a trava contra Purchase duplicado (unicidade
-- área + nome + event_id): uma plataforma que reentregar o mesmo webhook
-- depois de 10 dias mandaria o Purchase de novo. As plataformas reentregam
-- em horas ou poucos dias, e o reenvio de falhas só olha os últimos 7 dias.
--
-- cron.schedule atualiza o job pelo nome: o corpo inteiro vai de novo, com
-- as outras regras de retenção iguais.
DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS pg_cron;
  PERFORM cron.schedule(
    'tracking-retention',
    '30 4 * * *',
    $job$
      DELETE FROM public.tracking_events WHERE occurred_at < now() - interval '90 days';
      UPDATE public.tracking_sessions SET ip_address = NULL
        WHERE ip_address IS NOT NULL AND started_at < now() - interval '90 days';
      DELETE FROM public.tracking_sessions WHERE sale_id IS NULL AND started_at < now() - interval '1 year';
      DELETE FROM public.capi_events WHERE created_at < now() - interval '10 days';
    $job$
  );
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron indisponivel, expurgo nao agendado (%).', SQLERRM;
END;
$$;

-- Limpa já o que passou dos 10 dias, sem esperar a madrugada.
DELETE FROM public.capi_events WHERE created_at < now() - interval '10 days';
