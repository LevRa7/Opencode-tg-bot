import { beforeEach, describe, expect, it, vi } from "vitest";
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
        expect(fakeApi.editMessageText).toHaveBeenCalledWith(
          123,
          777,
          expect.any(String),
          {
            message_thread_id: 10,
          },
        );
        expect(fakeApi.pinChatMessage).not.toHaveBeenCalled();
        expect(pinnedMessageManager.getState().createdInCurrentProcess).toBe(false);
      });
    });

    it("targets the active message thread when creating and refreshing a pinned message", async () => {
      await runWithTelegramConversationScope(scopeA, async () => {
        await pinnedMessageManager.onSessionChange("ses-1", "Test Session");

        expect(fakeApi.sendMessage).toHaveBeenCalledWith(123, expect.any(String), {
          message_thread_id: 10,
        });
        expect(fakeApi.pinChatMessage).toHaveBeenCalledWith(123, 999, {
          disable_notification: true,
        });

        fakeApi.editMessageText.mockClear();

        await pinnedMessageManager.refresh();

        expect(fakeApi.editMessageText).toHaveBeenCalledWith(123, 999, expect.any(String), {
          message_thread_id: 10,
        });
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
});
