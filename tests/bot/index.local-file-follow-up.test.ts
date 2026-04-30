import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { summaryAggregator } from "../../src/summary/aggregator.js";
import type { Event } from "@opencode-ai/sdk/v2";
import * as assistantRendering from "../../src/bot/utils/assistant-rendering.js";

const capturedEventCallbacksByDirectory = new Map<string, Array<(event: Event) => void>>();

const sendDocumentMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 41 }));
const sendMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 42 }));
const sendMessageDraftMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const setMyCommandsMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const deleteMessageMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const sendPhotoMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 43 }));
const sendAudioMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 44 }));
const sendVideoMock = vi.hoisted(() => vi.fn().mockResolvedValue({ message_id: 45 }));
const sendChatActionMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const editMessageTextMock = vi.hoisted(() => vi.fn().mockResolvedValue(true));
const keyboardGetKeyboardMock = vi.hoisted(() => vi.fn(() => undefined));
const keyboardIsInitializedMock = vi.hoisted(() => vi.fn(() => false));
const getSessionTargetMock = vi.hoisted(() => vi.fn(() => null));
const attachManagerAttachMock = vi.hoisted(() => vi.fn());
const getAttachedTargetForSessionMock = vi.hoisted(() => vi.fn(() => null));
const getAttachedScopeForSessionMock = vi.hoisted(() => vi.fn(() => null));
const getActiveScopeMock = vi.hoisted(() =>
  vi.fn(() => ({ userId: 777, chatId: 123, messageThreadId: 1 })),
);
const isActiveScopeMock = vi.hoisted(() => vi.fn(() => true));
const runWithTelegramConversationScopeMock = vi.hoisted(() =>
  vi.fn(async (_scope: unknown, fn: () => Promise<unknown> | unknown) => await fn()),
);
const subscribeToEventsMock = vi.hoisted(() =>
  vi.fn(async (directory: string, callback: (event: Event) => void) => {
    const callbacks = capturedEventCallbacksByDirectory.get(directory) ?? [];
    callbacks.push(callback);
    capturedEventCallbacksByDirectory.set(directory, callbacks);
  }),
);
const attachedTargetsBySessionId = vi.hoisted(
  () => new Map<string, { chatId: number; messageThreadId?: number }>(),
);
const attachedScopesBySessionId = vi.hoisted(
  () => new Map<string, { userId: number; chatId: number; messageThreadId?: number }>(),
);
const sessionPromptMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: undefined })));
const sessionPromptAsyncMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: undefined })));
const sessionStatusMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ data: {}, error: undefined }),
);
const sessionCreateMock = vi.hoisted(() =>
  vi.fn().mockResolvedValue({
    data: { id: "session-created-1", title: "Created Session", directory: "/repo" },
    error: undefined,
  }),
);
const getCurrentSessionMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "session-1", title: "Session 1", directory: "/repo" })),
);
const getCurrentProjectMock = vi.hoisted(() => vi.fn(() => ({ id: "p1", worktree: "/repo" })));
const getHideThinkingMessagesMock = vi.hoisted(() => vi.fn(() => false));
const getHideToolCallMessagesMock = vi.hoisted(() => vi.fn(() => false));
const getHideToolFileMessagesMock = vi.hoisted(() => vi.fn(() => false));
const statMock = vi.hoisted(() =>
  vi.fn(async (filePath: string) => {
    if (filePath === "/tmp/report.txt") {
      return { isFile: () => true, size: 128 };
    }

    throw new Error(`Unexpected file path: ${filePath}`);
  }),
);
const realpathMock = vi.hoisted(() => vi.fn(async (filePath: string) => filePath));

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

vi.mock("grammy", () => {
  class FakeInputFile {
    constructor(public readonly path: string) {}
  }

  class FakeBot {
    public readonly api = {
      config: {
        use: vi.fn(),
      },
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

vi.mock("node:fs/promises", () => ({
  stat: statMock,
  realpath: realpathMock,
}));

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: {
      token: "test-token",
      adminUserId: 777,
      allowedUserIds: [777, 888],
      proxyUrl: "",
    },
    bot: {
      responseStreamThrottleMs: 0,
      serviceMessagesIntervalSec: 0,
      hideToolCallMessages: false,
      hideThinkingMessages: true,
      hideToolFileMessages: false,
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
      create: sessionCreateMock,
      prompt: sessionPromptMock,
      promptAsync: sessionPromptAsyncMock,
      status: sessionStatusMock,
    },
  },
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: getCurrentSessionMock,
  setCurrentSession: vi.fn(),
  clearSession: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: getCurrentProjectMock,
  setCurrentProject: vi.fn(),
  getReasoningMode: vi.fn(() => 0),
  getTenantRuntimeInfo: vi.fn(() => undefined),
  getThinkingClearMode: vi.fn(() => false),
  getHideThinkingMessages: getHideThinkingMessagesMock,
  getHideToolCallMessages: getHideToolCallMessagesMock,
  getHideToolFileMessages: getHideToolFileMessagesMock,
  getUserLocale: vi.fn(() => "en"),
  isMessageStreamingEnabled: vi.fn(() => true),
}));

vi.mock("../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => undefined),
}));

vi.mock("../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "test", modelID: "test-model", variant: undefined })),
}));

vi.mock("../../src/variant/manager.js", () => ({
  formatVariantForButton: vi.fn(() => "default"),
}));

vi.mock("../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: vi.fn(() => undefined),
}));

vi.mock("../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    isInitialized: keyboardIsInitializedMock,
    getKeyboard: keyboardGetKeyboardMock,
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
    getContextInfo: vi.fn(() => null),
    getContextLimit: vi.fn(() => 0),
    updateTokensSilent: vi.fn(),
    setOnKeyboardUpdate: vi.fn(),
    addFileChange: vi.fn(),
    onSessionChange: vi.fn(),
    onMessageComplete: vi.fn(),
    onCostUpdate: vi.fn(),
    onSessionDiff: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/thread/manager.js", () => ({
  threadContextManager: {
    activateFromContext: vi.fn(),
    bindProjectToActiveContext: vi.fn(),
    bindSessionToActiveContext: vi.fn(),
    clearSessionForActiveContext: vi.fn(),
    getActiveScope: getActiveScopeMock,
    isActiveScope: isActiveScopeMock,
    getSessionTarget: getSessionTargetMock,
    getSessionScope: vi.fn(() => null),
    getSessionDirectory: vi.fn(() => "/repo"),
  },
}));

