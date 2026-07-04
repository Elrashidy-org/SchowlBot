import "dotenv/config";

function required(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new Error(`Missing required env var: ${name}`);
  }
  return value;
}

function optional(name: string, fallback = ""): string {
  return process.env[name] || fallback;
}

function list(name: string): string[] {
  return optional(name)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

export const config = {
  nodeEnv: optional("NODE_ENV", "development"),
  port: Number(optional("PORT", "3001")),
  publicApiBaseUrl: optional("PUBLIC_API_BASE_URL", "http://localhost:3001"),
  defaultTimezone: optional("DEFAULT_TIMEZONE", "Africa/Cairo"),
  corsAllowedOrigins: list("CORS_ALLOWED_ORIGINS"),
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  discordToken: optional("DISCORD_TOKEN"),
  discordClientId: optional("DISCORD_CLIENT_ID"),
  discordGuildId: optional("DISCORD_GUILD_ID"),
  discordLeadsChannelId: optional("DISCORD_LEADS_CHANNEL_ID"),
  discordOwnerIds: list("DISCORD_OWNER_IDS"),
  discordSalesRoleId: optional("DISCORD_SALES_ROLE_ID"),
  discordTeacherRoleId: optional("DISCORD_TEACHER_ROLE_ID"),
  turnstileSecretKey: optional("TURNSTILE_SECRET_KEY"),
  resendApiKey: optional("RESEND_API_KEY"),
  resendFromEmail: optional("RESEND_FROM_EMAIL", "Schowl <noreply@schowl.com>"),
  emailLogoUrl: optional("EMAIL_LOGO_URL", "https://www.schowl.com/brand/logo-dark.png"),
  // Per-course link pattern, e.g. "https://www.schowl.com/courses/{slug}".
  // Leave blank until the site has per-course pages; a single CTA is used meanwhile.
  emailCourseUrlTemplate: optional("EMAIL_COURSE_URL_TEMPLATE"),
  adminNotifyEmail: optional("ADMIN_NOTIFY_EMAIL"),
  leadSlaHours: Number(optional("LEAD_SLA_HOURS", "2")),
  autoAssignLeads: optional("AUTO_ASSIGN_LEADS", "true") !== "false",
  googleClientId: optional("GOOGLE_CLIENT_ID"),
  googleClientSecret: optional("GOOGLE_CLIENT_SECRET"),
  googleRefreshToken: optional("GOOGLE_REFRESH_TOKEN"),
  googleCalendarId: optional("GOOGLE_CALENDAR_ID", "primary"),
};

export function isProduction() {
  return config.nodeEnv === "production";
}
