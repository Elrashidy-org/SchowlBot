begin;

-- Context + consent on real leads.
alter table public.client_lead
  add column if not exists package_interest text,
  add column if not exists consent_marketing boolean not null default false;

alter table public.camp_registration
  add column if not exists consent_marketing boolean not null default false;

-- Partial/abandoned bookings live here (not client_lead, which requires a full
-- parent/child/consent). One row per browser booking attempt, keyed by session_id.
create table if not exists public.booking_session (
  id uuid primary key default gen_random_uuid(),
  session_id text not null unique,
  phone_raw text,
  phone_e164 text,
  country_iso char(2),
  country_name text,
  child_name text,
  parent_name text,
  child_age smallint,
  email text,
  language text not null default 'en',
  course_id uuid references public.courses(id) on delete set null,
  starts_at timestamptz,
  package_interest text,
  quiz_answers jsonb not null default '{}'::jsonb,
  quiz_recommendation text,
  landing_page text,
  referrer text,
  utm jsonb not null default '{}'::jsonb,
  consent_marketing boolean not null default false,
  status text not null default 'started' check (status in ('started', 'booked', 'abandoned')),
  converted_lead_id uuid references public.client_lead(id) on delete set null,
  alerted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists booking_session_open_idx on public.booking_session(status, created_at);
alter table public.booking_session enable row level security;

-- Add a WhatsApp contact line to the trial confirmation, plus a 1h reminder and
-- an abandoned-booking nudge.
insert into public.communication_template (key, channel, language, subject, body) values
('trial_booked_en','email','en',$s$It's set — {{child_name}}'s trial is booked ✅$s$,$b$Hi {{parent_name}},

Great news — {{child_name}}'s free trial is confirmed for {{scheduled_at}} (Cairo time){{teacher_line}}.

Join here at the scheduled time: {{meeting_url}}

We've attached a calendar invite so it's easy to remember. Please have a laptop or desktop ready with a stable internet connection.{{whatsapp_line}}$b$),
('trial_booked_ar','email','ar',$s$تم الحجز — حصة {{child_name}} التجريبية مؤكدة ✅$s$,$b$مرحباً {{parent_name}}،

خبر رائع — تم تأكيد حصة {{child_name}} التجريبية المجانية يوم {{scheduled_at}} (بتوقيت القاهرة){{teacher_line}}.

انضم من هنا في الموعد: {{meeting_url}}

أرفقنا دعوة تقويم لتسهيل التذكّر. يرجى تجهيز لابتوب أو كمبيوتر مع إنترنت مستقر.{{whatsapp_line}}$b$),

('trial_reminder_1h_en','email','en',$s$Starting soon: {{child_name}}'s Schowl trial in 1 hour ⏰$s$,$b$Hi {{parent_name}},

{{child_name}}'s Schowl trial starts in about an hour, at {{scheduled_at}} (Cairo time).

Join link: {{meeting_url}}

See you very soon!{{whatsapp_line}}$b$),
('trial_reminder_1h_ar','email','ar',$s$تبدأ قريباً: حصة {{child_name}} التجريبية خلال ساعة ⏰$s$,$b$مرحباً {{parent_name}}،

تبدأ حصة {{child_name}} التجريبية خلال ساعة تقريباً، الساعة {{scheduled_at}} (بتوقيت القاهرة).

رابط الانضمام: {{meeting_url}}

نراك قريباً!{{whatsapp_line}}$b$),

('booking_abandoned_en','email','en',$s$You're one step away from {{child_name}}'s free class 🎓$s$,$b$Hi {{parent_name}},

It looks like you started booking a free Schowl trial but didn't finish. Your spot is still open — it only takes a minute to pick a time.

Reply to this email or message us and we'll help you lock it in.{{whatsapp_line}}$b$),
('booking_abandoned_ar','email','ar',$s$تفصلك خطوة واحدة عن حصة {{child_name}} المجانية 🎓$s$,$b$مرحباً {{parent_name}}،

يبدو أنك بدأت حجز حصة تجريبية مجانية مع Schowl ولم تُكملها. مكانك ما زال محجوزاً — الأمر لا يستغرق سوى دقيقة لاختيار الوقت.

ردّ على هذا البريد أو راسلنا وسنساعدك في إتمام الحجز.{{whatsapp_line}}$b$)
on conflict (key) do update
set subject = excluded.subject, body = excluded.body, updated_at = now();

commit;
