import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_ALLOWED_INTERACTION_COMMANDS,
  interactionManager,
} from "../../src/interaction/manager.js";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";

describe("interactionManager", () => {
  beforeEach(() => {
    interactionManager.__resetForTests();
  });

  it("starts interaction with defaults", () => {
    const state = interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      metadata: { requestId: "q-1" },
    });

    expect(state.kind).toBe("question");
    expect(state.expectedInput).toBe("callback");
    expect(state.metadata).toEqual({ requestId: "q-1" });
    expect(state.allowedCommands).toEqual([...DEFAULT_ALLOWED_INTERACTION_COMMANDS]);
    expect(state.createdAt).toBeTypeOf("number");
    expect(state.expiresAt).toBeNull();
    expect(interactionManager.isActive()).toBe(true);
  });

  it("normalizes and deduplicates allowed commands", () => {
    const state = interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      allowedCommands: ["/Help", "status", "/help", " /STATUS@MyBot ", "", " / "],
    });

    expect(state.allowedCommands).toEqual(["/help", "/status"]);
  });

  it("transitions active interaction", () => {
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { step: 1 },
    });

    const transitioned = interactionManager.transition({
      kind: "question",
      expectedInput: "mixed",
      allowedCommands: ["/abort"],
      metadata: { step: 2 },
      expiresInMs: 5000,
    });

    expect(transitioned).not.toBeNull();
    expect(transitioned?.kind).toBe("question");
    expect(transitioned?.expectedInput).toBe("mixed");
    expect(transitioned?.allowedCommands).toEqual(["/abort"]);
    expect(transitioned?.metadata).toEqual({ step: 2 });
    expect(typeof transitioned?.expiresAt).toBe("number");
  });

  it("tracks expiration by expiresAt", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00.000Z"));

    interactionManager.start({
      kind: "permission",
      expectedInput: "callback",
      expiresInMs: 1000,
    });

    expect(interactionManager.isExpired()).toBe(false);

    vi.advanceTimersByTime(1000);
    expect(interactionManager.isExpired()).toBe(true);
  });

  it("clears active interaction", () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "mixed",
    });

    interactionManager.clear("test");

    expect(interactionManager.isActive()).toBe(false);
    expect(interactionManager.get()).toBeNull();
  });

  it("keeps interactions isolated by scope", () => {
    const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
    const scopeB: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 11 };

    interactionManager.start(
      {
        kind: "question",
        expectedInput: "callback",
      },
      scopeA,
    );
    interactionManager.start(
      {
        kind: "rename",
        expectedInput: "text",
      },
      scopeB,
    );

    expect(interactionManager.getSnapshot(scopeA)?.kind).toBe("question");
    expect(interactionManager.getSnapshot(scopeB)?.kind).toBe("rename");
    expect(interactionManager.getSnapshot()).toBeNull();
  });
});
