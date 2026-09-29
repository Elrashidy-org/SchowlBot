import { config } from "../config.js";

// Schowl "arcade" brand palette (matches the website).
const PAGE_BG = "#f4f2ff";
const CARD = "#ffffff";
const CARD_BORDER = "#e2dcff";
const TITLE = "#1b1f5e";
const TITLE_SHADOW = "#7c5cff";
const BODY = "#151a4a";
const MUTED = "#4a5280";
const BTN_BG = "#4df2c4";
const BTN_TEXT = "#0b1030";
const BTN_BORDER = "#16b58f";
const INFO_BG = "#f6f4ff";
const CHIP_BG = "#eafff8";
const CHIP_TEXT = "#0b6b52";
const CHIP_BORDER = "#4df2c4";
const FOOTER_BG = "#0b1030";
const FOOTER_TEXT = "#c7d0f0";
// Same type system as schowl.com: Cairo for body text; display type (titles,
// chips, buttons) is Press Start 2P in English and Changa in Arabic. Clients
// that block web fonts (e.g. Gmail) fall back to the system fonts listed.
const BODY_FONT = "'Cairo',Tahoma,Arial,sans-serif";
const TITLE_FONT_EN = "'Press Start 2P','Arial Black',Arial,sans-serif";
const TITLE_FONT_AR = "'Changa','Cairo',Tahoma,Arial,sans-serif";
const displayFont = (rtl?: boolean) => (rtl ? TITLE_FONT_AR : TITLE_FONT_EN);

type Hero = "jump" | "owl" | null;
type Cta = "trial" | "join" | "none";
interface EmailMeta {
  chip: { en: string; ar: string };
  hero: Hero;
  cta: Cta;
  infoBox?: boolean;
}

// Per-template presentation, keyed by the base template key.
const EMAIL_META: Record<string, EmailMeta> = {
  lead_received: { chip: { en: "NEW QUEST", ar: "مهمة جديدة" }, hero: "jump", cta: "trial" },
  trial_booked: { chip: { en: "LEVEL CLEARED", ar: "تم الحجز" }, hero: "jump", cta: "join", infoBox: true },
  trial_reminder_24h: { chip: { en: "REMINDER", ar: "تذكير" }, hero: "owl", cta: "join", infoBox: true },
  trial_reminder_1h: { chip: { en: "STARTING SOON", ar: "تبدأ قريباً" }, hero: "owl", cta: "join", infoBox: true },
  trial_done_next_steps: { chip: { en: "GREAT RUN", ar: "أداء رائع" }, hero: "jump", cta: "trial" },
  no_response_followup_24h: { chip: { en: "STILL OPEN", ar: "ما زال متاحاً" }, hero: "owl", cta: "trial" },
  booking_abandoned: { chip: { en: "ALMOST THERE", ar: "اقتربت" }, hero: "owl", cta: "trial" },
  converted_welcome: { chip: { en: "WELCOME", ar: "أهلاً بك" }, hero: "jump", cta: "none" },
  lesson_reminder: { chip: { en: "REMINDER", ar: "تذكير" }, hero: "owl", cta: "join", infoBox: true },
  lessons_running_low: { chip: { en: "LEVEL UP", ar: "واصل التقدّم" }, hero: "owl", cta: "none" },
  membership_renewal: { chip: { en: "KEEP GOING", ar: "استمر" }, hero: "owl", cta: "none" },
  payment_receipt: { chip: { en: "RECEIPT", ar: "إيصال" }, hero: "jump", cta: "none" },
  reengagement: { chip: { en: "STILL OPEN", ar: "ما زال متاحاً" }, hero: "owl", cta: "trial" },
  winback: { chip: { en: "COME BACK", ar: "عد إلينا" }, hero: "owl", cta: "trial" },
  progression_upsell: { chip: { en: "LEVEL UP", ar: "مستوى جديد" }, hero: "jump", cta: "none" },
  camp_registered: { chip: { en: "YOU'RE IN", ar: "تم التسجيل" }, hero: "jump", cta: "none" },
  camp_group_welcome: { chip: { en: "YOUR GROUP", ar: "مجموعتك" }, hero: "jump", cta: "none" },
  camp_reminder: { chip: { en: "STARTING SOON", ar: "تبدأ قريباً" }, hero: "owl", cta: "none" },
  student_report: { chip: { en: "PROGRESS", ar: "التقدّم" }, hero: "jump", cta: "none" },
};
const DEFAULT_META: EmailMeta = { chip: { en: "SCHOWL", ar: "Schowl" }, hero: null, cta: "trial" };

function escapeHtml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function autolink(value: string) {
  return value.replace(
    /(https?:\/\/[^\s<]+)/g,
    `<a href="$1" style="color:#5b3df2;text-decoration:underline;font-weight:700;">$1</a>`,
  );
}

// Map a course name/keyword to the website's course filter, for the trial CTA.
function courseKeyword(value?: string | null) {
  const v = (value || "").toLowerCase();
  if (!v) return null;
  if (v.includes("python")) return "python";
  if (v.includes("scratch")) return "scratch";
  if (v.includes("web")) return "web";
  if (v.includes("game")) return "game";
  if (v.includes("flutter") || v.includes("mobile") || v.includes("app")) return "mobile";
  if (v.includes("graphic") || v.includes("design")) return "design";
  return null;
}

