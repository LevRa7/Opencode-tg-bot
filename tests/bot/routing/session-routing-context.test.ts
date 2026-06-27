import { beforeEach, describe, expect, it, vi } from "vitest";
import { __routingTest, routingBySessionId } from "../../../src/bot/index.js";
import { createFakeBot, createFakeBotApi } from "./_mocks/fake-bot.js";
import { makeScope, uniqueSessionId } from "./_mocks/test-utils.js";
import type { ActiveSessionEntry } from "../../../src/active-session/tracker.js";

const {
  syncSessionRoutingContext,
  getSessionRoutingContext,
  clearSessionRoutingContext,
  getSessionRoutingTarget,
  getSessionDeliveryTarget,
  getSessionRoutingApi,
  getSessionRoutingScope,
  resolveAttachedSessionTarget,
  hasLiveSessionTarget,
  isSessionCurrent,
  isSessionRoutingLiveAttached,
  buildThinkingRoutingIdentity,
  cloneRoutingContextForChildSession,
  seedChildRoutingFromSubagent,
  setSessionRoutingContext,
} = __routingTest;

const attachManagerModule = await import("../../../src/attach/manager.js");
const threadContextManagerModule = await import("../../../src/thread/manager.js");
const promptModule = await import("../../../src/bot/handlers/prompt.js");

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

vi.mock("../../../src/bot/handlers/prompt.js", () => {
  const map = new Map<string, unknown>();
  return {
    getPromptRoutingContext: vi.fn((sessionId: string) => map.get(sessionId) ?? null),
    clearPromptRouting: vi.fn((sessionId: string) => map.delete(sessionId)),
  };
});

const activeSessionRecoveryMocks = vi.hoisted(() => ({
  findActiveSessionById: vi.fn<[string], ActiveSessionEntry | null>(),
}));

vi.mock("../../../src/active-session/tracker.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/active-session/tracker.js")>();
  return {
    ...actual,
    findActiveSessionById: activeSessionRecoveryMocks.findActiveSessionById,
  };
});

const { attachManager } = attachManagerModule;
const { threadContextManager } = threadContextManagerModule;
const { getPromptRoutingContext } = promptModule;

function seedPromptRouting(
  sessionId: string,
  overrides: Record<string, unknown> = {},
): void {
  vi.mocked(getPromptRoutingContext).mockImplementation((sid: string) => {
    if (sid === sessionId) {
      return {
        bot: overrides.bot ?? createFakeBot(),
        target: overrides.target ?? { chatId: 1 },
        scope: overrides.scope ?? { userId: 1, chatId: 1 },
        isForumChat: (overrides.isForumChat as boolean) ?? false,
        sourceMessageId: (overrides.sourceMessageId as number) ?? 42,
        suppressSendErrorMessage: (overrides.suppressSendErrorMessage as boolean) ?? false,
      };
    }
    return null;
  });
}

function mockAttachTarget(
  sessionId: string,
  target: { chatId: number; messageThreadId?: number } | null,
  scope?: { userId: number; chatId: number; messageThreadId?: number } | null,
): void {
  vi.mocked(attachManager.getTargetForSession).mockImplementation((sid: string) =>
    sid === sessionId ? target : null,
  );
  vi.mocked(attachManager.getScopeForSession).mockImplementation((sid: string) => {
    if (sid === sessionId) {
      return scope ?? (target ? { userId: 1, chatId: target.chatId, messageThreadId: target.messageThreadId } : null);
    }
    return null;
  });
}

function mockThreadTarget(
  sessionId: string,
  target: { chatId: number; messageThreadId?: number } | null,
): void {
  vi.mocked(threadContextManager.getSessionTarget).mockImplementation((sid: string) =>
    sid === sessionId ? target : null,
  );
}

beforeEach(() => {
  routingBySessionId.clear();
  vi.clearAllMocks();
  activeSessionRecoveryMocks.findActiveSessionById.mockReset().mockReturnValue(null);
});

// ================================================================================
// syncSessionRoutingContext
// ================================================================================

