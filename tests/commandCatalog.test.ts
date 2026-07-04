import { describe, it, expect } from "vitest";
import { commandsForRoles } from "../src/bot/commandCatalog.js";

describe("commandsForRoles", () => {
  it("no roles -> only ungated commands", () => {
    const cmds = commandsForRoles([]);
    expect(cmds.length).toBeGreaterThan(0);
    expect(cmds.every((c) => c.roles === "everyone")).toBe(true);
    expect(cmds.some((c) => c.usage.startsWith("/help"))).toBe(true);
  });

  it("teacher sees teacher commands but not owner-only ones", () => {
    const usages = commandsForRoles(["teacher"]).map((c) => c.usage);
    expect(usages.some((u) => u.startsWith("/teacher mine"))).toBe(true);
    expect(usages.some((u) => u.startsWith("/config role"))).toBe(false);
  });

  it("sales sees leads but not teacher self-service", () => {
    const usages = commandsForRoles(["sales"]).map((c) => c.usage);
    expect(usages.some((u) => u.startsWith("/lead"))).toBe(true);
    expect(usages.some((u) => u.startsWith("/teacher mine"))).toBe(false);
  });

  it("owner sees the owner-only role command", () => {
    const usages = commandsForRoles(["owner"]).map((c) => c.usage);
    expect(usages.some((u) => u.startsWith("/config role"))).toBe(true);
  });
});
