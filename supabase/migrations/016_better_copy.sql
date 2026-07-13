begin;

-- Rewrites all message copy (email + WhatsApp, EN + AR) to be warmer and more
-- compelling, and adds the camp funnel. Placeholders are unchanged.
insert into public.communication_template (key, channel, language, subject, body) values

-- ===== Email: trial funnel =====
('lead_received_en','email','en',$s$We've reserved {{child_name}}'s free Schowl class 🎉$s$,$b$Hi {{parent_name}},

Thank you for choosing Schowl! We've saved a spot for {{child_name}}'s free trial class — a hands-on session where they'll start building a real project from day one.

Our team will reach out shortly on WhatsApp or by phone to lock in the best time and the right course for {{child_name}}.

Get ready to see {{child_name}} create something amazing.$b$),
('lead_received_ar','email','ar',$s$حجزنا لـ {{child_name}} حصته التجريبية المجانية 🎉$s$,$b$مرحباً {{parent_name}}،

شكراً لاختيارك Schowl! لقد حجزنا لـ {{child_name}} حصة تجريبية مجانية — حصة عملية يبدأ فيها ببناء مشروع حقيقي من أول يوم.

سيتواصل معك فريقنا قريباً عبر واتساب أو الهاتف لتحديد أنسب وقت والكورس المناسب لـ {{child_name}}.

استعدّ لترى {{child_name}} يبدع شيئاً مذهلاً.$b$),

