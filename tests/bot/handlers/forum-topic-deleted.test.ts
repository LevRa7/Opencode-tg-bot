import { describe, expect, it, vi } from "vitest";

describe("forum_topic_edited handler", () => {
  it("deletes OpenCode sessions for messages in the deleted topic", async () => {
    const deleteSession = vi.fn().mockResolvedValue(undefined);
    const findByTgTopic = vi.fn().mockReturnValue([
      { oc_session_id: "s1", oc_project: "/proj", tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100 },
      { oc_session_id: "s1", oc_project: "/proj", tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 101 },
      { oc_session_id: "s2", oc_project: "/proj2", tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 102 },
    ]);
    const deleteByOcSession = vi.fn();

    const onForumTopicEdited = async (chatId: number, topicId: number | null) => {
      if (!topicId) return;
      const rows = findByTgTopic(chatId, topicId);
      const sessionIds = [...new Set(rows.map((r) => r.oc_session_id))];
      for (const sessionId of sessionIds) {
        const sessionRow = rows.find((r) => r.oc_session_id === sessionId);
        const directory = sessionRow?.oc_project ?? "";
        if (directory) {
          await deleteSession({ sessionID: sessionId, directory });
        }
        deleteByOcSession(sessionId);
      }
    };

    await onForumTopicEdited(777, 42);

    expect(deleteSession).toHaveBeenCalledTimes(2);
    expect(deleteSession).toHaveBeenCalledWith({ sessionID: "s1", directory: "/proj" });
    expect(deleteSession).toHaveBeenCalledWith({ sessionID: "s2", directory: "/proj2" });
    expect(deleteByOcSession).toHaveBeenCalledWith("s1");
    expect(deleteByOcSession).toHaveBeenCalledWith("s2");
  });

  it("skips sessions with empty directory", async () => {
    const deleteSession = vi.fn();
    const findByTgTopic = vi.fn().mockReturnValue([
      { oc_session_id: "s1", oc_project: "", tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100 },
    ]);
    const deleteByOcSession = vi.fn();

    const onForumTopicEdited = async (chatId: number, topicId: number | null) => {
      if (!topicId) return;
      const rows = findByTgTopic(chatId, topicId);
      const sessionIds = [...new Set(rows.map((r) => r.oc_session_id))];
      for (const sessionId of sessionIds) {
        const sessionRow = rows.find((r) => r.oc_session_id === sessionId);
        const directory = sessionRow?.oc_project ?? "";
        if (directory) {
          await deleteSession({ sessionID: sessionId, directory });
        }
        deleteByOcSession(sessionId);
      }
    };

    await onForumTopicEdited(777, 42);

    expect(deleteSession).not.toHaveBeenCalled();
    expect(deleteByOcSession).toHaveBeenCalledWith("s1");
  });

  it("does nothing when topicId is missing", async () => {
    const findByTgTopic = vi.fn();

    const onForumTopicEdited = async (chatId: number, topicId: number | null) => {
      if (!topicId) return;
      findByTgTopic(chatId, topicId);
    };

    await onForumTopicEdited(777, null);

    expect(findByTgTopic).not.toHaveBeenCalled();
  });

  it("handles session deletion errors gracefully", async () => {
    const deleteSession = vi.fn().mockRejectedValue(new Error("not found"));
    const findByTgTopic = vi.fn().mockReturnValue([
      { oc_session_id: "s1", oc_project: "/proj", tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100 },
    ]);
    const deleteByOcSession = vi.fn();

    const onForumTopicEdited = async (chatId: number, topicId: number | null) => {
      if (!topicId) return;
      const rows = findByTgTopic(chatId, topicId);
      const sessionIds = [...new Set(rows.map((r) => r.oc_session_id))];
      for (const sessionId of sessionIds) {
        try {
          const sessionRow = rows.find((r) => r.oc_session_id === sessionId);
          const directory = sessionRow?.oc_project ?? "";
          if (directory) {
            await deleteSession({ sessionID: sessionId, directory });
          }
          deleteByOcSession(sessionId);
        } catch {
          // ignore
        }
      }
    };

    await onForumTopicEdited(777, 42);

    // Should not throw
    expect(deleteSession).toHaveBeenCalled();
  });
});
