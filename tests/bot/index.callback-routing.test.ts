import { beforeEach, describe, expect, it, vi } from "vitest";

const onHandlers: Array<{ event: string | string[]; handler: (...args: any[]) => any }> = [];
const useHandlers: Array<(...args: any[]) => any> = [];

const handleInlineMenuCancelMock = vi.hoisted(() => vi.fn(async () => false));
const handleSessionSelectMock = vi.hoisted(() => vi.fn(async () => false));
const handleProjectSelectMock = vi.hoisted(() => vi.fn(async () => false));
const handleQuestionCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const handleAccessApprovalCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const handlePermissionCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const handleAgentSelectMock = vi.hoisted(() => vi.fn(async () => false));
const handleModelSelectMock = vi.hoisted(() => vi.fn(async () => false));
const handleVariantSelectMock = vi.hoisted(() => vi.fn(async () => false));
const handleCompactConfirmMock = vi.hoisted(() => vi.fn(async () => false));
const handleTaskCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const handleTaskListCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const handleRenameCancelMock = vi.hoisted(() => vi.fn(async () => false));
const handleCommandsCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const handleSettingsCallbackMock = vi.hoisted(() => vi.fn(async () => false));
const syncAuthorizedChatCommandsMock = vi.hoisted(() => vi.fn(async () => undefined));
const getApprovedTelegramUserIdsMock = vi.hoisted(() => vi.fn(() => [1]));
const getUserLocaleMock = vi.hoisted(() => vi.fn(() => undefined));
const setUserLocaleResolverMock = vi.hoisted(() => vi.fn());
const attachTargetBySessionId = vi.hoisted(() => new Map<string, { chatId: number; messageThreadId?: number }>());
const attachScopeBySessionId = vi.hoisted(
  () => new Map<string, { userId: number; chatId: number; messageThreadId?: number }>(),
);
const capturedEventCallbacksByDirectory = vi.hoisted(
  () => new Map<string, Array<(event: any) => void>>(),
);
const summaryCallbacks = vi.hoisted(() => ({
  onQuestion: undefined as
    | undefined
    | ((sessionId: string, questions: Array<Record<string, unknown>>, requestID: string) => Promise<void> | void),
}));
const sendMessageWithMarkdownFallbackMock = vi.hoisted(() =>
  vi.fn(async ({ messageThreadId }: { messageThreadId?: number }) => ({
    message_id: typeof messageThreadId === "number" ? messageThreadId : 1,
  })),
);
const processUserPromptMock = vi.hoisted(() => vi.fn(async () => true));

vi.mock("grammy", () => {
  class FakeBot {
    public readonly api = {
      config: {
        use: vi.fn(),
      },
      setMyCommands: vi.fn().mockResolvedValue(true),
      deleteMessage: vi.fn().mockResolvedValue(true),
      sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
      editMessageText: vi.fn().mockResolvedValue(true),
      sendChatAction: vi.fn().mockResolvedValue(true),
      sendDocument: vi.fn().mockResolvedValue({ message_id: 2 }),
      sendPhoto: vi.fn().mockResolvedValue({ message_id: 3 }),
      sendAudio: vi.fn().mockResolvedValue({ message_id: 4 }),
      sendVideo: vi.fn().mockResolvedValue({ message_id: 5 }),
      sendMessageDraft: vi.fn().mockResolvedValue(true),
    };

    public readonly onHandlers = onHandlers;

    constructor(
      public readonly token: string,
      public readonly options?: Record<string, unknown>,
    ) {}

    use(_handler: (...args: any[]) => any): this {
      useHandlers.push(_handler);
      return this;
    }

    command(_command: string, _handler: (...args: any[]) => any): this {
      return this;
    }

    hears(_pattern: RegExp, _handler: (...args: any[]) => any): this {
      return this;
    }

    on(event: string | string[], handler: (...args: any[]) => any): this {
      this.onHandlers.push({ event, handler });
      return this;
    }

    catch(_handler: (...args: any[]) => any): this {
      return this;
    }
  }

  class FakeInputFile {
    constructor(public readonly path: string) {}
  }

  return {
    Bot: FakeBot,
    InputFile: FakeInputFile,
  };
});

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: {
      token: "test-token",
      adminUserId: 1,
      allowedUserIds: [1],
      proxyUrl: "",
    },
    bot: {
      responseStreamThrottleMs: 0,
      serviceMessagesIntervalSec: 0,
      hideToolCallMessages: false,
      hideThinkingMessages: true,
      bashToolDisplayMaxLength: 120,
      messageFormatMode: "raw",
    },
    files: {
      maxFileSizeKb: 1024,
      maxFileLines: 400,
    },
  },
}));