('trial_booked_en','email','en',$s$It's set — {{child_name}}'s trial is booked ✅$s$,$b$Hi {{parent_name}},

Great news — {{child_name}}'s free trial is confirmed for {{scheduled_at}} with {{teacher_name}}.

Join here at the scheduled time: {{meeting_url}}

To get the most out of it, please have a laptop or desktop ready with a stable internet connection. That's it — {{teacher_name}} will take care of the rest!$b$),
('trial_booked_ar','email','ar',$s$تم الحجز — حصة {{child_name}} التجريبية مؤكدة ✅$s$,$b$مرحباً {{parent_name}}،

خبر رائع — تم تأكيد حصة {{child_name}} التجريبية المجانية يوم {{scheduled_at}} مع {{teacher_name}}.

انضم من هنا في الموعد: {{meeting_url}}

لتحقيق أقصى استفادة، جهّز لابتوب أو كمبيوتر مع إنترنت مستقر. هذا كل شيء — {{teacher_name}} سيتكفّل بالباقي!$b$),

('trial_reminder_24h_en','email','en',$s$Tomorrow: {{child_name}}'s Schowl class ⏰$s$,$b$Hi {{parent_name}},

A friendly reminder that {{child_name}}'s Schowl trial is tomorrow at {{scheduled_at}}.

Join link: {{meeting_url}}

Please prepare a laptop, a stable internet connection, and a comfy spot to create. See you there!$b$),
('trial_reminder_24h_ar','email','ar',$s$غداً: حصة {{child_name}} مع Schowl ⏰$s$,$b$مرحباً {{parent_name}}،

تذكير لطيف بأن حصة {{child_name}} التجريبية مع Schowl غداً الساعة {{scheduled_at}}.

رابط الانضمام: {{meeting_url}}

يرجى تجهيز لابتوب وإنترنت مستقر ومكان مريح للإبداع. نراك هناك!$b$),

('trial_done_next_steps_en','email','en',$s$How was {{child_name}}'s first class? 🚀$s$,$b$Hi {{parent_name}},

We hope {{child_name}} had a blast in their trial class! This is just the beginning — with a regular weekly schedule, {{child_name}} can go from first steps to building real games, apps, and websites.

Our team will follow up to help you choose the plan and schedule that fit {{child_name}} best. Have questions in the meantime? We're always here for you.$b$),
('trial_done_next_steps_ar','email','ar',$s$كيف كانت حصة {{child_name}} الأولى؟ 🚀$s$,$b$مرحباً {{parent_name}}،

نتمنى أن يكون {{child_name}} قد استمتع بحصته التجريبية! هذه مجرد البداية — مع جدول أسبوعي منتظم، يستطيع {{child_name}} الانتقال من الخطوات الأولى إلى بناء ألعاب وتطبيقات ومواقع حقيقية.

سيتابع معك فريقنا لمساعدتك في اختيار الخطة والجدول الأنسب لـ {{child_name}}. أي أسئلة؟ نحن دائماً هنا من أجلك.$b$),

('no_response_followup_24h_en','email','en',$s$Still keen to see {{child_name}} build? 💡$s$,$b$Hi {{parent_name}},

We tried to reach you about {{child_name}}'s free Schowl trial and didn't want you to miss the spot. Whenever you're ready, we'll help you pick a time that works — it only takes a minute.

Just let us know and we'll take it from there.$b$),
('no_response_followup_24h_ar','email','ar',$s$ما زلت متشوقاً لترى {{child_name}} يبدع؟ 💡$s$,$b$مرحباً {{parent_name}}،

حاولنا التواصل معك بخصوص حصة {{child_name}} التجريبية المجانية ولم نرغب أن تفوّتها. متى كنت جاهزاً، سنساعدك في اختيار وقت مناسب — الأمر لا يستغرق سوى دقيقة.

فقط أخبرنا وسنتولى الباقي.$b$),

('converted_welcome_en','email','en',$s$Welcome to Schowl, {{child_name}}! 🎓$s$,$b$Hi {{parent_name}},

Welcome to the Schowl family! We're thrilled to start this journey with {{child_name}}.

From here, {{child_name}} will learn by building — real projects, real skills, and a whole lot of fun along the way. Their teacher will guide every step.

Here's to everything {{child_name}} is about to create. Welcome aboard!$b$),
('converted_welcome_ar','email','ar',$s$أهلاً بك في Schowl يا {{child_name}}! 🎓$s$,$b$مرحباً {{parent_name}}،

أهلاً بك في عائلة Schowl! يسعدنا أن نبدأ هذه الرحلة مع {{child_name}}.

من هنا، سيتعلّم {{child_name}} عبر البناء — مشاريع حقيقية، مهارات حقيقية، والكثير من المتعة في الطريق. معلّمه سيرشده في كل خطوة.

بالتوفيق في كل ما سيبدعه {{child_name}}. أهلاً بك معنا!$b$),

('lesson_reminder_en','email','en',$s$Reminder: {{child_name}}'s Schowl class 📅$s$,$b$Hi {{parent_name}},

A quick reminder — {{child_name}} has a Schowl class on {{scheduled_at}}.

Join link: {{meeting_url}}

See you in class!$b$),
('lesson_reminder_ar','email','ar',$s$تذكير: حصة {{child_name}} مع Schowl 📅$s$,$b$مرحباً {{parent_name}}،

تذكير سريع — لدى {{child_name}} حصة مع Schowl يوم {{scheduled_at}}.

رابط الانضمام: {{meeting_url}}

نراك في الحصة!$b$),

('membership_renewal_en','email','en',$s${{child_name}}'s Schowl membership renews soon$s$,$b$Hi {{parent_name}},

{{child_name}} has been doing brilliantly, and their Schowl membership renews on {{renews_on}}. To keep the momentum going with no interruption to classes, our team will reach out to help you renew.

Thank you for being part of the Schowl journey!$b$),
('membership_renewal_ar','email','ar',$s$اقتراب موعد تجديد اشتراك {{child_name}}$s$,$b$مرحباً {{parent_name}}،

كان أداء {{child_name}} رائعاً، ويقترب موعد تجديد اشتراكه في Schowl بتاريخ {{renews_on}}. للحفاظ على الاستمرارية دون انقطاع الحصص، سيتواصل معك فريقنا لمساعدتك في التجديد.

شكراً لكونك جزءاً من رحلة Schowl!$b$),

('payment_receipt_en','email','en',$s$Payment received — thank you! 🧾$s$,$b$Hi {{parent_name}},

We've received your payment of {{amount}} {{currency}} for {{child_name}}'s Schowl membership — thank you! Your membership is active through {{renews_on}}.

Here's to more building, more learning, and more fun ahead.$b$),
('payment_receipt_ar','email','ar',$s$تم استلام الدفعة — شكراً لك! 🧾$s$,$b$مرحباً {{parent_name}}،

استلمنا دفعتك بقيمة {{amount}} {{currency}} لاشتراك {{child_name}} في Schowl — شكراً لك! اشتراكه فعّال حتى {{renews_on}}.

مزيد من البناء والتعلّم والمتعة في الطريق.$b$),

('reengagement_en','email','en',$s${{child_name}}'s spot at Schowl is still open 🌟$s$,$b$Hi {{parent_name}},

It's been a little while, and we've kept {{child_name}}'s spot for a free Schowl coding class open. Kids who start now are building real projects within weeks — and it all begins with one fun session.

Whenever you're ready, we'll help you pick a time. We'd love to welcome {{child_name}}.$b$),
('reengagement_ar','email','ar',$s$مكان {{child_name}} في Schowl ما زال متاحاً 🌟$s$,$b$مرحباً {{parent_name}}،

مرّ بعض الوقت، وقد احتفظنا بمكان {{child_name}} لحصة برمجة تجريبية مجانية مع Schowl. الأطفال الذين يبدؤون الآن يبنون مشاريع حقيقية خلال أسابيع — وكل ذلك يبدأ بحصة ممتعة واحدة.

متى كنت جاهزاً، سنساعدك في اختيار الوقت. يسعدنا أن نرحّب بـ {{child_name}}.$b$),

-- ===== Email: camp funnel =====
('camp_registered_en','email','en',$s$🏕️ {{child_name}} is registered for the Schowl {{camp}} camp!$s$,$b$Hi {{parent_name}},

Woohoo — {{child_name}} is officially registered for the Schowl {{camp}} camp! 🎉

They'll join a small group of 4–5 kids, work with a dedicated instructor, and build real projects together in a fun, supportive space.

Our team will reach out soon with the schedule, the group details, and everything {{child_name}} needs to get started. Get ready for an amazing experience!$b$),
('camp_registered_ar','email','ar',$s$🏕️ تم تسجيل {{child_name}} في معسكر Schowl {{camp}}!$s$,$b$مرحباً {{parent_name}}،

مبروك — تم تسجيل {{child_name}} رسمياً في معسكر Schowl {{camp}}! 🎉

سينضم إلى مجموعة صغيرة من 4–5 أطفال، ويعمل مع مدرّب مخصّص، ويبنون مشاريع حقيقية معاً في جوّ ممتع وداعم.

سيتواصل معك فريقنا قريباً بالجدول وتفاصيل المجموعة وكل ما يحتاجه {{child_name}} للبدء. استعدّوا لتجربة رائعة!$b$),

('camp_group_welcome_en','email','en',$s$Welcome to {{child_name}}'s Schowl camp group! 👋$s$,$b$Hi {{parent_name}},

{{child_name}} has been placed in {{group_name}} for the Schowl {{camp}} camp, alongside a small group of fellow young builders.

Join the parents' group chat here for updates, schedules, and to stay connected: {{chat_link}}

We're excited to get started — see you there!$b$),
('camp_group_welcome_ar','email','ar',$s$أهلاً بك في مجموعة {{child_name}} في معسكر Schowl! 👋$s$,$b$مرحباً {{parent_name}}،

تم وضع {{child_name}} في {{group_name}} في معسكر Schowl {{camp}}، مع مجموعة صغيرة من المبدعين الصغار.

انضم إلى مجموعة أولياء الأمور من هنا لتصلك التحديثات والجداول وتبقى على تواصل: {{chat_link}}

متحمسون للبدء — نراك هناك!$b$),

('camp_reminder_en','email','en',$s$🏕️ {{child_name}}'s Schowl camp starts soon!$s$,$b$Hi {{parent_name}},

The Schowl {{camp}} camp is almost here! {{child_name}}'s first session is coming up on {{scheduled_at}}.

Please make sure they have a laptop or desktop and a stable internet connection ready. Your instructor will share the join link and everything else you need.

Can't wait to see what {{child_name}} builds!$b$),
('camp_reminder_ar','email','ar',$s$🏕️ معسكر {{child_name}} مع Schowl يبدأ قريباً!$s$,$b$مرحباً {{parent_name}}،

معسكر Schowl {{camp}} على الأبواب! حصة {{child_name}} الأولى قريباً يوم {{scheduled_at}}.

يرجى التأكد من توفر لابتوب أو كمبيوتر وإنترنت مستقر. سيشارك المدرّب رابط الانضمام وكل ما تحتاجونه.

متشوقون لرؤية ما سيبنيه {{child_name}}!$b$),

-- ===== WhatsApp =====
('first_contact_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! 👋 This is the Schowl team. Thanks for requesting a free coding trial for {{child_name}}. I'd love to help you pick the best time and course — when works for you this week?$b$),
('first_contact_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! 👋 معك فريق Schowl. شكراً لطلبك حصة برمجة تجريبية مجانية لـ {{child_name}}. يسعدني مساعدتك في اختيار أنسب وقت وكورس — ما الوقت المناسب لك هذا الأسبوع؟$b$),

('trial_time_proposal_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! We can offer {{child_name}} a free Schowl trial on {{scheduled_at}}. Does that time work for you? 😊$b$),
('trial_time_proposal_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! يمكننا تقديم حصة تجريبية مجانية لـ {{child_name}} يوم {{scheduled_at}}. هل يناسبك هذا الوقت؟ 😊$b$),

('trial_confirmed_whatsapp_en','whatsapp','en',null,$b$All set, {{parent_name}}! ✅ {{child_name}}'s free trial is confirmed for {{scheduled_at}} with {{teacher_name}}. Join link: {{meeting_url}} — just have a laptop and internet ready.$b$),
('trial_confirmed_whatsapp_ar','whatsapp','ar',null,$b$تم كل شيء يا {{parent_name}}! ✅ حصة {{child_name}} التجريبية مؤكدة يوم {{scheduled_at}} مع {{teacher_name}}. رابط الانضمام: {{meeting_url}} — فقط جهّز لابتوب وإنترنت.$b$),

('trial_reminder_whatsapp_en','whatsapp','en',null,$b$Reminder 😊 {{child_name}}'s Schowl class is at {{scheduled_at}}. Join here: {{meeting_url}}. See you soon!$b$),
('trial_reminder_whatsapp_ar','whatsapp','ar',null,$b$تذكير 😊 حصة {{child_name}} مع Schowl الساعة {{scheduled_at}}. انضم من هنا: {{meeting_url}}. نراك قريباً!$b$),

('post_trial_followup_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! We hope {{child_name}} enjoyed the trial 🚀 Would you like me to suggest the best plan and weekly schedule to keep them building?$b$),
('post_trial_followup_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! نتمنى أن يكون {{child_name}} استمتع بالحصة 🚀 هل تودّ أن أقترح أفضل خطة وجدول أسبوعي ليستمر في البناء؟$b$),

('payment_next_step_whatsapp_en','whatsapp','en',null,$b$Great, {{parent_name}}! 🎉 The next step is confirming {{child_name}}'s plan and weekly schedule. I'll send the details now.$b$),
('payment_next_step_whatsapp_ar','whatsapp','ar',null,$b$رائع يا {{parent_name}}! 🎉 الخطوة التالية هي تأكيد خطة {{child_name}} وجدوله الأسبوعي. سأرسل لك التفاصيل الآن.$b$),

('no_response_followup_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}} 😊 Just following up on {{child_name}}'s free Schowl trial. Would you like to schedule it this week? It only takes a minute.$b$),
('no_response_followup_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}} 😊 أتابع معك بخصوص حصة {{child_name}} التجريبية المجانية مع Schowl. هل تودّ تحديد موعدها هذا الأسبوع؟ الأمر لا يستغرق سوى دقيقة.$b$),

('camp_invite_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! 👋 Thanks for registering {{child_name}} for the Schowl {{camp}} camp 🏕️ They'll be in a small group of 4–5 kids building real projects. I'll share the schedule and group details shortly — any questions, I'm here!$b$),
('camp_invite_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! 👋 شكراً لتسجيل {{child_name}} في معسكر Schowl {{camp}} 🏕️ سيكون ضمن مجموعة صغيرة من 4–5 أطفال يبنون مشاريع حقيقية. سأشارك الجدول وتفاصيل المجموعة قريباً — أي أسئلة، أنا هنا!$b$)

on conflict (key) do update
set subject = excluded.subject, body = excluded.body, updated_at = now();

commit;
