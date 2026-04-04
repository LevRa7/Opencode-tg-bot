import { describe, expect, it, vi } from "vitest";
import { finalizeAssistantResponse } from "../../../src/bot/utils/finalize-assistant-response.js";

describe("bot/utils/finalize-assistant-response", () => {
  it("flushes pending state, sends qr images, and sends formatted text parts", async () => {
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendQrCodes = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "final reply",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["part 1", "part 2"]),
      formatRawSummary: vi.fn(() => ["part 1", "part 2"]),
      resolveFormat: vi.fn(() => "markdown_v2" as const),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendQrCodes,
      sendText,
    });

    expect(flushDraftStream).toHaveBeenCalledWith("s1");
    expect(flushPendingServiceMessages).toHaveBeenCalledTimes(1);
    expect(sendQrCodes).toHaveBeenCalledWith("final reply");
    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(
      1,
      "part 1",
      "part 1",
      { reply_markup: { keyboard: [[{ text: "A" }]] } },
      "markdown_v2",
    );
    expect(sendText).toHaveBeenNthCalledWith(
      2,
      "part 2",
      "part 2",
      { reply_markup: { keyboard: [[{ text: "A" }]] } },
      "markdown_v2",
    );
  });

  it("sends reply without keyboard when none is available", async () => {
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);
    const sendQrCodes = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "reply",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["reply"]),
      formatRawSummary: vi.fn(() => ["reply"]),
      resolveFormat: vi.fn(() => "raw" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendQrCodes,
      sendText,
    });

    expect(sendQrCodes).toHaveBeenCalledWith("reply");
    expect(sendText).toHaveBeenCalledTimes(1);
    expect(sendText).toHaveBeenCalledWith("reply", "reply", undefined, "raw");
  });

  it("skips qr sending when callback is not provided", async () => {
    const flushDraftStream = vi.fn().mockResolvedValue(undefined);
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendText = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageText: "reply",
      flushDraftStream,
      flushPendingServiceMessages,
      formatSummary: vi.fn(() => ["reply"]),
      formatRawSummary: vi.fn(() => ["reply"]),
      resolveFormat: vi.fn(() => "raw" as const),
      getReplyKeyboard: vi.fn(() => undefined),
      sendText,
    });

    expect(sendText).toHaveBeenCalledWith("reply", "reply", undefined, "raw");
  });
});
