import { describe, expect, it } from "vitest";
import { createMainKeyboard } from "../../src/bot/utils/keyboard.js";
import {
  AGENT_MODE_BUTTON_TEXT_PATTERN,
  MODEL_BUTTON_TEXT_PATTERN,
} from "../../src/bot/message-patterns.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/message-patterns", () => {
  it("matches model button text from main keyboard", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    const modelButtonText = getButtonText(keyboard.keyboard[0][0]);
    expect(modelButtonText).toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("matches single-line model button text", () => {
    expect("🤖 cliproxyapi2/gpt-5.3-codex").toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("matches agent mode button text from main keyboard", () => {
    const keyboard = createMainKeyboard("plan", {
      providerID: "openai",
      modelID: "gpt-4o",
    });

    const agentButtonText = getButtonText(keyboard.keyboard[0][1]);
    expect(agentButtonText).toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
  });

  it("routes custom agent fallback emoji as agent button, not model button", () => {
    const keyboard = createMainKeyboard("custom", {
      providerID: "openai",
      modelID: "gpt-4o",
    });

    const agentButtonText = getButtonText(keyboard.keyboard[0][1]);
    expect(agentButtonText).toBe("🤖 0");
    expect(agentButtonText).toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect(agentButtonText).not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
  });

  it("does not match plain prompt text", () => {
    expect("Create a migration plan").not.toMatch(MODEL_BUTTON_TEXT_PATTERN);
    expect("Create a migration plan").not.toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
  });

  it("agent mode emojis match expected set", () => {
    expect("📋").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("🛠️").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("💬").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("🔍").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("📝").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("📄").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
    expect("📦").toMatch(AGENT_MODE_BUTTON_TEXT_PATTERN);
  });
});
