import { describe, expect, it } from "vitest";
import {
  createAgentKeyboard,
  createMainKeyboard,
  removeKeyboard,
} from "../../../src/bot/utils/keyboard.js";

function getButtonText(button: string | { text: string }): string {
  return typeof button === "string" ? button : button.text;
}

describe("bot/utils/keyboard", () => {
  it("creates main keyboard with defaults", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openrouter",
      modelID: "openai/gpt-4o",
    });

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("🤖 openai/gpt-4o");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("🛠️ 0");
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBeUndefined();
  });

  it("creates main keyboard with context info", () => {
    const keyboard = createMainKeyboard(
      "plan",
      {
        providerID: "provider",
        modelID: "model",
      },
      {
        tokensUsed: 150000,
        tokensLimit: 1500000,
      },
    );

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("🤖 model");
    expect(getButtonText(keyboard.keyboard[0][1])).toBe("📋 150K / 1.5M (10%)");
  });

  it("appends variant in parentheses when not default/none", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openai",
      modelID: "gpt-4o",
      variant: "high",
    });

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("🤖 gpt-4o (high)");
  });

  it("omits variant for default", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openai",
      modelID: "gpt-4o",
      variant: "default",
    });

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("🤖 gpt-4o");
  });

  it("omits variant for none", () => {
    const keyboard = createMainKeyboard("build", {
      providerID: "openai",
      modelID: "gpt-4o",
      variant: "none",
    });

    expect(getButtonText(keyboard.keyboard[0][0])).toBe("🤖 gpt-4o");
  });

  it("creates custom agent keyboard and remove payload", () => {
    const keyboard = createAgentKeyboard("custom");
    const nonEmptyRows = keyboard.keyboard.filter((row) => row.length > 0);

    expect(nonEmptyRows).toEqual([[{ text: "🤖" }]]);
    expect(keyboard.resize_keyboard).toBe(true);
    expect(keyboard.is_persistent).toBeUndefined();

    expect(removeKeyboard()).toEqual({ remove_keyboard: true });
  });
});
