import { createHash } from "node:crypto";
import { config } from "../config.js";

export function isMetaCapiConfigured() {
  return Boolean(config.metaPixelId && config.metaCapiToken);
}

function sha256(value?: string | null) {
  if (!value) return undefined;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return undefined;
  return createHash("sha256").update(normalized).digest("hex");
}

// Digits only for phone (Meta expects E.164 without symbols, hashed).
function hashPhone(value?: string | null) {
  if (!value) return undefined;
  const digits = value.replace(/[^0-9]/g, "");
  if (!digits) return undefined;
  return createHash("sha256").update(digits).digest("hex");
}

// Send one server-side Conversions API event. Fire-and-forget: never throws, so
// a Meta failure can't affect the request that triggered it. No-op when unset.
export async function sendMetaEvent(input: {
  eventName: "Lead" | "Schedule" | "CompleteRegistration";
  eventId?: string | null;
  email?: string | null;
  phone?: string | null;
  firstName?: string | null;
  country?: string | null;
  fbp?: string | null;
  fbc?: string | null;
  clientIp?: string | null;
  userAgent?: string | null;
  sourceUrl?: string | null;
  value?: number | null;
  currency?: string | null;
}) {
  if (!isMetaCapiConfigured()) return;
  if (!input.eventId) {
    // Without a shared event_id, the browser Pixel event can't be de-duplicated.
    console.warn(`Meta CAPI ${input.eventName} sent without event_id`);
  }

  const userData: Record<string, unknown> = {};
  const em = sha256(input.email);
  const ph = hashPhone(input.phone);
  const fn = sha256(input.firstName);
  const country = sha256(input.country);
  if (em) userData.em = [em];
  if (ph) userData.ph = [ph];
  if (fn) userData.fn = [fn];
  if (country) userData.country = [country];
  if (input.fbp) userData.fbp = input.fbp;
  if (input.fbc) userData.fbc = input.fbc;
  if (input.clientIp) userData.client_ip_address = input.clientIp;
  if (input.userAgent) userData.client_user_agent = input.userAgent;

  const body = {
    data: [
      {
        event_name: input.eventName,
        event_time: Math.floor(Date.now() / 1000),
        event_id: input.eventId || undefined,
        action_source: "website",
        event_source_url: input.sourceUrl || undefined,
        user_data: userData,
        custom_data:
          input.value != null ? { value: input.value, currency: input.currency || "EGP" } : undefined,
      },
    ],
  };

  try {
    const url = `https://graph.facebook.com/${config.metaApiVersion}/${config.metaPixelId}/events?access_token=${encodeURIComponent(
      config.metaCapiToken,
    )}`;
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.error(`Meta CAPI ${input.eventName} failed: ${res.status} ${await res.text()}`);
    }
  } catch (error) {
    console.error(`Meta CAPI ${input.eventName} error`, error);
  }
}
