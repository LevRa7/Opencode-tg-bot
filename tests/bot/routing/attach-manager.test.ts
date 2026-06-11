import { beforeEach, describe, expect, it } from "vitest";
import { attachManager } from "../../../src/attach/manager.js";
import { makeScope } from "./_mocks/test-utils.js";

function makeSession(id: string, title = "Test Session") {
  return {
    id,
    title,
    status: "running" as const,
    directory: "/test/dir",
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    configuredAgent: undefined as string | undefined,
    configuredProviderID: null as string | null,
    configuredModelID: null as string | null,
  };
}

describe("AttachManager", () => {
  // Инварианты: I1 (изоляция пользователей), V4 (restoreNewestRoute), V6 (гонка scope-ов)

  beforeEach(() => {
    attachManager.__resetForTests();
  });

  describe("attach", () => {
    it("должен привязать сессию к scope", () => {
      const scope = makeScope(100, -100, 10);
      const session = makeSession("ses_1");

      attachManager.attach(scope, session);

      expect(attachManager.getScopeForSession("ses_1")).toEqual(scope);
    });

    it("должен вернуть target с правильным chatId и messageThreadId", () => {
      const scope = makeScope(100, -100, 42);
      const session = makeSession("ses_1");

      attachManager.attach(scope, session);

      const target = attachManager.getTargetForSession("ses_1");
      expect(target).toEqual({ chatId: -100, messageThreadId: 42 });
    });

    it("не должен позволить другому пользователю перехватить сессию (userId mismatch)", () => {
      const scopeA = makeScope(100, -100, 10);
      const scopeB = makeScope(200, -200, 20);
      const session = makeSession("ses_1");

      attachManager.attach(scopeA, session);
      attachManager.attach(scopeB, session);

      const target = attachManager.getTargetForSession("ses_1");
      expect(target!.chatId).toBe(-100);
      expect(target!.messageThreadId).toBe(10);
    });

    it("должен позволить тому же пользователю перепривязать сессию к другому scope", () => {
      const scopeA = makeScope(100, -100, 10);
      const scopeB = makeScope(100, -100, 20);
      const session = makeSession("ses_1");

      attachManager.attach(scopeA, session);
      attachManager.attach(scopeB, session);

      const target = attachManager.getTargetForSession("ses_1");
      expect(target).toEqual({ chatId: -100, messageThreadId: 20 });
    });

    it("должен корректно обработать target без messageThreadId (main thread)", () => {
      const scope = makeScope(100, -100);
      const session = makeSession("ses_1");

      attachManager.attach(scope, session);

      const target = attachManager.getTargetForSession("ses_1");
      expect(target).toEqual({ chatId: -100 });
    });
  });

  describe("detach", () => {
    it("должен удалить state после detach", () => {
      const scope = makeScope(100, -100, 10);
      const session = makeSession("ses_1");

      attachManager.attach(scope, session);
      attachManager.detach(scope);

      expect(attachManager.getScopeForSession("ses_1")).toBeNull();
      expect(attachManager.getTargetForSession("ses_1")).toBeNull();
    });

    it("должен восстановить новейший route после detach активного scope (restoreNewestRouteForSession)", () => {
      const scopeA = makeScope(100, -100, 10);
      const scopeB = makeScope(100, -100, 20);
      const session = makeSession("ses_1");

      attachManager.attach(scopeA, session);
      attachManager.attach(scopeB, session);
      expect(attachManager.getTargetForSession("ses_1")!.messageThreadId).toBe(20);

      attachManager.detach(scopeB);
      const target = attachManager.getTargetForSession("ses_1");
      expect(target).toEqual({ chatId: -100, messageThreadId: 10 });
    });

    it("не должен падать при detach несуществующего scope", () => {
      expect(() => attachManager.detach(makeScope(999, -999))).not.toThrow();
    });
  });

  describe("getTargetForSession", () => {
    it("должен вернуть target на основе scope (с messageThreadId)", () => {
      const scope = makeScope(100, -100, 42);
      const session = makeSession("ses_1");
      attachManager.attach(scope, session);

      expect(attachManager.getTargetForSession("ses_1")).toEqual({ chatId: -100, messageThreadId: 42 });
    });

    it("должен вернуть target без messageThreadId для main-thread scope", () => {
      const scope = makeScope(100, -100);
      const session = makeSession("ses_1");
      attachManager.attach(scope, session);

      expect(attachManager.getTargetForSession("ses_1")).toEqual({ chatId: -100 });
    });

    it("должен вернуть null, если scope отсутствует", () => {
      expect(attachManager.getTargetForSession("nonexistent")).toBeNull();
    });
  });

  describe("getScopeForSession", () => {
    it("должен вернуть клон scope (не оригинал — защита от мутации)", () => {
      const scope = makeScope(100, -100, 10);
      const session = makeSession("ses_1");
      attachManager.attach(scope, session);

      const returnedScope = attachManager.getScopeForSession("ses_1");
      expect(returnedScope).toEqual(scope);
      expect(returnedScope).not.toBe(scope);
    });

    it("должен вернуть null, если scopeKeyBySessionId не содержит сессию", () => {
      expect(attachManager.getScopeForSession("nonexistent")).toBeNull();
    });
  });

  describe("setBusy", () => {
    it("должен установить busy=true для сессии", () => {
      const scope = makeScope(100, -100, 10);
      const session = makeSession("ses_1");
      attachManager.attach(scope, session);
      attachManager.setBusy("ses_1", true);

      const state = attachManager.getStateForScope(scope);
      expect(state?.busy).toBe(true);
    });

    it("не должен падать при setBusy на несуществующей сессии", () => {
      expect(() => attachManager.setBusy("nonexistent", true)).not.toThrow();
    });
  });
});
