import {
  ActionRowBuilder,
  AttachmentBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  GatewayIntentBits,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  type ChatInputCommandInteraction,
  type Interaction,
  type ModalSubmitInteraction,
} from "discord.js";
import { config } from "../config.js";
import { assertSupabaseHealthy, supabase } from "../db/supabase.js";
import { BotRole, ClientLead, LeadStatus } from "../types.js";
import { commandsForRoles } from "./commandCatalog.js";
import { buildWhatsAppLink } from "../utils/template.js";
import { renderForLead } from "../services/templateService.js";
import {
  getBotUserByDiscordId,
  getBotUserById,
  grantRoleToDiscordUser,
  hasAnyRole,
  listRolesByDiscordId,
  requireBotRole,
  revokeRoleFromDiscordUser,
} from "../services/botUserService.js";
import {
  isChannelPurpose,
  listChannelConfigs,
  resolveChannels,
  setChannelConfig,
  unsetChannelConfig,
} from "../services/channelConfigService.js";
import {
  addLeadNote,
  anonymizeLead,
  createLead,
  exportLeads,
  getDigestStats,
  getFunnelStats,
  getLead,
  getLeadStats,
  LEAD_PAGE_SIZE,
  listDueLeads,
  listLeadActivity,
  listLeadsAssignedTo,
  searchLead,
  setLeadAssignee,
  updateLeadStatus,
} from "../services/leadService.js";
import {
  approveTeacher,
  getTeacherByDiscordId,
  getTeacherByMentionOrId,
  getTeacherPayroll,
  initTeacherProfile,
  isTeacherResponsibleForCourse,
  listPendingOnboarding,
  listTeacherLoad,
  listTeacherResponsibilities,
  rejectTeacher,
  setTeacherActive,
  setTeacherResponsibility,
} from "../services/teacherService.js";
import {
  addAvailability,
  addTimeOff,
  clearAvailability,
  listAvailability,
  listTimeOff,
  removeAvailability,
  removeTimeOff,
} from "../services/availabilityService.js";
import { courseLabel, findCourseByNameOrId } from "../services/courseService.js";
import { addReferral, listReferrals, rewardReferral } from "../services/referralService.js";
import { getWeeklySummary } from "../services/summaryService.js";
import {
  exportPayments,
  getRevenue,
  getStudentPaidTotal,
  listOutstandingMemberships,
  listPayments,
  recordPayment,
} from "../services/paymentService.js";
import { sendStudentReport, sendTemplatedEmail } from "../services/emailService.js";
import {
  cancelStudent,
  enrollStudent,
  findStudent,
  getActiveMembership,
  countUpcomingRenewals,
  listStudents,
  listUpcomingRenewals,
  renewMembership,
  setStudentLevel,
} from "../services/studentService.js";
import { addMaterial, listCourseMaterials, removeMaterial, requestMaterial } from "../services/materialService.js";
import {
  completeLesson,
  findLessonsInRange,
  findScheduleConflicts,
  listCompletedSessionsForLead,
  listLessonsForLead,
  listUpcomingLessonsForTeacher,
  markLessonNoShow,
  markLessonStatus,
  rescheduleTrial,
  scheduleRecurringLessons,
  scheduleTrial,
  suggestTrialTeachers,
} from "../services/scheduleService.js";

let client: Client | null = null;

export async function startDiscordBot() {
  if (!config.discordToken) {
    console.warn("DISCORD_TOKEN is not configured; Discord bot disabled");
    return null;
  }

  client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.once("ready", () => {
    console.log(`SchowlBot logged in as ${client?.user?.tag}`);
  });
  client.on("interactionCreate", handleInteraction);
  await client.login(config.discordToken);
  return client;
}

export async function notifyLeadCreated(lead: ClientLead) {
  if (!client) return;

  // Channels configured via `/config channel set leads` (one per Schowl server).
  // Fall back to the legacy env vars when nothing is configured yet.
  const targets = await resolveChannels("leads");
  if (targets.length === 0 && config.discordLeadsChannelId && config.discordGuildId) {
    targets.push({ guildId: config.discordGuildId, channelId: config.discordLeadsChannelId });
  }
  const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp");
  const owner = await resolveLeadOwner(lead.id);

  for (const target of targets) {
    try {
      const channel = await client.channels.fetch(target.channelId);
      if (!channel || channel.type !== ChannelType.GuildText) continue;

      const message = await channel.send({
        content: owner.discordId ? `New lead assigned to <@${owner.discordId}>` : undefined,
        embeds: [leadEmbed(lead, whatsapp, owner.label)],
        components: [leadActionRow(lead.id, whatsapp)],
      });

      await supabase.from("discord_notification").upsert(
        {
          entity_type: "lead",
          entity_id: lead.id,
          guild_id: target.guildId,
          channel_id: target.channelId,
          message_id: message.id,
          metadata: { source: "lead_created" },
        },
        { onConflict: "entity_type,entity_id,channel_id" },
      );
    } catch (error) {
      console.error(`Failed to post lead ${lead.id} to channel ${target.channelId}`, error);
    }
  }

  // Privately DM the assigned rep with the lead details.
  if (owner.discordId) {
    await notifyLeadAssigned(lead, owner.discordId);
  }
}

// DM the assigned teacher privately when a trial is booked for them.
// Teacher-specific alerts go to DMs, never to a public channel.
export async function notifyTeacherTrialAssigned(input: {
  teacherId: string;
  courseLabel: string;
  startsAt: string;
  meetingUrl?: string | null;
  leadId?: string | null;
  lessonId: number;
}) {
  if (!client) return;

  const { data: teacher } = await supabase
    .from("teacher")
    .select("discord_user_id, timezone, name")
    .eq("id", input.teacherId)
    .maybeSingle();
  if (!teacher?.discord_user_id) return;

  let studentName = "the student";
  if (input.leadId) {
    const { data: lead } = await supabase
      .from("client_lead")
      .select("child_name")
      .eq("id", input.leadId)
      .maybeSingle();
    if (lead?.child_name) studentName = lead.child_name;
  }

  const tz = teacher.timezone || config.defaultTimezone;
  const when = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(input.startsAt));

  const embed = new EmbedBuilder()
    .setTitle("New trial assigned to you")
    .setColor(0x00b5b5)
    .addFields(
      { name: "Course", value: input.courseLabel, inline: true },
      { name: "Student", value: studentName, inline: true },
      { name: "When", value: `${when} (${tz})`, inline: false },
      {
        name: "Meeting link",
        value: input.meetingUrl || "Will be shared before the lesson",
        inline: false,
      },
    )
    .setFooter({ text: `Lesson ID: ${input.lessonId}` });

  try {
    const user = await client.users.fetch(teacher.discord_user_id);
    await user.send({ embeds: [embed] });
  } catch (error) {
    console.error(
      `Could not DM teacher ${teacher.discord_user_id} about lesson ${input.lessonId}`,
      error,
    );
  }
}

// Announce a newly-booked trial to the `trial_alerts` channel(s).
export async function notifyTrialBooked(input: {
  childName: string;
  courseLabel: string;
  startsAt: string;
  teacherName?: string | null;
  meetingUrl?: string | null;
  lessonId: number;
}) {
  if (!client) return;
  const targets = await resolveChannels("trial_alerts");
  if (targets.length === 0) return;
  const embed = new EmbedBuilder()
    .setTitle("New trial booked")
    .setColor(0x00b5b5)
    .addFields(
      { name: "Student", value: input.childName, inline: true },
      { name: "Course", value: input.courseLabel, inline: true },
      { name: "Teacher", value: input.teacherName || "-", inline: true },
      { name: "When", value: input.startsAt, inline: false },
      { name: "Meeting", value: input.meetingUrl || "link pending", inline: false },
    )
    .setFooter({ text: `Lesson ID: ${input.lessonId}` });
  for (const target of targets) {
    try {
      const channel = await client.channels.fetch(target.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Trial alert to ${target.channelId} failed`, error);
    }
  }
}

// Post a teacher application to the configured `teacher_applications` channel(s)
// so admins can review and approve/reject.
export async function notifyTeacherApplication(input: {
  discordUserId: string;
  fullName: string;
  email: string;
  phone?: string | null;
  timezone?: string | null;
}) {
  if (!client) return;
  const targets = await resolveChannels("teacher_applications");
  if (targets.length === 0) return;

  const embed = new EmbedBuilder()
    .setTitle("New teacher application")
    .setColor(0xf5a623)
    .setDescription(`<@${input.discordUserId}> applied to teach.`)
    .addFields(
      { name: "Name", value: input.fullName || "-", inline: true },
      { name: "Email", value: input.email || "-", inline: true },
      { name: "Phone", value: input.phone || "-", inline: true },
      { name: "Timezone", value: input.timezone || config.defaultTimezone, inline: true },
    )
    .setFooter({ text: "Use /teacher approve or /teacher reject" });

  for (const target of targets) {
    try {
      const channel = await client.channels.fetch(target.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Failed to post teacher application to ${target.channelId}`, error);
    }
  }
}

