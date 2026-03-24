import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  currentProject: undefined as { id: string; worktree: string; name?: string } | undefined,
  currentSession: null as { id: string; title: string; directory: string } | null,
  threadContextBindings: [] as Array<{
    contextKey: string;
    project?: { id: string; worktree: string; name?: string };
    session?: { id: string; title: string; directory: string };
  }>,
  setCurrentProjectMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  clearSessionMock: vi.fn(),
  setThreadContextBindingsMock: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
  getThreadContextBindings: vi.fn(() =>
    mocked.threadContextBindings.map((binding) => ({
      contextKey: binding.contextKey,
      project: binding.project ? { ...binding.project } : undefined,
      session: binding.session ? { ...binding.session } : undefined,
    })),
  ),
  setCurrentProject: vi.fn((project) => {
    mocked.currentProject = project;
    mocked.setCurrentProjectMock(project);
  }),
  setThreadContextBindings: vi.fn((bindings) => {
    mocked.threadContextBindings = bindings.map(
      (binding: (typeof mocked.threadContextBindings)[number]) => ({
        contextKey: binding.contextKey,
        project: binding.project ? { ...binding.project } : undefined,
        session: binding.session ? { ...binding.session } : undefined,
      }),
    );
    mocked.setThreadContextBindingsMock(bindings);
    return Promise.resolve();
  }),
}));

vi.mock("../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
  setCurrentSession: vi.fn((session) => {
    mocked.currentSession = session;
    mocked.setCurrentSessionMock(session);
  }),
  clearSession: vi.fn(() => {
    mocked.currentSession = null;
    mocked.clearSessionMock();
  }),
}));

import { threadContextManager } from "../../src/thread/manager.js";

function createMessageContext(chatId: number, messageThreadId?: number, userId = 1001): Context {
  return {
    from: { id: userId },
    chat: { id: chatId },
    message: {
      message_thread_id: messageThreadId,
    } as Context["message"],
  } as unknown as Context;
}

