import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { summaryAggregator } from "../../src/summary/aggregator.js";

const capturedEventCallbacksByDirectory = new Map<string, Array<(event: Event) => void>>();
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 42 }));
const sendMessageDraftMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const setMyCommandsMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const deleteMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const sendDocumentMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 43 }));
const sendPhotoMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 44 }));
const sendAudioMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 45 }));
const sendVideoMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 46 }));
const sendChatActionMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const editMessageTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const sessionPromptMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: undefined })));
const sessionPromptAsyncMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: undefined })));
const sessionStatusMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: {}, error: undefined }),
);
const subscribeToEventsMock = vi.hoisted(() =>
  vi.fn(async (directory: string, callback: (event: Event) => void) => {
    const callbacks = capturedEventCallbacksByDirectory.get(directory) ?? [];
    callbacks.push(callback);
    capturedEventCallbacksByDirectory.set(directory, callbacks);
  }),
);
const getCurrentSessionMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "session-1", title: "Session 1", directory: "/repo" })),
);
const getCurrentProjectMock = vi.hoisted(() => vi.fn(() => ({ id: "p1", worktree: "/repo" })));
const runWithTelegramConversationScopeMock = vi.hoisted(() =>
  vi.fn(async (_scope: unknown, fn: () => Promise<unknown> | unknown) => await fn()),
);
const questionIsActiveMock = vi.hoisted(() => vi.fn(() => false));
const handleTaskTextInputMock = vi.hoisted(() => vi.fn(async () => false));
const handleRenameTextAnswerMock = vi.hoisted(() => vi.fn(async () => false));
const handleCommandTextArgumentsMock = vi.hoisted(() => vi.fn(async () => false));
const handleSkillTextArgumentsMock = vi.hoisted(() => vi.fn(async () => false));
const downloadTelegramFileMock = vi.hoisted(() =>
  vi.fn(async () => ({ buffer: Buffer.from("photo-binary"), filePath: "photos/photo.jpg" })),
);
const prepareAttachmentMediaPromptMock = vi.hoisted(() =>
  vi.fn(async (params: { caption?: string }) => ({
    mode: "attachment" as const,
    promptText: params.caption ?? "",
    fileParts: [
      {
        type: "file" as const,
        mime: "image/jpeg",
        filename: "photo.jpg",
        url: "data:image/jpeg;base64,cGhvdG8=",
      },
    ],
    sourceFile: {
      hostAbsolutePath: "/tmp/photo.jpg",
      runtimeVisiblePath: ".opencode/media/photo.jpg",
      fileName: "photo.jpg",
      mimeType: "image/jpeg",
      sizeBytes: 12,
      mediaType: "image" as const,
    },
    transcriberKind: "photo" as const,
  })),
);
const summaryCallbacks = vi.hoisted(() => ({
  onSessionIdle: undefined as undefined | ((sessionId: string) => Promise<void> | void),
}));
const attachTargetBySessionId = vi.hoisted(() =>
  new Map<string, { chatId: number; messageThreadId?: number }>(),
);
const attachScopeBySessionId = vi.hoisted(
  () => new Map<string, { userId: number; chatId: number; messageThreadId?: number }>(),
);

vi.mock("grammy", () => {
  class FakeInputFile {
    constructor(public readonly path: string) {}
  }

  class FakeBot {
    public readonly api = {
      config: { use: vi.fn() },
      sendMessage: sendMessageMock,
      sendMessageDraft: sendMessageDraftMock,
      sendDocument: sendDocumentMock,
      sendPhoto: sendPhotoMock,
      sendAudio: sendAudioMock,
      sendVideo: sendVideoMock,
      sendChatAction: sendChatActionMock,
      setMyCommands: setMyCommandsMock,
      deleteMessage: deleteMessageMock,
      editMessageText: editMessageTextMock,
    };

    public readonly onHandlers: Array<{
      event: string | string[];
      handler: (...args: any[]) => any;
    }> = [];

    constructor(
      public readonly token: string,
      public readonly options?: Record<string, unknown>,
    ) {}

    use(_handler: (...args: any[]) => any): this {
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

  return {
    Bot: FakeBot,
    InputFile: FakeInputFile,
  };
});

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: {
      token: "test-token",
      adminUserId: 777,
      allowedUserIds: [777],
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

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      prompt: sessionPromptMock,
      promptAsync: sessionPromptAsyncMock,
      status: sessionStatusMock,
      create: vi.fn(),
    },
  },
}));

