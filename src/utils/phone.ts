import { parsePhoneNumberFromString } from "libphonenumber-js";
import { ValidationError } from "./errors.js";

export function normalizePhone(phone: string, countryIso: string) {
  const raw = phone.trim();
  const upperCountry = countryIso.toUpperCase();
  const parsed = parsePhoneNumberFromString(raw, upperCountry as never);

  if (parsed?.isValid()) {
    return parsed.number;
  }

  const digits = raw.replace(/\D/g, "");
  if (upperCountry === "EG") {
    const normalized = digits.startsWith("0") ? `2${digits}` : digits;
    if (/^20\d{10}$/.test(normalized)) {
      return `+${normalized}`;
    }
  }

  if (digits.length >= 7 && digits.length <= 15) {
    return raw.startsWith("+") ? `+${digits}` : `+${digits}`;
  }

  throw new ValidationError({
    phone: "Please enter a valid phone number for the selected country",
  });
}
