import { Resend } from "resend";
import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import { ClientLead } from "../types.js";
import { renderForLead } from "./templateService.js";
import { renderBrandedEmail } from "../utils/emailTemplate.js";
import { listCoursesForUpsell } from "./courseService.js";
import { unsubscribeUrl } from "../utils/unsubscribe.js";

// True if the address has opted out of all emails.
export async function isUnsubscribed(email: string) {
  const { data } = await supabase
    .from("email_unsubscribe")
    .select("email")
    .eq("email", email.trim().toLowerCase())
    .maybeSingle();
  return Boolean(data);
}

const COURSES_URL = "https://www.schowl.com/#courses";
// Templates where the upsell would be a distraction (e.g. the pre-lesson reminder).
const NO_UPSELL_TEMPLATES = new Set(["trial_reminder_24h"]);

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/\bcourse\b/gi, "")
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function buildCourseUpsell(language: string | null) {
  try {
    const rows = await listCoursesForUpsell();
    const ar = language === "ar";
    const template = config.emailCourseUrlTemplate;
    return rows
      .map((c) => {
        const name = (ar ? c.name_ar : c.name_en) || c.name_en || c.name_ar || "";
        const ageText =
          c.min_age && c.max_age
            ? ar
              ? `من ${c.min_age} إلى ${c.max_age} سنة`
              : `Ages ${c.min_age}–${c.max_age}`
            : undefined;
        const url =
          template && c.name_en
            ? template.replace("{slug}", slugify(c.name_en)).replace("{id}", c.id)
            : undefined;
        return { name, ageText, url };
      })
      .filter((c) => c.name);
  } catch (error) {
    console.error("Course upsell fetch failed", error);
    return [];
  }
}

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

// `templateKey` is a base key (e.g. "lead_received"); the language variant is
// chosen from the lead's language.
export async function sendLeadEmail(
  lead: ClientLead,
  templateKey: string,
  extraContext: Record<string, string | number | null | undefined> = {},
) {
  if (!resend || !lead.email) {
    return;
  }
  if (await isUnsubscribed(lead.email)) {
    return;
  }

  const rendered = await renderForLead(templateKey, lead.language, {
    parent_name: lead.parent_name,
    child_name: lead.child_name,
    course_interest: lead.course_interest,
    ...extraContext,
  });

  try {
    const result = await resend.emails.send({
      from: config.resendFromEmail,
      to: lead.email,
      subject: rendered.subject || "Schowl",
      html: renderBrandedEmail({
        subject: rendered.subject,
        body: rendered.body,
        language: lead.language,
        logoUrl: config.emailLogoUrl,
        courses: NO_UPSELL_TEMPLATES.has(templateKey) ? [] : await buildCourseUpsell(lead.language),
        coursesUrl: COURSES_URL,
        unsubscribeUrl: unsubscribeUrl(lead.email),
      }),
    });

    await supabase.from("communication_log").insert({
      lead_id: lead.id,
      channel: "email",
      template_key: templateKey,
      recipient: lead.email,
      status: "sent",
      provider_message_id: result.data?.id,
      metadata: result,
    });
  } catch (error) {
    await supabase.from("communication_log").insert({
      lead_id: lead.id,
      channel: "email",
      template_key: templateKey,
      recipient: lead.email,
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
  }
}

// Email a parent their child's progress report (session dates, ratings, recordings).
export async function sendStudentReport(input: {
  to: string | null | undefined;
  language?: string | null;
  parentName?: string | null;
  childName: string;
  avgRating: number | null;
  sessions: { date: string; rating: number | null; recordingUrl: string | null }[];
}) {
  if (!resend || !input.to) return false;
  if (await isUnsubscribed(input.to)) return false;
  const lines = input.sessions.map(
    (s) => `${s.date} — rating ${s.rating ?? "-"}/5${s.recordingUrl ? `  ${s.recordingUrl}` : ""}`,
  );
  const body = [
    `Hi ${input.parentName || ""}, here is ${input.childName}'s Schowl progress report.`,
    `Average rating: ${input.avgRating != null ? input.avgRating.toFixed(1) : "-"}/5 across ${input.sessions.length} session(s).`,
    ...lines,
  ].join("\n");
  try {
    await resend.emails.send({
      from: config.resendFromEmail,
      to: input.to,
      subject: `${input.childName}'s Schowl progress report`,
      html: renderBrandedEmail({
        subject: `${input.childName}'s progress report`,
        body,
        language: input.language,
        logoUrl: config.emailLogoUrl,
        unsubscribeUrl: unsubscribeUrl(input.to),
      }),
    });
    return true;
  } catch (error) {
    console.error("Student report email failed", error);
    return false;
  }
}

// Send a branded email that isn't tied to a lead (e.g. membership renewals).
export async function sendTemplatedEmail(input: {
  to: string | null | undefined;
  templateKey: string;
  language?: string | null;
  context: Record<string, string | number | null | undefined>;
  leadId?: string | null;
}) {
  if (!resend || !input.to) return;
  if (await isUnsubscribed(input.to)) return;
  const rendered = await renderForLead(input.templateKey, input.language, input.context);
  try {
    const result = await resend.emails.send({
      from: config.resendFromEmail,
      to: input.to,
      subject: rendered.subject || "Schowl",
      html: renderBrandedEmail({
        subject: rendered.subject,
        body: rendered.body,
        language: input.language,
        logoUrl: config.emailLogoUrl,
        unsubscribeUrl: unsubscribeUrl(input.to),
      }),
    });
    await supabase.from("communication_log").insert({
      lead_id: input.leadId || null,
      channel: "email",
      template_key: input.templateKey,
      recipient: input.to,
      status: "sent",
      provider_message_id: result.data?.id,
    });
  } catch (error) {
    await supabase.from("communication_log").insert({
      lead_id: input.leadId || null,
      channel: "email",
      template_key: input.templateKey,
      recipient: input.to,
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
  }
}
