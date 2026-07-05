begin;

-- Email suppression list: any address here is never emailed again.
create table if not exists public.email_unsubscribe (
  email text primary key,
  unsubscribed_at timestamptz not null default now(),
  reason text
);
alter table public.email_unsubscribe enable row level security;

insert into public.communication_template (key, channel, language, subject, body)
values
  ('reengagement_en', 'email', 'en', 'Still interested in Schowl?', 'Hi {{parent_name}}, it''s been a while! {{child_name}}''s spot for a free Schowl coding class is still open. Reply and we''ll help you pick a time.'),
  ('reengagement_ar', 'email', 'ar', 'هل ما زلت مهتماً بـ Schowl؟', 'مرحباً {{parent_name}}، مرّ وقت طويل! ما زال مكان {{child_name}} متاحاً لحصة برمجة تجريبية مجانية مع Schowl. ردّ وسنساعدك في اختيار الوقت المناسب.')
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
