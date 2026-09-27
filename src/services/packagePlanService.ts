import { supabase } from "../db/supabase.js";
import { sanitizeSearchTerm } from "../utils/search.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// A standard package in the price book (e.g. "16 lessons" at a 3200 list price).
// The list price is the reference/default; the price a customer actually pays is
// recorded per sale on the student's package and in package_purchase.
export interface PackagePlan {
  id: string;
  name: string;
  lessons: number;
  list_price: number;
  currency: string;
  active: boolean;
  notes: string | null;
}

export async function createPackagePlan(input: {
  name: string;
  lessons: number;
  listPrice: number;
  currency?: string;
  notes?: string | null;
}) {
  const { data, error } = await supabase
    .from("package_plan")
    .insert({
      name: input.name.trim(),
      lessons: Math.max(1, Math.trunc(input.lessons)),
      list_price: input.listPrice,
      currency: input.currency || "EGP",
      notes: input.notes || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as PackagePlan;
}

export async function listPackagePlans(activeOnly = true) {
  let query = supabase
    .from("package_plan")
    .select("id, name, lessons, list_price, currency, active, notes")
    .order("lessons", { ascending: true });
  if (activeOnly) query = query.eq("active", true);
  const { data, error } = await query;
  if (error) throw error;
  return (data as PackagePlan[]) || [];
}

// Resolve a plan by UUID or (case-insensitive) name.
export async function findPackagePlan(value: string) {
  const raw = value.trim();
  const { data, error } = await supabase
    .from("package_plan")
    .select("id, name, lessons, list_price, currency, active, notes")
    .or(UUID_RE.test(raw) ? `id.eq.${raw}` : `name.ilike.%${sanitizeSearchTerm(raw)}%`)
    .order("active", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return (data as PackagePlan | null) ?? null;
}

export async function setPackagePlanActive(planId: string, active: boolean) {
  const { data, error } = await supabase
    .from("package_plan")
    .update({ active, updated_at: new Date().toISOString() })
    .eq("id", planId)
    .select("*")
    .single();
  if (error) throw error;
  return data as PackagePlan;
}

// Adjust a plan's default (list) price, or its lessons / name / notes / active flag.
export async function updatePackagePlan(
  planId: string,
  patch: { name?: string; lessons?: number; listPrice?: number; notes?: string | null; active?: boolean },
) {
  const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (patch.name != null) update.name = patch.name.trim();
  if (patch.lessons != null) update.lessons = Math.max(1, Math.trunc(patch.lessons));
  if (patch.listPrice != null) update.list_price = patch.listPrice;
  if (patch.notes !== undefined) update.notes = patch.notes;
  if (patch.active != null) update.active = patch.active;
  const { data, error } = await supabase
    .from("package_plan")
    .update(update)
    .eq("id", planId)
    .select("*")
    .single();
  if (error) throw error;
  return data as PackagePlan;
}
