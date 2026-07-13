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

// ---- Camp groups (4-5 students per group) ----

export async function createCampGroup(input: {
  camp: string;
  name: string;
  capacity?: number;
  teacherId?: string | null;
  chatLink?: string | null;
  notes?: string | null;
}) {
  const { data, error } = await supabase
    .from("camp_group")
    .insert({
      camp: input.camp,
      name: input.name,
      capacity: input.capacity ?? 5,
      teacher_id: input.teacherId || null,
      chat_link: input.chatLink || null,
      notes: input.notes || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function findCampGroup(value: string) {
  const raw = value.trim();
  const isUuid = /^[0-9a-f-]{36}$/i.test(raw);
  const { data, error } = await supabase
    .from("camp_group")
    .select("*")
    .or(isUuid ? `id.eq.${raw}` : `name.ilike.%${raw}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function findCampRegistration(value: string) {
  const raw = value.trim();
  const isUuid = /^[0-9a-f-]{36}$/i.test(raw);
  const { data, error } = await supabase
    .from("camp_registration")
    .select("*")
    .or(isUuid ? `id.eq.${raw}` : `child_name.ilike.%${raw}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

async function groupCount(groupId: string) {
  const { count, error } = await supabase
    .from("camp_registration")
    .select("id", { count: "exact", head: true })
    .eq("group_id", groupId);
  if (error) throw error;
  return count ?? 0;
}

export async function assignToGroup(registrationId: string, group: { id: string; capacity: number }) {
  if ((await groupCount(group.id)) >= group.capacity) {
    throw new Error("That group is full.");
  }
  const { data, error } = await supabase
    .from("camp_registration")
    .update({ group_id: group.id })
    .eq("id", registrationId)
    .select("id, child_name")
    .single();
  if (error) throw error;
  return data;
}

export async function listCampGroups(camp?: string) {
  let query = supabase.from("camp_group").select("id, name, camp, capacity").order("created_at", { ascending: true });
  if (camp) query = query.eq("camp", camp);
  const { data, error } = await query;
  if (error) throw error;
  const groups = data || [];
  const withCounts = await Promise.all(
    groups.map(async (g) => ({ ...g, members: await groupCount(g.id) })),
  );
  return withCounts;
}

export async function listGroupMembers(groupId: string) {
  const { data, error } = await supabase
    .from("camp_registration")
    .select("id, child_name, child_age, parent_name, phone_e164, email, language")
    .eq("group_id", groupId)
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function setGroupChatLink(groupId: string, chatLink: string) {
  const { error } = await supabase.from("camp_group").update({ chat_link: chatLink }).eq("id", groupId);
  if (error) throw error;
}

// Auto-bucket unassigned registrants for a camp into groups of `size`.
export async function autoGroup(camp: string, size = 5) {
  const { data: unassigned, error } = await supabase
    .from("camp_registration")
    .select("id")
    .eq("camp", camp)
    .is("group_id", null)
    .order("created_at", { ascending: true });
  if (error) throw error;
  const ids = (unassigned || []).map((r) => r.id);
  if (ids.length === 0) return { groupsCreated: 0, assigned: 0 };

  // Continue numbering after existing groups for this camp.
  const { count: existing } = await supabase
    .from("camp_group")
    .select("id", { count: "exact", head: true })
    .eq("camp", camp);
  let n = (existing ?? 0) + 1;
  let groupsCreated = 0;
  let assigned = 0;

  for (let i = 0; i < ids.length; i += size) {
    const chunk = ids.slice(i, i + size);
    const group = await createCampGroup({ camp, name: `${camp} #${n}`, capacity: size });
    groupsCreated += 1;
    await supabase.from("camp_registration").update({ group_id: group.id }).in("id", chunk);
    assigned += chunk.length;
    n += 1;
  }
  return { groupsCreated, assigned };
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
