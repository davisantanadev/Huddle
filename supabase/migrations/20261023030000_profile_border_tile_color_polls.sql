-- Profile border (on/off + colour), the user's call tile colour and chat polls,
-- mirroring the local SQLite schema in electron/backendServer.js.

alter table public.users
  add column if not exists profile_border_enabled boolean not null default true,
  add column if not exists profile_border_color text not null default '#3f4147',
  add column if not exists call_tile_color text;

-- { question, options: [{ id, text }], votes: { optionId: [userIds] } }
alter table public.messages
  add column if not exists poll_json jsonb;
