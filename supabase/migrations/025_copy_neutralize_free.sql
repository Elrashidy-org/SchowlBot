begin;

-- Standing rule: never call the trial "free" or "paid" (EN or AR). Also: camp
-- emails use the camp's own title (passed as {{camp}}), not "Schowl <slug> camp",
-- and drop the hard "4–5 kids" group-size claim in favour of "a small group".
insert into public.communication_template (key, channel, language, subject, body) values

('lead_received_en','email','en',$s$We've reserved {{child_name}}'s Schowl trial 🎉$s$,$b$Hi {{parent_name}},

Thank you for choosing Schowl! We've saved a spot for {{child_name}}'s trial lesson — a hands-on session where they'll start building a real project from day one.

Our team will reach out shortly on WhatsApp or by phone to lock in the best time and the right course for {{child_name}}.

Get ready to see {{child_name}} create something amazing.$b$),
('lead_received_ar','email','ar',$s$حجزنا لـ {{child_name}} حصته التجريبية 🎉$s$,$b$مرحباً {{parent_name}}،

شكراً لاختيارك Schowl! لقد حجزنا لـ {{child_name}} حصة تجريبية — حصة عملية يبدأ فيها ببناء مشروع حقيقي من أول يوم.

سيتواصل معك فريقنا قريباً عبر واتساب أو الهاتف لتحديد أنسب وقت والكورس المناسب لـ {{child_name}}.

استعدّ لترى {{child_name}} يبدع شيئاً مذهلاً.$b$),

('trial_booked_en','email','en',$s$It's set — {{child_name}}'s trial is booked ✅$s$,$b$Hi {{parent_name}},

Great news — {{child_name}}'s trial lesson is confirmed for {{scheduled_at}} (Cairo time){{teacher_line}}.

Join here at the scheduled time: {{meeting_url}}

We've attached a calendar invite so it's easy to remember. Please have a laptop or desktop ready with a stable internet connection.{{whatsapp_line}}$b$),
('trial_booked_ar','email','ar',$s$تم الحجز — حصة {{child_name}} التجريبية مؤكدة ✅$s$,$b$مرحباً {{parent_name}}،

خبر رائع — تم تأكيد حصة {{child_name}} التجريبية يوم {{scheduled_at}} (بتوقيت القاهرة){{teacher_line}}.

انضم من هنا في الموعد: {{meeting_url}}

أرفقنا دعوة تقويم لتسهيل التذكّر. يرجى تجهيز لابتوب أو كمبيوتر مع إنترنت مستقر.{{whatsapp_line}}$b$),

