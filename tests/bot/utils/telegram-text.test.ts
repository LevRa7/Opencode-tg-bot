import { describe, expect, it, vi } from "vitest";
import {
  editBotText,
  sendBotText,
  sendBotTextDraft,
} from "../../../src/bot/utils/telegram-text.js";

describe("bot/utils/telegram-text", () => {
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

  it("uses HTML mode when requested", async () => {
    const sendMessage = vi.fn().mockResolvedValue(undefined);

    await sendBotText({
      api: { sendMessage },
      chatId: 100,
      text: "<b>formatted</b>",
      format: "html",
    });

    expect(sendMessage).toHaveBeenCalledTimes(1);
    expect(sendMessage).toHaveBeenCalledWith(100, "<b>formatted</b>", {
      parse_mode: "HTML",
    });
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
    expect(editMessageText).toHaveBeenCalledWith(100, 200, "updated", undefined);
  });

  it("sends drafts with a stable draft id", async () => {
    const sendMessageDraft = vi.fn().mockResolvedValue(true);

    await sendBotTextDraft({
      api: { sendMessageDraft },
      chatId: 100,
      draftId: 7,
      text: "streaming text",
      options: { message_thread_id: 99 },
    });

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(sendMessageDraft).toHaveBeenCalledWith(100, 7, "streaming text", {
      message_thread_id: 99,
    });
  });
});
