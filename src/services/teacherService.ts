import crypto from "node:crypto";
import { supabase } from "../db/supabase.js";
import { config } from "../config.js";
import { BotUser, Teacher } from "../types.js";
import { setBotUserRole, upsertBotUser } from "./botUserService.js";

export async function initTeacherProfile(input: {
  discordUserId: string;
  displayName: string;
  fullName: string;
  email: string;
  phone?: string | null;
  timezone?: string | null;
}) {
  const botUser = await upsertBotUser({
    discordUserId: input.discordUserId,
    displayName: input.displayName,
    email: input.email,
    phone: input.phone,
    timezone: input.timezone || config.defaultTimezone,
  });

  const { data, error } = await supabase
    .from("teacher_onboarding")
    .upsert(
      {
        bot_user_id: botUser.id,
        discord_user_id: input.discordUserId,
        full_name: input.fullName,
        email: input.email,
        phone: input.phone || null,
        timezone: input.timezone || config.defaultTimezone,
        status: "pending",
      },
      { onConflict: "discord_user_id" },
    )
    .select("*")
    .single();

  if (error) throw error;
  await setBotUserRole(botUser.id, "teacher");
  return data;
}

export async function getTeacherByDiscordId(discordUserId: string) {
  const { data, error } = await supabase
    .from("teacher")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .maybeSingle();
  if (error) throw error;
  return data as Teacher | null;
}

export async function getTeacherByMentionOrId(value: string) {
  const discordUserId = value.replace(/[<@!>]/g, "");
  const { data, error } = await supabase
    .from("teacher")
    .select("*")
    .or(`discord_user_id.eq.${discordUserId},id.eq.${value}`)
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data as Teacher | null;
}

export async function approveTeacher(discordUserId: string, reviewer: BotUser | null) {
  const { data: onboarding, error } = await supabase
    .from("teacher_onboarding")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .single();
  if (error) throw error;

  let authUserId: string | undefined;
  const existing = await getTeacherByDiscordId(discordUserId);
  if (existing) {
    authUserId = existing.id;
  } else {
    const password = crypto.randomBytes(24).toString("base64url");
    const { data: authData, error: authError } =
      await supabase.auth.admin.createUser({
        email: onboarding.email,
        password,
        email_confirm: true,
        user_metadata: {
          role: "teacher",
          name: onboarding.full_name,
          discord_user_id: discordUserId,
        },
      });
    if (authError) throw authError;
    authUserId = authData.user.id;
  }

  const { data: teacher, error: teacherError } = await supabase
    .from("teacher")
    .upsert(
      {
        id: authUserId,
        name: onboarding.full_name,
        email: onboarding.email,
        phone_number: onboarding.phone,
        discord_user_id: discordUserId,
        timezone: onboarding.timezone,
        status: "active",
        active: true,
      },
      { onConflict: "id" },
    )
    .select("*")
    .single();

  if (teacherError) throw teacherError;

  await Promise.all([
    supabase
      .from("teacher_onboarding")
      .update({
        status: "active",
        reviewed_by_bot_user_id: reviewer?.id || null,
        reviewed_at: new Date().toISOString(),
      })
      .eq("discord_user_id", discordUserId),
    supabase
      .from("bot_user")
      .update({ teacher_id: teacher.id })
      .eq("discord_user_id", discordUserId),
  ]);

  return teacher as Teacher;
}

export async function rejectTeacher(
  discordUserId: string,
  reason: string,
  reviewer: BotUser | null,
) {
  const { error } = await supabase
    .from("teacher_onboarding")
    .update({
      status: "rejected",
      rejection_reason: reason,
      reviewed_by_bot_user_id: reviewer?.id || null,
      reviewed_at: new Date().toISOString(),
    })
    .eq("discord_user_id", discordUserId);
  if (error) throw error;
}

export async function setTeacherActive(discordUserId: string, active: boolean) {
  const { data, error } = await supabase
    .from("teacher")
    .update({
      active,
      status: active ? "active" : "inactive",
      deactivated_at: active ? null : new Date().toISOString(),
    })
    .eq("discord_user_id", discordUserId)
    .select("*")
    .single();
  if (error) throw error;
  return data as Teacher;
}

