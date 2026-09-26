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

// A prepaid bundle of lessons (e.g. 4 / 8 / 16). Schowl sells lessons, not time.
export interface StudentPackage {
  id: string;
  student_id: string;
  lessons_purchased: number;
  lessons_used: number;
  price: number | null;
  currency: string;
  status: string;
  low_balance_reminder_sent: boolean;
  purchased_on: string;
}

export function lessonsRemaining(pkg: Pick<StudentPackage, "lessons_purchased" | "lessons_used">) {
  return Math.max(0, pkg.lessons_purchased - pkg.lessons_used);
}

// Reminder fires when a student's package drops to this many lessons left.
export const LOW_BALANCE_THRESHOLD = 2;

// Enroll a student (optionally from a lead) and open their first lesson package.
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
  lessons: number;
  price?: number | null;
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

  const { data: pkg, error: mErr } = await supabase
    .from("student_package")
    .insert({
      student_id: student.id,
      lessons_purchased: Math.max(1, Math.trunc(input.lessons)),
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

  return { student: student as Student, pkg: pkg as StudentPackage };
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

export async function findStudentByLeadId(leadId: string) {
  const { data, error } = await supabase
    .from("student")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as Student | null) ?? null;
}

export async function getActivePackage(studentId: string) {
  const { data, error } = await supabase
    .from("student_package")
    .select("*")
    .eq("student_id", studentId)
    .eq("status", "active")
    .order("purchased_on", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as StudentPackage | null) ?? null;
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

// Renew = buy more lessons. Tops up the active package if there is one (and
// clears the low-balance flag); otherwise opens a fresh package.
export async function addLessons(studentId: string, lessons: number, price?: number | null) {
  const add = Math.max(1, Math.trunc(lessons));
  const active = await getActivePackage(studentId);
  if (active) {
    const { data, error } = await supabase
      .from("student_package")
      .update({
        lessons_purchased: active.lessons_purchased + add,
        price: price ?? active.price,
        low_balance_reminder_sent: false,
        updated_at: new Date().toISOString(),
      })
      .eq("id", active.id)
      .select("*")
      .single();
    if (error) throw error;
    return data as StudentPackage;
  }
  const { data, error } = await supabase
    .from("student_package")
    .insert({ student_id: studentId, lessons_purchased: add, price: price ?? null, status: "active" })
    .select("*")
    .single();
  if (error) throw error;
  return data as StudentPackage;
}

// Consume one lesson from a student's active package (called when a paid lesson
// is delivered). Returns the updated remaining count, or null if no package.
export async function consumeLesson(studentId: string) {
  const active = await getActivePackage(studentId);
  if (!active) return null;
  const used = active.lessons_used + 1;
  const depleted = used >= active.lessons_purchased;
  const { data, error } = await supabase
    .from("student_package")
    .update({
      lessons_used: used,
      status: depleted ? "completed" : "active",
      updated_at: new Date().toISOString(),
    })
    .eq("id", active.id)
    .select("*")
    .single();
  if (error) throw error;
  const pkg = data as StudentPackage;
  return { pkg, remaining: lessonsRemaining(pkg) };
}

export async function cancelStudent(studentId: string) {
  await supabase
    .from("student_package")
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

// Active packages at or below the low-balance threshold that haven't been
// reminded yet — the "2 lessons left" nudge.
export async function listPackagesNeedingLowBalanceReminder() {
  const { data, error } = await supabase
    .from("student_package")
    .select("id, student_id, lessons_purchased, lessons_used, price, currency")
    .eq("status", "active")
    .eq("low_balance_reminder_sent", false);
  if (error) throw error;
  return (data || []).filter(
    (p) => lessonsRemaining(p) <= LOW_BALANCE_THRESHOLD,
  ) as Array<Pick<StudentPackage, "id" | "student_id" | "lessons_purchased" | "lessons_used" | "price" | "currency">>;
}

// Active packages running low, for staff review (`/student renewals`).
export async function listLowBalancePackages(threshold = LOW_BALANCE_THRESHOLD) {
  const { data, error } = await supabase
    .from("student_package")
    .select("student_id, lessons_purchased, lessons_used, price, currency")
    .eq("status", "active")
    .limit(200);
  if (error) throw error;
  const rows = (data || []).filter((p) => lessonsRemaining(p) <= threshold);
  const ids = [...new Set(rows.map((r) => r.student_id))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: students } = await supabase.from("student").select("id, name").in("id", ids);
    for (const s of students || []) names.set(s.id, s.name);
  }
  return rows
    .map((r) => ({ ...r, name: names.get(r.student_id) || r.student_id, remaining: lessonsRemaining(r) }))
    .sort((a, b) => a.remaining - b.remaining);
}

export async function countLowBalancePackages(threshold = LOW_BALANCE_THRESHOLD) {
  return (await listLowBalancePackages(threshold)).length;
}

export async function markLowBalanceReminded(packageId: string) {
  await supabase
    .from("student_package")
    .update({ low_balance_reminder_sent: true, updated_at: new Date().toISOString() })
    .eq("id", packageId);
}
