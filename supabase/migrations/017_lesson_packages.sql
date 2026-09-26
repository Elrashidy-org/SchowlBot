begin;

-- Schowl sells LESSON PACKAGES (e.g. 4 / 8 / 16 lessons), not monthly
-- subscriptions. A student holds a package of prepaid lessons; each delivered
-- lesson consumes one; when 2 lessons remain we remind the parent to renew
-- (buy the next package). This replaces the date-based `membership` model.
create table if not exists public.student_package (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.student(id) on delete cascade,
  lessons_purchased integer not null check (lessons_purchased > 0),
  lessons_used integer not null default 0 check (lessons_used >= 0),
  price numeric(10, 2),
  currency text not null default 'EGP',
  status text not null default 'active' check (status in ('active', 'completed', 'cancelled')),
  low_balance_reminder_sent boolean not null default false,
  purchased_on date not null default current_date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists student_package_active_idx on public.student_package(student_id, status);
create index if not exists student_package_low_balance_idx on public.student_package(status, low_balance_reminder_sent);

alter table public.student_package enable row level security;

-- Link a payment to the package it topped up (kept alongside legacy membership_id).
alter table public.payment add column if not exists package_id uuid references public.student_package(id) on delete set null;

-- Reminder copy: "lessons running low", not "membership renews on <date>".
insert into public.communication_template (key, channel, language, subject, body)
values
  ('lessons_running_low_en', 'email', 'en', $s$Only {{lessons_remaining}} Schowl lessons left for {{child_name}} 🚀$s$, $b$Hi {{parent_name}},

{{child_name}} has been doing brilliantly — and there are just {{lessons_remaining}} lessons left in the current package. To keep the momentum going without a gap, our team will reach out to help you top up with the next set of lessons.

Consistency is where the real progress happens. We'd love to keep {{child_name}} building!$b$),
  ('lessons_running_low_ar', 'email', 'ar', $s$تبقّى {{lessons_remaining}} حصص فقط لـ {{child_name}} في Schowl 🚀$s$, $b$مرحباً {{parent_name}}،

كان أداء {{child_name}} رائعاً — وتبقّى {{lessons_remaining}} حصص فقط في الباقة الحالية. للحفاظ على الاستمرارية دون انقطاع، سيتواصل معك فريقنا لمساعدتك في إضافة الباقة التالية من الحصص.

الاستمرارية هي سرّ التقدّم الحقيقي. يسعدنا أن يواصل {{child_name}} البناء معنا!$b$)
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

-- Receipt now states lessons remaining instead of a renewal date.
insert into public.communication_template (key, channel, language, subject, body)
values
  ('payment_receipt_en', 'email', 'en', $s$Payment received — thank you! 🧾$s$, $b$Hi {{parent_name}},

We've received your payment of {{amount}} {{currency}} for {{child_name}}'s Schowl lessons — thank you! {{child_name}} now has {{lessons_remaining}} lessons ready to go.

Here's to more building, more learning, and more fun ahead.$b$),
  ('payment_receipt_ar', 'email', 'ar', $s$تم استلام الدفعة — شكراً لك! 🧾$s$, $b$مرحباً {{parent_name}}،

استلمنا دفعتك بقيمة {{amount}} {{currency}} لحصص {{child_name}} في Schowl — شكراً لك! أصبح لدى {{child_name}} الآن {{lessons_remaining}} حصة جاهزة.

مزيد من البناء والتعلّم والمتعة في الطريق.$b$)
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
