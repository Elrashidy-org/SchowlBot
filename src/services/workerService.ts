import { supabase } from "../db/supabase.js";
import { config } from "../config.js";
import { ClientLead } from "../types.js";
import { sendLeadEmail } from "./emailService.js";
import {
  notifyAbandonedBooking,
  notifyLeadSlaBreached,
  notifyRenewalDue,
  notifySystemAlert,
  postDailyDigest,
  sendDirectMessage,
} from "../bot/discordService.js";
import { sendTemplatedEmail } from "./emailService.js";
import { buildIcs, supportWhatsappLine } from "../utils/emailExtras.js";
import { findCourseByNameOrId, courseLabel } from "./courseService.js";
import { listAbandonedBookingSessions, markBookingSessionAlerted } from "./bookingSessionService.js";
import {
  getStudentById,
  lessonsRemaining,
  listPackagesNeedingLowBalanceReminder,
  markLowBalanceReminded,
} from "./studentService.js";

// Post the daily digest once per day, after ~08:00 Cairo (≈06:00 UTC).
let lastDigestDate = "";
function maybePostDigest() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (lastDigestDate === day || now.getUTCHours() < 6) return;
  lastDigestDate = day;
  void postDailyDigest().catch((error) => console.error("Daily digest failed", error));
}

// Once per day, remind owners (and parents) when a package is running low.
let lastRenewalDate = "";
function maybeRunRenewals() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (lastRenewalDate === day || now.getUTCHours() < 6) return;
  lastRenewalDate = day;
  void runLowBalanceReminders().catch((error) => console.error("Low-balance reminders failed", error));
}

async function runLowBalanceReminders() {
  const due = await listPackagesNeedingLowBalanceReminder();
  for (const pkg of due) {
    const student = await getStudentById(pkg.student_id);
    if (!student) continue;
    const remaining = lessonsRemaining(pkg);
    await notifyRenewalDue({
      name: student.name,
      lessonsRemaining: remaining,
      price: pkg.price,
      currency: pkg.currency,
    });
    if (student.email) {
      await sendTemplatedEmail({
        to: student.email,
        templateKey: "lessons_running_low",
        language: "en",
        context: {
          parent_name: student.parent_name || "",
          child_name: student.name,
          lessons_remaining: remaining,
        },
        leadId: student.lead_id,
      });
    }
    await markLowBalanceReminded(pkg.id);
  }
}

// Nudge started-but-abandoned bookings: alert the team (WhatsApp link) and, if we
// have their email, send a "finish your booking" nudge. Guarded by alerted_at.
async function runAbandonedSweep() {
  const sessions = await listAbandonedBookingSessions(config.bookingAbandonMinutes);
  for (const s of sessions) {
    let label: string | null = null;
    if (s.course_id) {
      try {
        const course = await findCourseByNameOrId(s.course_id);
        label = course ? courseLabel(course) : null;
      } catch {
        // course lookup is best-effort
      }
    }
    await notifyAbandonedBooking({
      childName: s.child_name,
      parentName: s.parent_name,
      phoneE164: s.phone_e164,
      courseLabel: label,
      packageInterest: s.package_interest,
      sessionId: s.session_id,
    });
    if (s.email) {
      await sendTemplatedEmail({
        to: s.email,
        templateKey: "booking_abandoned",
        language: s.language,
        context: {
          parent_name: s.parent_name || "",
          child_name: s.child_name || "your child",
          whatsapp_line: supportWhatsappLine(s.language),
        },
      });
    }
    await markBookingSessionAlerted(s.id);
  }
}

let workerTimer: NodeJS.Timeout | null = null;

function safeTick() {
  void runAutomationTick().catch((error) => {
    console.error("Automation worker failed", error);
    void notifySystemAlert(
      `Automation worker tick failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

export function startAutomationWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(safeTick, 60_000);
  safeTick();
}

export function stopAutomationWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function runAutomationTick() {
  maybePostDigest();
  maybeRunRenewals();
  try {
    await runAbandonedSweep();
  } catch (error) {
    console.error("Abandoned booking sweep failed", error);
  }

  const { data: jobs, error } = await supabase
    .from("automation_job")
    .select("*")
    .eq("status", "pending")
    .lte("run_at", new Date().toISOString())
    .order("run_at", { ascending: true })
    .limit(10);

  if (error) throw error;
  for (const job of jobs || []) {
    await runJob(job);
  }
}

async function runJob(job: { id: number; job_type: string; lead_id: string | null; lesson_id?: number | null; payload: Record<string, unknown>; attempts: number }) {
  // Atomically claim the job: only the worker that flips it from pending->running
  // proceeds, so multiple instances can't double-process the same job.
  const { data: claimed, error: claimError } = await supabase
    .from("automation_job")
    .update({ status: "running", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", job.id)
    .eq("status", "pending")
    .select("id");
  if (claimError) throw claimError;
  if (!claimed || claimed.length === 0) return;

  try {
    if (job.payload?.sla === true && job.lead_id) {
      // Internal SLA nudge for an uncontacted lead.
      await notifyLeadSlaBreached(job.lead_id);
    } else if (
      typeof job.payload?.dm_discord_user_id === "string" &&
      typeof job.payload?.message === "string"
    ) {
      // Direct-message job (e.g. teacher trial reminder).
      await sendDirectMessage(job.payload.dm_discord_user_id, job.payload.message);
    } else if (job.lead_id && typeof job.payload?.template === "string") {
      const { data: lead, error } = await supabase
        .from("client_lead")
        .select("*")
        .eq("id", job.lead_id)
        .single();
      if (error) throw error;
      const context =
        job.payload?.context && typeof job.payload.context === "object"
          ? (job.payload.context as Record<string, string | number | null | undefined>)
          : {};
      // Attach a calendar invite when the job carries .ics details (trial confirmation).
      let attachments: { filename: string; content: string }[] | undefined;
      const ics = job.payload?.ics as
        | { summary: string; startsAt: string; endsAt: string; url?: string }
        | undefined;
      if (ics?.startsAt && ics?.endsAt) {
        const text = buildIcs({ uid: `trial-${job.lesson_id ?? job.id}@schowl`, ...ics });
        attachments = [{ filename: "schowl-trial.ics", content: Buffer.from(text, "utf-8").toString("base64") }];
      }
      await sendLeadEmail(lead as ClientLead, job.payload.template, context, attachments);
    }

    await supabase
      .from("automation_job")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", job.id);
  } catch (error) {
    const permanentlyFailed = job.attempts >= 2;
    await supabase
      .from("automation_job")
      .update({
        status: permanentlyFailed ? "failed" : "pending",
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
    if (permanentlyFailed) {
      void notifySystemAlert(
        `Automation job ${job.id} (${job.job_type}) failed permanently: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }
}
