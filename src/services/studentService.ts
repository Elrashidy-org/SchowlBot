import { supabase } from "../db/supabase.js";
import { getLead, updateLeadStatus } from "./leadService.js";
import { sanitizeSearchTerm } from "../utils/search.js";

const PAGE_SIZE = 10;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface Student {
  id: string;
  lead_id: string | null;
  name: string;
  parent_name: string | null;
  phone_e164: string | null;
  email: string | null;
  course_id: string | null;
  track: string | null;
  level: string | null;
  status: string;
  assigned_teacher_id: string | null;
}

export interface Membership {
  id: string;
  student_id: string;
  plan: string;
  starts_on: string;
  renews_on: string;
  price: number | null;
  currency: string;
  status: string;
}

// Enroll a student (optionally from a lead) and open their first membership.
export async function enrollStudent(input: {
  leadId?: string | null;
  name?: string;
  parentName?: string;
  phone?: string;
  email?: string;
  courseId: string;
  track?: string | null;
  level?: string | null;
  teacherId?: string | null;
  plan?: string;
  price?: number | null;
  renewsOn: string;
}) {
  let name = input.name;
  let parentName = input.parentName;
  let phone = input.phone;
  let email = input.email;

  if (input.leadId) {
    const lead = await getLead(input.leadId);
    name = name || lead.child_name;
    parentName = parentName || lead.parent_name;
    phone = phone || lead.phone_e164;
    email = email || lead.email || undefined;
  }
  if (!name) throw new Error("Student name is required.");

  const { data: student, error } = await supabase
    .from("student")
    .insert({
      lead_id: input.leadId || null,
      name,
      parent_name: parentName || null,
      phone_e164: phone || null,
      email: email || null,
      course_id: input.courseId,
      track: input.track || null,
      level: input.level || null,
      assigned_teacher_id: input.teacherId || null,
      status: "active",
    })
    .select("*")
    .single();
  if (error) throw error;

  const { data: membership, error: mErr } = await supabase
    .from("membership")
    .insert({
      student_id: student.id,
      plan: input.plan || "monthly",
      renews_on: input.renewsOn,
      price: input.price ?? null,
      status: "active",
    })
    .select("*")
    .single();
  if (mErr) throw mErr;

  if (input.leadId) {
    try {
      await updateLeadStatus(input.leadId, "converted");
    } catch {
      // non-fatal
    }
  }

  return { student: student as Student, membership: membership as Membership };
}

export async function getStudentById(id: string) {
  const { data, error } = await supabase.from("student").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  return (data as Student | null) ?? null;
}

export async function findStudent(value: string) {
  const raw = value.trim();
  if (UUID_RE.test(raw)) return getStudentById(raw);
  const term = sanitizeSearchTerm(raw);
  if (!term) return null;
  const { data, error } = await supabase
    .from("student")
    .select("*")
    .or(`name.ilike.%${term}%,phone_e164.ilike.%${term}%`)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Student | null) ?? null;
}

export async function listStudents(page = 1) {
  const p = Math.max(1, Math.trunc(page) || 1);
  const from = (p - 1) * PAGE_SIZE;
  const { data, error } = await supabase
    .from("student")
    .select("id, name, track, level, status")
    .eq("status", "active")
    .order("name", { ascending: true })
    .range(from, from + PAGE_SIZE - 1);
  if (error) throw error;
  return data || [];
}

export async function getActiveMembership(studentId: string) {
  const { data, error } = await supabase
    .from("membership")
    .select("*")
    .eq("student_id", studentId)
    .eq("status", "active")
    .order("renews_on", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Membership | null) ?? null;
}

export async function setStudentLevel(studentId: string, level: string) {
  const { data, error } = await supabase
    .from("student")
    .update({ level, updated_at: new Date().toISOString() })
    .eq("id", studentId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Student;
}

// Advance the active membership's renewal date by `months` and reset reminders.
export async function renewMembership(studentId: string, months = 1) {
  const membership = await getActiveMembership(studentId);
  if (!membership) throw new Error("No active membership to renew.");
  const base = new Date(membership.renews_on);
  base.setMonth(base.getMonth() + Math.max(1, Math.trunc(months)));
  const nextRenewsOn = base.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("membership")
    .update({ renews_on: nextRenewsOn, last_renewal_reminder_on: null, updated_at: new Date().toISOString() })
    .eq("id", membership.id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Membership;
}

export async function cancelStudent(studentId: string) {
  await supabase
    .from("membership")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("student_id", studentId)
    .eq("status", "active");
  const { data, error } = await supabase
    .from("student")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("id", studentId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Student;
}

// Active memberships renewing within `days`, that haven't been reminded this cycle.
export async function listRenewalsNeedingReminder(days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const cutoffIso = cutoff.toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("membership")
    .select("id, student_id, plan, renews_on, price, currency, last_renewal_reminder_on, auto_reminders")
    .eq("status", "active")
    .eq("auto_reminders", true)
    .lte("renews_on", cutoffIso)
    .order("renews_on", { ascending: true });
  if (error) throw error;
  const today = new Date().toISOString().slice(0, 10);
  return (data || []).filter((m) => !m.last_renewal_reminder_on || m.last_renewal_reminder_on < today);
}

export async function listUpcomingRenewals(days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const { data: ms, error } = await supabase
    .from("membership")
    .select("student_id, renews_on, plan, price, currency")
    .eq("status", "active")
    .lte("renews_on", cutoff.toISOString().slice(0, 10))
    .order("renews_on", { ascending: true })
    .limit(25);
  if (error) throw error;
  const rows = ms || [];
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data } = await supabase.from("student").select("id, name").in("id", ids);
    for (const s of data || []) names.set(s.id, s.name);
  }
  return rows.map((r) => ({ ...r, name: names.get(r.student_id) || r.student_id }));
}

export async function countUpcomingRenewals(days: number) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() + days);
  const { count, error } = await supabase
    .from("membership")
    .select("id", { count: "exact", head: true })
    .eq("status", "active")
    .lte("renews_on", cutoff.toISOString().slice(0, 10));
  if (error) throw error;
  return count ?? 0;
}

export async function markRenewalReminded(membershipId: string) {
  await supabase
    .from("membership")
    .update({ last_renewal_reminder_on: new Date().toISOString().slice(0, 10) })
    .eq("id", membershipId);
}
