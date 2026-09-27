begin;

-- Real copy for the featured "summer" camp (from the website). Upsert so a fresh
-- rebuild lands the real content, and the live row is corrected off the placeholder.
insert into public.camp (
  slug, status, is_featured, age_min, age_max,
  title_en, title_ar, tagline_en, tagline_ar, description_en, description_ar,
  tracks, outcomes, faq
) values (
  'summer', 'upcoming', true, 8, 18,
  'Summer Code Camp', 'معسكر البرمجة الصيفي',
  'Level up this summer', 'ارفع مستواك الصيف ده',
  'A live online summer camp where kids code games, build websites, and design their own apps, then show them off at the end of camp.',
  'معسكر صيفي لايف أونلاين، الأطفال فيه بيبرمجوا ألعاب، ويبنوا مواقع، ويصمموا تطبيقاتهم، وبعدين يعرضوها في آخر المعسكر.',
  $j$[{"icon":"scratch","title_en":"Game coding","title_ar":"برمجة الألعاب","body_en":"Build playable games with Scratch or Python: characters, levels, scores and power-ups.","body_ar":"يبني ألعاب حقيقية بسكراتش أو بايثون: شخصيات ومراحل ونقاط."},{"icon":"web","title_en":"Web building","title_ar":"بناء المواقع","body_en":"Design and publish a personal website with HTML, CSS and a little JavaScript.","body_ar":"يصمم وينشر موقعه الشخصي بـ HTML وCSS وشوية JavaScript."},{"icon":"design","title_en":"Digital design","title_ar":"التصميم الرقمي","body_en":"Plan app screens and graphics in Figma: colour, layout and user-friendly design.","body_ar":"يخطط شاشات التطبيقات والجرافيك على Figma: ألوان وتنظيم وتجربة استخدام."},{"icon":"python","title_en":"AI basics","title_ar":"أساسيات الذكاء الاصطناعي","body_en":"Explore how AI tools work, with safe, age-appropriate experiments and projects.","body_ar":"يستكشف إزاي أدوات الذكاء الاصطناعي بتشتغل بتجارب آمنة ومناسبة لسنه."}]$j$::jsonb,
  $j$[{"title_en":"A finished project","title_ar":"مشروع كامل","body_en":"A game, website or app design they built from scratch.","body_ar":"لعبة أو موقع أو تصميم تطبيق بناه بنفسه من الصفر."},{"title_en":"Show & tell","title_ar":"اعرض شغلك","body_en":"Campers present what they built at the end of camp.","body_ar":"كل طالب بيعرض اللي بناه في آخر المعسكر."},{"title_en":"Portfolio piece","title_ar":"إضافة لملف الأعمال","body_en":"A project page they can share and keep building on.","body_ar":"صفحة مشروع يقدر يشاركها ويكمل عليها."},{"title_en":"Real confidence","title_ar":"ثقة حقيقية","body_en":"Explaining their own project out loud, like a real developer.","body_ar":"يشرح مشروعه بصوت عالي زي أي مطوّر حقيقي."}]$j$::jsonb,
  $j$[{"question_en":"Does my child need coding experience?","question_ar":"طفلي محتاج خبرة في البرمجة؟","answer_en":"No. Tracks start from the basics and we group campers by age and level.","answer_ar":"لأ. المسارات بتبدأ من الأساسيات وبنقسم الطلاب حسب السن والمستوى."},{"question_en":"Is the camp online?","question_ar":"المعسكر أونلاين؟","answer_en":"Yes. Classes are live online in small groups with a real instructor.","answer_ar":"أيوه. الحصص لايف أونلاين في مجموعات صغيرة مع مدرب حقيقي."},{"question_en":"When does the camp start?","question_ar":"المعسكر هيبدأ امتى؟","answer_en":"Dates are announced soon. Register and we will contact you with the schedule first.","answer_ar":"المواعيد هتتعلن قريب. سجّل وهنتواصل معاك بالجدول الأول."},{"question_en":"What does my child need?","question_ar":"طفلي محتاج إيه؟","answer_en":"A laptop or desktop computer with a stable internet connection.","answer_ar":"لابتوب أو كمبيوتر مع إنترنت مستقر."}]$j$::jsonb
)
on conflict (slug) do update set
  status = excluded.status,
  is_featured = excluded.is_featured,
  age_min = excluded.age_min,
  age_max = excluded.age_max,
  title_en = excluded.title_en,
  title_ar = excluded.title_ar,
  tagline_en = excluded.tagline_en,
  tagline_ar = excluded.tagline_ar,
  description_en = excluded.description_en,
  description_ar = excluded.description_ar,
  tracks = excluded.tracks,
  outcomes = excluded.outcomes,
  faq = excluded.faq,
  updated_at = now();

commit;
