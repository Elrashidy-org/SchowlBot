export type LeadStatus =
  | "new"
  | "contacted"
  | "trial_booked"
  | "trial_done"
  | "converted"
  | "not_fit"
  | "lost";

export type BotRole = "owner" | "admin" | "team_lead" | "sales" | "teacher";

export interface BotUser {
  id: string;
  discord_user_id: string;
  display_name: string | null;
  email: string | null;
  phone: string | null;
  timezone: string;
  teacher_id: string | null;
  active: boolean;
}

export interface ClientLead {
  id: string;
  lead_type: string;
  status: LeadStatus;
  parent_name: string;
  child_name: string;
  child_age: number;
  phone_raw: string;
  phone_e164: string;
  country_iso: string;
  country_name: string;
  language: "en" | "ar";
  landing_page: string | null;
  preferred_contact: string;
  email: string | null;
  course_interest: string | null;
  quiz_recommendation: string | null;
  referrer: string | null;
  source: string | null;
  notes: string | null;
  created_at: string;
  next_follow_up_at: string | null;
}

export interface Course {
  id: string;
  name_en: string | null;
  name_ar: string | null;
}

export interface Teacher {
  id: string;
  name: string | null;
  email: string | null;
  phone_number: string | null;
  discord_user_id: string | null;
  status: "pending" | "active" | "inactive" | "rejected";
  active: boolean;
  timezone: string;
  max_daily_lessons: number;
  max_weekly_lessons: number;
  auto_assign_enabled: boolean;
}
