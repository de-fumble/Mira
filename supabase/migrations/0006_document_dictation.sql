-- Mira Documents: how much of each document was dictated, and how long the
-- talking took — for "dictated in 2 min · typing would take ~8 min".
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

alter table public.documents
  add column if not exists dictated_words    integer not null default 0 check (dictated_words >= 0),
  add column if not exists dictation_seconds integer not null default 0 check (dictation_seconds >= 0);

-- Adds one dictation to a document's totals in a single step. Runs as the
-- caller, so Row Level Security still limits it to their own documents.
create or replace function public.add_document_dictation(doc uuid, words integer, secs integer)
returns void
language sql
security invoker
set search_path = ''
as $$
  update public.documents
     set dictated_words    = dictated_words + greatest(words, 0),
         dictation_seconds = dictation_seconds + greatest(secs, 0)
   where id = doc;
$$;

revoke all on function public.add_document_dictation(uuid, integer, integer) from public, anon;
grant execute on function public.add_document_dictation(uuid, integer, integer) to authenticated;