// DM a teacher the outcome of their application.
export async function notifyTeacherDecision(
  discordUserId: string,
  approved: boolean,
  reason?: string,
) {
  if (!client) return;
  try {
    const user = await client.users.fetch(discordUserId);
    if (approved) {
      await user.send(
        "✅ Your Schowl teacher application was approved! You can now set your availability with `/availability add`, see your lessons with `/schedule mine`, and request material with `/material request`.",
      );
    } else {
      await user.send(
        `❌ Your Schowl teacher application was not approved.${reason ? ` Reason: ${reason}` : ""}`,
      );
    }
  } catch (error) {
    console.error(`Could not DM teacher decision to ${discordUserId}`, error);
  }
}

// Internal SLA nudge: if a new lead is still uncontacted past its SLA, DM the
// assigned rep, else post to the leads channel. Called by the worker.
export async function notifyLeadSlaBreached(leadId: string) {
  if (!client) return;
  const { data: lead } = await supabase
    .from("client_lead")
    .select("id, status, parent_name, child_name, phone_e164, assigned_sales_user_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead || lead.status !== "new") return; // already engaged

  const msg = `⏰ Lead still uncontacted past SLA: **${lead.child_name}** (${lead.parent_name}) — ${lead.phone_e164}. Lead ID \`${lead.id}\`.`;

  if (lead.assigned_sales_user_id) {
    const { data: assignee } = await supabase
      .from("bot_user")
      .select("discord_user_id")
      .eq("id", lead.assigned_sales_user_id)
      .maybeSingle();
    if (assignee?.discord_user_id) {
      try {
        const user = await client.users.fetch(assignee.discord_user_id);
        await user.send(msg);
        return;
      } catch {
        // fall through to the channel
      }
    }
  }

  const targets = await resolveChannels("leads");
  for (const target of targets) {
    try {
      const channel = await client.channels.fetch(target.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({ content: msg });
      }
    } catch (error) {
      console.error(`SLA nudge to channel ${target.channelId} failed`, error);
    }
  }
}

// Send a plain DM to a Discord user (used by the worker for reminders).
export async function sendDirectMessage(discordUserId: string, content: string) {
  if (!client) return;
  const user = await client.users.fetch(discordUserId);
  await user.send({ content: content.slice(0, 1900) });
}

// Standard confirmation embed used for command replies.
function okEmbed(title: string, description?: string) {
  const embed = new EmbedBuilder().setColor(0x00b5b5).setTitle(title);
  if (description) embed.setDescription(description);
  return embed;
}

function digestEmbed(
  stats: { newToday: number; convertedToday: number; trialsToday: number; due: number },
  renewals: number,
) {
  return new EmbedBuilder()
    .setTitle("Schowl daily digest")
    .setColor(0x00b5b5)
    .setTimestamp(new Date())
    .addFields(
      { name: "New leads today", value: String(stats.newToday), inline: true },
      { name: "Conversions today", value: String(stats.convertedToday), inline: true },
      { name: "Trials today", value: String(stats.trialsToday), inline: true },
      { name: "Follow-ups due now", value: String(stats.due), inline: true },
      { name: "Renewals (next 7d)", value: String(renewals), inline: true },
    );
}

// Post the daily digest to the configured `daily_digest` channel(s).
export async function postDailyDigest() {
  if (!client) return;
  const targets = await resolveChannels("daily_digest");
  if (targets.length === 0) return;
  const stats = await getDigestStats();
  const embed = digestEmbed(stats, await countUpcomingRenewals(7));
  for (const target of targets) {
    try {
      const channel = await client.channels.fetch(target.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({ embeds: [embed] });
      }
    } catch (error) {
      console.error(`Daily digest to ${target.channelId} failed`, error);
    }
  }
}

// Post an operational alert to the configured `system_alerts` channel(s).
export async function notifySystemAlert(message: string) {
  if (!client) return;
  try {
    const targets = await resolveChannels("system_alerts");
    for (const target of targets) {
      const channel = await client.channels.fetch(target.channelId);
      if (channel && channel.type === ChannelType.GuildText) {
        await channel.send({ content: `⚠️ ${message}`.slice(0, 1900) });
      }
    }
  } catch (error) {
    console.error("notifySystemAlert failed", error);
  }
}

async function buildLeadWhatsappLink(lead: ClientLead, baseKey: string) {
  const rendered = await renderForLead(baseKey, lead.language, {
    parent_name: lead.parent_name,
    child_name: lead.child_name,
    child_age: lead.child_age,
    course_interest: lead.course_interest,
  });
  return buildWhatsAppLink(lead.phone_e164, rendered.body);
}

function leadEmbed(lead: ClientLead, whatsappUrl?: string, ownerLabel?: string | null) {
  return new EmbedBuilder()
    .setTitle(`New ${lead.lead_type}: ${lead.child_name}`)
    .setColor(0x00b5b5)
    .setDescription(whatsappUrl ? `[Open WhatsApp template](${whatsappUrl})` : null)
    .addFields(
      { name: "Parent", value: lead.parent_name || "-", inline: true },
      { name: "Child", value: `${lead.child_name}, ${lead.child_age}`, inline: true },
      { name: "Status", value: lead.status, inline: true },
      { name: "Phone", value: lead.phone_e164 || lead.phone_raw, inline: true },
      { name: "Country", value: `${lead.country_name} (${lead.country_iso})`, inline: true },
      { name: "Course", value: lead.course_interest || lead.quiz_recommendation || "-", inline: true },
      { name: "Email", value: lead.email || "-", inline: true },
      { name: "Owner", value: ownerLabel || "unassigned", inline: true },
      { name: "Source", value: lead.source || "-", inline: true },
    )
    .setFooter({ text: `Lead ID: ${lead.id}` })
    .setTimestamp(new Date(lead.created_at));
}

// Resolve a lead's current assignee to a Discord mention + display label.
async function resolveLeadOwner(leadId: string) {
  const { data } = await supabase
    .from("client_lead")
    .select("assigned_sales_user_id")
    .eq("id", leadId)
    .maybeSingle();
  if (!data?.assigned_sales_user_id) return { discordId: null, label: null as string | null };
  const assignee = await getBotUserById(data.assigned_sales_user_id);
  const discordId = assignee?.discord_user_id ?? null;
  return {
    discordId,
    label: discordId ? `<@${discordId}>` : assignee?.display_name ?? null,
  };
}

// DM the assigned rep the full lead so they can act on it immediately.
export async function notifyLeadAssigned(lead: ClientLead, assigneeDiscordId: string) {
  if (!client || !assigneeDiscordId) return;
  try {
    const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp");
    const user = await client.users.fetch(assigneeDiscordId);
    await user.send({
      content: "🆕 You've been assigned a new lead:",
      embeds: [leadEmbed(lead, whatsapp, `<@${assigneeDiscordId}>`)],
      components: [leadActionRow(lead.id, whatsapp)],
    });
  } catch (error) {
    console.error(`Could not DM assigned lead ${lead.id} to ${assigneeDiscordId}`, error);
  }
}

function leadActionRow(leadId: string, whatsappUrl?: string) {
  const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
    new ButtonBuilder()
      .setCustomId(`lead:contacted:${leadId}`)
      .setLabel("Contacted")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`lead:not_fit:${leadId}`)
      .setLabel("Not fit")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`lead:lost:${leadId}`)
      .setLabel("Lost")
      .setStyle(ButtonStyle.Danger),
    new ButtonBuilder()
      .setCustomId(`lead:note:${leadId}`)
      .setLabel("Add note")
      .setStyle(ButtonStyle.Secondary),
  );
  if (whatsappUrl) {
    row.addComponents(
      new ButtonBuilder()
        .setLabel("WhatsApp")
        .setStyle(ButtonStyle.Link)
        .setURL(whatsappUrl),
    );
  }
  return row;
}

async function handleInteraction(interaction: Interaction) {
  try {
    if (interaction.isChatInputCommand()) {
      await handleSlashCommand(interaction);
      return;
    }
    if (interaction.isButton()) {
      await handleButton(interaction);
      return;
    }
    if (interaction.isModalSubmit()) {
      await handleModal(interaction);
    }
  } catch (error) {
    const content = error instanceof Error ? error.message : String(error);
    if (interaction.isRepliable()) {
      if (interaction.deferred || interaction.replied) {
        await interaction.followUp({ content, ephemeral: true });
      } else {
        await interaction.reply({ content, ephemeral: true });
      }
    }
  }
}

