-- Mira correction engine log: one row per AI document review, for the admin
-- dashboard. Holds numbers only — never the document's text or title.
-- Run once in Supabase → SQL Editor → New query → paste → Run.
-- Safe to re-run.

create table if not exists public.review_runs (
  id              uuid primary key default gen_random_uuid(),
  created_at      timestamptz not null default now(),
  user_id         uuid references auth.users (id) on delete set null,
  document_id     uuid references public.documents (id) on delete set null,
  -- true for "Run a test review" from the admin dashboard
  is_test         boolean not null default false,

  -- ok | busy (every model busy or out of quota) | failed | unavailable (no key / key rejected)
  outcome         text not null check (outcome in ('ok', 'busy', 'failed', 'unavailable')),
  -- the model that answered (null if none did)
  model           text,
  -- every model tried, in order: [{ model, result, ms }]
  attempts        jsonb not null default '[]'::jsonb,
  duration_ms     integer not null default 0,

  words           integer not null default 0,
  issues          integer,
  -- { spelling, grammar, unclear, off_topic }
  issue_types     jsonb,
  score           integer,

  input_tokens    integer,
  output_tokens   integer,
  thinking_tokens integer,
  error           text
);

create index if not exists review_runs_created_idx on public.review_runs (created_at desc);

-- Only the server (secret key) reads and writes this table: Row Level Security
-- is on with no policies, so signed-in users can't see it.
alter table public.review_runs enable row level security;