vi.mock("../../src/attach/manager.js", () => ({
  attachManager: {
    attach: vi.fn(
      (
        scope: { userId: number; chatId: number; messageThreadId?: number },
        session: { id: string },
      ) => {
        attachManagerAttachMock(scope, session);
        attachedTargetsBySessionId.set(session.id, {
          chatId: scope.chatId,
          messageThreadId: scope.messageThreadId,
        });
        attachedScopesBySessionId.set(session.id, {
          userId: scope.userId,
          chatId: scope.chatId,
          messageThreadId: scope.messageThreadId,
        });
      },
    ),
    detach: vi.fn((scope: { chatId: number; messageThreadId?: number }) => {
      for (const [sessionId, target] of attachedTargetsBySessionId.entries()) {
        if (target.chatId === scope.chatId && target.messageThreadId === scope.messageThreadId) {
          attachedTargetsBySessionId.delete(sessionId);
          attachedScopesBySessionId.delete(sessionId);
        }
      }
    }),
    getTargetForSession: getAttachedTargetForSessionMock,
    getScopeForSession: getAttachedScopeForSessionMock,
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
  buildTelegramConversationScopeKey: vi.fn(
    (scope: { userId: number; chatId: number; messageThreadId?: number } | null) => {
      if (!scope) return "global";
      return `${scope.userId}:${scope.chatId}:${scope.messageThreadId ?? 0}`;
    },
  ),
  runWithTelegramConversationScope: runWithTelegramConversationScopeMock,
}));

vi.mock("../../src/i18n/index.js", () => ({
  t: vi.fn((key: string, params?: Record<string, unknown>) => {
    if (key === "subagent.line.task") {
      return `Task: ${String(params?.task ?? "")}`;
    }

    if (key === "subagent.line.agent") {
      return `Agent: ${String(params?.agent ?? "")}`;
    }

    if (key === "pinned.line.model") {
      return `Model: ${String(params?.model ?? "")}`;
    }

    return key;
  }),
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
  subscribeToEvents: subscribeToEventsMock,
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

vi.mock("../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../src/utils/error-format.js", () => ({
  formatErrorDetails: vi.fn(() => "error"),
}));

vi.mock("../../src/question/manager.js", () => ({
  questionManager: {
    isActive: vi.fn(() => false),
    getMessageIds: vi.fn(() => []),
    previewSessionRestore: vi.fn(() => null),
    stageSessionRestore: vi.fn(),
    commitSessionRestore: vi.fn(),
    rollbackSessionRestore: vi.fn(),
    startQuestions: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/permission/manager.js", () => ({
  permissionManager: {
    clearMismatchedTargetScopeRequests: vi.fn(),
    previewSessionRestore: vi.fn(() => ({
      sessionId: "",
      targetScopeKey: "",
      staleTargetMessageIds: [],
      entries: [],
    })),
    commitSessionRestore: vi.fn(),
    getMessageIds: vi.fn(() => []),
    getRequest: vi.fn(() => null),
    removeByMessageId: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/rename/manager.js", () => ({
  renameManager: {
    clear: vi.fn(),
  },
}));

vi.mock("../../src/bot/commands/task.js", () => ({
  taskCommand: vi.fn(),
  handleTaskCallback: vi.fn(),
  handleTaskTextInput: vi.fn(async () => false),
}));

vi.mock("../../src/bot/commands/rename.js", () => ({
  renameCommand: vi.fn(),
  handleRenameCancel: vi.fn(),
  handleRenameTextAnswer: vi.fn(async () => false),
}));

vi.mock("../../src/bot/commands/commands.js", () => ({
  commandsCommand: vi.fn(),
  handleCommandsCallback: vi.fn(async () => false),
  handleCommandTextArguments: vi.fn(async () => false),
}));

vi.mock("../../src/bot/handlers/question.js", () => ({
  handleQuestionCallback: vi.fn(async () => false),
  showCurrentQuestion: vi.fn(async () => undefined),
  handleQuestionTextAnswer: vi.fn(async () => undefined),
}));

import { config } from "../../src/config.js";
import {
  getReasoningMode,
  getHideThinkingMessages,
  getHideToolCallMessages,
  getHideToolFileMessages,
  getTenantRuntimeInfo,
  getThinkingClearMode,
  isMessageStreamingEnabled,
} from "../../src/settings/manager.js";
import { createBot, routingBySessionId } from "../../src/bot/index.js";
import { scheduledTaskRuntime } from "../../src/scheduled-task/runtime.js";

describe("bot/index local file follow-up orchestration", () => {
  beforeEach(() => {
    capturedEventCallbacksByDirectory.clear();
    sendDocumentMock.mockClear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    setMyCommandsMock.mockClear();
    deleteMessageMock.mockClear();
    sendPhotoMock.mockClear();
    sendAudioMock.mockClear();
    sendVideoMock.mockClear();
    sendChatActionMock.mockClear();
    editMessageTextMock.mockClear();
    routingBySessionId.clear();
    keyboardGetKeyboardMock.mockReset();
    keyboardGetKeyboardMock.mockReturnValue(undefined);
    keyboardIsInitializedMock.mockReset();
    keyboardIsInitializedMock.mockReturnValue(false);
    attachManagerAttachMock.mockReset();
    attachedTargetsBySessionId.clear();
    attachedScopesBySessionId.clear();
    getAttachedTargetForSessionMock.mockReset();
    getAttachedTargetForSessionMock.mockImplementation(
      (sessionId: string) => attachedTargetsBySessionId.get(sessionId) ?? null,
    );
    getAttachedScopeForSessionMock.mockReset();
    getAttachedScopeForSessionMock.mockImplementation(
      (sessionId: string) => attachedScopesBySessionId.get(sessionId) ?? null,
    );
    getSessionTargetMock.mockReset();
    getSessionTargetMock.mockReturnValue({ chatId: 123, messageThreadId: 1 });
    getActiveScopeMock.mockReset();
    getActiveScopeMock.mockReturnValue({ userId: 777, chatId: 123, messageThreadId: 1 });
    getHideThinkingMessagesMock.mockReset();
    getHideThinkingMessagesMock.mockReturnValue(false);
    getHideToolCallMessagesMock.mockReset();
    getHideToolCallMessagesMock.mockReturnValue(false);
    getHideToolFileMessagesMock.mockReset();
    getHideToolFileMessagesMock.mockReturnValue(false);
    isActiveScopeMock.mockReset();
    isActiveScopeMock.mockReturnValue(true);
    runWithTelegramConversationScopeMock.mockClear();
    subscribeToEventsMock.mockClear();
    sessionPromptMock.mockClear();
    sessionPromptAsyncMock.mockClear();
    sessionStatusMock.mockClear();
    statMock.mockClear();
    realpathMock.mockClear();
    realpathMock.mockImplementation(async (filePath: string) => filePath);
    vi.spyOn(global, "setInterval").mockReturnValue(0 as unknown as NodeJS.Timeout);
    summaryAggregator.clear();
  });

  afterEach(() => {
    summaryAggregator.clear();
    vi.restoreAllMocks();
  });

  it("keeps sending the main response after a partial follow-up file starts sending", async () => {
    const deferredDocument = createDeferred<{ message_id: number }>();
    sendDocumentMock.mockImplementationOnce(() => deferredDocument.promise);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    expect(subscribeToEventsMock).toHaveBeenCalledWith("/repo", expect.any(Function));
    expect(capturedEventCallbacksByDirectory.get("/repo")?.[0]).toBeTypeOf("function");

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "Artifact is here: /tmp/report.txt\nMain response continues after the file.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sendMessageDraftMock.mock.calls.length).toBeGreaterThan(0));

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "Artifact is here: /tmp/report.txt\nMain response continues after the file.",
      expect.any(Object),
    );
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
    expect(sendDocumentMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({ path: "/tmp/report.txt" }),
      expect.objectContaining({
        caption: "<code>/tmp/report.txt</code>",
        disable_notification: true,
      }),
    );

    deferredDocument.resolve({ message_id: 41 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("resolves reply keyboard inside the session routing scope for background final sends", async () => {
    keyboardIsInitializedMock.mockReturnValue(true);
    keyboardGetKeyboardMock.mockReturnValue({ keyboard: [[{ text: "A" }]] });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show scoped keyboard",
        chat: { id: 123 },
        message_thread_id: 42,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-scope-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-scope-1",
          sessionID: "session-1",
          messageID: "message-scope-1",
          type: "text",
          text: "Scoped reply",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-scope-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(runWithTelegramConversationScopeMock).toHaveBeenCalled();
    expect(keyboardGetKeyboardMock).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "Scoped reply",
      expect.objectContaining({
        reply_markup: { keyboard: [[{ text: "A" }]] },
      }),
    );
  });

  it("keeps cached prompt fallback deliverable when no attached route exists", async () => {
    // This reproduces the prompt-only routing path: the session never gets an attached live target,
    // so the cached prompt routing must still carry the in-flight final answer back to Telegram.
    getSessionTargetMock.mockReset().mockReturnValue(null);
    getAttachedTargetForSessionMock.mockReset().mockReturnValue(null);
    getAttachedScopeForSessionMock.mockReset().mockReturnValue(null);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "prompt fallback delivery",
        chat: { id: 123 },
        message_thread_id: 42,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-prompt-fallback-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-prompt-fallback-1",
          sessionID: "session-1",
          messageID: "message-prompt-fallback-1",
          type: "text",
          text: "Prompt fallback final reply",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-prompt-fallback-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "Prompt fallback final reply",
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("uses the attached scope instead of the original prompt scope when attached routing wins", async () => {
    // The prompt starts in thread 42, but delivery should adopt the newer attached route/scope on thread 1.
    keyboardIsInitializedMock.mockReturnValue(true);
    keyboardGetKeyboardMock.mockReturnValue({ keyboard: [[{ text: "Attached" }]] });
    getSessionTargetMock.mockReset().mockReturnValue(null);
    getAttachedTargetForSessionMock.mockReset().mockReturnValue({
      chatId: 123,
      messageThreadId: 1,
    });
    getAttachedScopeForSessionMock.mockReset().mockReturnValue({
      userId: 777,
      chatId: 123,
      messageThreadId: 1,
    });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "attached scope wins",
        chat: { id: 123 },
        message_thread_id: 42,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-attached-scope-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-attached-scope-1",
          sessionID: "session-1",
          messageID: "message-attached-scope-1",
          type: "text",
          text: "Attached scope reply",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-attached-scope-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "Attached scope reply",
      expect.objectContaining({
        message_thread_id: 1,
        reply_markup: { keyboard: [[{ text: "Attached" }]] },
      }),
    );

    const attachedScope = { userId: 777, chatId: 123, messageThreadId: 1 };
    const originalPromptScope = { userId: 777, chatId: 123, messageThreadId: 42 };

    expect(
      runWithTelegramConversationScopeMock.mock.calls.some(
        ([scope]) => JSON.stringify(scope) === JSON.stringify(attachedScope),
      ),
    ).toBe(true);
    expect(
      runWithTelegramConversationScopeMock.mock.calls.some(
        ([scope]) => JSON.stringify(scope) === JSON.stringify(originalPromptScope),
      ),
    ).toBe(false);
  });

  it("uses the attached target thread id for background final sends", async () => {
    getSessionTargetMock.mockReset().mockReturnValue(null);
    getAttachedTargetForSessionMock.mockReset().mockReturnValue({
      chatId: 123,
      messageThreadId: 1,
    });
    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "route by target",
        chat: { id: 123 },
        message_thread_id: 42,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-route-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-route-1",
          sessionID: "session-1",
          messageID: "message-route-1",
          type: "text",
          text: "Route-target reply",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-route-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "Route-target reply",
      expect.objectContaining({ message_thread_id: 1 }),
    );
  });

  it("suppresses self-origin external input only for the same attached session scope", async () => {
    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "run tests",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    // This reproduces the upstream user-role message event that should notify Telegram
    // only when it was not just sent from the same session + topic by this bot instance.
    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "user-message-same-topic",
          sessionID: "session-1",
          role: "user",
          parts: [{ type: "text", text: "run tests" }],
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await Promise.resolve();
    expect(sendMessageMock).not.toHaveBeenCalled();

    attachedTargetsBySessionId.set("session-1", { chatId: 123, messageThreadId: 2 });
    attachedScopesBySessionId.set("session-1", { userId: 777, chatId: 123, messageThreadId: 2 });

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "user-message-other-topic",
          sessionID: "session-1",
          role: "user",
          parts: [{ type: "text", text: "run tests" }],
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      1,
      123,
      expect.stringContaining("run tests"),
      expect.objectContaining({ message_thread_id: 2 }),
    );

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "user-message-different-text",
          sessionID: "session-1",
          role: "user",
          parts: [{ type: "text", text: "open docs" }],
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      2,
      123,
      expect.stringContaining("open docs"),
      expect.objectContaining({ message_thread_id: 2 }),
    );

    attachedTargetsBySessionId.set("session-1", { chatId: 123, messageThreadId: 9 });
    attachedScopesBySessionId.set("session-1", { userId: 777, chatId: 123, messageThreadId: 9 });

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "user-message-external",
          sessionID: "session-1",
          role: "user",
          parts: [{ type: "text", text: "true external input" }],
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(3));
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      3,
      123,
      expect.stringContaining("true external input"),
      expect.objectContaining({ message_thread_id: 9 }),
    );
  });

  it("does not notify twice for the same external user message id", async () => {
    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "seed routing",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    attachedTargetsBySessionId.set("session-1", { chatId: 123, messageThreadId: 7 });
    attachedScopesBySessionId.set("session-1", { userId: 777, chatId: 123, messageThreadId: 7 });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    const repeatedEvent = {
      type: "message.updated",
      properties: {
        info: {
          id: "external-repeat-1",
          sessionID: "session-1",
          role: "user",
          parts: [{ type: "text", text: "shared text" }],
          time: { created: Date.now() },
        },
      },
    } as unknown as Event;

    emit(repeatedEvent);
    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));

    emit(repeatedEvent);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "external-repeat-2",
          sessionID: "session-1",
          role: "user",
          parts: [{ type: "text", text: "shared text" }],
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      2,
      123,
      expect.stringContaining("shared text"),
      expect.objectContaining({ message_thread_id: 7 }),
    );
  });

  it("keeps final delivery scoped to each attached topic for interleaved sessions", async () => {
    getSessionTargetMock.mockReset().mockReturnValue(null);
    getAttachedTargetForSessionMock.mockReset();
    getAttachedTargetForSessionMock.mockImplementation((sessionId: string) => {
      if (sessionId === "session-1") {
        return { chatId: 123, messageThreadId: 11 };
      }

      if (sessionId === "session-2") {
        return { chatId: 123, messageThreadId: 22 };
      }

      return null;
    });
    getCurrentSessionMock.mockReset();
    getCurrentSessionMock
      .mockReturnValueOnce({ id: "session-1", title: "Session 1", directory: "/repo" })
      .mockReturnValueOnce({ id: "session-2", title: "Session 2", directory: "/repo" });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "first prompt",
        chat: { id: 123 },
        message_thread_id: 11,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 91 }),
    });

    await promptHandler({
      message: {
        text: "second prompt",
        chat: { id: 123 },
        message_thread_id: 22,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 92 }),
    });

    const callbacks = capturedEventCallbacksByDirectory.get("/repo") ?? [];

    expect(callbacks).toHaveLength(2);

    const emitForFirstPrompt = (event: Event) => {
      callbacks[0]?.(event);
    };

    const emitForSecondPrompt = (event: Event) => {
      callbacks[1]?.(event);
    };

    emitForFirstPrompt({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emitForFirstPrompt({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "Reply for thread 11",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emitForSecondPrompt({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-2",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emitForSecondPrompt({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "session-2",
          messageID: "message-2",
          type: "text",
          text: "Reply for thread 22",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emitForSecondPrompt({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-2",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emitForSecondPrompt({
      type: "session.idle",
      properties: {
        sessionID: "session-2",
      },
    } as unknown as Event);

    emitForFirstPrompt({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emitForFirstPrompt({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      1,
      123,
      "Reply for thread 22",
      expect.objectContaining({ message_thread_id: 22 }),
    );
    expect(sendMessageMock).toHaveBeenNthCalledWith(
      2,
      123,
      "Reply for thread 11",
      expect.objectContaining({ message_thread_id: 11 }),
    );
  });

  it("replies to the source user message when sending the final keyboard-bearing response through the attached target", async () => {
    getSessionTargetMock.mockReset().mockReturnValue(null);
    getAttachedTargetForSessionMock.mockReset().mockReturnValue({
      chatId: 123,
      messageThreadId: 1,
    });
    keyboardIsInitializedMock.mockReturnValue(true);
    keyboardGetKeyboardMock.mockReturnValue({ keyboard: [[{ text: "A" }]] });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        message_id: 321,
        text: "reply with keyboard",
        chat: { id: 123 },
        message_thread_id: 42,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reply-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-reply-1",
          sessionID: "session-1",
          messageID: "message-reply-1",
          type: "text",
          text: "Reply-bound keyboard",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reply-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "Reply-bound keyboard",
      expect.objectContaining({
        message_thread_id: 1,
        reply_parameters: expect.objectContaining({ message_id: 321 }),
        reply_markup: { keyboard: [[{ text: "A" }]] },
      }),
    );
  });

  it("accepts a private chat prompt without a message_thread_id", async () => {
    getCurrentSessionMock.mockReset().mockReturnValue(null);
    sessionCreateMock.mockClear().mockResolvedValue({
      data: { id: "session-created-1", title: "Created Session", directory: "/repo" },
      error: undefined,
    });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const replyMock = vi.fn().mockResolvedValue({ message_id: 99 });
    await promptHandler({
      message: {
        text: "private chat without thread id",
        chat: { id: 123, is_forum: true },
      },
      chat: { id: 123, type: "private", is_forum: true },
      from: { id: 777 },
      api: bot.api,
      reply: replyMock,
    });

    expect(replyMock).not.toHaveBeenCalledWith("error.generic");
    expect(replyMock).toHaveBeenCalledWith("bot.creating_session");
    expect(sessionCreateMock).toHaveBeenCalledWith({ directory: "/repo" });
    expect(sessionPromptAsyncMock).toHaveBeenCalled();
  });

  it("keeps sending a long final response after a partial follow-up file starts sending", async () => {
    const deferredDocument = createDeferred<{ message_id: number }>();
    sendDocumentMock.mockImplementationOnce(() => deferredDocument.promise);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show long artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    const longTail = "A".repeat(5000);
    const longMessage = `/tmp/report.txt\n${longTail}`;

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-long-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-long-1",
          sessionID: "session-1",
          messageID: "message-long-1",
          type: "text",
          text: longMessage,
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(sendMessageDraftMock.mock.calls.length).toBeGreaterThan(0));

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-long-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock.mock.calls.length).toBeGreaterThan(1));
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls.map((call) => String(call[1])).join("\n")).toContain(
      longTail.slice(0, 256),
    );

    deferredDocument.resolve({ message_id: 41 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("detects a local file path from reasoning and keeps sending the main response", async () => {
    const deferredDocument = createDeferred<{ message_id: number }>();
    sendDocumentMock.mockImplementationOnce(() => deferredDocument.promise);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show reasoning artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-1",
          type: "reasoning",
          text: "Need to inspect /tmp/report.txt before finishing the reply.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-1",
          type: "text",
          text: "Final answer after reasoning.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(sendMessageMock.mock.calls.map((call) => String(call[1])).join("\n")).toContain(
        "Final answer after reasoning.",
      ),
    );
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);

    deferredDocument.resolve({ message_id: 41 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("detects a local file path from tool text and keeps sending the main response", async () => {
    const deferredDocument = createDeferred<{ message_id: number }>();
    sendDocumentMock.mockImplementationOnce(() => deferredDocument.promise);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show tool artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-tool-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-part-1",
          sessionID: "session-1",
          messageID: "message-tool-1",
          type: "tool",
          callID: "call-bash-1",
          tool: "bash",
          state: {
            status: "completed",
            title: "Created /tmp/report.txt",
            input: {
              command: "touch /tmp/report.txt",
              description: "Saved report",
            },
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-part-tool-1",
          sessionID: "session-1",
          messageID: "message-tool-1",
          type: "text",
          text: "Answer after tool output.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-tool-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(
        sendMessageMock.mock.calls.some((call) =>
          String(call[1]).includes("Answer after tool output."),
        ),
      ).toBe(true),
    );
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);

    deferredDocument.resolve({ message_id: 41 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("detects a local file path from subagent text and keeps sending the main response", async () => {
    const deferredDocument = createDeferred<{ message_id: number }>();
    sendDocumentMock.mockImplementationOnce(() => deferredDocument.promise);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show subagent artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "session-1",
          messageID: "root-message",
          type: "subtask",
          prompt: "Inspect artifact",
          description: "Inspect /tmp/report.txt",
          agent: "explore",
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-subagent-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-part-subagent-1",
          sessionID: "session-1",
          messageID: "message-subagent-1",
          type: "text",
          text: "Answer after subagent output.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-subagent-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(
        sendMessageMock.mock.calls.some((call) =>
          String(call[1]).includes("Answer after subagent output."),
        ),
      ).toBe(true),
    );
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);

    deferredDocument.resolve({ message_id: 41 });
    await Promise.resolve();
    await Promise.resolve();
  });

  it("streams assistant text in one evolving message during reasoning mode and sends the final answer last", async () => {
    let nextMessageId = 100;
    sendMessageMock.mockImplementation(async () => ({ message_id: ++nextMessageId }));

    const originalHideThinkingMessages = config.bot.hideThinkingMessages;
    config.bot.hideThinkingMessages = false;
    vi.mocked(getReasoningMode).mockReturnValue(1);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "reasoning stream ordering",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-order-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-order-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-order-1",
          type: "reasoning",
          text: "Planning the response carefully.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageDraftMock).toHaveBeenCalledTimes(1));
    expect(sendMessageDraftMock).toHaveBeenCalledWith(
      123,
      expect.any(Number),
      expect.stringContaining("bot.thinking"),
      expect.objectContaining({
        parse_mode: "HTML",
        disable_notification: true,
        message_thread_id: 1,
      }),
    );
    expect(String(sendMessageDraftMock.mock.calls[0]?.[2] ?? "")).toContain(
      "Planning the response carefully.",
    );

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-order-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-order-1",
          type: "text",
          text: "С",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-order-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-order-1",
          type: "text",
          text: "Сначала проверю замечания review по коду.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(editMessageTextMock.mock.calls.length).toBeGreaterThan(0));
    expect(String(sendMessageMock.mock.calls[0]?.[1] ?? "")).toContain("С");

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-order-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-order-1",
          type: "text",
          text: "Сначала проверю замечания review по коду и решу, что реально стоит чинить сейчас.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(editMessageTextMock).toHaveBeenCalledWith(
        123,
        101,
        "Сначала проверю замечания review по коду и решу, что реально стоит чинить сейчас.",
        {},
      ),
    );
    expect(sendMessageMock).toHaveBeenCalledTimes(1);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-order-1",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          modelID: "gpt-5.4",
          providerID: "openai",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => {
      if (sendMessageMock.mock.calls.length < 3) {
        throw new Error(
          `sendMessageMock calls: ${JSON.stringify(sendMessageMock.mock.calls.map((call) => call[1]))}`,
        );
      }
      expect(sendMessageMock).toHaveBeenCalledTimes(3);
    });
    const assistantMessages = sendMessageMock.mock.calls.map((call) => String(call[1] ?? ""));
    expect(assistantMessages).toHaveLength(3);
    expect(assistantMessages[0]).toContain("С");
    expect(assistantMessages[1]).toContain("bot.thinking");
    expect(assistantMessages[1]).toContain("Planning the response carefully.");
    expect(assistantMessages[2]).toContain("📋 Plan Mode · 🤖 openai/gpt-5.4 · 🕒 ");
    expect(sendMessageMock).toHaveBeenLastCalledWith(
      123,
      expect.stringContaining("📋 Plan Mode · 🤖 openai/gpt-5.4 · 🕒 "),
      expect.objectContaining({ message_thread_id: 1 }),
    );
    expect(editMessageTextMock).toHaveBeenCalledWith(
      123,
      101,
      "Сначала проверю замечания review по коду и решу, что реально стоит чинить сейчас.",
      {},
    );
    const latestEditCall =
      editMessageTextMock.mock.calls[editMessageTextMock.mock.calls.length - 1];
    const latestEditedText = String(latestEditCall?.[2] ?? "");
    expect(latestEditedText).not.toContain("<blockquote expandable>");
    expect(deleteMessageMock).not.toHaveBeenCalled();

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
    vi.mocked(getReasoningMode).mockReturnValue(0);
  });

  it("deletes the active unfinished thinking block on session error", async () => {
    let nextMessageId = 100;
    sendMessageMock.mockImplementation(async () => ({ message_id: ++nextMessageId }));

    const originalHideThinkingMessages = config.bot.hideThinkingMessages;
    config.bot.hideThinkingMessages = false;
    vi.mocked(getReasoningMode).mockReturnValue(1);
    vi.mocked(getThinkingClearMode).mockReturnValue(true);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "reasoning cleanup on error",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-error-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-error-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-error-1",
          type: "reasoning",
          text: "Still thinking through the failure path.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageDraftMock).toHaveBeenCalledTimes(1));
    expect(String(sendMessageDraftMock.mock.calls[0]?.[2] ?? "")).toContain(
      "Still thinking through the failure path.",
    );

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed",
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(deleteMessageMock).toHaveBeenCalledWith(
        123,
        Number(sendMessageDraftMock.mock.calls[0]?.[1]),
      ),
    );

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
    vi.mocked(getReasoningMode).mockReturnValue(0);
    vi.mocked(getThinkingClearMode).mockReturnValue(false);
  });

  it("passes the declared sendApi contract into streamThinkingBlocks for active reasoning updates", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    const streamThinkingBlocksSpy = vi.fn(async () => undefined);

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 0,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    vi.doMock("../../src/bot/utils/thinking-block-stream.js", async () => {
      const actual = await vi.importActual<
        typeof import("../../src/bot/utils/thinking-block-stream.js")
      >("../../src/bot/utils/thinking-block-stream.js");

      return {
        ...actual,
        streamThinkingBlocks: streamThinkingBlocksSpy,
      };
    });

    const { createBot: createIsolatedBot } = await import("../../src/bot/index.js");
    const bot = createIsolatedBot() as any;
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "active reasoning should use draft and send apis",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-draft-api-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-draft-api-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-draft-api-1",
          type: "reasoning",
          text: "Reasoning should stream through the draft-first thinking block path.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(streamThinkingBlocksSpy).toHaveBeenCalledTimes(1));

    const thinkingCall = streamThinkingBlocksSpy.mock.calls[0]?.[0] as
      | Record<string, unknown>
      | undefined;
    expect(thinkingCall).toBeDefined();
    expect(thinkingCall?.sendApi).toBe(bot.api);
    expect(thinkingCall?.target).toEqual({ chatId: 123, messageThreadId: 1 });

    vi.doUnmock("../../src/bot/utils/thinking-block-stream.js");
  });

  it("keeps the active thinking block visible on session error when thinkingClearMode is disabled", async () => {
    let nextMessageId = 100;
    sendMessageMock.mockImplementation(async () => ({ message_id: ++nextMessageId }));

    const originalHideThinkingMessages = config.bot.hideThinkingMessages;
    config.bot.hideThinkingMessages = false;
    vi.mocked(getReasoningMode).mockReturnValue(1);
    vi.mocked(getThinkingClearMode).mockReturnValue(false);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "reasoning cleanup off on error",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-reasoning-error-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-error-part-2",
          sessionID: "session-1",
          messageID: "message-reasoning-error-2",
          type: "reasoning",
          text: "Keep this reasoning block visible.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageDraftMock).toHaveBeenCalledTimes(1));

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed",
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(
        sendMessageMock.mock.calls.some((call) =>
          String(call[1] ?? "").includes("bot.session_error"),
        ),
      ).toBe(true),
    );
    expect(deleteMessageMock).not.toHaveBeenCalled();

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
    vi.mocked(getReasoningMode).mockReturnValue(0);
    vi.mocked(getThinkingClearMode).mockReturnValue(false);
  });

  it("sends the visible placeholder thinking message when reasoning mode is off", async () => {
    const originalHideThinkingMessages = config.bot.hideThinkingMessages;
    config.bot.hideThinkingMessages = false;
    vi.mocked(getReasoningMode).mockReturnValue(0);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "placeholder thinking",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-placeholder-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-placeholder-part-1",
          sessionID: "session-1",
          messageID: "message-placeholder-1",
          type: "reasoning",
          text: "Reasoning text should not replace the placeholder in mode 0.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    const placeholderMessage = String(sendMessageMock.mock.calls[0]?.[1] ?? "");
    expect(placeholderMessage).toContain("bot.thinking");
    expect(placeholderMessage).not.toContain(
      "Reasoning text should not replace the placeholder in mode 0.",
    );

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
  });

  it("suppresses placeholder thinking when user-scoped thinking visibility is hidden", async () => {
    const originalHideThinkingMessages = config.bot.hideThinkingMessages;
    config.bot.hideThinkingMessages = false;
    vi.mocked(getReasoningMode).mockReturnValue(0);
    vi.mocked(getHideThinkingMessages).mockReturnValue(true);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "hidden placeholder thinking",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-hidden-thinking-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-hidden-thinking-part-1",
          sessionID: "session-1",
          messageID: "message-hidden-thinking-1",
          type: "reasoning",
          text: "This should not trigger a thinking placeholder.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendMessageMock).not.toHaveBeenCalledWith(
      123,
      expect.stringContaining("bot.thinking"),
      expect.any(Object),
    );

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
    vi.mocked(getHideThinkingMessages).mockReturnValue(false);
  });

  it("suppresses active reasoning thinking stream when user-scoped thinking visibility is hidden", async () => {
    const originalHideThinkingMessages = config.bot.hideThinkingMessages;
    config.bot.hideThinkingMessages = false;
    vi.mocked(getReasoningMode).mockReturnValue(1);
    vi.mocked(getHideThinkingMessages).mockReturnValue(true);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "hidden active reasoning",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-hidden-active-thinking-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-hidden-active-thinking-part-1",
          sessionID: "session-1",
          messageID: "message-hidden-active-thinking-1",
          type: "reasoning",
          text: "This reasoning should not stream.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendMessageDraftMock).not.toHaveBeenCalled();
    expect(sendMessageMock).not.toHaveBeenCalledWith(
      123,
      expect.stringContaining("This reasoning should not stream."),
      expect.any(Object),
    );

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
    vi.mocked(getReasoningMode).mockReturnValue(0);
    vi.mocked(getHideThinkingMessages).mockReturnValue(false);
  });

  it("suppresses tool call notifications when user-scoped tool call visibility is hidden", async () => {
    vi.mocked(getHideToolCallMessages).mockReturnValue(true);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "hidden tool call notification",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-hidden-call-part-1",
          sessionID: "session-1",
          messageID: "message-hidden-tool-call-1",
          type: "tool",
          callID: "call-bash-hidden-1",
          tool: "bash",
          state: {
            status: "completed",
            title: "Ran hidden command",
            input: {
              command: "pwd",
              description: "Check directory",
            },
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendMessageMock).not.toHaveBeenCalled();

    vi.mocked(getHideToolCallMessages).mockReturnValue(false);
  });

  it("suppresses tool file delivery when user-scoped tool file visibility is hidden", async () => {
    vi.mocked(getHideToolFileMessages).mockReturnValue(true);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "hidden tool file delivery",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-hidden-tool-file-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-hidden-file-part-1",
          sessionID: "session-1",
          messageID: "message-hidden-tool-file-1",
          type: "tool",
          callID: "call-apply-patch-hidden-1",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Updated /tmp/report.txt",
            input: {
              patchText: [
                "--- a/tmp/report.txt",
                "+++ b/tmp/report.txt",
                "@@ -1 +1 @@",
                "-before",
                "+after",
              ].join("\n"),
            },
            metadata: {
              filediff: {
                file: "/tmp/report.txt",
                additions: 1,
                deletions: 1,
              },
            },
          },
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 20));

    expect(sendDocumentMock).not.toHaveBeenCalled();

    vi.mocked(getHideToolFileMessages).mockReturnValue(false);
  });

  it("flushes queued tool calls at a hidden tool-file boundary without sending the file", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendDocumentMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 5000,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          hideToolFileMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 0),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => true),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot } = await import("../../src/bot/index.js");
    const bot = createIsolatedBot() as any;
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "hidden file should preserve tool boundary",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-visible-before-hidden-file-part-1",
          sessionID: "session-1",
          messageID: "message-hidden-file-boundary-1",
          type: "tool",
          callID: "call-bash-before-hidden-file-1",
          tool: "bash",
          state: {
            status: "completed",
            title: "Check directory before file",
            input: {
              command: "pwd",
              description: "Check directory before file",
            },
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(sendMessageMock).not.toHaveBeenCalled();

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-hidden-file-boundary-part-1",
          sessionID: "session-1",
          messageID: "message-hidden-file-boundary-1",
          type: "tool",
          callID: "call-apply-patch-hidden-boundary-1",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Updated /tmp/report.txt",
            input: {
              patchText: [
                "--- a/tmp/report.txt",
                "+++ b/tmp/report.txt",
                "@@ -1 +1 @@",
                "-before",
                "+after",
              ].join("\n"),
            },
            metadata: {
              filediff: {
                file: "/tmp/report.txt",
                additions: 1,
                deletions: 1,
              },
            },
          },
        },
      },
    } as unknown as Event);

    await vi.waitFor(
      () =>
        expect(sendMessageMock).toHaveBeenCalledWith(
          123,
          expect.stringContaining("Check directory before file"),
          expect.objectContaining({
            parse_mode: "HTML",
            message_thread_id: 1,
          }),
        ),
      { timeout: 300 },
    );
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  it("drops queued reasoning-mode assistant text when session error fires before the stream flush", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 50,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => true),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot } = await import("../../src/bot/index.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "stale stream after error",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-error-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-stream-error-part-1",
          sessionID: "session-1",
          messageID: "message-stream-error-1",
          type: "text",
          text: "Queued assistant text after error.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed",
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(
        sendMessageMock.mock.calls.some((call) =>
          String(call[1] ?? "").includes("bot.session_error"),
        ),
      ).toBe(true),
    );

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("Queued assistant text after error."),
      ),
    ).toBe(false);
  });

  it("drops queued reasoning-mode assistant text when session error loses routing before cleanup", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 50,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => true),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const { summaryAggregator: isolatedSummaryAggregator } =
      await import("../../src/summary/aggregator.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "stale stream without routing on error",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-error-missing-routing-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-stream-error-missing-routing-part-1",
          sessionID: "session-1",
          messageID: "message-stream-error-missing-routing-1",
          type: "text",
          text: "Queued assistant text after missing-routing error.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "retry after missing routing",
        },
      },
    } as unknown as Event);

    currentTarget = undefined;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed",
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("Queued assistant text after missing-routing error."),
      ),
    ).toBe(false);
    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("bot.session_error"),
      ),
    ).toBe(false);

    currentTarget = { chatId: 123, messageThreadId: 1 };
    isolatedSummaryAggregator.setSession("session-1");
    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(sendMessageMock.mock.calls.some((call) => String(call[1] ?? "").includes("📋 "))).toBe(
      false,
    );
    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("retry after missing routing"),
      ),
    ).toBe(false);
  });

  it("clears queued tool retry state and flushes deferred deliveries when onComplete loses bot context", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 500,
          serviceMessagesIntervalSec: 1,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 0),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const { summaryAggregator: isolatedSummaryAggregator } =
      await import("../../src/summary/aggregator.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "missing bot context on complete cleanup",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-missing-context-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-complete-missing-context-part-1",
          sessionID: "session-1",
          messageID: "message-complete-missing-context-1",
          type: "text",
          text: "Final answer that should be dropped after routing disappears.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "retry queued before missing bot context completion",
        },
      },
    } as unknown as Event);

    currentTarget = undefined;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-missing-context-1",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          modelID: "gpt-5.4",
          providerID: "openai",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(scheduledTaskRuntime.flushDeferredDeliveries).toHaveBeenCalledTimes(1),
    );

    await new Promise((resolve) => setTimeout(resolve, 1200));

    currentTarget = { chatId: 123, messageThreadId: 1 };
    isolatedSummaryAggregator.setSession("session-1");
    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes(
          "Final answer that should be dropped after routing disappears.",
        ),
      ),
    ).toBe(false);
    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("retry queued before missing bot context completion"),
      ),
    ).toBe(false);
  });

  it("clears missing-routing terminal state so retry streams and idle footers do not leak later", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 500,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 0),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const { summaryAggregator: isolatedSummaryAggregator } =
      await import("../../src/summary/aggregator.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "missing-routing terminal cleanup",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-missing-routing-terminal-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-missing-routing-terminal-part-1",
          sessionID: "session-1",
          messageID: "message-missing-routing-terminal-1",
          type: "text",
          text: "Final answer before missing-routing error.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-missing-routing-terminal-1",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          modelID: "gpt-5.4",
          providerID: "openai",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(
        sendMessageMock.mock.calls.some((call) =>
          String(call[1] ?? "").includes("Final answer before missing-routing error."),
        ),
      ).toBe(true),
    );

    emit({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "retry after missing-routing terminal error",
        },
      },
    } as unknown as Event);

    currentTarget = undefined;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed",
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(scheduledTaskRuntime.flushDeferredDeliveries).toHaveBeenCalledTimes(1),
    );

    await new Promise((resolve) => setTimeout(resolve, 50));

    currentTarget = { chatId: 123, messageThreadId: 1 };
    isolatedSummaryAggregator.setSession("session-1");
    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 100));

    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("retry after missing-routing terminal error"),
      ),
    ).toBe(false);
    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("📋 Plan Mode · 🤖 openai/gpt-5.4 · 🕒 "),
      ),
    ).toBe(false);
  });

  it("deletes the active unfinished thinking draft when session error loses routing and thinkingClearMode is enabled", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 0,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => true),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const bot = createIsolatedBot() as any;
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "missing-routing error should clear active reasoning draft",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-thinking-missing-routing-error-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-missing-routing-error-part-1",
          sessionID: "session-1",
          messageID: "message-thinking-missing-routing-error-1",
          type: "reasoning",
          text: "Draft reasoning that must be deleted on missing-routing error cleanup.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageDraftMock).toHaveBeenCalledTimes(1));
    const activeDraftId = Number(sendMessageDraftMock.mock.calls[0]?.[1]);

    currentTarget = undefined;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed",
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(deleteMessageMock).toHaveBeenCalledWith(123, activeDraftId));
  });

  it("waits for missing-routing idle thinking cleanup before flushing deferred deliveries and starting the next run", async () => {
    try {
      vi.resetModules();
      capturedEventCallbacksByDirectory.clear();
      sendMessageMock.mockClear();
      sendMessageDraftMock.mockClear();
      deleteMessageMock.mockClear();
      editMessageTextMock.mockClear();
      vi.mocked(scheduledTaskRuntime.flushDeferredDeliveries).mockClear();

      const cleanupDeferred = createDeferred<void>();
      let activeThinkingDraft = false;
      let reusedStaleThinkingDraft = false;

      vi.doMock("../../src/config.js", () => ({
        config: {
          telegram: {
            token: "test-token",
            adminUserId: 777,
            allowedUserIds: [777, 888],
            proxyUrl: "",
          },
          bot: {
            responseStreamThrottleMs: 0,
            serviceMessagesIntervalSec: 0,
            hideToolCallMessages: false,
            hideThinkingMessages: false,
            bashToolDisplayMaxLength: 120,
            messageFormatMode: "raw",
          },
          files: {
            maxFileSizeKb: 1024,
            maxFileLines: 400,
          },
        },
      }));

      let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
        chatId: 123,
        messageThreadId: 1,
      };

      vi.doMock("../../src/thread/manager.js", () => ({
        threadContextManager: {
          activateFromContext: vi.fn(),
          bindProjectToActiveContext: vi.fn(),
          bindSessionToActiveContext: vi.fn(),
          clearSessionForActiveContext: vi.fn(),
          getActiveScope: vi.fn(() =>
            currentTarget
              ? {
                  userId: 777,
                  chatId: currentTarget.chatId,
                  messageThreadId: currentTarget.messageThreadId,
                }
              : null,
          ),
          isActiveScope: vi.fn(() => true),
          getSessionTarget: vi.fn(() => currentTarget),
          getSessionScope: vi.fn(() => null),
          getSessionDirectory: vi.fn(() => "/repo"),
        },
      }));

      vi.doMock("../../src/settings/manager.js", () => ({
        getCurrentProject: getCurrentProjectMock,
        setCurrentProject: vi.fn(),
        getReasoningMode: vi.fn(() => 1),
        getTenantRuntimeInfo: vi.fn(() => undefined),
        getUserLocale: vi.fn(() => "en"),
        getThinkingClearMode: vi.fn(() => false),
        getHideThinkingMessages: vi.fn(() => false),
        getHideToolCallMessages: vi.fn(() => false),
        getHideToolFileMessages: vi.fn(() => false),
        isMessageStreamingEnabled: vi.fn(() => true),
      }));

      vi.doMock("../../src/bot/utils/thinking-block-stream.js", async () => {
        const actual = await vi.importActual<
          typeof import("../../src/bot/utils/thinking-block-stream.js")
        >("../../src/bot/utils/thinking-block-stream.js");

        return {
          ...actual,
          configureThinkingBlockDraftIdAllocator: vi.fn(),
          clearAllThinkingBlockStreams: vi.fn(() => {
            activeThinkingDraft = false;
          }),
          streamThinkingBlocks: vi.fn(async () => {
            if (activeThinkingDraft) {
              reusedStaleThinkingDraft = true;
            }
            activeThinkingDraft = true;
          }),
          finalizeThinkingBlockStream: vi.fn(async () => {
            activeThinkingDraft = false;
          }),
          clearThinkingBlockStream: vi.fn(async () => {
            await cleanupDeferred.promise;
            activeThinkingDraft = false;
          }),
        };
      });

      const { createBot: createIsolatedBot, routingBySessionId } =
        await import("../../src/bot/index.js");
      const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
      const bot = createIsolatedBot() as any;

      const getLatestPromptHandler = () => {
        const textHandlers = bot.onHandlers.filter(
          (entry: { event: string | string[] }) => entry.event === "message:text",
        );
        return textHandlers[textHandlers.length - 1]?.handler;
      };
      const getLatestEmit = () => {
        const callbacks = capturedEventCallbacksByDirectory.get("/repo") ?? [];
        return (event: Event) => callbacks[callbacks.length - 1]?.(event);
      };

      const promptHandler = getLatestPromptHandler();
      expect(promptHandler).toBeTypeOf("function");

      const ctx = {
        message: {
          text: "missing-routing idle cleanup must finish before next run",
          chat: { id: 123 },
          message_thread_id: 1,
        },
        chat: { id: 123, type: "private" },
        from: { id: 777 },
        api: bot.api,
        reply: vi.fn().mockResolvedValue({ message_id: 99 }),
      };

      await promptHandler(ctx);

      const emitFirstRun = getLatestEmit();

      emitFirstRun({
        type: "message.updated",
        properties: {
          info: {
            id: "message-idle-cleanup-await-1",
            sessionID: "session-1",
            role: "assistant",
            time: { created: Date.now() },
          },
        },
      } as unknown as Event);

      emitFirstRun({
        type: "message.part.updated",
        properties: {
          part: {
            id: "reasoning-idle-cleanup-await-part-1",
            sessionID: "session-1",
            messageID: "message-idle-cleanup-await-1",
            type: "reasoning",
            text: "First run reasoning draft that must be cleared before the next run.",
            time: { start: Date.now() },
          },
        },
      } as unknown as Event);

      await vi.waitFor(() => expect(activeThinkingDraft).toBe(true));

      currentTarget = undefined;
      clearPromptRouting("session-1");
      routingBySessionId.delete("session-1");

      emitFirstRun({
        type: "session.idle",
        properties: {
          sessionID: "session-1",
        },
      } as unknown as Event);

      await new Promise((resolve) => setTimeout(resolve, 50));

      expect(scheduledTaskRuntime.flushDeferredDeliveries).not.toHaveBeenCalled();

      cleanupDeferred.resolve();
      await vi.waitFor(() =>
        expect(scheduledTaskRuntime.flushDeferredDeliveries).toHaveBeenCalledTimes(1),
      );

      currentTarget = { chatId: 123, messageThreadId: 1 };

      const secondPromptHandler = getLatestPromptHandler();
      expect(secondPromptHandler).toBeTypeOf("function");
      await secondPromptHandler(ctx);

      const emitSecondRun = getLatestEmit();
      emitSecondRun({
        type: "message.updated",
        properties: {
          info: {
            id: "message-idle-cleanup-await-2",
            sessionID: "session-1",
            role: "assistant",
            time: { created: Date.now() },
          },
        },
      } as unknown as Event);

      emitSecondRun({
        type: "message.part.updated",
        properties: {
          part: {
            id: "reasoning-idle-cleanup-await-part-2",
            sessionID: "session-1",
            messageID: "message-idle-cleanup-await-2",
            type: "reasoning",
            text: "Second run should start with a clean thinking draft state.",
            time: { start: Date.now() },
          },
        },
      } as unknown as Event);

      await vi.waitFor(() => expect(activeThinkingDraft).toBe(true));
      expect(reusedStaleThinkingDraft).toBe(false);
    } finally {
      vi.doUnmock("../../src/bot/utils/thinking-block-stream.js");
    }
  });

  it("clears queued tool and retry state when session becomes idle after routing disappears", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 500,
          serviceMessagesIntervalSec: 1,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 0),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "missing-routing idle cleanup",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-idle-missing-routing-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-idle-missing-routing-part-1",
          sessionID: "session-1",
          messageID: "message-idle-missing-routing-1",
          type: "reasoning",
          text: "Queued placeholder before missing-routing idle.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "retry after missing-routing idle",
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 0));

    currentTarget = undefined;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(scheduledTaskRuntime.flushDeferredDeliveries).toHaveBeenCalledTimes(1),
    );

    currentTarget = { chatId: 123, messageThreadId: 1 };
    await new Promise((resolve) => setTimeout(resolve, 1200));

    expect(
      sendMessageMock.mock.calls.some((call) => String(call[1] ?? "").includes("bot.thinking")),
    ).toBe(false);
    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("retry after missing-routing idle"),
      ),
    ).toBe(false);
  });

  it("drops queued assistant stream when session becomes idle after routing disappears", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 50,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "missing-routing idle response stream cleanup",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-idle-missing-routing-stream-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-idle-missing-routing-stream-part-1",
          sessionID: "session-1",
          messageID: "message-idle-missing-routing-stream-1",
          type: "text",
          text: "Queued assistant text after missing-routing idle.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    currentTarget = undefined;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(scheduledTaskRuntime.flushDeferredDeliveries).toHaveBeenCalledTimes(1),
    );

    currentTarget = { chatId: 123, messageThreadId: 1 };
    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("Queued assistant text after missing-routing idle."),
      ),
    ).toBe(false);
  });

  it("starts the next visible thinking block as a new message after onComplete loses routing", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 0,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | null = {
      chatId: 123,
      messageThreadId: 1,
    };
    let nextMessageId = 100;

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      getHideThinkingMessages: vi.fn(() => false),
      getHideToolCallMessages: vi.fn(() => false),
      getHideToolFileMessages: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockImplementation(async () => ({ message_id: ++nextMessageId }));

    const getLatestPromptHandler = () => {
      const textHandlers = bot.onHandlers.filter(
        (entry: { event: string | string[] }) => entry.event === "message:text",
      );
      return textHandlers[textHandlers.length - 1]?.handler;
    };
    const getLatestEmit = () => {
      const callbacks = capturedEventCallbacksByDirectory.get("/repo") ?? [];
      return (event: Event) => callbacks[callbacks.length - 1]?.(event);
    };

    const firstPromptHandler = getLatestPromptHandler();
    expect(firstPromptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "stale thinking cleanup after completion routing loss",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await firstPromptHandler(ctx);

    const emitFirstRun = getLatestEmit();

    emitFirstRun({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-routing-loss-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emitFirstRun({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-complete-routing-loss-part-1",
          sessionID: "session-1",
          messageID: "message-complete-routing-loss-1",
          type: "reasoning",
          text: "Thinking before completion loses routing.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageDraftMock).toHaveBeenCalledTimes(1));
    const firstThinkingDraftId = Number(sendMessageDraftMock.mock.calls[0]?.[1]);

    currentTarget = null;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emitFirstRun({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-routing-loss-1",
          sessionID: "session-1",
          role: "assistant",
          agent: "plan",
          modelID: "gpt-5.4",
          providerID: "openai",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(deleteMessageMock).toHaveBeenCalledWith(123, firstThinkingDraftId),
    );
    await vi.waitFor(() => expect(scheduledTaskRuntime.flushDeferredDeliveries).toHaveBeenCalled());

    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    editMessageTextMock.mockClear();

    currentTarget = {
      chatId: 123,
      messageThreadId: 1,
    };

    const secondPromptHandler = getLatestPromptHandler();
    expect(secondPromptHandler).toBeTypeOf("function");
    await secondPromptHandler(ctx);

    const emitSecondRun = getLatestEmit();

    emitSecondRun({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-routing-loss-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emitSecondRun({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-complete-routing-loss-part-2",
          sessionID: "session-1",
          messageID: "message-complete-routing-loss-2",
          type: "reasoning",
          text: "Fresh thinking block after completion routing loss.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendMessageDraftMock).toHaveBeenCalledTimes(1));
    expect(editMessageTextMock).not.toHaveBeenCalled();
    expect(deleteMessageMock).toHaveBeenCalledWith(123, firstThinkingDraftId);
    expect(String(sendMessageDraftMock.mock.calls[0]?.[2] ?? "")).toContain(
      "Fresh thinking block after completion routing loss.",
    );
  });

  it("does not queue stale tool output when the routing target becomes null before the flush", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 50,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | null = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 0),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => false),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const { clearPromptRouting } = await import("../../src/bot/handlers/prompt.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });

    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "null target should drop stale tool output",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    currentTarget = null;
    clearPromptRouting("session-1");
    routingBySessionId.delete("session-1");

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "tool-null-target-part-1",
          sessionID: "session-1",
          messageID: "message-null-target-1",
          type: "tool",
          callID: "call-bash-null-target-1",
          tool: "bash",
          state: {
            status: "completed",
            title: "Created /tmp/stale-tool-output.txt",
            input: {
              command: "touch /tmp/stale-tool-output.txt",
              description: "Saved stale tool output",
            },
            metadata: {},
            time: { start: Date.now(), end: Date.now() },
          },
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 10));
    currentTarget = { chatId: 123, messageThreadId: 1 };

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("detects a local file path from the final-only response when streaming is disabled", async () => {
    vi.mocked(isMessageStreamingEnabled).mockReturnValue(false);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show final artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-final-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-part-final-1",
          sessionID: "session-1",
          messageID: "message-final-1",
          type: "text",
          text: "Final only artifact: /tmp/report.txt\nCompleted final answer.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-final-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() =>
      expect(
        sendMessageMock.mock.calls.some((call) =>
          String(call[1]).includes("Completed final answer."),
        ),
      ).toBe(true),
    );
    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));
  });

  it("aborts queued local-file follow-ups when the session target changes before send time", async () => {
    const deferredFirstDocument = createDeferred<{ message_id: number }>();
    sendDocumentMock.mockImplementationOnce(() => deferredFirstDocument.promise);
    statMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/tmp/report.txt" || filePath === "/tmp/second.txt") {
        return { isFile: () => true, size: 128 };
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    let currentTarget: { chatId: number; messageThreadId?: number } | null = {
      chatId: 123,
      messageThreadId: 1,
    };
    getSessionTargetMock.mockImplementation(() => currentTarget);
    getAttachedTargetForSessionMock.mockImplementation(() => currentTarget);
    const bot = createBot() as any;
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "show artifact before switching routes",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-follow-up-route-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "text-follow-up-route-1",
          sessionID: "session-1",
          messageID: "message-follow-up-route-1",
          type: "text",
          text: "Artifacts stay here: /tmp/report.txt and /tmp/second.txt",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));

    currentTarget = {
      chatId: 987,
      messageThreadId: 99,
    };
    routingBySessionId.set("session-1", {
      bot,
      target: currentTarget,
      scope: null,
    });

    deferredFirstDocument.resolve({ message_id: 41 });
    await Promise.resolve();
    await Promise.resolve();

    expect(sendDocumentMock).toHaveBeenNthCalledWith(
      1,
      123,
      expect.objectContaining({ path: "/tmp/report.txt" }),
      expect.objectContaining({
        caption: "<code>/tmp/report.txt</code>",
        disable_notification: true,
        message_thread_id: 1,
      }),
    );
    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));
  });

  it("does not trigger local file follow-up from tool file captions to avoid recursion", async () => {
    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show artifact",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-file-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-file-1",
          sessionID: "session-1",
          messageID: "message-file-1",
          type: "tool",
          callID: "call-apply-patch-1",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Updated /tmp/report.txt",
            input: {
              patchText: [
                "--- a/tmp/report.txt",
                "+++ b/tmp/report.txt",
                "@@ -1 +1 @@",
                "-before",
                "+after",
              ].join("\n"),
            },
            metadata: {
              filediff: {
                file: "/tmp/report.txt",
                additions: 1,
                deletions: 1,
              },
            },
          },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendDocumentMock).toHaveBeenCalledTimes(1));
    expect(sendDocumentMock).toHaveBeenNthCalledWith(
      1,
      123,
      expect.objectContaining({ path: expect.any(String) }),
      expect.objectContaining({
        caption: expect.any(String),
      }),
    );

    await Promise.resolve();
    await Promise.resolve();

    expect(statMock).not.toHaveBeenCalled();
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
  });

  it("maps tenant /state paths to host files before sending follow-up media", async () => {
    getActiveScopeMock.mockReturnValue({ userId: 888, chatId: 123, messageThreadId: 1 });

    vi.mocked(getTenantRuntimeInfo).mockReturnValue({
      userId: 888,
      chatId: 123,
      port: 49600,
      baseUrl: "http://127.0.0.1:49600",
      tenantId: "tg-777",
    });

    statMock.mockImplementation(async (filePath: string) => {
      if (
        filePath ===
        "/home/me/Workspaces/tg-777/state/tg-cli/data/tg_cli.session.string.login.qr.png"
      ) {
        return { isFile: () => true, size: 1024 };
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "show qr",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 888 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-qr-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-qr-1",
          sessionID: "session-1",
          messageID: "message-qr-1",
          type: "text",
          text: "New QR:\n- tg://login?token=abc\n- /state/tg-cli/data/tg_cli.session.string.login.qr.png",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(sendPhotoMock).toHaveBeenCalledTimes(1));
    expect(statMock).toHaveBeenCalledWith(
      "/home/me/Workspaces/tg-777/state/tg-cli/data/tg_cli.session.string.login.qr.png",
    );
    expect(sendPhotoMock).toHaveBeenCalledWith(
      123,
      expect.objectContaining({
        path: "/home/me/Workspaces/tg-777/state/tg-cli/data/tg_cli.session.string.login.qr.png",
      }),
      expect.objectContaining({
        caption: "<code>/state/tg-cli/data/tg_cli.session.string.login.qr.png</code>",
        disable_notification: true,
        message_thread_id: 1,
      }),
    );
  });

  it("ignores tenant host paths from assistant text before checking the filesystem", async () => {
    getActiveScopeMock.mockReturnValue({ userId: 888, chatId: 123, messageThreadId: 1 });

    vi.mocked(getTenantRuntimeInfo).mockReturnValue({
      userId: 888,
      chatId: 123,
      port: 49600,
      baseUrl: "http://127.0.0.1:49600",
      tenantId: "tg-888",
    });

    statMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/me/Workspaces/tg-7408085157/AGENTS.md") {
        return { isFile: () => true, size: 128 };
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "say hello",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 888 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
      type: "message.updated",
      properties: {
        info: {
          id: "message-host-path-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-host-path-1",
          sessionID: "session-1",
          messageID: "message-host-path-1",
          type: "text",
          text: "Requested file: /home/me/Workspaces/tg-7408085157/AGENTS.md",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await Promise.resolve();
    await Promise.resolve();

    expect(statMock).not.toHaveBeenCalled();
    expect(sendDocumentMock).not.toHaveBeenCalled();
    expect(sendPhotoMock).not.toHaveBeenCalled();
  });

  it("ignores tenant /workspace traversal before checking the filesystem", async () => {
    getActiveScopeMock.mockReturnValue({ userId: 888, chatId: 123, messageThreadId: 1 });

    vi.mocked(getTenantRuntimeInfo).mockReturnValue({
      userId: 888,
      chatId: 123,
      port: 49600,
      baseUrl: "http://127.0.0.1:49600",
      tenantId: "tg-888",
    });

    statMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/me/Workspaces/tg-888/state/secret.txt") {
        return { isFile: () => true, size: 128 };
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "say hello",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 888 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
      type: "message.updated",
      properties: {
        info: {
          id: "message-traversal-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-traversal-1",
          sessionID: "session-1",
          messageID: "message-traversal-1",
          type: "text",
          text: "Requested file: /workspace/../state/secret.txt",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await Promise.resolve();
    await Promise.resolve();

    expect(statMock).not.toHaveBeenCalled();
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  it("ignores tenant /workspace symlink escapes before sending files", async () => {
    getActiveScopeMock.mockReturnValue({ userId: 888, chatId: 123, messageThreadId: 1 });

    vi.mocked(getTenantRuntimeInfo).mockReturnValue({
      userId: 888,
      chatId: 123,
      port: 49600,
      baseUrl: "http://127.0.0.1:49600",
      tenantId: "tg-888",
    });

    statMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/me/Workspaces/tg-888/workspace/link.txt") {
        return { isFile: () => true, size: 128 };
      }

      throw new Error(`Unexpected file path: ${filePath}`);
    });
    realpathMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/me/Workspaces/tg-888/workspace/link.txt") {
        return "/home/me/pass.db";
      }

      return filePath;
    });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    await promptHandler({
      message: {
        text: "say hello",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 888 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    });

    capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
      type: "message.updated",
      properties: {
        info: {
          id: "message-symlink-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    capturedEventCallbacksByDirectory.get("/repo")?.[0]?.({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-symlink-1",
          sessionID: "session-1",
          messageID: "message-symlink-1",
          type: "text",
          text: "Requested file: /workspace/link.txt",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await Promise.resolve();
    await Promise.resolve();

    expect(statMock).not.toHaveBeenCalled();
    expect(sendDocumentMock).not.toHaveBeenCalled();
  });

  it("uses assistant renderer functions when message format mode is markdown", async () => {
    const originalMessageFormatMode = config.bot.messageFormatMode;
    config.bot.messageFormatMode = "markdown";

    const renderAssistantFinalPartsSafeSpy = vi
      .spyOn(assistantRendering, "renderAssistantFinalPartsSafe")
      .mockReturnValue([{ text: "**formatted**", fallbackText: "formatted", source: "entities" }]);
    const prepareAssistantFinalStreamingPayloadSpy = vi
      .spyOn(assistantRendering, "prepareAssistantFinalStreamingPayload")
      .mockReturnValue({
        parts: ["**formatted**"],
        format: "markdown_v2",
      });
    const prepareAssistantStreamingPayloadSpy = vi
      .spyOn(assistantRendering, "prepareAssistantStreamingPayload")
      .mockReturnValue(null);
    const createPlainRenderedPartsSpy = vi
      .spyOn(assistantRendering, "createPlainRenderedParts")
      .mockReturnValue([]);

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "test markdown",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-markdown-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-markdown-1",
          sessionID: "session-1",
          messageID: "message-markdown-1",
          type: "text",
          text: "Final answer with **bold**.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-markdown-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(renderAssistantFinalPartsSafeSpy).toHaveBeenCalled());
    expect(renderAssistantFinalPartsSafeSpy).toHaveBeenCalledWith(
      "Final answer with **bold**.",
      3800,
    );
    expect(prepareAssistantFinalStreamingPayloadSpy).toHaveBeenCalledWith(
      "Final answer with **bold**.",
      3800,
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      "**formatted**",
      expect.objectContaining({
        parse_mode: "MarkdownV2",
        disable_notification: true,
        message_thread_id: 1,
      }),
    );

    config.bot.messageFormatMode = originalMessageFormatMode;
    renderAssistantFinalPartsSafeSpy.mockRestore();
    prepareAssistantFinalStreamingPayloadSpy.mockRestore();
    prepareAssistantStreamingPayloadSpy.mockRestore();
    createPlainRenderedPartsSpy.mockRestore();
  });

  it("uses assistant streaming renderer in reasoning mode with markdown format", async () => {
    const originalMessageFormatMode = config.bot.messageFormatMode;
    config.bot.messageFormatMode = "markdown";
    const originalGetReasoningMode = vi.mocked(getReasoningMode);
    vi.mocked(getReasoningMode).mockReturnValue(1);

    const prepareAssistantStreamingPayloadSpy = vi
      .spyOn(assistantRendering, "prepareAssistantStreamingPayload")
      .mockReturnValue({
        parts: ["**streaming**"],
        format: "markdown_v2",
      });

    const bot = createBot() as unknown as FakeBot;
    const textHandlers = bot.onHandlers.filter((entry) => entry.event === "message:text");
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "test reasoning streaming",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    emit({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    emit({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-stream-1",
          sessionID: "session-1",
          messageID: "message-stream-1",
          type: "text",
          text: "Partial streaming answer.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await vi.waitFor(() => expect(prepareAssistantStreamingPayloadSpy).toHaveBeenCalled());
    expect(prepareAssistantStreamingPayloadSpy).toHaveBeenCalledWith(
      "Partial streaming answer.",
      3800,
    );
    // Verify that responseStreamer.enqueue was called with the mocked payload
    // We can't directly inspect responseStreamer, but we can verify that sendMessageMock was called with formatted text.
    // However, streaming may use sendMessageDraftMock? Actually reasoning mode uses responseStreamer.enqueue.
    // We'll just ensure the spy was called.

    config.bot.messageFormatMode = originalMessageFormatMode;
    vi.mocked(getReasoningMode).mockImplementation(originalGetReasoningMode);
    prepareAssistantStreamingPayloadSpy.mockRestore();
  });

  it("does not send session error messages through stale cached routing after live binding disappears", async () => {
    vi.resetModules();
    capturedEventCallbacksByDirectory.clear();
    sendMessageMock.mockClear();
    sendMessageDraftMock.mockClear();
    deleteMessageMock.mockClear();
    editMessageTextMock.mockClear();

    vi.doMock("../../src/config.js", () => ({
      config: {
        telegram: {
          token: "test-token",
          adminUserId: 777,
          allowedUserIds: [777, 888],
          proxyUrl: "",
        },
        bot: {
          responseStreamThrottleMs: 50,
          serviceMessagesIntervalSec: 0,
          hideToolCallMessages: false,
          hideThinkingMessages: false,
          bashToolDisplayMaxLength: 120,
          messageFormatMode: "raw",
        },
        files: {
          maxFileSizeKb: 1024,
          maxFileLines: 400,
        },
      },
    }));

    let currentTarget: { chatId: number; messageThreadId: number } | undefined = {
      chatId: 123,
      messageThreadId: 1,
    };

    vi.doMock("../../src/thread/manager.js", () => ({
      threadContextManager: {
        activateFromContext: vi.fn(),
        bindProjectToActiveContext: vi.fn(),
        bindSessionToActiveContext: vi.fn(),
        clearSessionForActiveContext: vi.fn(),
        getActiveScope: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
        isActiveScope: vi.fn(() => true),
        getSessionTarget: vi.fn(() => currentTarget),
        getSessionScope: vi.fn(() => null),
        getSessionDirectory: vi.fn(() => "/repo"),
      },
    }));

    vi.doMock("../../src/attach/manager.js", () => ({
      attachManager: {
        attach: vi.fn(),
        detach: vi.fn(),
        getTargetForSession: vi.fn(() => currentTarget ?? null),
        getScopeForSession: vi.fn(() =>
          currentTarget
            ? {
                userId: 777,
                chatId: currentTarget.chatId,
                messageThreadId: currentTarget.messageThreadId,
              }
            : null,
        ),
      },
    }));

    vi.doMock("../../src/settings/manager.js", () => ({
      getCurrentProject: getCurrentProjectMock,
      setCurrentProject: vi.fn(),
      getReasoningMode: vi.fn(() => 1),
      getTenantRuntimeInfo: vi.fn(() => undefined),
      getUserLocale: vi.fn(() => "en"),
      getThinkingClearMode: vi.fn(() => true),
      isMessageStreamingEnabled: vi.fn(() => true),
    }));

    const { createBot: createIsolatedBot, routingBySessionId } =
      await import("../../src/bot/index.js");
    const bot = createIsolatedBot() as any;
    sendMessageMock.mockResolvedValue({ message_id: 42 });
    const textHandlers = bot.onHandlers.filter(
      (entry: { event: string | string[] }) => entry.event === "message:text",
    );
    const promptHandler = textHandlers[textHandlers.length - 1]?.handler;

    expect(promptHandler).toBeTypeOf("function");

    const ctx = {
      message: {
        text: "stale cached routing should not send session error",
        chat: { id: 123 },
        message_thread_id: 1,
      },
      chat: { id: 123, type: "private" },
      from: { id: 777 },
      api: bot.api,
      reply: vi.fn().mockResolvedValue({ message_id: 99 }),
    };

    await promptHandler(ctx);

    const emit = (event: Event) => {
      capturedEventCallbacksByDirectory.get("/repo")?.[0]?.(event);
    };

    currentTarget = undefined;
    routingBySessionId.set("session-1", {
      bot,
      target: { chatId: 123, messageThreadId: 1 },
      scope: null,
    });

    emit({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          message: "agent failed after routing disappeared",
        },
      },
    } as unknown as Event);

    await new Promise((resolve) => setTimeout(resolve, 120));

    expect(
      sendMessageMock.mock.calls.some((call) =>
        String(call[1] ?? "").includes("bot.session_error"),
      ),
    ).toBe(false);
  });
});