describe("syncSessionRoutingContext", () => {
  // Инварианты: I3 (attached предпочтительнее prompt), I7 (targetSource согласован)

  it("должен использовать attached target, когда есть и attached, и prompt", () => {
    const sessionId = uniqueSessionId();
    seedPromptRouting(sessionId, { target: { chatId: 1, messageThreadId: 10 } });
    mockAttachTarget(sessionId, { chatId: 1, messageThreadId: 20 });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).not.toBeNull();
    expect(routing!.target).toEqual({ chatId: 1, messageThreadId: 20 });
    expect(routing!.deliveryTarget).toEqual({ chatId: 1, messageThreadId: 20 });
    expect(routing!.targetSource).toBe("attached");
  });

  it("должен использовать prompt target, когда attached отсутствует", () => {
    const sessionId = uniqueSessionId();
    seedPromptRouting(sessionId, { target: { chatId: 1, messageThreadId: 10 } });
    mockAttachTarget(sessionId, null);

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).not.toBeNull();
    expect(routing!.target).toEqual({ chatId: 1, messageThreadId: 10 });
    expect(routing!.targetSource).toBe("prompt");
  });

  it("должен вернуть существующий routing, когда promptRouting отсутствует", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    const existingRouting = {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "attached" as const,
    };
    setSessionRoutingContext(sessionId, existingRouting);

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).toEqual(existingRouting);
    expect(routing!.targetSource).toBe("attached");
  });

  it("должен вернуть null, когда нет ни prompt, ни существующего routing", () => {
    const sessionId = uniqueSessionId();
    const routing = syncSessionRoutingContext(sessionId);
    expect(routing).toBeNull();
  });

  it("должен установить deliveryTarget равным attached target при его наличии", () => {
    const sessionId = uniqueSessionId();
    seedPromptRouting(sessionId, { target: { chatId: 1, messageThreadId: 10 } });
    mockAttachTarget(sessionId, { chatId: 1, messageThreadId: 30 });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing!.deliveryTarget).toEqual({ chatId: 1, messageThreadId: 30 });
  });

  it("должен сохранить sourceMessageId из promptRouting", () => {
    const sessionId = uniqueSessionId();
    seedPromptRouting(sessionId, { sourceMessageId: 99 });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing!.sourceMessageId).toBe(99);
  });
});

// ================================================================================
// getSessionRoutingTarget
// ================================================================================

describe("getSessionRoutingTarget", () => {
  // Инварианты: I2 (уникальность target), priority attached > thread > session

  it("должен вернуть attached target в приоритете над session routing target", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1, messageThreadId: 20 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });
    mockAttachTarget(sessionId, { chatId: 1, messageThreadId: 10 });

    const target = getSessionRoutingTarget(sessionId);

    expect(target).toEqual({ chatId: 1, messageThreadId: 10 });
  });

  it("должен вернуть threadContextManager target, если attachManager возвращает null", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, { chatId: 1, messageThreadId: 30 });

    const target = getSessionRoutingTarget(sessionId);

    expect(target).toEqual({ chatId: 1, messageThreadId: 30 });
  });

  it("должен вернуть session routing target, если и attach, и thread возвращают null", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 2, messageThreadId: 40 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    const target = getSessionRoutingTarget(sessionId);

    expect(target).toEqual({ chatId: 2, messageThreadId: 40 });
  });

  it("должен вернуть undefined, когда все источники пусты", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    const target = getSessionRoutingTarget(sessionId);

    expect(target).toBeUndefined();
  });
});

// ================================================================================
// getSessionRoutingApi
// ================================================================================

