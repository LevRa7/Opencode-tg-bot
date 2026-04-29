import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
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

const mocked = vi.hoisted(() => ({
  currentSession: null as { id: string; title: string; directory: string } | null,
  abortMock: vi.fn(),
  statusMock: vi.fn(),
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
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

describe("bot/commands/abort", () => {
  beforeEach(() => {
    clearAllInteractionState("test_setup");
    foregroundSessionState.__resetForTests();
    attachManager.__resetForTests();
    mocked.currentSession = null;
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
    activateInteractionState();

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };

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

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("can abort silently without progress messages", async () => {
    activateInteractionState();

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };

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

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("clears busy state only for the attached topic after abort reaches idle", async () => {
    const topicAScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };

    attachManager.attach(topicAScope, mocked.currentSession);
    runWithTelegramConversationScope(topicAScope, () => {
      foregroundSessionState.markBusy("session-1");
    });
    runWithTelegramConversationScope(topicBScope, () => {
      foregroundSessionState.markBusy("session-2");
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
    const topicAScope = { userId: 1, chatId: 777, messageThreadId: 10 };
    const topicBScope = { userId: 1, chatId: 777, messageThreadId: 20 };

    mocked.currentSession = {
      id: "session-1",
      title: "Session",
      directory: "D:/repo",
    };

    attachManager.attach(topicAScope, mocked.currentSession);
    runWithTelegramConversationScope(topicAScope, () => {
      foregroundSessionState.markBusy("session-1");
    });

    attachManager.attach(topicBScope, mocked.currentSession);

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
});
