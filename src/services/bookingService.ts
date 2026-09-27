import { supabase } from "../db/supabase.js";
import { config } from "../config.js";

// Bookable trial start-times over the next `days`. These come from the fixed
// weekly `trial_hours` template and are the SAME for every course — they are not
// checked against any teacher's calendar. The team staffs a teacher afterwards.
// `courseId` is accepted for API symmetry but does not change the slots.
export async function getAvailableSlots(_courseId: string, days = 14, durationMinutes = 60) {
  const from = new Date().toISOString();
  const to = new Date(Date.now() + Math.max(1, days) * 86400000).toISOString();
  const { data, error } = await supabase.rpc("open_trial_slots", {
    p_from: from,
    p_to: to,
    p_step: durationMinutes,
    p_lead_minutes: config.trialLeadMinutes,
    p_tz: config.defaultTimezone,
  });
  if (error) throw error;
  return (data as string[]) || [];
}
