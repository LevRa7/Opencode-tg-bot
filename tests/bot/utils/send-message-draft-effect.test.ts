import { describe, expect, it, vi } from "vitest";
import { SequentialMessageDraftIdAllocator } from "../../../src/bot/utils/message-draft-id.js";
import { SendMessageDraftEffectManager } from "../../../src/bot/utils/send-message-draft-effect.js";
import { MessageDraftStreamManager } from "../../../src/bot/utils/message-draft-stream.js";

describe("bot/utils/send-message-draft-effect", () => {
  it("streams a few draft frames before the final sendMessage", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();

    await manager.play(
      { sendMessageDraft },
      { chat_id: 123, message_thread_id: 456, text: "hello streaming world" },
    );

    expect(sendMessageDraft).toHaveBeenCalledTimes(3);
    expect(sendMessageDraft.mock.calls[0][0]).toBe(123);
    expect(sendMessageDraft.mock.calls[0][3]).toEqual({ message_thread_id: 456 });
    expect(sendMessageDraft.mock.calls[2][2]).toBe("hello streaming world");
  });

  it("skips draft effect for formatted messages", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();

    await manager.play(
      { sendMessageDraft },
      { chat_id: 123, text: "**hello**", parse_mode: "MarkdownV2" },
    );

    expect(sendMessageDraft).not.toHaveBeenCalled();
  });

  it("streams html reasoning messages as progressively parsed html frames", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();

    await manager.play(
      { sendMessageDraft },
      {
        chat_id: 123,
        text: "💭 Thinking...\n\n<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>",
        parse_mode: "HTML",
      },
    );

    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(sendMessageDraft.mock.calls[0][2]).toBe(
      "💭 Thinking...\n\n<blockquote expandable><b>Title</b></blockquote>",
    );
    expect(sendMessageDraft.mock.calls[0][3]).toEqual({ parse_mode: "HTML" });
    expect(sendMessageDraft.mock.calls[1][2]).toBe(
      "💭 Thinking...\n\n<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>",
    );
  });

  it("keeps bare expandable blockquotes free of injected leading blank lines", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();

    await manager.play(
      { sendMessageDraft },
      {
        chat_id: 123,
        text: "<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>",
        parse_mode: "HTML",
      },
    );

    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(sendMessageDraft.mock.calls[0][2]).toBe(
      "<blockquote expandable><b>Title</b></blockquote>",
    );
    expect(sendMessageDraft.mock.calls[1][2]).toBe(
      "<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>",
    );
  });

  it("does not opt plain blockquotes into progressive html framing", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();
    const text = "💭 Thinking...\n\n<blockquote><b>Title</b>\n\n<i>Body text</i></blockquote>";

    await manager.play(
      { sendMessageDraft },
      {
        chat_id: 123,
        text,
        parse_mode: "HTML",
      },
    );

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft.mock.calls[0][2]).toBe(text);
  });

  it("keeps truncated html draft frames wrapper-balanced for oversized reasoning messages", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();
    const oversizedBody = `<i>${"Body section ".repeat(900)}</i>`;

    await manager.play(
      { sendMessageDraft },
      {
        chat_id: 123,
        text: `💭 Thinking...\n\n<blockquote expandable>${oversizedBody}</blockquote>`,
        parse_mode: "HTML",
      },
    );

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);

    const truncatedFrame = sendMessageDraft.mock.calls[0][2] as string;
    expect(truncatedFrame.length).toBeLessThanOrEqual(4096);
    expect(truncatedFrame).toContain("<blockquote expandable>");
    expect(truncatedFrame).toContain("</blockquote>");
    expect(truncatedFrame.endsWith("</blockquote>")).toBe(true);
    expect(truncatedFrame).toContain("</i>");
  });

  it("skips invalid payloads", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const manager = new SendMessageDraftEffectManager();

    await manager.play({ sendMessageDraft }, { chat_id: "@channel", text: "hello" });

    expect(sendMessageDraft).not.toHaveBeenCalled();
  });

  it("uses a shared draft id allocator without colliding with stream drafts", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const allocator = new SequentialMessageDraftIdAllocator();
    const streamManager = new MessageDraftStreamManager(0, allocator);
    const effectManager = new SendMessageDraftEffectManager(allocator);

    streamManager.enqueue("session-1", { sendMessageDraft }, { chatId: 123 }, "assistant reply");
    await streamManager.flushSession("session-1");

    await effectManager.play({ sendMessageDraft }, { chat_id: 123, text: "thinking" });

    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(sendMessageDraft).toHaveBeenNthCalledWith(1, 123, 1, "assistant reply", {});
    expect(sendMessageDraft).toHaveBeenNthCalledWith(2, 123, 2, "thinking", {});
  });
});
