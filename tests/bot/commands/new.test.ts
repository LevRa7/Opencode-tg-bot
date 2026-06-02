import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { newCommand } from "../../../src/bot/commands/new.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  sessionCreateMock: vi.fn(),
  getCurrentProjectMock: vi.fn(),
  setCurrentProjectMock: vi.fn(),
  setConversationCurrentProjectMock: vi.fn(),
  clearScopedSessionRuntimeMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  clearSummaryMock: vi.fn(),
  clearInteractionMock: vi.fn(),
  threadBindProjectMock: vi.fn(),
  threadBindSessionMock: vi.fn(),
  threadGetActiveScopeMock: vi.fn(),
  attachSessionForScopeMock: vi.fn(),
  getDefaultProjectMock: vi.fn(),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.sessionCreateMock,
    },
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  getCurrentProject: mocked.getCurrentProjectMock,
  setCurrentProject: mocked.setCurrentProjectMock,
  setConversationCurrentProject: mocked.setConversationCurrentProjectMock,
  getThreadContextBindings: vi.fn(() => []),
  setThreadContextBindings: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/project/manager.js", () => ({
  getDefaultProject: mocked.getDefaultProjectMock,
}));

vi.mock("../../../src/session/manager.js", () => ({
  setCurrentSession: vi.fn(),
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  ingestSessionInfoForCache: vi.fn().mockResolvedValue(undefined),
  __resetSessionDirectoryCacheForTests: vi.fn(),
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearInteractionMock,
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: { clear: mocked.clearSummaryMock },
}));

vi.mock("../../../src/bot/runtime/scoped-runtime-reset.js", () => ({
  clearScopedSessionRuntime: mocked.clearScopedSessionRuntimeMock,
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
    mocked.setCurrentProjectMock.mockReset();
    mocked.setConversationCurrentProjectMock.mockReset();
    mocked.threadBindProjectMock.mockReset();
    mocked.threadBindSessionMock.mockReset();
    mocked.threadGetActiveScopeMock.mockReset();
    mocked.attachSessionForScopeMock.mockReset();
    mocked.getDefaultProjectMock.mockReset();
    mocked.clearScopedSessionRuntimeMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.clearSummaryMock.mockReset();
    mocked.clearInteractionMock.mockReset();
    mocked.getCurrentProjectMock.mockReturnValue({ id: "project-1", worktree: "/repo" });
    mocked.getDefaultProjectMock.mockResolvedValue({ id: "default-project", worktree: "/default" });
    mocked.threadGetActiveScopeMock.mockReturnValue(null);
    mocked.attachSessionForScopeMock.mockResolvedValue(undefined);
  });

  it("blocks new session creation while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "test");

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
    mocked.getCurrentSessionMock.mockReturnValue({ id: "session-0", title: "Previous", directory: "/repo" });

    const ctx = createContext();
    await newCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("new.created", { title: "Topic Session" }), {
      reply_markup: { keyboard: true },
      message_thread_id: 88,
    });
    expect(mocked.clearScopedSessionRuntimeMock).toHaveBeenCalledWith("session-0", "session_created");
    expect(mocked.clearSummaryMock).not.toHaveBeenCalled();
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

  it("does not persist the user default project when /new auto-selects a fallback project", async () => {
    mocked.getCurrentProjectMock.mockReturnValue(undefined);
    mocked.getDefaultProjectMock.mockResolvedValue({ id: "fallback-project", worktree: "/fallback" });
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-1", title: "Fallback Session" },
      error: null,
    });

    const ctx = createContext();
    await newCommand(ctx as never);

    expect(mocked.setConversationCurrentProjectMock).toHaveBeenCalledWith({
      id: "fallback-project",
      worktree: "/fallback",
    });
    expect(mocked.setCurrentProjectMock).not.toHaveBeenCalled();
    expect(mocked.threadBindProjectMock).toHaveBeenCalledWith({
      id: "fallback-project",
      worktree: "/fallback",
    });
    expect(mocked.sessionCreateMock).toHaveBeenCalledWith({ directory: "/fallback" });
  });

  it("does not persist the user default project when /new uses a restored active conversation project", async () => {
    mocked.getCurrentProjectMock.mockReturnValue({ id: "restored-project", worktree: "/restored" });
    mocked.sessionCreateMock.mockResolvedValue({
      data: { id: "session-1", title: "Restored Session" },
      error: null,
    });

    const ctx = createContext();
    await newCommand(ctx as never);

    expect(mocked.setConversationCurrentProjectMock).toHaveBeenCalledWith({
      id: "restored-project",
      worktree: "/restored",
    });
    expect(mocked.setCurrentProjectMock).not.toHaveBeenCalled();
    expect(mocked.threadBindProjectMock).toHaveBeenCalledWith({
      id: "restored-project",
      worktree: "/restored",
    });
    expect(mocked.sessionCreateMock).toHaveBeenCalledWith({ directory: "/restored" });
  });
});
