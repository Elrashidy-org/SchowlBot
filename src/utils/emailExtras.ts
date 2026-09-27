import { config } from "../config.js";
import { buildWhatsAppLink } from "./template.js";

// A "message us on WhatsApp" line for emails, or "" when no support number is set.
export function supportWhatsappLine(language?: string | null) {
  if (!config.supportWhatsapp) return "";
  const link = buildWhatsAppLink(config.supportWhatsapp, language === "ar" ? "مرحباً Schowl!" : "Hi Schowl!");
  return language === "ar"
    ? `\n\nتواصل معنا على واتساب: ${link}`
    : `\n\nMessage us on WhatsApp: ${link}`;
}

// "Add to Google Calendar" link for the confirmation email's secondary button.
export function buildGoogleCalendarUrl(input: { summary: string; startsAt: string; endsAt: string; details?: string }) {
  const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const params = new URLSearchParams({
    action: "TEMPLATE",
    text: input.summary,
    dates: `${dt(input.startsAt)}/${dt(input.endsAt)}`,
  });
  if (input.details) params.set("details", input.details);
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

// Minimal iCalendar VEVENT for a trial (times in UTC). Returns .ics text.
export function buildIcs(input: {
  uid: string;
  summary: string;
  startsAt: string;
  endsAt: string;
  description?: string;
  url?: string;
}) {
  const dt = (iso: string) => new Date(iso).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  const esc = (s: string) => s.replace(/([,;\\])/g, "\\$1").replace(/\n/g, "\\n");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Schowl//Trial//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${input.uid}`,
    `DTSTAMP:${dt(new Date().toISOString())}`,
    `DTSTART:${dt(input.startsAt)}`,
    `DTEND:${dt(input.endsAt)}`,
    `SUMMARY:${esc(input.summary)}`,
    input.description ? `DESCRIPTION:${esc(input.description)}` : "",
    input.url ? `URL:${esc(input.url)}` : "",
    "END:VEVENT",
    "END:VCALENDAR",
  ]
    .filter(Boolean)
    .join("\r\n");
}