vi.mock("../../src/bot/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (_ctx, next) => await next()),
  handleAccessApprovalCallback: handleAccessApprovalCallbackMock,
}));

vi.mock("../../src/bot/commands/sessions.js", () => ({
  sessionsCommand: vi.fn(),
  handleSessionSelect: handleSessionSelectMock,
}));

vi.mock("../../src/bot/commands/projects.js", () => ({
  projectsCommand: vi.fn(),
  handleProjectSelect: handleProjectSelectMock,
}));

vi.mock("../../src/bot/handlers/question.js", () => ({
  handleQuestionCallback: handleQuestionCallbackMock,
  showCurrentQuestion: vi.fn(async () => undefined),
  handleQuestionTextAnswer: vi.fn(async () => undefined),
}));

vi.mock("../../src/bot/handlers/permission.js", () => ({
  handlePermissionCallback: handlePermissionCallbackMock,
  showPermissionRequest: vi.fn(async () => undefined),
}));

vi.mock("../../src/bot/handlers/agent.js", () => ({
  handleAgentSelect: handleAgentSelectMock,
  showAgentSelectionMenu: vi.fn(async () => undefined),
}));

vi.mock("../../src/bot/handlers/model.js", () => ({
  handleModelSelect: handleModelSelectMock,
  showModelSelectionMenu: vi.fn(async () => undefined),
}));

vi.mock("../../src/bot/handlers/variant.js", () => ({
  handleVariantSelect: handleVariantSelectMock,
  showVariantSelectionMenu: vi.fn(async () => undefined),
}));

vi.mock("../../src/bot/handlers/context.js", () => ({
  handleContextButtonPress: vi.fn(async () => undefined),
  handleCompactConfirm: handleCompactConfirmMock,
}));

vi.mock("../../src/bot/handlers/inline-menu.js", () => ({
  handleInlineMenuCancel: handleInlineMenuCancelMock,
}));

vi.mock("../../src/bot/commands/task.js", () => ({
  taskCommand: vi.fn(),
  handleTaskCallback: handleTaskCallbackMock,
  handleTaskTextInput: vi.fn(async () => false),
}));

vi.mock("../../src/bot/commands/tasklist.js", () => ({
  taskListCommand: vi.fn(),
  handleTaskListCallback: handleTaskListCallbackMock,
}));

vi.mock("../../src/bot/commands/rename.js", () => ({
  renameCommand: vi.fn(),
  handleRenameCancel: handleRenameCancelMock,
  handleRenameTextAnswer: vi.fn(async () => false),
}));

vi.mock("../../src/bot/commands/commands.js", () => ({
  commandsCommand: vi.fn(),
  handleCommandsCallback: handleCommandsCallbackMock,
  handleCommandTextArguments: vi.fn(async () => false),
}));

vi.mock("../../src/bot/commands/settings.js", () => ({
  settingsCommand: vi.fn(),
  handleSettingsCallback: handleSettingsCallbackMock,
}));

vi.mock("../../src/bot/commands/start.js", () => ({ startCommand: vi.fn() }));
vi.mock("../../src/bot/commands/help.js", () => ({ helpCommand: vi.fn() }));
vi.mock("../../src/bot/commands/status.js", () => ({ statusCommand: vi.fn() }));
vi.mock("../../src/bot/commands/restart.js", () => ({ restartCommand: vi.fn() }));
vi.mock("../../src/bot/commands/new.js", () => ({ newCommand: vi.fn() }));
vi.mock("../../src/bot/commands/abort.js", () => ({ abortCommand: vi.fn() }));
vi.mock("../../src/bot/commands/opencode-start.js", () => ({ opencodeStartCommand: vi.fn() }));
vi.mock("../../src/bot/commands/opencode-stop.js", () => ({ opencodeStopCommand: vi.fn() }));
vi.mock("../../src/bot/commands/stream.js", () => ({ streamCommand: vi.fn() }));
vi.mock("../../src/bot/commands/tts.js", () => ({ ttsCommand: vi.fn() }));

