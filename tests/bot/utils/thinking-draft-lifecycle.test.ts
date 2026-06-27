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

  it("keeps cross-route finalize retries pinned to the stored active transport after a publish failure", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const activeTransport = createTransport({
      sendMessage: vi
        .fn()
        .mockRejectedValueOnce(new Error("publish failed"))
        .mockResolvedValueOnce({ message_id: 901 }),
    });
    const foreignTransport = createTransport({
      chatId: 999,
      messageThreadId: 777,
      draftId: 2,
      routingIdentity: "chat:999:thread:777",
    });

    await lifecycle.renderActiveDraft("s1", "final-draft", activeTransport);
    await expect(lifecycle.finalizeDraft("s1", foreignTransport)).rejects.toThrow("publish failed");
    await expect(lifecycle.finalizeDraft("s1", foreignTransport)).resolves.toBeUndefined();

    expect(activeTransport.sendMessage).toHaveBeenCalledTimes(2);
    expect(activeTransport.sendMessage).toHaveBeenNthCalledWith(1, 123, "final-draft", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
    expect(activeTransport.sendMessage).toHaveBeenNthCalledWith(2, 123, "final-draft", {
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

  it("renders only the first safe html chunk for oversized drafts and publishes all chunks on finalize", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 900 });
    const transport = createTransport({ sendMessageDraft, sendMessage });
    const oversizedText =
      "<b>Thinking</b>\n\n<blockquote expandable><i>" +
      "Body section ".repeat(5000) +
      "</i></blockquote>";

    await lifecycle.renderActiveDraft("s1", oversizedText, transport);

    expect(sendMessageDraft).toHaveBeenCalledTimes(1);

    const draftText = sendMessageDraft.mock.calls[0][2] as string;
    expect(draftText.length).toBeLessThanOrEqual(32000);
    expect(draftText).toContain("<blockquote expandable>");
    expect(draftText).toContain("</blockquote>");
    expect(draftText).toContain("</i>");

    await lifecycle.finalizeDraft("s1", transport);

    expect(sendMessage.mock.calls.length).toBeGreaterThan(1);
    for (const call of sendMessage.mock.calls) {
      const publishedText = call[1] as string;
      expect(publishedText.length).toBeLessThanOrEqual(32000);
      expect(publishedText).toContain("</blockquote>");
    }
  });

  it("resumes finalize from the first unsent chunk after a later chunk send fails", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const sendMessage = vi
      .fn()
      .mockResolvedValueOnce({ message_id: 901 })
      .mockRejectedValueOnce(new Error("chunk send failed"))
      .mockResolvedValueOnce({ message_id: 902 });
    const transport = createTransport({ sendMessageDraft, sendMessage });
    const oversizedText =
      "<b>Thinking</b>\n\n<blockquote expandable><i>" +
      "Body section ".repeat(5000) +
      "</i></blockquote>";

    await lifecycle.renderActiveDraft("s1", oversizedText, transport);
    await expect(lifecycle.finalizeDraft("s1", transport)).rejects.toThrow("chunk send failed");
    await expect(lifecycle.finalizeDraft("s1", transport)).resolves.toBeUndefined();

    expect(sendMessage).toHaveBeenCalledTimes(4);

    const firstAttemptChunk = sendMessage.mock.calls[0][1] as string;
    const failedChunk = sendMessage.mock.calls[1][1] as string;
    const retriedChunk = sendMessage.mock.calls[2][1] as string;
    const finalChunk = sendMessage.mock.calls[3][1] as string;

    expect(retriedChunk).toBe(failedChunk);
    expect(retriedChunk).not.toBe(firstAttemptChunk);
    expect(finalChunk).not.toBe(firstAttemptChunk);
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
