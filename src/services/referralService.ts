import { supabase } from "../db/supabase.js";
import { config } from "../config.js";

export interface Referral {
  id: string;
  referrer_name: string | null;
  referrer_phone: string | null;
  referred_lead_id: string | null;
  status: string;
  reward: string | null;
  created_at: string;
}

export async function addReferral(input: {
  referredLeadId: string;
  referrerName?: string | null;
  referrerPhone?: string | null;
  reward?: string | null;
  notes?: string | null;
  createdByBotUserId?: string | null;
}) {
  const { data, error } = await supabase
    .from("referral")
    .insert({
      referred_lead_id: input.referredLeadId,
      referrer_name: input.referrerName || null,
      referrer_phone: input.referrerPhone || null,
      reward: input.reward || null,
      notes: input.notes || null,
      created_by_bot_user_id: input.createdByBotUserId || null,
      status: "pending",
    })
    .select("*")
    .single();
  if (error) throw error;
  return data as Referral;
}

export async function listReferrals(status?: string) {
  let query = supabase
    .from("referral")
    .select("id, referrer_name, referrer_phone, referred_lead_id, status, reward, created_at")
    .order("created_at", { ascending: false })
    .limit(25);
  if (status) query = query.eq("status", status);
  const { data, error } = await query;
  if (error) throw error;
  return (data as Referral[]) || [];
}

export async function rewardReferral(id: string) {
  const { data, error } = await supabase
    .from("referral")
    .update({ status: "rewarded", rewarded_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) throw error;
  return data as Referral;
}

// Called when a lead converts: qualify any pending referral for it and alert owners.
export async function qualifyReferralForLead(leadId: string) {
  const { data, error } = await supabase
    .from("referral")
    .select("*")
    .eq("referred_lead_id", leadId)
    .eq("status", "pending")
    .maybeSingle();
  if (error) throw error;
  if (!data) return;

  const now = new Date().toISOString();
  await supabase
    .from("referral")
    .update({ status: "qualified", qualified_at: now, updated_at: now })
    .eq("id", data.id);

  // Enqueue an owner DM via the automation queue (worker sends it).
  const referrer = data.referrer_name || "A referrer";
  const message = `🎉 Referral qualified! **${referrer}** referred a lead that just converted. Reward: ${data.reward || "TBD"}. Apply their bonus/discount, then mark it with \`/referral reward ${data.id}\`.`;
  const jobs = config.discordOwnerIds.map((ownerId) => ({
    job_type: "referral_qualified",
    run_at: now,
    status: "pending",
    payload: { dm_discord_user_id: ownerId, message },
  }));
  if (jobs.length) {
    await supabase.from("automation_job").insert(jobs);
  }
}
