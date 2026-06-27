import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { IncomingMediaBatch } from "../../src/bot/incoming-media-batch.js";
import {
  getCurrentTelegramConversationScope,
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../../src/telegram/scope.js";

// What is under test:
//   The interaction between IncomingMediaBatch's deferred flush and the
//   AsyncLocalStorage conversation scope. handleSessionIdle (src/bot/index.ts)
//   flushes buffered windows from an SSE callback that has NO ambient scope.
//   The deferred dispatch (sendDeferredFollowUp -> processUserPrompt ->
//   getCurrentSession) resolves the active session from the AMBIENT scope, so
//   the flush MUST be wrapped in the session's conversation scope by the caller.
//
// Property under test:
//   IncomingMediaBatch does NOT establish or restore any conversation scope of
//   its own — the deferred dispatch inherits exactly the caller's ambient
//   scope. This is why the idle handler must wrap the flush; if it does not,
//   the dispatch runs scope-less and getCurrentSession() falls back to the
//   global last-created session, breaking topic isolation.
//
// Pass criteria:
//   - flush called scope-less  => callback observes null (reproduces the bug).
//   - flush wrapped in scope A  => callback observes exactly scope A (the fix).

const SCOPE_KEY = "777:123:7";

function createExpiredWindowBatch(): {
  batch: IncomingMediaBatch<string, string, string>;
  observedScopes: Array<TelegramConversationScope | null>;
} {
  const observedScopes: Array<TelegramConversationScope | null> = [];

  const batch = new IncomingMediaBatch<string, string, string>({
    correlationWindowMs: 10,
    maxWindowMs: 10,
    // Return false at timer-expiry time so the window becomes "expired but not
    // flushed" — exactly the state handleSessionIdle later drains via
    // flushExpiredWindowsForScope after the session was busy.
    canFlushNow: () => false,
    resolveDeferredItems: async ({ deferredItems }) => deferredItems.join(","),
    sendDeferredFollowUp: async () => {
      observedScopes.push(getCurrentTelegramConversationScope());
    },
  });

  return { batch, observedScopes };
}

describe("IncomingMediaBatch deferred flush scope propagation", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("dispatches scope-less when the caller does not wrap the flush (reproduces the topic-isolation bug)", async () => {
    const { batch, observedScopes } = createExpiredWindowBatch();

    await batch.deferItem({ scopeKey: SCOPE_KEY, deferredItem: "hello", initialExpiresMs: 10 });
    // Expire the window while flushing is still disallowed (busy session).
    await vi.advanceTimersByTimeAsync(20);

    // Drain the expired window with NO ambient scope, like the old idle handler.
    await batch.flushExpiredWindowsForScope(SCOPE_KEY);

    expect(observedScopes).toEqual([null]);
  });

  it("dispatches inside the caller's conversation scope when the flush is wrapped (the fix)", async () => {
    const { batch, observedScopes } = createExpiredWindowBatch();

    await batch.deferItem({ scopeKey: SCOPE_KEY, deferredItem: "hello", initialExpiresMs: 10 });
    await vi.advanceTimersByTimeAsync(20);

    const scope: TelegramConversationScope = { userId: 777, chatId: 123, messageThreadId: 7 };
    // Mirror the handleSessionIdle fix: wrap the flush in the session's scope.
    await runWithTelegramConversationScope(scope, () =>
      batch.flushExpiredWindowsForScope(SCOPE_KEY),
    );

    expect(observedScopes).toEqual([scope]);
  });
});
