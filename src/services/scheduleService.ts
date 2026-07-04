import { supabase } from "../db/supabase.js";
import { config } from "../config.js";
import { getLead, updateLeadStatus } from "./leadService.js";
import { createMeetEvent, isMeetConfigured } from "./meetService.js";

// Use the provided meeting link, otherwise auto-generate a Google Meet link
// when Google is configured. Failures fall back to no link (never blocks booking).
async function resolveMeetingUrl(
  provided: string | null | undefined,
  event: { summary: string; startsAt: string; endsAt: string; attendees?: (string | null | undefined)[] },
): Promise<string | null> {
  if (provided) return provided;
  if (!isMeetConfigured()) return null;
  try {
    const attendees = (event.attendees || []).filter((e): e is string => Boolean(e));
    return await createMeetEvent({
      summary: event.summary,
      startsAt: event.startsAt,
      endsAt: event.endsAt,
      timezone: config.defaultTimezone,
      attendees: attendees.length ? attendees : undefined,
    });
  } catch (error) {
    console.error("Google Meet link creation failed", error);
    return null;
  }
}

async function getTeacherContact(teacherId: string) {
  const { data } = await supabase
    .from("teacher")
    .select("name, discord_user_id, email")
    .eq("id", teacherId)
    .maybeSingle();
  return {
    name: (data?.name as string | null) ?? null,
    discordUserId: (data?.discord_user_id as string | null) ?? null,
    email: (data?.email as string | null) ?? null,
  };
}

function formatScheduledAt(iso: string) {
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: config.defaultTimezone,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));
}

// Queue confirmation + 24h reminder (parent email) + 24h teacher DM for a trial.
// Templates use base keys; the worker picks the language from the lead.
async function enqueueTrialJobs(input: {
  leadId: string;
  childName: string;
  lessonId: number;
  teacherId: string;
  startsAt: string;
  meetingUrl?: string | null;
}) {
  const teacher = await getTeacherContact(input.teacherId);
  const context = {
    scheduled_at: formatScheduledAt(input.startsAt),
    teacher_name: teacher.name ?? "your Schowl teacher",
    meeting_url: input.meetingUrl || "the link we will share before the lesson",
  };
  const now = new Date();
  const reminderAt = new Date(new Date(input.startsAt).getTime() - 24 * 60 * 60_000);

  const jobs: {
    job_type: string;
    lead_id: string;
    lesson_id: number;
    run_at: string;
    payload: Record<string, unknown>;
  }[] = [
    {
      job_type: "trial_confirmation",
      lead_id: input.leadId,
      lesson_id: input.lessonId,
      run_at: now.toISOString(),
      payload: { template: "trial_booked", context },
    },
  ];

  if (reminderAt.getTime() > now.getTime()) {
    jobs.push({
      job_type: "trial_reminder_24h",
      lead_id: input.leadId,
      lesson_id: input.lessonId,
      run_at: reminderAt.toISOString(),
      payload: { template: "trial_reminder_24h", context },
    });
    if (teacher.discordUserId) {
      jobs.push({
        job_type: "teacher_trial_reminder",
        lead_id: input.leadId,
        lesson_id: input.lessonId,
        run_at: reminderAt.toISOString(),
        payload: {
          dm_discord_user_id: teacher.discordUserId,
          message: `Reminder: your Schowl trial with ${input.childName} is in ~24h — ${context.scheduled_at}. Meeting: ${context.meeting_url}`,
        },
      });
    }
  }

  const { error } = await supabase.from("automation_job").insert(jobs);
  if (error) throw error;
}

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
  const trialTeacher = await getTeacherContact(teacherId);
  const meetingUrl = await resolveMeetingUrl(input.meetingUrl, {
    summary: `Schowl trial — ${lead.child_name}`,
    startsAt: input.startsAt,
    endsAt,
    attendees: [lead.email, trialTeacher.email],
  });

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
      meeting_url: meetingUrl,
      assigned_at: new Date().toISOString(),
      assigned_by_bot_user_id: input.assignedByBotUserId || null,
    })
    .select("*")
    .single();
  if (error) throw error;

  await updateLeadStatus(input.leadId, "trial_booked", input.assignedByBotUserId || undefined);

  await enqueueTrialJobs({
    leadId: lead.id,
    childName: lead.child_name,
    lessonId: data.id,
    teacherId,
    startsAt: input.startsAt,
    meetingUrl,
  });

  return data;
}

