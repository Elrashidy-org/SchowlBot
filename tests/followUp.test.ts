import { describe, it, expect } from "vitest";
import { computeNextFollowUp } from "../src/services/followUpService.js";

describe("computeNextFollowUp", () => {
  const base = new Date("2026-06-30T12:00:00.000Z");

  it("schedules a new lead 24h out", () => {
    expect(computeNextFollowUp("new", base)).toBe("2026-07-01T12:00:00.000Z");
  });

  it("schedules a contacted lead 48h out", () => {
    expect(computeNextFollowUp("contacted", base)).toBe("2026-07-02T12:00:00.000Z");
  });

  it("stops chasing terminal statuses", () => {
    expect(computeNextFollowUp("converted", base)).toBeNull();
    expect(computeNextFollowUp("lost", base)).toBeNull();
    expect(computeNextFollowUp("not_fit", base)).toBeNull();
  });
});