vi.mock("../../src/bot/middleware/interaction-guard.js", () => ({
  interactionGuardMiddleware: vi.fn(async (_ctx, next) => await next()),
}));

vi.mock("../../src/bot/middleware/unknown-command.js", () => ({
  unknownCommandMiddleware: vi.fn(async (_ctx, next) => await next()),
}));

vi.mock("../../src/bot/utils/command-sync.js", () => ({
  syncAuthorizedChatCommands: syncAuthorizedChatCommandsMock,
}));

vi.mock("../../src/question/manager.js", () => ({
  questionManager: {
    isActive: vi.fn(() => false),
    getMessageIds: vi.fn(() => []),
    startQuestions: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/interaction/manager.js", () => ({
  interactionManager: {
    getSnapshot: vi.fn(() => null),
    isExpired: vi.fn(() => false),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    isInitialized: vi.fn(() => false),
    getKeyboard: vi.fn(() => undefined),
    updateContext: vi.fn(),
    clearContext: vi.fn(),
  },
}));

vi.mock("../../src/opencode/events.js", () => ({
  subscribeToEvents: vi.fn(async (directory: string, callback: (event: any) => void) => {
    const callbacks = capturedEventCallbacksByDirectory.get(directory) ?? [];
    callbacks.push(callback);
    capturedEventCallbacksByDirectory.set(directory, callbacks);
  }),
  stopEventListening: vi.fn(),
}));

vi.mock("../../src/attach/manager.js", () => ({
  attachManager: {
    getTargetForSession: vi.fn((sessionId: string) => attachTargetBySessionId.get(sessionId) ?? null),
    getScopeForSession: vi.fn((sessionId: string) => attachScopeBySessionId.get(sessionId) ?? null),
  },
}));

vi.mock("../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    clear: vi.fn(),
    setTypingIndicatorEnabled: vi.fn(),
    setSessionDirectoryResolver: vi.fn(),
    setOnCleared: vi.fn(),
    setOnPartial: vi.fn(),
    setOnComplete: vi.fn(),
    setOnSessionIdle: vi.fn(),
    setOnTool: vi.fn(),
    setOnSubagent: vi.fn(),
    setOnToolFile: vi.fn(),
    setOnQuestion: vi.fn((callback: typeof summaryCallbacks.onQuestion) => {
      summaryCallbacks.onQuestion = callback;
    }),
    setOnQuestionError: vi.fn(),
    setOnPermission: vi.fn(),
    setOnThinking: vi.fn(),
    setOnTokens: vi.fn(),
    setOnCost: vi.fn(),
    setOnSessionCompacted: vi.fn(),
    setOnSessionError: vi.fn(),
    setOnSessionRetry: vi.fn(),
    setOnSessionDiff: vi.fn(),
    setOnFileChange: vi.fn(),
    processEvent: vi.fn(),
    setSession: vi.fn(),
  },
}));

vi.mock("../../src/summary/formatter.js", () => ({
  formatSummary: vi.fn(() => []),
  formatSummaryWithMode: vi.fn(() => []),
  formatToolInfo: vi.fn(() => ""),
  getAssistantParseMode: vi.fn(() => "MarkdownV2"),
}));

vi.mock("../../src/summary/subagent-formatter.js", () => ({
  renderSubagentCards: vi.fn(async () => ""),
}));

vi.mock("../../src/bot/utils/assistant-rendering.js", () => ({
  createPlainRenderedParts: vi.fn((text: string) => [{ text, fallbackText: text }]),
  prepareAssistantFinalStreamingPayload: vi.fn(() => null),
  prepareAssistantStreamingPayload: vi.fn(() => null),
  renderAssistantFinalPartsSafe: vi.fn((text: string) => [{ text, fallbackText: text }]),
}));

