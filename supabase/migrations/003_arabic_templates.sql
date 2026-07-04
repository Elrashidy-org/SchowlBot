begin;

-- Arabic (ar) variants of the communication templates. The bot resolves
-- "<base>_ar" for Arabic-speaking leads and falls back to "<base>_en".
insert into public.communication_template (key, channel, language, subject, body)
values
  ('lead_received_ar', 'email', 'ar', 'استلمنا طلب الحصة التجريبية', 'مرحباً {{parent_name}}، شكراً لطلبك حصة تجريبية مجانية لـ {{child_name}}. سيتواصل معك فريقنا قريباً عبر واتساب أو الهاتف لتأكيد الكورس والوقت المناسب.'),
  ('trial_booked_ar', 'email', 'ar', 'تم حجز الحصة التجريبية', 'مرحباً {{parent_name}}، تم حجز الحصة التجريبية لـ {{child_name}} يوم {{scheduled_at}} مع {{teacher_name}}. رابط الحصة: {{meeting_url}}.'),
  ('trial_reminder_24h_ar', 'email', 'ar', 'تذكير: حصة Schowl التجريبية غداً', 'تذكير: لدى {{child_name}} حصة تجريبية مع Schowl غداً الساعة {{scheduled_at}}. يرجى تجهيز لابتوب وإنترنت مستقر ورابط الحصة.'),
  ('trial_done_next_steps_ar', 'email', 'ar', 'الخطوات التالية بعد الحصة التجريبية', 'شكراً لانضمامكم للحصة التجريبية. إذا أعجبت {{child_name}}، يمكننا مساعدتكم في اختيار الخطة المناسبة والجدول الأسبوعي.'),
  ('no_response_followup_24h_ar', 'email', 'ar', 'هل ما زلت مهتماً بحصة Schowl التجريبية؟', 'مرحباً {{parent_name}}، حاولنا التواصل معك بخصوص الحصة التجريبية المجانية لـ {{child_name}}. ردّ علينا متى كنت جاهزاً وسنساعدك في تحديد الموعد.'),
  ('converted_welcome_ar', 'email', 'ar', 'أهلاً بك في Schowl', 'أهلاً بك في Schowl. يسعدنا أن نبدأ رحلة التعلّم مع {{child_name}}.'),
  ('first_contact_whatsapp_ar', 'whatsapp', 'ar', null, 'مرحباً {{parent_name}}، معك Schowl. شكراً لطلبك حصة تجريبية مجانية لـ {{child_name}}. أودّ تأكيد الكورس والوقت المناسب لكم.'),
  ('trial_time_proposal_whatsapp_ar', 'whatsapp', 'ar', null, 'مرحباً {{parent_name}}، يمكننا تقديم حصة تجريبية لـ {{child_name}} يوم {{scheduled_at}}. هل هذا الوقت مناسب لكم؟'),
  ('trial_confirmed_whatsapp_ar', 'whatsapp', 'ar', null, 'تم تأكيد الحصة التجريبية المجانية لـ {{child_name}} يوم {{scheduled_at}} مع {{teacher_name}}. رابط الحصة: {{meeting_url}}.'),
  ('trial_reminder_whatsapp_ar', 'whatsapp', 'ar', null, 'تذكير: لدى {{child_name}} حصة تجريبية مع Schowl الساعة {{scheduled_at}}. رابط الحصة: {{meeting_url}}.'),
  ('post_trial_followup_whatsapp_ar', 'whatsapp', 'ar', null, 'مرحباً {{parent_name}}، شكراً لحضوركم الحصة التجريبية. هل ترغبون أن نقترح الخطة المناسبة والجدول الأسبوعي لـ {{child_name}}؟'),
  ('payment_next_step_whatsapp_ar', 'whatsapp', 'ar', null, 'رائع. الخطوة التالية هي تأكيد الخطة والجدول الأسبوعي لـ {{child_name}}.'),
  ('no_response_followup_whatsapp_ar', 'whatsapp', 'ar', null, 'مرحباً {{parent_name}}، نتابع معكم بخصوص طلب الحصة التجريبية المجانية لـ {{child_name}}. هل ترغبون بتحديد موعدها هذا الأسبوع؟')
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
