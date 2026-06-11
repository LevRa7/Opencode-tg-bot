import { beforeEach, describe, expect, it, vi } from "vitest";
import { __routingTest, routingBySessionId } from "../../../src/bot/index.js";
import { createFakeBot, createFakeBotApi } from "./_mocks/fake-bot.js";
import { makeScope, uniqueSessionId } from "./_mocks/test-utils.js";

const { isSessionCurrent, getSessionRoutingTarget, getSessionRoutingApi } = __routingTest;

const attachManagerModule = await import("../../../src/attach/manager.js");
const threadContextManagerModule = await import("../../../src/thread/manager.js");

vi.mock("../../../src/attach/manager.js", () => ({
  attachManager: {
    getTargetForSession: vi.fn(() => null),
    getScopeForSession: vi.fn(() => null),
    attach: vi.fn(),
    detach: vi.fn(),
    setBusy: vi.fn(),
    __resetForTests: vi.fn(),
  },
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    getSessionTarget: vi.fn(() => null),
    getSessionScope: vi.fn(() => null),
    getActiveScope: vi.fn(() => null),
    findForumChatIdForUser: vi.fn(() => null),
    updateModelBinding: vi.fn(),
    getSessionDirectory: vi.fn(() => "/test/dir"),
  },
}));

const { attachManager } = attachManagerModule;
const { threadContextManager } = threadContextManagerModule;

function mockForumChat(userId: number, chatId: number): void {
  vi.mocked(threadContextManager.findForumChatIdForUser).mockImplementation((uid: number) =>
    uid === userId ? chatId : null,
  );
}

function setupFakeCreateForumTopic(threadId: number): void {
  const api = createFakeBotApi({
    createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: threadId }),
  });
  const bot = createFakeBot(api);
  __routingTest.activeBotInstance = bot;
}

function makeMinimalSession(sessionId: string, title = "Web Session"): unknown {
  return {
    id: sessionId,
    title,
    status: "running",
    directory: "/test/dir",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    configuredAgent: undefined,
    configuredProviderID: null,
    configuredModelID: null,
  };
}

function getCreateForumTopicMock() {
  return vi.mocked(__routingTest.activeBotInstance?.api.createForumTopic ?? vi.fn());
}

function getAttachMock() {
  return vi.mocked(attachManager.attach);
}

beforeEach(() => {
  routingBySessionId.clear();
  vi.clearAllMocks();
  __routingTest.activeBotInstance = null;
});

// ================================================================================
// 6.1.8 Auto-topic creation for web sessions
// ================================================================================

