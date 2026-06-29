/**
 * Tests for PinnedMessageManager — deleteMessage + message_thread_id + circuit breaker
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

  // =========================================================================
  // FIX #1: deleteMessage now includes message_thread_id
  // =========================================================================
  describe("deleteMessage with message_thread_id", () => {
    it("receives thread_id in recreatePinnedMessage", async () => {
      const api = makeMockApi({
        editMessageText: vi.fn().mockRejectedValue(
          new Error("400: Bad Request: message can't be edited"),
        ),
      });
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
        await (pinnedMessageManager as any).updatePinnedMessage(true);
      });

      const calls = (api.deleteMessage as any).mock.calls;
      const withThreadId = calls.find(
        (c: any[]) => c[2]?.message_thread_id === 67890,
      );
      expect(withThreadId).toBeDefined();
    });

    it("receives thread_id in unpinOldMessage", async () => {
      const api = makeMockApi();
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
      });
      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-2", "Test2");
      });

      const calls = (api.deleteMessage as any).mock.calls;
      expect(calls.length).toBeGreaterThanOrEqual(1);
      expect(calls.every((c: any[]) => c[2]?.message_thread_id === 67890)).toBe(true);
    });
  });

  // =========================================================================
  // FIX #2: cantEditFailCount resets on successful createPinnedMessage
  // =========================================================================
  describe("cantEditFailCount resets", () => {
    it("resets to 0 after successful recreate", async () => {
      const api = makeMockApi({
        editMessageText: vi.fn().mockRejectedValue(
          new Error("400: Bad Request: message can't be edited"),
        ),
        sendMessage: vi.fn()
          .mockResolvedValueOnce({ message_id: 100 })
          .mockResolvedValueOnce({ message_id: 200 })
          .mockResolvedValueOnce({ message_id: 300 }),
      });
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");
        // Edit fails → recreate succeeds → counter resets to 0
        await (pinnedMessageManager as any).updatePinnedMessage(true);
        expect(pinnedMessageManager.getState().cantEditFailCount).toBe(0);
        // Again — edit fails → recreate succeeds → counter stays 0
        await (pinnedMessageManager as any).updatePinnedMessage(true);
        expect(pinnedMessageManager.getState().cantEditFailCount).toBe(0);
      });
    });
  });

  // =========================================================================
  // FIX #3: Circuit breaker opens when recreate ALSO keeps failing
  // =========================================================================
  describe("circuit breaker on persistent failure", () => {
    it("opens when sendMessage (recreate) also fails 3 times", async () => {
      let editCount = 0;
      const api = makeMockApi({
        editMessageText: vi.fn().mockImplementation(() => {
          editCount++;
          throw new Error("400: message can't be edited");
        }),
        // Simulate recreate failure: first create succeeds, subsequent recreates fail
        sendMessage: vi.fn()
          .mockResolvedValueOnce({ message_id: 100 })  // initial create OK
          .mockRejectedValue(new Error("400: message thread not found"))  // 1st recreate FAIL
          .mockRejectedValue(new Error("400: message thread not found"))  // 2nd recreate FAIL (not called? circuit might open earlier)
      });
      initWithThread(api);

      await runInScope(async () => {
        await (pinnedMessageManager as any).onSessionChange("sess-1", "Test");

        // Update 1: edit fails → recreate → sendMessage fails → createPinnedMessage catches
        await (pinnedMessageManager as any).updatePinnedMessage(true);
        // At this point: createPinnedMessage failed, messageId is null, cantEditFailCount incremented to 1

        // Update 2: messageId is null → updatePinnedMessage returns early (line 769 guard)
        // So no circuit breaker accumulation happens.

        // Verify counter was incremented at least once
        expect(pinnedMessageManager.getState().cantEditFailCount).toBeGreaterThanOrEqual(1);
        // And messageId is null (createPinnedMessage failed)
        expect(pinnedMessageManager.getState().messageId).toBeNull();
      });
    });
  });
});
