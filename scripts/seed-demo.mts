// One-off demo seeder: creates a real lead + an approved teacher + course
// assignment + availability + a scheduled trial, using the same service code
// the bot uses. Data is persisted (not cleaned up).
//
// Run with Turnstile disabled so the lead can be created from a script:
//   TURNSTILE_SECRET_KEY= npx tsx scripts/seed-demo.mts
//
// Emails default to plus-addresses of SEED_EMAIL so everything lands in one inbox.

import { config } from "../src/config.js";
import { listCourses } from "../src/services/courseService.js";
import { createLead } from "../src/services/leadService.js";
import {
  approveTeacher,
  initTeacherProfile,
  setTeacherResponsibility,
} from "../src/services/teacherService.js";
import { addAvailability } from "../src/services/availabilityService.js";
import { scheduleTrial } from "../src/services/scheduleService.js";

const SEED_EMAIL = process.env.SEED_EMAIL || "bebo.elrashidy22@gmail.com";
const [name, domain] = SEED_EMAIL.split("@");
const leadEmail = `${name}+lead@${domain}`;
const teacherEmail = `${name}+teacher@${domain}`;
const teacherDiscordId = config.discordOwnerIds[0] || "100000000000000000";

function log(step: string, value: unknown) {
  console.log(`\n▶ ${step}`);
  console.log(value);
}

async function main() {
  // 1) Pick a real course.
  const courses = await listCourses();
  if (courses.length === 0) throw new Error("No courses found in the database.");
  const course = courses[0];
  log("Course", { id: course.id, name: course.name_en || course.name_ar });

  // 2) Create a website lead (Turnstile must be disabled for this run).
  const { lead, duplicate } = await createLead({
    lead_type: "free_trial",
    parent_name: "Demo Parent",
    child_name: "Demo Child",
    child_age: 12,
    phone: "201000000001",
    country_iso: "EG",
    country_name: "Egypt",
    language: "en",
    consent_contact: true,
    privacy_policy_accepted: true,
    email: leadEmail,
    course_interest: course.name_en || undefined,
  });
  log("Lead created", { id: lead.id, status: lead.status, duplicate, email: lead.email });

  // 3) Teacher onboarding + approval (linked to your Discord id).
  await initTeacherProfile({
    discordUserId: teacherDiscordId,
    displayName: "Demo Teacher",
    fullName: "Demo Teacher",
    email: teacherEmail,
    phone: "201000000002",
    timezone: "Africa/Cairo",
  });
  const teacher = await approveTeacher(teacherDiscordId, null);
  log("Teacher approved", { id: teacher.id, name: teacher.name, status: teacher.status, discord: teacherDiscordId });

  // 4) Assign the course to the teacher.
  await setTeacherResponsibility({ teacherId: teacher.id, courseId: course.id, active: true });
  log("Course assigned to teacher", { course: course.name_en, teacher: teacher.name });

  // 5) Add weekly availability (Monday 16:00-20:00 Cairo).
  const availability = await addAvailability({
    teacherId: teacher.id,
    dayOfWeek: 1,
    startTime: "16:00",
    endTime: "20:00",
    timezone: "Africa/Cairo",
  });
  log("Availability added", { id: availability.id });

  // 6) Schedule a trial in 2 days (creates a Google Meet link if Google is configured).
  const start = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000);
  start.setUTCHours(16, 0, 0, 0); // ~18:00 Cairo
  const lesson = await scheduleTrial({
    leadId: lead.id,
    courseId: course.id,
    startsAt: start.toISOString(),
    teacherId: teacher.id,
  });
  log("Trial scheduled", {
    lessonId: lesson.id,
    scheduledAt: lesson.scheduled_at,
    meetingUrl: lesson.meeting_url || "(no link — Google not configured or failed)",
  });

  console.log("\n================ SUMMARY ================");
  console.log("Lead ID    :", lead.id);
  console.log("Teacher ID :", teacher.id, "(Discord:", teacherDiscordId + ")");
  console.log("Lesson ID  :", lesson.id);
  console.log("Meet link  :", lesson.meeting_url || "none");
  console.log("========================================");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("\n❌ Seed failed:", error);
    process.exit(1);
  });