describe("getSessionRoutingApi", () => {
  // Инварианты: I4 (защита от fallback на activeBotInstance)

  it("должен вернуть routing.bot.api при наличии routing context", () => {
    const sessionId = uniqueSessionId();
    const api = createFakeBotApi();
    const bot = createFakeBot(api);
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });

    const result = getSessionRoutingApi(sessionId);

    expect(result).toBe(api);
  });

  it("НЕ должен возвращать activeBotInstance.api, если routing context существует (регрессия V1)", () => {
    const sessionId = uniqueSessionId();
    const routingApi = createFakeBotApi();
    const routingBot = createFakeBot(routingApi);
    const globalApi = createFakeBotApi();
    const globalBot = createFakeBot(globalApi);

    setSessionRoutingContext(sessionId, {
      bot: routingBot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });
    __routingTest.activeBotInstance = globalBot;

    const result = getSessionRoutingApi(sessionId);

    expect(result).toBe(routingApi);
    expect(result).not.toBe(globalApi);

    __routingTest.activeBotInstance = null;
  });

  it("должен вернуть activeBotInstance.api при отсутствии routing context", () => {
    const sessionId = uniqueSessionId();
    const globalApi = createFakeBotApi();
    const globalBot = createFakeBot(globalApi);
    __routingTest.activeBotInstance = globalBot;

    const result = getSessionRoutingApi(sessionId);

    expect(result).toBe(globalApi);

    __routingTest.activeBotInstance = null;
  });

  it("должен вернуть null, когда нет ни routing, ни activeBotInstance", () => {
    const sessionId = uniqueSessionId();
    __routingTest.activeBotInstance = null;

    const result = getSessionRoutingApi(sessionId);

    expect(result).toBeNull();
  });
});

// ================================================================================
// isSessionCurrent
// ================================================================================

describe("isSessionCurrent", () => {
  // Инварианты: I5 (stale доставка блокируется), V2 (prompt targetSource)

  it("должен вернуть false, когда api недоступен", () => {
    const sessionId = uniqueSessionId();
    __routingTest.activeBotInstance = null;

    expect(isSessionCurrent(sessionId)).toBe(false);
  });

  it("должен вернуть true для targetSource='prompt' даже без attached target", () => {
    // V2: текущее поведение — prompt-based sessions always current
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });
    mockAttachTarget(sessionId, null);

    expect(isSessionCurrent(sessionId)).toBe(true);
  });

  it("должен вернуть true для targetSource='attached' при наличии живого attached target", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: null,
      scope: null,
      targetSource: "attached",
    });
    mockAttachTarget(sessionId, { chatId: 1, messageThreadId: 10 });

    expect(isSessionCurrent(sessionId)).toBe(true);
  });

  it("должен вернуть false для targetSource='attached' при отсутствии живого attached target", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: null,
      scope: null,
      targetSource: "attached",
    });
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    expect(isSessionCurrent(sessionId)).toBe(false);
  });

  it("должен вернуть true при deliveryTarget.disableNotification, даже если attached target мёртв", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: { chatId: 1, messageThreadId: 10, disableNotification: true },
      scope: null,
      targetSource: "attached",
    });
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    expect(isSessionCurrent(sessionId)).toBe(true);
  });

  it("должен вернуть результат hasLiveSessionTarget, когда routing отсутствует, но api есть", () => {
    const sessionId = uniqueSessionId();
    const globalBot = createFakeBot();
    __routingTest.activeBotInstance = globalBot;
    mockAttachTarget(sessionId, { chatId: 1, messageThreadId: 10 });

    expect(isSessionCurrent(sessionId)).toBe(true);

    __routingTest.activeBotInstance = null;
  });
});

// ================================================================================
// resolveAttachedSessionTarget
// ================================================================================

describe("resolveAttachedSessionTarget", () => {
  it("должен вернуть attachManager target в приоритете над threadContextManager", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, { chatId: 1, messageThreadId: 10 });
    mockThreadTarget(sessionId, { chatId: 1, messageThreadId: 20 });

    const target = resolveAttachedSessionTarget(sessionId);

    expect(target).toEqual({ chatId: 1, messageThreadId: 10 });
  });

  it("должен вернуть threadContextManager target, если attachManager возвращает null", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, { chatId: 2, messageThreadId: 30 });

    const target = resolveAttachedSessionTarget(sessionId);

    expect(target).toEqual({ chatId: 2, messageThreadId: 30 });
  });

  it("должен вернуть null/undefined, когда оба менеджера возвращают null", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    const target = resolveAttachedSessionTarget(sessionId);

    expect(target).toBeNull();
  });
});

