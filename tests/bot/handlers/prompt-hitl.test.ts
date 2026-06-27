import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  sessionStatusMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionPromptAsyncMock: vi.fn(),
  sessionCreateMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  ingestSessionInfoForCacheMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  setCurrentProjectMock: vi.fn(),
  getStoredAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(),
  formatVariantForButtonMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
  extractMessageThreadIdFromContextMock: vi.fn(),
  extractThreadTargetFromContextMock: vi.fn(),
  isForumChatMock: vi.fn(),
  withMessageThreadIdMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardClearContextMock: vi.fn(),
  keyboardSetSessionModeMock: vi.fn(),
  keyboardGetKeyboardMock: vi.fn(),
  pinnedIsInitializedMock: vi.fn(),
  pinnedInitializeMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedGetStateMock: vi.fn(),
  pinnedClearMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  pinnedRefreshContextLimitMock: vi.fn(),
  summarySetSessionMock: vi.fn(),
  summarySetBotAndChatIdMock: vi.fn(),
  summaryClearMock: vi.fn(),
  stopEventListeningMock: vi.fn(),
  interactionGetSnapshotMock: vi.fn(),
  interactionClearMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  safeBackgroundTaskMock: vi.fn(),
  formatErrorDetailsMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
  tMock: vi.fn(),
  foregroundMarkBusyMock: vi.fn(),
  foregroundMarkIdleMock: vi.fn(),
  foregroundClearAllMock: vi.fn(),
  foregroundIsBusyMock: vi.fn(),
  threadBindProjectMock: vi.fn(),
  threadBindSessionMock: vi.fn(),
  threadClearSessionForActiveContextMock: vi.fn(),
  threadGetActiveScopeMock: vi.fn(),
  attachSessionForScopeMock: vi.fn(),
  getDefaultProjectMock: vi.fn(),
  ensureRuntimeMock: vi.fn(),
  assistantStartRunMock: vi.fn(),
  assistantClearRunMock: vi.fn(),
  assistantIsRunActiveMock: vi.fn(),
  assistantClearAllMock: vi.fn(),
  extractTelegramConversationScopeFromContextMock: vi.fn(),
  getCurrentTelegramConversationScopeMock: vi.fn(),
  resolveTelegramConversationScopeKeyMock: vi.fn(),
  runWithTelegramConversationScopeMock: vi.fn(),
  attachManagerGetScopeForSessionMock: vi.fn(),
  formatReplyTagMock: vi.fn(),
  sshIsActiveMock: vi.fn(),
  setPromptRetryContextMock: vi.fn(),
  externalInputRememberSelfInputMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
      prompt: mocked.sessionPromptMock,
      promptAsync: mocked.sessionPromptAsyncMock,
      create: mocked.sessionCreateMock,
    },
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: mocked.getCurrentSessionMock,
  setCurrentSession: mocked.setCurrentSessionMock,
  clearSession: mocked.clearSessionMock,
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: mocked.ingestSessionInfoForCacheMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw"),
  getCurrentProject: mocked.getCurrentProjectMock,
  setCurrentProject: mocked.setCurrentProjectMock,
  getUserLocale: vi.fn(() => "en"),
  getUserDeployTarget: vi.fn(() => "local"),
  setConversationCurrentProject: vi.fn(),
  clearProject: vi.fn(),
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
  switchToFallbackModel: vi.fn().mockReturnValue(null),
  getRuntimeModelCatalog: vi.fn().mockResolvedValue({ providers: [] }),
  getFallbackModel: vi.fn().mockReturnValue(null),
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/bot/utils/message-thread.js", () => ({
  extractMessageThreadIdFromContext: mocked.extractMessageThreadIdFromContextMock,
  extractThreadTargetFromContext: mocked.extractThreadTargetFromContextMock,
  isForumChat: mocked.isForumChatMock,
  withMessageThreadId: mocked.withMessageThreadIdMock,
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    clearContext: mocked.keyboardClearContextMock,
    setSessionMode: mocked.keyboardSetSessionModeMock,
    getKeyboard: mocked.keyboardGetKeyboardMock,
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: mocked.pinnedIsInitializedMock,
    initialize: mocked.pinnedInitializeMock,
    onSessionChange: mocked.pinnedOnSessionChangeMock,
    getState: mocked.pinnedGetStateMock,
    clear: mocked.pinnedClearMock,
    getContextInfo: mocked.pinnedGetContextInfoMock,
    getContextLimit: vi.fn(() => 100000),
    refreshContextLimit: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.summarySetSessionMock,
    setBotAndChatId: mocked.summarySetBotAndChatIdMock,
    clearSession: vi.fn(),
    clear: mocked.summaryClearMock,
  },
}));

