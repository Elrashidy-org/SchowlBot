begin;

-- Enforce per-teacher caps and minimum notice when auto-picking a trial teacher:
--   * min_notice_hours  - trial must be far enough in the future
--   * max_daily_lessons  - cap on pending/scheduled lessons that calendar day
--   * max_weekly_lessons - cap on pending/scheduled lessons that calendar week
-- All evaluated in the teacher's own timezone.
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
    and (extract(epoch from (p_starts_at - now())) / 3600.0) >= t.min_notice_hours
    and public.teacher_is_available(t.id, p_starts_at, p_duration_minutes)
    and (
      select count(*)
      from public.lesson dl
      where dl.teacher_id = t.id
        and lower(dl.status) in ('pending', 'scheduled')
        and dl.scheduled_at is not null
        and (dl.scheduled_at at time zone t.timezone)::date
            = (p_starts_at at time zone t.timezone)::date
    ) < t.max_daily_lessons
    and (
      select count(*)
      from public.lesson wl
      where wl.teacher_id = t.id
        and lower(wl.status) in ('pending', 'scheduled')
        and wl.scheduled_at is not null
        and date_trunc('week', (wl.scheduled_at at time zone t.timezone))
            = date_trunc('week', (p_starts_at at time zone t.timezone))
    ) < t.max_weekly_lessons
  order by
    coalesce(load.active_lesson_count, 0) asc,
    coalesce(load.stored_total_lessons, 0) asc,
    r.priority asc,
    t.created_at asc
  limit 1;
$$;

commit;
