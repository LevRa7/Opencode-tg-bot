import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { newCommand } from "../../../src/bot/commands/new.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  threadBindProjectMock: vi.fn(),
  threadBindSessionMock: vi.fn(),
  threadGetActiveScopeMock: vi.fn(),
  attachSessionForScopeMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: mocked.getCurrentProjectMock,
  setCurrentProject: vi.fn(),
  getThreadContextBindings: vi.fn(() => []),
  setThreadContextBindings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/session/manager.js", () => ({
  setCurrentSession: vi.fn(),
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn().mockResolvedValue(undefined),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: { clear: vi.fn() },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    isInitialized: vi.fn(() => false),
    initialize: vi.fn(),
    onSessionChange: vi.fn().mockResolvedValue(undefined),
    getContextInfo: vi.fn(() => null),
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: vi.fn(() => "Default"),
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindProjectToActiveContext: mocked.threadBindProjectMock,
    bindSessionToActiveContext: mocked.threadBindSessionMock,
    getActiveScope: mocked.threadGetActiveScopeMock,
  },
}));

vi.mock("../../../src/attach/service.js", () => ({
  attachSessionForScope: mocked.attachSessionForScopeMock,
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: vi.fn(() => ({ keyboard: true })),
}));

function createContext(): Context {
  return {
    chat: { id: 123 },
    message: { message_thread_id: 88 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as Context;
}

describe("bot/commands/new", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
    mocked.sessionCreateMock.mockReset();
    mocked.getCurrentProjectMock.mockReset();
    mocked.threadBindProjectMock.mockReset();
    mocked.threadBindSessionMock.mockReset();
    mocked.threadGetActiveScopeMock.mockReset();
    mocked.attachSessionForScopeMock.mockReset();
    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/repo" });
    mocked.threadGetActiveScopeMock.mockReturnValue(null);
    mocked.attachSessionForScopeMock.mockResolvedValue(undefined);
  });

  it("blocks new session creation while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1");

    const ctx = createContext();
    await newCommand(ctx as never);

    expect(mocked.sessionCreateMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("interaction.blocked.finish_current"));
  });

  it("attaches keyboard reply to the current topic when a session is created", async () => {
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-1", title: "Topic Session" },
      error: null,
    });

    const ctx = createContext();
    await newCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("new.created", { title: "Topic Session" }), {
      reply_markup: { keyboard: true },
      message_thread_id: 88,
    });
  });

  it("does not bind the active scope directly when attachment owns session binding", async () => {
    mocked.threadGetActiveScopeMock.mockReturnValue({
      userId: 10,
      chatId: 123,
      messageThreadId: 88,
    });
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-1", title: "Scoped Session" },
      error: null,
    });

    const ctx = createContext();
    await newCommand(ctx as never);

    expect(mocked.threadBindSessionMock).not.toHaveBeenCalled();
    expect(mocked.attachSessionForScopeMock).toHaveBeenCalledWith(
      expect.objectContaining({
        scope: { userId: 10, chatId: 123, messageThreadId: 88 },
        session: { id: "session-1", title: "Scoped Session", directory: "/repo" },
        reason: "new_session",
      }),
    );
  });
});
