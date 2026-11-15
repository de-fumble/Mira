-- Mira: Paystack subscriptions (3-day card trial, then ₦28,800/month).
-- Run once in Supabase → SQL Editor → New query → paste → Run. Safe to re-run.

create table if not exists public.subscriptions (
  user_id              uuid primary key references auth.users (id) on delete cascade,
  -- Mira's view of the subscription:
  --   trialing      card added, free trial running (no charge yet)
  --   active        paid and renewing
  --   non_renewing  cancelled, access continues until access_until
  --   attention     Paystack couldn't take the latest payment
  --   cancelled     ended
  status               text not null check (status in ('trialing', 'active', 'non_renewing', 'attention', 'cancelled')),
  access_until         timestamptz,          -- end of the trial or the paid month
  trial_ends_at        timestamptz,
  had_trial            boolean not null default false,
  -- Paystack references
  customer_code        text,
  subscription_code    text unique,
  email_token          text,                 -- needed to cancel / resume
  authorization_code   text,                 -- reusable card token (only usable with the secret key)
  card_signature       text,                 -- same card = same signature; one free trial per card
  card_brand           text,
  card_last4           text,
  card_exp             text,                 -- "MM/YY"
  last_reference       text,                 -- last Paystack payment handled (stops double-processing)
  last_synced_at       timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

create index if not exists subscriptions_card_signature_idx on public.subscriptions (card_signature);

-- Row Level Security on, with NO policies: only the server (secret key) reads
-- or writes billing data. The app shows people their own status server-side.
alter table public.subscriptions enable row level security;

-- Admin switch: when off, Mira is free for everyone (no trial or payment needed).
insert into public.app_settings (key, enabled) values ('billing', true)
on conflict (key) do nothing;
