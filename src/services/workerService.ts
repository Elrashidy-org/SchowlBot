import { supabase } from "../db/supabase.js";
import { ClientLead } from "../types.js";
import { sendLeadEmail } from "./emailService.js";
import {
  notifyLeadSlaBreached,
  notifyRenewalDue,
  notifySystemAlert,
  postDailyDigest,
  sendDirectMessage,
} from "../bot/discordService.js";
import { sendTemplatedEmail } from "./emailService.js";
import {
  getStudentById,
  listRenewalsNeedingReminder,
  markRenewalReminded,
} from "./studentService.js";

const RENEWAL_REMINDER_DAYS = 7;

// Post the daily digest once per day, after ~08:00 Cairo (≈06:00 UTC).
let lastDigestDate = "";
function maybePostDigest() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (lastDigestDate === day || now.getUTCHours() < 6) return;
  lastDigestDate = day;
  void postDailyDigest().catch((error) => console.error("Daily digest failed", error));
}

// Once per day, remind owners (and parents) about upcoming membership renewals.
let lastRenewalDate = "";
function maybeRunRenewals() {
  const now = new Date();
  const day = now.toISOString().slice(0, 10);
  if (lastRenewalDate === day || now.getUTCHours() < 6) return;
  lastRenewalDate = day;
  void runRenewalReminders().catch((error) => console.error("Renewal reminders failed", error));
}

async function runRenewalReminders() {
  const due = await listRenewalsNeedingReminder(RENEWAL_REMINDER_DAYS);
  for (const membership of due) {
    const student = await getStudentById(membership.student_id);
    if (!student) continue;
    await notifyRenewalDue({
      name: student.name,
      renewsOn: membership.renews_on,
      plan: membership.plan,
      price: membership.price,
      currency: membership.currency,
    });
    if (student.email) {
      await sendTemplatedEmail({
        to: student.email,
        templateKey: "membership_renewal",
        language: "en",
        context: {
          parent_name: student.parent_name || "",
          child_name: student.name,
          renews_on: membership.renews_on,
        },
        leadId: student.lead_id,
      });
    }
    await markRenewalReminded(membership.id);
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

async function runJob(job: { id: number; job_type: string; lead_id: string | null; payload: Record<string, unknown>; attempts: number }) {
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
      await sendLeadEmail(lead as ClientLead, job.payload.template, context);
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
