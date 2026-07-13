import { supabase } from "../db/supabase.js";

export async function requestMaterial(input: {
  teacherId?: string | null;
  botUserId?: string | null;
  courseId: string;
  lessonNumber: number;
}) {
  const { data: material, error } = await supabase
    .from("course_material")
    .select("*")
    .eq("course_id", input.courseId)
    .eq("lesson_number", input.lessonNumber)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;

  await supabase.from("teacher_material_request").insert({
    teacher_id: input.teacherId || null,
    bot_user_id: input.botUserId || null,
    course_id: input.courseId,
    lesson_number: input.lessonNumber,
    fulfilled_material_id: material?.id || null,
  });

  return material;
}

export async function listCourseMaterials(courseId: string) {
  const { data, error } = await supabase
    .from("course_material")
    .select("lesson_number, title_en, resource_url, attachment_url, presentation_url, pre_quiz_url, post_quiz_url")
    .eq("course_id", courseId)
    .eq("active", true)
    .order("lesson_number", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function removeMaterial(courseId: string, lessonNumber: number) {
  const { data, error } = await supabase
    .from("course_material")
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq("course_id", courseId)
    .eq("lesson_number", lessonNumber)
    .eq("active", true)
    .select("id")
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function addMaterial(input: {
  courseId: string;
  lessonNumber: number;
  titleEn: string;
  titleAr?: string;
  description?: string;
  resourceUrl?: string;
  attachmentUrl?: string;
  presentationUrl?: string;
  preQuizUrl?: string;
  postQuizUrl?: string;
}) {
  const { data, error } = await supabase
    .from("course_material")
    .upsert(
      {
        course_id: input.courseId,
        lesson_number: input.lessonNumber,
        title_en: input.titleEn,
        title_ar: input.titleAr || null,
        description: input.description || null,
        resource_url: input.resourceUrl || null,
        attachment_url: input.attachmentUrl || null,
        presentation_url: input.presentationUrl || null,
        pre_quiz_url: input.preQuizUrl || null,
        post_quiz_url: input.postQuizUrl || null,
        active: true,
      },
      { onConflict: "course_id,lesson_number" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}