async function handleSlashCommand(interaction: ChatInputCommandInteraction) {
  const command = interaction.commandName;
  if (command === "help") return handleHelpCommand(interaction);
  if (command === "whoami") return handleWhoamiCommand(interaction);
  if (command === "stats") return handleStatsCommand(interaction);
  if (command === "funnel") return handleFunnelCommand(interaction);
  if (command === "digest") return handleDigestCommand(interaction);
  if (command === "summary") return handleSummaryCommand(interaction);
  if (command === "init") return handleInit(interaction);
  if (command === "lead") return handleLeadCommand(interaction);
  if (command === "teacher") return handleTeacherCommand(interaction);
  if (command === "availability") return handleAvailabilityCommand(interaction);
  if (command === "timeoff") return handleTimeOffCommand(interaction);
  if (command === "trial") return handleTrialCommand(interaction);
  if (command === "lesson") return handleLessonCommand(interaction);
  if (command === "student") return handleStudentCommand(interaction);
  if (command === "referral") return handleReferralCommand(interaction);
  if (command === "payment") return handlePaymentCommand(interaction);
  if (command === "schedule") return handleScheduleCommand(interaction);
  if (command === "material") return handleMaterialCommand(interaction);
  if (command === "system") return handleSystemCommand(interaction);
  if (command === "config") return handleConfigCommand(interaction);
}

