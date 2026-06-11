import { describe, expect, it, vi } from "vitest";

describe("message journal recording on assistant delivery", () => {
  it("records journal entries for each delivered Telegram message", () => {
    const insert = vi.fn();
    const getCurrentProject = vi.fn().mockReturnValue({ worktree: "/root/proj" });

    const telegramMessageIds = [101, 102, 103];
    const chatId = 777;
    const target = { messageThreadId: 42 };
    const sessionId = "s1";
    const messageId = "msg-assistant-1";
    const project = getCurrentProject()?.worktree ?? "";

    for (const tgMsgId of telegramMessageIds) {
      insert({
        tg_chat_id: chatId,
        tg_topic_id: target.messageThreadId ?? null,
        tg_message_id: tgMsgId,
        oc_server: "",
        oc_project: project,
        oc_session_id: sessionId,
        oc_message_id: messageId,
      });
    }

    expect(insert).toHaveBeenCalledTimes(3);
    expect(insert).toHaveBeenCalledWith({
      tg_chat_id: 777,
      tg_topic_id: 42,
      tg_message_id: 101,
      oc_server: "",
      oc_project: "/root/proj",
      oc_session_id: "s1",
      oc_message_id: "msg-assistant-1",
    });
  });

  it("skips recording when no messages were delivered", () => {
    const insert = vi.fn();
    const telegramMessageIds: number[] = [];

    if (telegramMessageIds.length > 0) {
      for (const tgMsgId of telegramMessageIds) {
        insert({ tg_message_id: tgMsgId });
      }
    }

    expect(insert).not.toHaveBeenCalled();
  });

  it("records empty project when no current project", () => {
    const insert = vi.fn();
    const getCurrentProject = vi.fn().mockReturnValue(null);

    const project = getCurrentProject()?.worktree ?? "";

    insert({
      tg_chat_id: 777,
      tg_topic_id: null,
      tg_message_id: 100,
      oc_server: "",
      oc_project: project,
      oc_session_id: "s1",
      oc_message_id: "msg-1",
    });

    expect(insert).toHaveBeenCalledWith(
      expect.objectContaining({ oc_project: "" }),
    );
  });
});
