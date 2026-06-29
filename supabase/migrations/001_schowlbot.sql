begin;

create extension if not exists pgcrypto;
create extension if not exists btree_gist;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'lead_status') then
    create type public.lead_status as enum (
      'new',
      'contacted',
      'trial_booked',
      'trial_done',
      'converted',
      'not_fit',
      'lost'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'bot_role') then
    create type public.bot_role as enum (
      'owner',
      'admin',
      'team_lead',
      'sales',
      'teacher'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'teacher_status') then
    create type public.teacher_status as enum (
      'pending',
      'active',
      'inactive',
      'rejected'
    );
  end if;

  if not exists (select 1 from pg_type where typname = 'automation_status') then
    create type public.automation_status as enum (
      'pending',
      'running',
      'done',
      'failed',
      'cancelled'
    );
  end if;
end $$;

do $$
begin
  if exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client'
      and column_name = 'trial _lesson'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'client'
      and column_name = 'trial_lesson'
  ) then
    alter table public.client rename column "trial _lesson" to trial_lesson;
  end if;
end $$;

create table if not exists public.bot_user (
  id uuid primary key default gen_random_uuid(),
  discord_user_id text not null unique,
  display_name text,
  email text,
  phone text,
  timezone text not null default 'Africa/Cairo',
  teacher_id uuid,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.bot_user_role (
  id bigserial primary key,
  bot_user_id uuid not null references public.bot_user(id) on delete cascade,
  role public.bot_role not null,
  created_at timestamptz not null default now(),
  unique (bot_user_id, role)
);

alter table public.client
  add column if not exists lead_id uuid,
  add column if not exists status public.lead_status not null default 'new',
  add column if not exists trial_lesson boolean not null default false,
  add column if not exists phone_raw text,
  add column if not exists phone_e164 text,
  add column if not exists country_iso char(2),
  add column if not exists preferred_contact text,
  add column if not exists consent_contact boolean not null default false,
  add column if not exists privacy_policy_accepted boolean not null default false,
  add column if not exists first_touch_utm jsonb not null default '{}'::jsonb,
  add column if not exists latest_touch_utm jsonb not null default '{}'::jsonb,
  add column if not exists active boolean not null default true;

alter table public.teacher
  add column if not exists status public.teacher_status not null default 'pending',
  add column if not exists active boolean not null default false,
  add column if not exists discord_user_id text unique,
  add column if not exists timezone text not null default 'Africa/Cairo',
  add column if not exists max_daily_lessons integer not null default 4,
  add column if not exists max_weekly_lessons integer not null default 15,
  add column if not exists min_notice_hours integer not null default 12,
  add column if not exists auto_assign_enabled boolean not null default true,
  add column if not exists deactivated_at timestamptz,
  add column if not exists notes text;

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'bot_user'
      and constraint_name = 'bot_user_teacher_id_fkey'
  ) then
    alter table public.bot_user
      add constraint bot_user_teacher_id_fkey
      foreign key (teacher_id) references public.teacher(id) on delete set null;
  end if;
end $$;

create table if not exists public.teacher_onboarding (
  id uuid primary key default gen_random_uuid(),
  bot_user_id uuid not null references public.bot_user(id) on delete cascade,
  discord_user_id text not null,
  full_name text not null,
  email text not null,
  phone text,
  timezone text not null default 'Africa/Cairo',
  status public.teacher_status not null default 'pending',
  reviewed_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  reviewed_at timestamptz,
  rejection_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (discord_user_id)
);

alter table public.teacher_course
  add column if not exists course_uuid uuid references public.courses(id),
  add column if not exists active boolean not null default true,
  add column if not exists created_at timestamptz not null default now();

create table if not exists public.teacher_course_responsibility (
  id bigserial primary key,
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  course_id uuid not null references public.courses(id) on delete cascade,
  can_teach_trial boolean not null default true,
  can_teach_paid boolean not null default true,
  min_lesson_number integer not null default 0,
  max_lesson_number integer,
  priority integer not null default 100,
  active boolean not null default true,
  assigned_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (teacher_id, course_id)
);

create table if not exists public.teacher_availability (
  id bigserial primary key,
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  timezone text not null default 'Africa/Cairo',
  active boolean not null default true,
  created_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);

create table if not exists public.teacher_time_off (
  id bigserial primary key,
  teacher_id uuid not null references public.teacher(id) on delete cascade,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  created_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  created_at timestamptz not null default now(),
  check (starts_at < ends_at)
);

