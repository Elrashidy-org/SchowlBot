import {
  PermissionFlagsBits,
  SlashCommandBuilder,
} from "discord.js";

export const slashCommands = [
  new SlashCommandBuilder()
    .setName("init")
    .setDescription("Initialize your SchowlBot profile")
    .addSubcommand((sub) =>
      sub.setName("teacher").setDescription("Start teacher onboarding"),
    ),

  new SlashCommandBuilder()
    .setName("lead")
    .setDescription("Manage leads")
    .addSubcommand((sub) =>
      sub
        .setName("view")
        .setDescription("View a lead")
        .addStringOption((opt) =>
          opt.setName("lead_id").setDescription("Lead ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("search")
        .setDescription("Search leads")
        .addStringOption((opt) =>
          opt.setName("query").setDescription("Name or phone").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("status")
        .setDescription("Change lead status")
        .addStringOption((opt) =>
          opt.setName("lead_id").setDescription("Lead ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt
            .setName("status")
            .setDescription("New status")
            .setRequired(true)
            .addChoices(
              { name: "contacted", value: "contacted" },
              { name: "trial_booked", value: "trial_booked" },
              { name: "trial_done", value: "trial_done" },
              { name: "converted", value: "converted" },
              { name: "not_fit", value: "not_fit" },
              { name: "lost", value: "lost" },
            ),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("note")
        .setDescription("Add a note to a lead")
        .addStringOption((opt) =>
          opt.setName("lead_id").setDescription("Lead ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("note").setDescription("Note").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("due").setDescription("Show due follow-ups"),
    ),

  new SlashCommandBuilder()
    .setName("teacher")
    .setDescription("Manage teachers")
    .addSubcommand((sub) =>
      sub
        .setName("approve")
        .setDescription("Approve pending teacher")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Discord user").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("reject")
        .setDescription("Reject pending teacher")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Discord user").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Reason").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("activate")
        .setDescription("Activate teacher")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Discord user").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("deactivate")
        .setDescription("Deactivate teacher")
        .addUserOption((opt) =>
          opt.setName("user").setDescription("Discord user").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("profile")
        .setDescription("View teacher profile")
        .addStringOption((opt) =>
          opt.setName("teacher").setDescription("Mention or teacher ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("load").setDescription("Show teacher load"),
    )
    .addSubcommandGroup((group) =>
      group
        .setName("responsibility")
        .setDescription("Manage teacher course responsibility")
        .addSubcommand((sub) =>
          sub
            .setName("add")
            .setDescription("Allow teacher to teach a course")
            .addStringOption((opt) =>
              opt.setName("teacher").setDescription("Mention or teacher ID").setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName("course").setDescription("Course name or ID").setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("remove")
            .setDescription("Disable teacher course responsibility")
            .addStringOption((opt) =>
              opt.setName("teacher").setDescription("Mention or teacher ID").setRequired(true),
            )
            .addStringOption((opt) =>
              opt.setName("course").setDescription("Course name or ID").setRequired(true),
            ),
        )
        .addSubcommand((sub) =>
          sub
            .setName("list")
            .setDescription("List teacher responsibilities")
            .addStringOption((opt) =>
              opt.setName("teacher").setDescription("Mention or teacher ID").setRequired(true),
            ),
        ),
    ),

  new SlashCommandBuilder()
    .setName("availability")
    .setDescription("Manage your teaching availability")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add weekly availability")
        .addIntegerOption((opt) =>
          opt
            .setName("day")
            .setDescription("0 Sunday, 1 Monday, ... 6 Saturday")
            .setRequired(true)
            .setMinValue(0)
            .setMaxValue(6),
        )
        .addStringOption((opt) =>
          opt.setName("start").setDescription("HH:MM, 24h").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("end").setDescription("HH:MM, 24h").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List your availability"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove availability by ID")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("Availability ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("clear").setDescription("Clear your availability"),
    ),

  new SlashCommandBuilder()
    .setName("timeoff")
    .setDescription("Manage teacher time off")
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add time off")
        .addStringOption((opt) =>
          opt.setName("start").setDescription("ISO date/time").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("end").setDescription("ISO date/time").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("reason").setDescription("Reason").setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub.setName("list").setDescription("List your upcoming time off"),
    )
    .addSubcommand((sub) =>
      sub
        .setName("remove")
        .setDescription("Remove time off by ID")
        .addIntegerOption((opt) =>
          opt.setName("id").setDescription("Time off ID").setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("trial")
    .setDescription("Manage trial lessons")
    .addSubcommand((sub) =>
      sub
        .setName("suggest")
        .setDescription("Suggest teacher for a trial")
        .addStringOption((opt) =>
          opt.setName("course").setDescription("Course name or ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("starts_at").setDescription("ISO date/time").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("schedule")
        .setDescription("Schedule a trial")
        .addStringOption((opt) =>
          opt.setName("lead_id").setDescription("Lead ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("course").setDescription("Course name or ID").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("starts_at").setDescription("ISO date/time").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("teacher").setDescription("Optional teacher mention or ID").setRequired(false),
        )
        .addStringOption((opt) =>
          opt.setName("meeting_url").setDescription("Meeting link").setRequired(false),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("done")
        .setDescription("Mark trial as done")
        .addIntegerOption((opt) =>
          opt.setName("lesson_id").setDescription("Lesson ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("cancel")
        .setDescription("Cancel trial")
        .addIntegerOption((opt) =>
          opt.setName("lesson_id").setDescription("Lesson ID").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("no-show")
        .setDescription("Mark trial as no-show")
        .addIntegerOption((opt) =>
          opt.setName("lesson_id").setDescription("Lesson ID").setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("schedule")
    .setDescription("Schedule tools")
    .addSubcommand((sub) =>
      sub.setName("conflicts").setDescription("Find schedule conflicts"),
    ),

  new SlashCommandBuilder()
    .setName("material")
    .setDescription("Manage course material")
    .addSubcommand((sub) =>
      sub
        .setName("request")
        .setDescription("Request material for a course lesson")
        .addStringOption((opt) =>
          opt.setName("course").setDescription("Course name or ID").setRequired(true),
        )
        .addIntegerOption((opt) =>
          opt.setName("lesson").setDescription("Lesson number").setRequired(true),
        ),
    )
    .addSubcommand((sub) =>
      sub
        .setName("add")
        .setDescription("Add or update material")
        .addStringOption((opt) =>
          opt.setName("course").setDescription("Course name or ID").setRequired(true),
        )
        .addIntegerOption((opt) =>
          opt.setName("lesson").setDescription("Lesson number").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("title").setDescription("Title").setRequired(true),
        )
        .addStringOption((opt) =>
          opt.setName("url").setDescription("Resource URL").setRequired(true),
        ),
    ),

  new SlashCommandBuilder()
    .setName("system")
    .setDescription("System commands")
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .addSubcommand((sub) =>
      sub.setName("health").setDescription("Check service health"),
    ),
].map((command) => command.toJSON());