// ================================================================================
// hasLiveSessionTarget
// ================================================================================

describe("hasLiveSessionTarget", () => {
  it("должен вернуть true при наличии attached target", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, { chatId: 1 });

    expect(hasLiveSessionTarget(sessionId)).toBe(true);
  });

  it("должен вернуть true при наличии thread target", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, { chatId: 1 });

    expect(hasLiveSessionTarget(sessionId)).toBe(true);
  });

  it("должен вернуть false при отсутствии всех target", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    expect(hasLiveSessionTarget(sessionId)).toBe(false);
  });
});

// ================================================================================
// getSessionDeliveryTarget
// ================================================================================

describe("getSessionDeliveryTarget", () => {
  it("должен вернуть routing.deliveryTarget, если он установлен", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: { chatId: 1, messageThreadId: 20, disableNotification: true },
      scope: null,
      targetSource: "prompt",
    });

    const result = getSessionDeliveryTarget(sessionId);
    expect(result).toEqual({ chatId: 1, messageThreadId: 20, disableNotification: true });
  });

  it("должен вернуть getSessionRoutingTarget если deliveryTarget не установлен", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });

    const result = getSessionDeliveryTarget(sessionId);
    expect(result).toEqual({ chatId: 1, messageThreadId: 10 });
  });

  it("должен вернуть null когда нет ни routing, ни target", () => {
    const sessionId = uniqueSessionId();
    mockAttachTarget(sessionId, null);
    mockThreadTarget(sessionId, null);

    expect(getSessionDeliveryTarget(sessionId)).toBeNull();
  });
});

// ================================================================================
// getSessionRoutingContext
// ================================================================================

describe("getSessionRoutingContext", () => {
  it("должен вернуть существующий routing без sync если он есть", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    const ctx = {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt" as const,
    };
    setSessionRoutingContext(sessionId, ctx);

    const result = getSessionRoutingContext(sessionId);
    expect(result).toEqual(ctx);
  });

  it("должен вернуть null если routing отсутствует и нет prompt routing", () => {
    const sessionId = uniqueSessionId();
    const result = getSessionRoutingContext(sessionId);
    expect(result).toBeNull();
  });
});

// ================================================================================
// clearSessionRoutingContext
// ================================================================================

describe("clearSessionRoutingContext", () => {
  // Инвариант: I3 (после clear — никакой доставки)

  it("должен удалить routing из routingBySessionId", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });

    clearSessionRoutingContext(sessionId);

    expect(routingBySessionId.get(sessionId)).toBeUndefined();
  });

  it("не должен падать, если сессия не существует", () => {
    expect(() => clearSessionRoutingContext("nonexistent")).not.toThrow();
  });
});

// ================================================================================
// cloneRoutingContextForChildSession
// ================================================================================

describe("cloneRoutingContextForChildSession", () => {
  // Инварианты: I6 (child не может менять target), V5 (targetSource копируется)

  it("должен создать routing для child с указанным target", () => {
    const parentId = uniqueSessionId("parent");
    const childId = uniqueSessionId("child");
    const bot = createFakeBot();
    setSessionRoutingContext(parentId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: null,
      scope: makeScope(1, 1, 10),
      targetSource: "attached",
    });

    const result = cloneRoutingContextForChildSession({
      parentSessionId: parentId,
      childSessionId: childId,
      target: { chatId: 1, messageThreadId: 20 },
    });

    expect(result).toBe(true);
    const childRouting = routingBySessionId.get(childId);
    expect(childRouting).toBeDefined();
    expect(childRouting!.target).toEqual({ chatId: 1, messageThreadId: 20 });
  });

  it("должен скопировать targetSource с родителя", () => {
    const parentId = uniqueSessionId("parent");
    const childId = uniqueSessionId("child");
    const bot = createFakeBot();
    setSessionRoutingContext(parentId, {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "attached",
    });

    cloneRoutingContextForChildSession({
      parentSessionId: parentId,
      childSessionId: childId,
      target: { chatId: 1 },
    });

    expect(routingBySessionId.get(childId)!.targetSource).toBe("attached");
  });

  it("должен вернуть false, если родительский routing отсутствует", () => {
    const result = cloneRoutingContextForChildSession({
      parentSessionId: "nonexistent",
      childSessionId: uniqueSessionId("child"),
      target: { chatId: 1 },
    });

    expect(result).toBe(false);
  });
});

