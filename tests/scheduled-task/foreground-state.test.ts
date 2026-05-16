import { beforeEach, describe, expect, it } from "vitest";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";
import { foregroundSessionState } from "../../src/scheduled-task/foreground-state.js";

describe("scheduled-task/foreground-state", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
  });

  it("keeps topic-scoped busy state independent for the same user", () => {
    const results = Array.from({ length: 5 }, (_, index) =>
      runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: index + 1 }, () =>
        foregroundSessionState.tryMarkBusy(`session-${index + 1}`, "test"),
      ),
    );

    const additionalTopic = runWithTelegramConversationScope(
      { userId: 1, chatId: 100, messageThreadId: 99 },
      () => foregroundSessionState.tryMarkBusy("session-6", "test"),
    );

    expect(results).toEqual([true, true, true, true, true]);
    expect(additionalTopic).toBe(true);
    expect(
      runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: 1 }, () =>
        foregroundSessionState.getActiveCount(),
      ),
    ).toBe(1);
    expect(
      runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: 99 }, () =>
        foregroundSessionState.getActiveCount(),
      ),
    ).toBe(1);
  });

  it("keeps different users independent", () => {
    for (let index = 0; index < 5; index++) {
      const scope = { userId: 1, chatId: 100, messageThreadId: index + 1 };
      runWithTelegramConversationScope(scope, () => {
        foregroundSessionState.tryMarkBusy(`user-a-${index + 1}`, "test");
      });
    }

    const otherUserAllowed = runWithTelegramConversationScope(
      { userId: 2, chatId: 100, messageThreadId: 1 },
      () => foregroundSessionState.tryMarkBusy("user-b-1", "test"),
    );

    expect(otherUserAllowed).toBe(true);
    expect(
      runWithTelegramConversationScope({ userId: 2, chatId: 100, messageThreadId: 1 }, () =>
        foregroundSessionState.getActiveCount(),
      ),
    ).toBe(1);
  });

  it("clears only the active user scope", () => {
    runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: 1 }, () => {
      foregroundSessionState.tryMarkBusy("session-a", "test");
    });
    runWithTelegramConversationScope({ userId: 2, chatId: 100, messageThreadId: 1 }, () => {
      foregroundSessionState.tryMarkBusy("session-b", "test");
    });

    runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: 1 }, () => {
      foregroundSessionState.clearAll("test_scope_clear");
    });

    expect(
      runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: 1 }, () =>
        foregroundSessionState.isBusy(),
      ),
    ).toBe(false);
    expect(
      runWithTelegramConversationScope({ userId: 2, chatId: 100, messageThreadId: 1 }, () =>
        foregroundSessionState.isBusy(),
      ),
    ).toBe(true);
  });

  it("clears the original busy scope even if the caller later uses another topic scope", () => {
    const topicAScope = { userId: 1, chatId: 100, messageThreadId: 10 };
    const topicBScope = { userId: 1, chatId: 100, messageThreadId: 20 };

    runWithTelegramConversationScope(topicAScope, () => {
      foregroundSessionState.markBusy("session-a", "test");
    });

    runWithTelegramConversationScope(topicBScope, () => {
      foregroundSessionState.markIdle("session-a");
    });

    expect(runWithTelegramConversationScope(topicAScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
    expect(runWithTelegramConversationScope(topicBScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
  });

  it("does not create busy state entries during read-only checks", () => {
    const topicScope = { userId: 1, chatId: 100, messageThreadId: 10 };

    expect(runWithTelegramConversationScope(topicScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
    expect(
      runWithTelegramConversationScope(topicScope, () => foregroundSessionState.getActiveCount()),
    ).toBe(0);

    runWithTelegramConversationScope(topicScope, () => {
      foregroundSessionState.clearAll("empty_scope_read_should_not_create_state");
    });

    expect(runWithTelegramConversationScope(topicScope, () => foregroundSessionState.isBusy())).toBe(
      false,
    );
    expect(
      runWithTelegramConversationScope(topicScope, () => foregroundSessionState.getActiveCount()),
    ).toBe(0);
  });

  it("tracks busy sessions with their directory", () => {
    foregroundSessionState.markBusy("session-1", "D:/repo");

    expect(foregroundSessionState.isBusy()).toBe(true);
    expect(foregroundSessionState.getBusySessions()).toEqual([
      { sessionId: "session-1", directory: "D:/repo", markedAt: expect.any(Number) },
    ]);
  });

  it("marks a busy session idle", () => {
    foregroundSessionState.markBusy("session-1", "D:/repo");

    foregroundSessionState.markIdle("session-1");

    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(foregroundSessionState.getBusySessions()).toEqual([]);
  });

  it("clears all busy sessions", () => {
    foregroundSessionState.markBusy("session-1", "D:/repo-a");
    foregroundSessionState.markBusy("session-2", "D:/repo-b");

    foregroundSessionState.clearAll("test_reset");

    expect(foregroundSessionState.isBusy()).toBe(false);
    expect(foregroundSessionState.getBusySessions()).toEqual([]);
  });

  it("ignores missing session id or directory", () => {
    foregroundSessionState.markBusy("", "D:/repo");
    foregroundSessionState.markBusy("session-1", "");

    expect(foregroundSessionState.isBusy()).toBe(false);
  });
});
