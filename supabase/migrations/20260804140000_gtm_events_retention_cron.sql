-- Retention for gtm_events: 30 days, purged daily.
--
-- Runs as a pg_cron job rather than a @Cron in the NestJS backend. The delete
-- is a pure database operation — routing it through an application server buys
-- nothing and ties the purge to that service being awake. It also keeps the
-- whole GTM ingestion path (Edge Function + this job) independent of Render.
--
-- 04:00 UTC is 01:00 in São Paulo, the quietest window for this workload.
--
-- Uses the BRIN index on created_at. PageView is the highest-volume event
-- stored, so this job is the only thing keeping the table bounded.

CREATE EXTENSION IF NOT EXISTS pg_cron;

-- cron.schedule upserts by job name, so re-running this migration reschedules
-- the existing job instead of creating a duplicate.
SELECT cron.schedule(
  'gtm-events-retention',
  '0 4 * * *',
  $$DELETE FROM public.gtm_events WHERE created_at < now() - interval '30 days'$$
);
