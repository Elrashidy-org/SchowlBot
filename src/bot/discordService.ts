import {
  ActionRowBuilder,
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
import { ClientLead, LeadStatus } from "../types.js";
import { buildWhatsAppLink } from "../utils/template.js";
import { renderCommunicationTemplate } from "../services/templateService.js";
import { getBotUserByDiscordId, requireBotRole, upsertBotUser } from "../services/botUserService.js";
import { addLeadNote, getLead, listDueLeads, searchLead, updateLeadStatus } from "../services/leadService.js";
import {
  approveTeacher,
  getTeacherByDiscordId,
  getTeacherByMentionOrId,
  initTeacherProfile,
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
import { addMaterial, requestMaterial } from "../services/materialService.js";
import { findScheduleConflicts, markLessonStatus, scheduleTrial, suggestTrialTeachers } from "../services/scheduleService.js";

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
  if (!client || !config.discordLeadsChannelId || !config.discordGuildId) return;
  const channel = await client.channels.fetch(config.discordLeadsChannelId);
  if (!channel || channel.type !== ChannelType.GuildText) return;

  const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp_en");
  const message = await channel.send({
    embeds: [leadEmbed(lead, whatsapp)],
    components: [leadActionRow(lead.id, whatsapp)],
  });

  await supabase.from("discord_notification").upsert(
    {
      entity_type: "lead",
      entity_id: lead.id,
      guild_id: config.discordGuildId,
      channel_id: config.discordLeadsChannelId,
      message_id: message.id,
      metadata: { source: "lead_created" },
    },
    { onConflict: "entity_type,entity_id,channel_id" },
  );
}

async function buildLeadWhatsappLink(lead: ClientLead, templateKey: string) {
  const rendered = await renderCommunicationTemplate(templateKey, {
    parent_name: lead.parent_name,
    child_name: lead.child_name,
    child_age: lead.child_age,
    course_interest: lead.course_interest,
  });
  return buildWhatsAppLink(lead.phone_e164, rendered.body);
}

function leadEmbed(lead: ClientLead, whatsappUrl?: string) {
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
      { name: "Landing", value: lead.landing_page || "-", inline: true },
      { name: "Referrer", value: lead.referrer || "-", inline: false },
    )
    .setFooter({ text: `Lead ID: ${lead.id}` })
    .setTimestamp(new Date(lead.created_at));
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
  if (command === "init") return handleInit(interaction);
  if (command === "lead") return handleLeadCommand(interaction);
  if (command === "teacher") return handleTeacherCommand(interaction);
  if (command === "availability") return handleAvailabilityCommand(interaction);
  if (command === "timeoff") return handleTimeOffCommand(interaction);
  if (command === "trial") return handleTrialCommand(interaction);
  if (command === "schedule") return handleScheduleCommand(interaction);
  if (command === "material") return handleMaterialCommand(interaction);
  if (command === "system") return handleSystemCommand(interaction);
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
    await interaction.reply({
      content: "Teacher profile submitted. An admin or team lead can approve you with `/teacher approve`.",
      ephemeral: true,
    });
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
  const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp_en");
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
  const actor = await getBotUserByDiscordId(interaction.user.id);

  if (sub === "view") {
    const lead = await getLead(interaction.options.getString("lead_id", true));
    const whatsapp = await buildLeadWhatsappLink(lead, "first_contact_whatsapp_en");
    await interaction.reply({ embeds: [leadEmbed(lead, whatsapp)], components: [leadActionRow(lead.id, whatsapp)], ephemeral: true });
  } else if (sub === "search") {
    const leads = await searchLead(interaction.options.getString("query", true));
    await interaction.reply({ content: formatLeadList(leads), ephemeral: true });
  } else if (sub === "status") {
    const lead = await updateLeadStatus(
      interaction.options.getString("lead_id", true),
      interaction.options.getString("status", true) as LeadStatus,
      actor?.id,
    );
    await interaction.reply({ content: `Lead ${lead.id} is now ${lead.status}`, ephemeral: true });
  } else if (sub === "note") {
    await addLeadNote(
      interaction.options.getString("lead_id", true),
      interaction.options.getString("note", true),
      actor?.id,
    );
    await interaction.reply({ content: "Note added.", ephemeral: true });
  } else if (sub === "due") {
    const due = await listDueLeads();
    await interaction.reply({ content: formatLeadList(due), ephemeral: true });
  }
}

