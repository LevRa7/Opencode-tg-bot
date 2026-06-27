import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { SessionInfo } from "../../../src/settings/manager.js";
import type { TelegramConversationScope } from "../../../src/telegram/scope.js";
import { abortCommand, abortCurrentOperation } from "../../../src/bot/commands/abort.js";
import { clearAllInteractionState } from "../../../src/interaction/cleanup.js";
import { questionManager } from "../../../src/question/manager.js";
import { permissionManager } from "../../../src/permission/manager.js";
import { renameManager } from "../../../src/rename/manager.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import type { Question } from "../../../src/question/types.js";
import type { PermissionRequest } from "../../../src/permission/types.js";
import { t } from "../../../src/i18n/index.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";
import { attachManager } from "../../../src/attach/manager.js";
import { runWithTelegramConversationScope } from "../../../src/telegram/scope.js";

// Mock system-info to avoid real system calls during keyboard build
vi.mock("../../../src/utils/system-info.js", () => ({
  getSystemInfo: vi.fn(() => ({ cpu: "CPU", ram: "RAM" })),
}));

// Mock terminal commands
vi.mock("../../../src/bot/commands/terminal.js", () => ({
  isTerminalTopic: vi.fn(() => false),
  isTerminalRunning: vi.fn(() => false),
}));

// Mock processManager
vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    isRunning: vi.fn(() => true),
  },
}));

// Mock agent/model/variant managers for keyboard build
vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  })),
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: vi.fn(() => "Default"),
}));

vi.mock("../../../src/scheduled-task/foreground-state.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/scheduled-task/foreground-state.js")>();
  return {
    ...actual,
    isBusy: vi.fn(() => false),
  };
});

const mocked = vi.hoisted(() => ({
  resolveScopedSession: vi
    .fn<() => { session: SessionInfo; scope: TelegramConversationScope } | null>(),
  abortMock: vi.fn(),
  statusMock: vi.fn(),
  abortDeferredResolve: null as ((value: unknown) => void) | null,
}));

vi.mock("../../../src/bot/runtime/scope-session-resolver.js", () => ({
  resolveScopedSessionFromContext: mocked.resolveScopedSession,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      abort: mocked.abortMock,
      status: mocked.statusMock,
    },
  },
  getCurrentOpencodeRuntimeKey: vi.fn(() => "host"),
}));

const TEST_QUESTION: Question = {
  header: "Q1",
  question: "Pick one",
  options: [
    { label: "Yes", description: "accept" },
    { label: "No", description: "decline" },
  ],
};

const TEST_PERMISSION: PermissionRequest = {
  id: "perm-1",
  sessionID: "session-1",
  permission: "bash",
  patterns: ["npm test"],
  metadata: {},
  always: [],
};

function activateInteractionState(): void {
  questionManager.startQuestions([TEST_QUESTION], "req-abort");
  permissionManager.startPermission(TEST_PERMISSION, 101);
  renameManager.startWaiting("session-1", "D:/repo", "Old title");
  interactionManager.start({
    kind: "rename",
    expectedInput: "text",
    metadata: { sessionId: "session-1" },
  });
}

const DEFAULT_SCOPE: TelegramConversationScope = {
  userId: 1,
  chatId: 777,
};

const DEFAULT_SESSION: SessionInfo = {
  id: "session-1",
  title: "Session",
  directory: "D:/repo",
};

