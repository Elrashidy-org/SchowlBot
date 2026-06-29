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
      });
    } catch (error) {
      next(error);
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
