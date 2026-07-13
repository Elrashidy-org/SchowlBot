import cors from "cors";
import express from "express";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { ZodError } from "zod";
import { config, isProduction } from "../config.js";
import { assertSupabaseHealthy } from "../db/supabase.js";
import {
  notifyCampRegistration,
  notifyLeadCreated,
  notifyTeacherTrialAssigned,
  notifyTrialBooked,
} from "../bot/discordService.js";
import { AppError, ValidationError } from "../utils/errors.js";
import { createLead } from "../services/leadService.js";
import { bookingTrialSchema, campRegisterSchema, mapLegacyLeadPayload } from "../services/leadSchemas.js";
import { isMeetConfigured } from "../services/meetService.js";
import { supabase } from "../db/supabase.js";
import { verifyUnsubscribeToken } from "../utils/unsubscribe.js";
import { listCourses, findCourseByNameOrId, courseLabel } from "../services/courseService.js";
import { getAvailableSlots } from "../services/bookingService.js";
import { scheduleTrial } from "../services/scheduleService.js";
import { registerCamp } from "../services/campService.js";
import { sendTemplatedEmail } from "../services/emailService.js";
import { verifyTurnstile } from "../services/turnstileService.js";

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

  // ---- Booking (own scheduling; replaces Calendly) ----

  app.get("/booking/courses", async (_req, res, next) => {
    try {
      const courses = await listCourses();
      res.json(courses.map((c) => ({ id: c.id, name_en: c.name_en, name_ar: c.name_ar })));
    } catch (error) {
      next(error);
    }
  });

  app.get("/booking/slots", async (req, res, next) => {
    try {
      const course = await findCourseByNameOrId(String(req.query.course || ""));
      if (!course) {
        res.status(400).json({ message: "Unknown course" });
        return;
      }
      const days = Math.min(30, Math.max(1, Number(req.query.days) || 14));
      const slots = await getAvailableSlots(course.id, days);
      res.json({ course_id: course.id, slots });
    } catch (error) {
      next(error);
    }
  });

  app.post("/booking/trial", leadLimiter, async (req, res, next) => {
    try {
      const payload = bookingTrialSchema.parse(req.body);
      await verifyTurnstile(payload.turnstile_token, req.ip);
      const course = await findCourseByNameOrId(payload.course);
      if (!course) throw new ValidationError({ course: "Unknown course" });
      if (Number.isNaN(new Date(payload.starts_at).getTime())) {
        throw new ValidationError({ starts_at: "Invalid start time" });
      }

      const { lead } = await createLead(
        { ...payload, course_interest: course.name_en || payload.course },
        req.ip,
        { skipTurnstile: true },
      );
      await notifyLeadCreated(lead);

      try {
        const lesson = await scheduleTrial({
          leadId: lead.id,
          courseId: course.id,
          startsAt: new Date(payload.starts_at).toISOString(),
        });
        await notifyTeacherTrialAssigned({
          teacherId: lesson.teacher_id,
          courseLabel: courseLabel(course),
          startsAt: lesson.scheduled_at,
          meetingUrl: lesson.meeting_url,
          leadId: lesson.lead_id,
          lessonId: lesson.id,
        });
        await notifyTrialBooked({
          childName: lead.child_name,
          courseLabel: courseLabel(course),
          startsAt: lesson.scheduled_at,
          meetingUrl: lesson.meeting_url,
          lessonId: lesson.id,
        });
        res.status(201).json({
          status: "booked",
          lead_id: lead.id,
          lesson_id: lesson.id,
          scheduled_at: lesson.scheduled_at,
          meeting_url: lesson.meeting_url,
        });
      } catch {
        // That slot just filled (or no teacher free): the lead is saved for follow-up.
        res.status(409).json({
          status: "lead_saved",
          lead_id: lead.id,
          message: "That time just filled up — our team will contact you to confirm a slot.",
        });
      }
    } catch (error) {
      next(error);
    }
  });

  // ---- Camp registration (separate intake) ----

  app.post("/camp/register", leadLimiter, async (req, res, next) => {
    try {
      const payload = campRegisterSchema.parse(req.body);
      await verifyTurnstile(payload.turnstile_token, req.ip);
      const reg = await registerCamp(payload);

      if (reg.email) {
        await sendTemplatedEmail({
          to: reg.email,
          templateKey: "camp_registered",
          language: reg.language,
          context: { parent_name: reg.parent_name || "", child_name: reg.child_name, camp: reg.camp },
        });
      }
      await notifyCampRegistration({
        camp: reg.camp,
        childName: reg.child_name,
        parentName: reg.parent_name,
        childAge: reg.child_age,
        email: reg.email,
        phone: reg.phone_e164,
      });
      res.status(201).json({ status: "registered", id: reg.id });
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
