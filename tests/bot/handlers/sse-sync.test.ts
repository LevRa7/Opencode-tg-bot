import { describe, expect, it, vi } from "vitest";

describe("SSE message.removed sync", () => {
  it("finds journal rows by opencode message and deletes from Telegram", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const deleteByTgMessage = vi.fn();
    const findByOcMessage = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_message_id: 100, tg_topic_id: null },
      { tg_chat_id: 777, tg_message_id: 101, tg_topic_id: null },
    ]);

    // Simulate setOnMessageRemoved handler
    const onMessageRemoved = async (sessionId: string, messageId: string) => {
      const rows = findByOcMessage(sessionId, messageId);
      for (const row of rows) {
        await deleteMessage(row.tg_chat_id, row.tg_message_id);
        deleteByTgMessage(row.tg_message_id, row.tg_chat_id, row.tg_topic_id);
      }
    };

    await onMessageRemoved("s1", "msg-1");

    expect(findByOcMessage).toHaveBeenCalledWith("s1", "msg-1");
    expect(deleteMessage).toHaveBeenCalledTimes(2);
    expect(deleteMessage).toHaveBeenCalledWith(777, 100);
    expect(deleteMessage).toHaveBeenCalledWith(777, 101);
    expect(deleteByTgMessage).toHaveBeenCalledTimes(2);
  });

  it("handles Telegram delete failure gracefully", async () => {
    const deleteMessage = vi.fn().mockRejectedValue(new Error("forbidden"));
    const deleteByTgMessage = vi.fn();
    const findByOcMessage = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_message_id: 100, tg_topic_id: null },
    ]);

    const onMessageRemoved = async (sessionId: string, messageId: string) => {
      const rows = findByOcMessage(sessionId, messageId);
      for (const row of rows) {
        try {
          await deleteMessage(row.tg_chat_id, row.tg_message_id);
          deleteByTgMessage(row.tg_message_id, row.tg_chat_id, row.tg_topic_id);
        } catch {
          // ignore
        }
      }
    };

    await onMessageRemoved("s1", "msg-1");
    // Should not throw
    expect(findByOcMessage).toHaveBeenCalled();
  });

  it("does nothing when no journal rows found", async () => {
    const deleteMessage = vi.fn();
    const findByOcMessage = vi.fn().mockReturnValue([]);

    const onMessageRemoved = async (sessionId: string, messageId: string) => {
      const rows = findByOcMessage(sessionId, messageId);
      for (const row of rows) {
        await deleteMessage(row.tg_chat_id, row.tg_message_id);
      }
    };

    await onMessageRemoved("s1", "msg-nonexistent");
    expect(deleteMessage).not.toHaveBeenCalled();
  });
});

describe("SSE session.deleted sync", () => {
  it("deletes entire forum topic when all messages belong to the deleted session", async () => {
    const deleteForumTopic = vi.fn().mockResolvedValue(undefined);
    const findByOcSession = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100, oc_session_id: "s1" },
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 101, oc_session_id: "s1" },
    ]);
    const findByTgTopic = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100, oc_session_id: "s1" },
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 101, oc_session_id: "s1" },
    ]);
    const deleteByOcSession = vi.fn();

    const onSessionDeleted = async (sessionId: string) => {
      const rows = findByOcSession(sessionId);
      const topicGroups = new Map<string, { chatId: number; topicId: number | null; messageIds: number[] }>();
      for (const row of rows) {
        const key = `${row.tg_chat_id}:${row.tg_topic_id}`;
        if (!topicGroups.has(key)) {
          topicGroups.set(key, { chatId: row.tg_chat_id, topicId: row.tg_topic_id, messageIds: [] });
        }
        topicGroups.get(key)!.messageIds.push(row.tg_message_id);
      }
      for (const [, group] of topicGroups) {
        const allTopicMsgs = findByTgTopic(group.chatId, group.topicId);
        const onlyThisSession = allTopicMsgs.every((r) => r.oc_session_id === sessionId);
        if (onlyThisSession && group.topicId != null) {
          await deleteForumTopic(group.chatId, group.topicId);
        }
      }
      deleteByOcSession(sessionId);
    };

    await onSessionDeleted("s1");

    expect(deleteForumTopic).toHaveBeenCalledWith(777, 42);
    expect(deleteByOcSession).toHaveBeenCalledWith("s1");
  });

  it("deletes only individual messages when topic has messages from multiple sessions", async () => {
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const deleteForumTopic = vi.fn();
    const findByOcSession = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100, oc_session_id: "s1" },
    ]);
    const findByTgTopic = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100, oc_session_id: "s1" },
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 200, oc_session_id: "s2" },
    ]);

    const onSessionDeleted = async (sessionId: string) => {
      const rows = findByOcSession(sessionId);
      const topicGroups = new Map<string, { chatId: number; topicId: number | null; messageIds: number[] }>();
      for (const row of rows) {
        const key = `${row.tg_chat_id}:${row.tg_topic_id}`;
        if (!topicGroups.has(key)) {
          topicGroups.set(key, { chatId: row.tg_chat_id, topicId: row.tg_topic_id, messageIds: [] });
        }
        topicGroups.get(key)!.messageIds.push(row.tg_message_id);
      }
      for (const [, group] of topicGroups) {
        const allTopicMsgs = findByTgTopic(group.chatId, group.topicId);
        const onlyThisSession = allTopicMsgs.every((r) => r.oc_session_id === sessionId);
        if (onlyThisSession && group.topicId != null) {
          await deleteForumTopic(group.chatId, group.topicId);
        } else {
          for (const msgId of group.messageIds) {
            await deleteMessage(group.chatId, msgId).catch(() => {});
          }
        }
      }
    };

    await onSessionDeleted("s1");

    expect(deleteForumTopic).not.toHaveBeenCalled();
    expect(deleteMessage).toHaveBeenCalledWith(777, 100);
  });

  it("falls back to deleting individual messages when topic deletion fails", async () => {
    const deleteForumTopic = vi.fn().mockRejectedValue(new Error("admin required"));
    const deleteMessage = vi.fn().mockResolvedValue(undefined);
    const findByOcSession = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100, oc_session_id: "s1" },
    ]);
    const findByTgTopic = vi.fn().mockReturnValue([
      { tg_chat_id: 777, tg_topic_id: 42, tg_message_id: 100, oc_session_id: "s1" },
    ]);

    const onSessionDeleted = async (sessionId: string) => {
      const rows = findByOcSession(sessionId);
      const topicGroups = new Map<string, { chatId: number; topicId: number | null; messageIds: number[] }>();
      for (const row of rows) {
        const key = `${row.tg_chat_id}:${row.tg_topic_id}`;
        if (!topicGroups.has(key)) {
          topicGroups.set(key, { chatId: row.tg_chat_id, topicId: row.tg_topic_id, messageIds: [] });
        }
        topicGroups.get(key)!.messageIds.push(row.tg_message_id);
      }
      for (const [, group] of topicGroups) {
        const allTopicMsgs = findByTgTopic(group.chatId, group.topicId);
        const onlyThisSession = allTopicMsgs.every((r) => r.oc_session_id === sessionId);
        if (onlyThisSession && group.topicId != null) {
          try {
            await deleteForumTopic(group.chatId, group.topicId);
          } catch {
            for (const msgId of group.messageIds) {
              await deleteMessage(group.chatId, msgId).catch(() => {});
            }
          }
        }
      }
    };

    await onSessionDeleted("s1");

    expect(deleteForumTopic).toHaveBeenCalled();
    expect(deleteMessage).toHaveBeenCalledWith(777, 100);
  });
});
