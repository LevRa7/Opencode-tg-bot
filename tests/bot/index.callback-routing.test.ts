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
const syncAuthorizedChatCommandsMock = vi.hoisted(() => vi.fn(async () => undefined));
const getApprovedTelegramUserIdsMock = vi.hoisted(() => vi.fn(() => [1]));

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
  subscribeToEvents: vi.fn(async () => undefined),
  stopEventListening: vi.fn(),
}));

vi.mock("../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    clear: vi.fn(),
    setOnCleared: vi.fn(),
    setOnPartial: vi.fn(),
    setOnComplete: vi.fn(),
    setOnSessionIdle: vi.fn(),
    setOnTool: vi.fn(),
    setOnSubagent: vi.fn(),
    setOnToolFile: vi.fn(),
    setOnQuestion: vi.fn(),
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
}));

vi.mock("../../src/bot/handlers/prompt.js", () => ({
  clearPromptResponseMode: vi.fn(),
  clearPromptRouting: vi.fn(),
  getPromptRoutingContext: vi.fn(() => null),
  processUserPrompt: vi.fn(async () => true),
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
  finalizeAssistantResponse: vi.fn(async () => ({ followUpFiles: [] })),
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
vi.mock("../../src/bot/utils/telegram-text.js", () => ({
  sendBotText: vi.fn(async () => 1),
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
  sendMessageWithMarkdownFallback: vi.fn(async () => ({ message_id: 1 })),
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
  },
}));
vi.mock("../../src/bot/utils/message-thread.js", () => ({
  withMessageThreadId: vi.fn((options) => options),
}));
vi.mock("../../src/settings/manager.js", () => ({
  getApprovedTelegramUserIds: getApprovedTelegramUserIdsMock,
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

describe("bot/index callback routing", () => {
  beforeEach(() => {
    onHandlers.length = 0;
    useHandlers.length = 0;
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
    syncAuthorizedChatCommandsMock.mockReset().mockResolvedValue(undefined);
    getApprovedTelegramUserIdsMock.mockReset().mockReturnValue([1]);
  });

  it("registers a single callback_query:data dispatcher", () => {
    const bot = createBot() as unknown as { onHandlers: typeof onHandlers };

    const callbackHandlers = bot.onHandlers.filter(
      (entry) => entry.event === "callback_query:data",
    );

    expect(callbackHandlers).toHaveLength(1);
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
});
