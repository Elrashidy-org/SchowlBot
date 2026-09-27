import { mkdirSync, copyFileSync, writeFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { renderForLead } from "../src/services/templateService.js";
import { renderBrandedEmail } from "../src/utils/emailTemplate.js";

// Renders every parent-facing email (EN + AR) to standalone HTML files so they
// can be opened in a browser and screenshotted. Reads copy from the live DB.
const OUT = "/tmp/schowl-email-previews";
const ASSETS_SRC = "assets/email";

mkdirSync(OUT, { recursive: true });
for (const f of readdirSync(ASSETS_SRC)) copyFileSync(join(ASSETS_SRC, f), join(OUT, f));

const sample: Record<string, string | number> = {
  parent_name: "Sara",
  child_name: "Yusuf",
  course_interest: "Python Course",
  quiz_recommendation: "python",
  scheduled_at: "Mon, 6 Oct 2026 · 18:00",
  meeting_url: "https://meet.google.com/abc-defg-hij",
  teacher_line: " with Coach Belal",
  whatsapp_line: "",
  calendar_url: "https://calendar.google.com/calendar/render?action=TEMPLATE&text=Schowl+trial",
  amount: 3200,
  currency: "EGP",
  lessons_remaining: 2,
  next_course: "Web Development Course",
  camp: "summer",
  group_name: "summer #1",
  chat_link: "https://chat.whatsapp.com/example",
  renews_on: "2026-11-01",
};

// DB-backed templates.
const keys = [
  "lead_received",
  "trial_booked",
  "trial_reminder_24h",
  "trial_reminder_1h",
  "trial_done_next_steps",
  "no_response_followup_24h",
  "booking_abandoned",
  "converted_welcome",
  "lesson_reminder",
  "lessons_running_low",
  "membership_renewal",
  "payment_receipt",
  "reengagement",
  "winback",
  "progression_upsell",
  "camp_registered",
  "camp_group_welcome",
  "camp_reminder",
];

const written: string[] = [];

for (const key of keys) {
  for (const lang of ["en", "ar"] as const) {
    const ctx = { ...sample, camp: lang === "ar" ? "معسكر البرمجة الصيفي" : "Summer Code Camp" };
    const rendered = await renderForLead(key, lang, ctx);
    const email = renderBrandedEmail({
      subject: rendered.subject,
      body: rendered.body,
      language: lang,
      baseKey: key,
      context: ctx,
      unsubscribeUrl: "https://bot.schowl.com/unsubscribe?e=demo",
      assetBaseUrl: ".",
    });
    const file = join(OUT, `${key}_${lang}.html`);
    writeFileSync(file, email.html);
    written.push(file);
  }
}

// student_report has no DB template — render its in-code body directly.
for (const lang of ["en", "ar"] as const) {
  const email = renderBrandedEmail({
    subject: "Yusuf's progress report",
    body:
      lang === "ar"
        ? "مرحباً Sara، هذا تقرير تقدّم Yusuf مع Schowl.\nمتوسط التقييم: 4.5/5 عبر 6 حصص.\n2026-09-20 — التقييم 5/5\n2026-09-27 — التقييم 4/5"
        : "Hi Sara, here is Yusuf's Schowl progress report.\nAverage rating: 4.5/5 across 6 sessions.\n2026-09-20 — rating 5/5\n2026-09-27 — rating 4/5",
    language: lang,
    baseKey: "student_report",
    context: sample,
    assetBaseUrl: ".",
  });
  const file = join(OUT, `student_report_${lang}.html`);
  writeFileSync(file, email.html);
  written.push(file);
}

console.log(`Wrote ${written.length} files to ${OUT}`);
for (const f of written) console.log(f);