alter table public.lesson
  add column if not exists lead_id uuid,
  add column if not exists course_uuid uuid references public.courses(id),
  add column if not exists scheduled_at timestamptz,
  add column if not exists ends_at timestamptz,
  add column if not exists duration_minutes integer not null default 60,
  add column if not exists lesson_type text not null default 'trial',
  add column if not exists meeting_url text,
  add column if not exists assigned_at timestamptz,
  add column if not exists assigned_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  add column if not exists notes text;

create table if not exists public.client_lead (
  id uuid primary key default gen_random_uuid(),
  lead_type text not null default 'free_trial',
  status public.lead_status not null default 'new',
  parent_name text not null,
  child_name text not null,
  child_age smallint not null check (child_age between 8 and 18),
  phone_raw text not null,
  phone_e164 text not null,
  country_iso char(2) not null,
  country_name text not null,
  language text not null default 'en' check (language in ('en', 'ar')),
  landing_page text,
  preferred_contact text not null default 'phone',
  consent_contact boolean not null,
  privacy_policy_accepted boolean not null,
  email text,
  course_interest text,
  quiz_answers jsonb not null default '{}'::jsonb,
  quiz_recommendation text,
  first_touch_utm jsonb not null default '{}'::jsonb,
  latest_touch_utm jsonb not null default '{}'::jsonb,
  referrer text,
  source_url text,
  assigned_sales_user_id uuid references public.bot_user(id) on delete set null,
  last_contacted_at timestamptz,
  next_follow_up_at timestamptz,
  notes text,
  dedupe_key text not null unique,
  duplicate_of uuid references public.client_lead(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'client'
      and constraint_name = 'client_lead_id_fkey'
  ) then
    alter table public.client
      add constraint client_lead_id_fkey
      foreign key (lead_id) references public.client_lead(id) not valid;
  end if;

  if not exists (
    select 1
    from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'lesson'
      and constraint_name = 'lesson_lead_id_fkey'
  ) then
    alter table public.lesson
      add constraint lesson_lead_id_fkey
      foreign key (lead_id) references public.client_lead(id) not valid;
  end if;
end $$;

create table if not exists public.lead_activity (
  id bigserial primary key,
  lead_id uuid not null references public.client_lead(id) on delete cascade,
  actor_bot_user_id uuid references public.bot_user(id) on delete set null,
  activity_type text not null,
  old_status public.lead_status,
  new_status public.lead_status,
  note text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.discord_notification (
  id bigserial primary key,
  entity_type text not null check (entity_type in ('lead', 'lesson', 'teacher')),
  entity_id text not null,
  guild_id text not null,
  channel_id text not null,
  message_id text not null,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (entity_type, entity_id, channel_id)
);

create table if not exists public.communication_template (
  key text primary key,
  channel text not null check (channel in ('email', 'whatsapp')),
  language text not null default 'en' check (language in ('en', 'ar')),
  subject text,
  body text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.communication_log (
  id bigserial primary key,
  lead_id uuid references public.client_lead(id) on delete set null,
  client_id bigint references public.client(id) on delete set null,
  channel text not null check (channel in ('email', 'whatsapp', 'discord')),
  template_key text,
  recipient text,
  status text not null default 'queued',
  provider_message_id text,
  sent_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  error_message text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table if not exists public.automation_job (
  id bigserial primary key,
  job_type text not null,
  lead_id uuid references public.client_lead(id) on delete cascade,
  lesson_id bigint references public.lesson(id) on delete cascade,
  run_at timestamptz not null,
  status public.automation_status not null default 'pending',
  attempts integer not null default 0,
  last_error text,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.course_material (
  id bigserial primary key,
  course_id uuid not null references public.courses(id) on delete cascade,
  lesson_number integer not null check (lesson_number >= 0),
  title_en text not null,
  title_ar text,
  description text,
  resource_url text,
  attachment_url text,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (course_id, lesson_number)
);

create table if not exists public.teacher_material_request (
  id bigserial primary key,
  teacher_id uuid references public.teacher(id) on delete set null,
  bot_user_id uuid references public.bot_user(id) on delete set null,
  course_id uuid references public.courses(id) on delete set null,
  lesson_number integer not null,
  fulfilled_material_id bigint references public.course_material(id) on delete set null,
  created_at timestamptz not null default now()
);

create unique index if not exists teacher_course_unique_active_uuid_idx
  on public.teacher_course(teacher_id, course_uuid)
  where course_uuid is not null and active = true;

create index if not exists client_lead_status_followup_idx
  on public.client_lead(status, next_follow_up_at);

create index if not exists client_lead_phone_created_idx
  on public.client_lead(phone_e164, created_at desc);

create index if not exists teacher_availability_teacher_idx
  on public.teacher_availability(teacher_id, day_of_week);

create index if not exists teacher_time_off_teacher_idx
  on public.teacher_time_off(teacher_id, starts_at, ends_at);

create index if not exists lesson_teacher_schedule_idx
  on public.lesson(teacher_id, scheduled_at, ends_at);

create index if not exists lesson_lead_idx
  on public.lesson(lead_id);

create or replace view public.teacher_active_lesson_load as
select
  t.id as teacher_id,
  t.name,
  t.discord_user_id,
  t.status,
  t.active,
  coalesce(count(l.id) filter (
    where lower(l.status) in ('pending', 'scheduled')
      and l.scheduled_at >= now() - interval '30 days'
  ), 0) as active_lesson_count,
  coalesce(count(l.id) filter (
    where lower(l.status) = 'completed'
  ), 0) as completed_lesson_count,
  coalesce(t.total_lessons, 0) as stored_total_lessons
from public.teacher t
left join public.lesson l on l.teacher_id = t.id
group by t.id, t.name, t.discord_user_id, t.status, t.active, t.total_lessons;

create or replace function public.teacher_is_available(
  p_teacher_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer default 60
)
returns boolean
language sql
stable
as $$
  select exists (
    select 1
    from public.teacher_availability a
    where a.teacher_id = p_teacher_id
      and a.active = true
      and a.day_of_week = extract(dow from (p_starts_at at time zone a.timezone))::smallint
      and a.start_time <= (p_starts_at at time zone a.timezone)::time
      and a.end_time >= ((p_starts_at + make_interval(mins => p_duration_minutes)) at time zone a.timezone)::time
  )
  and not exists (
    select 1
    from public.teacher_time_off o
    where o.teacher_id = p_teacher_id
      and tstzrange(o.starts_at, o.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes), '[)')
  )
  and not exists (
    select 1
    from public.lesson l
    where l.teacher_id = p_teacher_id
      and lower(l.status) in ('pending', 'scheduled')
      and l.scheduled_at is not null
      and l.ends_at is not null
      and tstzrange(l.scheduled_at, l.ends_at, '[)') &&
          tstzrange(p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes), '[)')
  );
$$;

create or replace function public.pick_trial_teacher(
  p_course_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer default 60
)
returns uuid
language sql
stable
as $$
  select t.id
  from public.teacher t
  join public.teacher_course_responsibility r
    on r.teacher_id = t.id
   and r.course_id = p_course_id
   and r.active = true
   and r.can_teach_trial = true
  left join public.teacher_active_lesson_load load
    on load.teacher_id = t.id
  where t.active = true
    and t.status = 'active'
    and t.auto_assign_enabled = true
    and public.teacher_is_available(t.id, p_starts_at, p_duration_minutes)
  order by
    coalesce(load.active_lesson_count, 0) asc,
    coalesce(load.stored_total_lessons, 0) asc,
    r.priority asc,
    t.created_at asc
  limit 1;
$$;

alter table public.client_lead enable row level security;
alter table public.client enable row level security;
alter table public.lead_activity enable row level security;
alter table public.discord_notification enable row level security;
alter table public.communication_log enable row level security;
alter table public.automation_job enable row level security;
alter table public.communication_template enable row level security;
alter table public.bot_user enable row level security;
alter table public.bot_user_role enable row level security;
alter table public.teacher enable row level security;
alter table public.teacher_onboarding enable row level security;
alter table public.teacher_course_responsibility enable row level security;
alter table public.teacher_availability enable row level security;
alter table public.teacher_time_off enable row level security;
alter table public.lesson enable row level security;
alter table public.course_material enable row level security;
alter table public.teacher_material_request enable row level security;
alter table public.courses enable row level security;
alter table if exists public.course enable row level security;
alter table public.teacher_course enable row level security;
alter table public.password_reset_tokens enable row level security;

drop policy if exists "Public can read active courses" on public.courses;
create policy "Public can read active courses"
on public.courses
for select
to anon, authenticated
using (true);

drop policy if exists "Teachers can read own teacher profile" on public.teacher;
create policy "Teachers can read own teacher profile"
on public.teacher
for select
to authenticated
using ((select auth.uid()) = id);

drop policy if exists "Teachers can update limited own teacher profile" on public.teacher;
create policy "Teachers can update limited own teacher profile"
on public.teacher
for update
to authenticated
using ((select auth.uid()) = id)
with check ((select auth.uid()) = id);

drop policy if exists "Teachers can read own availability" on public.teacher_availability;
create policy "Teachers can read own availability"
on public.teacher_availability
for select
to authenticated
using (teacher_id = (select auth.uid()));

drop policy if exists "Teachers can manage own availability" on public.teacher_availability;
create policy "Teachers can manage own availability"
on public.teacher_availability
for all
to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()));

drop policy if exists "Teachers can read own time off" on public.teacher_time_off;
create policy "Teachers can read own time off"
on public.teacher_time_off
for select
to authenticated
using (teacher_id = (select auth.uid()));

drop policy if exists "Teachers can manage own time off" on public.teacher_time_off;
create policy "Teachers can manage own time off"
on public.teacher_time_off
for all
to authenticated
using (teacher_id = (select auth.uid()))
with check (teacher_id = (select auth.uid()));

drop policy if exists "Teachers can read own lessons" on public.lesson;
create policy "Teachers can read own lessons"
on public.lesson
for select
to authenticated
using (teacher_id = (select auth.uid()));

drop policy if exists "Teachers can read active materials" on public.course_material;
create policy "Teachers can read active materials"
on public.course_material
for select
to authenticated
using (active = true);

insert into public.communication_template (key, channel, language, subject, body)
values
  ('lead_received_en', 'email', 'en', 'We received your Schowl trial request', 'Hi {{parent_name}}, thanks for requesting a free trial for {{child_name}}. Our team will contact you soon on WhatsApp or phone to confirm the best course and time.'),
  ('trial_booked_en', 'email', 'en', 'Your Schowl trial is booked', 'Hi {{parent_name}}, {{child_name}}''s trial is booked for {{scheduled_at}} with {{teacher_name}}. Meeting link: {{meeting_url}}.'),
  ('trial_reminder_24h_en', 'email', 'en', 'Reminder: Schowl trial tomorrow', 'Reminder: {{child_name}} has a Schowl trial lesson tomorrow at {{scheduled_at}}. Please prepare a laptop, stable internet, and the meeting link.'),
  ('trial_done_next_steps_en', 'email', 'en', 'Next steps after the Schowl trial', 'Thanks for joining the trial. If {{child_name}} enjoyed it, we can help choose the right plan and weekly schedule.'),
  ('no_response_followup_24h_en', 'email', 'en', 'Still interested in a Schowl trial?', 'Hi {{parent_name}}, we tried to reach you about {{child_name}}''s free trial. Reply when you are ready and we will help schedule it.'),
  ('converted_welcome_en', 'email', 'en', 'Welcome to Schowl', 'Welcome to Schowl. We are excited to start building with {{child_name}}.'),
  ('first_contact_whatsapp_en', 'whatsapp', 'en', null, 'Hi {{parent_name}}, this is Schowl. Thanks for requesting a free trial for {{child_name}}. I would like to confirm the best course and time for you.'),
  ('trial_time_proposal_whatsapp_en', 'whatsapp', 'en', null, 'Hi {{parent_name}}, we can offer {{child_name}} a Schowl trial on {{scheduled_at}}. Does this time work for you?'),
  ('trial_confirmed_whatsapp_en', 'whatsapp', 'en', null, 'Your Schowl free trial for {{child_name}} is confirmed for {{scheduled_at}} with {{teacher_name}}. Meeting link: {{meeting_url}}.'),
  ('trial_reminder_whatsapp_en', 'whatsapp', 'en', null, 'Reminder: {{child_name}} has a Schowl trial at {{scheduled_at}}. Meeting link: {{meeting_url}}.'),
  ('post_trial_followup_whatsapp_en', 'whatsapp', 'en', null, 'Hi {{parent_name}}, thanks for attending the Schowl trial. Would you like us to suggest the best plan and weekly schedule for {{child_name}}?'),
  ('payment_next_step_whatsapp_en', 'whatsapp', 'en', null, 'Great. The next step is confirming the plan and weekly schedule for {{child_name}}.'),
  ('no_response_followup_whatsapp_en', 'whatsapp', 'en', null, 'Hi {{parent_name}}, just following up on {{child_name}}''s Schowl free trial request. Would you like to schedule it this week?')
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
