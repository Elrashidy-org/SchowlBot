import { BotRole } from "../types.js";

export interface CommandHelp {
  usage: string;
  description: string;
  // Roles allowed to use it, or "everyone" for ungated commands.
  roles: BotRole[] | "everyone";
  // Extra qualifier shown to the user (e.g. an approval requirement).
  note?: string;
}

// Single source of truth for `/help`. Keep the `roles` here in sync with the
// requireBotRole(...) checks in discordService.ts.
export const COMMAND_CATALOG: CommandHelp[] = [
  {
    usage: "/help",
    description: "List the commands you can use.",
    roles: "everyone",
  },
  {
    usage: "/whoami",
    description: "Show your SchowlBot roles and profile.",
    roles: "everyone",
  },
  {
    usage: "/init teacher",
    description: "Apply as a teacher (opens an onboarding form).",
    roles: "everyone",
  },
  {
    usage: "/teacher mine",
    description: "View the courses you are assigned to teach.",
    roles: ["teacher"],
    note: "Requires an approved teacher profile.",
  },
  {
    usage: "/material request|list <course>",
    description: "Get or list teaching material for a course.",
    roles: ["owner", "admin", "team_lead", "teacher"],
    note: "Teachers can only access material for courses they are assigned to teach.",
  },
  {
    usage: "/schedule mine",
    description: "See your upcoming lessons with meeting links.",
    roles: ["teacher"],
    note: "Requires an approved teacher profile.",
  },
  {
    usage: "/availability add|list|remove|clear",
    description: "Manage your weekly teaching availability.",
    roles: ["teacher"],
    note: "Requires an approved teacher profile.",
  },
  {
    usage: "/timeoff add|list|remove",
    description: "Manage your time off.",
    roles: ["teacher"],
    note: "Requires an approved teacher profile.",
  },
  {
    usage: "/lead new|view|search|status|note|due|assign|mine|history|export|forget",
    description: "Add, view, search, assign, follow up, export, and anonymize leads.",
    roles: ["owner", "admin", "team_lead", "sales"],
    note: "forget (anonymize) is owner/admin only.",
  },
  {
    usage: "/stats",
    description: "Quick overview of leads and upcoming trials.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/funnel",
    description: "Lead conversion funnel with stage percentages.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/digest",
    description: "Today's activity summary (new leads, conversions, trials, due).",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/summary",
    description: "Weekly summary with teacher fill rate and upcoming renewals.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/trial suggest|schedule|reschedule|done|cancel|no-show",
    description: "Suggest teachers and manage trial lessons.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/lesson schedule|list|cancel",
    description: "Schedule and manage recurring weekly paid lessons.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/lesson complete|noshow",
    description: "Mark your session attended with a recording URL + student rating (or no-show).",
    roles: ["teacher"],
    note: "The assigned teacher marks their own session; staff can mark any.",
  },
  {
    usage: "/student enroll|view|list|level|renew|cancel|renewals",
    description: "Enroll students, track level, and manage memberships & renewals.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/referral add|list|reward",
    description: "Track referrals; auto-qualifies when the referred lead converts.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/schedule teacher|conflicts",
    description: "View a teacher's week agenda or find overlapping lessons.",
    roles: ["owner", "admin", "team_lead", "sales"],
  },
  {
    usage: "/teacher approve|reject|activate|deactivate|profile|load|pending|payroll|responsibility",
    description: "Approve and manage teachers, course responsibilities, and payroll export.",
    roles: ["owner", "admin", "team_lead"],
  },
  {
    usage: "/material add|remove <course> <lesson> ...",
    description: "Add, update, or remove course material.",
    roles: ["owner", "admin", "team_lead"],
  },
  {
    usage: "/system health",
    description: "Check service health.",
    roles: ["owner", "admin", "team_lead"],
  },
  {
    usage: "/config channel set|info|list|unset",
    description: "Assign Discord channels to SchowlBot purposes (e.g. leads).",
    roles: ["owner", "admin"],
  },
  {
    usage: "/config role grant|revoke|list",
    description: "Manage staff access roles.",
    roles: ["owner"],
  },
];

export function commandsForRoles(roles: BotRole[]): CommandHelp[] {
  return COMMAND_CATALOG.filter(
    (entry) =>
      entry.roles === "everyone" || entry.roles.some((role) => roles.includes(role)),
  );
}
