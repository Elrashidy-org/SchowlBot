import { supabase } from "../db/supabase.js";
import { LeadStatus } from "../types.js";

// How long after the last touch a lead should resurface in `/lead due`.
// null = stop chasing (terminal-ish status).
const FOLLOW_UP_HOURS: Record<LeadStatus, number | null> = {
  new: 24,
  contacted: 48,
  trial_booked: 24,
  trial_done: 24,
  converted: null,
  not_fit: null,
  lost: null,
};

// Email job created on lead creation; cancelled once the parent is engaged.
const NO_RESPONSE_TEMPLATE = "no_response_followup_24h";
const NO_RESPONSE_JOB_TYPE = "lead_no_response";
const SLA_JOB_TYPE = "lead_sla_nudge";

// Internal nudge: if a new lead isn't contacted within the SLA window, alert
// the assigned sales rep (or the leads channel).
export async function enqueueSlaNudge(leadId: string, hoursFromNow: number) {
  if (hoursFromNow <= 0) return;
  const runAt = new Date(Date.now() + hoursFromNow * 60 * 60 * 1000).toISOString();
  const { error } = await supabase.from("automation_job").insert({
    job_type: SLA_JOB_TYPE,
    lead_id: leadId,
    run_at: runAt,
    status: "pending",
    payload: { sla: true },
  });
  if (error) throw error;
}

export function computeNextFollowUp(
  status: LeadStatus,
  from: Date = new Date(),
): string | null {
  const hours = FOLLOW_UP_HOURS[status];
  if (hours == null) return null;
  return new Date(from.getTime() + hours * 60 * 60 * 1000).toISOString();
}

// Queue the "did we lose you?" email for a freshly created lead. The worker
// sends it only if the lead has an email; it is cancelled if the lead is
// contacted or closed before run_at.
export async function enqueueNoResponseFollowUp(leadId: string, runAt: string) {
  const { error } = await supabase.from("automation_job").insert({
    job_type: NO_RESPONSE_JOB_TYPE,
    lead_id: leadId,
    run_at: runAt,
    status: "pending",
    payload: { template: NO_RESPONSE_TEMPLATE },
  });
  if (error) throw error;
}

// Cancel pending no-response and SLA jobs for a lead (e.g. once it is contacted).
export async function cancelLeadFollowUpJobs(leadId: string) {
  const { error } = await supabase
    .from("automation_job")
    .update({ status: "cancelled", updated_at: new Date().toISOString() })
    .eq("lead_id", leadId)
    .in("job_type", [NO_RESPONSE_JOB_TYPE, SLA_JOB_TYPE])
    .eq("status", "pending");
  if (error) throw error;
}
