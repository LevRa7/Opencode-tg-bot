import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

vi.mock("../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  })),
}));

vi.mock("../../src/variant/manager.js", () => ({
  formatVariantForButton: vi.fn(() => "Default"),
}));

import { __resetKeyboardManagersForTests, keyboardManager } from "../../src/keyboard/manager.js";

describe("keyboard/manager scoped state", () => {
  const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
  const scopeB: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 11 };

  beforeEach(() => {
    __resetKeyboardManagersForTests();
  });

  it("keeps context state isolated between topics", () => {
    runWithTelegramConversationScope(scopeA, () => {
      keyboardManager.initialize({} as never, 100);
      keyboardManager.updateContext(10, 100);
    });

    runWithTelegramConversationScope(scopeB, () => {
      keyboardManager.initialize({} as never, 100);
      keyboardManager.updateContext(20, 200);
    });

    expect(
      runWithTelegramConversationScope(scopeA, () => keyboardManager.getContextInfo()),
    ).toEqual({
      tokensUsed: 10,
      tokensLimit: 100,
    });
    expect(
      runWithTelegramConversationScope(scopeB, () => keyboardManager.getContextInfo()),
    ).toEqual({
      tokensUsed: 20,
      tokensLimit: 200,
    });
  });
});
