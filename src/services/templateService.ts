import { supabase } from "../db/supabase.js";
import { renderTemplate, TemplateContext } from "../utils/template.js";

// Resolve a template by base key + language, e.g. ("lead_received", "ar")
// tries "lead_received_ar" and falls back to "lead_received_en".
export async function renderForLead(
  baseKey: string,
  language: string | null | undefined,
  context: TemplateContext,
) {
  const lang = language === "ar" ? "ar" : "en";
  const keys = lang === "ar" ? [`${baseKey}_ar`, `${baseKey}_en`] : [`${baseKey}_en`];

  const { data, error } = await supabase
    .from("communication_template")
    .select("key, channel, subject, body")
    .in("key", keys)
    .eq("active", true);
  if (error) throw error;

  const rows = data || [];
  const chosen = keys.map((k) => rows.find((r) => r.key === k)).find(Boolean);
  if (!chosen) {
    throw new Error(`Template not found: ${baseKey} (${lang})`);
  }

  return {
    key: chosen.key as string,
    channel: chosen.channel as string,
    subject: chosen.subject ? renderTemplate(chosen.subject, context) : null,
    body: renderTemplate(chosen.body, context),
  };
}

export async function renderCommunicationTemplate(
  key: string,
  context: TemplateContext,
) {
  const { data, error } = await supabase
    .from("communication_template")
    .select("key, channel, subject, body")
    .eq("key", key)
    .eq("active", true)
    .single();

  if (error || !data) {
    throw error || new Error(`Template not found: ${key}`);
  }

  return {
    key: data.key as string,
    channel: data.channel as string,
    subject: data.subject ? renderTemplate(data.subject, context) : null,
    body: renderTemplate(data.body, context),
  };
}