vi.mock("../../../src/opencode/events.js", () => ({
  stopEventListening: mocked.stopEventListeningMock,
}));

vi.mock("../../../src/interaction/manager.js", () => ({
  interactionManager: {
    getSnapshot: mocked.interactionGetSnapshotMock,
    clear: mocked.interactionClearMock,
  },
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

vi.mock("../../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: mocked.safeBackgroundTaskMock,
}));

vi.mock("../../../src/utils/error-format.js", () => ({
  formatErrorDetails: mocked.formatErrorDetailsMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: mocked.tMock,
  normalizeLocale: vi.fn((value: string) => value),
}));

vi.mock("../../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    markBusy: mocked.foregroundMarkBusyMock,
    markIdle: mocked.foregroundMarkIdleMock,
    clearAll: mocked.foregroundClearAllMock,
    isBusy: mocked.foregroundIsBusyMock,
  },
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindProjectToActiveContext: mocked.threadBindProjectMock,
    bindSessionToActiveContext: mocked.threadBindSessionMock,
    clearSessionForActiveContext: mocked.threadClearSessionForActiveContextMock,
    getActiveScope: mocked.threadGetActiveScopeMock,
  },
}));

vi.mock("../../../src/attach/service.js", () => ({
  attachSessionForScope: mocked.attachSessionForScopeMock,
}));

vi.mock("../../../src/attach/manager.js", () => ({
  attachManager: {
    getScopeForSession: mocked.attachManagerGetScopeForSessionMock,
  },
}));

vi.mock("../../../src/project/manager.js", () => ({
  getDefaultProject: mocked.getDefaultProjectMock,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    ensureRuntime: mocked.ensureRuntimeMock,
    setGlobalProgressReporter: vi.fn(),
  },
}));

vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    startRun: mocked.assistantStartRunMock,
    clearRun: mocked.assistantClearRunMock,
    clearAll: mocked.assistantClearAllMock,
    markResponseCompleted: vi.fn(),
    finishRun: vi.fn(() => null),
    getCompletedRun: vi.fn(() => null),
    isRunActive: mocked.assistantIsRunActiveMock,
  },
}));

vi.mock("../../../src/telegram/scope.js", () => ({
  buildTelegramConversationScopeKey: vi.fn(
    (scope: { userId: number; chatId: number; messageThreadId?: number } | null) => {
      if (!scope) return "global";
      return `${scope.userId}:${scope.chatId}:${scope.messageThreadId ?? 0}`;
    },
  ),
  extractTelegramConversationScopeFromContext:
    mocked.extractTelegramConversationScopeFromContextMock,
  getCurrentTelegramConversationScope: mocked.getCurrentTelegramConversationScopeMock,
  resolveTelegramConversationScopeKey: mocked.resolveTelegramConversationScopeKeyMock,
  runWithTelegramConversationScope: mocked.runWithTelegramConversationScopeMock,
}));

vi.mock("../../../src/bot/utils/format-reply-tag.js", () => ({
  formatReplyTag: mocked.formatReplyTagMock,
}));

vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    isSshActive: mocked.sshIsActiveMock,
    isBootstrapInProgress: vi.fn().mockReturnValue(false),
    getActiveConnection: vi.fn().mockReturnValue(null),
  },
}));

