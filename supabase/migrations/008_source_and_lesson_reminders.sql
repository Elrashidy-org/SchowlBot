begin;

-- Lead source (website / ad / whatsapp / referral / manual / phone / other).
alter table public.client_lead add column if not exists source text not null default 'website';

-- Parent reminder email for recurring paid lessons.
insert into public.communication_template (key, channel, language, subject, body)
values
  ('lesson_reminder_en', 'email', 'en', 'Reminder: your Schowl lesson', 'Reminder: {{child_name}} has a Schowl lesson on {{scheduled_at}}. Meeting link: {{meeting_url}}.'),
  ('lesson_reminder_ar', 'email', 'ar', 'تذكير: حصة Schowl', 'تذكير: لدى {{child_name}} حصة Schowl يوم {{scheduled_at}}. رابط الحصة: {{meeting_url}}.')
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