function formatLeadList(leads: ClientLead[]) {
  if (leads.length === 0) return "No leads found.";
  return leads
    .map((lead) => `${lead.id} | ${lead.status} | ${lead.parent_name} | ${lead.child_name} | ${lead.phone_e164}`)
    .join("\n")
    .slice(0, 1900);
}

async function handleTeacherCommand(interaction: ChatInputCommandInteraction) {
  const group = interaction.options.getSubcommandGroup(false);
  const sub = interaction.options.getSubcommand();
  const actor = await getBotUserByDiscordId(interaction.user.id);

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
    await interaction.reply({ content: `Approved ${teacher.name}.`, ephemeral: true });
  } else if (sub === "reject") {
    const user = interaction.options.getUser("user", true);
    await rejectTeacher(user.id, interaction.options.getString("reason", true), actor);
    await interaction.reply({ content: `Rejected ${user.tag}.`, ephemeral: true });
  } else if (sub === "activate" || sub === "deactivate") {
    const user = interaction.options.getUser("user", true);
    const teacher = await setTeacherActive(user.id, sub === "activate");
    await interaction.reply({ content: `${teacher.name} is now ${teacher.status}.`, ephemeral: true });
  } else if (sub === "profile") {
    const teacher = await mustFindTeacher(interaction.options.getString("teacher", true));
    await interaction.reply({ content: formatTeacher(teacher), ephemeral: true });
  } else if (sub === "load") {
    const rows = await listTeacherLoad();
    await interaction.reply({
      content: rows.map((row) => `${row.name || row.teacher_id}: ${row.active_lesson_count} active`).join("\n").slice(0, 1900) || "No teachers.",
      ephemeral: true,
    });
  }
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
    const row = await addTimeOff({
      teacherId: teacher.id,
      startsAt: parseDateOption(interaction.options.getString("start", true)),
      endsAt: parseDateOption(interaction.options.getString("end", true)),
      reason: interaction.options.getString("reason") || undefined,
      createdByBotUserId: actor?.id,
    });
    await interaction.reply({ content: `Time off added with ID ${row.id}.`, ephemeral: true });
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
    await interaction.reply({ content: `Trial scheduled. Lesson ID ${lesson.id}, teacher ${lesson.teacher_id}.`, ephemeral: true });
  } else if (sub === "done" || sub === "cancel" || sub === "no-show") {
    const status = sub === "done" ? "completed" : sub === "cancel" ? "cancelled" : "no_show";
    const lesson = await markLessonStatus(interaction.options.getInteger("lesson_id", true), status);
    await interaction.reply({ content: `Lesson ${lesson.id} marked ${status}.`, ephemeral: true });
  }
}

async function handleScheduleCommand(interaction: ChatInputCommandInteraction) {
  await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead", "sales"]);
  const conflicts = await findScheduleConflicts();
  await interaction.reply({ content: conflicts.length ? conflicts.map((row) => `Lesson ${row.id} teacher ${row.teacher_id} ${row.scheduled_at}`).join("\n").slice(0, 1900) : "No conflicts found.", ephemeral: true });
}

async function handleMaterialCommand(interaction: ChatInputCommandInteraction) {
  const sub = interaction.options.getSubcommand();
  const course = await mustFindCourse(interaction.options.getString("course", true));
  const lessonNumber = interaction.options.getInteger("lesson", true);

  if (sub === "request") {
    const botUser = await getBotUserByDiscordId(interaction.user.id);
    const teacher = await getTeacherByDiscordId(interaction.user.id);
    const material = await requestMaterial({ teacherId: teacher?.id, botUserId: botUser?.id, courseId: course.id, lessonNumber });
    if (!material) {
      await interaction.reply({ content: "No material found for this course lesson yet.", ephemeral: true });
      return;
    }
    await interaction.reply({ content: `${material.title_en}\n${material.resource_url || material.attachment_url || "No URL attached."}`, ephemeral: true });
  } else if (sub === "add") {
    await requireBotRole(interaction.user.id, ["owner", "admin", "team_lead"]);
    const material = await addMaterial({
      courseId: course.id,
      lessonNumber,
      titleEn: interaction.options.getString("title", true),
      resourceUrl: interaction.options.getString("url", true),
    });
    await interaction.reply({ content: `Material saved with ID ${material.id}.`, ephemeral: true });
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
