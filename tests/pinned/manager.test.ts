import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const mocked = vi.hoisted(() => ({
  opencodeClient: {
    session: { list: vi.fn().mockResolvedValue({ data: [] }) },
    config: { get: vi.fn().mockResolvedValue({ data: {} }) },
  },
  getCurrentSession: vi.fn(),
  getCurrentProject: vi.fn(),
  getPinnedMessageId: vi.fn().mockReturnValue(null),
  setPinnedMessageId: vi.fn(),
  clearPinnedMessageId: vi.fn(),
  getStoredModel: vi.fn().mockReturnValue(null),
  getModelContextLimit: vi.fn().mockResolvedValue(204800),
}));

vi.mock("../../src/opencode/client.js", () => ({ opencodeClient: mocked.opencodeClient }));
vi.mock("../../src/session/manager.js", () => ({ getCurrentSession: mocked.getCurrentSession }));
vi.mock("../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  getCurrentProject: mocked.getCurrentProject,
  getPinnedMessageId: mocked.getPinnedMessageId,
  setPinnedMessageId: mocked.setPinnedMessageId,
  clearPinnedMessageId: mocked.clearPinnedMessageId,
}));
vi.mock("../../src/model/manager.js", () => ({ getStoredModel: mocked.getStoredModel }));
vi.mock("../../src/model/context-limit.js", () => ({
  getModelContextLimit: mocked.getModelContextLimit,
}));
vi.mock("../../src/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/i18n/index.js")>();
  return { ...actual, t: (key: string) => key };
});
vi.mock("../../src/pinned/format.js", () => ({
  DEFAULT_CONTEXT_LIMIT: 204800,
  formatContextLine: (used: number, limit: number) => `${used}/${limit}`,
  formatCostLine: (cost: number) => `$${cost.toFixed(2)}`,
  formatModelDisplayName: () => "test-model",
}));

// Must import AFTER vi.mock calls
const { __resetPinnedMessageManagersForTests, pinnedMessageManager } = await import(
  "../../src/pinned/manager.js"
);

