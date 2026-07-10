// Generates data_export.sql from the live DB. Run the output on a fresh DB
// AFTER migrations. Contains customer PII — do not commit.
import { writeFileSync } from "node:fs";
import { supabase } from "../src/db/supabase.js";

async function fetchAll(table: string, filter?: (q: any) => any) {
  let q = supabase.from(table).select("*");
  if (filter) q = filter(q);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

function block(table: string, rows: unknown[]) {
  const json = JSON.stringify(rows);
  return `-- ${rows.length} row(s) -> public.${table}\ninsert into public.${table}\nselect * from jsonb_populate_recordset(null::public.${table}, $json$${json}$json$::jsonb)\non conflict (id) do nothing;\n`;
}

const courses = await fetchAll("courses");
const leads = await fetchAll("client_lead", (q) => q.eq("source_url", "legacy:client"));

const sql = [
  "-- SchowlBot data export — run AFTER migrations (000..012) on the fresh DB.",
  "-- Contains customer PII. Do NOT commit this file.",
  "",
  block("courses", courses),
  block("client_lead", leads),
].join("\n");

writeFileSync("data_export.sql", sql);
console.log(`Wrote data_export.sql: ${courses.length} courses, ${leads.length} legacy leads`);
process.exit(0);
