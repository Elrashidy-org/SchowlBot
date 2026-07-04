begin;

-- Enrolled students (post-conversion) and their paid memberships/renewals.
create table if not exists public.student (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references public.client_lead(id) on delete set null,
  client_id bigint references public.client(id) on delete set null,
  name text not null,
  parent_name text,
  phone_e164 text,
  email text,
  course_id uuid references public.courses(id) on delete set null,
  track text,
  level text,
  status text not null default 'active' check (status in ('active', 'paused', 'completed', 'cancelled')),
  assigned_teacher_id uuid references public.teacher(id) on delete set null,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.membership (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student(id) on delete cascade,
  plan text not null default 'monthly',
  starts_on date not null default current_date,
  renews_on date not null,
  price numeric(10, 2),
  currency text not null default 'EGP',
  status text not null default 'active' check (status in ('active', 'cancelled', 'expired')),
  auto_reminders boolean not null default true,
  last_renewal_reminder_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists membership_renewal_idx on public.membership(status, renews_on);
create index if not exists membership_student_idx on public.membership(student_id);
create index if not exists student_status_idx on public.student(status);

alter table public.student enable row level security;
alter table public.membership enable row level security;

insert into public.communication_template (key, channel, language, subject, body)
values
  ('membership_renewal_en', 'email', 'en', 'Your Schowl membership renews soon', 'Hi {{parent_name}}, {{child_name}}''s Schowl membership renews on {{renews_on}}. Reply to confirm and keep the classes going without interruption.'),
  ('membership_renewal_ar', 'email', 'ar', 'اقتراب موعد تجديد اشتراك Schowl', 'مرحباً {{parent_name}}، يقترب موعد تجديد اشتراك {{child_name}} في Schowl بتاريخ {{renews_on}}. ردّ للتأكيد حتى تستمر الحصص دون انقطاع.')
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
