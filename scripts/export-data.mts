// Generates data_export.sql — a full data clone from the live DB.
// Run the output on a fresh DB AFTER migrations (000..013).
// Contains customer PII — never commit the generated file.
import { writeFileSync } from "node:fs";
import { supabase } from "../src/db/supabase.js";

// Tables in FK-dependency order (parents first). `int` = integer/serial PK
// (its sequence is reset after import). email_unsubscribe conflicts on `email`.
const TABLES: { name: string; conflict?: string; int?: boolean }[] = [
  { name: "courses" },
  { name: "teacher" },
  { name: "client", int: true },
  { name: "bot_user" },
  { name: "bot_user_role", int: true },
  { name: "client_lead" },
  { name: "teacher_onboarding" },
  { name: "teacher_course", int: true },
  { name: "teacher_course_responsibility", int: true },
  { name: "teacher_availability", int: true },
  { name: "teacher_time_off", int: true },
  { name: "lesson", int: true },
  { name: "student" },
  { name: "membership" },
  { name: "payment" },
  { name: "referral" },
  { name: "course_material", int: true },
  { name: "teacher_material_request", int: true },
  { name: "discord_channel_config", int: true },
  { name: "camp_registration" },
  { name: "email_unsubscribe", conflict: "email" },
];

async function fetchAll(table: string) {
  const { data, error } = await supabase.from(table).select("*").limit(10000);
  if (error) throw error;
  return data || [];
}

const parts: string[] = [
  "-- SchowlBot full data export — run AFTER migrations (000..013) on the fresh DB.",
  "-- Contains customer PII. Do NOT commit this file.",
  "-- communication_template / automation_job / activity logs are intentionally omitted.",
  "",
];
const seqResets: string[] = [];

for (const t of TABLES) {
  const rows = await fetchAll(t.name);
  const conflict = t.conflict || "id";
  parts.push(
    `-- ${rows.length} row(s) -> public.${t.name}`,
    `insert into public.${t.name}`,
    `select * from jsonb_populate_recordset(null::public.${t.name}, $json$${JSON.stringify(rows)}$json$::jsonb)`,
    `on conflict (${conflict}) do nothing;`,
    "",
  );
  if (t.int && rows.length > 0) {
    seqResets.push(
      `select setval(pg_get_serial_sequence('public.${t.name}', 'id'), (select coalesce(max(id), 1) from public.${t.name}), true);`,
    );
  }
  console.log(`  ${t.name}: ${rows.length}`);
}

if (seqResets.length) {
  parts.push("-- reset identity sequences so new inserts don't collide", ...seqResets, "");
}

writeFileSync("data_export.sql", parts.join("\n"));
console.log("Wrote data_export.sql");
process.exit(0);
