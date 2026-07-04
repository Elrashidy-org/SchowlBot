import { supabase } from "../db/supabase.js";
import { Course } from "../types.js";
import { sanitizeSearchTerm } from "../utils/search.js";

export async function listCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name_en, name_ar")
    .order("name_en", { ascending: true });
  if (error) throw error;
  return data as Course[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function findCourseByNameOrId(value: string) {
  const raw = value.trim();
  const term = sanitizeSearchTerm(raw);
  // Only match by id when the value is actually a UUID; feeding a name into
  // id.eq would fail the uuid cast in Postgres.
  let builder = supabase.from("courses").select("id, name_en, name_ar");
  if (UUID_RE.test(raw)) {
    builder = builder.or(`id.eq.${raw},name_en.ilike.%${term}%,name_ar.ilike.%${term}%`);
  } else if (term) {
    builder = builder.or(`name_en.ilike.%${term}%,name_ar.ilike.%${term}%`);
  } else {
    return null;
  }
  const { data, error } = await builder.limit(1).maybeSingle();
  if (error) throw error;
  return data as Course | null;
}

export function courseLabel(course: Course) {
  return course.name_en || course.name_ar || course.id;
}

export async function listCoursesForUpsell(limit = 3) {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name_en, name_ar, min_age, max_age")
    .order("name_en", { ascending: true })
    .limit(limit);
  if (error) throw error;
  return (data || []) as {
    id: string;
    name_en: string | null;
    name_ar: string | null;
    min_age: number | null;
    max_age: number | null;
  }[];
}
