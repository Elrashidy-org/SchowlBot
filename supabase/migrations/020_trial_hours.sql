begin;

-- Trial booking hours are a fixed weekly template, the SAME for every course and
-- NOT checked against any teacher's calendar. Parents always see open slots; the
-- team staffs a teacher afterwards. Edit these rows to change the hours.
-- day_of_week: 0 = Sunday .. 6 = Saturday (Postgres dow), times in Africa/Cairo.
create table if not exists public.trial_hours (
  id bigserial primary key,
  day_of_week smallint not null check (day_of_week between 0 and 6),
  start_time time not null,
  end_time time not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (start_time < end_time)
);
alter table public.trial_hours enable row level security;

-- Default template: every day 15:00–21:00 Cairo (placeholder — adjust freely).
insert into public.trial_hours (day_of_week, start_time, end_time)
select d, time '15:00', time '21:00'
from generate_series(0, 6) as d
where not exists (select 1 from public.trial_hours);

-- Open trial slots from the template over [p_from, p_to], independent of course
-- and teacher. Skips slots in the past or within p_lead_minutes of now.
create or replace function public.open_trial_slots(
  p_from timestamptz,
  p_to timestamptz,
  p_step integer default 60,
  p_lead_minutes integer default 720,
  p_tz text default 'Africa/Cairo'
)
returns setof timestamptz
language sql
stable
as $$
  select gs
  from generate_series(
    date_trunc('hour', greatest(p_from, now())) + make_interval(mins => greatest(15, p_step)),
    p_to,
    make_interval(mins => greatest(15, p_step))
  ) gs
  where gs >= now() + make_interval(mins => greatest(0, p_lead_minutes))
    and exists (
      select 1
      from public.trial_hours th
      where th.active
        and th.day_of_week = extract(dow from (gs at time zone p_tz))::smallint
        and (gs at time zone p_tz)::time >= th.start_time
        and (gs at time zone p_tz)::time < th.end_time
    )
  order by gs
  limit 300;
$$;

commit;