vi.mock("../../src/summary/tool-message-batcher.js", () => ({
  ToolMessageBatcher: class {
    flushSession = vi.fn(async () => undefined);
    enqueueFile = vi.fn();
    clearSession = vi.fn();
    clearAll = vi.fn();
  },
}));

vi.mock("../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn(async () => undefined),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock("../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: ({ task, onSuccess, onError }: any) => {
    void Promise.resolve()
      .then(task)
      .then((result) => onSuccess?.(result))
      .catch((error) => onError?.(error));
  },
}));

vi.mock("../../src/utils/telegram-rate-limit-retry.js", () => ({
  withTelegramRateLimitRetry: vi.fn(async (fn: () => Promise<unknown>) => await fn()),
}));

vi.mock("../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: vi.fn(() => false),
    initialize: vi.fn(),
    refresh: vi.fn(),
    getState: vi.fn(() => ({ messageId: null })),
    getContextLimit: vi.fn(() => 0),
    updateTokensSilent: vi.fn(),
    setOnKeyboardUpdate: vi.fn(),
    addFileChange: vi.fn(),
    onSessionChange: vi.fn(),
    onMessageComplete: vi.fn(),
    onCostUpdate: vi.fn(),
    onSessionDiff: vi.fn(),
    onSessionCompacted: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/i18n/index.js", () => ({
  t: vi.fn((key: string) => key),
  setUserLocaleResolver: setUserLocaleResolverMock,
}));

vi.mock("../../src/bot/handlers/prompt.js", () => ({
  clearPromptResponseMode: vi.fn(),
  clearPromptRouting: vi.fn(),
  getPromptRoutingContext: vi.fn(() => null),
  processUserPrompt: processUserPromptMock,
}));

vi.mock("../../src/bot/handlers/voice.js", () => ({
  handleVoiceMessage: vi.fn(async () => false),
}));
vi.mock("../../src/bot/handlers/document.js", () => ({
  handleDocumentMessage: vi.fn(async () => false),
}));
vi.mock("../../src/bot/handlers/video.js", () => ({
  handleVideoMessage: vi.fn(async () => false),
}));
vi.mock("../../src/bot/utils/file-download.js", () => ({
  downloadTelegramFile: vi.fn(async () => undefined),
  toDataUri: vi.fn(() => ""),
}));
vi.mock("../../src/bot/utils/finalize-assistant-response.js", () => ({
  finalizeAssistantResponse: vi.fn(async ({ messageText, renderFinalParts, sendRenderedPart }: any) => {
    const parts = renderFinalParts(messageText);
    for (const part of parts) {
      await sendRenderedPart(part, { disable_notification: true });
    }
    return { followUpFiles: [] };
  }),
}));
vi.mock("../../src/bot/utils/send-tts-response.js", () => ({
  sendTtsResponseForSession: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/utils/message-draft-stream.js", () => ({
  MessageDraftStreamManager: class {
    enqueue = vi.fn();
    flushSession = vi.fn(async () => undefined);
    clearSession = vi.fn();
    clearAll = vi.fn();
    setSendEditApi = vi.fn();
    consumeLastSentMessageId = vi.fn(() => null);
  },
}));
vi.mock("../../src/bot/utils/thinking-message-lifecycle.js", () => ({
  ThinkingMessageLifecycleManager: class {
    render = vi.fn(async () => undefined);
    finalize = vi.fn(async () => undefined);
    clearSession = vi.fn();
    clearAll = vi.fn();
  },
}));
vi.mock("../../src/bot/utils/thinking-message.js", () => ({
  buildThinkingMessageHtml: vi.fn(() => "thinking"),
}));
const sendBotTextMock = vi.hoisted(() => vi.fn(async () => 1));

