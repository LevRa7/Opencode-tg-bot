import { beforeEach, describe, expect, it, vi } from "vitest";
import { attachManager } from "../../src/attach/manager.js";
import { attachSessionForScope } from "../../src/attach/service.js";
import { questionManager } from "../../src/question/manager.js";
import { permissionManager } from "../../src/permission/manager.js";
import { interactionManager } from "../../src/interaction/manager.js";
import { buildTelegramConversationScopeKey } from "../../src/telegram/scope.js";
import type { Context } from "grammy";

const PENDING_QUESTION = {
  header: "Restore",
  question: "Which session should continue?",
  options: [
    { label: "A", description: "session a" },
    { label: "B", description: "session b" },
  ],
};

function createBotApi(messageIds: number[]): Context["api"] {
  let index = 0;

  return {
    sendMessage: vi.fn().mockImplementation(async () => {
      const messageId = messageIds[index] ?? messageIds[messageIds.length - 1] ?? 1;
      index += 1;
      return { message_id: messageId };
    }),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createFailingBotApi(errorMessage: string): Context["api"] {
  return {
    sendMessage: vi.fn().mockRejectedValue(new Error(errorMessage)),
    deleteMessage: vi.fn().mockResolvedValue(true),
  } as unknown as Context["api"];
}

function createRestorers(
  botApi: Context["api"],
  targetScopeKey: string,
  messageThreadId: number,
  permissionRequestId = "perm-session-a",
) {
  return {
    restoreQuestion: vi.fn(async () => {
      const message = await botApi.sendMessage(-100, "question", { message_thread_id: messageThreadId });
      questionManager.addMessageId(message.message_id, targetScopeKey);
      questionManager.setActiveMessageId(message.message_id, targetScopeKey);
    }),
    restorePermission: vi.fn(async (request: {
      permission: string;
      patterns: string[];
      sessionID: string;
      id: string;
      metadata: Record<string, unknown>;
      always: string[];
    }) => {
      const message = await botApi.sendMessage(-100, "permission", {
        message_thread_id: messageThreadId,
      });
      permissionManager.startPermission(
        {
          ...request,
          id: request.id || permissionRequestId,
        },
        message.message_id,
        targetScopeKey,
      );
    }),
  };
}

describe("attachSessionForScope", () => {
  beforeEach(() => {
    attachManager.__resetForTests();
    questionManager.clearAll();
    permissionManager.clearAll();
    interactionManager.__resetForTests();
  });

  it("attaches sessions independently per Telegram forum topic", async () => {
    await attachSessionForScope({
      scope: { userId: 10, chatId: -100, messageThreadId: 1 },
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "new_session",
    });
    await attachSessionForScope({
      scope: { userId: 10, chatId: -100, messageThreadId: 2 },
      session: { id: "session-b", title: "B", directory: "/repo/b" },
      reason: "selected_session",
    });

    expect(
      attachManager.getAttachedSession({ userId: 10, chatId: -100, messageThreadId: 1 })?.id,
    ).toBe("session-a");
    expect(
      attachManager.getAttachedSession({ userId: 10, chatId: -100, messageThreadId: 2 })?.id,
    ).toBe("session-b");
  });

  it.each(["new_session", "selected_session", "prompt", "startup_restore"] as const)(
    "accepts %s as an attachment reason",
    async (reason) => {
      await attachSessionForScope({
        scope: { userId: 11, chatId: -200, messageThreadId: 77 },
        session: { id: `session-${reason}`, title: reason, directory: "/repo" },
        reason,
      });

      expect(
        attachManager.getAttachedSession({ userId: 11, chatId: -200, messageThreadId: 77 })?.id,
      ).toBe(`session-${reason}`);
    },
  );

  it("restores pending question and permission controls for the attached session into the target topic only", async () => {
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 1,
    });
    const targetScope = { userId: 10, chatId: -100, messageThreadId: 2 };
    const targetScopeKey = buildTelegramConversationScopeKey(targetScope);
    const botApi = createBotApi([801, 802]);
    const restorers = createRestorers(botApi, targetScopeKey, 2);

    // Seed pending interaction state as if session-a was previously active in another topic.
    questionManager.startQuestions([PENDING_QUESTION], "req-attach", sourceScopeKey, "session-a");
    questionManager.selectOption(0, 0, sourceScopeKey);
    questionManager.addMessageId(701, sourceScopeKey);
    questionManager.setActiveMessageId(701, sourceScopeKey);

    permissionManager.startPermission(
      {
        id: "perm-session-a",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      702,
      sourceScopeKey,
    );

    await attachSessionForScope({
      scope: targetScope,
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "selected_session",
      botApi,
      restoreQuestion: restorers.restoreQuestion,
      restorePermission: restorers.restorePermission,
    });

    expect(questionManager.isActive(sourceScopeKey)).toBe(false);
    expect(questionManager.isActive(targetScopeKey)).toBe(true);
    expect(questionManager.getSelectedOptions(0, targetScopeKey)).toEqual(new Set([0]));
    expect(questionManager.getMessageIds(targetScopeKey)).toEqual([801]);

    expect(permissionManager.getPendingCount(sourceScopeKey)).toBe(0);
    expect(permissionManager.getPendingCount(targetScopeKey)).toBe(1);
    expect(permissionManager.getRequestID(802, targetScopeKey)).toBe("perm-session-a");

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessageMock).toHaveBeenCalledTimes(2);
    expect(sendMessageMock.mock.calls[0]?.[0]).toBe(-100);
    expect(sendMessageMock.mock.calls[0]?.[2]).toMatchObject({ message_thread_id: 2 });
    expect(sendMessageMock.mock.calls[1]?.[2]).toMatchObject({ message_thread_id: 2 });
  });

  it("does not activate another session's pending interactions when attaching a different session", async () => {
    const sessionAScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 1,
    });
    const sessionBScope = { userId: 10, chatId: -100, messageThreadId: 3 };
    const sessionBScopeKey = buildTelegramConversationScopeKey(sessionBScope);
    const botApi = createBotApi([901]);

    questionManager.startQuestions([PENDING_QUESTION], "req-session-a", sessionAScopeKey, "session-a");
    permissionManager.startPermission(
      {
        id: "perm-session-a",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      700,
      sessionAScopeKey,
    );

    await attachSessionForScope({
      scope: sessionBScope,
      session: { id: "session-b", title: "B", directory: "/repo/b" },
      reason: "selected_session",
      botApi,
    });

    expect(questionManager.isActive(sessionAScopeKey)).toBe(true);
    expect(questionManager.isActive(sessionBScopeKey)).toBe(false);
    expect(permissionManager.getPendingCount(sessionAScopeKey)).toBe(1);
    expect(permissionManager.getPendingCount(sessionBScopeKey)).toBe(0);

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("does not restore another user's pending question or permission when attaching the same session", async () => {
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 11,
    });
    const targetScope = { userId: 11, chatId: -100, messageThreadId: 12 };
    const targetScopeKey = buildTelegramConversationScopeKey(targetScope);
    const botApi = createBotApi([911, 912]);
    const restorers = createRestorers(botApi, targetScopeKey, 12);

    questionManager.startQuestions([PENDING_QUESTION], "req-cross-user", sourceScopeKey, "session-a");
    questionManager.selectOption(0, 1, sourceScopeKey);

    permissionManager.startPermission(
      {
        id: "perm-cross-user",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      710,
      sourceScopeKey,
    );

    await attachSessionForScope({
      scope: targetScope,
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "selected_session",
      botApi,
      restoreQuestion: restorers.restoreQuestion,
      restorePermission: restorers.restorePermission,
    });

    expect(questionManager.isActive(sourceScopeKey)).toBe(true);
    expect(questionManager.isActive(targetScopeKey)).toBe(false);
    expect(permissionManager.getPendingCount(sourceScopeKey)).toBe(1);
    expect(permissionManager.getPendingCount(targetScopeKey)).toBe(0);

    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("restores pending interactions through injected restorer callbacks", async () => {
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 13,
    });
    const targetScope = { userId: 10, chatId: -100, messageThreadId: 14 };
    const targetScopeKey = buildTelegramConversationScopeKey(targetScope);
    const restoreQuestion = vi.fn(async () => {
      questionManager.addMessageId(921, targetScopeKey);
      questionManager.setActiveMessageId(921, targetScopeKey);
    });
    const restorePermission = vi.fn(async (_request: unknown) => {
      permissionManager.startPermission(
        {
          id: "perm-restored",
          sessionID: "session-a",
          permission: "bash",
          patterns: ["npm test"],
          metadata: {},
          always: [],
        },
        922,
        targetScopeKey,
      );
    });

    questionManager.startQuestions([PENDING_QUESTION], "req-restorer", sourceScopeKey, "session-a");
    permissionManager.startPermission(
      {
        id: "perm-restored",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      720,
      sourceScopeKey,
    );

    await attachSessionForScope({
      scope: targetScope,
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "selected_session",
      restoreQuestion,
      restorePermission,
    });

    expect(restoreQuestion).toHaveBeenCalledTimes(1);
    expect(restorePermission).toHaveBeenCalledTimes(1);
    expect(questionManager.isActive(sourceScopeKey)).toBe(false);
    expect(questionManager.isActive(targetScopeKey)).toBe(true);
    expect(questionManager.getMessageIds(targetScopeKey)).toEqual([921]);
    expect(permissionManager.getPendingCount(sourceScopeKey)).toBe(0);
    expect(permissionManager.getRequestID(922, targetScopeKey)).toBe("perm-restored");
  });

  it("does not delete an active permission request when reattaching the same session to the same scope", async () => {
    const scope = { userId: 10, chatId: -100, messageThreadId: 4 };
    const scopeKey = buildTelegramConversationScopeKey(scope);
    const botApi = createBotApi([950]);

    permissionManager.startPermission(
      {
        id: "perm-same-scope",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      950,
      scopeKey,
    );

    await attachSessionForScope({
      scope,
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "selected_session",
      botApi,
    });

    expect(permissionManager.getPendingCount(scopeKey)).toBe(1);
    expect(permissionManager.getRequestID(950, scopeKey)).toBe("perm-same-scope");
    const sendMessageMock = botApi.sendMessage as unknown as ReturnType<typeof vi.fn>;
    expect(sendMessageMock).not.toHaveBeenCalled();
  });

  it("clears stale target-scope permission requests for another session before restoring the attached session", async () => {
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 5,
    });
    const targetScope = { userId: 10, chatId: -100, messageThreadId: 6 };
    const targetScopeKey = buildTelegramConversationScopeKey(targetScope);
    const botApi = createBotApi([991]);
    const restorers = createRestorers(botApi, targetScopeKey, 6, "perm-session-b");

    permissionManager.startPermission(
      {
        id: "perm-session-a-stale",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm run stale"],
        metadata: {},
        always: [],
      },
      880,
      targetScopeKey,
    );

    permissionManager.startPermission(
      {
        id: "perm-session-b",
        sessionID: "session-b",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      881,
      sourceScopeKey,
    );

    await attachSessionForScope({
      scope: targetScope,
      session: { id: "session-b", title: "B", directory: "/repo/b" },
      reason: "selected_session",
      botApi,
      restoreQuestion: restorers.restoreQuestion,
      restorePermission: restorers.restorePermission,
    });

    expect(permissionManager.getPendingCount(sourceScopeKey)).toBe(0);
    expect(permissionManager.getPendingCount(targetScopeKey)).toBe(1);
    expect(permissionManager.getRequestID(880, targetScopeKey)).toBeNull();
    expect(permissionManager.getRequestID(991, targetScopeKey)).toBe("perm-session-b");
  });

  it("keeps the original pending question recoverable when restored question send fails", async () => {
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 7,
    });
    const targetScope = { userId: 10, chatId: -100, messageThreadId: 8 };
    const targetScopeKey = buildTelegramConversationScopeKey(targetScope);
    const failingRestorers = createRestorers(
      createFailingBotApi("question send failed"),
      targetScopeKey,
      8,
    );

    questionManager.startQuestions([PENDING_QUESTION], "req-question-fail", sourceScopeKey, "session-a");
    questionManager.selectOption(0, 1, sourceScopeKey);

    await expect(
      attachSessionForScope({
        scope: targetScope,
        session: { id: "session-a", title: "A", directory: "/repo/a" },
        reason: "selected_session",
        restoreQuestion: failingRestorers.restoreQuestion,
        restorePermission: failingRestorers.restorePermission,
      }),
    ).rejects.toThrow("question send failed");

    expect(questionManager.isActive(sourceScopeKey)).toBe(true);
    expect(questionManager.isActive(targetScopeKey)).toBe(false);
    expect(questionManager.getSelectedOptions(0, sourceScopeKey)).toEqual(new Set([1]));

    const successfulRestorers = createRestorers(createBotApi([992]), targetScopeKey, 8);

    await attachSessionForScope({
      scope: targetScope,
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "selected_session",
      restoreQuestion: successfulRestorers.restoreQuestion,
      restorePermission: successfulRestorers.restorePermission,
    });

    expect(questionManager.isActive(sourceScopeKey)).toBe(false);
    expect(questionManager.isActive(targetScopeKey)).toBe(true);
    expect(questionManager.getMessageIds(targetScopeKey)).toEqual([992]);
  });

  it("keeps the original pending permission recoverable when restored permission send fails", async () => {
    const sourceScopeKey = buildTelegramConversationScopeKey({
      userId: 10,
      chatId: -100,
      messageThreadId: 9,
    });
    const targetScope = { userId: 10, chatId: -100, messageThreadId: 10 };
    const targetScopeKey = buildTelegramConversationScopeKey(targetScope);
    const failingRestorers = createRestorers(
      createFailingBotApi("permission send failed"),
      targetScopeKey,
      10,
    );

    permissionManager.startPermission(
      {
        id: "perm-session-a",
        sessionID: "session-a",
        permission: "bash",
        patterns: ["npm test"],
        metadata: {},
        always: [],
      },
      882,
      sourceScopeKey,
    );

    await expect(
      attachSessionForScope({
        scope: targetScope,
        session: { id: "session-a", title: "A", directory: "/repo/a" },
        reason: "selected_session",
        restoreQuestion: vi.fn(async () => undefined),
        restorePermission: failingRestorers.restorePermission,
      }),
    ).rejects.toThrow("permission send failed");

    expect(permissionManager.getPendingCount(sourceScopeKey)).toBe(1);
    expect(permissionManager.getRequestID(882, sourceScopeKey)).toBe("perm-session-a");
    expect(permissionManager.getPendingCount(targetScopeKey)).toBe(0);

    const successfulRestorers = createRestorers(createBotApi([993]), targetScopeKey, 10);

    await attachSessionForScope({
      scope: targetScope,
      session: { id: "session-a", title: "A", directory: "/repo/a" },
      reason: "selected_session",
      restoreQuestion: successfulRestorers.restoreQuestion,
      restorePermission: successfulRestorers.restorePermission,
    });

    expect(permissionManager.getPendingCount(sourceScopeKey)).toBe(0);
    expect(permissionManager.getRequestID(993, targetScopeKey)).toBe("perm-session-a");
  });
});
