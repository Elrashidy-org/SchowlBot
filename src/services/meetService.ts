import crypto from "node:crypto";
import { google } from "googleapis";
import { config } from "../config.js";

export function isMeetConfigured() {
  return Boolean(config.googleClientId && config.googleClientSecret && config.googleRefreshToken);
}

function getCalendarClient() {
  if (!isMeetConfigured()) return null;
  const auth = new google.auth.OAuth2(config.googleClientId, config.googleClientSecret);
  auth.setCredentials({ refresh_token: config.googleRefreshToken });
  return google.calendar({ version: "v3", auth });
}

// Create a Google Calendar event with an attached Meet link and return the link.
// Returns null if Google isn't configured (the caller falls back gracefully).
export async function createMeetEvent(input: {
  summary: string;
  description?: string;
  startsAt: string;
  endsAt: string;
  timezone?: string;
  attendees?: string[];
}): Promise<string | null> {
  const calendar = getCalendarClient();
  if (!calendar) return null;

  const res = await calendar.events.insert({
    calendarId: config.googleCalendarId || "primary",
    conferenceDataVersion: 1,
    // Notify attendees so the event lands in their own calendars.
    sendUpdates: "all",
    requestBody: {
      summary: input.summary,
      description: input.description,
      start: { dateTime: input.startsAt, timeZone: input.timezone || config.defaultTimezone },
      end: { dateTime: input.endsAt, timeZone: input.timezone || config.defaultTimezone },
      attendees: input.attendees?.filter(Boolean).map((email) => ({ email })),
      conferenceData: {
        createRequest: {
          requestId: crypto.randomUUID(),
          conferenceSolutionKey: { type: "hangoutsMeet" },
        },
      },
    },
  });

  const fromEntry = res.data.conferenceData?.entryPoints?.find(
    (e) => e.entryPointType === "video",
  )?.uri;
  return res.data.hangoutLink || fromEntry || null;
}