vi.mock("../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: sendBotTextMock,
}));
vi.mock("../../src/bot/utils/telegram-local-file-follow-up.js", () => ({
  createLocalFileFollowUpTracker: vi.fn(() => ({
    reserve: vi.fn(() => []),
    markSent: vi.fn(),
    release: vi.fn(),
    clearSession: vi.fn(),
    clearAll: vi.fn(),
  })),
  extractLocalFilePaths: vi.fn(() => []),
  prepareLocalFileFollowUpsFromPaths: vi.fn(async () => []),
}));
vi.mock("../../src/bot/utils/pending-assistant-response.js", () => ({
  createPendingAssistantResponseStore: vi.fn(() => ({
    set: vi.fn(),
    consume: vi.fn(() => null),
    clear: vi.fn(),
    clearAll: vi.fn(),
  })),
}));
vi.mock("../../src/model/capabilities.js", () => ({
  getModelCapabilities: vi.fn(() => ({})),
  supportsInput: vi.fn(() => true),
}));
vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "model", variant: undefined })),
}));
vi.mock("../../src/scheduled-task/foreground-state.js", () => ({
  foregroundSessionState: {
    markBusy: vi.fn(),
    markIdle: vi.fn(),
    clearAll: vi.fn(),
  },
}));
vi.mock("../../src/scheduled-task/runtime.js", () => ({
  scheduledTaskRuntime: {
    flushDeferredDeliveries: vi.fn(async () => undefined),
  },
}));
vi.mock("../../src/bot/streaming/response-streamer.js", () => ({
  ResponseStreamer: class {
    enqueue = vi.fn();
    complete = vi.fn(async () => ({ streamed: false, telegramMessageIds: [] }));
    clearMessage = vi.fn();
    clearSession = vi.fn();
    clearAll = vi.fn();
  },
}));
vi.mock("../../src/bot/streaming/tool-call-streamer.js", () => ({
  ToolCallStreamer: class {
    replaceByPrefix = vi.fn();
    flushSession = vi.fn(async () => undefined);
    clearSession = vi.fn();
    clearAll = vi.fn();
    breakSession = vi.fn(async () => undefined);
  },
}));
vi.mock("../../src/bot/utils/send-with-markdown-fallback.js", () => ({
  editMessageWithMarkdownFallback: vi.fn(async () => undefined),
  sendMessageWithMarkdownFallback: sendMessageWithMarkdownFallbackMock,
}));
vi.mock("../../src/thread/manager.js", () => ({
  threadContextManager: {
    activateFromContext: vi.fn(),
    bindProjectToActiveContext: vi.fn(),
    bindSessionToActiveContext: vi.fn(),
    clearSessionForActiveContext: vi.fn(),
    getSessionTarget: vi.fn(() => null),
    getSessionScope: vi.fn(() => null),
    getSessionDirectory: vi.fn(() => "/repo"),
    getActiveScope: vi.fn(() => null),
    isActiveScope: vi.fn(() => false),
  },
}));
vi.mock("../../src/bot/utils/message-thread.js", () => ({
  withMessageThreadId: vi.fn((options) => options),
}));
vi.mock("../../src/settings/manager.js", () => ({
  getApprovedTelegramUserIds: getApprovedTelegramUserIdsMock,
  getUserLocale: getUserLocaleMock,
  getReasoningMode: vi.fn(() => 0),
  getTenantRuntimeInfo: vi.fn(() => undefined),
  getThinkingClearMode: vi.fn(() => false),
  isMessageStreamingEnabled: vi.fn(() => true),
}));
vi.mock("../../src/bot/utils/reasoning-format.js", () => ({
  formatReasoningForTelegramHtml: vi.fn(() => []),
  formatToolCallAsSpoiler: vi.fn((value: string) => value),
  markdownToHtml: vi.fn((value: string) => value),
}));
vi.mock("../../src/telegram/scope.js", () => ({
  buildTelegramConversationScopeKey: vi.fn(() => "scope"),
  extractTelegramConversationScopeFromContext: vi.fn(() => null),
  resolveTelegramConversationScopeKey: vi.fn(() => "scope"),
  runWithTelegramConversationScope: vi.fn(
    async (_scope: unknown, fn: () => Promise<unknown> | unknown) => await fn(),
  ),
}));

import { createBot } from "../../src/bot/index.js";
import { summaryAggregator } from "../../src/summary/aggregator.js";
import { questionManager } from "../../src/question/manager.js";

