import { describe, it, expect } from "vitest";
import { normalizePhone } from "../src/utils/phone.js";

describe("normalizePhone", () => {
  it("normalises a local Egyptian mobile to E.164", () => {
    expect(normalizePhone("01001234567", "EG")).toBe("+201001234567");
  });

  it("keeps an already-valid E.164 number", () => {
    expect(normalizePhone("+201001234567", "EG")).toBe("+201001234567");
  });

  it("throws on unparseable input", () => {
    expect(() => normalizePhone("abc", "EG")).toThrow();
  });
});
