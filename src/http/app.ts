import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { config, isProduction } from "../config.js";
import { assertSupabaseHealthy } from "../db/supabase.js";
import { notifyLeadCreated } from "../bot/discordService.js";
import { AppError, ValidationError } from "../utils/errors.js";
import { createLead } from "../services/leadService.js";
import { mapLegacyLeadPayload } from "../services/leadSchemas.js";
import { isMeetConfigured } from "../services/meetService.js";
import { supabase } from "../db/supabase.js";
import { verifyUnsubscribeToken } from "../utils/unsubscribe.js";

export function createHttpApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || config.corsAllowedOrigins.includes(origin)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Origin not allowed: ${origin}`));
      },
    }),
  );

  const leadLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many submissions. Please try again later." },
  });

  app.get("/health", async (_req, res, next) => {
    try {
      await assertSupabaseHealthy();
      res.json({
        status: "healthy",
        discord_configured: Boolean(config.discordToken),
        resend_configured: Boolean(config.resendApiKey),
        turnstile_configured: Boolean(config.turnstileSecretKey),
        google_meet_configured: isMeetConfigured(),
      });
    } catch (error) {
      next(error);
    }
  });

  app.get("/unsubscribe", async (req, res) => {
    const email = String(req.query.e || "").trim();
    const token = String(req.query.t || "");
    const page = (title: string, msg: string) =>
      `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:system-ui,Arial;background:#EEF2F7;text-align:center;padding:48px 16px;"><div style="max-width:440px;margin:0 auto;background:#fff;border-radius:14px;padding:32px;"><h2 style="color:#0C4160;">${title}</h2><p style="color:#5B6478;">${msg}</p></div></body></html>`;
    if (!email || !verifyUnsubscribeToken(email, token)) {
      res.status(400).send(page("Invalid link", "This unsubscribe link is invalid or expired."));
      return;
    }
    try {
      await supabase
        .from("email_unsubscribe")
        .upsert({ email: email.toLowerCase() }, { onConflict: "email" });
      res.send(page("You're unsubscribed", "You won't receive any more emails from Schowl. You can reply to any past email if you change your mind."));
    } catch {
      res.status(500).send(page("Something went wrong", "Please try again later."));
    }
  });

  app.post("/client/leads/", leadLimiter, async (req, res, next) => {
    try {
      const result = await createLead(req.body, req.ip);
      if (!result.duplicate) {
        await notifyLeadCreated(result.lead);
      }
      res.status(201).json({
        lead_id: result.lead.id,
        status: "received",
        duplicate: result.duplicate,
      });
    } catch (error) {
      next(error);
    }
  });

  app.post("/client/submit-form/", leadLimiter, async (req, res, next) => {
    try {
      const payload = mapLegacyLeadPayload(req.body);
      const result = await createLead(payload, req.ip);
      if (!result.duplicate) {
        await notifyLeadCreated(result.lead);
      }
      res.status(201).json({
        lead_id: result.lead.id,
        status: "received",
        duplicate: result.duplicate,
      });
    } catch (error) {
      next(error);
    }
  });

  app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (error instanceof ValidationError) {
      res.status(400).json({ errors: error.errors });
      return;
    }
    if (error instanceof ZodError) {
      res.status(400).json({
        errors: Object.fromEntries(
          error.issues.map((issue) => [String(issue.path[0] || "form"), issue.message]),
        ),
      });
      return;
    }
    if (error instanceof AppError) {
      res.status(error.statusCode).json({
        message: error.statusCode >= 500 ? "Something went wrong" : error.message,
      });
      return;
    }

    console.error(error);
    res.status(500).json({
      message: "Something went wrong",
      detail: isProduction() ? undefined : error instanceof Error ? error.message : String(error),
    });
  });

  return app;
}
