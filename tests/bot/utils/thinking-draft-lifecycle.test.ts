import { describe, expect, it, vi } from "vitest";
import { ThinkingDraftLifecycle } from "../../../src/bot/utils/thinking-draft-lifecycle.js";

function createTransport(overrides?: Partial<Parameters<ThinkingDraftLifecycle["renderActiveDraft"]>[2]>) {
  return {
    chatId: 123,
    messageThreadId: 456,
    draftId: 1,
    routingIdentity: "chat:123:thread:456",
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    sendMessage: vi.fn().mockResolvedValue({ message_id: 900 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

describe("bot/utils/thinking-draft-lifecycle", () => {
  it("starts a new draft lifecycle for the first active block", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport();

    await lifecycle.renderActiveDraft("s1", "<b>Thinking</b>", transport);

    expect(transport.sendMessageDraft).toHaveBeenCalledWith(123, 1, "<b>Thinking</b>", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
    expect(transport.sendMessage).not.toHaveBeenCalled();
  });

  it("updates the same active draft when the block changes on the same route", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport();

    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await lifecycle.renderActiveDraft("s1", "draft-2", transport);

    expect(transport.sendMessageDraft).toHaveBeenCalledTimes(2);
    expect(transport.sendMessageDraft).toHaveBeenNthCalledWith(2, 123, 1, "draft-2", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("publishes a normal message on finalize and clears active draft state", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport();

    await lifecycle.renderActiveDraft("s1", "final-draft", transport);
    await lifecycle.finalizeDraft("s1", transport);
    await lifecycle.finalizeDraft("s1", transport);

    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.sendMessage).toHaveBeenCalledWith(123, "final-draft", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("does not publish stale cached text when the latest draft update failed", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport({
      sendMessageDraft: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("draft update failed")),
    });

    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await expect(lifecycle.renderActiveDraft("s1", "draft-2", transport)).rejects.toThrow(
      "draft update failed",
    );
    await expect(lifecycle.finalizeDraft("s1", transport)).rejects.toThrow("draft update failed");

    expect(transport.sendMessage).not.toHaveBeenCalled();
  });

  it("publishes successfully after a failed update falls back to the last successful draft text", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport({
      sendMessageDraft: vi
        .fn()
        .mockResolvedValueOnce(true)
        .mockRejectedValueOnce(new Error("draft update failed")),
    });

    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await expect(lifecycle.renderActiveDraft("s1", "draft-2", transport)).rejects.toThrow(
      "draft update failed",
    );
    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await expect(lifecycle.finalizeDraft("s1", transport)).resolves.toBeUndefined();

    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.sendMessage).toHaveBeenCalledWith(123, "draft-1", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("publishes through the stored active route instead of a cross-route finalize transport", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const activeTransport = createTransport();
    const foreignTransport = createTransport({
      chatId: 999,
      messageThreadId: 777,
      draftId: 2,
      routingIdentity: "chat:999:thread:777",
    });

    await lifecycle.renderActiveDraft("s1", "final-draft", activeTransport);
    await lifecycle.finalizeDraft("s1", foreignTransport);

    expect(activeTransport.sendMessage).toHaveBeenCalledTimes(1);
    expect(activeTransport.sendMessage).toHaveBeenCalledWith(123, "final-draft", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
    expect(foreignTransport.sendMessage).not.toHaveBeenCalled();
  });

  it("starts a fresh draft after finalize instead of reusing the previous one", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const firstTransport = createTransport();
    const secondTransport = createTransport({ draftId: 2 });

    await lifecycle.renderActiveDraft("s1", "draft-1", firstTransport);
    await lifecycle.finalizeDraft("s1", firstTransport);
    await lifecycle.renderActiveDraft("s1", "draft-2", secondTransport);

    expect(secondTransport.sendMessageDraft).toHaveBeenCalledTimes(1);
    expect(secondTransport.sendMessageDraft).toHaveBeenCalledWith(123, 2, "draft-2", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("clears only the active unfinished draft when forced cleanup is requested", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport();

    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await expect(lifecycle.clearActiveDraft("s1", true, transport)).resolves.toBe("cleared");
    await lifecycle.finalizeDraft("s1", transport);

    expect(transport.deleteMessage).toHaveBeenCalledTimes(1);
    expect(transport.deleteMessage).toHaveBeenCalledWith(123, 1);
    expect(transport.sendMessage).not.toHaveBeenCalled();
  });

  it("preserves draft state when forced cleanup cannot delete the draft message", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const transport = createTransport({
      deleteMessage: vi.fn().mockRejectedValue(new Error("delete failed")),
    });

    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await expect(lifecycle.clearActiveDraft("s1", true, transport)).resolves.toBe("preserved");
    await lifecycle.finalizeDraft("s1", transport);

    expect(transport.deleteMessage).toHaveBeenCalledTimes(1);
    expect(transport.sendMessage).toHaveBeenCalledTimes(1);
    expect(transport.sendMessage).toHaveBeenCalledWith(123, "draft-1", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("drops internal draft state when clear is skipped or routed to a different draft", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const activeTransport = createTransport();
    const foreignTransport = createTransport({
      chatId: 999,
      messageThreadId: 777,
      draftId: 2,
      routingIdentity: "chat:999:thread:777",
    });

    await lifecycle.renderActiveDraft("s1", "draft-1", activeTransport);
    await expect(lifecycle.clearActiveDraft("s1", false, activeTransport)).resolves.toBe("dropped");
    await lifecycle.finalizeDraft("s1", activeTransport);

    expect(activeTransport.deleteMessage).not.toHaveBeenCalled();
    expect(activeTransport.sendMessage).not.toHaveBeenCalled();

    const secondLifecycle = new ThinkingDraftLifecycle();
    const secondActiveTransport = createTransport({ sendMessage: vi.fn().mockResolvedValue({ message_id: 901 }) });
    const secondForeignTransport = createTransport({
      chatId: 999,
      messageThreadId: 777,
      draftId: 2,
      routingIdentity: "chat:999:thread:777",
      sendMessage: vi.fn().mockResolvedValue({ message_id: 902 }),
    });

    await secondLifecycle.renderActiveDraft("s1", "draft-2", secondActiveTransport);
    await expect(secondLifecycle.clearActiveDraft("s1", true, secondForeignTransport)).resolves.toBe("dropped");
    await secondLifecycle.finalizeDraft("s1", secondActiveTransport);

    expect(secondForeignTransport.deleteMessage).not.toHaveBeenCalled();
    expect(secondActiveTransport.sendMessage).not.toHaveBeenCalled();
    expect(secondForeignTransport.sendMessage).not.toHaveBeenCalled();
  });

  it("reports missing when clear is requested without an active draft", async () => {
    const lifecycle = new ThinkingDraftLifecycle();

    await expect(lifecycle.clearActiveDraft("missing-session", true, createTransport())).resolves.toBe("missing");
  });
});
