import { supabase } from "../db/supabase.js";

// Bookable trial start-times for a course over the next `days`.
export async function getAvailableSlots(courseId: string, days = 14, durationMinutes = 60) {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  const { data, error } = await supabase.rpc("available_trial_slots", {
    p_course_id: courseId,
    p_from: from,
    p_to: to,
    p_duration: durationMinutes,
    p_step: 60,
  });
  if (error) throw error;
  return (data as string[]) || [];
}