async function handleConfigCommand(interaction: ChatInputCommandInteraction) {
  if (!interaction.guildId) throw new Error("Run this command inside a server.");
  const group = interaction.options.getSubcommandGroup(true);
  const sub = interaction.options.getSubcommand();

  if (group === "channel") {
    await requireBotRole(interaction.user.id, ["owner", "admin"]);
    const actor = await getBotUserByDiscordId(interaction.user.id);

    if (sub === "info") {
      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      if (!channel) throw new Error("Could not resolve a channel.");
      const configs = await listChannelConfigs(interaction.guildId);
      const assigned = configs.filter((row) => row.channel_id === channel.id).map((row) => row.purpose);
      await interaction.reply({
        content: [
          `Channel: <#${channel.id}>`,
          `Name: ${"name" in channel ? channel.name : "-"}`,
          `ID: \`${channel.id}\``,
          `Type: ${ChannelType[channel.type] ?? channel.type}`,
          `Guild ID: \`${interaction.guildId}\``,
          `Assigned purposes: ${assigned.length ? assigned.join(", ") : "none"}`,
        ].join("\n"),
        ephemeral: true,
      });
      return;
    }

    if (sub === "set") {
      const purpose = interaction.options.getString("purpose", true);
      if (!isChannelPurpose(purpose)) throw new Error("Unknown purpose.");
      const channel = interaction.options.getChannel("channel") ?? interaction.channel;
      if (!channel) throw new Error("Could not resolve a channel.");
      if (channel.type !== ChannelType.GuildText) {
        throw new Error("Please choose a standard text channel.");
      }
      await setChannelConfig({
        guildId: interaction.guildId,
        purpose,
        channelId: channel.id,
        channelName: "name" in channel ? channel.name : null,
        configuredByBotUserId: actor?.id,
      });
      await interaction.reply({
        embeds: [okEmbed("Channel configured", `<#${channel.id}> is now used for **${purpose}**.`)],
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const configs = await listChannelConfigs(interaction.guildId);
      await interaction.reply({
        content: configs.length
          ? configs.map((row) => `**${row.purpose}** → <#${row.channel_id}>`).join("\n")
          : "No channels configured. Use `/config channel set` to assign one.",
        ephemeral: true,
      });
      return;
    }

    if (sub === "unset") {
      const purpose = interaction.options.getString("purpose", true);
      if (!isChannelPurpose(purpose)) throw new Error("Unknown purpose.");
      const removed = await unsetChannelConfig(interaction.guildId, purpose);
      await interaction.reply({
        content: removed ? `Cleared the channel for **${purpose}**.` : `Nothing was set for **${purpose}**.`,
        ephemeral: true,
      });
      return;
    }
    return;
  }

  if (group === "role") {
    await requireBotRole(interaction.user.id, ["owner"]);
    const user = interaction.options.getUser("user", true);

    if (sub === "grant") {
      const role = interaction.options.getString("role", true) as BotRole;
      await grantRoleToDiscordUser({ discordUserId: user.id, displayName: user.tag, role });
      await interaction.reply({ embeds: [okEmbed("Role granted", `${user} is now **${role}**.`)], ephemeral: true });
      return;
    }

    if (sub === "revoke") {
      const role = interaction.options.getString("role", true) as BotRole;
      const result = await revokeRoleFromDiscordUser(user.id, role);
      await interaction.reply({
        content: result ? `Revoked **${role}** from ${user.tag}.` : `${user.tag} has no SchowlBot profile.`,
        ephemeral: true,
      });
      return;
    }

    if (sub === "list") {
      const roles = await listRolesByDiscordId(user.id);
      await interaction.reply({
        content: roles.length ? `${user.tag}: ${roles.join(", ")}` : `${user.tag} has no roles.`,
        ephemeral: true,
      });
      return;
    }
  }
}

async function handleHelpCommand(interaction: ChatInputCommandInteraction) {
  const roles = await listRolesByDiscordId(interaction.user.id);
  const available = commandsForRoles(roles);

  const embed = new EmbedBuilder()
    .setTitle("SchowlBot commands")
    .setColor(0x00b5b5)
    .setDescription(
      roles.length
        ? `Your role(s): **${roles.join(", ")}**`
        : "You have no staff roles yet. Run `/init teacher` to apply, or ask an admin to grant you access.",
    )
    .addFields(
      available.map((entry) => ({
        name: entry.usage,
        value: entry.note ? `${entry.description}\n_${entry.note}_` : entry.description,
      })),
    );

  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleWhoamiCommand(interaction: ChatInputCommandInteraction) {
  const roles = await listRolesByDiscordId(interaction.user.id);
  const botUser = await getBotUserByDiscordId(interaction.user.id);
  const teacher = await getTeacherByDiscordId(interaction.user.id);

  const embed = new EmbedBuilder()
    .setTitle("Your SchowlBot profile")
    .setColor(0x00b5b5)
    .addFields(
      { name: "Discord", value: interaction.user.tag, inline: true },
      { name: "Roles", value: roles.length ? roles.join(", ") : "none", inline: true },
      {
        name: "Teacher",
        value: teacher ? `${teacher.status}${teacher.active ? "" : " (inactive)"}` : "not a teacher",
        inline: true,
      },
      { name: "Email", value: botUser?.email || teacher?.email || "-", inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleStatsCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const stats = await getLeadStats();
  const embed = new EmbedBuilder()
    .setTitle("Schowl overview")
    .setColor(0x00b5b5)
    .addFields(
      { name: "Total leads", value: String(stats.total), inline: true },
      { name: "New / uncontacted", value: String(stats.new), inline: true },
      { name: "Converted", value: String(stats.converted), inline: true },
      { name: "Follow-ups due", value: String(stats.due), inline: true },
      { name: "Upcoming trials", value: String(stats.upcomingTrials), inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleFunnelCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const { total, byStatus } = await getFunnelStats();
  const pct = (n: number) => (total ? `${Math.round((n / total) * 100)}%` : "0%");
  const embed = new EmbedBuilder()
    .setTitle("Lead conversion funnel")
    .setColor(0x00b5b5)
    .setDescription(`Total leads: **${total}**`)
    .addFields(
      { name: "New", value: `${byStatus.new} (${pct(byStatus.new)})`, inline: true },
      { name: "Contacted", value: `${byStatus.contacted} (${pct(byStatus.contacted)})`, inline: true },
      { name: "Trial booked", value: `${byStatus.trial_booked} (${pct(byStatus.trial_booked)})`, inline: true },
      { name: "Trial done", value: `${byStatus.trial_done} (${pct(byStatus.trial_done)})`, inline: true },
      { name: "Converted", value: `${byStatus.converted} (${pct(byStatus.converted)})`, inline: true },
      { name: "Not fit / lost", value: `${byStatus.not_fit + byStatus.lost}`, inline: true },
    )
    .setFooter({ text: `Overall conversion: ${pct(byStatus.converted)}` });
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleDigestCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const stats = await getDigestStats();
  await interaction.reply({ embeds: [digestEmbed(stats, await countUpcomingRenewals(7))], ephemeral: true });
}

async function handleSummaryCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const [s, revenue] = await Promise.all([getWeeklySummary(), getRevenue(7)]);
  const revenueText =
    Object.keys(revenue).length > 0
      ? Object.entries(revenue).map(([cur, amt]) => `${amt.toFixed(0)} ${cur}`).join(", ")
      : "0";
  const embed = new EmbedBuilder()
    .setTitle("Weekly summary (last 7 days)")
    .setColor(0x00b5b5)
    .addFields(
      { name: "New leads", value: String(s.newLeads), inline: true },
      { name: "Trials booked", value: String(s.trialsBooked), inline: true },
      { name: "Conversions", value: String(s.conversions), inline: true },
      { name: "Sessions delivered", value: String(s.sessionsDelivered), inline: true },
      {
        name: "Fill rate",
        value: s.fillRate != null ? `${s.fillRate}% (${s.lessonsThisWeek}/${s.capacity})` : "n/a",
        inline: true,
      },
      { name: "Renewals (next 7d)", value: String(s.upcomingRenewals), inline: true },
      { name: "Revenue", value: revenueText, inline: true },
    );
  await interaction.reply({ embeds: [embed], ephemeral: true });
}

async function handleInit(interaction: ChatInputCommandInteraction) {
  const modal = new ModalBuilder()
    .setCustomId("init:teacher")
    .setTitle("Schowl teacher setup")
    .addComponents(
      inputRow("full_name", "Full name", TextInputStyle.Short, true),
      inputRow("email", "Email", TextInputStyle.Short, true),
      inputRow("phone", "Phone number", TextInputStyle.Short, false),
      inputRow("timezone", "Timezone", TextInputStyle.Short, false, config.defaultTimezone),
    );
  await interaction.showModal(modal);
}

function inputRow(
  customId: string,
  label: string,
  style: TextInputStyle,
  required: boolean,
  value?: string,
) {
  return new ActionRowBuilder<TextInputBuilder>().addComponents(
    new TextInputBuilder()
      .setCustomId(customId)
      .setLabel(label)
      .setStyle(style)
      .setRequired(required)
      .setValue(value || ""),
  );
}

async function handleModal(interaction: ModalSubmitInteraction) {
  if (interaction.customId === "init:teacher") {
    const fullName = interaction.fields.getTextInputValue("full_name");
    const email = interaction.fields.getTextInputValue("email");
    const phone = interaction.fields.getTextInputValue("phone");
    const timezone = interaction.fields.getTextInputValue("timezone") || config.defaultTimezone;
    await initTeacherProfile({
      discordUserId: interaction.user.id,
      displayName: interaction.user.tag,
      fullName,
      email,
      phone,
      timezone,
    });
    await notifyTeacherApplication({
      discordUserId: interaction.user.id,
      fullName,
      email,
      phone,
      timezone,
    });
    await interaction.reply({
      content: "Teacher profile submitted. An admin or team lead can approve you with `/teacher approve`.",
      ephemeral: true,
    });
    return;
  }

  if (interaction.customId.startsWith("lead_new")) {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
    const source = interaction.customId.split(":")[1] || "manual";
    const age = Number(interaction.fields.getTextInputValue("child_age").trim());
    if (!Number.isInteger(age) || age < 8 || age > 18) {
      throw new Error("Age must be a whole number between 8 and 18.");
    }
    const email = interaction.fields.getTextInputValue("email").trim();
    const result = await createLead(
      {
        lead_type: "free_trial",
        parent_name: interaction.fields.getTextInputValue("parent_name"),
        child_name: interaction.fields.getTextInputValue("child_name"),
        child_age: age,
        phone: interaction.fields.getTextInputValue("phone"),
        country_iso: "EG",
        country_name: "Egypt",
        language: "en",
        consent_contact: true,
        privacy_policy_accepted: true,
        email: email || undefined,
        source,
      },
      undefined,
      { skipTurnstile: true },
    );
    await interaction.reply({
      embeds: [
        okEmbed(
          "Lead created",
          `Lead \`${result.lead.id}\` for **${result.lead.child_name}**${result.duplicate ? " (matched an existing lead)" : ""}.`,
        ),
      ],
      ephemeral: true,
    });
    if (!result.duplicate) await notifyLeadCreated(result.lead);
    return;
  }

  if (interaction.customId.startsWith("lead_note:")) {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
    const leadId = interaction.customId.split(":")[1];
    const actor = await getBotUserByDiscordId(interaction.user.id);
    const note = interaction.fields.getTextInputValue("note");
    await addLeadNote(leadId, note, actor?.id);
    await interaction.reply({ content: "Note added.", ephemeral: true });
  }
}

async function handleButton(interaction: Interaction & { customId: string }) {
  const [scope, action, leadId] = interaction.customId.split(":");
  if (scope !== "lead") return;
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);

  if (action === "note") {
    const modal = new ModalBuilder()
      .setCustomId(`lead_note:${leadId}`)
      .setTitle("Add lead note")
      .addComponents(inputRow("note", "Note", TextInputStyle.Paragraph, true));
    if ("showModal" in interaction) await interaction.showModal(modal);
    return;
  }

  const status = action as LeadStatus;
  const actor = await getBotUserByDiscordId(interaction.user.id);
  const lead = await updateLeadStatus(leadId, status, actor?.id);
  const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp");
  if (interaction.isMessageComponent()) {
    await interaction.update({
      embeds: [leadEmbed(lead, whatsapp)],
      components: [leadActionRow(lead.id, whatsapp)],
    });
  }
}

async function handleLeadCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const sub = interaction.options.getSubcommand();

  if (sub === "new") {
    const source = interaction.options.getString("source") || "manual";
    const modal = new ModalBuilder()
      .setCustomId(`lead_new:${source}`)
      .setTitle("New lead")
      .addComponents(
        inputRow("parent_name", "Parent name", TextInputStyle.Short, true),
        inputRow("child_name", "Child name", TextInputStyle.Short, true),
        inputRow("child_age", "Child age (8-18)", TextInputStyle.Short, true),
        inputRow("phone", "Phone number", TextInputStyle.Short, true),
        inputRow("email", "Email (optional)", TextInputStyle.Short, false),
      );
    await interaction.showModal(modal);
    return;
  }

  const actor = await getBotUserByDiscordId(interaction.user.id);

  if (sub === "view") {
    const lead = await getLead(interaction.options.getString("lead_id", true));
    const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp");
    await interaction.reply({ embeds: [leadEmbed(lead, whatsapp)], components: [leadActionRow(lead.id, whatsapp)], ephemeral: true });
  } else if (sub === "search") {
    const page = interaction.options.getInteger("page") ?? 1;
    const leads = await searchLead(interaction.options.getString("query", true), page);
    await interaction.reply({ content: formatLeadList(leads, page), ephemeral: true });
  } else if (sub === "status") {
    const lead = await updateLeadStatus(
      interaction.options.getString("lead_id", true),
      interaction.options.getString("status", true) as LeadStatus,
      actor?.id,
    );
    await interaction.reply({
      embeds: [okEmbed("Lead updated", `Lead \`${lead.id}\` is now **${lead.status}**.`)],
      ephemeral: true,
    });
  } else if (sub === "note") {
    await addLeadNote(
      interaction.options.getString("lead_id", true),
      interaction.options.getString("note", true),
      actor?.id,
    );
    await interaction.reply({ embeds: [okEmbed("Note added")], ephemeral: true });
  } else if (sub === "due") {
    const page = interaction.options.getInteger("page") ?? 1;
    const due = await listDueLeads(page);
    await interaction.reply({ content: formatLeadList(due, page), ephemeral: true });
  } else if (sub === "assign") {
    const target = interaction.options.getUser("user", true);
    const targetBotUser = await getBotUserByDiscordId(target.id);
    if (!targetBotUser) {
      throw new Error(
        `${target.tag} has no SchowlBot profile yet. Grant them a role first with \`/config role grant\`.`,
      );
    }
    const lead = await setLeadAssignee(
      interaction.options.getString("lead_id", true),
      targetBotUser.id,
      actor?.id,
    );
    await notifyLeadAssigned(lead, target.id);
    await interaction.reply({
      embeds: [okEmbed("Lead assigned", `Lead \`${lead.id}\` assigned to ${target} — they've been DMed the details.`)],
      ephemeral: true,
    });
  } else if (sub === "mine") {
    if (!actor) throw new Error("You have no SchowlBot profile yet.");
    const page = interaction.options.getInteger("page") ?? 1;
    const leads = await listLeadsAssignedTo(actor.id, page);
    await interaction.reply({ content: formatLeadList(leads, page), ephemeral: true });
  } else if (sub === "history") {
    const rows = await listLeadActivity(interaction.options.getString("lead_id", true));
    await interaction.reply({
      content: rows.length
        ? rows
            .map(
              (row) =>
                `${row.created_at.slice(0, 16).replace("T", " ")} | ${row.activity_type}${
                  row.new_status ? ` → ${row.new_status}` : ""
                }${row.note ? `: ${row.note}` : ""}`,
            )
            .join("\n")
            .slice(0, 1900)
        : "No activity recorded.",
      ephemeral: true,
    });
  } else if (sub === "export") {
    const days = interaction.options.getInteger("days") ?? 30;
    const leads = await exportLeads(days);
    if (leads.length === 0) {
      await interaction.reply({ content: `No leads in the last ${days} days.`, ephemeral: true });
      return;
    }
    const header = "id,created_at,status,lead_type,parent_name,child_name,child_age,phone_e164,country_iso,email,course_interest";
    const csv = [
      header,
      ...leads.map((l) =>
        [l.id, l.created_at, l.status, l.lead_type, l.parent_name, l.child_name, l.child_age, l.phone_e164, l.country_iso, l.email ?? "", l.course_interest ?? ""]
          .map((v) => csvCell(String(v ?? "")))
          .join(","),
      ),
    ].join("\n");
    const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: `leads_last_${days}d.csv` });
    await interaction.reply({ content: `Exported ${leads.length} leads.`, files: [file], ephemeral: true });
  } else if (sub === "forget") {
    await requireBotRole(interaction.user.id, ["owner", "admin"]);
    await anonymizeLead(interaction.options.getString("lead_id", true), actor?.id);
    await interaction.reply({ content: "Lead personal data anonymized.", ephemeral: true });
  }
}

function formatLeadList(leads: ClientLead[], page = 1) {
  if (leads.length === 0) {
    return page > 1 ? `No more leads (page ${page}).` : "No leads found.";
  }
  const body = leads
    .map((lead) => `${lead.id} | ${lead.status} | ${lead.parent_name} | ${lead.child_name} | ${lead.phone_e164}`)
    .join("\n")
    .slice(0, 1850);
  const footer =
    leads.length === LEAD_PAGE_SIZE
      ? `\n— page ${page} — use \`page:${page + 1}\` for more`
      : `\n— page ${page} —`;
  return body + footer;
}

async function handleTeacherCommand(interaction: ChatInputCommandInteraction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const actor = await getBotUserByDiscordId(interaction.user.id);

  // Self-service: a teacher viewing their own assigned courses (no admin role).
  if (!group && sub === "mine") {
    const teacher = await getTeacherByDiscordId(interaction.user.id);
    if (!teacher) throw new Error("Run `/init teacher` and ask an admin to approve you first.");
    const rows = await listTeacherResponsibilities(teacher.id);
    const active = rows.filter((row) => row.active);
    await interaction.reply({
      content: active.length
        ? `Your courses:\n${active.map((row) => `• ${row.courses?.name_en || row.course_id}`).join("\n")}`
        : "You have no assigned courses yet. Ask an admin to assign you with `/teacher responsibility add`.",
      ephemeral: true,
    });
    return;
  }

  if (group === "responsibility") {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead"]);
    const teacher = await mustFindTeacher(interaction.options.getString("teacher", true));
    const course = await mustFindCourse(interaction.options.getString("course", sub !== "list"));
    if (sub === "add") {
      await setTeacherResponsibility({ teacherId: teacher.id, courseId: course.id, active: true, assignedByBotUserId: actor?.id });
      await interaction.reply({ content: `Added ${courseLabel(course)} to ${teacher.name}.`, ephemeral: true });
    } else if (sub === "remove") {
      await setTeacherResponsibility({ teacherId: teacher.id, courseId: course.id, active: false, assignedByBotUserId: actor?.id });
      await interaction.reply({ content: `Removed ${courseLabel(course)} from ${teacher.name}.`, ephemeral: true });
    } else {
      const rows = await listTeacherResponsibilities(teacher.id);
      await interaction.reply({
        content: rows.length ? rows.map((row) => `${row.active ? "active" : "inactive"} | ${row.courses?.name_en || row.course_id}`).join("\n") : "No responsibilities.",
        ephemeral: true,
      });
    }
    return;
  }

  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead"]);
  if (sub === "approve") {
    const user = interaction.options.getUser("user", true);
    const teacher = await approveTeacher(user.id, actor);
    await notifyTeacherDecision(user.id, true);
    await interaction.reply({ embeds: [okEmbed("Teacher approved", `**${teacher.name}** is now active and has been notified.`)], ephemeral: true });
  } else if (sub === "reject") {
    const user = interaction.options.getUser("user", true);
    const reason = interaction.options.getString("reason", true);
    await rejectTeacher(user.id, reason, actor);
    await notifyTeacherDecision(user.id, false, reason);
    await interaction.reply({ embeds: [okEmbed("Teacher rejected", `${user} was rejected and notified.`)], ephemeral: true });
  } else if (sub === "activate" || sub === "deactivate") {
    const user = interaction.options.getUser("user", true);
    const teacher = await setTeacherActive(user.id, sub === "activate");
    await interaction.reply({ embeds: [okEmbed("Teacher updated", `**${teacher.name}** is now **${teacher.status}**.`)], ephemeral: true });
  } else if (sub === "profile") {
    const teacher = await mustFindTeacher(interaction.options.getString("teacher", true));
    await interaction.reply({ content: formatTeacher(teacher), ephemeral: true });
  } else if (sub === "load") {
    const rows = await listTeacherLoad();
    await interaction.reply({
      content: rows.map((row) => `${row.name || row.teacher_id}: ${row.active_lesson_count} active`).join("\n").slice(0, 1900) || "No teachers.",
      ephemeral: true,
    });
  } else if (sub === "pending") {
    const rows = await listPendingOnboarding();
    await interaction.reply({
      content: rows.length
        ? rows.map((row) => `<@${row.discord_user_id}> | ${row.full_name} | ${row.email}`).join("\n").slice(0, 1900)
        : "No pending applications.",
      ephemeral: true,
    });
  } else if (sub === "payroll") {
    const now = new Date();
    const month = interaction.options.getInteger("month") ?? now.getUTCMonth() + 1;
    const year = interaction.options.getInteger("year") ?? now.getUTCFullYear();
    const rows = await getTeacherPayroll(year, month);
    if (rows.length === 0) {
      await interaction.reply({ content: `No completed lessons for ${year}-${String(month).padStart(2, "0")}.`, ephemeral: true });
      return;
    }
    const csv = [
      "Teacher,Trial,Paid,Total",
      ...rows.map((r) => `${csvCell(r.name)},${r.trial},${r.paid},${r.total}`),
    ].join("\n");
    const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), {
      name: `payroll_${year}_${String(month).padStart(2, "0")}.csv`,
    });
    const summary = rows
      .slice(0, 15)
      .map((r) => `${r.name}: ${r.total} (${r.paid} paid, ${r.trial} trial)`)
      .join("\n");
    await interaction.reply({
      content: `Completed lessons for ${year}-${String(month).padStart(2, "0")}:\n${summary}`.slice(0, 1900),
      files: [file],
      ephemeral: true,
    });
  }
}