vi.mock("../../src/bot/utils/file-download.js", () => ({
  downloadTelegramFile: downloadTelegramFileMock,
}));

vi.mock("../../src/media/ingest.js", () => ({
  prepareAttachmentMediaPrompt: prepareAttachmentMediaPromptMock,
  prepareAudioPrompt: vi.fn(),
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: getCurrentSessionMock,
  setCurrentSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  getCurrentProject: getCurrentProjectMock,
  setCurrentProject: vi.fn(),
  getReasoningMode: vi.fn(() => 0),
  getTenantRuntimeInfo: vi.fn(() => undefined),
  getUserLocale: vi.fn(() => "en"),
  isMessageStreamingEnabled: vi.fn(() => true),
  getApprovedTelegramUserIds: vi.fn(() => [777]),
}));

vi.mock("../../src/agent/manager.js", () => ({ getStoredAgent: vi.fn(() => undefined) }));
vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "test-model", variant: undefined })),
}));
vi.mock("../../src/variant/manager.js", () => ({ formatVariantForButton: vi.fn(() => "default") }));
vi.mock("../../src/bot/utils/keyboard.js", () => ({ createMainKeyboard: vi.fn(() => undefined) }));
vi.mock("../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    isInitialized: vi.fn(() => false),
    getKeyboard: vi.fn(() => undefined),
    updateContext: vi.fn(),
    clearContext: vi.fn(),
  },
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
    clear: vi.fn(),
    getContextInfo: vi.fn(() => null),
  },
}));
vi.mock("../../src/thread/manager.js", () => ({
  threadContextManager: {
    activateFromContext: vi.fn(),
    bindProjectToActiveContext: vi.fn(),
    bindSessionToActiveContext: vi.fn(),
    clearSessionForActiveContext: vi.fn(),
    getSessionTarget: vi.fn(() => ({ chatId: 123, messageThreadId: undefined })),
    getSessionScope: vi.fn(() => null),
    getActiveScope: vi.fn(() => null),
    isActiveScope: vi.fn(() => false),
  },
}));
vi.mock("../../src/attach/manager.js", () => ({
  attachManager: {
    attach: vi.fn((scope: { userId: number; chatId: number; messageThreadId?: number }, session: { id: string }) => {
      attachScopeBySessionId.set(session.id, scope);
      attachTargetBySessionId.set(session.id, {
        chatId: scope.chatId,
        ...(scope.messageThreadId === undefined ? {} : { messageThreadId: scope.messageThreadId }),
      });
    }),
    getTargetForSession: vi.fn((sessionId: string) => attachTargetBySessionId.get(sessionId) ?? null),
    getScopeForSession: vi.fn((sessionId: string) => attachScopeBySessionId.get(sessionId) ?? null),
  },
}));
vi.mock("../../src/project/manager.js", () => ({
  getDefaultProject: vi.fn(async () => ({ id: "p1", worktree: "/repo" })),
}));
vi.mock("../../src/telegram/scope.js", () => ({
  extractTelegramConversationScopeFromContext: vi.fn((ctx: any) => ({
    userId: ctx.from?.id ?? 777,
    chatId: ctx.chat?.id ?? 123,
    messageThreadId: ctx.message?.message_thread_id,
  })),
  buildTelegramConversationScopeKey: vi.fn(() => "scope"),
  runWithTelegramConversationScope: runWithTelegramConversationScopeMock,
}));
vi.mock("../../src/i18n/index.js", () => ({
  t: vi.fn((key: string) => key),
  setUserLocaleResolver: vi.fn(),
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
vi.mock("../../src/opencode/events.js", () => ({
  subscribeToEvents: vi.fn(async (directory: string, callback: (event: Event) => void) => {
    const wrapped = (event: Event) => {
      callback(event);
      void summaryAggregator.processEvent(event);
    };
    const callbacks = capturedEventCallbacksByDirectory.get(directory) ?? [];
    callbacks.push(wrapped);
    capturedEventCallbacksByDirectory.set(directory, callbacks);
  }),
  stopEventListening: vi.fn(),
}));
vi.mock("../../src/utils/safe-background-task.js", () => ({
  safeBackgroundTask: ({ task, onSuccess, onError }: any) => {
    void Promise.resolve()
      .then(() => task())
      .then((result) => onSuccess?.(result))
      .catch((error) => onError?.(error));
  },
}));
vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: vi.fn(),
    debug: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));
vi.mock("../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn(async () => undefined),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));
vi.mock("../../src/interaction/manager.js", () => ({
  interactionManager: {
    getSnapshot: vi.fn(() => null),
    isExpired: vi.fn(() => false),
    clear: vi.fn(),
  },
}));
vi.mock("../../src/interaction/cleanup.js", () => ({ clearAllInteractionState: vi.fn() }));
vi.mock("../../src/utils/error-format.js", () => ({ formatErrorDetails: vi.fn(() => "error") }));
vi.mock("../../src/question/manager.js", () => ({
  questionManager: {
    isActive: questionIsActiveMock,
    getMessageIds: vi.fn(() => []),
    startQuestions: vi.fn(),
    clear: vi.fn(),
  },
}));
vi.mock("../../src/permission/manager.js", () => ({ permissionManager: { clear: vi.fn() } }));
vi.mock("../../src/rename/manager.js", () => ({ renameManager: { clear: vi.fn() } }));
vi.mock("../../src/bot/commands/task.js", () => ({
  taskCommand: vi.fn(),
  handleTaskCallback: vi.fn(),
  handleTaskTextInput: handleTaskTextInputMock,
}));
vi.mock("../../src/bot/commands/rename.js", () => ({
  renameCommand: vi.fn(),
  handleRenameCancel: vi.fn(),
  handleRenameTextAnswer: handleRenameTextAnswerMock,
}));
vi.mock("../../src/bot/commands/commands.js", () => ({
  commandsCommand: vi.fn(),
  handleCommandsCallback: vi.fn(async () => false),
  handleCommandTextArguments: handleCommandTextArgumentsMock,
}));
vi.mock("../../src/bot/commands/skills.js", () => ({
  skillsCommand: vi.fn(),
  handleSkillsCallback: vi.fn(async () => false),
  handleSkillTextArguments: handleSkillTextArgumentsMock,
}));
vi.mock("../../src/bot/handlers/question.js", () => ({
  handleQuestionCallback: vi.fn(async () => false),
  showCurrentQuestion: vi.fn(async () => undefined),
  handleQuestionTextAnswer: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/handlers/permission.js", () => ({
  handlePermissionCallback: vi.fn(async () => false),
  showPermissionRequest: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/handlers/agent.js", () => ({
  handleAgentSelect: vi.fn(async () => false),
  showAgentSelectionMenu: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/handlers/model.js", () => ({
  handleModelSelect: vi.fn(async () => false),
  showModelSelectionMenu: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/handlers/variant.js", () => ({
  handleVariantSelect: vi.fn(async () => false),
  showVariantSelectionMenu: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/handlers/context.js", () => ({
  handleContextButtonPress: vi.fn(async () => undefined),
  handleCompactConfirm: vi.fn(async () => false),
}));
vi.mock("../../src/bot/handlers/inline-menu.js", () => ({
  handleInlineMenuCancel: vi.fn(async () => false),
}));
vi.mock("../../src/bot/middleware/auth.js", () => ({
  authMiddleware: vi.fn(async (_ctx, next) => await next()),
  handleAccessApprovalCallback: vi.fn(async () => false),
}));
vi.mock("../../src/bot/middleware/interaction-guard.js", () => ({
  interactionGuardMiddleware: vi.fn(async (_ctx, next) => await next()),
}));
vi.mock("../../src/bot/middleware/unknown-command.js", () => ({
  unknownCommandMiddleware: vi.fn(async (_ctx, next) => await next()),
}));
vi.mock("../../src/bot/utils/command-sync.js", () => ({
  syncAuthorizedChatCommands: vi.fn(async () => undefined),
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
vi.mock("../../src/bot/commands/sessions.js", () => ({
  sessionsCommand: vi.fn(),
  handleSessionSelect: vi.fn(async () => false),
}));
vi.mock("../../src/bot/commands/projects.js", () => ({
  projectsCommand: vi.fn(),
  handleProjectSelect: vi.fn(async () => false),
}));
vi.mock("../../src/bot/commands/tasklist.js", () => ({
  taskListCommand: vi.fn(),
  handleTaskListCallback: vi.fn(async () => false),
}));
vi.mock("../../src/bot/commands/worktree.js", () => ({
  worktreeCommand: vi.fn(),
  handleWorktreeCallback: vi.fn(async () => false),
}));
vi.mock("../../src/bot/commands/open.js", () => ({
  openCommand: vi.fn(),
  handleOpenCallback: vi.fn(async () => false),
  clearOpenPathIndex: vi.fn(),
}));
vi.mock("../../src/summary/aggregator.js", () => ({
  summaryAggregator: {
    clear: vi.fn(),
    setTypingIndicatorEnabled: vi.fn(),
    setSessionDirectoryResolver: vi.fn(),
    setOnCleared: vi.fn(),
    setOnPartial: vi.fn(),
    setOnComplete: vi.fn(),
    setOnSessionIdle: vi.fn((callback: (sessionId: string) => Promise<void> | void) => {
      summaryCallbacks.onSessionIdle = callback;
    }),
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
    processEvent: vi.fn(async (event: Event) => {
      if (event.type === "session.idle") {
        await summaryCallbacks.onSessionIdle?.(event.properties.sessionID);
      }
    }),
    setSession: vi.fn(),
    setBotAndChatId: vi.fn(),
  },
}));
vi.mock("../../src/summary/formatter.js", () => ({
  formatToolInfo: vi.fn(() => ""),
  getAssistantParseMode: vi.fn(() => "HTML"),
}));
vi.mock("../../src/summary/subagent-formatter.js", () => ({ renderSubagentCards: vi.fn() }));
vi.mock("../../src/summary/tool-message-batcher.js", () => ({
  ToolMessageBatcher: vi.fn().mockImplementation(() => ({
    flushSession: vi.fn(async () => undefined),
    enqueueFile: vi.fn(),
  })),
}));
vi.mock("../../src/bot/utils/assistant-rendering.js", () => ({
  createPlainRenderedParts: vi.fn(() => []),
  prepareAssistantFinalStreamingPayload: vi.fn((text: string) => ({ text })),
  prepareAssistantStreamingPayload: vi.fn((text: string) => ({ text })),
  renderAssistantFinalPartsSafe: vi.fn(async () => ({ text: "" })),
}));
vi.mock("../../src/bot/utils/finalize-assistant-response.js", () => ({
  finalizeAssistantResponse: vi.fn(async () => undefined),
}));
vi.mock("../../src/bot/utils/send-tts-response.js", () => ({ sendTtsResponseForSession: vi.fn() }));
vi.mock("../../src/bot/utils/thinking-message.js", () => ({ deliverThinkingMessage: vi.fn() }));
vi.mock("../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: {
    startRun: vi.fn(),
    clearRun: vi.fn(),
    clearAll: vi.fn(),
    markResponseCompleted: vi.fn(),
    finishRun: vi.fn(() => ({
      hasCompletedResponse: true,
      completionRecorded: true,
      hasPublishedFinalResponse: true,
      publishedFinalLogicalMessageId: "message-1",
      actualAgent: "planner",
      actualProviderID: "openai",
      actualModelID: "gpt-5.4",
      startedAt: Date.now() - 1000,
      completedAt: Date.now(),
    })),
    getCompletedRun: vi.fn(() => null),
    isRunActive: vi.fn(() => false),
  },
}));
vi.mock("../../src/bot/utils/assistant-run-footer.js", () => ({
  formatAssistantRunFooter: vi.fn(() => "footer"),
}));
vi.mock("../../src/bot/utils/telegram-text.js", () => ({ sendBotText: vi.fn() }));
vi.mock("../../src/bot/utils/telegram-local-file-follow-up.js", () => ({
  createLocalFileFollowUpTracker: vi.fn(() => ({
    reserve: vi.fn(() => []),
    release: vi.fn(),
    clearSession: vi.fn(),
  })),
  extractLocalFilePaths: vi.fn(() => []),
  prepareLocalFileFollowUpsFromPaths: vi.fn(async () => []),
}));
vi.mock("../../src/bot/streaming/response-streamer.js", () => ({
  ResponseStreamer: vi.fn().mockImplementation(() => ({
    breakSession: vi.fn(async () => undefined),
    replaceByPrefix: vi.fn(),
    flushSession: vi.fn(async () => undefined),
    clearSession: vi.fn(),
  })),
}));
vi.mock("../../src/bot/streaming/tool-call-streamer.js", () => ({
  ToolCallStreamer: vi.fn().mockImplementation(() => ({
    breakSession: vi.fn(async () => undefined),
    replaceByPrefix: vi.fn(),
    flushSession: vi.fn(async () => undefined),
  })),
}));
vi.mock("../../src/bot/utils/send-with-markdown-fallback.js", () => ({
  editMessageWithMarkdownFallback: vi.fn(async () => undefined),
  sendMessageWithMarkdownFallback: vi.fn(async () => ({ message_id: 1 })),
}));
vi.mock("../../src/bot/utils/message-thread.js", () => ({
  withMessageThreadId: vi.fn((value: Record<string, unknown> = {}, messageThreadId?: number) =>
    typeof messageThreadId === "number" ? { ...value, message_thread_id: messageThreadId } : value,
  ),
  isForumChat: vi.fn(() => false),
  extractMessageThreadIdFromContext: vi.fn((ctx: any) => ctx.message?.message_thread_id),
  extractThreadTargetFromContext: vi.fn((ctx: any) => ({
    chatId: ctx.chat?.id ?? 123,
    messageThreadId: ctx.message?.message_thread_id,
  })),
}));
vi.mock("../../src/bot/utils/reasoning-format.js", () => ({
  formatReasoningForTelegramHtml: vi.fn((value: string) => value),
  formatToolCallAsSpoiler: vi.fn((value: string) => value),
  markdownToHtml: vi.fn((value: string) => value),
}));

vi.mock("../../src/bot/delivery/session-delivery-orchestrator.js", () => ({
  SessionDeliveryOrchestrator: vi.fn().mockImplementation(() => ({
    enqueue: vi.fn((item: { deliver?: () => Promise<void> | void }) =>
      Promise.resolve().then(async () => {
        await item.deliver?.();
      }),
    ),
    flushSession: vi.fn(async () => undefined),
    clearSession: vi.fn(),
    clearAll: vi.fn(),
  })),
}));

import { createBot } from "../../src/bot/index.js";

function createTextContext(text: string, messageId: number) {
  return {
    message: {
      message_id: messageId,
      text,
      chat: { id: 123 },
      message_thread_id: 7,
    },
    chat: { id: 123, type: "private" },
    from: { id: 777 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: messageId + 1000 }),
  };
}

function createPhotoContext(messageId: number) {
  return {
    message: {
      message_id: messageId,
      photo: [
        {
          file_id: "photo-id",
          file_unique_id: "photo-unique-id",
          width: 1280,
          height: 720,
          file_size: 2048,
        },
      ],
      caption: "Look at this screenshot",
      chat: { id: 123 },
      message_thread_id: 7,
    },
    chat: { id: 123, type: "private" },
    from: { id: 777 },
    api: {
      getFile: vi.fn(),
    },
    reply: vi.fn().mockResolvedValue({ message_id: messageId + 1000 }),
  };
}

async function emitSessionIdle(): Promise<void> {
  await capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
    type: "session.idle",
    properties: {
      sessionID: "session-1",
    },
  } as unknown as Event);
}