describe("thread/manager", () => {
  beforeEach(() => {
    mocked.currentProject = undefined;
    mocked.currentSession = null;
    mocked.threadContextBindings = [];
    mocked.setCurrentProjectMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.clearSessionMock.mockReset();
    mocked.setThreadContextBindingsMock.mockReset();
    threadContextManager.__resetForTests();
  });

  it("persists scoped project and session when topic bindings are missing", () => {
    mocked.currentProject = { id: "project-existing", worktree: "/repo" };
    mocked.currentSession = {
      id: "session-existing",
      title: "Existing",
      directory: "/repo",
    };

    threadContextManager.activateFromContext(createMessageContext(-100100, 11));

    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
    expect(threadContextManager.getSessionTarget("session-existing")).toEqual({
      chatId: -100100,
      messageThreadId: 11,
    });
    expect(mocked.setThreadContextBindingsMock).toHaveBeenCalledWith([
      {
        contextKey: "-100100:11",
        project: { id: "project-existing", worktree: "/repo" },
        session: {
          id: "session-existing",
          title: "Existing",
          directory: "/repo",
        },
      },
    ]);
  });

  it("keeps existing session in non-threaded chats", () => {
    mocked.currentSession = {
      id: "session-direct",
      title: "Direct",
      directory: "/repo",
    };

    threadContextManager.activateFromContext(createMessageContext(123456));

    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
    expect(threadContextManager.getSessionTarget("session-direct")).toEqual({ chatId: 123456 });
  });

  it("allows auto assignment only until topic bindings are created", () => {
    const topicCtx = createMessageContext(-100100, 77);

    threadContextManager.activateFromContext(topicCtx);

    expect(threadContextManager.canAutoAssignProjectForActiveContext()).toBe(true);
    expect(threadContextManager.canAutoAssignSessionForActiveContext()).toBe(true);

    threadContextManager.bindProjectToActiveContext({ id: "project-1", worktree: "/repo" });
    threadContextManager.bindSessionToActiveContext({
      id: "session-1",
      title: "Topic Session",
      directory: "/repo",
    });

    expect(threadContextManager.canAutoAssignProjectForActiveContext()).toBe(false);
    expect(threadContextManager.canAutoAssignSessionForActiveContext()).toBe(false);
  });

  it("restores bound project and session for the same topic", () => {
    const topicCtx = createMessageContext(-100100, 77);

    threadContextManager.activateFromContext(topicCtx);
    threadContextManager.bindProjectToActiveContext({ id: "project-1", worktree: "/repo" });
    threadContextManager.bindSessionToActiveContext({
      id: "session-1",
      title: "Topic Session",
      directory: "/repo",
    });

    mocked.currentProject = { id: "project-2", worktree: "/other" };
    mocked.currentSession = { id: "session-2", title: "Other", directory: "/other" };

    threadContextManager.activateFromContext(topicCtx);

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith({
      id: "project-1",
      worktree: "/repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Topic Session",
      directory: "/repo",
    });
    expect(threadContextManager.getSessionTarget("session-1")).toEqual({
      chatId: -100100,
      messageThreadId: 77,
    });
  });

  it("restores topic bindings after manager reset", () => {
    mocked.threadContextBindings = [
      {
        contextKey: "1001:-100100:91",
        project: { id: "project-1", worktree: "/repo" },
        session: { id: "session-1", title: "Persisted", directory: "/repo" },
      },
    ];

    threadContextManager.__resetForTests();
    threadContextManager.activateFromContext(createMessageContext(-100100, 91));

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith({
      id: "project-1",
      worktree: "/repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Persisted",
      directory: "/repo",
    });
    expect(threadContextManager.getSessionTarget("session-1")).toEqual({
      chatId: -100100,
      messageThreadId: 91,
    });
    expect(mocked.setThreadContextBindingsMock).toHaveBeenCalledWith([
      {
        contextKey: "-100100:91",
        project: { id: "project-1", worktree: "/repo" },
        session: { id: "session-1", title: "Persisted", directory: "/repo" },
      },
    ]);
  });

  it("recovers persisted topic bindings when stored chat id changed", () => {
    mocked.threadContextBindings = [
      {
        contextKey: "1001:6931112349:238502",
        project: { id: "project-1", worktree: "/repo" },
        session: { id: "session-1", title: "Persisted", directory: "/repo" },
      },
    ];

    threadContextManager.__resetForTests();
    threadContextManager.activateFromContext(createMessageContext(-100100, 238502));

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith({
      id: "project-1",
      worktree: "/repo",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-1",
      title: "Persisted",
      directory: "/repo",
    });
    expect(threadContextManager.getSessionTarget("session-1")).toEqual({
      chatId: -100100,
      messageThreadId: 238502,
    });
    expect(mocked.setThreadContextBindingsMock).toHaveBeenCalledWith([
      {
        contextKey: "-100100:238502",
        project: { id: "project-1", worktree: "/repo" },
        session: { id: "session-1", title: "Persisted", directory: "/repo" },
      },
    ]);
  });

  it("shares the same topic binding across different users", () => {
    const userOneCtx = createMessageContext(-100100, 77, 1001);
    const userTwoCtx = createMessageContext(-100100, 77, 2002);

    threadContextManager.activateFromContext(userOneCtx);
    threadContextManager.bindProjectToActiveContext({ id: "project-topic", worktree: "/repo-1" });
    threadContextManager.bindSessionToActiveContext({
      id: "session-topic",
      title: "Shared Topic",
      directory: "/repo-1",
    });

    mocked.currentProject = { id: "project-user-2", worktree: "/repo-2" };
    mocked.currentSession = { id: "session-user-2", title: "User Two", directory: "/repo-2" };
    threadContextManager.activateFromContext(userTwoCtx);

    mocked.setCurrentProjectMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.currentProject = { id: "other", worktree: "/other" };
    mocked.currentSession = { id: "other-session", title: "Other", directory: "/other" };

    threadContextManager.activateFromContext(userTwoCtx);

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith({
      id: "project-topic",
      worktree: "/repo-1",
    });
    expect(mocked.setCurrentSessionMock).toHaveBeenCalledWith({
      id: "session-topic",
      title: "Shared Topic",
      directory: "/repo-1",
    });
  });
});
