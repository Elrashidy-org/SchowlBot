import { supabase } from "../db/supabase.js";

// Named purposes a Discord channel can be assigned to.
// `leads` is consumed today (new website leads post here). The rest are
// reserved for upcoming features and can be configured ahead of time.
export const CHANNEL_PURPOSES = [
  "leads",
  "teacher_applications",
  "trial_alerts",
  "system_alerts",
  "daily_digest",
] as const;

export type ChannelPurpose = (typeof CHANNEL_PURPOSES)[number];

export interface ChannelConfig {
  id: number;
  guild_id: string;
  purpose: ChannelPurpose;
  channel_id: string;
  channel_name: string | null;
  configured_by_bot_user_id: string | null;
  updated_at: string;
}

export function isChannelPurpose(value: string): value is ChannelPurpose {
  return (CHANNEL_PURPOSES as readonly string[]).includes(value);
}

export async function setChannelConfig(input: {
  guildId: string;
  purpose: ChannelPurpose;
  channelId: string;
  channelName?: string | null;
  configuredByBotUserId?: string;
}) {
  const { data, error } = await supabase
    .from("discord_channel_config")
    .upsert(
      {
        guild_id: input.guildId,
        purpose: input.purpose,
        channel_id: input.channelId,
        channel_name: input.channelName ?? null,
        configured_by_bot_user_id: input.configuredByBotUserId || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "guild_id,purpose" },
    )
    .select("*")
    .single();
  if (error) throw error;
  return data as ChannelConfig;
}

export async function getChannelConfig(guildId: string, purpose: ChannelPurpose) {
  const { data, error } = await supabase
    .from("discord_channel_config")
    .select("*")
    .eq("guild_id", guildId)
    .eq("purpose", purpose)
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelConfig | null) ?? null;
}

export async function listChannelConfigs(guildId: string) {
  const { data, error } = await supabase
    .from("discord_channel_config")
    .select("*")
    .eq("guild_id", guildId)
    .order("purpose", { ascending: true });
  if (error) throw error;
  return (data as ChannelConfig[]) || [];
}

export async function unsetChannelConfig(guildId: string, purpose: ChannelPurpose) {
  const { data, error } = await supabase
    .from("discord_channel_config")
    .delete()
    .eq("guild_id", guildId)
    .eq("purpose", purpose)
    .select("*")
    .maybeSingle();
  if (error) throw error;
  return (data as ChannelConfig | null) ?? null;
}

// Resolve every channel assigned to a purpose, across all guilds. Used by
// background notifications that don't run inside an interaction. SchowlBot runs
// in multiple Schowl servers, so a website lead fans out to each server that
// has configured a channel for the purpose.
export async function resolveChannels(purpose: ChannelPurpose) {
  const { data, error } = await supabase
    .from("discord_channel_config")
    .select("guild_id, channel_id")
    .eq("purpose", purpose)
    .order("updated_at", { ascending: false });
  if (error) throw error;
  return (data || []).map((row) => ({
    guildId: row.guild_id as string,
    channelId: row.channel_id as string,
  }));
}
