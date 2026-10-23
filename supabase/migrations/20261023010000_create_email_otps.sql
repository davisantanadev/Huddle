-- One-time e-mail verification codes issued by the email-otp Edge Function.
-- Only the function (service role) touches this table: RLS on, no policies.
create table if not exists public.email_otps (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  attempts int not null default 0,
  consumed boolean not null default false,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists email_otps_email_created_idx on public.email_otps (email, created_at desc);
create index if not exists email_otps_created_idx on public.email_otps (created_at);

alter table public.email_otps enable row level security;
revoke all on public.email_otps from anon, authenticated;
