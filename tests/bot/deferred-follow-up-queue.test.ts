import { describe, expect, it, vi } from "vitest";
import {
  DeferredFollowUpQueue,
  type DeferredFollowUpItem,
} from "../../src/bot/deferred-follow-up-queue.js";
import { scheduleDeferredFollowUpRelease } from "../../src/bot/index.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

function createItem(promptText: string): DeferredFollowUpItem {
  return {
    sessionId: "session-1",
    promptText,
    target: {
      chatId: 777,
      messageThreadId: 11,
    },
    scope: {
      userId: 777,
      chatId: 777,
      messageThreadId: 11,
    },
    sourceMessageId: 123,
  };
}

describe("DeferredFollowUpQueue", () => {
  it("does not dispatch queued follow-ups immediately", () => {
    const queue = new DeferredFollowUpQueue();

    queue.enqueue(createItem("first"));
    queue.enqueue(createItem("second"));

    expect(queue.peekNext("session-1")).toEqual(createItem("first"));
    expect(queue.peekNext("session-1")).toEqual(createItem("first"));
  });

  it("releases one queued item at a time in FIFO order", () => {
    const queue = new DeferredFollowUpQueue();

    queue.enqueue(createItem("first"));
    queue.enqueue(createItem("second"));

    expect(queue.peekNext("session-1")?.promptText).toBe("first");
    queue.shiftAfterSuccess("session-1");
    expect(queue.peekNext("session-1")?.promptText).toBe("second");
    queue.shiftAfterSuccess("session-1");
    expect(queue.peekNext("session-1")).toBeNull();
  });

  it("keeps the current item queued when dispatch fails or returns false", async () => {
    const queue = new DeferredFollowUpQueue();

    queue.enqueue(createItem("first"));

    await scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => undefined,
      dispatchDeferredFollowUp: vi.fn(async () => false),
    });

    expect(queue.peekNext("session-1")?.promptText).toBe("first");
  });

  it("keeps the current item queued when dispatch rejects", async () => {
    const queue = new DeferredFollowUpQueue();

    queue.enqueue(createItem("first"));

    await expect(
      scheduleDeferredFollowUpRelease({
        sessionId: "session-1",
        queue,
        waitForCleanup: async () => undefined,
        dispatchDeferredFollowUp: vi.fn(async () => {
          throw new Error("dispatch failed");
        }),
      }),
    ).rejects.toThrow("dispatch failed");

    expect(queue.peekNext("session-1")?.promptText).toBe("first");
  });

  it("drains repeated releases in order", async () => {
    const queue = new DeferredFollowUpQueue();
    const releasedPrompts: string[] = [];

    queue.enqueue(createItem("first"));
    queue.enqueue(createItem("second"));
    queue.enqueue(createItem("third"));

    const dispatchDeferredFollowUp = vi.fn(async (item: DeferredFollowUpItem) => {
      releasedPrompts.push(item.promptText);
      return true;
    });

    await scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => undefined,
      dispatchDeferredFollowUp,
    });
    await scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => undefined,
      dispatchDeferredFollowUp,
    });
    await scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => undefined,
      dispatchDeferredFollowUp,
    });

    expect(releasedPrompts).toEqual(["first", "second", "third"]);
    expect(queue.peekNext("session-1")).toBeNull();
  });
});

describe("scheduleDeferredFollowUpRelease", () => {
  it("waits for cleanup to finish before taking and dispatching the next deferred follow-up", async () => {
    const queue = new DeferredFollowUpQueue();
    const cleanupGate = createDeferred<void>();
    const events: string[] = [];
    const dispatchDeferredFollowUp = vi.fn(async (item: DeferredFollowUpItem) => {
      events.push(`dispatch:${item.promptText}`);
      return true;
    });

    queue.enqueue(createItem("first"));

    const releaseTask = scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => {
        events.push("cleanup:start");
        await cleanupGate.promise;
        events.push("cleanup:done");
      },
      dispatchDeferredFollowUp,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(events).toEqual(["cleanup:start"]);
    expect(dispatchDeferredFollowUp).not.toHaveBeenCalled();

    cleanupGate.resolve();
    await releaseTask;

    expect(events).toEqual(["cleanup:start", "cleanup:done", "dispatch:first"]);
    expect(dispatchDeferredFollowUp).toHaveBeenCalledTimes(1);
    expect(queue.peekNext("session-1")).toBeNull();
  });

  it("serializes overlapping release attempts for the same session", async () => {
    const queue = new DeferredFollowUpQueue();
    const dispatchGate = createDeferred<void>();
    const releasedPrompts: string[] = [];
    const dispatchDeferredFollowUp = vi.fn(async (item: DeferredFollowUpItem) => {
      releasedPrompts.push(item.promptText);
      await dispatchGate.promise;
      return true;
    });

    queue.enqueue(createItem("first"));
    queue.enqueue(createItem("second"));

    const firstRelease = scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => undefined,
      dispatchDeferredFollowUp,
    });
    const secondRelease = scheduleDeferredFollowUpRelease({
      sessionId: "session-1",
      queue,
      waitForCleanup: async () => undefined,
      dispatchDeferredFollowUp,
    });

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(dispatchDeferredFollowUp).toHaveBeenCalledTimes(1);
    expect(releasedPrompts).toEqual(["first"]);
    expect(queue.peekNext("session-1")?.promptText).toBe("first");

    dispatchGate.resolve();
    await Promise.all([firstRelease, secondRelease]);

    expect(dispatchDeferredFollowUp).toHaveBeenCalledTimes(2);
    expect(releasedPrompts).toEqual(["first", "second"]);
    expect(queue.peekNext("session-1")).toBeNull();
  });
});
