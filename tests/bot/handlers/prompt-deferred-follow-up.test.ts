import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  sessionStatusMock: vi.fn(),
  sessionPromptMock: vi.fn(),
  sessionPromptAsyncMock: vi.fn(),
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
  pinnedIsInitializedMock: vi.fn(),
  pinnedInitializeMock: vi.fn(),
  pinnedOnSessionChangeMock: vi.fn(),
  pinnedGetStateMock: vi.fn(),
  pinnedClearMock: vi.fn(),
  pinnedGetContextInfoMock: vi.fn(),
  summarySetSessionMock: vi.fn(),
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
  extractTelegramConversationScopeFromContextMock: vi.fn(),
  getCurrentTelegramConversationScopeMock: vi.fn(),
  resolveTelegramConversationScopeKeyMock: vi.fn(),
  runWithTelegramConversationScopeMock: vi.fn(),
  attachManagerGetScopeForSessionMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
      prompt: mocked.sessionPromptMock,
      promptAsync: mocked.sessionPromptAsyncMock,
      create: vi.fn(),
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
  getCurrentProject: mocked.getCurrentProjectMock,
  setCurrentProject: mocked.setCurrentProjectMock,
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
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
  },
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    setSession: mocked.summarySetSessionMock,
    clearSession: mocked.clearSessionMock,
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
}));

vi.mock("../../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    markBusy: mocked.foregroundMarkBusyMock,
    markIdle: mocked.foregroundMarkIdleMock,
    clearAll: mocked.foregroundClearAllMock,
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
  },
}));

vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    startRun: mocked.assistantStartRunMock,
    clearRun: mocked.assistantClearRunMock,
    clearAll: vi.fn(),
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

