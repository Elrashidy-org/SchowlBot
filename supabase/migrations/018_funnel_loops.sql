-- Funnel loops: a nurture state for cold-but-not-dead leads, a course
-- progression path for upsells, and win-back / upsell email copy.

-- 'nurturing' = engaged-but-parked leads that drip via /reengage instead of
-- being hard-lost. Run at top level (ALTER TYPE ADD VALUE can't be used inside
-- the same transaction that adds it).
alter type public.lead_status add value if not exists 'nurturing';

begin;

-- Course progression: what a student naturally moves up to next.
alter table public.courses add column if not exists next_course_id uuid references public.courses(id) on delete set null;

insert into public.communication_template (key, channel, language, subject, body)
values
  ('winback_en', 'email', 'en', $s$We saved {{child_name}}'s spot at Schowl 💛$s$, $b$Hi {{parent_name}},

We noticed {{child_name}} hasn't had a Schowl lesson in a little while, and we wanted to reach out — the kids who keep going are the ones who end up building things they're genuinely proud of.

Whenever you're ready to pick things back up, we'll sort out a time and the right next step for {{child_name}}. Just reply to this email.

We'd love to have {{child_name}} back building with us.$b$),
  ('winback_ar', 'email', 'ar', $s$احتفظنا بمكان {{child_name}} في Schowl 💛$s$, $b$مرحباً {{parent_name}}،

لاحظنا أن {{child_name}} لم يحضر حصة في Schowl منذ فترة، وأردنا التواصل معك — فالأطفال الذين يواصلون هم من يبنون في النهاية مشاريع يفخرون بها حقاً.

متى كنت مستعداً للعودة، سنرتّب موعداً والخطوة التالية المناسبة لـ {{child_name}}. فقط ردّ على هذا البريد.

يسعدنا أن يعود {{child_name}} للبناء معنا.$b$),

  ('progression_upsell_en', 'email', 'en', $s${{child_name}} is ready for {{next_course}} 🎓$s$, $b$Hi {{parent_name}},

Big news — {{child_name}} has finished the current set of lessons and is ready to level up to {{next_course}}!

This is where things get really exciting: new challenges, bigger projects, and skills that build directly on everything {{child_name}} has learned so far. Our team will reach out to help you set up the next package.

So proud of how far {{child_name}} has come.$b$),
  ('progression_upsell_ar', 'email', 'ar', $s${{child_name}} جاهز للانتقال إلى {{next_course}} 🎓$s$, $b$مرحباً {{parent_name}}،

خبر رائع — أنهى {{child_name}} مجموعة الحصص الحالية وأصبح جاهزاً للانتقال إلى {{next_course}}!

هنا تبدأ المتعة الحقيقية: تحدّيات جديدة ومشاريع أكبر ومهارات تُبنى مباشرة على كل ما تعلّمه {{child_name}} حتى الآن. سيتواصل معك فريقنا لمساعدتك في إعداد الباقة التالية.

نحن فخورون جداً بما حققه {{child_name}}.$b$)
on conflict (key) do update
set subject = excluded.subject,
    body = excluded.body,
    updated_at = now();

commit;