export async function setTeacherResponsibility(input: {
  teacherId: string;
  courseId: string;
  active: boolean;
  assignedByBotUserId?: string;
  canTeachTrial?: boolean;
  canTeachPaid?: boolean;
  priority?: number;
}) {
  const { data, error } = await supabase
    .from("teacher_course_responsibility")
    .upsert(
      {
        teacher_id: input.teacherId,
        course_id: input.courseId,
        active: input.active,
        can_teach_trial: input.canTeachTrial ?? true,
        can_teach_paid: input.canTeachPaid ?? true,
        priority: input.priority ?? 100,
        assigned_by_bot_user_id: input.assignedByBotUserId || null,
      },
      { onConflict: "teacher_id,course_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data;
}

// Completed-lesson counts per teacher for a given month (for payroll).
export async function getTeacherPayroll(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const { data: lessons, error } = await supabase
    .from("lesson")
    .select("teacher_id, lesson_type")
    .eq("status", "completed")
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString());
  if (error) throw error;

  const counts = new Map<string, { trial: number; paid: number }>();
  for (const l of lessons || []) {
    const tid = l.teacher_id as string | null;
    if (!tid) continue;
    const c = counts.get(tid) || { trial: 0, paid: 0 };
    if (l.lesson_type === "paid") c.paid += 1;
    else c.trial += 1;
    counts.set(tid, c);
  }

  const teacherIds = [...counts.keys()];
  const names = new Map<string, string>();
  if (teacherIds.length) {
    const { data } = await supabase.from("teacher").select("id, name").in("id", teacherIds);
    for (const t of data || []) names.set(t.id, (t.name as string) || t.id);
  }

  return teacherIds
    .map((id) => {
      const c = counts.get(id)!;
      return { teacherId: id, name: names.get(id) || id, trial: c.trial, paid: c.paid, total: c.trial + c.paid };
    })
    .sort((a, b) => b.total - a.total);
}

export async function setTeacherRate(teacherId: string, rate: number) {
  const { data, error } = await supabase
    .from("teacher")
    .update({ session_rate: rate })
    .eq("id", teacherId)
    .select("name, session_rate")
    .single();
  if (error) throw error;
  return data as { name: string | null; session_rate: number };
}

// Monthly payout run: completed sessions * per-session rate, per teacher.
export async function getTeacherPayout(year: number, month: number) {
  const start = new Date(Date.UTC(year, month - 1, 1));
  const end = new Date(Date.UTC(year, month, 1));
  const { data: lessons, error } = await supabase
    .from("lesson")
    .select("teacher_id")
    .eq("status", "completed")
    .gte("scheduled_at", start.toISOString())
    .lt("scheduled_at", end.toISOString());
  if (error) throw error;

  const counts = new Map<string, number>();
  for (const l of lessons || []) {
    const tid = l.teacher_id as string | null;
    if (tid) counts.set(tid, (counts.get(tid) || 0) + 1);
  }
  const ids = [...counts.keys()];
  const info = new Map<string, { name: string; rate: number }>();
  if (ids.length) {
    const { data } = await supabase.from("teacher").select("id, name, session_rate").in("id", ids);
    for (const t of data || []) info.set(t.id, { name: (t.name as string) || t.id, rate: Number(t.session_rate || 0) });
  }
  return ids
    .map((id) => {
      const sessions = counts.get(id)!;
      const t = info.get(id) || { name: id, rate: 0 };
      return { teacherId: id, name: t.name, sessions, rate: t.rate, total: sessions * t.rate };
    })
    .sort((a, b) => b.total - a.total);
}

export async function listPendingOnboarding() {
  const { data, error } = await supabase
    .from("teacher_onboarding")
    .select("discord_user_id, full_name, email, created_at")
    .eq("status", "pending")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return data || [];
}

export async function isTeacherResponsibleForCourse(teacherId: string, courseId: string) {
  const { data, error } = await supabase
    .from("teacher_course_responsibility")
    .select("id")
    .eq("teacher_id", teacherId)
    .eq("course_id", courseId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function listTeacherResponsibilities(teacherId: string) {
  const { data, error } = await supabase
    .from("teacher_course_responsibility")
    .select("*, courses:course_id(id, name_en, name_ar)")
    .eq("teacher_id", teacherId)
    .order("active", { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function listTeacherLoad() {
  const { data, error } = await supabase
    .from("teacher_active_lesson_load")
    .select("*")
    .order("active_lesson_count", { ascending: true });
  if (error) throw error;
  return data || [];
}
