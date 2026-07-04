import { describe, it, expect } from "vitest";
import { renderTemplate, buildWhatsAppLink } from "../src/utils/template.js";

describe("renderTemplate", () => {
  it("replaces placeholders", () => {
    expect(renderTemplate("Hi {{name}}", { name: "Omar" })).toBe("Hi Omar");
  });
  it("blanks missing keys", () => {
    expect(renderTemplate("a {{x}} b", {})).toBe("a  b");
  });
  it("stringifies numbers", () => {
    expect(renderTemplate("age {{age}}", { age: 12 })).toBe("age 12");
  });
});

describe("buildWhatsAppLink", () => {
  it("strips non-digits and url-encodes the message", () => {
    expect(buildWhatsAppLink("+20 100 123 4567", "hi there")).toBe(
      "https://wa.me/201001234567?text=hi%20there",
    );
  });
});
