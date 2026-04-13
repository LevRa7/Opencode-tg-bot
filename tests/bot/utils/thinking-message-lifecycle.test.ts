import { describe, expect, it, vi } from "vitest";
import { ThinkingMessageLifecycleManager } from "../../../src/bot/utils/thinking-message-lifecycle.js";

describe("bot/utils/thinking-message-lifecycle", () => {
  it("sends the first thinking render as a new message and edits later updates", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "<blockquote><b>Thinking</b></blockquote>", {
      sendText,
      editText,
      deleteText,
    });
    await manager.render(
      "s1",
      "<blockquote><b>Thinking</b></blockquote>\n\n<blockquote expandable>Body</blockquote>",
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
      "<blockquote><b>Thinking</b></blockquote>\n\n<blockquote expandable>Body</blockquote>",
    );
  });

  it("deletes thinking message on finalize when clear mode is on", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "<blockquote><b>Thinking</b></blockquote>", {
      sendText,
      editText,
      deleteText,
    });
    await manager.finalize("s1", true, { sendText, editText, deleteText });

    expect(deleteText).toHaveBeenCalledWith(101);
  });

  it("keeps thinking message on finalize when clear mode is off", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);

    await manager.render("s1", "<blockquote><b>Thinking</b></blockquote>", {
      sendText,
      editText,
      deleteText,
    });
    await manager.finalize("s1", false, { sendText, editText, deleteText });

    expect(deleteText).not.toHaveBeenCalled();
  });

  it("does not duplicate the same thinking render text", async () => {
    const manager = new ThinkingMessageLifecycleManager();
    const sendText = vi.fn().mockResolvedValue(101);
    const editText = vi.fn().mockResolvedValue(undefined);
    const deleteText = vi.fn().mockResolvedValue(undefined);
    const text = "<blockquote><b>Thinking</b></blockquote>\n\n<blockquote expandable>Step 1</blockquote>";

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
});