vi.mock("../../../src/bot/handlers/prompt-context.js", () => ({
  setPromptRetryContext: mocked.setPromptRetryContextMock,
  deletePromptRetryContext: vi.fn(),
}));

vi.mock("../../../src/external-input/suppression.js", () => ({
  externalInputSuppression: {
    rememberSelfInput: mocked.externalInputRememberSelfInputMock,
    shouldSuppress: vi.fn().mockReturnValue(false),
    __resetForTests: vi.fn(),
  },
}));

import { processUserPrompt, __resetPromptStateForTests, type ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";

function createContext(messageThreadId?: number): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 500 });
  const ctx = {
    chat: { id: 777 },
    from: { id: 10 },
    message: {
      message_id: 123,
      text: "fix the bug",
      ...(typeof messageThreadId === "number" ? { message_thread_id: messageThreadId } : {}),
    },
    reply: replyMock,
    api: {},
  } as unknown as Context;

  return { ctx, replyMock };
}

function createDeps(): ProcessPromptDeps {
  return {
    bot: {
      api: {
        sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
      },
    } as unknown as ProcessPromptDeps["bot"],
    ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
  };
}

const TEST_SESSION = { id: "s1", title: "Session 1", directory: "/repo" };
const TEST_PROJECT = { id: "p1", worktree: "/repo", name: "Repo" };

const BUSY_SCOPE = { userId: 10, chatId: 777, messageThreadId: 42 };

