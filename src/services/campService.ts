import { supabase } from "../db/supabase.js";
import { normalizePhone } from "../utils/phone.js";
import { CampRegisterPayload } from "./leadSchemas.js";

export interface CampRegistration {
  id: string;
  camp: string;
  parent_name: string | null;
  child_name: string;
  child_age: number | null;
  email: string | null;
  phone_e164: string | null;
  country_iso: string | null;
  language: string;
  created_at: string;
}

export async function registerCamp(payload: CampRegisterPayload) {
  let phoneE164 = payload.phone;
  try {
    phoneE164 = normalizePhone(payload.phone, payload.country_iso || "EG");
  } catch {
    // keep the raw phone if it can't be normalised
  }
  const { data, error } = await supabase
    .from("camp_registration")
    .insert({
      camp: payload.camp || "summer",
      parent_name: payload.parent_name || null,
      child_name: payload.child_name.trim(),
      child_age: payload.child_age ?? null,
      email: payload.email || null,
      phone_raw: payload.phone,
      phone_e164: phoneE164,
      country_iso: (payload.country_iso || "EG").toUpperCase(),
      country_name: payload.country_name || "Egypt",
      language: payload.language || "en",
      notes: payload.notes || null,
      extra: payload.extra || {},
      source: payload.source || "website",
      consent_contact: payload.consent_contact,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as CampRegistration;
}

export async function listCampRegistrations(camp?: string, limit = 25) {
  let query = supabase
    .from("camp_registration")
    .select("id, camp, parent_name, child_name, child_age, email, phone_e164, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);
  if (camp) query = query.eq("camp", camp);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}

export async function exportCampRegistrations(camp?: string) {
  let query = supabase
    .from("camp_registration")
    .select("created_at, camp, parent_name, child_name, child_age, email, phone_e164, country_iso")
    .order("created_at", { ascending: false })
    .limit(5000);
  if (camp) query = query.eq("camp", camp);
  const { data, error } = await query;
  if (error) throw error;
  return data || [];
}