function bookTrialUrl(rtl: boolean, keyword: string | null) {
  const base = `https://schowl.com${rtl ? "/ar" : ""}/book-trial/`;
  return keyword ? `${base}?course=${keyword}` : base;
}

// A bulletproof (table-based) button that renders in every email client.
function button(label: string, url: string, opts: { primary?: boolean; rtl?: boolean } = {}) {
  const primary = opts.primary !== false;
  const bg = primary ? BTN_BG : CARD;
  const color = primary ? BTN_TEXT : TITLE;
  const border = primary ? `border-bottom:4px solid ${BTN_BORDER};` : `border:1px solid ${CARD_BORDER};`;
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 auto 12px;"><tr><td style="border-radius:10px;background:${bg};${border}">
    <a href="${url}" style="display:inline-block;padding:14px 22px;color:${color};font-size:${opts.rtl ? "17px" : "11px"};line-height:1.6;font-weight:700;letter-spacing:${opts.rtl ? "0" : "0.04em"};text-transform:${opts.rtl ? "none" : "uppercase"};text-decoration:none;font-family:${displayFont(opts.rtl)};">${escapeHtml(
    label,
  )}</a>
  </td></tr></table>`;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

export function renderBrandedEmail(input: {
  subject?: string | null;
  body: string;
  language?: string | null;
  baseKey?: string | null;
  context?: Record<string, string | number | null | undefined>;
  unsubscribeUrl?: string;
  assetBaseUrl?: string;
}): RenderedEmail {
  const rtl = input.language === "ar";
  const dir = rtl ? "rtl" : "ltr";
  const align = rtl ? "right" : "left";
  const ctx = input.context || {};
  const meta = (input.baseKey && EMAIL_META[input.baseKey]) || DEFAULT_META;
  const assets = (input.assetBaseUrl || `${config.publicApiBaseUrl}/static/email`).replace(/\/$/, "");
  const t = (en: string, ar: string) => (rtl ? ar : en);

  const paragraphs = input.body
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(
      (line) =>
        `<p style="margin:0 0 16px;color:${BODY};font-size:16px;line-height:1.6;text-align:${align};">${autolink(
          escapeHtml(line),
        )}</p>`,
    )
    .join("");

  // Chip.
  const chip = `<div style="text-align:${align};margin:0 0 12px;"><span style="display:inline-block;background:${CHIP_BG};color:${CHIP_TEXT};border:1px solid ${CHIP_BORDER};border-radius:999px;padding:5px 12px;font-size:${rtl ? "14px" : "9px"};line-height:1.6;font-weight:700;letter-spacing:${rtl ? "0" : "0.06em"};font-family:${displayFont(rtl)};">${escapeHtml(
    t(meta.chip.en, meta.chip.ar),
  )}</span></div>`;

  // Hero owl.
  const heroSrc = meta.hero === "jump" ? "owl-jump.png" : meta.hero === "owl" ? "owl.png" : null;
  const hero = heroSrc
    ? `<div style="text-align:center;margin:4px 0 14px;"><img src="${assets}/${heroSrc}" alt="Schowl owl" width="104" height="104" style="width:104px;height:104px;border:0;image-rendering:pixelated;"></div>`
    : "";

  // Title: pixel type for EN, Changa for AR (as on the website).
  const titleFont = displayFont(rtl);
  const titleSize = rtl ? "24px" : "17px";
  const heading = input.subject
    ? `<h1 style="margin:0 0 18px;color:${TITLE};font-family:${titleFont};font-size:${titleSize};line-height:1.5;font-weight:700;letter-spacing:0.04em;text-align:${align};text-shadow:0 2px 0 ${TITLE_SHADOW};text-transform:${
        rtl ? "none" : "uppercase"
      };">${escapeHtml(input.subject)}</h1>`
    : "";

  // Info box (date/time, course, child) for confirmations & reminders.
  let infoBox = "";
  if (meta.infoBox) {
    const rows: { label: string; value: string }[] = [];
    if (ctx.scheduled_at) rows.push({ label: t("When", "الموعد"), value: `${ctx.scheduled_at} (Africa/Cairo)` });
    const course = ctx.course_interest || ctx.course || ctx.quiz_recommendation;
    if (course) rows.push({ label: t("Course", "الكورس"), value: String(course) });
    if (ctx.child_name) rows.push({ label: t("Student", "الطالب"), value: String(ctx.child_name) });
    if (rows.length) {
      infoBox = `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;background:${INFO_BG};border-radius:12px;"><tr><td style="padding:16px 18px;" dir="${dir}">${rows
        .map(
          (r) =>
            `<div style="margin:0 0 8px;text-align:${align};"><span style="display:block;color:${MUTED};font-size:11px;text-transform:uppercase;letter-spacing:0.05em;font-family:${BODY_FONT};">${escapeHtml(
              r.label,
            )}</span><span style="color:${BODY};font-size:15px;font-weight:700;font-family:${BODY_FONT};">${escapeHtml(
              r.value,
            )}</span></div>`,
        )
        .join("")}</td></tr></table>`;
    }
  }

  // CTAs.
  let ctas = "";
  const ctaUrls: string[] = [];
  if (meta.cta === "join") {
    const meetingUrl = ctx.meeting_url && String(ctx.meeting_url).startsWith("http") ? String(ctx.meeting_url) : null;
    if (meetingUrl) {
      ctas += button(t("Join the lesson", "انضم للحصة"), meetingUrl, { primary: true, rtl });
      ctaUrls.push(meetingUrl);
    }
    if (ctx.calendar_url) {
      ctas += button(t("Add to Google Calendar", "أضف إلى تقويم جوجل"), String(ctx.calendar_url), { primary: false, rtl });
      ctaUrls.push(String(ctx.calendar_url));
    }
    if (!meetingUrl && !ctx.calendar_url) {
      const url = bookTrialUrl(rtl, null);
      ctas += button(t("Book a trial", "احجز حصة تجريبية"), url, { primary: true, rtl });
      ctaUrls.push(url);
    }
  } else if (meta.cta === "trial") {
    const url = bookTrialUrl(rtl, courseKeyword(String(ctx.course_interest || ctx.quiz_recommendation || "")));
    ctas += button(t("Book a trial", "احجز حصة تجريبية"), url, { primary: true, rtl });
    ctaUrls.push(url);
  }
  const ctaBlock = ctas ? `<div style="text-align:center;margin:8px 0 4px;">${ctas}</div>` : "";

  // Footer links.
  const footerLinks: string[] = [];
  if (config.supportWhatsapp) {
    footerLinks.push(
      `<a href="https://wa.me/${config.supportWhatsapp.replace(/\D/g, "")}" style="color:${FOOTER_TEXT};text-decoration:underline;">WhatsApp</a>`,
    );
  }
  footerLinks.push(`<a href="https://schowl.com" style="color:${FOOTER_TEXT};text-decoration:underline;">schowl.com</a>`);
  if (input.unsubscribeUrl) {
    footerLinks.push(
      `<a href="${input.unsubscribeUrl}" style="color:${FOOTER_TEXT};text-decoration:underline;">${t("Unsubscribe", "إلغاء الاشتراك")}</a>`,
    );
  }

  const preheader = input.subject ? escapeHtml(input.subject) : "Schowl";

  const html = `<!doctype html>
<html dir="${dir}" lang="${rtl ? "ar" : "en"}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="light">
<link href="https://fonts.googleapis.com/css2?family=Cairo:wght@400;600;700;800&family=Changa:wght@500;700&family=Press+Start+2P&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:${PAGE_BG};font-family:${BODY_FONT};">
<span style="display:none;max-height:0;overflow:hidden;opacity:0;">${preheader}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PAGE_BG};padding:24px 12px;">
  <tr><td align="center">
    <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="width:560px;max-width:100%;">
      <tr><td style="padding:6px 4px 18px;text-align:${align};" dir="${dir}">
        <img src="${assets}/schowl-logo.png" alt="Schowl" width="176" height="33" style="width:176px;height:33px;border:0;">
      </td></tr>
      <tr><td style="background:${CARD};border:1px solid ${CARD_BORDER};border-radius:16px;padding:28px;" dir="${dir}">
        ${chip}
        ${hero}
        ${heading}
        ${paragraphs}
        ${infoBox}
        ${ctaBlock}
      </td></tr>
      <tr><td style="height:14px;line-height:14px;font-size:0;">&nbsp;</td></tr>
      <tr><td style="background:${FOOTER_BG};border-radius:16px;padding:22px;text-align:center;" dir="${dir}">
        <img src="${assets}/schowl-logo-white.png" alt="Schowl" width="132" height="24" style="width:132px;height:24px;border:0;margin-bottom:12px;">
        <div style="color:${FOOTER_TEXT};font-size:12px;line-height:1.7;font-family:${BODY_FONT};">
          ${footerLinks.join(' &nbsp;·&nbsp; ')}<br>
          ${t("Online coding & design for kids 8–18.", "برمجة وتصميم أونلاين للأطفال من 8 إلى 18 سنة.")}<br>
          ${t("This is an automated message.", "هذه رسالة تلقائية.")}
        </div>
      </td></tr>
    </table>
  </td></tr>
</table>
</body>
</html>`;

  // Plain-text alternative.
  const textParts = [
    t(meta.chip.en, meta.chip.ar),
    input.subject || "",
    "",
    ...input.body.split(/\n+/).map((l) => l.trim()).filter(Boolean),
  ];
  if (ctaUrls.length) {
    textParts.push("");
    textParts.push(...ctaUrls);
  }
  textParts.push("", "— Schowl · https://schowl.com");
  if (input.unsubscribeUrl) textParts.push(`${t("Unsubscribe", "إلغاء الاشتراك")}: ${input.unsubscribeUrl}`);
  const text = textParts.join("\n");

  return { html, text };
}
