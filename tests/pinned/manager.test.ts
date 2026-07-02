/**
 * Tests for PinnedMessageManager — reference implementation
 * Run: npx vitest run tests/pinned/manager.test.ts
 */
import { describe, expect, it, beforeEach, vi } from "vitest";
import type { Api } from "grammy";

vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "godmode", modelID: "deepseek-v4-flash-free" })),
}));
vi.mock("../../src/model/context-limit.js", () => ({
  getModelContextLimit: vi.fn(() => Promise.resolve(131072)),
}));
vi.mock("../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    getKeyboard: vi.fn(() => undefined),
    setKeyboardMessageId: vi.fn(),
  },
}));
vi.mock("../../src/settings/manager.js", () => ({
  getPinnedMessageId: vi.fn(() => null),
  setPinnedMessageId: vi.fn(),
  clearPinnedMessageId: vi.fn(),
  getCurrentProject: vi.fn(() => null),
}));

import { __resetPinnedMessageManagersForTests, pinnedMessageManager } from "../../src/pinned/manager.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const THREAD_SCOPE: import("../../src/telegram/scope.js").TelegramConversationScope = {
  chatId: 123,
  messageThreadId: 67890,
  userId: 456,
};

function makeMockApi(overrides: Partial<Api> = {}): Api {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 100 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    pinChatMessage: vi.fn().mockResolvedValue(true),
    unpinAllChatMessages: vi.fn().mockResolvedValue(true),
    ...overrides,
  } as unknown as Api;
}

function initWithThread(api: Api) {
  runWithTelegramConversationScope(THREAD_SCOPE, () => {
    pinnedMessageManager.initialize(api, 123);
  });
}

function runInScope<T>(fn: () => Promise<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    runWithTelegramConversationScope(THREAD_SCOPE, () => {
      fn().then(resolve, reject);
    });
  });
}

describe("PinnedMessageManager", () => {
  beforeEach(() => {
    __resetPinnedMessageManagersForTests();
    vi.clearAllMocks();
  });

  describe("create and update lifecycle", () => {
    it("creates pinned message on session change", async () => {
      const api = makeMockApi();
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test Session");
        expect(pinnedMessageManager.getState().messageId).toBe(100);
        expect(api.sendMessage).toHaveBeenCalledTimes(1);
        expect(api.pinChatMessage).toHaveBeenCalledWith(123, 100, expect.any(Object));
      });
    });

    it("edits pinned message on update", async () => {
      const api = makeMockApi();
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
        await (pinnedMessageManager as any).updatePinnedMessage(true);
        expect(api.editMessageText).toHaveBeenCalled();
      });
    });

    it("recreates pinned message when edit returns 'message to edit not found'", async () => {
      const api = makeMockApi({
        editMessageText: vi.fn().mockRejectedValue(
          new Error("400: Bad Request: message to edit not found"),
        ),
        sendMessage: vi.fn()
          .mockResolvedValueOnce({ message_id: 100 })
          .mockResolvedValueOnce({ message_id: 200 }),
      });
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
        // Update that triggers "not found" → should recreate
        await (pinnedMessageManager as any).updatePinnedMessage(true);
        // sendMessage called twice: initial create + recreate
        expect(api.sendMessage).toHaveBeenCalledTimes(2);
        // New message ID should be 200
        expect(pinnedMessageManager.getState().messageId).toBe(200);
      });
    });

    it("refreshes pinned message on refresh() call", async () => {
      const api = makeMockApi();
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
        await pinnedMessageManager.refresh();
        expect(api.editMessageText).toHaveBeenCalled();
      });
    });
  });

  describe("unpinOldMessage", () => {
    it("uses unpinAllChatMessages for cleanup", async () => {
      const api = makeMockApi();
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
        // Second session change triggers unpinOldMessage
        await (pinnedMessageManager as any).onSessionChange("sess-2", "Test2");
        expect(api.unpinAllChatMessages).toHaveBeenCalledWith(123);
      });
    });
  });
});