('no_response_followup_24h_en','email','en',$s$Still keen to see {{child_name}} build? 💡$s$,$b$Hi {{parent_name}},

We tried to reach you about {{child_name}}'s Schowl trial and didn't want you to miss the spot. Whenever you're ready, we'll help you pick a time that works — it only takes a minute.

Just let us know and we'll take it from there.$b$),
('no_response_followup_24h_ar','email','ar',$s$ما زلت متشوقاً لترى {{child_name}} يبدع؟ 💡$s$,$b$مرحباً {{parent_name}}،

حاولنا التواصل معك بخصوص حصة {{child_name}} التجريبية ولم نرغب أن تفوّتها. متى كنت جاهزاً، سنساعدك في اختيار وقت مناسب — الأمر لا يستغرق سوى دقيقة.

فقط أخبرنا وسنتولى الباقي.$b$),

('reengagement_en','email','en',$s${{child_name}}'s spot at Schowl is still open 🌟$s$,$b$Hi {{parent_name}},

It's been a little while, and we've kept {{child_name}}'s spot for a Schowl trial lesson open. Kids who start now are building real projects within weeks — and it all begins with one fun session.

Whenever you're ready, we'll help you pick a time. We'd love to welcome {{child_name}}.$b$),
('reengagement_ar','email','ar',$s$مكان {{child_name}} في Schowl ما زال متاحاً 🌟$s$,$b$مرحباً {{parent_name}}،

مرّ بعض الوقت، وقد احتفظنا بمكان {{child_name}} لحصة تجريبية مع Schowl. الأطفال الذين يبدؤون الآن يبنون مشاريع حقيقية خلال أسابيع — وكل ذلك يبدأ بحصة ممتعة واحدة.

متى كنت جاهزاً، سنساعدك في اختيار الوقت. يسعدنا أن نرحّب بـ {{child_name}}.$b$),

('booking_abandoned_en','email','en',$s$You're one step away from {{child_name}}'s trial lesson 🎓$s$,$b$Hi {{parent_name}},

It looks like you started booking a Schowl trial but didn't finish. Your spot is still open — it only takes a minute to pick a time.

Reply to this email or message us and we'll help you lock it in.{{whatsapp_line}}$b$),
('booking_abandoned_ar','email','ar',$s$تفصلك خطوة واحدة عن حصة {{child_name}} التجريبية 🎓$s$,$b$مرحباً {{parent_name}}،

يبدو أنك بدأت حجز حصة تجريبية مع Schowl ولم تُكملها. مكانك ما زال محجوزاً — الأمر لا يستغرق سوى دقيقة لاختيار الوقت.

ردّ على هذا البريد أو راسلنا وسنساعدك في إتمام الحجز.{{whatsapp_line}}$b$),

('camp_registered_en','email','en',$s$🏕️ {{child_name}} is registered for {{camp}}!$s$,$b$Hi {{parent_name}},

Woohoo — {{child_name}} is officially registered for {{camp}}! 🎉

They'll join a small group, work with a dedicated instructor, and build real projects together in a fun, supportive space.

Our team will reach out soon with the schedule, the group details, and everything {{child_name}} needs to get started. Get ready for an amazing experience!$b$),
('camp_registered_ar','email','ar',$s$🏕️ تم تسجيل {{child_name}} في {{camp}}!$s$,$b$مرحباً {{parent_name}}،

مبروك — تم تسجيل {{child_name}} رسمياً في {{camp}}! 🎉

سينضم إلى مجموعة صغيرة، ويعمل مع مدرّب مخصّص، ويبنون مشاريع حقيقية معاً في جوّ ممتع وداعم.

سيتواصل معك فريقنا قريباً بالجدول وتفاصيل المجموعة وكل ما يحتاجه {{child_name}} للبدء. استعدّوا لتجربة رائعة!$b$),

('camp_group_welcome_en','email','en',$s$Welcome to {{child_name}}'s Schowl camp group! 👋$s$,$b$Hi {{parent_name}},

{{child_name}} has been placed in {{group_name}} for {{camp}}, alongside a small group of fellow young builders.

Join the parents' group chat here for updates, schedules, and to stay connected: {{chat_link}}

We're excited to get started — see you there!$b$),
('camp_group_welcome_ar','email','ar',$s$أهلاً بك في مجموعة {{child_name}} في Schowl! 👋$s$,$b$مرحباً {{parent_name}}،

تم وضع {{child_name}} في {{group_name}} ضمن {{camp}}، مع مجموعة صغيرة من المبدعين الصغار.

انضم إلى مجموعة أولياء الأمور من هنا لتصلك التحديثات والجداول وتبقى على تواصل: {{chat_link}}

متحمسون للبدء — نراك هناك!$b$),

('camp_reminder_en','email','en',$s$🏕️ {{child_name}}'s Schowl camp starts soon!$s$,$b$Hi {{parent_name}},

{{camp}} is almost here! {{child_name}}'s first session is coming up on {{scheduled_at}}.

Please make sure they have a laptop or desktop and a stable internet connection ready. Your instructor will share the join link and everything else you need.

Can't wait to see what {{child_name}} builds!$b$),
('camp_reminder_ar','email','ar',$s$🏕️ معسكر {{child_name}} مع Schowl يبدأ قريباً!$s$,$b$مرحباً {{parent_name}}،

{{camp}} على الأبواب! حصة {{child_name}} الأولى قريباً يوم {{scheduled_at}}.

يرجى التأكد من توفر لابتوب أو كمبيوتر وإنترنت مستقر. سيشارك المدرّب رابط الانضمام وكل ما تحتاجونه.

متشوقون لرؤية ما سيبنيه {{child_name}}!$b$),

('first_contact_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! 👋 This is the Schowl team. Thanks for requesting a coding trial for {{child_name}}. I'd love to help you pick the best time and course — when works for you this week?$b$),
('first_contact_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! 👋 معك فريق Schowl. شكراً لطلبك حصة برمجة تجريبية لـ {{child_name}}. يسعدني مساعدتك في اختيار أنسب وقت وكورس — ما الوقت المناسب لك هذا الأسبوع؟$b$),

('trial_time_proposal_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! We can offer {{child_name}} a Schowl trial on {{scheduled_at}}. Does that time work for you? 😊$b$),
('trial_time_proposal_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! يمكننا تقديم حصة تجريبية لـ {{child_name}} يوم {{scheduled_at}}. هل يناسبك هذا الوقت؟ 😊$b$),

('trial_confirmed_whatsapp_en','whatsapp','en',null,$b$All set, {{parent_name}}! ✅ {{child_name}}'s trial is confirmed for {{scheduled_at}} with {{teacher_name}}. Join link: {{meeting_url}} — just have a laptop and internet ready.$b$),

('no_response_followup_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}} 😊 Just following up on {{child_name}}'s Schowl trial. Would you like to schedule it this week? It only takes a minute.$b$),
('no_response_followup_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}} 😊 أتابع معك بخصوص حصة {{child_name}} التجريبية مع Schowl. هل تودّ تحديد موعدها هذا الأسبوع؟ الأمر لا يستغرق سوى دقيقة.$b$),

('camp_invite_whatsapp_en','whatsapp','en',null,$b$Hi {{parent_name}}! 👋 Thanks for registering {{child_name}} for {{camp}} 🏕️ They'll be in a small group building real projects. I'll share the schedule and group details shortly — any questions, I'm here!$b$),
('camp_invite_whatsapp_ar','whatsapp','ar',null,$b$مرحباً {{parent_name}}! 👋 شكراً لتسجيل {{child_name}} في {{camp}} 🏕️ سيكون ضمن مجموعة صغيرة يبنون مشاريع حقيقية. سأشارك الجدول وتفاصيل المجموعة قريباً — أي أسئلة، أنا هنا!$b$)

on conflict (key) do update
set subject = excluded.subject, body = excluded.body, updated_at = now();

commit;
