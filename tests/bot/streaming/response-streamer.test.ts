import { afterEach, describe, expect, it, vi } from "vitest";
import { ResponseStreamer } from "../../../src/bot/streaming/response-streamer.js";

describe("bot/streaming/response-streamer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("throttles updates and sends only the latest payload", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "first" }], format: "raw" });
    streamer.enqueue("s1", "m1", { parts: [{ text: "second" }], format: "raw" });

    await vi.advanceTimersByTimeAsync(500);

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("s1", "second", "raw", undefined);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("streams into a second Telegram message when parts grow", async () => {
    vi.useFakeTimers();

    let nextMessageId = 101;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "part-1" }], format: "markdown_v2" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", {
      parts: ["part-1", "part-2"],
      format: "markdown_v2",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "part-1", "markdown_v2", undefined);
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "part-2", "markdown_v2", undefined);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("sends plain markdown payload parts in raw mode when they have no entities", async () => {
    vi.useFakeTimers();

    let nextMessageId = 301;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    const richEntities = [{ type: "bold" as const, offset: 0, length: 4 }];

    streamer.enqueue("s1", "m1", {
      parts: [{ text: "rich", entities: richEntities }, { text: "plain-tail" }],
      format: "markdown_v2",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(sendText).toHaveBeenNthCalledWith(1, "s1", "rich", "markdown_v2", {
      entities: richEntities,
    });
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "plain-tail", "markdown_v2", undefined);
    expect(editText).not.toHaveBeenCalled();
  });

  it("edits plain markdown payload parts in raw mode when they have no entities", async () => {
    vi.useFakeTimers();

    let nextMessageId = 401;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    const richEntities = [{ type: "bold" as const, offset: 0, length: 4 }];

    streamer.enqueue("s1", "m1", {
      parts: [{ text: "rich", entities: richEntities }, { text: "plain-tail" }],
      format: "markdown_v2",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.enqueue("s1", "m1", {
      parts: [{ text: "rich updated", entities: richEntities }, { text: "plain-tail-updated" }],
      format: "markdown_v2",
    });

    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenNthCalledWith(1, "s1", 401, "rich updated", "markdown_v2", {
      entities: richEntities,
    });
    expect(editText).toHaveBeenNthCalledWith(
      2,
      "s1",
      402,
      "plain-tail-updated",
      "markdown_v2",
      undefined,
    );
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("flushes final payload on complete after streaming started", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial" }], format: "raw" });
    await vi.advanceTimersByTimeAsync(500);

    const result = await streamer.complete("s1", "m1", {
      parts: [{ text: "final" }],
      format: "raw",
    });

    expect(result.streamed).toBe(true);
    expect(result.telegramMessageIds).toEqual([1]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith("s1", 1, "final", "raw", undefined);
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("removes extra Telegram messages when payload shrinks", async () => {
    vi.useFakeTimers();

    let nextMessageId = 10;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "one" }, { text: "two" }], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "one" }], format: "raw" });
    await vi.waitFor(() => {
      expect(deleteText).toHaveBeenCalledTimes(1);
    });

    expect(deleteText).toHaveBeenCalledWith("s1", 11);
  });

  it("retries after Telegram rate limits", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockRejectedValueOnce(new Error("429: retry after 1"))
      .mockResolvedValueOnce(1);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "hello" }], format: "raw" });

    await vi.advanceTimersByTimeAsync(1000);

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });
  });

  it("marks a stream as broken after fatal edit error and cleans up partial messages on complete", async () => {
    vi.useFakeTimers();

    const sendText = vi.fn().mockResolvedValue(42);
    const editText = vi
      .fn()
      .mockRejectedValue(new Error("400: Bad Request: message can't be edited"));
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial" }], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial updated" }], format: "raw" });
    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial updated again" }], format: "raw" });
    await vi.advanceTimersByTimeAsync(50);

    expect(editText).toHaveBeenCalledTimes(1);

    const result = await streamer.complete("s1", "m1", {
      parts: [{ text: "final" }],
      format: "raw",
    });

    expect(result.streamed).toBe(false);
    expect(result.telegramMessageIds).toEqual([]);
    expect(deleteText).toHaveBeenCalledTimes(1);
    expect(deleteText).toHaveBeenCalledWith("s1", 42);
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("falls back cleanly when fatal send error happens before any partial is visible", async () => {
    vi.useFakeTimers();

    const sendText = vi
      .fn()
      .mockRejectedValue(new Error("403: Forbidden: bot was blocked by the user"));
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial" }], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial again" }], format: "raw" });
    await vi.advanceTimersByTimeAsync(50);

    expect(sendText).toHaveBeenCalledTimes(1);

    const result = await streamer.complete("s1", "m1", {
      parts: [{ text: "final" }],
      format: "raw",
    });

    expect(result.streamed).toBe(false);
    expect(result.telegramMessageIds).toEqual([]);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("waits for an in-flight first streamed send before finalizing short responses", async () => {
    let resolveSend: ((messageId: number) => void) | undefined;
    const sendText = vi.fn(
      () =>
        new Promise<number>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "short reply" }], format: "raw" });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    const completionPromise = streamer.complete("s1", "m1", {
      parts: [{ text: "short reply" }],
      format: "raw",
    });

    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();

    const finishSend = resolveSend;
    if (finishSend) {
      finishSend(1);
    }

    const result = await completionPromise;
    expect(result.streamed).toBe(true);
    expect(result.telegramMessageIds).toEqual([1]);
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("keeps visible partial messages when clearing a session and stops tracking the old stream", async () => {
    vi.useFakeTimers();

    let nextMessageId = 100;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial" }], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.clearSession("s1", "session_error");

    const completedAfterClear = await streamer.complete("s1", "m1", {
      parts: [{ text: "final" }],
      format: "raw",
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "new partial" }], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(completedAfterClear.streamed).toBe(false);
    expect(completedAfterClear.telegramMessageIds).toEqual([]);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenNthCalledWith(2, "s1", "new partial", "raw", undefined);
  });

  it("keeps visible partial messages when clearing all streams", async () => {
    vi.useFakeTimers();

    let nextMessageId = 200;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial" }], format: "raw" });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    streamer.clearAll("summary_aggregator_clear");

    const completedAfterClear = await streamer.complete("s1", "m1", {
      parts: [{ text: "final" }],
      format: "raw",
    });

    expect(completedAfterClear.streamed).toBe(false);
    expect(completedAfterClear.telegramMessageIds).toEqual([]);
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
    expect(sendText).toHaveBeenCalledTimes(1);
  });

  it("skips final sync when stream never emitted partial update", async () => {
    vi.useFakeTimers();

    let nextMessageId = 1;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 500,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", { parts: [{ text: "partial" }], format: "raw" });
    const synced = await streamer.complete("s1", "m1", {
      parts: [{ text: "final" }],
      format: "raw",
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(synced.streamed).toBe(false);
    expect(synced.telegramMessageIds).toEqual([]);
    expect(sendText).not.toHaveBeenCalled();
    expect(editText).not.toHaveBeenCalled();
    expect(deleteText).not.toHaveBeenCalled();
  });

  it("keeps interleaved streamed sessions isolated by session and message ids", async () => {
    vi.useFakeTimers();

    let nextMessageId = 200;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("session-1", "message-1", {
      parts: [{ text: "first partial" }],
      format: "raw",
    });
    streamer.enqueue("session-2", "message-2", {
      parts: [{ text: "second partial" }],
      format: "raw",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    streamer.enqueue("session-1", "message-1", { parts: [{ text: "first final" }], format: "raw" });
    streamer.enqueue("session-2", "message-2", {
      parts: [{ text: "second final" }],
      format: "raw",
    });

    await vi.waitFor(() => {
      expect(editText).toHaveBeenCalledTimes(2);
    });

    expect(editText).toHaveBeenNthCalledWith(1, "session-1", 200, "first final", "raw", undefined);
    expect(editText).toHaveBeenNthCalledWith(2, "session-2", 201, "second final", "raw", undefined);

    const firstResult = await streamer.complete("session-1", "message-1", {
      parts: ["first final"],
      format: "raw",
    });
    const secondResult = await streamer.complete("session-2", "message-2", {
      parts: ["second final"],
      format: "raw",
    });

    expect(firstResult).toEqual({ streamed: true, telegramMessageIds: [200] });
    expect(secondResult).toEqual({ streamed: true, telegramMessageIds: [201] });
  });

  it("keeps markdown_v2 format for plain parts on complete to preserve parse_mode", async () => {
    vi.useFakeTimers();

    let nextMessageId = 501;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("s1", "m1", {
      parts: [{ text: "partial **bold**" }],
      format: "markdown_v2",
    });
    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(1);
    });

    const result = await streamer.complete("s1", "m1", {
      parts: [{ text: "final **bold** and *italic*" }],
      format: "markdown_v2",
    });

    expect(result.streamed).toBe(true);
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenNthCalledWith(
      1,
      "s1",
      501,
      "final **bold** and *italic*",
      "markdown_v2",
      undefined,
    );
  });

  it("uses the same markdown_v2 delivery mode for root and child plain streamed parts", async () => {
    vi.useFakeTimers();

    let nextMessageId = 601;
    const sendText = vi.fn(async () => nextMessageId++);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const streamer = new ResponseStreamer({
      throttleMs: 0,
      sendText,
      editText,
      deleteText,
    });

    streamer.enqueue("root-session", "root-message", {
      parts: [{ text: "plain.with.punctuation" }],
      format: "markdown_v2",
    });
    streamer.enqueue("child-session", "child-message", {
      parts: [{ text: "plain.with.punctuation" }],
      format: "markdown_v2",
    });

    await vi.waitFor(() => {
      expect(sendText).toHaveBeenCalledTimes(2);
    });

    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "root-session",
      "plain.with.punctuation",
      "markdown_v2",
      undefined,
    );
    expect(sendText).toHaveBeenNthCalledWith(
      2,
      "child-session",
      "plain.with.punctuation",
      "markdown_v2",
      undefined,
    );
  });
});