function csvCell(value: string) {
  // Quote and escape fields that contain CSV-special characters.
  return /[",\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

function formatTeacher(teacher: { id: string; name: string | null; status: string; active: boolean; email?: string | null; discord_user_id?: string | null }) {
  return [
    `ID: ${teacher.id}`,
    `Name: ${teacher.name || "-"}`,
    `Status: ${teacher.status}`,
    `Active: ${teacher.active}`,
    `Email: ${teacher.email || "-"}`,
    `Discord: ${teacher.discord_user_id || "-"}`,
  ].join("\n");
}

async function handleAvailabilityCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const teacher = await getTeacherByDiscordId(interaction.user.id);
  if (!teacher) throw new Error("Run `/init teacher` and ask an admin to approve you first.");
  const actor = await getBotUserByDiscordId(interaction.user.id);

  if (sub === "add") {
    const row = await addAvailability({
      teacherId: teacher.id,
      dayOfWeek: interaction.options.getInteger("day", true),
      startTime: interaction.options.getString("start", true),
      endTime: interaction.options.getString("end", true),
      timezone: teacher.timezone || config.defaultTimezone,
      createdByBotUserId: actor?.id,
    });
    await interaction.reply({ content: `Availability added with ID ${row.id}.`, ephemeral: true });
  } else if (sub === "list") {
    const rows = await listAvailability(teacher.id);
    await interaction.reply({ content: rows.map((row) => `${row.id}: day ${row.day_of_week}, ${row.start_time}-${row.end_time} ${row.timezone}`).join("\n") || "No availability.", ephemeral: true });
  } else if (sub === "remove") {
    await removeAvailability(interaction.options.getInteger("id", true), teacher.id);
    await interaction.reply({ content: "Availability removed.", ephemeral: true });
  } else if (sub === "clear") {
    await clearAvailability(teacher.id);
    await interaction.reply({ content: "Availability cleared.", ephemeral: true });
  }
}

async function handleTimeOffCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const teacher = await getTeacherByDiscordId(interaction.user.id);
  if (!teacher) throw new Error("Run `/init teacher` and ask an admin to approve you first.");
  const actor = await getBotUserByDiscordId(interaction.user.id);

  if (sub === "add") {
    const startsAt = parseDateOption(interaction.options.getString("start", true));
    const endsAt = parseDateOption(interaction.options.getString("end", true));
    const row = await addTimeOff({
      teacherId: teacher.id,
      startsAt,
      endsAt,
      reason: interaction.options.getString("reason") || undefined,
      createdByBotUserId: actor?.id,
    });
    const conflicts = await findLessonsInRange(teacher.id, startsAt, endsAt);
    const warning = conflicts.length
      ? `\n⚠️ ${conflicts.length} scheduled lesson(s) fall in this window — please reschedule: ${conflicts
          .map((c) => `#${c.id} (${c.scheduled_at})`)
          .join(", ")}`.slice(0, 1600)
      : "";
    await interaction.reply({ content: `Time off added with ID ${row.id}.${warning}`, ephemeral: true });
  } else if (sub === "list") {
    const rows = await listTimeOff(teacher.id);
    await interaction.reply({ content: rows.map((row) => `${row.id}: ${row.starts_at} to ${row.ends_at} ${row.reason || ""}`).join("\n") || "No time off.", ephemeral: true });
  } else if (sub === "remove") {
    await removeTimeOff(interaction.options.getInteger("id", true), teacher.id);
    await interaction.reply({ content: "Time off removed.", ephemeral: true });
  }
}

async function handleTrialCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const actor = await getBotUserByDiscordId(interaction.user.id);
  const sub = interaction.options.getSubcommand();

  if (sub === "suggest") {
    const course = await mustFindCourse(interaction.options.getString("course", true));
    const rows = await suggestTrialTeachers(course.id, parseDateOption(interaction.options.getString("starts_at", true)));
    await interaction.reply({ content: rows.map((row) => `${row.name || row.id} | ${row.email || ""}`).join("\n") || "No available teacher.", ephemeral: true });
  } else if (sub === "schedule") {
    const course = await mustFindCourse(interaction.options.getString("course", true));
    const teacherRaw = interaction.options.getString("teacher");
    const teacher = teacherRaw ? await mustFindTeacher(teacherRaw) : null;
    const lesson = await scheduleTrial({
      leadId: interaction.options.getString("lead_id", true),
      courseId: course.id,
      startsAt: parseDateOption(interaction.options.getString("starts_at", true)),
      teacherId: teacher?.id,
      meetingUrl: interaction.options.getString("meeting_url"),
      assignedByBotUserId: actor?.id,
    });
    await interaction.reply({
      embeds: [
        okEmbed(
          "Trial scheduled",
          `Lesson \`${lesson.id}\` booked for **${lesson.scheduled_at}**.${lesson.meeting_url ? `\n[Join link](${lesson.meeting_url})` : ""}\nThe teacher has been DMed.`,
        ),
      ],
      ephemeral: true,
    });
    // Privately notify the assigned teacher (DM, not a public channel).
    await notifyTeacherTrialAssigned({
      teacherId: lesson.teacher_id,
      courseLabel: courseLabel(course),
      startsAt: lesson.scheduled_at,
      meetingUrl: lesson.meeting_url,
      leadId: lesson.lead_id,
      lessonId: lesson.id,
    });
    // Announce the booking to the trial-alerts channel.
    const bookedLead = lesson.lead_id ? await getLead(lesson.lead_id) : null;
    await notifyTrialBooked({
      childName: bookedLead?.child_name || "student",
      courseLabel: courseLabel(course),
      startsAt: lesson.scheduled_at,
      teacherName: teacher?.name,
      meetingUrl: lesson.meeting_url,
      lessonId: lesson.id,
    });
  } else if (sub === "reschedule") {
    const teacherRaw = interaction.options.getString("teacher");
    const teacher = teacherRaw ? await mustFindTeacher(teacherRaw) : null;
    const lesson = await rescheduleTrial({
      lessonId: interaction.options.getInteger("lesson_id", true),
      startsAt: parseDateOption(interaction.options.getString("starts_at", true)),
      teacherId: teacher?.id,
      meetingUrl: interaction.options.getString("meeting_url"),
    });
    await interaction.reply({
      embeds: [okEmbed("Trial rescheduled", `Lesson \`${lesson.id}\` moved to **${lesson.scheduled_at}**. The teacher has been re-notified.`)],
      ephemeral: true,
    });
    // Re-notify the assigned teacher privately.
    const course = lesson.course_uuid ? await findCourseByNameOrId(lesson.course_uuid) : null;
    await notifyTeacherTrialAssigned({
      teacherId: lesson.teacher_id,
      courseLabel: course ? courseLabel(course) : "your course",
      startsAt: lesson.scheduled_at,
      meetingUrl: lesson.meeting_url,
      leadId: lesson.lead_id,
      lessonId: lesson.id,
    });
  } else if (sub === "done" || sub === "cancel" || sub === "no-show") {
    const status = sub === "done" ? "completed" : sub === "cancel" ? "cancelled" : "no_show";
    const lesson = await markLessonStatus(interaction.options.getInteger("lesson_id", true), status);
    await interaction.reply({ embeds: [okEmbed("Lesson updated", `Lesson \`${lesson.id}\` marked **${status}**.`)], ephemeral: true });
  }
}

