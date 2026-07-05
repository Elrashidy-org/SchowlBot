begin;

-- Money received from students/parents. Linked to the membership it pays for.
create table if not exists public.payment (
  id uuid primary key default gen_random_uuid(),
  student_id uuid references public.student(id) on delete set null,
  membership_id uuid references public.membership(id) on delete set null,
  amount numeric(10, 2) not null,
  currency text not null default 'EGP',
  method text not null default 'cash',
  paid_on date not null default current_date,
  notes text,
  recorded_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists payment_student_idx on public.payment(student_id);
create index if not exists payment_paid_on_idx on public.payment(paid_on);

alter table public.payment enable row level security;

commit;
