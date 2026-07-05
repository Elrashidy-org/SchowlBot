import { describe, it, expect } from "vitest";
import { unsubscribeToken, verifyUnsubscribeToken } from "../src/utils/unsubscribe.js";

describe("unsubscribe tokens", () => {
  it("verifies a token it generated", () => {
    const email = "parent@example.com";
    expect(verifyUnsubscribeToken(email, unsubscribeToken(email))).toBe(true);
  });

  it("rejects a forged token", () => {
    expect(verifyUnsubscribeToken("parent@example.com", "0".repeat(32))).toBe(false);
  });

  it("normalises email case", () => {
    expect(verifyUnsubscribeToken("Parent@Example.com", unsubscribeToken("parent@example.com"))).toBe(true);
  });
});
