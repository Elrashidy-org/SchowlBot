import { config, isProduction } from "../config.js";
import { AppError } from "../utils/errors.js";

interface TurnstileResponse {
  success: boolean;
  hostname?: string;
  "error-codes"?: string[];
}

// Hostnames allowed to have solved the challenge, derived from the CORS allowlist.
function allowedHostnames(): string[] {
  return config.corsAllowedOrigins
    .map((origin) => {
      try {
        return new URL(origin).hostname;
      } catch {
        return "";
      }
    })
    .filter(Boolean);
}

export async function verifyTurnstile(token?: string, remoteIp?: string) {
  if (!config.turnstileSecretKey) {
    // Fail closed in production: never accept a public lead without bot protection.
    if (isProduction()) {
      throw new AppError("Bot protection is not configured", 503);
    }
    return;
  }

  if (!token) {
    throw new AppError("Turnstile token is required", 400);
  }

  const form = new URLSearchParams();
  form.set("secret", config.turnstileSecretKey);
  form.set("response", token);
  if (remoteIp) {
    form.set("remoteip", remoteIp);
  }

  const response = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
    method: "POST",
    body: form,
  });

  const result = (await response.json()) as TurnstileResponse;
  if (!result.success) {
    throw new AppError("Security verification failed", 400, result["error-codes"]);
  }

  // Confirm the token was solved on one of our own domains, not a page that
  // scraped our sitekey. (Skipped when the response omits a hostname, e.g. test keys.)
  const allowed = allowedHostnames();
  if (allowed.length > 0 && result.hostname && !allowed.includes(result.hostname)) {
    throw new AppError("Security verification failed", 403);
  }
}
