-- Ether's clock: calls the app every 15 minutes so it can send notifications and refresh the morning brief.
-- Run this AFTER the app is live. Replace the two placeholders first:
--   YOUR-ETHER-URL   e.g. ether-courtney.vercel.app   (no https://)
--   YOUR-CRON-SECRET the same random value you put in Vercel as CRON_SECRET
create extension if not exists pg_cron;
create extension if not exists pg_net with schema extensions;
select cron.unschedule(jobid) from cron.job where jobname = 'ether-tick';
select cron.schedule('ether-tick', '*/15 * * * *', $$
  select net.http_post(
    url := 'https://YOUR-ETHER-URL/api/tick',
    headers := '{"Content-Type":"application/json","Authorization":"Bearer YOUR-CRON-SECRET"}'::jsonb,
    body := '{}'::jsonb,
    timeout_milliseconds := 300000
  );
$$);
