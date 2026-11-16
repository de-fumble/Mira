-- Mira Documents: dictate, edit and proofread documents.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

create table if not exists public.documents (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null default auth.uid()
                references auth.users (id) on delete cascade,
  title       text not null default 'Untitled document',
  content     text not null default '',
  word_count  integer not null default 0 check (word_count >= 0),

  -- Latest AI review: { score, summary, issues: [...], word_count, content_hash, analyzed_at }
  analysis    jsonb,

  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists documents_user_updated_idx
  on public.documents (user_id, updated_at desc);

-- updated_at is kept current by the trigger function from 0001_meetings.sql.
drop trigger if exists documents_set_updated_at on public.documents;
create trigger documents_set_updated_at
  before update on public.documents
  for each row execute function public.set_updated_at();

-- Row Level Security: each user sees and changes only their own documents.
alter table public.documents enable row level security;

drop policy if exists "Users read own documents"   on public.documents;
drop policy if exists "Users create own documents" on public.documents;
drop policy if exists "Users update own documents" on public.documents;
drop policy if exists "Users delete own documents" on public.documents;

create policy "Users read own documents" on public.documents
  for select to authenticated using ((select auth.uid()) = user_id);

create policy "Users create own documents" on public.documents
  for insert to authenticated with check ((select auth.uid()) = user_id);

create policy "Users update own documents" on public.documents
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create policy "Users delete own documents" on public.documents
  for delete to authenticated using ((select auth.uid()) = user_id);