type AgendaLesson = Awaited<ReturnType<typeof listUpcomingLessonsForTeacher>>[number];

// Render upcoming lessons as a week agenda grouped by day, in the given timezone.
function agendaEmbed(title: string, lessons: AgendaLesson[], tz: string) {
  const dayFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    weekday: "short",
    day: "2-digit",
    month: "short",
  });
  const timeFmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: tz,
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const groups: { day: string; lines: string[] }[] = [];
  for (const lesson of lessons) {
    const date = new Date(lesson.scheduled_at);
    const day = dayFmt.format(date);
    const link = lesson.meeting_url ? `[join](${lesson.meeting_url})` : "no link yet";
    const who = lesson.student_name || "student";
    const what = lesson.course_name || lesson.lesson_type || "lesson";
    const line = `\`${timeFmt.format(date)}\`  ${what} — ${who} · ${link}`;
    const last = groups[groups.length - 1];
    if (last && last.day === day) last.lines.push(line);
    else groups.push({ day, lines: [line] });
  }

  const description = lessons.length
    ? groups
        .map((g) => `**${g.day}**\n${g.lines.join("\n")}`)
        .join("\n\n")
        .slice(0, 4000)
    : "No upcoming lessons.";

  return new EmbedBuilder()
    .setTitle(title)
    .setColor(0x00b5b5)
    .setDescription(description)
    .setFooter({ text: `Times shown in ${tz}` });
}

async function mustFindStudent(value: string) {
  const student = await findStudent(value);
  if (!student) throw new Error("Student not found.");
  return student;
}

function parseDateOnly(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Date must be in YYYY-MM-DD format, e.g. 2026-08-01.");
  }
  return value.slice(0, 10);
}

// DM the owner(s) when a membership renewal is coming up.
export async function notifyRenewalDue(input: {
  name: string;
  renewsOn: string;
  plan: string;
  price?: number | null;
  currency?: string;
}) {
  if (!client) return;
  const embed = new EmbedBuilder()
    .setTitle("Membership renewal due")
    .setColor(0xf5a623)
    .addFields(
      { name: "Student", value: input.name, inline: true },
      { name: "Renews", value: input.renewsOn, inline: true },
      { name: "Plan", value: input.plan, inline: true },
      {
        name: "Price",
        value: input.price != null ? `${input.price} ${input.currency || "EGP"}` : "-",
        inline: true,
      },
    );
  for (const ownerId of config.discordOwnerIds) {
    try {
      const user = await client.users.fetch(ownerId);
      await user.send({ embeds: [embed] });
    } catch (error) {
      console.error(`Renewal DM to owner ${ownerId} failed`, error);
    }
  }
}