export async function rescheduleTrial(input: {
  lessonId: number;
  startsAt: string;
  teacherId?: string | null;
  meetingUrl?: string | null;
}) {
  const { data: existing, error: loadError } = await supabase
    .from("lesson")
    .select("*")
    .eq("id", input.lessonId)
    .single();
  if (loadError) throw loadError;

  const duration = existing.duration_minutes || 60;
  const teacherId = input.teacherId || (existing.teacher_id as string | null);
  if (!teacherId) throw new Error("This lesson has no teacher; assign one when rescheduling.");
  const endsAt = new Date(new Date(input.startsAt).getTime() + duration * 60_000).toISOString();

  const patch: Record<string, unknown> = {
    scheduled_at: input.startsAt,
    ends_at: endsAt,
    teacher_id: teacherId,
    status: "scheduled",
    assigned_at: new Date().toISOString(),
  };
  if (input.meetingUrl) patch.meeting_url = input.meetingUrl;

  const { data: updated, error } = await supabase
    .from("lesson")
    .update(patch)
    .eq("id", input.lessonId)
    .select("*")
    .single();
  if (error) throw error;

  // Drop the old confirmation/reminder jobs and queue fresh ones.
  await supabase
    .from("automation_job")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("lesson_id", input.lessonId)
    .eq("status", "pending");

  let childName = "the student";
  if (updated.lead_id) {
    const { data: lead } = await supabase
      .from("client_lead")
      .select("child_name")
      .eq("id", updated.lead_id)
      .maybeSingle();
    if (lead?.child_name) childName = lead.child_name;
  }

  await enqueueTrialJobs({
    leadId: updated.lead_id,
    childName,
    lessonId: updated.id,
    teacherId,
    startsAt: input.startsAt,
    meetingUrl: (updated.meeting_url as string | null) ?? null,
  });

  return updated;
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

export async function listUpcomingLessonsForTeacher(teacherId: string) {
  const { data: lessons, error } = await supabase
    .from("lesson")
    .select("id, scheduled_at, ends_at, status, meeting_url, lesson_type, course_uuid, lead_id")
    .eq("teacher_id", teacherId)
    .gte("scheduled_at", new Date().toISOString())
    .in("status", ["pending", "scheduled"])
    .order("scheduled_at", { ascending: true })
    .limit(20);
  if (error) throw error;

  const rows = lessons || [];
  const courseIds = [...new Set(rows.map((r) => r.course_uuid).filter(Boolean))];
  const leadIds = [...new Set(rows.map((r) => r.lead_id).filter(Boolean))];

  const courseNames = new Map<string, string>();
  if (courseIds.length) {
    const { data } = await supabase
      .from("courses")
      .select("id, name_en, name_ar")
      .in("id", courseIds);
    for (const c of data || []) {
      courseNames.set(c.id, c.name_en || c.name_ar || c.id);
    }
  }

  const studentNames = new Map<string, string>();
  if (leadIds.length) {
    const { data } = await supabase
      .from("client_lead")
      .select("id, child_name")
      .in("id", leadIds);
    for (const l of data || []) {
      studentNames.set(l.id, l.child_name);
    }
  }

  return rows.map((r) => ({
    id: r.id as number,
    scheduled_at: r.scheduled_at as string,
    status: r.status as string,
    meeting_url: (r.meeting_url as string | null) ?? null,
    lesson_type: (r.lesson_type as string | null) ?? null,
    course_name: r.course_uuid ? courseNames.get(r.course_uuid) ?? null : null,
    student_name: r.lead_id ? studentNames.get(r.lead_id) ?? null : null,
  }));
}

// Create a weekly recurring series of paid lessons (e.g. after a trial converts).
export async function scheduleRecurringLessons(input: {
  leadId: string;
  courseId: string;
  teacherId: string;
  startsAt: string;
  weeks: number;
  durationMinutes?: number;
  meetingUrl?: string | null;
  assignedByBotUserId?: string | null;
}) {
  const weeks = Math.max(1, Math.min(Math.trunc(input.weeks), 26));
  const duration = input.durationMinutes || 60;
  const lead = await getLead(input.leadId);
  const clientId = await getOrCreateClientIdForLead(lead);
  const teacher = await getTeacherContact(input.teacherId);
  const baseStart = new Date(input.startsAt).getTime();

  // One Meet link reused across the whole weekly series.
  const meetingUrl = await resolveMeetingUrl(input.meetingUrl, {
    summary: `Schowl lessons — ${lead.child_name}`,
    startsAt: new Date(baseStart).toISOString(),
    endsAt: new Date(baseStart + duration * 60_000).toISOString(),
    attendees: [lead.email, teacher.email],
  });

  const rows = Array.from({ length: weeks }, (_, i) => {
    const start = new Date(baseStart + i * 7 * 24 * 60 * 60_000);
    const ends = new Date(start.getTime() + duration * 60_000);
    return {
      lead_id: input.leadId,
      client_id: clientId,
      course_uuid: input.courseId,
      teacher_id: input.teacherId,
      scheduled_at: start.toISOString(),
      ends_at: ends.toISOString(),
      duration_minutes: duration,
      lesson_type: "paid",
      status: "scheduled",
      lesson: i + 1,
      meeting_url: meetingUrl,
      assigned_at: new Date().toISOString(),
      assigned_by_bot_user_id: input.assignedByBotUserId || null,
    };
  });

  const { data, error } = await supabase.from("lesson").insert(rows).select("id, scheduled_at");
  if (error) throw error;
  const lessons = data || [];

  // Queue 24h reminders per occurrence: a teacher DM and a parent email.
  const now = Date.now();
  const jobs: {
    job_type: string;
    lead_id: string;
    lesson_id: number;
    run_at: string;
    payload: Record<string, unknown>;
  }[] = [];
  for (const l of lessons) {
    const reminderAt = new Date(new Date(l.scheduled_at).getTime() - 24 * 60 * 60_000);
    if (reminderAt.getTime() <= now) continue;
    const when = formatScheduledAt(l.scheduled_at as string);
    if (teacher.discordUserId) {
      jobs.push({
        job_type: "lesson_reminder",
        lead_id: lead.id,
        lesson_id: l.id as number,
        run_at: reminderAt.toISOString(),
        payload: {
          dm_discord_user_id: teacher.discordUserId,
          message: `Reminder: your Schowl lesson with ${lead.child_name} is in ~24h — ${when}. Meeting: ${meetingUrl || "the usual link"}`,
        },
      });
    }
    jobs.push({
      job_type: "lesson_reminder_parent",
      lead_id: lead.id,
      lesson_id: l.id as number,
      run_at: reminderAt.toISOString(),
      payload: {
        template: "lesson_reminder",
        context: { scheduled_at: when, meeting_url: meetingUrl || "the usual link" },
      },
    });
  }
  if (jobs.length) {
    const { error: jobError } = await supabase.from("automation_job").insert(jobs);
    if (jobError) throw jobError;
  }

  // Enrolling the student converts the lead.
  await updateLeadStatus(lead.id, "converted", input.assignedByBotUserId || undefined);

  return {
    count: lessons.length,
    firstAt: lessons[0]?.scheduled_at as string | undefined,
    childName: lead.child_name,
    teacherName: teacher.name,
    teacherDiscordId: teacher.discordUserId,
  };
}

// Scheduled/pending lessons for a teacher that overlap a date range
// (used to warn when time off collides with booked lessons).
export async function findLessonsInRange(teacherId: string, startsAt: string, endsAt: string) {
  const { data, error } = await supabase
    .from("lesson")
    .select("id, scheduled_at")
    .eq("teacher_id", teacherId)
    .in("status", ["pending", "scheduled"])
    .gte("scheduled_at", startsAt)
    .lt("scheduled_at", endsAt)
    .order("scheduled_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function listLessonsForLead(leadId: string) {
  const { data, error } = await supabase
    .from("lesson")
    .select("id, scheduled_at, status, lesson_type, meeting_url, recording_url, student_rating")
    .eq("lead_id", leadId)
    .order("scheduled_at", { ascending: true })
    .limit(30);
  if (error) throw error;
  return data || [];
}

// Teacher marks a session attended with a recording URL + 1-5 student rating.
export async function completeLesson(input: {
  lessonId: number;
  teacherId?: string | null;
  recordingUrl: string;
  rating: number;
  notes?: string | null;
}) {
  const { data: lesson, error: loadError } = await supabase
    .from("lesson")
    .select("id, teacher_id, lead_id, lesson_type")
    .eq("id", input.lessonId)
    .single();
  if (loadError) throw loadError;
  if (input.teacherId && lesson.teacher_id !== input.teacherId) {
    throw new Error("This lesson isn't assigned to you.");
  }

  const { data, error } = await supabase
    .from("lesson")
    .update({
      status: "completed",
      recording_url: input.recordingUrl,
      student_rating: input.rating,
      session_notes: input.notes || null,
    })
    .eq("id", input.lessonId)
    .select("*")
    .single();
  if (error) throw error;

  if (data.lesson_type === "trial" && data.lead_id) {
    await updateLeadStatus(data.lead_id, "trial_done");
  }
  await supabase
    .from("automation_job")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("lesson_id", input.lessonId)
    .eq("status", "pending");
  return data;
}

export async function markLessonNoShow(input: { lessonId: number; teacherId?: string | null }) {
  if (input.teacherId) {
    const { data: lesson } = await supabase
      .from("lesson")
      .select("teacher_id")
      .eq("id", input.lessonId)
      .single();
    if (lesson && lesson.teacher_id !== input.teacherId) {
      throw new Error("This lesson isn't assigned to you.");
    }
  }
  return markLessonStatus(input.lessonId, "no_show");
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
  if (status === "completed" && data.lead_id && data.lesson_type === "trial") {
    await updateLeadStatus(data.lead_id, "trial_done");
  }
  // A cancelled or no-show trial should not keep sending reminders.
  if (status === "cancelled" || status === "no_show") {
    await supabase
      .from("automation_job")
      .update({ status: "cancelled", updated_at: new Date().toISOString() })
      .eq("lesson_id", lessonId)
      .eq("status", "pending");
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
