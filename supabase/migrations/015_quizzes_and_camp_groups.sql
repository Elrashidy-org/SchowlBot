begin;

-- A lesson can have a quiz at the start and one at the end.
alter table public.course_material
  add column if not exists pre_quiz_url text,
  add column if not exists post_quiz_url text;

-- Camp groups: 4-5 students per group, optionally tied to a teacher and a chat.
create table if not exists public.camp_group (
  id uuid primary key default gen_random_uuid(),
  camp text not null,
  name text not null,
  capacity integer not null default 5,
  teacher_id uuid references public.teacher(id) on delete set null,
  chat_link text,
  discord_channel_id text,
  notes text,
  created_at timestamptz not null default now()
);
create index if not exists camp_group_camp_idx on public.camp_group(camp);
alter table public.camp_group enable row level security;

alter table public.camp_registration
  add column if not exists group_id uuid references public.camp_group(id) on delete set null;

commit;
