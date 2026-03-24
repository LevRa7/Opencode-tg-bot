import { describe, expect, it } from "vitest";
import { AGENT_EMOJI, getAgentDisplayName, getAgentEmoji } from "../../src/agent/types.js";

describe("agent/types", () => {
  it("returns mapped emoji for known agents", () => {
    expect(getAgentEmoji("build")).toBe("🛠️");
    expect(getAgentEmoji("plan")).toBe("📋");
    expect(AGENT_EMOJI.general).toBe("💬");
  });

  it("returns fallback emoji for unknown agents", () => {
    expect(getAgentEmoji("custom-agent")).toBe("🤖");
  });

  it("builds display name with emoji and capitalized mode", () => {
    expect(getAgentDisplayName("build")).toBe("🛠️ Build Mode");
    expect(getAgentDisplayName("customAgent")).toBe("🤖 CustomAgent Mode");
  });
});
