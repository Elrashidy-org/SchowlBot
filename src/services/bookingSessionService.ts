import { supabase } from "../db/supabase.js";
import { normalizePhone } from "../utils/phone.js";
import { LeadStartPayload } from "./leadSchemas.js";

export interface BookingSession {
  id: string;
  session_id: string;
  phone_raw: string | null;
  phone_e164: string | null;
  country_iso: string | null;
  country_name: string | null;
  child_name: string | null;
  parent_name: string | null;
  child_age: number | null;
  email: string | null;
  language: string;
  course_id: string | null;
  starts_at: string | null;
  package_interest: string | null;
  consent_marketing: boolean;
  status: "started" | "booked" | "abandoned";
  created_at: string;
}

function safeIso(value?: string) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Create or update the partial booking for a browser session (keyed by session_id).
export async function upsertBookingSession(payload: LeadStartPayload, courseId: string | null) {
  let phoneE164: string | null = payload.phone;
  try {
    phoneE164 = normalizePhone(payload.phone, payload.country_iso || "EG");
  } catch {
    // keep the raw phone if it can't be normalised yet
  }
  const { data, error } = await supabase
    .from("booking_session")
    .upsert(
      {
        session_id: payload.session_id,
        phone_raw: payload.phone,
        phone_e164: phoneE164,
        country_iso: payload.country_iso ? payload.country_iso.toUpperCase() : null,
        country_name: payload.country_name || null,
        child_name: payload.child_name || null,
        parent_name: payload.parent_name || null,
        child_age: payload.child_age ?? null,
        email: payload.email || null,
        language: payload.language || "en",
        course_id: courseId,
        starts_at: safeIso(payload.starts_at),
        package_interest: payload.package_interest || null,
        quiz_answers: payload.quiz_answers || {},
        quiz_recommendation: payload.quiz_recommendation || null,
        landing_page: payload.landing_page || null,
        referrer: payload.referrer || null,
        utm: {
          source: payload.utm_source,
          medium: payload.utm_medium,
          campaign: payload.utm_campaign,
          term: payload.utm_term,
          content: payload.utm_content,
        },
        consent_marketing: payload.consent_marketing ?? false,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "session_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as BookingSession;
}

// Mark the partial booking finished when the trial is booked (so it isn't nudged).
export async function markBookingSessionBooked(match: { sessionId?: string | null; id?: string | null }, convertedLeadId: string) {
  const patch = { status: "booked", converted_lead_id: convertedLeadId, updated_at: new Date().toISOString() };
  if (match.sessionId) {
    await supabase.from("booking_session").update(patch).eq("session_id", match.sessionId).neq("status", "booked");
  } else if (match.id) {
    await supabase.from("booking_session").update(patch).eq("id", match.id).neq("status", "booked");
  }
}

// Partial bookings older than `minutes` that were never finished or nudged.
export async function listAbandonedBookingSessions(minutes: number) {
  const cutoff = new Date(Date.now() - Math.max(1, minutes) * 60_000).toISOString();
  const { data, error } = await supabase
    .from("booking_session")
    .select("*")
    .eq("status", "started")
    .is("alerted_at", null)
    .lte("created_at", cutoff)
    .order("created_at", { ascending: true })
    .limit(50);
  if (error) throw error;
  return (data as BookingSession[]) || [];
}

export async function markBookingSessionAlerted(id: string) {
  await supabase
    .from("booking_session")
    .update({ status: "abandoned", alerted_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id);
}
