import { beforeEach, describe, expect, it, vi } from "vitest";
import { editBotText, sendBotText, sendBotTextDraft } from "../../../src/bot/utils/telegram-text.js";
import { logger } from "../../../src/utils/logger.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe("bot/utils/telegram-text", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  it("sends raw messages by default", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
      text: "plain text",
      options: { reply_markup: { keyboard: [] } },
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "plain text", {
      reply_markup: { keyboard: [] },
    });
  });

  it("uses MarkdownV2 mode when requested", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
      text: "**formatted**",
      format: "markdown_v2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "**formatted**", {
      parse_mode: "MarkdownV2",
    });
  });

  it("uses raw fallback text when markdown parse fails", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce(
        new Error("Bad Request: can't parse entities: Character '.' is reserved"),
      )
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: unsupported start tag"))
      .mockResolvedValueOnce(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
      text: "Build succeeded.",
      rawFallbackText: "Build succeeded.",
      format: "markdown_v2",
    });

    expect(sendMessage).toHaveBeenCalledTimes(3);
    expect(sendMessage).toHaveBeenNthCalledWith(3, 100, "Build succeeded.", {});
  });

  it("edits raw messages by default", async () => {
    const editMessageText = vi.fn().mockResolvedValue(undefined);

    await editBotText({
      api: { editMessageText },
      chatId: 100,
      messageId: 200,
      text: "updated",
    });

    expect(editMessageText).toHaveBeenCalledTimes(1);
    expect(editMessageText).toHaveBeenCalledWith(100, 200, "updated", {});
  });

  it("falls back for markdown draft parse errors", async () => {
    const sendMessageDraft = vi
      .fn()
      .mockRejectedValueOnce(new Error("Bad Request: can't parse entities: Character '.' is reserved"))
      .mockResolvedValueOnce(undefined);

    await sendBotTextDraft({
      api: { sendMessageDraft },
      chatId: 100,
      draftId: 1,
      text: "Build succeeded.",
      format: "markdown_v2",
    });

    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(sendMessageDraft).toHaveBeenNthCalledWith(1, 100, 1, "Build succeeded.", {
      parse_mode: "MarkdownV2",
    });
    expect(sendMessageDraft).toHaveBeenNthCalledWith(2, 100, 1, "Build succeeded\\.", {
      parse_mode: "MarkdownV2",
    });
  });

  it("logs transport attempts and send failures", async () => {
    const sendMessage = vi.fn().mockRejectedValue(new Error("send failed"));

    await expect(
      sendBotText({
        api: { sendMessage },
        chatId: 100,
        text: "plain text",
        format: "raw",
        messageThreadId: 7,
      }),
    ).rejects.toThrow("send failed");

    expect(logger.debug).toHaveBeenCalled();
    expect(logger.error).toHaveBeenCalled();
  });
});
