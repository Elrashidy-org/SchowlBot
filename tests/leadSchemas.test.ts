import { describe, it, expect } from "vitest";
import { mapLegacyLeadPayload, leadPayloadSchema } from "../src/services/leadSchemas.js";

describe("mapLegacyLeadPayload", () => {
  it("maps recognised countries to ISO codes", () => {
    const r = mapLegacyLeadPayload({
      name: "Omar",
      parent_name: "Sara",
      age: 12,
      country: "Saudi Arabia",
      phone: "0512345678",
    });
    expect(r.country_iso).toBe("SA");
    expect(r.child_name).toBe("Omar");
    expect(r.parent_name).toBe("Sara");
  });

  it("defaults unknown countries to EG", () => {
    const r = mapLegacyLeadPayload({
      name: "Omar",
      parent_name: "Sara",
      age: 12,
      country: "Atlantis",
      phone: "123",
    });
    expect(r.country_iso).toBe("EG");
  });
});

describe("leadPayloadSchema", () => {
  const valid = {
    parent_name: "Sara",
    child_name: "Omar",
    child_age: 12,
    phone: "201001234567",
    country_iso: "EG",
    country_name: "Egypt",
    consent_contact: true,
    privacy_policy_accepted: true,
  };

  it("accepts a valid payload", () => {
    expect(leadPayloadSchema.safeParse(valid).success).toBe(true);
  });

  it("rejects out-of-range age", () => {
    expect(leadPayloadSchema.safeParse({ ...valid, child_age: 5 }).success).toBe(false);
  });

  it("requires contact consent", () => {
    expect(leadPayloadSchema.safeParse({ ...valid, consent_contact: false }).success).toBe(false);
  });
});
