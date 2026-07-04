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

export async function removeBotUserRole(botUserId: string, role: BotRole) {
  const { error } = await supabase
    .from("bot_user_role")
    .delete()
    .eq("bot_user_id", botUserId)
    .eq("role", role);
  if (error) throw error;
}

// Grant a role to a Discord user, creating their bot_user record if needed.
export async function grantRoleToDiscordUser(input: {
  discordUserId: string;
  displayName?: string | null;
  role: BotRole;
}) {
  const botUser = await upsertBotUser({
    discordUserId: input.discordUserId,
    displayName: input.displayName,
  });
  await setBotUserRole(botUser.id, input.role);
  return botUser;
}

export async function revokeRoleFromDiscordUser(discordUserId: string, role: BotRole) {
  const botUser = await getBotUserByDiscordId(discordUserId);
  if (!botUser) return null;
  await removeBotUserRole(botUser.id, role);
  return botUser;
}

export async function listRolesByDiscordId(discordUserId: string): Promise<BotRole[]> {
  const botUser = await getBotUserByDiscordId(discordUserId);
  const roles = botUser ? await getBotUserRoles(botUser.id) : [];
  // Owners are configured via env, not the role table; surface that here too.
  if (config.discordOwnerIds.includes(discordUserId) && !roles.includes("owner")) {
    return ["owner", ...roles];
  }
  return roles;
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

// Bot users who can own leads (sales + team leads), used for round-robin assignment.
export async function listSalesAssignees(): Promise<string[]> {
  const { data, error } = await supabase
    .from("bot_user_role")
    .select("bot_user_id, role, bot_user!inner(active)")
    .in("role", ["sales", "team_lead"]);
  if (error) throw error;
  const ids = new Set<string>();
  for (const row of data || []) {
    const active = (row as { bot_user?: { active?: boolean } }).bot_user?.active;
    if (active !== false) ids.add(row.bot_user_id as string);
  }
  return [...ids];
}

// Owners (from env) as bot_user ids — used as the fallback lead pool when no
// sales reps exist yet. Creates a bot_user record for each owner if missing.
export async function getOwnerBotUserIds(): Promise<string[]> {
  const ids: string[] = [];
  for (const discordUserId of config.discordOwnerIds) {
    const botUser = await upsertBotUser({ discordUserId });
    ids.push(botUser.id);
  }
  return ids;
}

export async function getBotUserById(botUserId: string) {
  const { data, error } = await supabase
    .from("bot_user")
    .select("*")
    .eq("id", botUserId)
    .maybeSingle();
  if (error) throw error;
  return data as BotUser | null;
}

export async function requireBotRole(discordUserId: string, roles: BotRole[]) {
  const allowed = await hasAnyRole(discordUserId, roles);
  if (!allowed) {
    throw new Error(`This action requires one of: ${roles.join(", ")}`);
  }
  return getBotUserByDiscordId(discordUserId);
}
