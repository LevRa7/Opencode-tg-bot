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
const sessionPromptMock = vi.hoisted(() => vi.fn(() => Promise.resolve({ error: undefined })));
const sessionStatusMock = vi.hoisted(() => vi.fn().mockResolvedValue({ data: {}, error: undefined }));
const getCurrentSessionMock = vi.hoisted(() =>
  vi.fn(() => ({ id: "session-1", title: "Session 1", directory: "/repo" })),
);
const getCurrentProjectMock = vi.hoisted(() => vi.fn(() => ({ id: "p1", worktree: "/repo" })));
const statMock = vi.hoisted(() =>
  vi.fn(async (filePath: string) => {
    if (filePath === "/tmp/report.txt") {
      return { isFile: () => true, size: 128 };
    }

    throw new Error(`Unexpected file path: ${filePath}`);
  }),
);

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

    public readonly onHandlers: Array<{ event: string | string[]; handler: (...args: any[]) => any }> = [];

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
    getSessionTarget: vi.fn(() => null),
    getSessionScope: vi.fn(() => null),
    getSessionDirectory: vi.fn(() => "/repo"),
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
    startQuestions: vi.fn(),
    clear: vi.fn(),
  },
}));

vi.mock("../../src/permission/manager.js", () => ({
  permissionManager: {
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
import { getReasoningMode, getTenantRuntimeInfo, isMessageStreamingEnabled } from "../../src/settings/manager.js";
import { createBot } from "../../src/bot/index.js";

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
    keyboardGetKeyboardMock.mockReset();
    keyboardGetKeyboardMock.mockReturnValue(undefined);
    keyboardIsInitializedMock.mockReset();
    keyboardIsInitializedMock.mockReturnValue(false);
    runWithTelegramConversationScopeMock.mockClear();
    subscribeToEventsMock.mockClear();
    sessionPromptMock.mockClear();
    sessionStatusMock.mockClear();
    statMock.mockClear();
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

  it("uses the routing target thread id for background final sends", async () => {
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
      expect.objectContaining({ message_thread_id: 42 }),
    );
  });

  it("keeps final delivery scoped to each prompt thread for interleaved sessions", async () => {
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

  it("replies to the source user message when sending the final keyboard-bearing response", async () => {
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
        message_thread_id: 42,
        reply_parameters: expect.objectContaining({ message_id: 321 }),
        reply_markup: { keyboard: [[{ text: "A" }]] },
      }),
    );
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
    expect(sendMessageMock.mock.calls.map((call) => String(call[1])).join("\n")).toContain(longTail.slice(0, 256));

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

    await vi.waitFor(() => expect(sendMessageMock.mock.calls.length).toBeGreaterThan(0));
    expect(sendDocumentMock).toHaveBeenCalledTimes(1);
    expect(sendMessageMock.mock.calls.map((call) => String(call[1])).join("\n")).toContain(
      "Final answer after reasoning.",
    );

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
      expect(sendMessageMock.mock.calls.some((call) => String(call[1]).includes("Answer after tool output."))).toBe(true),
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
      expect(sendMessageMock.mock.calls.some((call) => String(call[1]).includes("Answer after subagent output."))).toBe(true),
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

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(1));
    expect(String(sendMessageMock.mock.calls[0]?.[1] ?? "")).toContain("bot.thinking");

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

    await vi.waitFor(() => expect(sendMessageMock).toHaveBeenCalledTimes(2));
    expect(sendMessageDraftMock).not.toHaveBeenCalled();

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
    expect(String(sendMessageMock.mock.calls[1]?.[1] ?? "")).toContain("С");

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
        102,
        "Сначала проверю замечания review по коду и решу, что реально стоит чинить сейчас.",
        {},
      ),
    );
    expect(sendMessageMock).toHaveBeenCalledTimes(2);

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
    expect(assistantMessages[1]).toContain("С");
    expect(assistantMessages[2]).toContain("📋 Plan Mode · 🤖 openai/gpt-5.4 · 🕒 ");
    expect(editMessageTextMock).toHaveBeenCalledWith(
      123,
      102,
      "Сначала проверю замечания review по коду и решу, что реально стоит чинить сейчас.",
      {},
    );
    const latestEditCall = editMessageTextMock.mock.calls[editMessageTextMock.mock.calls.length - 1];
    const latestEditedText = String(latestEditCall?.[2] ?? "");
    expect(latestEditedText).not.toContain("<blockquote expandable>");

    config.bot.hideThinkingMessages = originalHideThinkingMessages;
    vi.mocked(getReasoningMode).mockReturnValue(0);
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
      expect(sendMessageMock.mock.calls.some((call) => String(call[1]).includes("Completed final answer."))).toBe(true),
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
    vi.mocked(getTenantRuntimeInfo).mockReturnValue({
      userId: 888,
      chatId: 123,
      port: 49600,
      baseUrl: "http://127.0.0.1:49600",
      tenantId: "tg-777",
    });

    statMock.mockImplementation(async (filePath: string) => {
      if (filePath === "/home/me/Workspaces/tg-777/state/tg-cli/data/tg_cli.session.string.login.qr.png") {
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

  it("uses assistant renderer functions when message format mode is markdown", async () => {
    const originalMessageFormatMode = config.bot.messageFormatMode;
    config.bot.messageFormatMode = "markdown";

    const renderAssistantFinalPartsSafeSpy = vi.spyOn(assistantRendering, 'renderAssistantFinalPartsSafe')
      .mockReturnValue([
        { text: "**formatted**", fallbackText: "formatted", source: "entities" },
      ]);
    const prepareAssistantFinalStreamingPayloadSpy = vi.spyOn(assistantRendering, 'prepareAssistantFinalStreamingPayload')
      .mockReturnValue({
        parts: ["**formatted**"],
        format: "markdown_v2",
      });
    const prepareAssistantStreamingPayloadSpy = vi.spyOn(assistantRendering, 'prepareAssistantStreamingPayload')
      .mockReturnValue(null);
    const createPlainRenderedPartsSpy = vi.spyOn(assistantRendering, 'createPlainRenderedParts')
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

    const prepareAssistantStreamingPayloadSpy = vi.spyOn(assistantRendering, 'prepareAssistantStreamingPayload')
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
});
