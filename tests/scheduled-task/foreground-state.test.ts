import { beforeEach, describe, expect, it } from "vitest";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";
import { foregroundSessionState } from "../../src/scheduled-task/foreground-state.js";

describe("scheduled-task/foreground-state", () => {
  beforeEach(() => {
    foregroundSessionState.__resetForTests();
  });

  it("allows up to five active topic-scoped requests per user", () => {
    const results = Array.from({ length: 5 }, (_, index) =>
      runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: index + 1 }, () =>
        foregroundSessionState.tryMarkBusy(`session-${index + 1}`),
      ),
    );

    const overflow = runWithTelegramConversationScope(
      { userId: 1, chatId: 100, messageThreadId: 99 },
      () => foregroundSessionState.tryMarkBusy("session-6"),
    );

    expect(results).toEqual([true, true, true, true, true]);
    expect(overflow).toBe(false);
    expect(
      runWithTelegramConversationScope({ userId: 1, chatId: 100, messageThreadId: 1 }, () =>
        foregroundSessionState.getActiveCount(),
      ),
    ).toBe(5);
  });

  it("keeps different users independent", () => {
    for (let index = 0; index < 5; index++) {
      const scope = { userId: 1, chatId: 100, messageThreadId: index + 1 };
      runWithTelegramConversationScope(scope, () => {
        foregroundSessionState.tryMarkBusy(`user-a-${index + 1}`);
      });
    }

    const otherUserAllowed = runWithTelegramConversationScope(
      { userId: 2, chatId: 100, messageThreadId: 1 },
      () => foregroundSessionState.tryMarkBusy("user-b-1"),
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
      foregroundSessionState.tryMarkBusy("session-a");
    });
    runWithTelegramConversationScope({ userId: 2, chatId: 100, messageThreadId: 1 }, () => {
      foregroundSessionState.tryMarkBusy("session-b");
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
});
