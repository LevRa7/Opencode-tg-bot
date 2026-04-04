import { describe, expect, it, vi } from "vitest";
import { extractTelegramQrPayloads, sendTelegramQrImages } from "../../../src/bot/utils/telegram-qr.js";

vi.mock("qrcode", () => ({
  default: {
    toBuffer: vi.fn(async (text: string) => Buffer.from(`png:${text}`)),
  },
}));

describe("bot/utils/telegram-qr", () => {
  it("extracts unique tg login urls from assistant text", () => {
    expect(
      extractTelegramQrPayloads(
        [
          "Open Telegram and scan:",
          "tg://login?token=abc_123",
          "tg://login?token=abc_123",
          "tg://login?token=xyz-789",
        ].join("\n"),
      ),
    ).toEqual([
      { loginUrl: "tg://login?token=abc_123" },
      { loginUrl: "tg://login?token=xyz-789" },
    ]);
  });

  it("sends qr images for extracted login urls", async () => {
    const sendPhoto = vi.fn().mockResolvedValue(undefined);

    const sent = await sendTelegramQrImages({
      api: { sendPhoto },
      chatId: 321,
      messageText: "Use this login link: tg://login?token=abc_123",
      messageThreadId: 11,
    });

    expect(sent).toBe(1);
    expect(sendPhoto).toHaveBeenCalledTimes(1);
    expect(sendPhoto.mock.calls[0]?.[0]).toBe(321);
    expect(sendPhoto.mock.calls[0]?.[2]).toEqual({
      caption: "tg://login?token=abc_123",
      message_thread_id: 11,
    });
  });

  it("returns zero when assistant text has no login url", async () => {
    const sendPhoto = vi.fn().mockResolvedValue(undefined);

    const sent = await sendTelegramQrImages({
      api: { sendPhoto },
      chatId: 321,
      messageText: "No QR here",
    });

    expect(sent).toBe(0);
    expect(sendPhoto).not.toHaveBeenCalled();
  });
});
