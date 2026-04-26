import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  sessionStatusMock: vi.fn(),
  sessionPromptMock: vi.fn(),
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
  getDefaultProjectMock: vi.fn(),
  ensureRuntimeMock: vi.fn(),
  assistantStartRunMock: vi.fn(),
  assistantClearRunMock: vi.fn(),
  extractTelegramConversationScopeFromContextMock: vi.fn(),
  resolveTelegramConversationScopeKeyMock: vi.fn(),
  runWithTelegramConversationScopeMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      status: mocked.sessionStatusMock,
      prompt: mocked.sessionPromptMock,
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
    startRun: vi.fn(),
    clearRun: vi.fn(),
    clearAll: vi.fn(),
    markResponseCompleted: vi.fn(),
    finishRun: vi.fn(() => null),
    getCompletedRun: vi.fn(() => null),
    isRunActive: vi.fn(() => false),
  },
}));

vi.mock("../../../src/telegram/scope.js", () => ({
  extractTelegramConversationScopeFromContext: mocked.extractTelegramConversationScopeFromContextMock,
  resolveTelegramConversationScopeKey: mocked.resolveTelegramConversationScopeKeyMock,
  runWithTelegramConversationScope: mocked.runWithTelegramConversationScopeMock,
}));

import { processUserPrompt, type ProcessPromptDeps } from "../../../src/bot/handlers/prompt.js";

function createContext(): { ctx: Context; replyMock: ReturnType<typeof vi.fn> } {
  const replyMock = vi.fn().mockResolvedValue({ message_id: 500 });
  const ctx = {
    chat: { id: 777 },
    message: { message_id: 123, text: "hello" },
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
    mocked.getDefaultProjectMock.mockReset();
    mocked.ensureRuntimeMock.mockReset();
    mocked.assistantStartRunMock.mockReset();
    mocked.assistantClearRunMock.mockReset();
    mocked.extractTelegramConversationScopeFromContextMock.mockReset();
    mocked.resolveTelegramConversationScopeKeyMock.mockReset();
    mocked.runWithTelegramConversationScopeMock.mockReset();

    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "/repo", name: "Repo" });
    mocked.getCurrentSessionMock.mockReturnValue({ id: "s1", title: "Session 1", directory: "/repo" });
    mocked.getStoredAgentMock.mockReturnValue("builder");
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5.4",
      variant: "default",
    });
    mocked.extractThreadTargetFromContextMock.mockReturnValue({ chatId: 777 });
    mocked.extractTelegramConversationScopeFromContextMock.mockReturnValue(null);
    mocked.resolveTelegramConversationScopeKeyMock.mockImplementation((scope?: string | null) => scope ?? "global");
    mocked.pinnedIsInitializedMock.mockReturnValue(true);
    mocked.pinnedGetStateMock.mockReturnValue({ messageId: 55 });
    mocked.pinnedGetContextInfoMock.mockReturnValue(null);
    mocked.sessionStatusMock.mockResolvedValue({ data: { s1: { type: "busy" } }, error: null });
    mocked.sessionPromptMock.mockResolvedValue({ error: null });
    mocked.tMock.mockImplementation((key: string) => key);
    mocked.withMessageThreadIdMock.mockImplementation((value: unknown) => value);
    mocked.safeBackgroundTaskMock.mockImplementation(async ({ task, onSuccess }: {
      task: () => Promise<unknown>;
      onSuccess: (result: unknown) => Promise<void>;
      onError?: (error: unknown) => Promise<void>;
    }) => {
      const result = await task();
      await onSuccess(result);
    });
  });

  it("keeps the normal busy-session guard for silent prompts", async () => {
    const { ctx, replyMock } = createContext();
    const deps = createDeps();

    const dispatched = await processUserPrompt(
      ctx,
      "deferred follow-up",
      deps,
      [],
      { silent: true },
    );

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
});
