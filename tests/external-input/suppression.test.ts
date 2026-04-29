import { afterEach, describe, expect, it, vi } from "vitest";
import { ExternalInputSuppression } from "../../src/external-input/suppression.js";

afterEach(() => {
  vi.useRealTimers();
});

describe("ExternalInputSuppression", () => {
  it("suppresses only matching self-origin input in the same scoped session", () => {
    vi.useFakeTimers();
    const suppression = new ExternalInputSuppression({ ttlMs: 1_000 });
    const scope = { userId: 1, chatId: -100, messageThreadId: 5 };

    suppression.rememberSelfInput("session-1", scope, "run tests");

    expect(suppression.shouldSuppress("session-1", scope, "run tests")).toBe(true);
    expect(
      suppression.shouldSuppress(
        "session-1",
        { userId: 1, chatId: -100, messageThreadId: 6 },
        "run tests",
      ),
    ).toBe(false);
    expect(suppression.shouldSuppress("session-2", scope, "run tests")).toBe(false);
    expect(suppression.shouldSuppress("session-1", scope, "different input")).toBe(false);

    vi.advanceTimersByTime(1_001);
    expect(suppression.shouldSuppress("session-1", scope, "run tests")).toBe(false);
  });
});
