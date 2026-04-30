import { describe, expect, it, vi } from "vitest";
import { ThinkingMessageLifecycleManager } from "../../../src/bot/utils/thinking-message-lifecycle.js";

describe("bot/utils/thinking-message-lifecycle", () => {
  it("sends the first render as a new message and edits later updates for the same active block", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "<b>Thinking</b>", {
      sendText,
      editText,
      deleteText,
    });
    await manager.render(
      "s1",
      "<b>Thinking</b>\n\n<blockquote expandable>Body</blockquote>",
      {
        sendText,
        editText,
        deleteText,
      },
    );

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledTimes(1);
    expect(editText).toHaveBeenCalledWith(
      101,
      "<b>Thinking</b>\n\n<blockquote expandable>Body</blockquote>",
    );
  });

  it("keeps the completed block visible on normal finalize", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "<b>Thinking</b>", {
      sendText,
      editText,
      deleteText,
    });
    await manager.finalize("s1", false, { sendText, editText, deleteText });

    expect(deleteText).not.toHaveBeenCalled();
  });

  it("starts a new message after finalize clears active state", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValueOnce(101).mockResolvedValueOnce(202);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "block-1", { sendText, editText, deleteText });
    await manager.finalize("s1", false, { sendText, editText, deleteText });
    await manager.render("s1", "block-2", { sendText, editText, deleteText });

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(editText).not.toHaveBeenCalled();
  });

  it("ignores overlap renders queued after finalize begins and starts the next block as a new message", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    let resolveFirstSend: ((messageId: number) => void) | undefined;
    const firstSend = new Promise<number>((resolve) => {
      resolveFirstSend = resolve;
    });
    const sendText = vi
      .fn<(_: string) => Promise<number>>()
      .mockImplementationOnce(() => firstSend)
      .mockResolvedValueOnce(202);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    // This keeps the first block active long enough to queue finalize and a stale follow-up render behind it.
    const firstRender = manager.render("s1", "block-1", { sendText, editText, deleteText });
    const finalize = manager.finalize("s1", false, { sendText, editText, deleteText });
    const overlapRender = manager.render("s1", "block-2", { sendText, editText, deleteText });

    resolveFirstSend?.(101);

    await Promise.all([firstRender, finalize, overlapRender]);

    expect(editText).not.toHaveBeenCalled();

    await manager.render("s1", "block-3", { sendText, editText, deleteText });

    expect(sendText).toHaveBeenCalledTimes(2);
    expect(sendText).toHaveBeenNthCalledWith(2, "block-3");
  });

  it("does not duplicate the same thinking render text", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const text = "<b>Thinking</b>\n\n<blockquote expandable>Step 1</blockquote>";

    await manager.render("s1", text, {
      sendText,
      editText,
      deleteText,
    });
    await manager.render("s1", text, {
      sendText,
      editText,
      deleteText,
    });

    expect(sendText).toHaveBeenCalledTimes(1);
    expect(editText).not.toHaveBeenCalled();
  });

  it("deletes only the active unfinished block when forced clear is requested", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "block-1", {
      sendText,
      editText,
      deleteText,
      routingIdentity: "chat:123:thread:1",
    });
    await manager.finalize("s1", true, {
      sendText,
      editText,
      deleteText,
      routingIdentity: "chat:123:thread:1",
    });

    expect(deleteText).toHaveBeenCalledWith(101);
  });

  it("refuses forced delete when finalize routing no longer matches the original thinking message route", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteOnOriginalRoute = vi.fn().mockResolvedValue(undefined);
    const deleteOnChangedRoute = vi.fn().mockResolvedValue(undefined);

    // This regression test fixes the reviewed bug where forced clear could delete in the wrong chat.
    await manager.render("s1", "block-1", {
      sendText,
      editText,
      deleteText: deleteOnOriginalRoute,
      routingIdentity: "chat:123:thread:1",
    });

    await manager.finalize("s1", true, {
      sendText,
      editText,
      deleteText: deleteOnChangedRoute,
      routingIdentity: "chat:456:thread:9",
    });

    expect(deleteOnOriginalRoute).not.toHaveBeenCalled();
    expect(deleteOnChangedRoute).not.toHaveBeenCalled();
  });

  it("starts a fresh message when the render route changes instead of editing through the new route", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendTextOnOriginalRoute = vi.fn().mockResolvedValue(101);
    const editTextOnOriginalRoute = vi.fn().mockResolvedValue(undefined);
    const deleteTextOnOriginalRoute = vi.fn().mockResolvedValue(undefined);
    const sendTextOnChangedRoute = vi.fn().mockResolvedValue(202);
    const editTextOnChangedRoute = vi.fn().mockResolvedValue(undefined);
    const deleteTextOnChangedRoute = vi.fn().mockResolvedValue(undefined);

    // This guards the reviewed bug where a new route could still edit the old message id.
    await manager.render("s1", "block-1", {
      sendText: sendTextOnOriginalRoute,
      editText: editTextOnOriginalRoute,
      deleteText: deleteTextOnOriginalRoute,
      routingIdentity: "chat:123:thread:1",
    });

    await manager.render("s1", "block-2", {
      sendText: sendTextOnChangedRoute,
      editText: editTextOnChangedRoute,
      deleteText: deleteTextOnChangedRoute,
      routingIdentity: "chat:456:thread:9",
    });

    expect(editTextOnOriginalRoute).not.toHaveBeenCalled();
    expect(editTextOnChangedRoute).not.toHaveBeenCalled();
    expect(sendTextOnOriginalRoute).toHaveBeenCalledTimes(1);
    expect(sendTextOnChangedRoute).toHaveBeenCalledTimes(1);

    await manager.render("s1", "block-3", {
      sendText: sendTextOnChangedRoute,
      editText: editTextOnChangedRoute,
      deleteText: deleteTextOnChangedRoute,
      routingIdentity: "chat:456:thread:9",
    });

    expect(editTextOnChangedRoute).toHaveBeenCalledTimes(1);
    expect(editTextOnChangedRoute).toHaveBeenCalledWith(202, "block-3");
  });

  it("rejects render when sending the message fails so callers can retry the same text", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockRejectedValue(new Error("boom"));
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    // This regression test proves transport failures must escape the lifecycle boundary.
    await expect(manager.render("s1", "block-1", { sendText, editText, deleteText })).rejects.toThrow("boom");

    expect(editText).not.toHaveBeenCalled();
  });
});