async function handleStudentCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const sub = interaction.options.getSubcommand();

  if (sub === "enroll") {
    const course = await mustFindCourse(interaction.options.getString("course", true));
    const teacherRaw = interaction.options.getString("teacher");
    const teacher = teacherRaw ? await mustFindTeacher(teacherRaw) : null;
    const renewsOn = parseDateOnly(interaction.options.getString("renews_on", true));
    const { student, membership } = await enrollStudent({
      leadId: interaction.options.getString("lead_id") || undefined,
      name: interaction.options.getString("name") || undefined,
      courseId: course.id,
      track: interaction.options.getString("track"),
      level: interaction.options.getString("level"),
      teacherId: teacher?.id,
      plan: interaction.options.getString("plan") || undefined,
      price: interaction.options.getNumber("price") ?? undefined,
      renewsOn,
    });
    await interaction.reply({
      embeds: [
        okEmbed(
          "Student enrolled",
          `**${student.name}** enrolled in ${courseLabel(course)}. Membership renews **${membership.renews_on}**.\nStudent ID: \`${student.id}\``,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "view") {
    const student = await mustFindStudent(interaction.options.getString("student", true));
    const membership = await getActiveMembership(student.id);
    const course = student.course_id ? await findCourseByNameOrId(student.course_id) : null;
    const paid = await getStudentPaidTotal(student.id);
    const embed = new EmbedBuilder()
      .setTitle(`Student: ${student.name}`)
      .setColor(0x00b5b5)
      .addFields(
        { name: "Course", value: course ? courseLabel(course) : "-", inline: true },
        { name: "Track", value: student.track || "-", inline: true },
        { name: "Level", value: student.level || "-", inline: true },
        { name: "Status", value: student.status, inline: true },
        { name: "Parent", value: student.parent_name || "-", inline: true },
        { name: "Phone", value: student.phone_e164 || "-", inline: true },
        {
          name: "Membership",
          value: membership
            ? `${membership.plan} · renews **${membership.renews_on}**${membership.price != null ? ` · ${membership.price} ${membership.currency}` : ""}`
            : "none",
          inline: false,
        },
        {
          name: "Paid to date",
          value: paid.count ? `${paid.total} ${paid.currency} (${paid.count} payment${paid.count > 1 ? "s" : ""}, last ${paid.lastPaidOn})` : "none",
          inline: false,
        },
      )
      .setFooter({ text: `Student ID: ${student.id}` });
    await interaction.reply({ embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "list") {
    const page = interaction.options.getInteger("page") ?? 1;
    const rows = await listStudents(page);
    await interaction.reply({
      content: rows.length
        ? `${rows.map((r) => `${r.name} | ${r.track || "-"} | lvl ${r.level || "-"} | ${r.status}`).join("\n").slice(0, 1850)}\n— page ${page} —`
        : "No active students.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "level") {
    const student = await mustFindStudent(interaction.options.getString("student", true));
    const updated = await setStudentLevel(student.id, interaction.options.getString("level", true));
    await interaction.reply({
      embeds: [okEmbed("Level updated", `**${updated.name}** is now at level **${updated.level}**.`)],
      ephemeral: true,
    });
    return;
  }

  if (sub === "renew") {
    const student = await mustFindStudent(interaction.options.getString("student", true));
    const months = interaction.options.getInteger("months") ?? 1;
    const membership = await renewMembership(student.id, months);
    await interaction.reply({
      embeds: [okEmbed("Membership renewed", `**${student.name}**'s membership now renews **${membership.renews_on}**.`)],
      ephemeral: true,
    });
    return;
  }

  if (sub === "cancel") {
    const student = await mustFindStudent(interaction.options.getString("student", true));
    await cancelStudent(student.id);
    await interaction.reply({
      embeds: [okEmbed("Membership cancelled", `**${student.name}** has been cancelled.`)],
      ephemeral: true,
    });
    return;
  }

  if (sub === "report") {
    const student = await mustFindStudent(interaction.options.getString("student", true));
    if (!student.lead_id) {
      await interaction.reply({ content: "This student has no linked sessions yet.", ephemeral: true });
      return;
    }
    const sessions = await listCompletedSessionsForLead(student.lead_id);
    const rated = sessions.filter((s) => s.student_rating != null);
    const avg = rated.length ? rated.reduce((a, s) => a + (s.student_rating as number), 0) / rated.length : null;
    const embed = new EmbedBuilder()
      .setTitle(`Report card: ${student.name}`)
      .setColor(0x00b5b5)
      .setDescription(
        sessions.length
          ? `Average rating: **${avg != null ? avg.toFixed(1) : "-"}/5** across ${sessions.length} session(s)\n\n${sessions
              .map((s) => `${(s.scheduled_at as string).slice(0, 10)} — ⭐${s.student_rating ?? "-"}/5${s.recording_url ? ` · [recording](${s.recording_url})` : ""}`)
              .join("\n")
              .slice(0, 3800)}`
          : "No completed sessions yet.",
      );
    const wantEmail = interaction.options.getBoolean("email") ?? false;
    let note = "";
    if (wantEmail) {
      const sent = await sendStudentReport({
        to: student.email,
        language: "en",
        parentName: student.parent_name,
        childName: student.name,
        avgRating: avg,
        sessions: sessions.map((s) => ({
          date: (s.scheduled_at as string).slice(0, 10),
          rating: (s.student_rating as number | null) ?? null,
          recordingUrl: (s.recording_url as string | null) ?? null,
        })),
      });
      note = sent ? " (emailed to parent)" : " (no parent email on file)";
    }
    await interaction.reply({ content: note ? `Report${note}` : undefined, embeds: [embed], ephemeral: true });
    return;
  }

  if (sub === "renewals") {
    const rows = await listUpcomingRenewals(30);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle("Upcoming renewals (30 days)")
          .setColor(0x00b5b5)
          .setDescription(
            rows.length
              ? rows
                  .map((r) => `**${r.renews_on}** — ${r.name} (${r.plan}${r.price != null ? `, ${r.price} ${r.currency}` : ""})`)
                  .join("\n")
                  .slice(0, 4000)
              : "No renewals in the next 30 days.",
          ),
      ],
      ephemeral: true,
    });
    return;
  }
}

async function handlePaymentCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const actor = await getBotUserByDiscordId(interaction.user.id);
  const sub = interaction.options.getSubcommand();

  if (sub === "record") {
    const student = await mustFindStudent(interaction.options.getString("student", true));
    const months = interaction.options.getInteger("months") ?? undefined;
    const { payment, renewedTo } = await recordPayment({
      studentId: student.id,
      amount: interaction.options.getNumber("amount", true),
      method: interaction.options.getString("method") || undefined,
      months,
      notes: interaction.options.getString("notes"),
      recordedByBotUserId: actor?.id,
    });

    // Email the parent a receipt (default on).
    const sendReceipt = interaction.options.getBoolean("receipt") ?? true;
    let receiptNote = "";
    if (sendReceipt && student.email) {
      const renewsOn = renewedTo || (await getActiveMembership(student.id))?.renews_on || "-";
      await sendTemplatedEmail({
        to: student.email,
        templateKey: "payment_receipt",
        language: "en",
        context: {
          parent_name: student.parent_name || "",
          child_name: student.name,
          amount: payment.amount,
          currency: payment.currency,
          renews_on: renewsOn,
        },
        leadId: student.lead_id,
      });
      receiptNote = "\nReceipt emailed to the parent.";
    }

    await interaction.reply({
      embeds: [
        okEmbed(
          "Payment recorded",
          `**${payment.amount} ${payment.currency}** from **${student.name}** via ${payment.method}.${
            renewedTo ? `\nMembership renewed — now paid through **${renewedTo}**.` : ""
          }${receiptNote}`,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "list") {
    const studentRaw = interaction.options.getString("student");
    const studentId = studentRaw ? (await mustFindStudent(studentRaw)).id : undefined;
    const rows = await listPayments(studentId);
    await interaction.reply({
      content: rows.length
        ? rows.map((p) => `${p.paid_on} | ${p.amount} ${p.currency} | ${p.method}${p.notes ? ` | ${p.notes}` : ""}`).join("\n").slice(0, 1900)
        : "No payments found.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "revenue") {
    const days = interaction.options.getInteger("days") ?? 30;
    const totals = await getRevenue(days);
    const lines = Object.entries(totals).map(([cur, amt]) => `${amt.toFixed(2)} ${cur}`);
    await interaction.reply({
      embeds: [okEmbed(`Revenue (last ${days} days)`, lines.length ? lines.join("\n") : "No payments in this period.")],
      ephemeral: true,
    });
    return;
  }

  if (sub === "outstanding") {
    const days = interaction.options.getInteger("days") ?? 3;
    const rows = await listOutstandingMemberships(days);
    const today = new Date().toISOString().slice(0, 10);
    await interaction.reply({
      embeds: [
        new EmbedBuilder()
          .setTitle(`Outstanding (due within ${days}d)`)
          .setColor(0xf5a623)
          .setDescription(
            rows.length
              ? rows
                  .map((r) => `${r.renews_on <= today ? "⚠️ " : ""}**${r.renews_on}** — ${r.name} (${r.plan}${r.price != null ? `, ${r.price} ${r.currency}` : ""})`)
                  .join("\n")
                  .slice(0, 4000)
              : "Nobody is due — all paid up.",
          ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "export") {
    const days = interaction.options.getInteger("days") ?? 90;
    const rows = await exportPayments(days);
    if (rows.length === 0) {
      await interaction.reply({ content: `No payments in the last ${days} days.`, ephemeral: true });
      return;
    }
    const csv = [
      "paid_on,student,amount,currency,method,notes",
      ...rows.map((r) => [r.paid_on, r.name, r.amount, r.currency, r.method, r.notes ?? ""].map((v) => csvCell(String(v ?? ""))).join(",")),
    ].join("\n");
    const file = new AttachmentBuilder(Buffer.from(csv, "utf8"), { name: `payments_last_${days}d.csv` });
    await interaction.reply({ content: `Exported ${rows.length} payments.`, files: [file], ephemeral: true });
    return;
  }
}

async function handleReferralCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const sub = interaction.options.getSubcommand();
  const actor = await getBotUserByDiscordId(interaction.user.id);

  if (sub === "add") {
    const lead = await getLead(interaction.options.getString("lead_id", true));
    const referral = await addReferral({
      referredLeadId: lead.id,
      referrerName: interaction.options.getString("referrer", true),
      referrerPhone: interaction.options.getString("phone"),
      reward: interaction.options.getString("reward"),
      createdByBotUserId: actor?.id,
    });
    await interaction.reply({
      embeds: [
        okEmbed(
          "Referral recorded",
          `**${referral.referrer_name}** referred **${lead.child_name}**.${referral.reward ? `\nReward: ${referral.reward}` : ""}\nIt will auto-qualify when this lead converts.\nReferral ID: \`${referral.id}\``,
        ),
      ],
      ephemeral: true,
    });
    return;
  }

  if (sub === "list") {
    const rows = await listReferrals(interaction.options.getString("status") || undefined);
    await interaction.reply({
      content: rows.length
        ? rows
            .map((r) => `\`${r.id.slice(0, 8)}\` | ${r.status} | ${r.referrer_name || "-"} → lead ${r.referred_lead_id?.slice(0, 8)} | ${r.reward || "no reward"}`)
            .join("\n")
            .slice(0, 1900)
        : "No referrals found.",
      ephemeral: true,
    });
    return;
  }

  if (sub === "reward") {
    const referral = await rewardReferral(interaction.options.getString("id", true));
    await interaction.reply({
      embeds: [okEmbed("Referral rewarded", `Referral \`${referral.id.slice(0, 8)}\` for **${referral.referrer_name || "referrer"}** marked rewarded.`)],
      ephemeral: true,
    });
    return;
  }
}

async function handleScheduleCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  if (sub === "mine") {
    const teacher = await getTeacherByDiscordId(interaction.user.id);
    if (!teacher) throw new Error("Run `/init teacher` and ask an admin to approve you first.");
    const lessons = await listUpcomingLessonsForTeacher(teacher.id);
    const tz = teacher.timezone || config.defaultTimezone;
    await interaction.reply({ embeds: [agendaEmbed("Your upcoming lessons", lessons, tz)], ephemeral: true });
    return;
  }

  if (sub === "teacher") {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
    const teacher = await mustFindTeacher(interaction.options.getString("teacher", true));
    const lessons = await listUpcomingLessonsForTeacher(teacher.id);
    const tz = teacher.timezone || config.defaultTimezone;
    await interaction.reply({
      embeds: [agendaEmbed(`${teacher.name || "Teacher"} — upcoming lessons`, lessons, tz)],
      ephemeral: true,
    });
    return;
  }

  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const conflicts = await findScheduleConflicts();
  await interaction.reply({ content: conflicts.length ? conflicts.map((row) => `Lesson ${row.id} teacher ${row.teacher_id} ${row.scheduled_at}`).join("\n").slice(0, 1900) : "No conflicts found.", ephemeral: true });
}

async function handleLessonCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();

  // Teacher-facing: mark your own session (or staff can mark any).
  if (sub === "complete" || sub === "noshow") {
    const teacher = await getTeacherByDiscordId(interaction.user.id);
    const isStaff = await hasAnyRole(interaction.user.id, ["owner", "admin", "team_lead"]);
    if (!teacher && !isStaff) {
      throw new Error("Only the assigned teacher or staff can mark a session.");
    }
    const teacherId = isStaff ? undefined : teacher!.id;
    const lessonId = interaction.options.getInteger("lesson_id", true);
    if (sub === "complete") {
      const lesson = await completeLesson({
        lessonId,
        teacherId,
        recordingUrl: interaction.options.getString("recording", true),
        rating: interaction.options.getInteger("rating", true),
        notes: interaction.options.getString("notes"),
      });
      await interaction.reply({
        embeds: [okEmbed("Session marked attended", `Lesson \`${lesson.id}\` completed — rating **${lesson.student_rating}/5**, recording saved.`)],
        ephemeral: true,
      });
    } else {
      const lesson = await markLessonNoShow({ lessonId, teacherId });
      await interaction.reply({ embeds: [okEmbed("Marked no-show", `Lesson \`${lesson.id}\` marked no-show.`)], ephemeral: true });
    }
    return;
  }

  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const actor = await getBotUserByDiscordId(interaction.user.id);

  if (sub === "schedule") {
    const course = await mustFindCourse(interaction.options.getString("course", true));
    const teacher = await mustFindTeacher(interaction.options.getString("teacher", true));
    const result = await scheduleRecurringLessons({
      leadId: interaction.options.getString("lead_id", true),
      courseId: course.id,
      teacherId: teacher.id,
      startsAt: parseDateOption(interaction.options.getString("starts_at", true)),
      weeks: interaction.options.getInteger("weeks", true),
      meetingUrl: interaction.options.getString("meeting_url"),
      durationMinutes: interaction.options.getInteger("duration") ?? undefined,
      assignedByBotUserId: actor?.id,
    });
    await interaction.reply({
      embeds: [
        okEmbed(
          "Recurring lessons scheduled",
          `**${result.count}** weekly ${courseLabel(course)} lessons for **${result.childName}**, starting ${result.firstAt}.`,
        ),
      ],
      ephemeral: true,
    });
    if (teacher.discord_user_id) {
      await sendDirectMessage(
        teacher.discord_user_id,
        `You have been assigned ${result.count} weekly Schowl lessons with ${result.childName} (${courseLabel(course)}), starting ${result.firstAt}.`,
      );
    }
  } else if (sub === "list") {
    const lessons = await listLessonsForLead(interaction.options.getString("lead_id", true));
    await interaction.reply({
      content: lessons.length
        ? lessons
            .map(
              (l) =>
                `Lesson ${l.id} | ${l.lesson_type} | ${l.status} | ${l.scheduled_at}${
                  l.student_rating ? ` | ⭐${l.student_rating}/5` : ""
                }${l.recording_url ? ` | [recording](${l.recording_url})` : ""}`,
            )
            .join("\n")
            .slice(0, 1900)
        : "No lessons for this lead.",
      ephemeral: true,
    });
  } else if (sub === "cancel") {
    const lesson = await markLessonStatus(interaction.options.getInteger("lesson_id", true), "cancelled");
    await interaction.reply({ embeds: [okEmbed("Lesson cancelled", `Lesson \`${lesson.id}\` cancelled.`)], ephemeral: true });
  }
}

// Whether the caller may access material for this course: staff (any course) or
// a teacher assigned to it.
async function assertCanAccessCourseMaterial(discordUserId: string, course: { id: string; name_en: string | null; name_ar: string | null }) {
  const teacher = await getTeacherByDiscordId(discordUserId);
  const isStaff = await hasAnyRole(discordUserId, ["owner", "admin", "team_lead"]);
  if (!teacher && !isStaff) {
    throw new Error("Only teachers and staff can access material.");
  }
  if (teacher && !isStaff) {
    const allowed = await isTeacherResponsibleForCourse(teacher.id, course.id);
    if (!allowed) {
      throw new Error(
        `You can only access material for courses you teach. Ask an admin to assign ${courseLabel(course)} to you.`,
      );
    }
  }
  return teacher;
}

async function handleMaterialCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const course = await mustFindCourse(interaction.options.getString("course", true));

  if (sub === "request") {
    const teacher = await assertCanAccessCourseMaterial(interaction.user.id, course);
    const botUser = await getBotUserByDiscordId(interaction.user.id);
    const lessonNumber = interaction.options.getInteger("lesson", true);
    const material = await requestMaterial({ teacherId: teacher?.id, botUserId: botUser?.id, courseId: course.id, lessonNumber });
    if (!material) {
      await interaction.reply({ content: "No material found for this course lesson yet.", ephemeral: true });
      return;
    }
    await interaction.reply({ content: `${material.title_en}\n${material.resource_url || material.attachment_url || "No URL attached."}`, ephemeral: true });
  } else if (sub === "list") {
    await assertCanAccessCourseMaterial(interaction.user.id, course);
    const rows = await listCourseMaterials(course.id);
    await interaction.reply({
      content: rows.length
        ? rows
            .map((row) => `Lesson ${row.lesson_number}: ${row.title_en}${row.resource_url ? ` — ${row.resource_url}` : ""}`)
            .join("\n")
            .slice(0, 1900)
        : `No material for ${courseLabel(course)} yet.`,
      ephemeral: true,
    });
  } else if (sub === "add") {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead"]);
    const material = await addMaterial({
      courseId: course.id,
      lessonNumber: interaction.options.getInteger("lesson", true),
      titleEn: interaction.options.getString("title", true),
      resourceUrl: interaction.options.getString("url", true),
    });
    await interaction.reply({ content: `Material saved with ID ${material.id}.`, ephemeral: true });
  } else if (sub === "remove") {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead"]);
    const removed = await removeMaterial(course.id, interaction.options.getInteger("lesson", true));
    await interaction.reply({
      content: removed ? "Material removed." : "No active material found for that course lesson.",
      ephemeral: true,
    });
  }
}

async function handleSystemCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead"]);
  await assertSupabaseHealthy();
  await interaction.reply({
    content: [
      "System healthy.",
      `Discord token: ${Boolean(config.discordToken)}`,
      `Resend: ${Boolean(config.resendApiKey)}`,
      `Turnstile: ${Boolean(config.turnstileSecretKey)}`,
      `Leads channel: ${Boolean(config.discordLeadsChannelId)}`,
    ].join("\n"),
    ephemeral: true,
  });
}

async function mustFindTeacher(value: string) {
  const teacher = await getTeacherByMentionOrId(value);
  if (!teacher) throw new Error("Teacher not found");
  return teacher;
}

async function mustFindCourse(value: string | null) {
  if (!value) throw new Error("Course is required");
  const course = await findCourseByNameOrId(value);
  if (!course) throw new Error("Course not found");
  return course;
}

function parseDateOption(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error("Date must be a valid ISO date/time, for example 2026-07-01T18:00:00+03:00");
  }
  return date.toISOString();
}
