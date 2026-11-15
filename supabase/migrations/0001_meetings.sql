-- Mira MVP schema: meetings + private audio storage.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run (uses IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS).

-- ─────────────────────────────────────────────────────────────
-- Meetings
-- ─────────────────────────────────────────────────────────────
create table if not exists public.meetings (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null default auth.uid()
                     references auth.users (id) on delete cascade,
  title            text not null default 'Untitled meeting',
  status           text not null default 'recording'
                     check (status in ('recording', 'processing', 'ready', 'failed')),
  started_at       timestamptz not null default now(),
  ended_at         timestamptz,
  duration_seconds integer check (duration_seconds >= 0),

  -- Path inside the "recordings" bucket, e.g. "<user_id>/<meeting_id>.webm"
  audio_path       text,

  -- Speaker-labelled segments from speech-to-text:
  -- [{ "speaker": 0, "start": 1.2, "end": 4.8, "text": "..." }, ...]
  transcript       jsonb not null default '[]'::jsonb,
  -- Plain text copy, for search and for sending to the summariser.
  transcript_text  text,

  -- Output of the AI summary step:
  -- { "summary": "...", "decisions": [...], "action_items": [{ "task": "...", "owner": "..." }] }
  summary          jsonb,

  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create index if not exists meetings_user_started_idx
  on public.meetings (user_id, started_at desc);

-- Full-text search over transcripts.
create index if not exists meetings_transcript_search_idx
  on public.meetings using gin (to_tsvector('english', coalesce(transcript_text, '')));

-- Keep updated_at current.
create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists meetings_set_updated_at on public.meetings;
create trigger meetings_set_updated_at
  before update on public.meetings
  for each row execute function public.set_updated_at();

-- Row Level Security: each user sees and changes only their own meetings.
alter table public.meetings enable row level security;

drop policy if exists "Users read own meetings"   on public.meetings;
drop policy if exists "Users create own meetings" on public.meetings;
drop policy if exists "Users update own meetings" on public.meetings;
drop policy if exists "Users delete own meetings" on public.meetings;

create policy "Users read own meetings" on public.meetings
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users create own meetings" on public.meetings
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update own meetings" on public.meetings
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own meetings" on public.meetings
  for delete to authenticated using ((select auth.uid()) = user_id);

-- ─────────────────────────────────────────────────────────────
-- Audio storage: private bucket, one folder per user
-- ─────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'recordings',
  'recordings',
  false,
  524288000, -- 500 MB (~ several hours of compressed audio)
  array['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']
)
on conflict (id) do nothing;

drop policy if exists "Users read own recordings"   on storage.objects;
drop policy if exists "Users upload own recordings" on storage.objects;
drop policy if exists "Users delete own recordings" on storage.objects;

create policy "Users read own recordings" on storage.objects
  for select to authenticated
  using (bucket_id = 'recordings'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users upload own recordings" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'recordings'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

create policy "Users delete own recordings" on storage.objects
  for delete to authenticated
  using (bucket_id = 'recordings'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
