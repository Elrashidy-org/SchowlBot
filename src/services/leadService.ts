import crypto from "node:crypto";
import { supabase } from "../db/supabase.js";
import { ClientLead, LeadStatus } from "../types.js";
import { ValidationError } from "../utils/errors.js";
import { normalizePhone } from "../utils/phone.js";
import { sanitizeSearchTerm } from "../utils/search.js";
import { LeadPayload, leadPayloadSchema } from "./leadSchemas.js";
import { config } from "../config.js";
import { verifyTurnstile } from "./turnstileService.js";
import { sendLeadEmail } from "./emailService.js";
import { getOwnerBotUserIds, listSalesAssignees } from "./botUserService.js";
import {
  cancelLeadFollowUpJobs,
  computeNextFollowUp,
  enqueueNoResponseFollowUp,
  enqueueSlaNudge,
} from "./followUpService.js";

// Round-robin: the sales rep with the fewest open assigned leads.
// Falls back to the owner(s) when no sales reps exist, so a solo owner still
// catches every lead.
async function pickNextSalesAssignee(): Promise<string | null> {
  let salesIds = await listSalesAssignees();
  if (salesIds.length === 0) salesIds = await getOwnerBotUserIds();
  if (salesIds.length === 0) return null;
  const { data, error } = await supabase
    .from("client_lead")
    .select("assigned_sales_user_id")
    .in("assigned_sales_user_id", salesIds)
    .not("status", "in", "(converted,lost,not_fit)");
  if (error) throw error;
  const counts = new Map<string, number>(salesIds.map((id) => [id, 0]));
  for (const row of data || []) {
    const id = row.assigned_sales_user_id as string | null;
    if (id && counts.has(id)) counts.set(id, (counts.get(id) || 0) + 1);
  }
  let best: string | null = null;
  let bestCount = Infinity;
  for (const id of salesIds) {
    const count = counts.get(id) ?? 0;
    if (count < bestCount) {
      bestCount = count;
      best = id;
    }
  }
  return best;
}

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

