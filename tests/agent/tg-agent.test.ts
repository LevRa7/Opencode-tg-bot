import { describe, it, expect } from "vitest";
import { AGENT_EMOJI, getAgentEmoji, getAgentDisplayName } from "../../src/agent/types.js";

describe("agent/types — tg-agent mode", () => {
  it("has tg-agent emoji", () => {
    expect(AGENT_EMOJI["tg-agent"]).toBeDefined();
    expect(AGENT_EMOJI["tg-agent"]).toBe("📨");
  });

  it("returns tg-agent emoji via helper", () => {
    expect(getAgentEmoji("tg-agent")).toBe("📨");
  });

  it("builds display name for tg-agent", () => {
    const displayName = getAgentDisplayName("tg-agent");
    expect(displayName).toContain("📨");
    expect(displayName).toContain("Tg-agent");
    expect(displayName).toContain("Mode");
  });
});

describe("agent/types — language-adaptive agent names", () => {
  it("has entries for all known agents", () => {
    const known = ["tg-agent", "plan", "build", "general", "explore", "title", "summary", "compaction"];
    for (const name of known) {
      expect(getAgentEmoji(name), `Missing emoji for ${name}`).toBeDefined();
      expect(getAgentEmoji(name)).not.toBe("🤖");
    }
  });

  it("falls back to robot emoji for unknown agents", () => {
    expect(getAgentEmoji("unknown-mode")).toBe("🤖");
  });
});