describe("bot/commands/abort", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
    foregroundSessionState.__resetForTests();
    attachManager.__resetForTests();
    mocked.resolveScopedSession.mockReset().mockReturnValue(null);
    mocked.abortMock.mockReset();
    mocked.statusMock.mockReset();
  });

  it("clears interaction state even when there is no active session", async () => {
    activateInteractionState();

    const replyMock = vi.fn().mockResolvedValue(undefined);
    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.no_active_session"), {});
    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
    expect(mocked.abortMock).not.toHaveBeenCalled();
  });

  it("clears interaction state and aborts active session", async () => {
    runWithTelegramConversationScope(DEFAULT_SCOPE, activateInteractionState);
    mocked.resolveScopedSession.mockReturnValue({
      session: DEFAULT_SESSION,
      scope: DEFAULT_SCOPE,
    });

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.in_progress"), {});
    expect(mocked.abortMock).toHaveBeenCalled();
    expect(editMessageTextMock).toHaveBeenCalledWith(777, 88, t("stop.success"));

    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => questionManager.isActive())).toBe(false);
    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => permissionManager.isActive())).toBe(false);
    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => renameManager.isWaitingForName())).toBe(false);
    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => interactionManager.getSnapshot())).toBeNull();
  });

  it("can abort silently without progress messages", async () => {
    runWithTelegramConversationScope(DEFAULT_SCOPE, activateInteractionState);
    mocked.resolveScopedSession.mockReturnValue({
      session: DEFAULT_SESSION,
      scope: DEFAULT_SCOPE,
    });

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCurrentOperation(ctx as never, { notifyUser: false });

    expect(mocked.abortMock).toHaveBeenCalled();
    expect(replyMock).not.toHaveBeenCalled();
    expect(editMessageTextMock).not.toHaveBeenCalled();

    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => questionManager.isActive())).toBe(false);
    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => permissionManager.isActive())).toBe(false);
    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => renameManager.isWaitingForName())).toBe(false);
    expect(runWithTelegramConversationScope(DEFAULT_SCOPE, () => interactionManager.getSnapshot())).toBeNull();
  });

  it("clears busy state only for the attached topic after abort reaches idle", async () => {
    const topicAScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    const sessionA: SessionInfo = { id: "session-1", title: "Session", directory: "D:/repo" };

    attachManager.attach(topicAScope, sessionA);
    runWithTelegramConversationScope(topicAScope, () => {
      foregroundSessionState.markBusy("session-1", "D:/repo");
    });
    runWithTelegramConversationScope(topicBScope, () => {
      foregroundSessionState.markBusy("session-2", "test");
    });

    mocked.resolveScopedSession.mockReturnValue({
      session: sessionA,
      scope: topicAScope,
    });

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(runWithTelegramConversationScope(topicAScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
    expect(runWithTelegramConversationScope(topicBScope, () => foregroundSessionState.isBusy())).toBe(
      true,
    );
  });

  it("clears the original busy topic when attachment changes before abort cleanup", async () => {
    const topicAScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    const session: SessionInfo = { id: "session-1", title: "Session", directory: "D:/repo" };

    attachManager.attach(topicAScope, session);
    runWithTelegramConversationScope(topicAScope, () => {
      foregroundSessionState.markBusy("session-1", "D:/repo");
    });

    attachManager.attach(topicBScope, session);

    mocked.resolveScopedSession.mockReturnValue({
      session,
      scope: topicBScope,
    });

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(runWithTelegramConversationScope(topicAScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
    expect(runWithTelegramConversationScope(topicBScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
  });

  it("abort uses the session attached to the invoking topic", async () => {
    const topicAScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    const sessionA: SessionInfo = { id: "session-a", title: "Session A", directory: "/dir/a" };
    const sessionB: SessionInfo = { id: "session-b", title: "Session B", directory: "/dir/b" };

    attachManager.attach(topicAScope, sessionA);
    attachManager.attach(topicBScope, sessionB);

    mocked.resolveScopedSession.mockReturnValue({
      session: sessionA,
      scope: topicAScope,
    });

    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-a": { type: "idle" },
      },
      error: null,
    });

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(mocked.abortMock).toHaveBeenCalledWith(
      expect.objectContaining({ sessionID: "session-a" }),
      expect.anything(),
    );
  });

  it("abort does not target another topic's attached session when current topic has no attachment", async () => {
    const topicAScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    const sessionB: SessionInfo = { id: "session-b", title: "Session B", directory: "/dir/b" };

    attachManager.attach(topicBScope, sessionB);

    mocked.resolveScopedSession.mockReturnValue(null);

    const replyMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      reply: replyMock,
    } as unknown as Context;

    await abortCommand(ctx as never);

    expect(replyMock).toHaveBeenCalledWith(t("stop.no_active_session"), {});
    expect(mocked.abortMock).not.toHaveBeenCalled();
  });

  it("abort cleanup stays bound to the invoking topic even if the session is reattached before cleanup runs", async () => {
    const topicAScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope: TelegramConversationScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    const session: SessionInfo = { id: "session-1", title: "Session", directory: "D:/repo" };

    attachManager.attach(topicAScope, session);
    runWithTelegramConversationScope(topicAScope, () => {
      foregroundSessionState.markBusy("session-1", "D:/repo");
    });

    mocked.resolveScopedSession.mockReturnValue({
      session,
      scope: topicAScope,
    });

    const abortDeferred = new Promise((resolve) => {
      mocked.abortDeferredResolve = resolve;
    });
    mocked.abortMock.mockReturnValue(abortDeferred);

    const replyMock = vi.fn().mockResolvedValue({ message_id: 88 });
    const editMessageTextMock = vi.fn().mockResolvedValue(undefined);

    const ctx = {
      chat: { id: 777 },
      reply: replyMock,
      api: {
        editMessageText: editMessageTextMock,
      },
    } as unknown as Context;

    const abortPromise = abortCommand(ctx as never);

    attachManager.attach(topicBScope, session);

    mocked.abortDeferredResolve!({ data: true, error: null });
    mocked.statusMock.mockResolvedValue({
      data: {
        "session-1": { type: "idle" },
      },
      error: null,
    });

    await abortPromise;

    expect(runWithTelegramConversationScope(topicAScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
  });


});