describe("pinned/manager", () => {
  const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
  const scopeB: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 11 };
  let fakeApi: {
    sendMessage: ReturnType<typeof vi.fn>;
    editMessageText: ReturnType<typeof vi.fn>;
    pinChatMessage: ReturnType<typeof vi.fn>;
    unpinAllChatMessages: ReturnType<typeof vi.fn>;
    deleteMessage: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    __resetPinnedMessageManagersForTests();
    fakeApi = {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      editMessageText: vi.fn().mockResolvedValue(undefined),
      pinChatMessage: vi.fn().mockResolvedValue(undefined),
      unpinAllChatMessages: vi.fn().mockResolvedValue(undefined),
      deleteMessage: vi.fn().mockResolvedValue(undefined),
    };

    mocked.getCurrentSession.mockReturnValue({ id: "ses-1", title: "Test Session" });
    mocked.getCurrentProject.mockReturnValue({ id: "p1", worktree: "D:/repo", name: "repo" });
    mocked.getStoredModel.mockReturnValue({ providerID: "openai", modelID: "gpt-5" });
    mocked.getModelContextLimit.mockResolvedValue(204800);
    mocked.getPinnedMessageId.mockReturnValue(null);

    runWithTelegramConversationScope(scopeA, () => {
      pinnedMessageManager.initialize(fakeApi as never, 123);
    });
  });

  describe("updateTokensSilent", () => {
    it("updates tokensUsed in memory without triggering API call", () => {
      runWithTelegramConversationScope(scopeA, () => {
        pinnedMessageManager.updateTokensSilent({
          input: 5000,
          output: 200,
          reasoning: 0,
          cacheRead: 1000,
          cacheWrite: 0,
        });

        const contextInfo = pinnedMessageManager.getContextInfo();
        expect(contextInfo).toBeNull();
        expect(fakeApi.editMessageText).not.toHaveBeenCalled();
        expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      });
    });

    it("accumulates token updates correctly", () => {
      runWithTelegramConversationScope(scopeA, () => {
        pinnedMessageManager.updateTokensSilent({
          input: 500,
          output: 100,
          reasoning: 0,
          cacheRead: 100,
          cacheWrite: 0,
        });

        pinnedMessageManager.updateTokensSilent({
          input: 5000,
          output: 200,
          reasoning: 0,
          cacheRead: 1000,
          cacheWrite: 0,
        });

        expect(fakeApi.editMessageText).not.toHaveBeenCalled();
      });
    });
  });

  describe("refresh", () => {
    it("calls editMessageText to push current state to Telegram", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
        pinnedMessageManager.updateTokensSilent({
          input: 2000,
          output: 100,
          reasoning: 0,
          cacheRead: 500,
          cacheWrite: 0,
        });

        fakeApi.editMessageText.mockClear();

        await pinnedMessageManager.refresh();

        expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      });
    });

    it("does not throw when no pinned message exists", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await expect(pinnedMessageManager.refresh()).resolves.not.toThrow();
      });
    });

    it("reuses the scoped startup pinned message without pinning again", async () => {
      __resetPinnedMessageManagersForTests();
      mocked.getPinnedMessageId.mockReturnValue(777);

      await runWithTelegramConversationScope(scopeA, async () => {
        pinnedMessageManager.initialize(fakeApi as never, 123);

        expect(pinnedMessageManager.getState().messageId).toBe(777);
        expect(pinnedMessageManager.getState().createdInCurrentProcess).toBe(false);

        await pinnedMessageManager.refresh();

        expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
        // message_thread_id must NOT be passed to editMessageText. Only
        // 3 positional args: chatId, messageId, text.
        const callArgs = fakeApi.editMessageText.mock.calls[0];
        expect(callArgs).toHaveLength(3);
        expect(callArgs[3]).toBeUndefined();
        expect(fakeApi.pinChatMessage).not.toHaveBeenCalled();
        expect(pinnedMessageManager.getState().createdInCurrentProcess).toBe(false);
      });
    });

    it("creates and pins a message in a topic, then successfully edits it", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        // 1. Create — sendMessage carries thread_id so the message lands in the topic.
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
        expect(fakeApi.sendMessage).toHaveBeenCalledWith(123, expect.any(String), {
          message_thread_id: 10,
        });
        expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 999, {
          disable_notification: true,
        });

        fakeApi.editMessageText.mockClear();

        // 2. Edit — must NOT pass message_thread_id; it's already in the topic via sendMessage.
        await pinnedMessageManager.refresh();
        let callArgs = fakeApi.editMessageText.mock.calls[0];
        expect(callArgs).toHaveLength(3);
        expect(callArgs[3]).toBeUndefined();

        // 3. Subsequent edits (e.g. token updates) also exclude thread_id.
        fakeApi.editMessageText.mockClear();
        pinnedMessageManager.updateTokensSilent({ input: 100, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 });
        await pinnedMessageManager.refresh();
        callArgs = fakeApi.editMessageText.mock.calls[0];
        expect(callArgs).toHaveLength(3);
        expect(callArgs[3]).toBeUndefined();
      });
    });

    it("does NOT pass message_thread_id to editMessageText when not in a topic", async () => {
      const noTopicScope: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 0 };
      await runWithTelegramConversationScope(noTopicScope, async () => {
        pinnedMessageManager.initialize(fakeApi as never, 123);
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

        fakeApi.editMessageText.mockClear();
        await pinnedMessageManager.refresh();

        // No thread → only 3 positional args, no 4th param at all.
        const callArgs = fakeApi.editMessageText.mock.calls[0];
        expect(callArgs).toHaveLength(3);
        expect(callArgs[3]).toBeUndefined();
      });
    });
  });

  describe("setOnKeyboardUpdate race condition fix", () => {
    it("fires callback immediately with current state when contextLimit is known", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

        const callback = vi.fn();
        pinnedMessageManager.setOnKeyboardUpdate(callback);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(0, 204800);
      });
    });

    it("fires callback with updated tokens after silent update", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

        pinnedMessageManager.updateTokensSilent({
          input: 3000,
          output: 100,
          reasoning: 0,
          cacheRead: 500,
          cacheWrite: 0,
        });

        const callback = vi.fn();
        pinnedMessageManager.setOnKeyboardUpdate(callback);

        expect(callback).toHaveBeenCalledTimes(1);
        expect(callback).toHaveBeenCalledWith(3500, 204800);
      });
    });

    it("keeps pinned state isolated between topics", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-a", "Session A");
      });

      await runWithTelegramConversationScope(scopeB, async () => {
        pinnedMessageManager.initialize(fakeApi as never, 123);
        await pinnedMessageManager.onSessionChange("ses-b", "Session B");
      });

      expect(
        runWithTelegramConversationScope(scopeA, () => pinnedMessageManager.getState().sessionId),
      ).toBe("ses-a");
      expect(
        runWithTelegramConversationScope(scopeB, () => pinnedMessageManager.getState().sessionId),
      ).toBe("ses-b");
    });

    it("does not clear unrelated chat pins when replacing a topic-scoped pinned message", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-a", "Session A");
      });

      fakeApi.unpinAllChatMessages.mockClear();
      fakeApi.sendMessage.mockClear();

      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-next", "Session Next");
      });

      expect(fakeApi.unpinAllChatMessages).not.toHaveBeenCalled();
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
    });
  });

  describe("editMessageText params", () => {
    it("does NOT include message_thread_id in editMessageText params even in a forum topic", async () => {
      const topicScope: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 42 };
      await runWithTelegramConversationScope(topicScope, async () => {
        pinnedMessageManager.initialize(fakeApi as never, 123);
        await pinnedMessageManager.onSessionChange("ses-topic", "Topic Session");

        fakeApi.editMessageText.mockClear();
        await pinnedMessageManager.refresh();

        expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
        const callArgs = fakeApi.editMessageText.mock.calls[0];
        // Fourth argument must be undefined (not { message_thread_id: ... })
        expect(callArgs[3]).toBeUndefined();
      });
    });
  });

  // The pinned message is created+pinned once after a prompt, then edited in
  // place at most once every 5s (leading + trailing throttle) instead of editing
  // on every event. Explicit refreshes bypass the throttle. New messages are
  // never sent on updates. Uses fake timers to drive the 5s window.
  describe("edit throttle (5s)", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    const fullTokens = (input: number) => ({
      input,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });

    it("does not edit within 5s of the last edit, then applies one trailing edit", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
        fakeApi.editMessageText.mockClear();

        // Two rapid automatic updates inside the 5s window.
        await pinnedMessageManager.onMessageComplete(fullTokens(1000));
        await pinnedMessageManager.onCostUpdate(0.5);

        // No immediate edit — throttled.
        expect(fakeApi.editMessageText).not.toHaveBeenCalled();

        // After the window closes, exactly one trailing edit with the latest state.
        await vi.advanceTimersByTimeAsync(5000);
        expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      });
    });

    it("edits immediately when >= 5s elapsed since the last edit (leading edge)", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
        fakeApi.editMessageText.mockClear();

        await vi.advanceTimersByTimeAsync(5000); // 5s since creation

        await pinnedMessageManager.onMessageComplete(fullTokens(2000));
        expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      });
    });

    it("never sends a new message on throttled updates — only edits", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
        fakeApi.sendMessage.mockClear();

        await pinnedMessageManager.onCostUpdate(0.5);
        await vi.advanceTimersByTimeAsync(5000);
        await pinnedMessageManager.onCostUpdate(0.7);
        await vi.advanceTimersByTimeAsync(5000);

        expect(fakeApi.sendMessage).not.toHaveBeenCalled();
      });
    });

    it("lets an explicit refresh bypass the throttle and edit immediately", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
        pinnedMessageManager.updateTokensSilent(fullTokens(1000));
        fakeApi.editMessageText.mockClear();

        // Within the 5s window, but forceUpdate must edit right away.
        await pinnedMessageManager.refresh();
        expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("error recovery", () => {
    const fullTokens = (input: number) => ({
      input,
      output: 0,
      reasoning: 0,
      cacheRead: 0,
      cacheWrite: 0,
    });

    it('recreates pinned message when stale message fails with "message can\'t be edited"', async () => {
      // Simulate stale messageId loaded from SQLite — a message that was
      // already deleted/unpinned by a prior process.
      __resetPinnedMessageManagersForTests();
      mocked.getPinnedMessageId.mockReturnValue(33041); // stale id

      // Make editMessageText throw "message can't be edited".
      fakeApi.editMessageText = vi
        .fn()
        .mockRejectedValue(new Error("400: Bad Request: message can't be edited"));

      await runWithTelegramConversationScope(scopeA, async () => {
        pinnedMessageManager.initialize(fakeApi as never, 123);

        expect(pinnedMessageManager.getState().messageId).toBe(33041);
        expect(pinnedMessageManager.getState().createdInCurrentProcess).toBe(false);

        // Direct edit attempt on the stale ID (simulates an SSE event arriving
        // before onSessionChange, e.g. session.diff).
        await pinnedMessageManager.onCostUpdate(0.42);
      });

      // Old message was cleaned up so we don't leave duplicates.
      expect(fakeApi.deleteMessage).toHaveBeenCalledWith(123, 33041);
      // A new message was created+pinned to replace the stale one.
      expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
      expect(fakeApi.pinChatMessage).toHaveBeenCalledTimes(1);
    });

    it('recreates when current-process message fails with "message can\'t be edited" (with circuit breaker)', async () => {
      vi.useFakeTimers();
      try {
        // Message was created by THIS process — "can't be edited" means
        // something is wrong (e.g. API quirk). Recreate rather than log-spam.
        // Circuit breaker: stop recreating after 3 consecutive failures.
        // Use refresh() which bypasses the edit throttle for deterministic
        // immediate flushes.
        await runWithTelegramConversationScope(scopeA, async () => {
          // sendMessage returns incrementing IDs so each recreate produces a
          // distinct messageId (real Telegram API always returns unique IDs).
          let nextMessageId = 1001;
          fakeApi.sendMessage = vi
            .fn()
            .mockImplementation(async () => ({ message_id: nextMessageId++ }));

          await pinnedMessageManager.onSessionChange("ses-1", "Test Session");
          expect(pinnedMessageManager.getState().createdInCurrentProcess).toBe(true);

          const originalMessageId = pinnedMessageManager.getState().messageId;

          // Make every subsequent edit throw.
          fakeApi.editMessageText = vi
            .fn()
            .mockRejectedValue(new Error("400: Bad Request: message can't be edited"));

          // First failure — should recreate with a new messageId.
          fakeApi.sendMessage.mockClear();
          await pinnedMessageManager.refresh();
          expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);
          const newMessageId = pinnedMessageManager.getState().messageId;
          expect(newMessageId).not.toBe(originalMessageId);

          // Second failure — still recreates (counter: 1 → 2).
          fakeApi.sendMessage.mockClear();
          await pinnedMessageManager.refresh();
          expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);

          // Third failure — still recreates (counter: 2 → 3, NOT yet >= 3).
          fakeApi.sendMessage.mockClear();
          await pinnedMessageManager.refresh();
          expect(fakeApi.sendMessage).toHaveBeenCalledTimes(1);

          const messageIdAfterThreshold = pinnedMessageManager.getState().messageId;

          // Fourth attempt — circuit breaker open (counter = 3 >= 3).
          fakeApi.editMessageText.mockClear();
          fakeApi.sendMessage.mockClear();
          await pinnedMessageManager.refresh();

          // No edit attempt (circuit breaker blocks flush entirely).
          expect(fakeApi.editMessageText).not.toHaveBeenCalled();
          expect(fakeApi.sendMessage).not.toHaveBeenCalled();
          expect(pinnedMessageManager.getState().messageId).toBe(messageIdAfterThreshold);
        });
      } finally {
        vi.useRealTimers();
      }
    });

    it("throttles even on unknown errors to prevent edit avalanches", async () => {
      vi.useFakeTimers();
      try {
        await runWithTelegramConversationScope(scopeA, async () => {
          await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

          // Make every edit throw a transient network error.
          fakeApi.editMessageText = vi
            .fn()
            .mockRejectedValue(new Error("ETIMEDOUT: connect"));

          // First update triggers the leading-edge edit (5s throttle window
          // starts), which fails. Without the fix, lastUpdated stays at 0 and
          // the next event would trigger another immediate edit + error.
          await pinnedMessageManager.onCostUpdate(0.5);

          // Second cost update inside the same throttle window must NOT trigger
          // another editMessageText call — the failed edit already ran, and
          // lastUpdated was set to now, so the throttle should coalesce.
          fakeApi.editMessageText.mockClear();
          await pinnedMessageManager.onCostUpdate(0.7);

          // No additional edit call inside the window.
          expect(fakeApi.editMessageText).not.toHaveBeenCalled();

          // After the window, the coalesced trailing update fires.
          await vi.advanceTimersByTimeAsync(5000);
          // A trailing edit fires (and fails again, but doesn't crash).
          expect(fakeApi.editMessageText).toHaveBeenCalledTimes(1);
        });
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
