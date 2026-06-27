import { describe, expect, it, vi } from "vitest";

import {
  createStreamedChildTopicSendText,
  deliverChildTopicMessage,
} from "../../../src/bot/subagent-topics/child-delivery.js";

describe("bot/subagent-topics/child-delivery", () => {
  it("routes child-topic sends through injected reopen and sendText dependencies", async () => {
    const sendText = vi.fn().mockResolvedValue(321);
    const withTopicReopenClose = vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
      await run(),
    );

    const result = await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
        getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 456 }) as never),
        withTopicReopenClose,
        sendText,
      } as never,
      {
        sessionId: "child-1",
        kind: "live_text",
        text: "Child message",
        format: "raw",
      } as never,
    );

    expect(withTopicReopenClose).toHaveBeenCalledWith("child-1", expect.any(Function));
    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        api: expect.any(Object),
        chatId: 123,
        text: "Child message",
        format: "raw",
        messageThreadId: 456,
        deliveryTarget: expect.objectContaining({ chatId: 123, messageThreadId: 456 }),
      }),
    );
    expect(result).toBe(321);
  });

  it("does not alter the original text payload when checking emptiness", async () => {
    const sendText = vi.fn().mockResolvedValue(1);

    await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
        getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 456 }) as never),
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-2",
        kind: "live_text",
        text: "  keep surrounding spaces  ",
        format: "raw",
      } as never,
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "  keep surrounding spaces  " }),
    );
  });

  it("returns null for empty text without opening the topic", async () => {
    const withTopicReopenClose = vi.fn();
    const sendText = vi.fn();

    const result = await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(),
        getDeliveryTarget: vi.fn(),
        withTopicReopenClose,
        sendText,
      } as never,
      {
        sessionId: "child-empty",
        kind: "diagnostic",
        text: "   ",
      } as never,
    );

    expect(result).toBeNull();
    expect(withTopicReopenClose).not.toHaveBeenCalled();
    expect(sendText).not.toHaveBeenCalled();
  });

  it("returns null when routing api is unavailable inside reopen wrapper", async () => {
    const getRoutingApi = vi.fn(() => null);
    const getDeliveryTarget = vi.fn(() => ({ chatId: 123, messageThreadId: 456 }) as never);
    const sendText = vi.fn();

    const result = await deliverChildTopicMessage(
      {
        getRoutingApi,
        getDeliveryTarget,
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-no-api",
        kind: "diagnostic",
        text: "Diagnostic text",
      } as never,
    );

    expect(result).toBeNull();
    expect(getRoutingApi).toHaveBeenCalledWith("child-no-api");
    expect(getDeliveryTarget).toHaveBeenCalledWith("child-no-api");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("returns null when delivery target is unavailable inside reopen wrapper", async () => {
    const getRoutingApi = vi.fn(() => ({ sendMessage: vi.fn() }) as never);
    const getDeliveryTarget = vi.fn(() => null);
    const sendText = vi.fn();

    const result = await deliverChildTopicMessage(
      {
        getRoutingApi,
        getDeliveryTarget,
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-no-target",
        kind: "live_text",
        text: "Child text",
      } as never,
    );

    expect(result).toBeNull();
    expect(getRoutingApi).toHaveBeenCalledWith("child-no-target");
    expect(getDeliveryTarget).toHaveBeenCalledWith("child-no-target");
    expect(sendText).not.toHaveBeenCalled();
  });

  it("forwards request options to sendText", async () => {
    const sendText = vi.fn().mockResolvedValue(777);
    const options = { entities: [{ type: "bold", offset: 0, length: 4 }] };

    await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
        getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 456 }) as never),
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-options",
        kind: "live_text",
        text: "Bold",
        options: options as never,
      } as never,
    );

    expect(sendText).toHaveBeenCalledWith(expect.objectContaining({ options }));
  });

  it("sends with terminal_footer kind", async () => {
    const sendText = vi.fn().mockResolvedValue(999);

    await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
        getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 789 }) as never),
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-footer",
        kind: "terminal_footer",
        text: "⏱ Done in 5s",
        format: "html",
      } as never,
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({
        text: "⏱ Done in 5s",
        format: "html",
        messageThreadId: 789,
      }),
    );
  });

  it("sends with interactive_prompt kind", async () => {
    const sendText = vi.fn().mockResolvedValue(888);

    await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
        getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 101 }) as never),
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-prompt",
        kind: "interactive_prompt",
        text: "What would you like to do next?",
      } as never,
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "What would you like to do next?" }),
    );
  });

  it("sends with file_or_media_notice kind", async () => {
    const sendText = vi.fn().mockResolvedValue(777);

    await deliverChildTopicMessage(
      {
        getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
        getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 202 }) as never),
        withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
          await run(),
        ),
        sendText,
      } as never,
      {
        sessionId: "child-file",
        kind: "file_or_media_notice",
        text: "Sent: diagram.png",
      } as never,
    );

    expect(sendText).toHaveBeenCalledWith(
      expect.objectContaining({ text: "Sent: diagram.png" }),
    );
  });

  it("fails loudly when a request kind is unsupported", async () => {
    const sendText = vi.fn();

    await expect(
      deliverChildTopicMessage(
        {
          getRoutingApi: vi.fn(() => ({ sendMessage: vi.fn() }) as never),
          getDeliveryTarget: vi.fn(() => ({ chatId: 123, messageThreadId: 456 }) as never),
          withTopicReopenClose: vi.fn(async (_sessionId: string, run: () => Promise<unknown>) =>
            await run(),
          ),
          sendText,
        } as never,
        {
          sessionId: "child-unsupported",
          kind: "unsupported_kind",
          text: "Oops",
        } as never,
      ),
    ).rejects.toThrow("Unsupported child topic delivery kind: unsupported_kind");
    expect(sendText).not.toHaveBeenCalled();
  });

  describe("createStreamedChildTopicSendText", () => {
    // The factory adapts the streaming transport into the child-topic sendText
    // dependency. It must enable HTML fallback so child-topic deliveries use the
    // same rich rendering path as the main assistant streaming pipeline.
    it("forwards params to the streamed transport and enables HTML fallback", async () => {
      const streamedSend = vi.fn().mockResolvedValue(555);

      const sendText = createStreamedChildTopicSendText(streamedSend);
      const result = await sendText({
        api: { sendMessage: vi.fn() } as never,
        chatId: 42,
        text: "Child final answer",
        format: "html",
        messageThreadId: 7,
      });

      expect(streamedSend).toHaveBeenCalledWith(
        expect.objectContaining({
          chatId: 42,
          text: "Child final answer",
          format: "html",
          messageThreadId: 7,
          useHtmlFallback: true,
        }),
      );
      expect(result).toBe(555);
    });

    it("returns null when the streamed transport returns null", async () => {
      const streamedSend = vi.fn().mockResolvedValue(null);

      const sendText = createStreamedChildTopicSendText(streamedSend);
      const result = await sendText({
        api: { sendMessage: vi.fn() } as never,
        chatId: 1,
        text: "x",
      });

      expect(result).toBeNull();
    });
  });
});
