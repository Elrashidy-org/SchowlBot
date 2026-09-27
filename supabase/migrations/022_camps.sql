begin;

-- Camps Belal can create/edit without code (summer 2027, winter, ...). The
-- website reads these; registrations reference a camp by its slug.
create table if not exists public.camp (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique,
  status text not null default 'upcoming' check (status in ('open', 'upcoming', 'closed')),
  is_featured boolean not null default false,
  starts_on date,
  ends_on date,
  registration_deadline date,
  age_min smallint,
  age_max smallint,
  price numeric(10, 2),
  currency text not null default 'EGP',
  seats_left integer,
  title_en text,
  title_ar text,
  tagline_en text,
  tagline_ar text,
  description_en text,
  description_ar text,
  schedule_note_en text,
  schedule_note_ar text,
  tracks jsonb not null default '[]'::jsonb,
  outcomes jsonb not null default '[]'::jsonb,
  faq jsonb not null default '[]'::jsonb,
  image_url text,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists camp_status_idx on public.camp(status, sort_order);
alter table public.camp enable row level security;

-- Placeholder featured summer camp (slug matches existing registrations).
insert into public.camp (slug, status, is_featured, age_min, age_max, title_en, title_ar, tagline_en, tagline_ar, description_en, description_ar)
values (
  'summer', 'upcoming', true, 8, 18,
  'Schowl Summer Camp', 'معسكر Schowl الصيفي',
  'Build real projects in a small group this summer', 'ابنِ مشاريع حقيقية ضمن مجموعة صغيرة هذا الصيف',
  'A placeholder description — replace with the real camp copy.', 'وصف مؤقت — استبدله بالمحتوى الحقيقي للمعسكر.'
)
on conflict (slug) do nothing;

commit;