// ================================================================================
// seedChildRoutingFromSubagent
// ================================================================================

describe("seedChildRoutingFromSubagent", () => {
  it("должен вернуть false, если parent target отсутствует", () => {
    const parentId = uniqueSessionId("parent");
    const childId = uniqueSessionId("child");
    mockAttachTarget(parentId, null);
    mockThreadTarget(parentId, null);

    const result = seedChildRoutingFromSubagent({
      parentSessionId: parentId,
      childSessionId: childId,
      topicName: "test",
    });

    expect(result).toBe(false);
  });

  it("должен создать routing для child с parent target", () => {
    const parentId = uniqueSessionId("parent");
    const childId = uniqueSessionId("child");
    const bot = createFakeBot();
    setSessionRoutingContext(parentId, {
      bot,
      target: { chatId: 1, messageThreadId: 10 },
      deliveryTarget: null,
      scope: makeScope(1, 1, 10),
      targetSource: "attached",
    });
    mockAttachTarget(parentId, { chatId: 1, messageThreadId: 10 });

    const result = seedChildRoutingFromSubagent({
      parentSessionId: parentId,
      childSessionId: childId,
      topicName: "test",
    });

    expect(result).toBe(true);
    const childRouting = routingBySessionId.get(childId);
    expect(childRouting).toBeDefined();
    expect(childRouting!.target).toEqual({ chatId: 1, messageThreadId: 10 });
  });
});

// ================================================================================
// buildThinkingRoutingIdentity
// ================================================================================

describe("buildThinkingRoutingIdentity", () => {
  it("должен вернуть 'chatId:threadId' при наличии messageThreadId", () => {
    expect(buildThinkingRoutingIdentity({ chatId: 123, messageThreadId: 456 })).toBe("123:456");
  });

  it("должен вернуть 'chatId:main' при отсутствии messageThreadId", () => {
    expect(buildThinkingRoutingIdentity({ chatId: 789 })).toBe("789:main");
  });
});

// ================================================================================
// isSessionRoutingLiveAttached
// ================================================================================

describe("isSessionRoutingLiveAttached", () => {
  it("должен вернуть true при targetSource='attached'", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "attached",
    });

    expect(isSessionRoutingLiveAttached(sessionId)).toBe(true);
  });

  it("должен вернуть false при targetSource='prompt'", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 1 },
      deliveryTarget: null,
      scope: null,
      targetSource: "prompt",
    });

    expect(isSessionRoutingLiveAttached(sessionId)).toBe(false);
  });

  it("должен вернуть false при отсутствии routing context", () => {
    expect(isSessionRoutingLiveAttached("nonexistent")).toBe(false);
  });
});

// ================================================================================
// getSessionRoutingScope
// ================================================================================

