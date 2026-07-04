begin;

-- Dynamic Discord channel configuration.
-- Lets admins assign a Discord channel to a named purpose from inside Discord,
-- instead of hardcoding channel IDs in environment variables.
create table if not exists public.discord_channel_config (
  id bigserial primary key,
  guild_id text not null,
  purpose text not null,
  channel_id text not null,
  channel_name text,
  configured_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (guild_id, purpose)
);

create index if not exists discord_channel_config_purpose_idx
  on public.discord_channel_config(purpose);

alter table public.discord_channel_config enable row level security;

commit;