function createCallbackContext(data: string) {
  return {
    callbackQuery: {
      data,
      message: { message_id: 777 },
    },
    from: { id: 1 },
    chat: { id: 123, type: "private" },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

function createTextContext(text: string, messageId: number) {
  return {
    message: {
      message_id: messageId,
      text,
      chat: { id: 123 },
      message_thread_id: 99,
    },
    chat: { id: 123, type: "private" },
    from: { id: 1 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: messageId + 1000 }),
  };
}

describe("bot/index callback routing", () => {
  beforeEach(() => {
    onHandlers.length = 0;
    useHandlers.length = 0;
    capturedEventCallbacksByDirectory.clear();
    summaryCallbacks.onQuestion = undefined;
    attachTargetBySessionId.clear();
    attachScopeBySessionId.clear();
    sendMessageWithMarkdownFallbackMock.mockClear();
    sendBotTextMock.mockClear();
    processUserPromptMock.mockReset().mockImplementation(async (_ctx, _text, promptDeps) => {
      await promptDeps.ensureEventSubscription("/repo");
      return true;
    });
    handleInlineMenuCancelMock.mockReset().mockResolvedValue(false);
    handleSessionSelectMock.mockReset().mockResolvedValue(false);
    handleProjectSelectMock.mockReset().mockResolvedValue(false);
    handleQuestionCallbackMock.mockReset().mockResolvedValue(false);
    handleAccessApprovalCallbackMock.mockReset().mockResolvedValue(false);
    handlePermissionCallbackMock.mockReset().mockResolvedValue(false);
    handleAgentSelectMock.mockReset().mockResolvedValue(false);
    handleModelSelectMock.mockReset().mockResolvedValue(false);
    handleVariantSelectMock.mockReset().mockResolvedValue(false);
    handleCompactConfirmMock.mockReset().mockResolvedValue(false);
    handleTaskCallbackMock.mockReset().mockResolvedValue(false);
    handleTaskListCallbackMock.mockReset().mockResolvedValue(false);
    handleRenameCancelMock.mockReset().mockResolvedValue(false);
    handleCommandsCallbackMock.mockReset().mockResolvedValue(false);
    handleSettingsCallbackMock.mockReset().mockResolvedValue(false);
    syncAuthorizedChatCommandsMock.mockReset().mockResolvedValue(undefined);
    getApprovedTelegramUserIdsMock.mockReset().mockReturnValue([1]);
    getUserLocaleMock.mockReset().mockReturnValue(undefined);
    setUserLocaleResolverMock.mockClear();
  });

  it("registers a single callback_query:data dispatcher", () => {
    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };

    const callbackHandlers = bot.onHandlers.filter(
      (entry) => entry.event === "callback_query:data",
    );

    expect(callbackHandlers).toHaveLength(1);
  });

  it("registers the selected user locale resolver during bot setup", () => {
    createBot();

    expect(setUserLocaleResolverMock).toHaveBeenCalledTimes(1);
    expect(setUserLocaleResolverMock).toHaveBeenCalledWith(getUserLocaleMock);
  });

  it("preserves the current grammY middleware registration order", async () => {
    const { authMiddleware } = await import("../../src/bot/middleware/auth.js");
    const { interactionGuardMiddleware } =
      await import("../../src/bot/middleware/interaction-guard.js");

    createBot();

    expect(useHandlers.indexOf(authMiddleware)).toBeGreaterThan(0);
    expect(useHandlers.indexOf(interactionGuardMiddleware)).toBeGreaterThan(
      useHandlers.indexOf(authMiddleware),
    );
  });

  it.skip("restores per-chat commands for already authorized private users on startup", async () => {
    getApprovedTelegramUserIdsMock.mockReturnValue([55, 55]);

    createBot();

    await vi.waitFor(() => {
      expect(syncAuthorizedChatCommandsMock).toHaveBeenCalledWith(
        expect.anything(),
        1,
        "private",
        true,
      );
      expect(syncAuthorizedChatCommandsMock).toHaveBeenCalledWith(
        expect.anything(),
        55,
        "private",
        false,
      );
    });

    expect(syncAuthorizedChatCommandsMock).toHaveBeenCalledTimes(2);
  });

  it("routes open-related callbacks through the callback dispatcher without falling through to unknown callback", async () => {
    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };
    const callbackHandler = bot.onHandlers.find(
      (entry) => entry.event === "callback_query:data",
    )?.handler;
    const ctx = createCallbackContext("tasklist:open:task-1");

    handleTaskListCallbackMock.mockResolvedValue(true);

    expect(callbackHandler).toBeTypeOf("function");

    await callbackHandler?.(ctx);

    expect(handleTaskListCallbackMock).toHaveBeenCalledTimes(1);
    expect(handleTaskListCallbackMock).toHaveBeenCalledWith(ctx);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith({ text: "callback.unknown_command" });
  });

  it("routes settings callbacks through the callback dispatcher", async () => {
    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };
    const callbackHandler = bot.onHandlers.find(
      (entry) => entry.event === "callback_query:data",
    )?.handler;
    const ctx = createCallbackContext("settings:toggle:hide_thinking");

    handleSettingsCallbackMock.mockResolvedValue(true);

    expect(callbackHandler).toBeTypeOf("function");

    await callbackHandler?.(ctx);

    expect(handleSettingsCallbackMock).toHaveBeenCalledTimes(1);
    expect(handleSettingsCallbackMock).toHaveBeenCalledWith(ctx);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalledWith({ text: "callback.unknown_command" });
  });

  it("routes SSE assistant completions to the attached topic for each session in the same chat", async () => {
    attachTargetBySessionId.set("session-a", { chatId: 123, messageThreadId: 11 });
    attachTargetBySessionId.set("session-b", { chatId: 123, messageThreadId: 22 });
    attachScopeBySessionId.set("session-a", { userId: 1, chatId: 123, messageThreadId: 11 });
    attachScopeBySessionId.set("session-b", { userId: 1, chatId: 123, messageThreadId: 22 });

    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };
    const textHandler = bot.onHandlers
      .filter((entry) => entry.event === "message:text")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");

    await textHandler?.(createTextContext("prime subscription", 1));

    const onComplete = summaryAggregator.setOnComplete.mock.calls[0]?.[0];
    expect(onComplete).toBeTypeOf("function");

    await onComplete?.(
      "session-a",
      "msg-a",
      "Assistant reply for A",
      "",
      [],
      undefined,
    );
    await onComplete?.(
      "session-b",
      "msg-b",
      "Assistant reply for B",
      "",
      [],
      undefined,
    );

    expect(sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123,
        messageThreadId: 11,
        text: "Assistant reply for A",
      }),
    );
    expect(sendBotTextMock).toHaveBeenCalledWith(
      expect.objectContaining({
        chatId: 123,
        messageThreadId: 22,
        text: "Assistant reply for B",
      }),
    );
  });

  it("does not send a visible final message for empty completion payloads", async () => {
    attachTargetBySessionId.set("session-a", { chatId: 123, messageThreadId: 11 });
    attachScopeBySessionId.set("session-a", { userId: 1, chatId: 123, messageThreadId: 11 });

    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };
    const textHandler = bot.onHandlers
      .filter((entry) => entry.event === "message:text")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");

    await textHandler?.(createTextContext("prime subscription", 1));

    const onComplete = summaryAggregator.setOnComplete.mock.calls[0]?.[0];
    expect(onComplete).toBeTypeOf("function");

    await onComplete?.(
      "session-a",
      "msg-empty",
      "",
      "",
      [],
      {
        logicalMessageId: "msg-empty",
        completedAt: Date.now(),
      },
    );

    expect(sendBotTextMock).not.toHaveBeenCalled();
  });

  it("starts question state with the current session id for later attach restoration", async () => {
    attachTargetBySessionId.set("session-a", { chatId: 123, messageThreadId: 11 });
    attachScopeBySessionId.set("session-a", { userId: 1, chatId: 123, messageThreadId: 11 });

    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };
    const textHandler = bot.onHandlers
      .filter((entry) => entry.event === "message:text")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");

    await textHandler?.(createTextContext("prime subscription", 1));

    const onQuestion = summaryCallbacks.onQuestion;
    expect(onQuestion).toBeTypeOf("function");

    await onQuestion?.(
      "session-a",
      [
        {
          header: "Restore",
          question: "Continue?",
          options: [{ label: "Yes", description: "continue" }],
        },
      ],
      "req-1",
    );

    expect(questionManager.startQuestions).toHaveBeenCalledWith(
      expect.any(Array),
      "req-1",
      "scope",
      "session-a",
    );
  });
});
