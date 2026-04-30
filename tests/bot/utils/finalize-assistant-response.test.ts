import { describe, expect, it, vi } from "vitest";
import type { TelegramRenderedPart } from "../../../src/telegram/render/types.js";
import { finalizeAssistantResponse } from "../../../src/bot/utils/finalize-assistant-response.js";

function createRenderedPart(text: string): TelegramRenderedPart {
  return {
    text,
    fallbackText: text,
    source: "plain",
  };
}

describe("bot/utils/finalize-assistant-response", () => {
  it("flushes service messages before finalizing the visible assistant response through responseStreamer", async () => {
    const callOrder: string[] = [];
    const responseStreamer = {
      complete: vi.fn(async () => {
        callOrder.push("complete");
        return { streamed: true, telegramMessageIds: [41] };
      }),
    };
    const flushPendingServiceMessages = vi.fn(async () => {
      callOrder.push("flush_services");
    });
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const prepareStreamingPayload = vi.fn(() => ({ parts: [createRenderedPart("final reply")] }));

    const streamed = await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload,
      renderFinalParts: vi.fn(() => [createRenderedPart("fallback final")]),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendRenderedPart,
      sourceCommand: undefined,
    });

    expect(streamed).toBe(true);
    expect(callOrder).toEqual(["flush_services", "complete"]);
    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [createRenderedPart("final reply")],
      sendOptions: {
        disable_notification: true,
      },
      editOptions: undefined,
    });
    expect(sendRenderedPart).not.toHaveBeenCalled();
  });

  it("falls back to sending rendered final parts when the response stream never became visible", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
    };
    const flushPendingServiceMessages = vi.fn().mockResolvedValue(undefined);
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);
    const firstPart = createRenderedPart("first");
    const secondPart = createRenderedPart("second");

    const streamed = await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [firstPart, secondPart]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart,
    });

    expect(streamed).toBe(false);
    expect(sendRenderedPart).toHaveBeenCalledTimes(2);
    expect(sendRenderedPart).toHaveBeenNthCalledWith(1, firstPart, { disable_notification: true });
    expect(sendRenderedPart).toHaveBeenNthCalledWith(2, secondPart, { disable_notification: true });
  });

  it("flushes service messages before delivering fallback final parts", async () => {
    const callOrder: string[] = [];
    const responseStreamer = {
      complete: vi.fn(async () => {
        callOrder.push("complete");
        return { streamed: false, telegramMessageIds: [] };
      }),
    };
    const flushPendingServiceMessages = vi.fn(async () => {
      callOrder.push("flush_services");
    });
    const sendRenderedPart = vi.fn(async () => {
      callOrder.push("send_part");
    });

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [createRenderedPart("final reply")]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart,
    });

    expect(callOrder).toEqual(["flush_services", "complete", "send_part"]);
  });

  it("passes reply keyboard only to the final assistant delivery path", async () => {
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer: {
        complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
      },
      flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [createRenderedPart("final reply")]),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendRenderedPart,
      sourceCommand: "/start",
    });

    expect(sendRenderedPart).toHaveBeenCalledWith(createRenderedPart("final reply"), {
      disable_notification: true,
      reply_markup: { keyboard: [[{ text: "A" }]] },
    });
  });

  it("keeps reply keyboard for /start /help /new triggers", async () => {
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer: {
        complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
      },
      flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [createRenderedPart("final reply")]),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendRenderedPart,
      sourceCommand: "/start",
    });

    expect(sendRenderedPart).toHaveBeenCalledWith(createRenderedPart("final reply"), {
      disable_notification: true,
      reply_markup: { keyboard: [[{ text: "A" }]] },
    });
  });

  it("does not auto-expand reply keyboard for ordinary responses", async () => {
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer: {
        complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
      },
      flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [createRenderedPart("final reply")]),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendRenderedPart,
      sourceCommand: undefined,
    });

    expect(sendRenderedPart).toHaveBeenCalledWith(createRenderedPart("final reply"), {
      disable_notification: true,
      reply_markup: { keyboard: [[{ text: "A" }]] },
    });
  });

  it("preserves html streaming payloads for final in-place completion", async () => {
    const responseStreamer = {
      complete: vi.fn().mockResolvedValue({ streamed: true, telegramMessageIds: [99] }),
    };

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "<code>tg-cli</code>",
      responseStreamer,
      flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
      prepareStreamingPayload: vi.fn(() => ({
        parts: [{ text: "<code>tg-cli</code>" }],
        format: "html",
      })),
      renderFinalParts: vi.fn(() => [createRenderedPart("tg-cli")]),
      getReplyKeyboard: vi.fn(() => undefined),
      sendRenderedPart: vi.fn().mockResolvedValue(undefined),
      sourceCommand: undefined,
    });

    expect(responseStreamer.complete).toHaveBeenCalledWith("s1", "m1", {
      parts: [{ text: "<code>tg-cli</code>" }],
      format: "html",
      sendOptions: { disable_notification: true },
      editOptions: undefined,
    });
  });

  it("keeps reply keyboard for /help and /new triggers", async () => {
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);

    for (const command of ["/help", "/new"]) {
      await finalizeAssistantResponse({
        sessionId: "s1",
        messageId: "m1",
        messageText: "final reply",
        responseStreamer: {
          complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
        },
        flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
        prepareStreamingPayload: vi.fn(() => null),
        renderFinalParts: vi.fn(() => [createRenderedPart("final reply")]),
        getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
        sendRenderedPart,
        sourceCommand: command,
      });
    }

    expect(sendRenderedPart).toHaveBeenCalledWith(createRenderedPart("final reply"), {
      disable_notification: true,
      reply_markup: { keyboard: [[{ text: "A" }]] },
    });
  });

  it("does not auto-expand reply keyboard for ordinary responses", async () => {
    const sendRenderedPart = vi.fn().mockResolvedValue(undefined);

    await finalizeAssistantResponse({
      sessionId: "s1",
      messageId: "m1",
      messageText: "final reply",
      responseStreamer: {
        complete: vi.fn().mockResolvedValue({ streamed: false, telegramMessageIds: [] }),
      },
      flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
      prepareStreamingPayload: vi.fn(() => null),
      renderFinalParts: vi.fn(() => [createRenderedPart("final reply")]),
      getReplyKeyboard: vi.fn(() => ({ keyboard: [[{ text: "A" }]] })),
      sendRenderedPart,
      sourceCommand: undefined,
    });

    expect(sendRenderedPart).toHaveBeenCalledWith(createRenderedPart("final reply"), {
      disable_notification: true,
      reply_markup: { keyboard: [[{ text: "A" }]] },
    });
  });
});
