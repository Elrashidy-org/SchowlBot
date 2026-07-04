import { z } from "zod";

export const leadPayloadSchema = z.object({
  lead_type: z.string().default("free_trial"),
  parent_name: z.string().trim().min(1, "Parent name is required"),
  child_name: z.string().trim().min(1, "Child name is required"),
  child_age: z.coerce
    .number()
    .int()
    .min(8, "Age must be between 8 and 18")
    .max(18, "Age must be between 8 and 18"),
  phone: z.string().trim().min(1, "Phone is required"),
  country_iso: z.string().trim().length(2, "Country code is required"),
  country_name: z.string().trim().min(1, "Country is required"),
  language: z.enum(["en", "ar"]).default("en"),
  landing_page: z.string().optional().default("/"),
  preferred_contact: z.string().optional().default("phone"),
  consent_contact: z.literal(true, {
    errorMap: () => ({ message: "Contact consent is required" }),
  }),
  privacy_policy_accepted: z.literal(true, {
    errorMap: () => ({ message: "Privacy policy acceptance is required" }),
  }),
  turnstile_token: z.string().optional(),
  source: z.string().optional().default("website"),
  email: z.string().email().optional().or(z.literal("")),
  course_interest: z.string().optional(),
  quiz_answers: z.record(z.unknown()).optional().default({}),
  quiz_recommendation: z.string().optional(),
  utm_source: z.string().optional(),
  utm_medium: z.string().optional(),
  utm_campaign: z.string().optional(),
  utm_term: z.string().optional(),
  utm_content: z.string().optional(),
  referrer: z.string().optional(),
});

export type LeadPayload = z.infer<typeof leadPayloadSchema>;

export const legacyLeadPayloadSchema = z.object({
  name: z.string().trim().min(1),
  parent_name: z.string().trim().min(1),
  email: z.string().email().optional().or(z.literal("")),
  age: z.coerce.number().int(),
  country: z.string().optional().default("Egypt"),
  gov: z.string().optional(),
  phone: z.union([z.string(), z.number()]),
  phone_alt: z.union([z.string(), z.number()]).optional(),
  course: z.string().optional(),
  plan: z.string().optional(),
  interests: z.array(z.string()).optional(),
});

// Minimal name -> ISO map for the legacy form. Defaults to Egypt (the primary
// market) when a country isn't recognised.
const COUNTRY_ISO: Record<string, string> = {
  egypt: "EG",
  "saudi arabia": "SA",
  ksa: "SA",
  "united arab emirates": "AE",
  uae: "AE",
  kuwait: "KW",
  qatar: "QA",
  bahrain: "BH",
  oman: "OM",
  jordan: "JO",
  lebanon: "LB",
  "united states": "US",
  usa: "US",
  "united kingdom": "GB",
  uk: "GB",
  canada: "CA",
};

function countryToIso(name?: string) {
  if (!name) return "EG";
  return COUNTRY_ISO[name.trim().toLowerCase()] || "EG";
}

export function mapLegacyLeadPayload(input: unknown): LeadPayload {
  const legacy = legacyLeadPayloadSchema.parse(input);
  const countryName = legacy.country || "Egypt";
  const countryIso = countryToIso(countryName);

  return {
    lead_type: "free_trial",
    parent_name: legacy.parent_name,
    child_name: legacy.name,
    child_age: legacy.age,
    phone: String(legacy.phone),
    country_iso: countryIso,
    country_name: countryName,
    language: "en",
    landing_page: "/",
    preferred_contact: "phone",
    consent_contact: true,
    privacy_policy_accepted: true,
    email: legacy.email || undefined,
    course_interest:
      legacy.course && legacy.course !== "N/A" ? legacy.course : legacy.interests?.[0],
    quiz_answers: {},
    quiz_recommendation: undefined,
    referrer: undefined,
    source: "website",
  };
}
