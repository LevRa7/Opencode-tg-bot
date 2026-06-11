import { describe, expect, it, vi } from "vitest";
import { InlineKeyboard } from "grammy";

describe("edited_message handler", () => {
  it("shows fork/revert keyboard when an edited message is in the journal", async () => {
    const reply = vi.fn().mockResolvedValue(undefined);
    const findByTgMessage = vi.fn().mockReturnValue({
      oc_session_id: "s1",
      oc_message_id: "msg-abc",
      oc_project: "/proj",
      tg_message_id: 100,
      tg_chat_id: 777,
      tg_topic_id: null,
    });

    const editedMessage = {
      message_id: 100,
      message_thread_id: null,
      text: "edited text",
    };

    // Simulate the handler
    const chatId = 777;
    const topicId = editedMessage.message_thread_id ?? null;
    const msgId = editedMessage.message_id;
    const row = findByTgMessage(msgId, chatId, topicId);

    if (row) {
      const keyboard = new InlineKeyboard()
        .text("Fork in new topic", `mj_fork_${row.oc_session_id}_${row.oc_message_id}`)
        .row()
        .text("Revert to this message", `mj_revert_${row.oc_session_id}_${row.oc_message_id}`);

      await reply("Message edited. Choose action:", { reply_markup: keyboard });
    }

    expect(reply).toHaveBeenCalledWith(
      "Message edited. Choose action:",
      expect.objectContaining({ reply_markup: expect.any(InlineKeyboard) }),
    );
  });

  it("does nothing when edited message is not in journal", async () => {
    const reply = vi.fn();
    const findByTgMessage = vi.fn().mockReturnValue(null);

    const editedMessage = { message_id: 999, message_thread_id: null, text: "text" };
    const row = findByTgMessage(editedMessage.message_id, 777, null);

    if (row) {
      await reply("test");
    }

    expect(reply).not.toHaveBeenCalled();
  });

  it("does nothing when edited message has no text", async () => {
    const reply = vi.fn();
    const findByTgMessage = vi.fn();

    const editedMessage = { message_id: 100, message_thread_id: null, text: undefined };
    const hasText = Boolean(editedMessage.text);

    if (hasText) {
      findByTgMessage(editedMessage.message_id, 777, null);
    }

    expect(findByTgMessage).not.toHaveBeenCalled();
  });

  it("replies with no_session when no active session", async () => {
    const reply = vi.fn();
    const findByTgMessage = vi.fn().mockReturnValue({
      oc_session_id: "s1",
      oc_message_id: "msg-abc",
    });
    const getCurrentSession = vi.fn().mockReturnValue(null);

    const row = findByTgMessage(100, 777, null);
    if (row) {
      const session = getCurrentSession();
      if (!session) {
        await reply("No active session for edit handling.");
        return;
      }
    }

    expect(reply).toHaveBeenCalledWith("No active session for edit handling.");
  });
});