describe("bot/handlers/prompt HITL (human-in-the-loop)", () => {
  beforeEach(() => {
    // Reset all mocks
    for (const key of Object.keys(mocked) as (keyof typeof mocked)[]) {
      (mocked[key] as ReturnType<typeof vi.fn>).mockReset?.();
    }

    // Reset module-level prompt state (claim map, routing contexts, response modes)
    __resetPromptStateForTests();

    // Default healthy setup: session idle, no local run active
    mocked.getCurrentProjectMock.mockReturnValue(TEST_PROJECT);
    mocked.getCurrentSessionMock.mockReturnValue(TEST_SESSION);
    mocked.getStoredAgentMock.mockReturnValue("builder");
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "default",
    });
    mocked.extractThreadTargetFromContextMock.mockImplementation((ctx: Context) => ({
      chatId: 777,
      ...((ctx.message as { message_thread_id?: number } | undefined)?.message_thread_id
        ? { messageThreadId: (ctx.message as { message_thread_id?: number }).message_thread_id }
        : {}),
    }));
    mocked.extractTelegramConversationScopeFromContextMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 42,
    });
    mocked.getCurrentTelegramConversationScopeMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 42,
    });
    mocked.resolveTelegramConversationScopeKeyMock.mockImplementation(
      (scope?: string | null) => scope ?? "global",
    );
    mocked.runWithTelegramConversationScopeMock.mockImplementation(async (_scope, task) => task());
    mocked.attachManagerGetScopeForSessionMock.mockReturnValue(null);
    mocked.isForumChatMock.mockReturnValue(false);
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedGetStateMock.mockReturnValue({ messageId: 55 });
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.formatReplyTagMock.mockReturnValue(null);
    mocked.sshIsActiveMock.mockReturnValue(false);
    mocked.sessionStatusMock.mockResolvedValue({ data: { s1: { type: "idle" } }, error: null });
    mocked.sessionPromptAsyncMock.mockResolvedValue({ error: null });
    mocked.sessionPromptMock.mockResolvedValue({ error: null });
    mocked.sessionCreateMock.mockResolvedValue({ data: TEST_SESSION, error: null });
    mocked.assistantIsRunActiveMock.mockReturnValue(false);
    mocked.threadGetActiveScopeMock.mockReturnValue(BUSY_SCOPE);
    mocked.attachSessionForScopeMock.mockResolvedValue(undefined);
    mocked.tMock.mockImplementation((key: string) => key);
    mocked.withMessageThreadIdMock.mockImplementation(
      (value: unknown, messageThreadId?: number) => {
        if (typeof messageThreadId !== "number" || messageThreadId <= 0) {
          return value;
        }
        return {
          ...(typeof value === "object" && value !== null ? value : {}),
          message_thread_id: messageThreadId,
        };
      },
    );
    mocked.extractMessageThreadIdFromContextMock.mockReturnValue(42);
    mocked.keyboardSetSessionModeMock.mockReturnValue(undefined);
    mocked.keyboardGetKeyboardMock.mockReturnValue({ inline_keyboard: [] });
    mocked.safeBackgroundTaskMock.mockImplementation(
      async ({
        task,
        onSuccess,
        onError,
      }: {
        task: () => Promise<unknown>;
        onSuccess: (result: unknown) => Promise<void>;
        onError?: (error: unknown) => Promise<void>;
      }) => {
        try {
          const result = await task();
          await onSuccess(result);
        } catch (error) {
          if (onError) {
            await onError(error);
          }
        }
      },
    );
    mocked.foregroundIsBusyMock.mockReturnValue(false);
  });

  describe("server reports session busy → dispatches HITL prompt", () => {
    it("calls promptAsync instead of blocking with session_busy", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx, replyMock } = createContext(42);
      const deps = createDeps();

      const dispatched = await processUserPrompt(ctx, "use blue color", deps);

      expect(dispatched).toBe(true);
      // Must NOT block with session_busy
      expect(replyMock).not.toHaveBeenCalledWith("bot.session_busy");
      // Must dispatch promptAsync with the HITL message
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "s1",
          directory: "/repo",
          parts: [{ type: "text", text: "use blue color" }],
        }),
      );
    });

    it("starts a minimal run for HITL to ensure SSE response delivery", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "use green instead", deps);

      // HITL now starts a run + sets routing context so SSE response
      // events have a delivery target instead of being silently dropped.
      expect(mocked.assistantStartRunMock).toHaveBeenCalledTimes(1);
      expect(mocked.assistantStartRunMock).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({
          startedAt: expect.any(Number),
          configuredAgent: "builder",
          configuredProviderID: "openai",
          configuredModelID: "gpt-5.4",
        }),
      );
    });

    it("marks session idle on the correct scope after HITL dispatch", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "add error handling", deps);

      // The session was marked busy then idle — but we clean up via markIdle
      expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("s1", BUSY_SCOPE);
    });

    it("dispatches HITL prompt when both server AND local say busy", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });
      mocked.assistantIsRunActiveMock.mockReturnValue(true);

      const { ctx, replyMock } = createContext(42);
      const deps = createDeps();

      const dispatched = await processUserPrompt(ctx, "actually use dark mode", deps);

      expect(dispatched).toBe(true);
      expect(replyMock).not.toHaveBeenCalledWith("bot.session_busy");
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "s1",
          parts: [{ type: "text", text: "actually use dark mode" }],
        }),
      );
    });

    it("includes file parts in HITL prompt", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx, replyMock } = createContext(42);
      const deps = createDeps();
      const filePart = {
        type: "file" as const,
        filename: "screenshot.png",
        mime: "image/png",
        url: "file:///tmp/screenshot.png",
      };

      const dispatched = await processUserPrompt(ctx, "fix this UI", deps, [filePart]);

      expect(dispatched).toBe(true);
      expect(replyMock).not.toHaveBeenCalledWith("bot.session_busy");
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "s1",
          parts: [
            { type: "text", text: "fix this UI" },
            filePart,
          ],
        }),
      );
    });
  });

  describe("local assistant run active → dispatches HITL prompt", () => {
    it("calls promptAsync when isRunActive returns true", async () => {
      // Server says idle, but local tracker says active
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "idle" } },
        error: null,
      });
      mocked.assistantIsRunActiveMock.mockReturnValue(true);

      const { ctx, replyMock } = createContext(42);
      const deps = createDeps();

      const dispatched = await processUserPrompt(ctx, "rename that function", deps);

      expect(dispatched).toBe(true);
      expect(replyMock).not.toHaveBeenCalledWith("bot.session_busy");
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "s1",
          parts: [{ type: "text", text: "rename that function" }],
        }),
      );
    });

    it("does NOT start a new run or change routing state for local-busy HITL", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "idle" } },
        error: null,
      });
      mocked.assistantIsRunActiveMock.mockReturnValue(true);

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "add a comment here", deps);

      // No new run
      expect(mocked.assistantStartRunMock).not.toHaveBeenCalled();
      // Doesn't set response mode, routing context, etc.
      // Cleanup: marks idle on the correct scope
      expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("s1", BUSY_SCOPE);
    });
  });

  describe("HITL prompt does NOT modify bot-side state", () => {
    it("does not create a new session for HITL dispatch", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "refactor this module", deps);

      // Session create should NOT be called — we reuse the current session
      expect(mocked.sessionCreateMock).not.toHaveBeenCalled();
    });

    it("does not change pinned message state", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "add more tests", deps);

      // pinnedMessageManager.onSessionChange should NOT be called for HITL
      expect(mocked.pinnedOnSessionChangeMock).not.toHaveBeenCalled();
    });

    it("does not call attachSessionForScope for HITL dispatch", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "update the readme", deps);

      // attachSessionForScope should NOT be called — we're not changing the session
      expect(mocked.attachSessionForScopeMock).not.toHaveBeenCalled();
    });

    it("sets routing context for HITL when no local run is active", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "optimize the queries", deps);

      // HITL now sets routing context + run state so the SSE response
      // from the server-injected message can be delivered to the user.
      expect(mocked.assistantStartRunMock).toHaveBeenCalledWith(
        "s1",
        expect.objectContaining({ configuredAgent: "builder" }),
      );
    });
  });

  describe("empty text with files in HITL mode", () => {
    it("dispatches file-only HITL prompt when session is busy", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });

      const { ctx, replyMock } = createContext(42);
      const deps = createDeps();
      const filePart = {
        type: "file" as const,
        filename: "output.log",
        mime: "text/plain",
        url: "file:///tmp/output.log",
      };

      const dispatched = await processUserPrompt(ctx, "", deps, [filePart]);

      expect(dispatched).toBe(true);
      expect(replyMock).not.toHaveBeenCalledWith("bot.session_busy");
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
      expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledWith(
        expect.objectContaining({
          sessionID: "s1",
          parts: [filePart],
        }),
      );
    });
  });

  describe("HITL prompt error handling", () => {
    it("logs error when HITL prompt dispatch fails", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });
      mocked.sessionPromptAsyncMock.mockRejectedValueOnce(new Error("network timeout"));

      const { ctx, replyMock } = createContext(42);
      const deps = createDeps();

      const dispatched = await processUserPrompt(ctx, "use sqlite instead", deps);

      // Still returns true — message was accepted for dispatch
      expect(dispatched).toBe(true);
      // Does NOT send a Telegram error message to user — HITL fires silently
      expect(replyMock).not.toHaveBeenCalledWith("bot.session_busy");
      expect(replyMock).not.toHaveBeenCalledWith("bot.prompt_send_error");
      // Error is logged
      expect(mocked.loggerErrorMock).toHaveBeenCalledWith(
        expect.stringContaining("HITL prompt failed"),
        expect.any(Error),
      );
    });

    it("still marks idle on scope even when HITL dispatch fails", async () => {
      mocked.sessionStatusMock.mockResolvedValueOnce({
        data: { s1: { type: "busy" } },
        error: null,
      });
      mocked.sessionPromptAsyncMock.mockRejectedValueOnce(new Error("dispatch failed"));

      const { ctx } = createContext(42);
      const deps = createDeps();

      await processUserPrompt(ctx, "rollback the change", deps);

      // The markIdle + HITL dispatch happen in the same code path
      expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("s1", BUSY_SCOPE);
    });
  });
});
