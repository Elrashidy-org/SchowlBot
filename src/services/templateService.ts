import { supabase } from "../db/supabase.js";
import { renderTemplate, TemplateContext } from "../utils/template.js";

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
