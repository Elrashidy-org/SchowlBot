import crypto from "node:crypto";
import { config } from "../config.js";

// Signed, tamper-proof unsubscribe tokens so only a real Schowl email link works.
const SECRET = process.env.UNSUBSCRIBE_SECRET || config.supabaseServiceRoleKey;

export function unsubscribeToken(email: string) {
  return crypto
    .createHmac("sha256", SECRET)
    .update(email.trim().toLowerCase())
    .digest("hex")
    .slice(0, 32);
}

export function verifyUnsubscribeToken(email: string, token: string) {
  const expected = unsubscribeToken(email);
  // constant-time compare
  return (
    token.length === expected.length &&
    crypto.timingSafeEqual(Buffer.from(token), Buffer.from(expected))
  );
}

export function unsubscribeUrl(email: string) {
  const base = config.publicApiBaseUrl.replace(/\/$/, "");
  return `${base}/unsubscribe?e=${encodeURIComponent(email)}&t=${unsubscribeToken(email)}`;
}
