-- Mira: feature switches controlled from the admin dashboard.
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

create table if not exists public.app_settings (
  key         text primary key,
  enabled     boolean not null default true,
  updated_at  timestamptz not null default now(),
  updated_by  text
);

-- Row Level Security on, with NO policies: signed-in users and visitors can't
-- read or change these at all. Only the server (secret key) can.
alter table public.app_settings enable row level security;

insert into public.app_settings (key, enabled) values
  ('signups', true),
  ('recording', true),
  ('ai_notes', true),
  ('audio_storage', true),
  ('maintenance', false)
on conflict (key) do nothing;
