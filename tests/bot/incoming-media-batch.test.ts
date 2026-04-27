import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomingMediaBatch } from "../../src/bot/incoming-media-batch.js";

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });

  return { promise, resolve, reject };
}

describe("bot/incoming-media-batch", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the first direct user text immediately and keeps the window open for correlation", async () => {
    vi.useFakeTimers();

    const sendDirectPrompt = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
    });

    expect(sendDirectPrompt).toHaveBeenCalledTimes(1);
    expect(sendDirectPrompt).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
      busyWarningSuppressionFlags: undefined,
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "photo-1" })).toBe(true);
    expect(resolveDeferredItems).not.toHaveBeenCalled();
  });

  it("treats later direct text in the same window as deferred context", async () => {
    vi.useFakeTimers();

    const sendDirectPrompt = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved-follow-up");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "first direct text",
    });
    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "second direct text",
    });

    expect(sendDirectPrompt).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1000);

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      deferredItems: ["second direct text"],
    });
  });

  it("groups deferred context with forwarded and media items into one silent follow-up", async () => {
    vi.useFakeTimers();

    const sendDirectPrompt = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved-media-batch");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
    });
    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "extra text context",
    });
    expect(
      batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "forwarded-message" }),
    ).toBe(true);
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "photo-1" })).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      deferredItems: ["extra text context", "forwarded-message", "photo-1"],
    });
    expect(sendDeferredFollowUp).toHaveBeenCalledTimes(1);
    expect(sendDeferredFollowUp).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      resolvedDeferredItems: "resolved-media-batch",
      busyWarningSuppressionFlags: undefined,
      silent: true,
    });
  });

  it("passes busy warning suppression flags to the deferred follow-up", async () => {
    vi.useFakeTimers();

    const busyWarningSuppressionFlags = {
      suppressBusyWarning: true,
      reason: "deferred-follow-up",
    };
    const sendDirectPrompt = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved-media-batch");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
      busyWarningSuppressionFlags,
    });
    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "extra deferred text",
      busyWarningSuppressionFlags,
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "voice-1" })).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendDeferredFollowUp).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      resolvedDeferredItems: "resolved-media-batch",
      busyWarningSuppressionFlags,
      silent: true,
    });
  });

  it("extends the correlation window from the last deferred item instead of capping it at the first message", async () => {
    vi.useFakeTimers();

    const sendDirectPrompt = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved-follow-up");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
      correlationWindowMs: 1000,
      maxWindowMs: 1000,
    });

    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "first direct text",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "second text" })).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(900);
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "third text" })).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(200);
    expect(resolveDeferredItems).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(800);
    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      deferredItems: ["second text", "third text"],
    });
  });

  it("flushes immediately after a processing hold is released once the silence window already elapsed", async () => {
    vi.useFakeTimers();

    const sendDirectPrompt = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved-media-batch");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
      correlationWindowMs: 1000,
      maxWindowMs: 1000,
    });

    await batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "photo-1" })).toBe(true);

    const releaseHold = (batch as any).acquireProcessingHold("scope-1");
    expect(releaseHold).toBeTypeOf("function");

    await vi.advanceTimersByTimeAsync(1500);
    expect(resolveDeferredItems).not.toHaveBeenCalled();

    releaseHold();
    await vi.advanceTimersByTimeAsync(0);

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      deferredItems: ["photo-1"],
    });
  });

  it("waits for the owning direct prompt to settle before sending deferred follow-up", async () => {
    vi.useFakeTimers();

    const directPromptRequest = createDeferred<void>();
    const sendDirectPrompt = vi
      .fn()
      .mockImplementation(async () => await directPromptRequest.promise);
    const resolveDeferredItems = vi.fn().mockResolvedValue("resolved-media-batch");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    const directPromptTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "photo-1" })).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolveDeferredItems).not.toHaveBeenCalled();

    directPromptRequest.resolve(undefined);
    await directPromptTask;

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenCalledWith({
      scopeKey: "scope-1",
      deferredItems: ["photo-1"],
    });
  });

  it("does not silently lose deferred items when direct prompt failure and deferred follow-up failure both happen", async () => {
    vi.useFakeTimers();

    const directPromptRequest = createDeferred<void>();
    const sendDirectPrompt = vi
      .fn()
      .mockImplementation(async () => await directPromptRequest.promise);
    const resolveDeferredItems = vi
      .fn()
      .mockRejectedValueOnce(new Error("resolve failed"))
      .mockResolvedValueOnce("resolved-on-retry");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    const directPromptTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "hello from user",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "voice-1" })).toBe(true);

    directPromptRequest.reject(new Error("direct prompt failed"));
    await expect(directPromptTask).rejects.toThrow("direct prompt failed");

    await vi.advanceTimersByTimeAsync(1000);

    expect(resolveDeferredItems).toHaveBeenCalledTimes(2);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(2, {
      scopeKey: "scope-1",
      deferredItems: ["voice-1"],
    });
    expect(sendDeferredFollowUp).toHaveBeenCalledTimes(1);
  });

  it("opens a new primary window instead of appending to a retry bucket", async () => {
    vi.useFakeTimers();

    const firstDirectPromptRequest = createDeferred<void>();
    const secondDirectPromptRequest = createDeferred<void>();
    const sendDirectPrompt = vi
      .fn()
      .mockImplementationOnce(async () => await firstDirectPromptRequest.promise)
      .mockImplementationOnce(async () => await secondDirectPromptRequest.promise);
    const resolveDeferredItems = vi
      .fn()
      .mockRejectedValueOnce(new Error("resolve failed"))
      .mockResolvedValueOnce("resolved-retry")
      .mockResolvedValueOnce("resolved-new-window");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    const firstDirectTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "first prompt",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "retry-media" })).toBe(
      true,
    );

    firstDirectPromptRequest.reject(new Error("direct prompt failed"));
    await expect(firstDirectTask).rejects.toThrow("direct prompt failed");

    const secondDirectTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "second prompt",
    });
    expect(
      batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "new-window-media" }),
    ).toBe(true);

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolveDeferredItems).toHaveBeenCalledTimes(2);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(2, {
      scopeKey: "scope-1",
      deferredItems: ["retry-media"],
    });

    secondDirectPromptRequest.resolve(undefined);
    await secondDirectTask;

    expect(resolveDeferredItems).toHaveBeenCalledTimes(3);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(3, {
      scopeKey: "scope-1",
      deferredItems: ["new-window-media"],
    });
    expect(sendDirectPrompt).toHaveBeenCalledTimes(2);
  });

  it("keeps overlapping windows in the same scope independent", async () => {
    vi.useFakeTimers();

    const firstDirectPromptRequest = createDeferred<void>();
    const secondDirectPromptRequest = createDeferred<void>();
    const sendDirectPrompt = vi
      .fn()
      .mockImplementationOnce(async () => await firstDirectPromptRequest.promise)
      .mockImplementationOnce(async () => await secondDirectPromptRequest.promise);
    const resolveDeferredItems = vi
      .fn()
      .mockResolvedValueOnce("resolved-a")
      .mockResolvedValueOnce("resolved-b");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    const firstDirectTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "first prompt",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "a-media" })).toBe(true);

    await vi.advanceTimersByTimeAsync(1001);

    const secondDirectTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "second prompt",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "b-media" })).toBe(true);

    firstDirectPromptRequest.resolve(undefined);
    await firstDirectTask;

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(1, {
      scopeKey: "scope-1",
      deferredItems: ["a-media"],
    });
    expect(sendDeferredFollowUp).toHaveBeenNthCalledWith(1, {
      scopeKey: "scope-1",
      resolvedDeferredItems: "resolved-a",
      busyWarningSuppressionFlags: undefined,
      silent: true,
    });

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);

    secondDirectPromptRequest.resolve(undefined);
    await secondDirectTask;

    expect(resolveDeferredItems).toHaveBeenCalledTimes(2);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(2, {
      scopeKey: "scope-1",
      deferredItems: ["b-media"],
    });
    expect(sendDeferredFollowUp).toHaveBeenNthCalledWith(2, {
      scopeKey: "scope-1",
      resolvedDeferredItems: "resolved-b",
      busyWarningSuppressionFlags: undefined,
      silent: true,
    });
  });

  it("does not let late rejections or stale timers clobber newer windows", async () => {
    vi.useFakeTimers();

    const firstDirectPromptRequest = createDeferred<void>();
    const secondDirectPromptRequest = createDeferred<void>();
    const sendDirectPrompt = vi
      .fn()
      .mockImplementationOnce(async () => await firstDirectPromptRequest.promise)
      .mockImplementationOnce(async () => await secondDirectPromptRequest.promise);
    const resolveDeferredItems = vi
      .fn()
      .mockResolvedValueOnce("resolved-a")
      .mockResolvedValueOnce("resolved-b");
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      resolveDeferredItems,
      sendDeferredFollowUp,
    });

    const firstDirectTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "first prompt",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "a-media" })).toBe(true);

    await vi.advanceTimersByTimeAsync(1001);

    const secondDirectTask = batch.sendDirectPrompt({
      scopeKey: "scope-1",
      directPrompt: "second prompt",
    });
    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "b-media" })).toBe(true);

    firstDirectPromptRequest.reject(new Error("first prompt failed late"));
    await expect(firstDirectTask).rejects.toThrow("first prompt failed late");

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(1, {
      scopeKey: "scope-1",
      deferredItems: ["a-media"],
    });

    expect(batch.enqueueDeferredItem({ scopeKey: "scope-1", deferredItem: "b-media-2" })).toBe(
      true,
    );

    await vi.advanceTimersByTimeAsync(1000);
    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);

    secondDirectPromptRequest.resolve(undefined);
    await secondDirectTask;

    expect(resolveDeferredItems).toHaveBeenCalledTimes(2);
    expect(resolveDeferredItems).toHaveBeenNthCalledWith(2, {
      scopeKey: "scope-1",
      deferredItems: ["b-media", "b-media-2"],
    });
    expect(sendDeferredFollowUp).toHaveBeenCalledTimes(2);
  });
});
