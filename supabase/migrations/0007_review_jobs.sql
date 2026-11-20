-- Mira correction engine: reviews that are still going. When every AI model is
-- busy or slow, a review doesn't fail — it saves how far it got here (the
-- document's context and each part already checked) and carries on from that
-- point a little later, until it finishes. The row is deleted when it does.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

create table if not exists public.review_jobs (
  document_id uuid primary key references public.documents (id) on delete cascade,
  user_id     uuid not null default auth.uid() references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  -- a run is working on it until then (so two runs never check the same document at once)
  lease_until timestamptz,
  -- when it should next be tried
  next_at     timestamptz not null default now(),
  -- how many times it has had to wait
  rounds      integer not null default 0 check (rounds >= 0),
  -- where it stopped: { stage, done, total, brief, parts: { <part hash>: flags } }
  state       jsonb not null default '{}'::jsonb
);

create index if not exists review_jobs_next_idx on public.review_jobs (next_at);

-- Row Level Security: each user sees and changes only the reviews of their own documents.
alter table public.review_jobs enable row level security;

drop policy if exists "Users read own review jobs"   on public.review_jobs;
drop policy if exists "Users create own review jobs" on public.review_jobs;
drop policy if exists "Users update own review jobs" on public.review_jobs;
drop policy if exists "Users delete own review jobs" on public.review_jobs;

create policy "Users read own review jobs" on public.review_jobs
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users create own review jobs" on public.review_jobs
  for insert to authenticated with check (
    (select auth.uid()) = user_id
    and exists (select 1 from public.documents d where d.id = document_id and d.user_id = (select auth.uid()))
  );

create policy "Users update own review jobs" on public.review_jobs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own review jobs" on public.review_jobs
  for delete to authenticated using ((select auth.uid()) = user_id);

-- Takes a document's review for one run: starts one if there's none, or picks
-- up the saved one if no other run holds it. Returns nothing while another run
-- is working on it. Runs as the caller, so Row Level Security still applies.
create or replace function public.claim_review_job(doc uuid, lease_seconds integer)
returns setof public.review_jobs
language sql
security invoker
set search_path = ''
as $$
  insert into public.review_jobs as j (document_id, lease_until)
  values (doc, now() + make_interval(secs => lease_seconds))
  on conflict (document_id) do update
     set lease_until = excluded.lease_until,
         updated_at  = now()
   where j.lease_until is null or j.lease_until < now()
  returning j.*;
$$;

revoke all on function public.claim_review_job(uuid, integer) from public, anon;
grant execute on function public.claim_review_job(uuid, integer) to authenticated;
