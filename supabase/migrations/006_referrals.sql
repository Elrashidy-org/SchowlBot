begin;

-- Referrals: who referred whom. A referral "qualifies" when the referred lead
-- converts, which triggers the referral bonus/discount for the referrer.
create table if not exists public.referral (
  id uuid primary key default gen_random_uuid(),
  referrer_name text,
  referrer_phone text,
  referrer_student_id uuid references public.student(id) on delete set null,
  referred_lead_id uuid references public.client_lead(id) on delete set null,
  status text not null default 'pending' check (status in ('pending', 'qualified', 'rewarded', 'void')),
  reward text,
  notes text,
  created_by_bot_user_id uuid references public.bot_user(id) on delete set null,
  qualified_at timestamptz,
  rewarded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists referral_status_idx on public.referral(status);
create index if not exists referral_lead_idx on public.referral(referred_lead_id);

alter table public.referral enable row level security;

commit;
