import { config } from "../config.js";
import { AppError } from "../utils/errors.js";

interface TurnstileResponse {
  success: boolean;
  "error-codes"?: string[];
}

export async function verifyTurnstile(token?: string, remoteIp?: string) {
  if (!config.turnstileSecretKey) {
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
}
