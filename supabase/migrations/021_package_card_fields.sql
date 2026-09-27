begin;

-- Richer fields so the website's pricing cards can render fully from /packages:
-- a stable slug, class type, bilingual titles/descriptions, feature bullets,
-- badges, ordering, a struck-through compare-at price, and validity metadata.
alter table public.package_plan
  add column if not exists key text,
  add column if not exists class_type text not null default 'one_on_one'
    check (class_type in ('one_on_one', 'group')),
  add column if not exists name_en text,
  add column if not exists name_ar text,
  add column if not exists description_en text,
  add column if not exists description_ar text,
  add column if not exists features_en jsonb not null default '[]'::jsonb,
  add column if not exists features_ar jsonb not null default '[]'::jsonb,
  add column if not exists is_popular boolean not null default false,
  add column if not exists is_best_value boolean not null default false,
  add column if not exists sort_order integer not null default 0,
  add column if not exists compare_at_price numeric(10, 2),
  add column if not exists course_id uuid references public.courses(id) on delete set null,
  add column if not exists valid_days integer,
  add column if not exists session_minutes integer not null default 60;

create unique index if not exists package_plan_key_idx on public.package_plan(key) where key is not null;

commit;
