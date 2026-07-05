import { supabase } from "../db/supabase.js";
import { getActiveMembership, renewMembership } from "./studentService.js";

export interface Payment {
  id: string;
  student_id: string | null;
  amount: number;
  currency: string;
  method: string;
  paid_on: string;
  notes: string | null;
}

// Record a payment; if `months` is given, also renew the membership by that many
// months (this is what makes a student "paid through" a future date).
export async function recordPayment(input: {
  studentId: string;
  amount: number;
  currency?: string;
  method?: string;
  paidOn?: string;
  notes?: string | null;
  months?: number;
  recordedByBotUserId?: string;
}) {
  const membership = await getActiveMembership(input.studentId);
  const { data, error } = await supabase
    .from("payment")
    .insert({
      student_id: input.studentId,
      membership_id: membership?.id ?? null,
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

  let renewedTo: string | null = null;
  if (input.months && input.months > 0) {
    const m = await renewMembership(input.studentId, input.months);
    renewedTo = m.renews_on;
  }
  return { payment: data as Payment, renewedTo };
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
