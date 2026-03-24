import { describe, expect, it, vi } from "vitest";
import {
  isSendMessageDraftEffectSuppressed,
  runWithoutSendMessageDraftEffect,
  sendMessageWithoutDraftEffect,
} from "../../../src/bot/utils/send-message-draft-effect-context.js";

describe("bot/utils/send-message-draft-effect-context", () => {
  it("suppresses the short draft effect inside the wrapped async flow", async () => {
    expect(isSendMessageDraftEffectSuppressed()).toBe(false);

    await runWithoutSendMessageDraftEffect(async () => {
      expect(isSendMessageDraftEffectSuppressed()).toBe(true);

      await Promise.resolve();

      expect(isSendMessageDraftEffectSuppressed()).toBe(true);
    });

    expect(isSendMessageDraftEffectSuppressed()).toBe(false);
  });

  it("wraps sendMessage calls without losing arguments", async () => {
    const sendMessage = vi.fn(async () => {
      expect(isSendMessageDraftEffectSuppressed()).toBe(true);
      return {};
    });

    await sendMessageWithoutDraftEffect({ sendMessage } as never, 123, "hello", {
      message_thread_id: 7,
    });

    expect(sendMessage).toHaveBeenCalledWith(123, "hello", { message_thread_id: 7 });

    expect(isSendMessageDraftEffectSuppressed()).toBe(false);
  });
});
