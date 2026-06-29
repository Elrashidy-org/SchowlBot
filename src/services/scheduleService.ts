import { supabase } from "../db/supabase.js";
import { getLead, updateLeadStatus } from "./leadService.js";

export async function pickTrialTeacher(
  courseId: string,
  startsAt: string,
  durationMinutes = 60,
) {
  const { data, error } = await supabase.rpc("pick_trial_teacher", {
    p_course_id: courseId,
    p_starts_at: startsAt,
    p_duration_minutes: durationMinutes,
  });
  if (error) throw error;
  return data as string | null;
}

export async function scheduleTrial(input: {
  leadId: string;
  courseId: string;
  startsAt: string;
  durationMinutes?: number;
  teacherId?: string | null;
  meetingUrl?: string | null;
  assignedByBotUserId?: string | null;
}) {
  const duration = input.durationMinutes || 60;
  const teacherId =
    input.teacherId || (await pickTrialTeacher(input.courseId, input.startsAt, duration));
  if (!teacherId) {
    throw new Error("No available teacher found for this course and time");
  }

  const lead = await getLead(input.leadId);
  const clientId = await getOrCreateClientIdForLead(lead);
  const endsAt = new Date(new Date(input.startsAt).getTime() + duration * 60_000).toISOString();

  const { data, error } = await supabase
    .from("lesson")
    .insert({
      lead_id: input.leadId,
      client_id: clientId,
      course_uuid: input.courseId,
      teacher_id: teacherId,
      scheduled_at: input.startsAt,
      ends_at: endsAt,
      duration_minutes: duration,
      lesson_type: "trial",
      status: "scheduled",
      lesson: 0,
      meeting_url: input.meetingUrl || null,
      assigned_at: new Date().toISOString(),
      assigned_by_bot_user_id: input.assignedByBotUserId || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  await updateLeadStatus(input.leadId, "trial_booked", input.assignedByBotUserId || undefined);

  await supabase.from("automation_job").insert([
    {
      job_type: "trial_reminder_24h",
      lead_id: lead.id,
      lesson_id: data.id,
      run_at: new Date(new Date(input.startsAt).getTime() - 24 * 60 * 60_000).toISOString(),
      payload: { template: "trial_reminder_24h_en" },
    },
  ]);

  return data;
}

async function getOrCreateClientIdForLead(lead: Awaited<ReturnType<typeof getLead>>) {
  const existing = await supabase
    .from("client")
    .select("id")
    .eq("lead_id", lead.id)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (existing.error) throw existing.error;
  if (existing.data?.id) return existing.data.id as number;

  const inserted = await supabase
    .from("client")
    .insert({
      lead_id: lead.id,
      name: lead.child_name,
      parent_name: lead.parent_name,
      email: lead.email,
      age: lead.child_age,
      country: lead.country_name,
      phone_raw: lead.phone_raw,
      phone_e164: lead.phone_e164,
      course: lead.course_interest || "N/A",
      plan: "N/A",
      interests: lead.course_interest ? [lead.course_interest] : [""],
      status: lead.status,
      trial_lesson: true,
      consent_contact: true,
      privacy_policy_accepted: true,
      country_iso: lead.country_iso,
    })
    .select("id")
    .single();
  if (inserted.error) throw inserted.error;
  return inserted.data.id as number;
}

export async function suggestTrialTeachers(
  courseId: string,
  startsAt: string,
  durationMinutes = 60,
) {
  const picked = await pickTrialTeacher(courseId, startsAt, durationMinutes);
  if (!picked) return [];
  const { data, error } = await supabase
    .from("teacher")
    .select("id, name, email, discord_user_id")
    .eq("id", picked)
    .limit(1);
  if (error) throw error;
  return data || [];
}

export async function markLessonStatus(
  lessonId: number,
  status: "completed" | "cancelled" | "no_show",
) {
  const { data, error } = await supabase
    .from("lesson")
    .update({ status })
    .eq("id", lessonId)
    .select("*")
    .single();
  if (error) throw error;
  if (status === "completed" && data.lead_id) {
    await updateLeadStatus(data.lead_id, "trial_done");
  }
  return data;
}

export async function findScheduleConflicts() {
  const { data, error } = await supabase
    .from("lesson")
    .select("id, teacher_id, scheduled_at, ends_at, status")
    .in("status", ["pending", "scheduled"])
    .not("teacher_id", "is", null)
    .not("scheduled_at", "is", null)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;

  const lessons = data || [];
  const conflicts: typeof lessons = [];
  for (let i = 0; i < lessons.length; i += 1) {
    for (let j = i + 1; j < lessons.length; j += 1) {
      const a = lessons[i];
      const b = lessons[j];
      if (a.teacher_id !== b.teacher_id) continue;
      const aStart = new Date(a.scheduled_at).getTime();
      const aEnd = new Date(a.ends_at).getTime();
      const bStart = new Date(b.scheduled_at).getTime();
      const bEnd = new Date(b.ends_at).getTime();
      if (aStart < bEnd && bStart < aEnd) {
        conflicts.push(a, b);
      }
    }
  }
  return conflicts;
}
