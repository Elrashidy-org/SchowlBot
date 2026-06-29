import { supabase } from "../db/supabase.js";
import { Course } from "../types.js";

export async function listCourses() {
  const { data, error } = await supabase
    .from("courses")
    .select("id, name_en, name_ar")
    .order("name_en", { ascending: true });
  if (error) throw error;
  return data as Course[];
}

export async function findCourseByNameOrId(value: string) {
  const query = value.trim();
  const { data, error } = await supabase
    .from("courses")
    .select("id, name_en, name_ar")
    .or(`id.eq.${query},name_en.ilike.%${query}%,name_ar.ilike.%${query}%`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Course | null;
}

export function courseLabel(course: Course) {
  return course.name_en || course.name_ar || course.id;
}
