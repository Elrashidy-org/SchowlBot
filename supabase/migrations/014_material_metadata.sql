begin;

-- Richer per-lesson material metadata.
alter table public.course_material
  add column if not exists presentation_url text,
  add column if not exists quiz_url text;

commit;
