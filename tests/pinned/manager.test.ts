import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const mocked = vi.hoisted(() => ({
  settingsFilePath: "/tmp/opencode-telegram-bot-pinned-manager.test.json",
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: vi.fn(() => ({
    settingsFilePath: mocked.settingsFilePath,
  })),
}));

import {
  __resetPinnedMessageManagersForTests,
  pinnedMessageManager,
} from "../../src/pinned/manager.js";
import { __resetSettingsForTests, setPinnedMessageId } from "../../src/settings/manager.js";

describe("pinned/manager scoped state", () => {
  const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
  const scopeB: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 11 };

  beforeEach(() => {
    __resetPinnedMessageManagersForTests();
    __resetSettingsForTests();
  });

  it("restores pinned message ids independently per topic", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setPinnedMessageId(101);
      pinnedMessageManager.initialize({} as never, 100);
    });

    runWithTelegramConversationScope(scopeB, () => {
      setPinnedMessageId(202);
      pinnedMessageManager.initialize({} as never, 100);
    });

    expect(
      runWithTelegramConversationScope(scopeA, () => pinnedMessageManager.getState().messageId),
    ).toBe(101);
    expect(
      runWithTelegramConversationScope(scopeB, () => pinnedMessageManager.getState().messageId),
    ).toBe(202);
  });
});
