import { supabase } from "../db/supabase.js";
import { addLessons, getActivePackage, lessonsRemaining, listLowBalancePackages } from "./studentService.js";

export interface Payment {
  id: string;
  student_id: string | null;
  amount: number;
  currency: string;
  method: string;
  paid_on: string;
  notes: string | null;
}

// Record a payment; if `lessons` is given, also top up the student's package by
// that many lessons (this is what makes a student "paid up" for more sessions).
export async function recordPayment(input: {
  studentId: string;
  amount: number;
  currency?: string;
  method?: string;
  paidOn?: string;
  notes?: string | null;
  lessons?: number;
  recordedByBotUserId?: string;
}) {
  // Top up first so the payment links to the resulting package.
  let lessonsRemainingAfter: number | null = null;
  let packageId: string | null = null;
  if (input.lessons && input.lessons > 0) {
    const pkg = await addLessons(input.studentId, input.lessons, null);
    lessonsRemainingAfter = lessonsRemaining(pkg);
    packageId = pkg.id;
  } else {
    packageId = (await getActivePackage(input.studentId))?.id ?? null;
  }

  const { data, error } = await supabase
    .from("payment")
    .insert({
      student_id: input.studentId,
      package_id: packageId,
      amount: input.amount,
      currency: input.currency || "EGP",
      method: input.method || "cash",
      paid_on: input.paidOn || new Date().toISOString().slice(0, 10),
      notes: input.notes || null,
      recorded_by_bot_user_id: input.recordedByBotUserId || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  return { payment: data as Payment, lessonsRemainingAfter };
}

export async function listPayments(studentId?: string, limit = 15) {
  let query = supabase
    .from("payment")
    .select("id, student_id, amount, currency, method, paid_on, notes")
    .order("paid_on", { ascending: false })
    .limit(limit);
  if (studentId) query = query.eq("student_id", studentId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as Payment[]) || [];
}

// Total revenue (sum of amounts) over the last `days`, grouped by currency.
export async function getRevenue(days: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("payment")
    .select("amount, currency")
    .gte("paid_on", since)
    .limit(5000);
  if (error) throw error;
  const totals: Record<string, number> = {};
  for (const p of data || []) {
    const cur = (p.currency as string) || "EGP";
    totals[cur] = (totals[cur] || 0) + Number(p.amount || 0);
  }
  return totals;
}

// Students whose active package is running low (<= threshold lessons left) —
// i.e. who should be asked to renew/pay for the next package.
export async function listOutstandingPackages(threshold: number) {
  return listLowBalancePackages(threshold);
}

export async function exportPayments(days: number) {
  const since = new Date(Date.now() - Math.max(1, days) * 86400000).toISOString().slice(0, 10);
  const { data, error } = await supabase
    .from("payment")
    .select("paid_on, amount, currency, method, notes, student_id")
    .gte("paid_on", since)
    .order("paid_on", { ascending: false })
    .limit(5000);
  if (error) throw error;
  const rows = data || [];
  const ids = [...new Set(rows.map((r) => r.student_id).filter(Boolean))];
  const names = new Map<string, string>();
  if (ids.length) {
    const { data: students } = await supabase.from("student").select("id, name").in("id", ids as string[]);
    for (const s of students || []) names.set(s.id, s.name);
  }
  return rows.map((r) => ({ ...r, name: r.student_id ? names.get(r.student_id) ?? "" : "" }));
}

export async function getStudentPaidTotal(studentId: string) {
  const { data, error } = await supabase
    .from("payment")
    .select("amount, currency, paid_on")
    .eq("student_id", studentId)
    .order("paid_on", { ascending: false });
  if (error) throw error;
  const rows = data || [];
  const total = rows.reduce((s, p) => s + Number(p.amount || 0), 0);
  return { total, currency: (rows[0]?.currency as string) || "EGP", lastPaidOn: (rows[0]?.paid_on as string) || null, count: rows.length };
}