export async function createLead(
  input: unknown,
  remoteIp?: string,
  options: { skipTurnstile?: boolean } = {},
): Promise<CreateLeadResult> {
  const parsed = leadPayloadSchema.safeParse(input);
  if (!parsed.success) {
    throw new ValidationError(zodToFieldErrors(parsed.error));
  }

  const payload = parsed.data;
  if (!options.skipTurnstile) {
    await verifyTurnstile(payload.turnstile_token, remoteIp);
  }

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
  const nextFollowUpAt = computeNextFollowUp("new");
  const { data, error } = await supabase
    .from("client_lead")
    .insert({
      lead_type: payload.lead_type,
      status: "new",
      next_follow_up_at: nextFollowUpAt,
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
      source: payload.source || "website",
      source_url: payload.landing_page,
      dedupe_key: dedupeKey,
    })
    .select("*")
    .single();

  if (error) {
    throw error;
  }

  const lead = data as ClientLead;

  // Round-robin auto-assignment to a sales rep.
  if (config.autoAssignLeads) {
    try {
      const assignee = await pickNextSalesAssignee();
      if (assignee) {
        await supabase.from("client_lead").update({ assigned_sales_user_id: assignee }).eq("id", lead.id);
        await addLeadActivity(lead.id, "assigned", undefined, undefined, undefined, undefined, {
          assigned_to: assignee,
          auto: true,
        });
      }
    } catch (error) {
      console.error("Auto-assign failed", error);
    }
  }

  const followUpTasks: Promise<unknown>[] = [
    createLegacyClientRow(lead),
    addLeadActivity(lead.id, "created", undefined, "new"),
    sendLeadEmail(lead, "lead_received"),
  ];
  if (nextFollowUpAt) {
    followUpTasks.push(enqueueNoResponseFollowUp(lead.id, nextFollowUpAt));
  }
  if (config.leadSlaHours > 0) {
    followUpTasks.push(enqueueSlaNudge(lead.id, config.leadSlaHours));
  }
  await Promise.allSettled(followUpTasks);

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

export const LEAD_PAGE_SIZE = 10;

function pageRange(page: number): [number, number] {
  const p = Math.max(1, Math.trunc(page) || 1);
  const from = (p - 1) * LEAD_PAGE_SIZE;
  return [from, from + LEAD_PAGE_SIZE - 1];
}

export async function searchLead(query: string, page = 1) {
  const trimmed = sanitizeSearchTerm(query);
  if (!trimmed) return [] as ClientLead[];
  const [from, to] = pageRange(page);
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .or(`parent_name.ilike.%${trimmed}%,child_name.ilike.%${trimmed}%,phone_e164.ilike.%${trimmed}%`)
    .order("created_at", { ascending: false })
    .range(from, to);
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
  const patch: Record<string, unknown> = {
    status,
    next_follow_up_at: computeNextFollowUp(status),
  };
  if (status === "contacted") patch.last_contacted_at = new Date().toISOString();

  const { data, error } = await supabase
    .from("client_lead")
    .update(patch)
    .eq("id", leadId)
    .select("*")
    .single();

  if (error) throw error;

  // Once a lead moves off "new" it has been engaged or closed, so the
  // automated no-response email no longer applies.
  if (status !== "new") {
    await cancelLeadFollowUpJobs(leadId);
  }

  // Converting a referred lead qualifies the referral (bonus/discount).
  if (status === "converted") {
    try {
      const { qualifyReferralForLead } = await import("./referralService.js");
      await qualifyReferralForLead(leadId);
    } catch (error) {
      console.error("Referral qualification failed", error);
    }
  }

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

export async function setLeadAssignee(
  leadId: string,
  assigneeBotUserId: string,
  actorBotUserId?: string,
) {
  const { data, error } = await supabase
    .from("client_lead")
    .update({ assigned_sales_user_id: assigneeBotUserId })
    .eq("id", leadId)
    .select("*")
    .single();
  if (error) throw error;
  await addLeadActivity(leadId, "assigned", undefined, undefined, undefined, actorBotUserId, {
    assigned_to: assigneeBotUserId,
  });
  return data as ClientLead;
}

export async function listLeadsAssignedTo(botUserId: string, page = 1) {
  const [from, to] = pageRange(page);
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .eq("assigned_sales_user_id", botUserId)
    .not("status", "in", "(converted,lost,not_fit)")
    .order("next_follow_up_at", { ascending: true })
    .range(from, to);
  if (error) throw error;
  return data as ClientLead[];
}

export async function listLeadActivity(leadId: string) {
  const { data, error } = await supabase
    .from("lead_activity")
    .select("activity_type, old_status, new_status, note, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(15);
  if (error) throw error;
  return data || [];
}

// Right-to-be-forgotten: redact PII on the lead and its linked legacy client
// rows, and cancel any pending automation. The row is kept for referential
// integrity but stripped of personal data.
export async function anonymizeLead(leadId: string, actorBotUserId?: string) {
  const redacted = "[redacted]";
  const { data, error } = await supabase
    .from("client_lead")
    .update({
      parent_name: redacted,
      child_name: redacted,
      phone_raw: redacted,
      phone_e164: redacted,
      email: null,
      notes: null,
      quiz_answers: {},
      quiz_recommendation: null,
      first_touch_utm: {},
      latest_touch_utm: {},
      referrer: null,
    })
    .eq("id", leadId)
    .select("id")
    .single();
  if (error) throw error;

  await supabase
    .from("client")
    .update({ name: redacted, parent_name: redacted, email: null, phone_raw: redacted, phone_e164: redacted })
    .eq("lead_id", leadId);
  await supabase
    .from("automation_job")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("lead_id", leadId)
    .eq("status", "pending");
  await addLeadActivity(leadId, "forgotten", undefined, undefined, undefined, actorBotUserId);
  return data;
}

export async function exportLeads(days: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from("client_lead")
    .select(
      "id, created_at, status, lead_type, parent_name, child_name, child_age, phone_e164, country_iso, email, course_interest",
    )
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(5000);
  if (error) throw error;
  return data || [];
}

export async function getLeadStats() {
  const now = new Date().toISOString();
  const base = () => supabase.from("client_lead").select("id", { count: "exact", head: true });
  const [total, fresh, converted, due, trials] = await Promise.all([
    base(),
    base().eq("status", "new"),
    base().eq("status", "converted"),
    base().not("status", "in", "(converted,lost,not_fit)").lte("next_follow_up_at", now),
    supabase
      .from("lesson")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "scheduled"])
      .gte("scheduled_at", now),
  ]);
  return {
    total: total.count ?? 0,
    new: fresh.count ?? 0,
    converted: converted.count ?? 0,
    due: due.count ?? 0,
    upcomingTrials: trials.count ?? 0,
  };
}

export const FUNNEL_STATUSES: LeadStatus[] = [
  "new",
  "contacted",
  "trial_booked",
  "trial_done",
  "converted",
  "not_fit",
  "lost",
];

export async function getFunnelStats() {
  const base = () => supabase.from("client_lead").select("id", { count: "exact", head: true });
  const [total, ...perStatus] = await Promise.all([
    base(),
    ...FUNNEL_STATUSES.map((s) => base().eq("status", s)),
  ]);
  const byStatus = {} as Record<LeadStatus, number>;
  FUNNEL_STATUSES.forEach((s, i) => {
    byStatus[s] = perStatus[i].count ?? 0;
  });
  return { total: total.count ?? 0, byStatus };
}

export async function getDigestStats() {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const startIso = start.toISOString();
  const endIso = new Date(start.getTime() + 24 * 60 * 60 * 1000).toISOString();
  const nowIso = new Date().toISOString();
  const lead = () => supabase.from("client_lead").select("id", { count: "exact", head: true });
  const [newToday, convertedToday, due, trialsToday] = await Promise.all([
    lead().gte("created_at", startIso),
    lead().eq("status", "converted").gte("updated_at", startIso),
    lead().not("status", "in", "(converted,lost,not_fit)").lte("next_follow_up_at", nowIso),
    supabase
      .from("lesson")
      .select("id", { count: "exact", head: true })
      .in("status", ["pending", "scheduled"])
      .gte("scheduled_at", startIso)
      .lt("scheduled_at", endIso),
  ]);
  return {
    newToday: newToday.count ?? 0,
    convertedToday: convertedToday.count ?? 0,
    due: due.count ?? 0,
    trialsToday: trialsToday.count ?? 0,
  };
}

// Stalled leads (not converted/lost, no update in `days`, has an email) —
// candidates for a manually-triggered re-engagement campaign.
export async function listColdLeads(days: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString();
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .not("status", "in", "(converted,lost,not_fit)")
    .lte("updated_at", since)
    .not("email", "is", null)
    .order("updated_at", { ascending: true })
    .limit(200);
  if (error) throw error;
  return data as ClientLead[];
}

export async function listDueLeads(page = 1) {
  const [from, to] = pageRange(page);
  const { data, error } = await supabase
    .from("client_lead")
    .select("*")
    .not("status", "in", "(converted,lost,not_fit)")
    .lte("next_follow_up_at", new Date().toISOString())
    .order("next_follow_up_at", { ascending: true })
    .range(from, to);
  if (error) throw error;
  return data as ClientLead[];
}
