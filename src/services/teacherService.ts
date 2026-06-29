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
    .select("*, bot_user(*)")
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