describe("getSessionRoutingScope", () => {
  it("должен вернуть scope из routing context, если он есть", () => {
    const sessionId = uniqueSessionId();
    const bot = createFakeBot();
    const scope = makeScope(1, 2, 10);
    setSessionRoutingContext(sessionId, {
      bot,
      target: { chatId: 2, messageThreadId: 10 },
      deliveryTarget: null,
      scope,
      targetSource: "attached",
    });

    expect(getSessionRoutingScope(sessionId)).toEqual(scope);
  });

  it("должен вернуть attachManager scope если routing отсутствует", () => {
    const sessionId = uniqueSessionId();
    const scope = makeScope(1, 3, 20);
    vi.mocked(attachManager.getScopeForSession).mockReturnValue(scope);

    expect(getSessionRoutingScope(sessionId)).toEqual(scope);
  });

  it("должен вернуть threadContextManager scope если attachManager возвращает null", () => {
    const sessionId = uniqueSessionId();
    const scope = makeScope(1, 4, 30);
    vi.mocked(attachManager.getScopeForSession).mockReturnValue(null);
    vi.mocked(threadContextManager.getSessionScope).mockReturnValue(scope);

    expect(getSessionRoutingScope(sessionId)).toEqual(scope);
  });

  it("должен вернуть null когда все источники пусты", () => {
    const sessionId = uniqueSessionId();
    vi.mocked(attachManager.getScopeForSession).mockReturnValue(null);
    vi.mocked(threadContextManager.getSessionScope).mockReturnValue(null);

    expect(getSessionRoutingScope(sessionId)).toBeNull();
  });
});

// ================================================================================
// syncSessionRoutingContext — recovery after restart
// ================================================================================

describe("syncSessionRoutingContext — recovery after restart", () => {
  it("должен восстановить routing из active-session tracker, когда promptRouting и attach пусты", () => {
    const sessionId = uniqueSessionId();
    __routingTest.activeBotInstance = createFakeBot();

    activeSessionRecoveryMocks.findActiveSessionById.mockReturnValue({
      sessionId,
      chatId: -1001234567890,
      messageThreadId: 42,
      timestamp: Date.now(),
    });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).not.toBeNull();
    expect(routing!.target).toEqual({ chatId: -1001234567890, messageThreadId: 42 });
    expect(routing!.targetSource).toBe("recovery");
    expect(routing!.deliveryTarget).toEqual({ chatId: -1001234567890, messageThreadId: 42 });

    __routingTest.activeBotInstance = null;
  });

  it("должен восстановить routing без messageThreadId, если active-session entry имеет null thread", () => {
    const sessionId = uniqueSessionId();
    __routingTest.activeBotInstance = createFakeBot();

    activeSessionRecoveryMocks.findActiveSessionById.mockReturnValue({
      sessionId,
      chatId: -1009876543210,
      messageThreadId: null,
      timestamp: Date.now(),
    });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).not.toBeNull();
    expect(routing!.target).toEqual({ chatId: -1009876543210 });
    expect(routing!.targetSource).toBe("recovery");

    __routingTest.activeBotInstance = null;
  });

  it("должен вернуть null, когда recovery tracker тоже ничего не нашёл", () => {
    const sessionId = uniqueSessionId();
    activeSessionRecoveryMocks.findActiveSessionById.mockReturnValue(null);

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).toBeNull();
  });

  it("должен предпочесть promptRouting восстановлению из recovery tracker", () => {
    const sessionId = uniqueSessionId();
    seedPromptRouting(sessionId, { target: { chatId: 1, messageThreadId: 10 } });
    activeSessionRecoveryMocks.findActiveSessionById.mockReturnValue({
      sessionId,
      chatId: -100555,
      messageThreadId: 99,
      timestamp: Date.now(),
    });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).not.toBeNull();
    expect(routing!.target).toEqual({ chatId: 1, messageThreadId: 10 });
    expect(routing!.targetSource).toBe("prompt");
  });

  it("должен предпочесть attached target восстановлению из recovery tracker", () => {
    const sessionId = uniqueSessionId();
    __routingTest.activeBotInstance = createFakeBot();
    mockAttachTarget(sessionId, { chatId: 3, messageThreadId: 30 });
    activeSessionRecoveryMocks.findActiveSessionById.mockReturnValue({
      sessionId,
      chatId: -100555,
      messageThreadId: 99,
      timestamp: Date.now(),
    });

    const routing = syncSessionRoutingContext(sessionId);

    expect(routing).not.toBeNull();
    expect(routing!.target).toEqual({ chatId: 3, messageThreadId: 30 });
    expect(routing!.targetSource).toBe("attached");

    __routingTest.activeBotInstance = null;
  });
});
