begin;

-- Returns bookable trial start-times for a course: candidate slots where at least
-- one responsible, available teacher exists (respects availability, time off,
-- existing lessons, and min notice). All timezone math is done in SQL.
create or replace function public.available_trial_slots(
  p_course_id uuid,
  p_from timestamptz,
  p_to timestamptz,
  p_duration integer default 60,
  p_step integer default 60
)
returns setof timestamptz
language sql
stable
as $$
  select gs
  from generate_series(
    date_trunc('hour', greatest(p_from, now())) + interval '1 hour',
    p_to,
    make_interval(mins => greatest(15, p_step))
  ) gs
  where exists (
    select 1
    from public.teacher t
    join public.teacher_course_responsibility r
      on r.teacher_id = t.id
     and r.course_id = p_course_id
     and r.active = true
     and r.can_teach_trial = true
    where t.active = true
      and t.status = 'active'
      and t.auto_assign_enabled = true
      and (extract(epoch from (gs - now())) / 3600.0) >= t.min_notice_hours
      and public.teacher_is_available(t.id, gs, p_duration)
  )
  order by gs
  limit 200;
$$;

-- Camp registrations — a separate intake from trial leads.
create table if not exists public.camp_registration (
  id uuid primary key default gen_random_uuid(),
  camp text not null default 'summer',
  parent_name text,
  child_name text not null,
  child_age smallint,
  email text,
  phone_raw text,
  phone_e164 text,
  country_iso char(2),
  country_name text,
  language text not null default 'en',
  notes text,
  extra jsonb not null default '{}'::jsonb,
  source text not null default 'website',
  consent_contact boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists camp_registration_camp_idx on public.camp_registration(camp, created_at desc);
alter table public.camp_registration enable row level security;

insert into public.communication_template (key, channel, language, subject, body)
values
  ('camp_registered_en', 'email', 'en', 'You''re registered for the Schowl camp', 'Hi {{parent_name}}, thanks for registering {{child_name}} for the Schowl {{camp}} camp! Our team will contact you soon with the schedule and details.'),
  ('camp_registered_ar', 'email', 'ar', 'تم تسجيلك في معسكر Schowl', 'مرحباً {{parent_name}}، شكراً لتسجيل {{child_name}} في معسكر Schowl {{camp}}! سيتواصل معك فريقنا قريباً بالجدول والتفاصيل.')
on conflict (key) do update
set subject = excluded.subject, body = excluded.body, updated_at = now();

commit;
