import { supabase } from "../db/supabase.js";
import { BotRole, BotUser } from "../types.js";
import { config } from "../config.js";

export async function upsertBotUser(input: {
  discordUserId: string;
  displayName?: string | null;
  email?: string | null;
  phone?: string | null;
  timezone?: string | null;
}) {
  const { data, error } = await supabase
    .from("bot_user")
    .upsert(
      {
        discord_user_id: input.discordUserId,
        display_name: input.displayName || null,
        email: input.email || null,
        phone: input.phone || null,
        timezone: input.timezone || config.defaultTimezone,
        active: true,
      },
      { onConflict: "discord_user_id" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as BotUser;
}

export async function getBotUserByDiscordId(discordUserId: string) {
  const { data, error } = await supabase
    .from("bot_user")
    .select("*")
    .eq("discord_user_id", discordUserId)
    .eq("active", true)
    .maybeSingle();
  if (error) throw error;
  return data as BotUser | null;
}

export async function getBotUserRoles(botUserId: string) {
  const { data, error } = await supabase
    .from("bot_user_role")
    .select("role")
    .eq("bot_user_id", botUserId);
  if (error) throw error;
  return (data || []).map((row) => row.role as BotRole);
}

export async function setBotUserRole(botUserId: string, role: BotRole) {
  const { error } = await supabase
    .from("bot_user_role")
    .upsert({ bot_user_id: botUserId, role }, { onConflict: "bot_user_id,role" });
  if (error) throw error;
}

export async function hasAnyRole(
  discordUserId: string,
  roles: BotRole[],
): Promise<boolean> {
  if (config.discordOwnerIds.includes(discordUserId)) {
    return true;
  }

  const user = await getBotUserByDiscordId(discordUserId);
  if (!user) {
    return false;
  }
  const userRoles = await getBotUserRoles(user.id);
  return userRoles.some((role) => roles.includes(role));
}

export async function requireBotRole(discordUserId: string, roles: BotRole[]) {
  const allowed = await hasAnyRole(discordUserId, roles);
  if (!allowed) {
    throw new Error(`This action requires one of: ${roles.join(", ")}`);
  }
  return getBotUserByDiscordId(discordUserId);
}
