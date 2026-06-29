import { Resend } from "resend";
import { config } from "../config.js";
import { supabase } from "../db/supabase.js";
import { ClientLead } from "../types.js";
import { renderCommunicationTemplate } from "./templateService.js";

const resend = config.resendApiKey ? new Resend(config.resendApiKey) : null;

export async function sendLeadEmail(lead: ClientLead, templateKey: string) {
  if (!resend || !lead.email) {
    return;
  }

  const rendered = await renderCommunicationTemplate(templateKey, {
    parent_name: lead.parent_name,
    child_name: lead.child_name,
    course_interest: lead.course_interest,
  });

  try {
    const result = await resend.emails.send({
      from: config.resendFromEmail,
      to: lead.email,
      subject: rendered.subject || "Schowl",
      html: `<div style="font-family:Arial,sans-serif;line-height:1.6;color:#0b1638">${rendered.body}</div>`,
    });

    await supabase.from("communication_log").insert({
      lead_id: lead.id,
      channel: "email",
      template_key: templateKey,
      recipient: lead.email,
      status: "sent",
      provider_message_id: result.data?.id,
      metadata: result,
    });
  } catch (error) {
    await supabase.from("communication_log").insert({
      lead_id: lead.id,
      channel: "email",
      template_key: templateKey,
      recipient: lead.email,
      status: "failed",
      error_message: error instanceof Error ? error.message : String(error),
    });
  }
}
