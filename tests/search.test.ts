import { describe, it, expect } from "vitest";
import { sanitizeSearchTerm } from "../src/utils/search.js";

describe("sanitizeSearchTerm", () => {
  it("neutralises a PostgREST filter-injection attempt", () => {
    // The comma (which would start a new OR clause) becomes a space.
    expect(sanitizeSearchTerm("foo,status.eq.converted")).toBe("foo status.eq.converted");
  });

  it("strips parentheses and percent signs", () => {
    expect(sanitizeSearchTerm("a(b)c%d")).toBe("a b c d");
  });

  it("collapses whitespace and trims", () => {
    expect(sanitizeSearchTerm("  hi   there  ")).toBe("hi there");
  });

  it("caps the length", () => {
    expect(sanitizeSearchTerm("a".repeat(100)).length).toBe(60);
  });
});
