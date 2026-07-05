begin;

insert into public.communication_template (key, channel, language, subject, body)
values
  ('payment_receipt_en', 'email', 'en', 'Payment received — Schowl', 'Hi {{parent_name}}, thank you! We''ve received your payment of {{amount}} {{currency}} for {{child_name}}''s Schowl membership. It is active through {{renews_on}}.'),
  ('payment_receipt_ar', 'email', 'ar', 'تم استلام الدفعة — Schowl', 'مرحباً {{parent_name}}، شكراً لك! استلمنا دفعتك بقيمة {{amount}} {{currency}} لاشتراك {{child_name}} في Schowl. الاشتراك فعّال حتى {{renews_on}}.')
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