import { processUserPrompt, type ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";
import { externalInputSuppression } from "../../../src/external-input/suppression.js";

function createContext(messageThreadId?: number): {
  ctx: Context;
  replyMock: ReturnType<typeof vi.fn>;
} {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 500 });
  const ctx = {
    chat: { id: 777 },
    message: {
      message_id: 123,
      text: "hello",
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

describe("bot/handlers/prompt deferred follow-up", () => {
  beforeEach(() => {
    mocked.sessionStatusMock.mockReset();
    mocked.sessionPromptMock.mockReset();
    mocked.sessionPromptAsyncMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.clearSessionMock.mockReset();
    mocked.ingestSessionInfoForCacheMock.mockReset();
    mocked.getCurrentProjectMock.mockReset();
    mocked.setCurrentProjectMock.mockReset();
    mocked.getStoredAgentMock.mockReset();
    mocked.getStoredModelMock.mockReset();
    mocked.formatVariantForButtonMock.mockReset();
    mocked.createMainKeyboardMock.mockReset();
    mocked.extractMessageThreadIdFromContextMock.mockReset();
    mocked.extractThreadTargetFromContextMock.mockReset();
    mocked.isForumChatMock.mockReset();
    mocked.withMessageThreadIdMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardClearContextMock.mockReset();
    mocked.pinnedIsInitializedMock.mockReset();
    mocked.pinnedInitializeMock.mockReset();
    mocked.pinnedOnSessionChangeMock.mockReset();
    mocked.pinnedGetStateMock.mockReset();
    mocked.pinnedClearMock.mockReset();
    mocked.pinnedGetContextInfoMock.mockReset();
    mocked.summarySetSessionMock.mockReset();
    mocked.summaryClearMock.mockReset();
    mocked.stopEventListeningMock.mockReset();
    mocked.interactionGetSnapshotMock.mockReset();
    mocked.interactionClearMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.safeBackgroundTaskMock.mockReset();
    mocked.formatErrorDetailsMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.tMock.mockReset();
    mocked.foregroundMarkBusyMock.mockReset();
    mocked.foregroundMarkIdleMock.mockReset();
    mocked.foregroundClearAllMock.mockReset();
    mocked.threadBindProjectMock.mockReset();
    mocked.threadBindSessionMock.mockReset();
    mocked.threadClearSessionForActiveContextMock.mockReset();
    mocked.threadGetActiveScopeMock.mockReset();
    mocked.attachSessionForScopeMock.mockReset();
    mocked.getDefaultProjectMock.mockReset();
    mocked.ensureRuntimeMock.mockReset();
    mocked.assistantStartRunMock.mockReset();
    mocked.assistantClearRunMock.mockReset();
    mocked.assistantIsRunActiveMock.mockReset();
    mocked.extractTelegramConversationScopeFromContextMock.mockReset();
    mocked.getCurrentTelegramConversationScopeMock.mockReset();
    mocked.resolveTelegramConversationScopeKeyMock.mockReset();
    mocked.runWithTelegramConversationScopeMock.mockReset();
    mocked.attachManagerGetScopeForSessionMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "/repo", name: "Repo" });
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "s1",
      title: "Session 1",
      directory: "/repo",
    });
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
    mocked.extractTelegramConversationScopeFromContextMock.mockReturnValue(null);
    mocked.getCurrentTelegramConversationScopeMock.mockReturnValue(null);
    mocked.resolveTelegramConversationScopeKeyMock.mockImplementation(
      (scope?: string | null) => scope ?? "global",
    );
    mocked.runWithTelegramConversationScopeMock.mockImplementation(async (_scope, task) => task());
    mocked.attachManagerGetScopeForSessionMock.mockReturnValue(null);
    mocked.isForumChatMock.mockReturnValue(false);
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedGetStateMock.mockReturnValue({ messageId: 55 });
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.sessionStatusMock.mockResolvedValue({ data: { s1: { type: "busy" } }, error: null });
    mocked.sessionPromptMock.mockResolvedValue({ error: null });
    mocked.sessionPromptAsyncMock.mockResolvedValue({ error: null });
    mocked.assistantIsRunActiveMock.mockReturnValue(false);
    mocked.threadGetActiveScopeMock.mockReturnValue(null);
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

    externalInputSuppression.__resetForTests();
  });

  it("keeps the normal busy-session guard for suppressed-send-error prompts", async () => {
    const { ctx, replyMock } = createContext();
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "deferred follow-up", deps, [], {
      suppressSendErrorMessage: true,
    });

    expect(dispatched).toBe(false);
    expect(replyMock).toHaveBeenCalledWith("bot.session_busy");
    expect(mocked.sessionPromptMock).not.toHaveBeenCalled();
  });

  it("does not suppress busy warning for normal prompts", async () => {
    const { ctx, replyMock } = createContext();
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "normal prompt", deps);

    expect(dispatched).toBe(false);
    expect(replyMock).toHaveBeenCalledWith("bot.session_busy");
    expect(mocked.sessionPromptMock).not.toHaveBeenCalled();
  });

  it("does not refresh attachment when prompt is blocked by a busy session", async () => {
    mocked.threadGetActiveScopeMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 30,
    });

    const { ctx, replyMock } = createContext();
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "blocked prompt", deps);

    expect(dispatched).toBe(false);
    expect(replyMock).toHaveBeenCalledWith("bot.session_busy");
    expect(mocked.attachSessionForScopeMock).not.toHaveBeenCalled();
    expect(mocked.sessionPromptMock).not.toHaveBeenCalled();
  });

  it("marks prompt-start busy state for the current request topic instead of a previous attachment", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.extractTelegramConversationScopeFromContextMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 20,
    });
    mocked.threadGetActiveScopeMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 20,
    });
    mocked.attachManagerGetScopeForSessionMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 10,
    });

    const { ctx } = createContext(20);
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "topic switch prompt", deps);

    expect(dispatched).toBe(true);
    expect(mocked.foregroundMarkBusyMock).toHaveBeenCalledWith("s1", {
      userId: 10,
      chatId: 777,
      messageThreadId: 20,
    });
  });

  it("dispatches interactive prompts through the async OpenCode endpoint", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });

    const { ctx } = createContext();
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "normal prompt", deps);

    expect(dispatched).toBe(true);
    expect(mocked.sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
    expect(mocked.sessionPromptMock).not.toHaveBeenCalled();
  });

  it("blocks a new prompt while a local assistant run is still active", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.assistantIsRunActiveMock.mockReturnValue(true);

    const { ctx, replyMock } = createContext();
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "second prompt", deps);

    expect(dispatched).toBe(false);
    expect(replyMock).toHaveBeenCalledWith("bot.session_busy");
    expect(mocked.sessionPromptAsyncMock).not.toHaveBeenCalled();
  });

  it("clears busy state for the actual mismatched session instead of using a broad reset", async () => {
    mocked.getCurrentProjectMock.mockReturnValue({
      id: "p2",
      worktree: "/other-repo",
      name: "Other Repo",
    });
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "s1",
      title: "Session 1",
      directory: "/repo",
    });
    mocked.attachManagerGetScopeForSessionMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 30,
    });

    const { ctx, replyMock } = createContext(20);
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "mismatch prompt", deps);

    expect(dispatched).toBe(false);
    expect(mocked.foregroundMarkIdleMock).toHaveBeenCalledWith("s1", {
      userId: 10,
      chatId: 777,
      messageThreadId: 30,
    });
    expect(mocked.foregroundClearAllMock).not.toHaveBeenCalledWith("session_mismatch_reset");
    expect(mocked.summaryClearMock).not.toHaveBeenCalled();
    expect(replyMock).toHaveBeenCalledWith("bot.session_reset_project_mismatch");
  });

  it("sends prompt dispatch error message for normal text_only prompts", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.sessionPromptAsyncMock.mockRejectedValueOnce(new Error("prompt dispatch failed"));

    const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 901 });
    const deps = {
      bot: {
        api: {
          sendMessage: sendMessageMock,
        },
      } as unknown as ProcessPromptDeps["bot"],
      ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    } satisfies ProcessPromptDeps;
    const { ctx, replyMock } = createContext();

    const dispatched = await processUserPrompt(ctx, "normal prompt", deps);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatched).toBe(true);
    expect(replyMock).not.toHaveBeenCalledWith("bot.prompt_send_error");
    expect(sendMessageMock).toHaveBeenCalledWith(777, "bot.prompt_send_error", undefined);
  });

  it("keeps prompt dispatch error message in the originating topic", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.sessionPromptAsyncMock.mockRejectedValueOnce(new Error("prompt dispatch failed"));

    const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 901 });
    const deps = {
      bot: {
        api: {
          sendMessage: sendMessageMock,
        },
      } as unknown as ProcessPromptDeps["bot"],
      ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    } satisfies ProcessPromptDeps;
    const { ctx } = createContext(42);

    const dispatched = await processUserPrompt(ctx, "topic prompt", deps);
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatched).toBe(true);
    expect(sendMessageMock).toHaveBeenCalledWith(777, "bot.prompt_send_error", {
      message_thread_id: 42,
    });
  });

  it("suppresses prompt dispatch error message only when explicitly requested", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.sessionPromptAsyncMock.mockRejectedValueOnce(new Error("prompt dispatch failed"));

    const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 901 });
    const deps = {
      bot: {
        api: {
          sendMessage: sendMessageMock,
        },
      } as unknown as ProcessPromptDeps["bot"],
      ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    } satisfies ProcessPromptDeps;
    const { ctx } = createContext();

    const dispatched = await processUserPrompt(ctx, "deferred prompt", deps, [], {
      suppressSendErrorMessage: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatched).toBe(true);
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("keeps lifecycle info logging when send error message suppression is enabled", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.sessionPromptAsyncMock.mockRejectedValueOnce(new Error("prompt dispatch failed"));
    mocked.formatErrorDetailsMock.mockReturnValue("formatted details");

    const sendMessageMock = vi.fn().mockResolvedValue({ message_id: 901 });
    const deps = {
      bot: {
        api: {
          sendMessage: sendMessageMock,
        },
      } as unknown as ProcessPromptDeps["bot"],
      ensureEventSubscription: vi.fn().mockResolvedValue(undefined),
    } satisfies ProcessPromptDeps;
    const { ctx } = createContext();

    const dispatched = await processUserPrompt(ctx, "deferred prompt", deps, [], {
      suppressSendErrorMessage: true,
    });
    await Promise.resolve();
    await Promise.resolve();

    expect(dispatched).toBe(true);
    expect(sendMessageMock).not.toHaveBeenCalled();
    expect(mocked.loggerInfoMock.mock.calls).toContainEqual([
      "[Bot] Calling session.promptAsync (fire-and-forget) with agent=builder, fileCount=0...",
    ]);
  });

  it("remembers the synthetic placeholder text for file-only prompts in the active scope", async () => {
    mocked.sessionStatusMock.mockResolvedValueOnce({ data: { s1: { type: "idle" } }, error: null });
    mocked.extractTelegramConversationScopeFromContextMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 42,
    });
    mocked.threadGetActiveScopeMock.mockReturnValue({
      userId: 10,
      chatId: 777,
      messageThreadId: 42,
    });

    const { ctx } = createContext(42);
    const deps = createDeps();

    const dispatched = await processUserPrompt(ctx, "", deps, [
      { type: "file", filename: "report.txt", mime: "text/plain", url: "file:///tmp/report.txt" },
    ]);

    expect(dispatched).toBe(true);
    expect(
      externalInputSuppression.shouldSuppress(
        "s1",
        { userId: 10, chatId: 777, messageThreadId: 42 },
        "See attached file",
      ),
    ).toBe(true);
  });
});
