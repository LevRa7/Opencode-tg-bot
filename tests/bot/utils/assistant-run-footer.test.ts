import { describe, expect, it } from "vitest";
import { formatAssistantRunFooter } from "../../../src/bot/utils/assistant-run-footer.js";

describe("bot/utils/assistant-run-footer", () => {
  it("formats agent, model, and elapsed time in one line", () => {
    expect(
      formatAssistantRunFooter({
        agent: "plan",
        providerID: "openai",
        modelID: "gpt-5.4",
        elapsedMs: 57_932,
      }),
    ).toBe("📋 Plan Mode · 🤖 openai/gpt-5.4 · 🕒 57.9s");
  });
});
