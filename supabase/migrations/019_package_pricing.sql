begin;

-- The price book: standard packages with a LIST price (e.g. "16 lessons" @ 3200).
-- The list price is a reference/default; the actual price a customer pays is set
-- per sale and can be higher or lower.
create table if not exists public.package_plan (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  lessons integer not null check (lessons > 0),
  list_price numeric(10, 2) not null,
  currency text not null default 'EGP',
  active boolean not null default true,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists package_plan_active_idx on public.package_plan(active);
alter table public.package_plan enable row level security;

-- One row per priced sale (enrollment or renewal): what plan, how many lessons,
-- the list price at the time, and the actual price paid. discount = list_price - price.
create table if not exists public.package_purchase (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student(id) on delete cascade,
  package_id uuid references public.student_package(id) on delete set null,
  plan_id uuid references public.package_plan(id) on delete set null,
  lessons integer not null check (lessons > 0),
  list_price numeric(10, 2),
  price numeric(10, 2) not null,
  currency text not null default 'EGP',
  sold_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists package_purchase_student_idx on public.package_purchase(student_id);
create index if not exists package_purchase_created_idx on public.package_purchase(created_at desc);
alter table public.package_purchase enable row level security;

commit;
