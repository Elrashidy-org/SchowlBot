import { supabase } from "../db/supabase.js";
import { countUpcomingRenewals } from "./studentService.js";

// Weekly business summary: pipeline movement, sessions delivered, teacher fill
// rate (lessons this week / total weekly capacity), and upcoming renewals.
export async function getWeeklySummary() {
  const since = new Date(Date.now() - 7 * 86400000).toISOString();
  const nowIso = new Date().toISOString();

  const leadCount = () => supabase.from("client_lead").select("id", { count: "exact", head: true });
  const activityCount = (status: string) =>
    supabase
      .from("lead_activity")
      .select("id", { count: "exact", head: true })
      .eq("new_status", status)
      .gte("created_at", since);

  const [newLeads, trialsBooked, conversions, sessionsDelivered, lessonsThisWeekRes, capacityRes, renewals] =
    await Promise.all([
      leadCount().gte("created_at", since),
      activityCount("trial_booked"),
      activityCount("converted"),
      supabase
        .from("lesson")
        .select("id", { count: "exact", head: true })
        .eq("status", "completed")
        .gte("scheduled_at", since)
        .lte("scheduled_at", nowIso),
      supabase
        .from("lesson")
        .select("id", { count: "exact", head: true })
        .in("status", ["pending", "scheduled", "completed"])
        .gte("scheduled_at", since)
        .lte("scheduled_at", nowIso),
      supabase.from("teacher").select("max_weekly_lessons").eq("active", true).eq("status", "active"),
      countUpcomingRenewals(7),
    ]);

  const capacity = (capacityRes.data || []).reduce(
    (sum, t) => sum + ((t.max_weekly_lessons as number) || 0),
    0,
  );
  const lessonsThisWeek = lessonsThisWeekRes.count ?? 0;
  const fillRate = capacity > 0 ? Math.round((lessonsThisWeek / capacity) * 100) : null;

  return {
    newLeads: newLeads.count ?? 0,
    trialsBooked: trialsBooked.count ?? 0,
    conversions: conversions.count ?? 0,
    sessionsDelivered: sessionsDelivered.count ?? 0,
    lessonsThisWeek,
    capacity,
    fillRate,
    upcomingRenewals: renewals,
  };
}
