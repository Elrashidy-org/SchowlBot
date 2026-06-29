import { supabase } from "../db/supabase.js";

export async function addAvailability(input: {
  teacherId: string;
  dayOfWeek: number;
  startTime: string;
  endTime: string;
  timezone: string;
  createdByBotUserId?: string;
}) {
  const { data, error } = await supabase
    .from("teacher_availability")
    .insert({
      teacher_id: input.teacherId,
      day_of_week: input.dayOfWeek,
      start_time: input.startTime,
      end_time: input.endTime,
      timezone: input.timezone,
      created_by_bot_user_id: input.createdByBotUserId || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listAvailability(teacherId: string) {
  const { data, error } = await supabase
    .from("teacher_availability")
    .select("*")
    .eq("teacher_id", teacherId)
    .eq("active", true)
    .order("day_of_week", { ascending: true })
    .order("start_time", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function removeAvailability(id: number, teacherId?: string) {
  let query = supabase
    .from("teacher_availability")
    .update({ active: false })
    .eq("id", id);
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const { error } = await query;
  if (error) throw error;
}

export async function clearAvailability(teacherId: string) {
  const { error } = await supabase
    .from("teacher_availability")
    .update({ active: false })
    .eq("teacher_id", teacherId);
  if (error) throw error;
}

export async function addTimeOff(input: {
  teacherId: string;
  startsAt: string;
  endsAt: string;
  reason?: string;
  createdByBotUserId?: string;
}) {
  const { data, error } = await supabase
    .from("teacher_time_off")
    .insert({
      teacher_id: input.teacherId,
      starts_at: input.startsAt,
      ends_at: input.endsAt,
      reason: input.reason || null,
      created_by_bot_user_id: input.createdByBotUserId || null,
    })
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

export async function listTimeOff(teacherId: string) {
  const { data, error } = await supabase
    .from("teacher_time_off")
    .select("*")
    .eq("teacher_id", teacherId)
    .gte("ends_at", new Date().toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function removeTimeOff(id: number, teacherId?: string) {
  let query = supabase.from("teacher_time_off").delete().eq("id", id);
  if (teacherId) query = query.eq("teacher_id", teacherId);
  const { error } = await query;
  if (error) throw error;
}
