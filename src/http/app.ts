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
  notifySystemAlert,
  notifyTeacherTrialAssigned,
  notifyTrialBooked,
} from "../bot/discordService.js";
import { AppError, ValidationError } from "../utils/errors.js";
import { createLead } from "../services/leadService.js";
import { bookingTrialSchema, campRegisterSchema, leadStartSchema, mapLegacyLeadPayload } from "../services/leadSchemas.js";
import { markBookingSessionBooked, upsertBookingSession } from "../services/bookingSessionService.js";
import { isMeetConfigured } from "../services/meetService.js";
import { supabase } from "../db/supabase.js";
import { verifyUnsubscribeToken } from "../utils/unsubscribe.js";
import { listCourses, findCourseByNameOrId, courseLabel } from "../services/courseService.js";
import { getAvailableSlots } from "../services/bookingService.js";
import { listPackagePlans } from "../services/packagePlanService.js";
import { scheduleTrial } from "../services/scheduleService.js";
import { getCampBySlug, listPublicCamps, registerCamp } from "../services/campService.js";
import { sendTemplatedEmail } from "../services/emailService.js";
import { verifyTurnstile } from "../services/turnstileService.js";
import { isMetaCapiConfigured, sendMetaEvent } from "../services/metaService.js";

export function createHttpApp() {
  const app = express();

  app.set("trust proxy", 1);
  app.use(helmet());
  app.use(express.json({ limit: "1mb" }));
  // Allowlist entries match exactly, or as a wildcard where `*` stands for one
  // subdomain label — e.g. "https://*.vercel.app" allows the site's preview URLs.
  const originAllowed = (origin: string) =>
    config.corsAllowedOrigins.some((entry) => {
      if (entry === origin) return true;
      if (!entry.includes("*")) return false;
      const pattern = "^" + entry.replace(/[.]/g, "\\.").replace(/\*/g, "[^.]+") + "$";
      try {
        return new RegExp(pattern).test(origin);
      } catch {
        return false;
      }
    });

  app.use(
    cors({
      origin(origin, callback) {
        if (!origin || originAllowed(origin)) {
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

  // Partial bookings are called repeatedly as the parent fills the form, so a
  // looser limit than the final submit.
  const leadStartLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 10,
    standardHeaders: true,
    legacyHeaders: false,
    message: { message: "Too many requests. Please try again later." },
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
        meta_capi_configured: isMetaCapiConfigured(),
        cors_allowed_origins: config.corsAllowedOrigins,
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

  // Public price book for the website's pricing section.
  app.get("/packages", async (_req, res, next) => {
    try {
      const plans = await listPackagePlans(true);
      res.json(
        plans.map((p) => {
          const price = Number(p.list_price);
          return {
            id: p.id,
            key: p.key,
            class_type: p.class_type,
            name: p.name,
            name_en: p.name_en,
            name_ar: p.name_ar,
            description: p.notes,
            description_en: p.description_en,
            description_ar: p.description_ar,
            lessons: p.lessons,
            price,
            compare_at_price: p.compare_at_price != null ? Number(p.compare_at_price) : null,
            currency: p.currency,
            per_session_price: Math.round((price / p.lessons) * 100) / 100,
            features_en: p.features_en ?? [],
            features_ar: p.features_ar ?? [],
            is_popular: p.is_popular,
            is_best_value: p.is_best_value,
            sort_order: p.sort_order,
            course_id: p.course_id,
            valid_days: p.valid_days,
            session_minutes: p.session_minutes,
          };
        }),
      );
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

  // Partial / abandoned booking capture. Public, looser limit, NO Turnstile
  // (the single-use token is reserved for the final /booking/trial submit).
  app.post("/booking/lead-start", leadStartLimiter, async (req, res, next) => {
    try {
      const payload = leadStartSchema.parse(req.body);
      const course = payload.course ? await findCourseByNameOrId(payload.course) : null;
      const session = await upsertBookingSession(payload, course?.id ?? null);
      res.status(201).json({ lead_id: session.id });
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

      const startsAtIso = new Date(payload.starts_at).toISOString();
      const { lead } = await createLead(
        { ...payload, course_interest: course.name_en || payload.course },
        req.ip,
        { skipTurnstile: true },
      );
      await notifyLeadCreated(lead);

      // Book the trial without gating on teacher availability — the team staffs a
      // teacher afterwards. If the lesson can't be created, the lead is still saved.
      let lesson: Awaited<ReturnType<typeof scheduleTrial>> | null = null;
      try {
        lesson = await scheduleTrial({
          leadId: lead.id,
          courseId: course.id,
          startsAt: startsAtIso,
          autoAssign: false,
          allowUnassigned: true,
        });
      } catch (error) {
        console.error("scheduleTrial failed for a public booking", error);
      }

      // Notifications are best-effort — they must never fail the booking.
      try {
        if (lesson?.teacher_id) {
          await notifyTeacherTrialAssigned({
            teacherId: lesson.teacher_id,
            courseLabel: courseLabel(course),
            startsAt: lesson.scheduled_at,
            meetingUrl: lesson.meeting_url,
            leadId: lesson.lead_id,
            lessonId: lesson.id,
          });
        }
        await notifyTrialBooked({
          childName: lead.child_name,
          courseLabel: courseLabel(course),
          startsAt: lesson?.scheduled_at ?? startsAtIso,
          meetingUrl: lesson?.meeting_url ?? null,
          lessonId: lesson?.id ?? null,
          needsTeacher: !lesson?.teacher_id,
        });
        if (!lesson?.teacher_id) {
          await notifySystemAlert(
            `Trial needs a teacher: ${lead.child_name} — ${courseLabel(course)} @ ${startsAtIso}${lesson ? ` (lesson ${lesson.id})` : ""}. Assign with /trial reschedule.`,
          );
        }
      } catch (error) {
        console.error("Trial notifications failed", error);
      }

      // Convert the partial booking (if any) so it isn't nudged as abandoned.
      if (payload.session_id || payload.lead_id) {
        try {
          await markBookingSessionBooked({ sessionId: payload.session_id, id: payload.lead_id }, lead.id);
        } catch (error) {
          console.error("Marking booking_session booked failed", error);
        }
      }

      if (payload.consent_marketing) {
        const trialSource = payload.landing_page || req.get("referer") || undefined;
        const trackBase = {
          eventId: payload.event_id,
          email: lead.email,
          phone: lead.phone_e164,
          fullName: lead.parent_name,
          externalId: lead.id,
          country: lead.country_iso,
          fbp: payload.fbp,
          fbc: payload.fbc,
          clientIp: req.ip,
          userAgent: req.get("user-agent"),
          sourceUrl: trialSource,
        };
        void sendMetaEvent({ eventName: "Lead", ...trackBase });
        void sendMetaEvent({ eventName: "Schedule", ...trackBase });
      }

      res.status(201).json({
        status: "booked",
        lead_id: lead.id,
        lesson_id: lesson?.id ?? null,
        scheduled_at: lesson?.scheduled_at ?? startsAtIso,
        meeting_url: lesson?.meeting_url ?? null,
      });
    } catch (error) {
      next(error);
    }
  });

  // ---- Camps (public catalog + registration) ----

  app.get("/camps", async (_req, res, next) => {
    try {
      res.json(await listPublicCamps());
    } catch (error) {
      next(error);
    }
  });

  app.get("/camps/:slug", async (req, res, next) => {
    try {
      const camp = await getCampBySlug(String(req.params.slug));
      if (!camp) {
        res.status(404).json({ message: "Camp not found" });
        return;
      }
      res.json(camp);
    } catch (error) {
      next(error);
    }
  });

  app.post("/camp/register", leadLimiter, async (req, res, next) => {
    try {
      const payload = campRegisterSchema.parse(req.body);
      await verifyTurnstile(payload.turnstile_token, req.ip);
      const camp = await getCampBySlug(payload.camp || "summer");
      if (!camp) {
        throw new ValidationError({ camp: "Unknown camp." });
      }
      if (camp.status === "closed") {
        throw new ValidationError({ camp: "Registration for this camp is closed." });
      }
      const reg = await registerCamp({ ...payload, camp: camp.slug });

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
      if (payload.consent_marketing) {
        void sendMetaEvent({
          eventName: "CompleteRegistration",
          eventId: payload.event_id,
          email: reg.email,
          phone: reg.phone_e164,
          fullName: reg.parent_name,
          externalId: reg.id,
          country: reg.country_iso,
          fbp: payload.fbp,
          fbc: payload.fbc,
          clientIp: req.ip,
          userAgent: req.get("user-agent"),
          sourceUrl: req.get("referer") || undefined,
        });
      }

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
      const t = (req.body ?? {}) as {
        event_id?: string;
        fbp?: string;
        fbc?: string;
        landing_page?: string;
        consent_marketing?: boolean;
      };
      if (t.consent_marketing) {
        void sendMetaEvent({
          eventName: "Lead",
          eventId: t.event_id,
          email: result.lead.email,
          phone: result.lead.phone_e164,
          fullName: result.lead.parent_name,
          externalId: result.lead.id,
          country: result.lead.country_iso,
          fbp: t.fbp,
          fbc: t.fbc,
          clientIp: req.ip,
          userAgent: req.get("user-agent"),
          sourceUrl: t.landing_page || req.get("referer") || undefined,
        });
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
