import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

type ThreadBindingMock = {
  contextKey: string;
  project?: { id: string; worktree: string; name?: string };
  session?: { id: string; title: string; directory: string };
  agent?: string;
  model?: { providerID: string; modelID: string; variant?: string };
};

const mocked = vi.hoisted(() => ({
  currentProject: undefined as { id: string; worktree: string; name?: string } | undefined,
  currentSession: null as { id: string; title: string; directory: string } | null,
  threadContextBindings: [] as ThreadBindingMock[],
  currentAgent: undefined as string | undefined,
  currentModel: undefined as { providerID: string; modelID: string; variant?: string } | undefined,
  setCurrentProjectMock: vi.fn(),
  setCurrentSessionMock: vi.fn(),
  setCurrentAgentMock: vi.fn(),
  setCurrentModelMock: vi.fn(),
  clearSessionMock: vi.fn(),
  setThreadContextBindingsMock: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
  getCurrentAgent: vi.fn(() => mocked.currentAgent),
  getCurrentModel: vi.fn(() => mocked.currentModel),
  getThreadContextBindings: vi.fn(() =>
    mocked.threadContextBindings.map((binding) => ({
      contextKey: binding.contextKey,
      project: binding.project ? { ...binding.project } : undefined,
      session: binding.session ? { ...binding.session } : undefined,
      agent: binding.agent,
      model: binding.model ? { ...binding.model } : undefined,
    })),
  ),
  setCurrentProject: vi.fn((project) => {
    mocked.currentProject = project;
    mocked.setCurrentProjectMock(project);
  }),
  setConversationCurrentProject: vi.fn((project) => {
    mocked.currentProject = project;
    mocked.setCurrentProjectMock(project);
  }),
  setCurrentAgent: vi.fn((agent) => {
    mocked.currentAgent = agent;
    mocked.setCurrentAgentMock(agent);
  }),
  setConversationCurrentAgent: vi.fn((agent) => {
    mocked.currentAgent = agent;
    mocked.setCurrentAgentMock(agent);
  }),
  setCurrentModel: vi.fn((model) => {
    mocked.currentModel = model;
    mocked.setCurrentModelMock(model);
  }),
  setConversationCurrentModel: vi.fn((model) => {
    mocked.currentModel = model;
    mocked.setCurrentModelMock(model);
  }),
  setThreadContextBindings: vi.fn((bindings) => {
    mocked.threadContextBindings = bindings.map(
      (binding: (typeof mocked.threadContextBindings)[number]) => ({
        contextKey: binding.contextKey,
        project: binding.project ? { ...binding.project } : undefined,
        session: binding.session ? { ...binding.session } : undefined,
        agent: binding.agent,
        model: binding.model ? { ...binding.model } : undefined,
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

function createMessageContext(
  chatId: number,
  messageThreadId?: number,
  userId = 1001,
  isForum = true,
): Context {
  return {
    from: { id: userId },
    chat: isForum
      ? { id: chatId, type: "supergroup", is_forum: true }
      : { id: chatId, type: "private" },
    message: {
      message_thread_id: messageThreadId,
    } as Context["message"],
  } as unknown as Context;
}

describe("thread/manager", () => {
  beforeEach(() => {
    mocked.currentProject = undefined;
    mocked.currentSession = null;
    mocked.currentAgent = undefined;
    mocked.currentModel = undefined;
    mocked.threadContextBindings = [];
    mocked.setCurrentProjectMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.setCurrentAgentMock.mockReset();
    mocked.setCurrentModelMock.mockReset();
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
    expect(threadContextManager.getSessionDirectory("session-existing")).toBe("/repo");
  });

  it("ignores non-threaded chats and clears the active topic", () => {
    const topicCtx = createMessageContext(-100100, 11);
    threadContextManager.activateFromContext(topicCtx);

    mocked.currentSession = {
      id: "session-direct",
      title: "Direct",
      directory: "/repo",
    };

    const target = threadContextManager.activateFromContext(
      createMessageContext(123456, undefined, 1001, false),
    );

    expect(target).toBeNull();
    expect(threadContextManager.getActiveTarget()).toBeNull();
    expect(mocked.clearSessionMock).not.toHaveBeenCalled();
    expect(threadContextManager.getSessionTarget("session-direct")).toBeNull();
    expect(mocked.setThreadContextBindingsMock).not.toHaveBeenCalled();
  });

  it("activates forum main topic even without a message thread id", () => {
    const mainCtx = createMessageContext(-100100, undefined);

    const target = threadContextManager.activateFromContext(mainCtx);

    expect(target).toEqual({
      chatId: -100100,
      messageThreadId: 0,
    });
    expect(threadContextManager.getActiveTarget()).toEqual({
      chatId: -100100,
      messageThreadId: 0,
    });

    threadContextManager.bindProjectToActiveContext({ id: "project-main", worktree: "/repo" });
    threadContextManager.bindSessionToActiveContext({
      id: "session-main",
      title: "Main Topic",
      directory: "/repo",
    });

    expect(threadContextManager.getSessionTarget("session-main")).toEqual({
      chatId: -100100,
      messageThreadId: 0,
    });
  });

  it("ignores private chats without a thread id", () => {
    mocked.currentSession = {
      id: "session-direct",
      title: "Direct",
      directory: "/repo",
    };

    const target = threadContextManager.activateFromContext(
      createMessageContext(123456, undefined, 1001, false),
    );

    expect(target).toBeNull();
    expect(threadContextManager.getActiveTarget()).toBeNull();
    expect(threadContextManager.getSessionTarget("session-direct")).toBeNull();
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
        agent: "plan",
        model: { providerID: "anthropic", modelID: "claude", variant: "fast" },
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
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("plan");
    expect(mocked.setCurrentModelMock).toHaveBeenCalledWith({
      providerID: "anthropic",
      modelID: "claude",
      variant: "fast",
    });
    expect(threadContextManager.getSessionTarget("session-1")).toEqual({
      chatId: -100100,
      messageThreadId: 91,
    });
    expect(threadContextManager.getSessionDirectory("session-1")).toBe("/repo");
    expect(mocked.setThreadContextBindingsMock).not.toHaveBeenCalled();
  });

  it("does not recover persisted topic bindings when stored chat id changed", () => {
    mocked.threadContextBindings = [
      {
        contextKey: "1001:2002:238502",
        project: { id: "project-1", worktree: "/repo" },
        session: { id: "session-1", title: "Persisted", directory: "/repo" },
      },
    ];

    threadContextManager.__resetForTests();
    threadContextManager.activateFromContext(createMessageContext(-100100, 238502));

    expect(mocked.setCurrentProjectMock).not.toHaveBeenCalled();
    expect(mocked.setCurrentSessionMock).not.toHaveBeenCalled();
    expect(threadContextManager.getSessionTarget("session-1")).toEqual({
      chatId: 2002,
      messageThreadId: 238502,
    });
  });

  it("keeps topic bindings isolated per user", () => {
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
    mocked.currentAgent = "plan";
    mocked.currentModel = { providerID: "anthropic", modelID: "claude-3-5", variant: "sonnet" };
    threadContextManager.activateFromContext(userTwoCtx);

    mocked.setCurrentProjectMock.mockReset();
    mocked.setCurrentSessionMock.mockReset();
    mocked.setCurrentAgentMock.mockReset();
    mocked.setCurrentModelMock.mockReset();
    mocked.setThreadContextBindingsMock.mockReset();
    mocked.currentProject = { id: "other", worktree: "/other" };
    mocked.currentSession = { id: "other-session", title: "Other", directory: "/other" };
    mocked.currentAgent = "other-agent";
    mocked.currentModel = { providerID: "openai", modelID: "gpt-4" };

    threadContextManager.activateFromContext(userTwoCtx);

    expect(mocked.setCurrentProjectMock).toHaveBeenCalledWith({
      id: "project-user-2",
      worktree: "/repo-2",
    });
    expect(mocked.setCurrentAgentMock).toHaveBeenCalledWith("plan");
    expect(mocked.setCurrentModelMock).toHaveBeenCalledWith({
      providerID: "anthropic",
      modelID: "claude-3-5",
      variant: "sonnet",
    });
    expect(mocked.setThreadContextBindingsMock).not.toHaveBeenCalled();
  });

  it("does NOT auto-bind existing session to new topic - creates isolation", () => {
    mocked.currentProject = { id: "project-existing", worktree: "/repo" };
    mocked.currentSession = {
      id: "session-existing",
      title: "Existing Session",
      directory: "/repo",
    };

    threadContextManager.activateFromContext(createMessageContext(-100100, 10));

    expect(threadContextManager.getSessionTarget("session-existing")).toEqual({
      chatId: -100100,
      messageThreadId: 10,
    });

    mocked.currentProject = { id: "project-existing", worktree: "/repo" };
    mocked.currentSession = {
      id: "session-existing",
      title: "Existing Session",
      directory: "/repo",
    };
    mocked.threadContextBindings = [
      {
        contextKey: "1001:-100100:10",
        session: { id: "session-existing", title: "Existing Session", directory: "/repo" },
        project: { id: "project-existing", worktree: "/repo" },
      },
    ];

    threadContextManager.__resetForTests();
    threadContextManager.activateFromContext(createMessageContext(-100100, 20));

    const bindings = mocked.setThreadContextBindingsMock.mock.calls[0]?.[0] ?? [];
    const topic20Binding = bindings.find(
      (b: ThreadBindingMock) => b.contextKey === "1001:-100100:20",
    );
    expect(topic20Binding?.session).toBeUndefined();
  });

  it("keeps a session locked to its original thread after switching to main chat", () => {
    mocked.currentProject = { id: "project-existing", worktree: "/repo" };
    mocked.currentSession = {
      id: "session-existing",
      title: "Existing Session",
      directory: "/repo",
    };

    threadContextManager.activateFromContext(createMessageContext(-100100, 10));
    expect(threadContextManager.getSessionTarget("session-existing")).toEqual({
      chatId: -100100,
      messageThreadId: 10,
    });

    threadContextManager.activateFromContext(createMessageContext(123456));

    expect(threadContextManager.getSessionTarget("session-existing")).toEqual({
      chatId: -100100,
      messageThreadId: 10,
    });
  });

  it("new topic without binding should not inherit session from another topic", () => {
    mocked.threadContextBindings = [
      {
        contextKey: "1001:-100100:10",
        session: { id: "session-topic-10", title: "Topic 10 Session", directory: "/repo" },
        project: { id: "project-1", worktree: "/repo" },
      },
    ];

    threadContextManager.__resetForTests();

    mocked.currentSession = {
      id: "session-topic-10",
      title: "Topic 10 Session",
      directory: "/repo",
    };
    mocked.currentProject = { id: "project-1", worktree: "/repo" };

    threadContextManager.activateFromContext(createMessageContext(-100100, 20));

    const bindings = mocked.setThreadContextBindingsMock.mock.calls[0]?.[0] ?? [];
    const topic20Binding = bindings.find(
      (b: ThreadBindingMock) => b.contextKey === "1001:-100100:20",
    );
    expect(topic20Binding?.session).toBeUndefined();
  });
});
