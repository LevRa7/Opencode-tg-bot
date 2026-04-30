import { afterEach, describe, expect, it, vi } from "vitest";
import { createSafeTelegramSender } from "../../../src/bot/delivery/safe-telegram-sender.js";

function createTelegramRateLimitError(retryAfterSeconds: number) {
  return {
    error_code: 429,
    description: `Too Many Requests: retry after ${retryAfterSeconds}`,
    parameters: {
      retry_after: retryAfterSeconds,
    },
  };
}

function createApi() {
  return {
    sendMessage: vi.fn(),
    editMessageText: vi.fn(),
    deleteMessage: vi.fn(),
    sendMessageDraft: vi.fn(),
  };
}

describe("bot/delivery/safe-telegram-sender", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries sendMessage when Telegram returns retry_after", async () => {
    vi.useFakeTimers();

    const api = createApi();
    api.sendMessage
      .mockRejectedValueOnce(createTelegramRateLimitError(1))
      .mockResolvedValueOnce({ message_id: 42 });

    const sender = createSafeTelegramSender(api as any);
    const promise = sender.sendMessage(123, "assistant reply", {
      disable_notification: true,
    });

    await vi.advanceTimersByTimeAsync(1000);

    await expect(promise).resolves.toEqual({ message_id: 42 });
    expect(api.sendMessage).toHaveBeenCalledTimes(2);
    expect(api.sendMessage).toHaveBeenNthCalledWith(1, 123, "assistant reply", {
      disable_notification: true,
    });
    expect(api.sendMessage).toHaveBeenNthCalledWith(2, 123, "assistant reply", {
      disable_notification: true,
    });
  });

  it("retries editMessageText, deleteMessage, and sendMessageDraft on Telegram rate limits", async () => {
    vi.useFakeTimers();

    const api = createApi();
    api.editMessageText
      .mockRejectedValueOnce(createTelegramRateLimitError(1))
      .mockResolvedValueOnce(true);
    api.deleteMessage
      .mockRejectedValueOnce(createTelegramRateLimitError(1))
      .mockResolvedValueOnce(true);
    api.sendMessageDraft
      .mockRejectedValueOnce(createTelegramRateLimitError(1))
      .mockResolvedValueOnce(true);

    const sender = createSafeTelegramSender(api as any);

    const editPromise = sender.editMessageText(123, 9, "edited", {
      parse_mode: "HTML",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(editPromise).resolves.toBe(true);

    const deletePromise = sender.deleteMessage(123, 9);
    await vi.advanceTimersByTimeAsync(1000);
    await expect(deletePromise).resolves.toBe(true);

    const draftPromise = sender.sendMessageDraft(123, 5, "draft", {
      parse_mode: "HTML",
    });
    await vi.advanceTimersByTimeAsync(1000);
    await expect(draftPromise).resolves.toBe(true);

    expect(api.editMessageText).toHaveBeenCalledTimes(2);
    expect(api.editMessageText).toHaveBeenNthCalledWith(1, 123, 9, "edited", {
      parse_mode: "HTML",
    });
    expect(api.deleteMessage).toHaveBeenCalledTimes(2);
    expect(api.deleteMessage).toHaveBeenNthCalledWith(1, 123, 9);
    expect(api.sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(api.sendMessageDraft).toHaveBeenNthCalledWith(1, 123, 5, "draft", {
      parse_mode: "HTML",
    });
  });

  it("rejects terminal non-rate-limit failures without retrying", async () => {
    const api = createApi();
    api.sendMessage.mockRejectedValueOnce(new Error("400: Bad Request"));

    const sender = createSafeTelegramSender(api as any);

    await expect(sender.sendMessage(123, "assistant reply")).rejects.toThrow("400: Bad Request");
    expect(api.sendMessage).toHaveBeenCalledTimes(1);
  });
});
