import { supabase } from "../db/supabase.js";
import { ClientLead } from "../types.js";
import { sendLeadEmail } from "./emailService.js";

let workerTimer: NodeJS.Timeout | null = null;

export function startAutomationWorker() {
  if (workerTimer) return;
  workerTimer = setInterval(() => {
    void runAutomationTick().catch((error) => {
      console.error("Automation worker failed", error);
    });
  }, 60_000);
  void runAutomationTick();
}

export function stopAutomationWorker() {
  if (workerTimer) {
    clearInterval(workerTimer);
    workerTimer = null;
  }
}

async function runAutomationTick() {
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
  await supabase
    .from("automation_job")
    .update({ status: "running", attempts: job.attempts + 1, updated_at: new Date().toISOString() })
    .eq("id", job.id);

  try {
    if (job.lead_id && typeof job.payload?.template === "string") {
      const { data: lead, error } = await supabase
        .from("client_lead")
        .select("*")
        .eq("id", job.lead_id)
        .single();
      if (error) throw error;
      await sendLeadEmail(lead as ClientLead, job.payload.template);
    }

    await supabase
      .from("automation_job")
      .update({ status: "done", updated_at: new Date().toISOString() })
      .eq("id", job.id);
  } catch (error) {
    await supabase
      .from("automation_job")
      .update({
        status: job.attempts >= 2 ? "failed" : "pending",
        last_error: error instanceof Error ? error.message : String(error),
        updated_at: new Date().toISOString(),
      })
      .eq("id", job.id);
  }
}
