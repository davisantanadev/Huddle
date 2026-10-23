-- Profile theme (optional gradient on the profile card) and recently played games,
-- mirroring the local SQLite schema in electron/backendServer.js.
-- RLS on with no policies: only the backend (service role) reaches these rows.

alter table public.users
  add column if not exists profile_theme_enabled boolean not null default false,
  add column if not exists profile_theme_primary text not null default '#5865f2',
  add column if not exists profile_theme_accent text not null default '#eb459e';

create table if not exists public.user_activities (
  user_id text not null references public.users(id) on delete cascade,
  game_id text not null,
  name text not null,
  first_played_at bigint not null,
  last_played_at bigint not null,
  total_seconds integer not null default 0,
  playing_since bigint,
  primary key (user_id, game_id)
);
create index if not exists user_activities_recent_idx on public.user_activities (user_id, last_played_at desc);

alter table public.user_activities enable row level security;
