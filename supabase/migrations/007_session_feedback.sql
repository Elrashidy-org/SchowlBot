begin;

-- Per-session feedback captured by the teacher when marking a lesson attended:
-- the recording URL and a 1-5 student rating (shared with the client later).
alter table public.lesson
  add column if not exists recording_url text,
  add column if not exists student_rating smallint,
  add column if not exists session_notes text;

do $$
begin
  if not exists (
    select 1 from information_schema.constraint_column_usage
    where table_schema = 'public' and table_name = 'lesson' and column_name = 'student_rating'
      and constraint_name = 'lesson_student_rating_range'
  ) then
    alter table public.lesson
      add constraint lesson_student_rating_range check (student_rating is null or (student_rating between 1 and 5));
  end if;
end $$;

commit;