describe("bot/index deferred correlation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    process.env.VITEST = "";
    capturedEventCallbacksByDirectory.clear();
    attachTargetBySessionId.clear();
    attachScopeBySessionId.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    setMyCommandsMock.mockClear();
    deleteMessageMock.mockClear();
    sendDocumentMock.mockClear();
    sendPhotoMock.mockClear();
    sendAudioMock.mockClear();
    sendVideoMock.mockClear();
    sendChatActionMock.mockClear();
    editMessageTextMock.mockClear();
    sessionPromptMock.mockClear();
    sessionPromptAsyncMock.mockClear();
    sessionStatusMock.mockClear();
    subscribeToEventsMock.mockClear();
    questionIsActiveMock.mockReset();
    questionIsActiveMock.mockReturnValue(false);
    handleTaskTextInputMock.mockReset();
    handleTaskTextInputMock.mockResolvedValue(false);
    handleRenameTextAnswerMock.mockReset();
    handleRenameTextAnswerMock.mockResolvedValue(false);
    handleCommandTextArgumentsMock.mockReset();
    handleCommandTextArgumentsMock.mockResolvedValue(false);
    handleSkillTextArgumentsMock.mockReset();
    handleSkillTextArgumentsMock.mockResolvedValue(false);
    summaryCallbacks.onSessionIdle = undefined;
    vi.spyOn(global, "setInterval").mockReturnValue(0 as unknown as NodeJS.Timeout);
  });

  afterEach(() => {
    vi.useRealTimers();
    process.env.VITEST = "1";
    vi.restoreAllMocks();
  });

  it("batches all messages in a correlation window into a single prompt and sends standalone media directly", async () => {
    const bot = createBot() as any;
    const textHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:text")
      .at(-1)?.handler;
    const photoHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:photo")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");
    expect(photoHandler).toBeTypeOf("function");

    // Message #1 opens a batch window, message #2 and #3 are enqueued as deferred
    await textHandler(createTextContext("first direct text", 1));
    await textHandler(createTextContext("later direct text", 2));
    await photoHandler(createPhotoContext(3));

    // Wait for the batch window to expire and flush
    await vi.advanceTimersByTimeAsync(5000);
    expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(1);

    const [batchCall] = sessionPromptAsyncMock.mock.calls as unknown as Array<Array<any>>;
    // The combined prompt goes through processUserPrompt, so it passes through
    // the regular path which calls session.promptAsync with sessionID and parts
    expect(batchCall?.[0]).toEqual(
      expect.objectContaining({
        sessionID: expect.any(String),
        directory: "/repo",
        parts: expect.arrayContaining([
          expect.objectContaining({
            type: "text",
          }),
        ]),
      }),
    );
    const combinedText = batchCall?.[0]?.parts?.[0]?.text as string;
    expect(combinedText).toContain("first direct text");
    expect(combinedText).toContain("later direct text");
    expect(combinedText).toContain("Look at this screenshot");

    // Standalone message after batch flush sends directly
    sessionPromptAsyncMock.mockClear();
    await textHandler(createTextContext("single follow-up text", 10));
    await vi.advanceTimersByTimeAsync(1100);
    expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
    const [singleCall] = sessionPromptAsyncMock.mock.calls as unknown as Array<Array<any>>;
    expect(singleCall?.[0]?.parts?.[0]?.text).toContain("single follow-up text");
    expect(singleCall?.[0]?.parts?.[0]?.text).not.toContain(
      "Additional context for the user's previous request:",
    );

    // Standalone photo after session idle
    sessionPromptAsyncMock.mockClear();
    await summaryCallbacks.onSessionIdle?.("session-1");
    await photoHandler(createPhotoContext(4));
    await vi.advanceTimersByTimeAsync(1100);
    expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(1);
  });

  it("does not release deferred follow-up when the primary direct prompt is blocked", async () => {
    sessionStatusMock.mockResolvedValue({
      data: { "session-1": { type: "busy" } },
      error: undefined,
    });

    const bot = createBot() as any;
    const textHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:text")
      .at(-1)?.handler;
    const photoHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:photo")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");
    expect(photoHandler).toBeTypeOf("function");

    await expect(
      textHandler(createTextContext("blocked direct text", 11)),
    ).resolves.toBeUndefined();
    await photoHandler(createPhotoContext(12));

    expect(sessionPromptAsyncMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(1000);
    await summaryCallbacks.onSessionIdle?.("session-1");

    expect(sessionPromptAsyncMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      123,
      expect.stringContaining("blocked direct text"),
      expect.anything(),
    );
  });

  it("routes deferred follow-up delivery to the attached topic for the session", async () => {
    attachTargetBySessionId.set("session-1", { chatId: 123, messageThreadId: 22 });
    attachScopeBySessionId.set("session-1", { userId: 777, chatId: 123, messageThreadId: 22 });

    const bot = createBot() as any;
    const textHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:text")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");

    await textHandler(createTextContext("primary direct text", 31));
    await vi.advanceTimersByTimeAsync(1100);

    await vi.waitFor(() => expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(1));

    await summaryCallbacks.onSessionIdle?.("session-1");

    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "footer",
      expect.objectContaining({ message_thread_id: 22 }),
    );
  });

  it("releases deferred follow-up when session becomes idle before the correlation timer expires", async () => {
    const bot = createBot() as any;
    const textHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:text")
      .at(-1)?.handler;
    const photoHandler = bot.onHandlers
      .filter((entry: any) => entry.event === "message:photo")
      .at(-1)?.handler;

    expect(textHandler).toBeTypeOf("function");
    expect(photoHandler).toBeTypeOf("function");

    // First message opens batch window with 1s initial expiry
    await textHandler(createTextContext("primary direct text", 21));
    await vi.advanceTimersByTimeAsync(1100);
    expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(1);

    // Second message opens a new batch window (1s)
    await photoHandler(createPhotoContext(22));
    await vi.advanceTimersByTimeAsync(1100);

    await vi.waitFor(() => expect(sessionPromptAsyncMock).toHaveBeenCalledTimes(2));
    const [, deferredFollowUpCall] = sessionPromptAsyncMock.mock.calls as unknown as Array<Array<any>>;
    expect(deferredFollowUpCall?.[0]?.parts?.[0]?.text).toContain("Look at this screenshot");
  });
});
