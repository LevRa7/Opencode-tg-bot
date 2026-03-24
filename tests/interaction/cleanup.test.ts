import { beforeEach, describe, expect, it } from "vitest";
import { clearAllInteractionState } from "../../src/interaction/cleanup.js";
import { interactionManager } from "../../src/interaction/manager.js";
import { questionManager } from "../../src/question/manager.js";
import { permissionManager } from "../../src/permission/manager.js";
import { renameManager } from "../../src/rename/manager.js";
import type { Question } from "../../src/question/types.js";
import type { PermissionRequest } from "../../src/permission/types.js";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const TEST_QUESTION: Question = {
  header: "Q1",
  question: "Pick one option",
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

describe("interaction/cleanup", () => {
  beforeEach(() => {
    questionManager.__resetForTests();
    permissionManager.__resetForTests();
    interactionManager.__resetForTests();
    clearAllInteractionState("test_setup");
  });

  it("clears all interaction-related managers", () => {
    questionManager.startQuestions([TEST_QUESTION], "req-1");
    permissionManager.startPermission(TEST_PERMISSION, 101);
    renameManager.startWaiting("session-1", "D:/repo", "Old title");
    interactionManager.start({
      kind: "rename",
      expectedInput: "text",
      metadata: { sessionId: "session-1" },
    });

    clearAllInteractionState("test_cleanup");

    expect(questionManager.isActive()).toBe(false);
    expect(permissionManager.isActive()).toBe(false);
    expect(renameManager.isWaitingForName()).toBe(false);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("allows starting new interaction after cleanup", () => {
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: { menuKind: "model", messageId: 1 },
    });

    clearAllInteractionState("first_cleanup");

    interactionManager.start({
      kind: "question",
      expectedInput: "callback",
      metadata: { questionIndex: 0 },
    });

    expect(interactionManager.getSnapshot()?.kind).toBe("question");
  });

  it("clears only the active scoped managers", () => {
    const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
    const scopeB: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 11 };

    questionManager.startQuestions([TEST_QUESTION], "req-a", scopeA);
    permissionManager.startPermission(TEST_PERMISSION, 201, scopeA);
    interactionManager.start(
      {
        kind: "question",
        expectedInput: "callback",
      },
      scopeA,
    );

    questionManager.startQuestions([TEST_QUESTION], "req-b", scopeB);
    permissionManager.startPermission(TEST_PERMISSION, 202, scopeB);
    interactionManager.start(
      {
        kind: "permission",
        expectedInput: "callback",
      },
      scopeB,
    );

    runWithTelegramConversationScope(scopeA, () => {
      clearAllInteractionState("scoped_cleanup");
    });

    expect(questionManager.isActive(scopeA)).toBe(false);
    expect(permissionManager.isActive(scopeA)).toBe(false);
    expect(interactionManager.getSnapshot(scopeA)).toBeNull();

    expect(questionManager.isActive(scopeB)).toBe(true);
    expect(permissionManager.isActive(scopeB)).toBe(true);
    expect(interactionManager.getSnapshot(scopeB)?.kind).toBe("permission");
  });
});