describe("Auto-topic creation for web sessions", () => {
  it("должен создать форум-топик для веб-сессии без routing и установить routing", async () => {
    const sessionId = uniqueSessionId();
    const userId = 100;
    const chatId = -100123;
    const newThreadId = 55;

    mockForumChat(userId, chatId);
    setupFakeCreateForumTopic(newThreadId);
    const session = makeMinimalSession(sessionId, "My Web Session");

    const result = await __routingTest.tryAutoCreateSessionTopic(sessionId, userId, session);

    expect(result).toBe(true);
    const createTopicMock = getCreateForumTopicMock();
    expect(createTopicMock).toHaveBeenCalledWith(chatId, "My Web Session");

    const attachMock = getAttachMock();
    expect(attachMock).toHaveBeenCalled();
    const attachCall = attachMock.mock.calls[0];
    const scopeArg = attachCall[0] as { userId: number; chatId: number; messageThreadId?: number };
    expect(scopeArg.userId).toBe(userId);
    expect(scopeArg.chatId).toBe(chatId);
    expect(scopeArg.messageThreadId).toBe(newThreadId);

    const routing = routingBySessionId.get(sessionId);
    expect(routing).toBeDefined();
    expect(routing!.target).toEqual({ chatId, messageThreadId: newThreadId });
    expect(routing!.targetSource).toBe("attached");
  });

  it("не должен создавать дубликат топика при повторном вызове", async () => {
    const sessionId = uniqueSessionId();
    const userId = 100;
    const chatId = -100123;
    mockForumChat(userId, chatId);
    setupFakeCreateForumTopic(55);
    const session = makeMinimalSession(sessionId);

    await __routingTest.tryAutoCreateSessionTopic(sessionId, userId, session);
    await __routingTest.tryAutoCreateSessionTopic(sessionId, userId, session);

    const createTopicMock = getCreateForumTopicMock();
    expect(createTopicMock).toHaveBeenCalledTimes(1);
  });

  it("не должен создавать топик, если routing уже существует (prompt или attached)", async () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    routingBySessionId.set(sessionId, {
      bot,
      target: { chatId: -100 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });

    const result = await __routingTest.tryAutoCreateSessionTopic(sessionId, 100, makeMinimalSession(sessionId));

    expect(result).toBe(true);
    const createTopicMock = getCreateForumTopicMock();
    expect(createTopicMock).not.toHaveBeenCalled();
    const attachMock = getAttachMock();
    expect(attachMock).not.toHaveBeenCalled();
  });

  it("должен вернуть false если нет форум-чата для пользователя", async () => {
    const sessionId = uniqueSessionId();
    vi.mocked(threadContextManager.findForumChatIdForUser).mockReturnValue(null);

    const result = await __routingTest.tryAutoCreateSessionTopic(sessionId, 100, makeMinimalSession(sessionId));

    expect(result).toBe(false);
    const createTopicMock = getCreateForumTopicMock();
    expect(createTopicMock).not.toHaveBeenCalled();
  });

  it("должен вернуть false если bot не инициализирован", async () => {
    const sessionId = uniqueSessionId();
    const userId = 100;
    const chatId = -100123;
    mockForumChat(userId, chatId);
    __routingTest.activeBotInstance = null;

    const result = await __routingTest.tryAutoCreateSessionTopic(sessionId, userId, makeMinimalSession(sessionId));

    expect(result).toBe(false);
  });

  it("должен доставить сообщение в созданный топик после автосоздания", async () => {
    const sessionId = uniqueSessionId();
    const userId = 100;
    const chatId = -100123;
    const newThreadId = 77;
    mockForumChat(userId, chatId);
    setupFakeCreateForumTopic(newThreadId);
    vi.mocked(attachManager.getTargetForSession).mockReturnValue({ chatId, messageThreadId: newThreadId });
    vi.mocked(attachManager.getScopeForSession).mockReturnValue(makeScope(userId, chatId, newThreadId));

    await __routingTest.tryAutoCreateSessionTopic(sessionId, userId, makeMinimalSession(sessionId));

    expect(isSessionCurrent(sessionId)).toBe(true);

    const target = getSessionRoutingTarget(sessionId);
    expect(target).toEqual({ chatId, messageThreadId: newThreadId });

    const api = getSessionRoutingApi(sessionId);
    expect(api).toBeDefined();
    expect(api).toBe(__routingTest.activeBotInstance?.api);
  });
});

// ================================================================================
// 6.1.9 Bidirectional topic-session sync
// ================================================================================

describe("Bidirectional topic-session sync", () => {
  describe("Topic → Session rebind (I10)", () => {
    it("должен отвязать старую сессию при привязке новой к тому же топику", async () => {
      const oldSessionId = uniqueSessionId("old");
      const newSessionId = uniqueSessionId("new");
      const userId = 100;
      const chatId = -100123;
      const threadId = 42;

      mockForumChat(userId, chatId);
      setupFakeCreateForumTopic(threadId);

      await __routingTest.tryAutoCreateSessionTopic(oldSessionId, userId, makeMinimalSession(oldSessionId));

      vi.mocked(attachManager.getTargetForSession).mockImplementation((sid: string) => {
        if (sid === oldSessionId) return { chatId, messageThreadId: threadId };
        return null;
      });
      vi.mocked(attachManager.getScopeForSession).mockImplementation((sid: string) => {
        if (sid === oldSessionId) return makeScope(userId, chatId, threadId);
        return null;
      });

      vi.mocked(attachManager.attach).mockImplementation(
        (scope: { userId: number; chatId: number; messageThreadId?: number }, _session: unknown) => {
          vi.mocked(attachManager.getTargetForSession).mockImplementation((sid: string) => {
            if (sid === newSessionId) return { chatId: scope.chatId, messageThreadId: scope.messageThreadId };
            if (sid === oldSessionId) return null;
            return null;
          });
          vi.mocked(attachManager.getScopeForSession).mockImplementation((sid: string) => {
            if (sid === newSessionId) return { ...scope };
            if (sid === oldSessionId) return null;
            return null;
          });
        },
      );

      const targetBefore = getSessionRoutingTarget(oldSessionId);
      expect(targetBefore).toBeDefined();

      await __routingTest.tryAutoCreateSessionTopic(newSessionId, userId, makeMinimalSession(newSessionId, "New"));

      expect(isSessionCurrent(oldSessionId)).toBe(false);
      expect(isSessionCurrent(newSessionId)).toBe(true);
    });
  });
});
