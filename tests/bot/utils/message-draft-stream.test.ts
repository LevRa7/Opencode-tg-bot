import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageDraftStreamManager } from "../../../src/bot/utils/message-draft-stream.js";

describe("bot/utils/message-draft-stream", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("sends the latest queued draft for a session", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue(
      "session-1",
      { sendMessageDraft },
      { chatId: 123, messageThreadId: 456 },
      "hello world",
    );

    await manager.flushSession("session-1");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft).toHaveBeenCalledWith(123, 1, "hello world", {
      message_thread_id: 456,
    });
  });

  it("truncates long drafts to the Telegram limit", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);
    const longText = "a".repeat(5000);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, longText);
    await manager.flushSession("session-1");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    const sentText = sendMessageDraft.mock.calls[0][2] as string;
    expect(sentText.length).toBe(4096);
    expect(sentText.startsWith("...")).toBe(true);
  });

  it("disables drafts for the session after a send failure", async () => {
    const sendMessageDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("drafts unsupported"))
      .mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "first");
    await manager.flushSession("session-1");

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "second");
    await manager.flushSession("session-1");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
  });

  it("progressively appends draft text instead of jumping straight to the full chunk", async () => {
    vi.useFakeTimers();

    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(10);
    const fullText = "The assistant is streaming this reply in smaller draft updates.";

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, fullText);

    await vi.runOnlyPendingTimersAsync();

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect((sendMessageDraft.mock.calls[0][2] as string).length).toBeLessThan(fullText.length);

    await vi.advanceTimersByTimeAsync(100);

    const streamedFrames = sendMessageDraft.mock.calls.map((call) => call[2] as string);
    expect(streamedFrames[streamedFrames.length - 1]).toBe(fullText);
    expect(streamedFrames.length).toBeGreaterThan(1);
  });

  it("sends html drafts as full blockquote frames immediately", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);
    const htmlText =
      "💭 Thinking...\n\n<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>";

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, htmlText, "html");
    await manager.flushSession("session-1");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft).toHaveBeenCalledWith(123, 1, htmlText, { parse_mode: "HTML" });
  });

  it("does not send parallel duplicate drafts while a send is in flight", async () => {
    let resolveSend: ((value: boolean) => void) | null = null;
    const sendMessageDraft = vi.fn().mockImplementation(
      () =>
        new Promise<boolean>((resolve) => {
          resolveSend = resolve;
        }),
    );
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "hello world");

    const firstFlush = manager.flushSession("session-1");
    const secondFlush = manager.flushSession("session-1");

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);

    resolveSend?.(true);
    await firstFlush;
    await secondFlush;

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
  });

  it("exposes the last delivered draft payload signature for final deduplication", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "final html", "html");
    await manager.flushSession("session-1");

    expect(manager.getLastPayloadSignature("session-1")).toBe('html::["final html"]');
  });

  it("clears the last delivered draft payload signature when session state is cleared", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "final html", "html");
    await manager.flushSession("session-1");
    manager.clearSession("session-1");

    expect(manager.getLastPayloadSignature("session-1")).toBeNull();
  });

  it("tracks the last sent message id after flush when send/edit API is provided", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const editMessageText = vi.fn().mockResolvedValue(true);
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue(
      "session-1",
      { sendMessageDraft },
      { chatId: 123, messageThreadId: 456 },
      "hello",
    );
    manager.setSendEditApi("session-1", { sendMessage }, { editMessageText });

    await manager.flushSession("session-1");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(editMessageText).not.toHaveBeenCalled();
    expect(manager.getLastSentMessageId("session-1")).toBe(42);
  });

  it("uses editMessageText for subsequent sends when message id is known", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 42 });
    const editMessageText = vi.fn().mockResolvedValue(true);
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "first");
    manager.setSendEditApi("session-1", { sendMessage }, { editMessageText });
    await manager.flushSession("session-1");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(editMessageText).not.toHaveBeenCalled();

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "second");
    await manager.flushSession("session-1");

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith(123, 42, "second", undefined);
  });

  it("returns null for message id when only draft API is available", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "hello");
    await manager.flushSession("session-1");

    expect(manager.getLastSentMessageId("session-1")).toBeNull();
  });

  it("consumeLastSentMessageId returns and clears the message id", async () => {
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 99 });
    const editMessageText = vi.fn().mockResolvedValue(true);
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new MessageDraftStreamManager(0);

    manager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "hello");
    manager.setSendEditApi("session-1", { sendMessage }, { editMessageText });
    await manager.flushSession("session-1");

    expect(manager.getLastSentMessageId("session-1")).toBe(99);

    const consumed = manager.consumeLastSentMessageId("session-1");
    expect(consumed).toBe(99);
    expect(manager.getLastSentMessageId("session-1")).toBeNull();
  });

  it("consumeLastSentMessageId returns null when no message was sent", async () => {
    const manager = new MessageDraftStreamManager(0);
    expect(manager.consumeLastSentMessageId("unknown")).toBeNull();
  });
});
