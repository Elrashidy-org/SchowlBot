import crypto from "node:crypto";
import { supabase } from "../db/supabase.js";
import { ClientLead, LeadStatus } from "../types.js";
import { ValidationError } from "../utils/errors.js";
import { normalizePhone } from "../utils/phone.js";
import { LeadPayload, leadPayloadSchema } from "./leadSchemas.js";
import { verifyTurnstile } from "./turnstileService.js";
import { sendLeadEmail } from "./emailService.js";

export interface CreateLeadResult {
  lead: ClientLead;
  duplicate: boolean;
}

function normalizeName(name: string) {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

function makeDedupeKey(payload: LeadPayload, phoneE164: string) {
  const day = new Date().toISOString().slice(0, 10);
  return crypto
    .createHash("sha256")
    .update(
      [
        payload.lead_type,
        phoneE164,
        normalizeName(payload.child_name),
        day,
      ].join(":"),
    )
    .digest("hex");
}

function zodToFieldErrors(error: unknown) {
  if (!error || typeof error !== "object" || !("issues" in error)) {
    return { form: "Invalid request" };
  }
  const issues = (error as { issues: { path: unknown[]; message: string }[] }).issues;
  return Object.fromEntries(
    issues.map((issue) => [String(issue.path[0] || "form"), issue.message]),
  );
}

export async function createLead(input: unknown, remoteIp?: string): Promise<CreateLeadResult> {
  const parsed = leadPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(zodToFieldErrors(parsed.error));
  }

  const payload = parsed.data;
  await verifyTurnstile(payload.turnstile_token, remoteIp);

  const phoneE164 = normalizePhone(payload.phone, payload.country_iso);
  const childName = payload.child_name.trim().replace(/\s+/g, " ");
  const parentName = payload.parent_name.trim().replace(/\s+/g, " ");
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

  const { data: duplicate, error: duplicateError } = await supabase
    .from("client_lead")
    .select("*")
    .eq("phone_e164", phoneE164)
    .eq("lead_type", payload.lead_type)
    .ilike("child_name", childName)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (duplicateError) {
    throw duplicateError;
  }

  if (duplicate) {
    return { lead: duplicate as ClientLead, duplicate: true };
  }

  const utm = {
    source: payload.utm_source,
    medium: payload.utm_medium,
    campaign: payload.utm_campaign,
    term: payload.utm_term,
    content: payload.utm_content,
  };

  const dedupeKey = makeDedupeKey(payload, phoneE164);
  const { data, error } = await supabase
    .from("client_lead")
    .insert({
      lead_type: payload.lead_type,
      status: "new",
      parent_name: parentName,
      child_name: childName,
      child_age: payload.child_age,
      phone_raw: payload.phone,
      phone_e164: phoneE164,
      country_iso: payload.country_iso.toUpperCase(),
      country_name: payload.country_name,
      language: payload.language,
      landing_page: payload.landing_page,
      preferred_contact: payload.preferred_contact,
      consent_contact: payload.consent_contact,
      privacy_policy_accepted: payload.privacy_policy_accepted,
      email: payload.email || null,
      course_interest: payload.course_interest || null,
      quiz_answers: payload.quiz_answers,
      quiz_recommendation: payload.quiz_recommendation || null,
      first_touch_utm: utm,
      latest_touch_utm: utm,
      referrer: payload.referrer || null,
      source_url: payload.landing_page,
      dedupe_key: dedupeKey,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const lead = data as ClientLead;
  await Promise.allSettled([
    createLegacyClientRow(lead),
    addLeadActivity(lead.id, "created", undefined, "new"),
    sendLeadEmail(lead, "lead_received_en"),
  ]);

  return { lead, duplicate: false };
}

export async function createLegacyClientRow(lead: ClientLead) {
  await supabase.from("client").insert({
    lead_id: lead.id,
    name: lead.child_name,
    parent_name: lead.parent_name,
    email: lead.email,
    age: lead.child_age,
    country: lead.country_name,
    phone_raw: lead.phone_raw,
    phone_e164: lead.phone_e164,
    course: lead.course_interest || "N/A",
    plan: "N/A",
    interests: lead.course_interest ? [lead.course_interest] : [""],
    status: lead.status,
    trial_lesson: false,
    consent_contact: true,
    privacy_policy_accepted: true,
    country_iso: lead.country_iso,
  });
}

export async function addLeadActivity(
  leadId: string,
  activityType: string,
  oldStatus?: LeadStatus,
  newStatus?: LeadStatus,
  note?: string,
  actorBotUserId?: string,
  metadata: Record<string, unknown> = {},
) {
  await supabase.from("lead_activity").insert({
    lead_id: leadId,
    activity_type: activityType,
    old_status: oldStatus,
    new_status: newStatus,
    note,
    actor_bot_user_id: actorBotUserId,
    metadata,
  });
}

export async function getLead(leadId: string) {
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .eq("id", leadId)
    .single();
  if (error) throw error;
  return data as ClientLead;
}

export async function searchLead(query: string) {
  const trimmed = query.trim();
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .or(`parent_name.ilike.%${trimmed}%,child_name.ilike.%${trimmed}%,phone_e164.ilike.%${trimmed}%`)
    .order("created_at", { ascending: false })
    .limit(10);
  if (error) throw error;
  return data as ClientLead[];
}

export async function updateLeadStatus(
  leadId: string,
  status: LeadStatus,
  actorBotUserId?: string,
  note?: string,
) {
  const current = await getLead(leadId);
  const patch: Record<string, unknown> = { status };
  if (status === "contacted") patch.last_contacted_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("client_lead")
    .update(patch)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw error;

  await addLeadActivity(
    leadId,
    "status_changed",
    current.status,
    status,
    note,
    actorBotUserId,
  );

  return data as ClientLead;
}

export async function addLeadNote(
  leadId: string,
  note: string,
  actorBotUserId?: string,
) {
  const lead = await getLead(leadId);
  const nextNotes = [lead.notes, note].filter(Boolean).join("\n");
  const { data, error } = await supabase
    .from("client_lead")
    .update({ notes: nextNotes })
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;
  await addLeadActivity(leadId, "note_added", undefined, undefined, note, actorBotUserId);
  return data as ClientLead;
}

export async function listDueLeads() {
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .not("status", "in", "(converted,lost,not_fit)")
    .lte("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .limit(20);
  if (error) throw error;
  return data as ClientLead[];
}
