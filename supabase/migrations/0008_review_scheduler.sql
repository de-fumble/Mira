-- Mira correction engine: Supabase's built-in scheduler carries on AI reviews
-- that are waiting to be tried again (see 0007_review_jobs.sql), so they
-- finish on their own even after the writer has closed Mira.
--
-- Every minute, pg_cron runs public.kick_review_jobs(). If any review is due
-- (and no run is already on it), it calls the app's /api/cron/reviews with
-- pg_net — otherwise it does nothing, so the app isn't called needlessly.
--
-- Needs 0007 first. Run once in Supabase → SQL Editor → New query → paste →
-- Run. Safe to re-run. Then store the app's address and the shared secret in
-- the Vault (once — the values never go in this file):
--
--   select vault.create_secret('https://YOUR-APP-ADDRESS', 'mira_app_url');
--   select vault.create_secret('THE CRON_SECRET VALUE',     'mira_cron_secret');
--
-- and set the same CRON_SECRET in the app's environment (Vercel → Settings →
-- Environment Variables).

create extension if not exists pg_cron with schema pg_catalog;
create extension if not exists pg_net with schema extensions;

create or replace function public.kick_review_jobs()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_url text;
  cron_secret text;
begin
  if not exists (
    select 1 from public.review_jobs
     where next_at <= now() and (lease_until is null or lease_until < now())
  ) then
    return;
  end if;

  select decrypted_secret into app_url from vault.decrypted_secrets where name = 'mira_app_url' limit 1;
  select decrypted_secret into cron_secret from vault.decrypted_secrets where name = 'mira_cron_secret' limit 1;
  if app_url is null or cron_secret is null then
    raise warning 'Mira review scheduler: add the mira_app_url and mira_cron_secret Vault secrets (see 0008_review_scheduler.sql).';
    return;
  end if;

  perform net.http_post(
    url := rtrim(app_url, '/') || '/api/cron/reviews',
    headers := jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || cron_secret),
    body := '{}'::jsonb,
    timeout_milliseconds := 15000
  );
end;
$$;

-- Only the scheduler runs it.
revoke all on function public.kick_review_jobs() from public, anon, authenticated;

-- Every minute (re-running this replaces the schedule with the same name).
select cron.schedule('mira-review-jobs', '* * * * *', 'select public.kick_review_jobs()');
