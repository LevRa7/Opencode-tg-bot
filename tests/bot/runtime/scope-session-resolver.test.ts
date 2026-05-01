import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import type { SessionInfo } from "../../../src/settings/manager.js";
import {
  getCurrentTelegramConversationScope,
} from "../../../src/telegram/scope.js";
import { attachManager } from "../../../src/attach/manager.js";

const SCOPE_A = { userId: 1, chatId: 100, messageThreadId: 10 };

const SESSION_A: SessionInfo = { id: "session-a", title: "Session A", directory: "/dir/a" };
const SESSION_B: SessionInfo = { id: "session-b", title: "Session B", directory: "/dir/b" };

const mocked = vi.hoisted(() => ({
  extractScope: vi.fn<(ctx: Context) => typeof SCOPE_A | null>(),
  getCurrentSessionFallback: vi.fn<() => SessionInfo | null>(),
}));

vi.mock("../../../src/telegram/scope.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/telegram/scope.js")>();
  return {
    ...actual,
    extractTelegramConversationScopeFromContext: mocked.extractScope,
  };
});

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.getCurrentSessionFallback()),
}));

describe("bot/runtime/scope-session-resolver", () => {
  let resolveScopedSessionFromContext: typeof import("../../../src/bot/runtime/scope-session-resolver.js").resolveScopedSessionFromContext;

  beforeEach(async () => {
    attachManager.__resetForTests();
    mocked.extractScope.mockReset();
    mocked.getCurrentSessionFallback.mockReset().mockReturnValue(null);
    const mod = await import("../../../src/bot/runtime/scope-session-resolver.js");
    resolveScopedSessionFromContext = mod.resolveScopedSessionFromContext;
  });

  it("prefers attached topic session over current session", () => {
    attachManager.attach(SCOPE_A, SESSION_A);
    mocked.extractScope.mockReturnValue(SCOPE_A);

    const ctx = {} as unknown as Context;
    const result = resolveScopedSessionFromContext(ctx);

    expect(result).not.toBeNull();
    expect(result!.session.id).toBe("session-a");
    expect(result!.scope).toEqual(SCOPE_A);
  });

  it("falls back to scope-bound current session when no attached session exists", () => {
    mocked.getCurrentSessionFallback.mockImplementation(() => {
      const scope = getCurrentTelegramConversationScope();
      if (
        scope &&
        scope.userId === SCOPE_A.userId &&
        scope.chatId === SCOPE_A.chatId &&
        scope.messageThreadId === SCOPE_A.messageThreadId
      ) {
        return SESSION_A;
      }
      return null;
    });
    mocked.extractScope.mockReturnValue(SCOPE_A);

    const ctx = {} as unknown as Context;
    const result = resolveScopedSessionFromContext(ctx);

    expect(result).not.toBeNull();
    expect(result!.session.id).toBe("session-a");
    expect(result!.scope).toEqual(SCOPE_A);
  });

  it("returns null when current topic has no session", () => {
    mocked.extractScope.mockReturnValue(SCOPE_A);

    const ctx = {} as unknown as Context;
    const result = resolveScopedSessionFromContext(ctx);

    expect(result).toBeNull();
  });
});
