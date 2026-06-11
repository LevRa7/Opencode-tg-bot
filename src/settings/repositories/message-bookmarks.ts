import type Database from "better-sqlite3";

export interface MessageBookmarkRow {
  id: number;
  tg_chat_id: number;
  tg_topic_id: number | null;
  tg_message_id: number;
  user_id: number;
  emoji: string;
  created_at: string;
}

export type InsertableMessageBookmarkRow = Omit<MessageBookmarkRow, "id" | "created_at">;

export function createMessageBookmarksRepository(db: Database.Database) {
  const upsertStmt = db.prepare(
    `INSERT INTO message_bookmarks
     (tg_chat_id, tg_topic_id, tg_message_id, user_id, emoji)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(tg_chat_id, tg_topic_id, tg_message_id, user_id)
     DO UPDATE SET emoji = excluded.emoji, created_at = datetime('now')`,
  );

  const deleteStmt = db.prepare(
    "DELETE FROM message_bookmarks WHERE tg_chat_id = ? AND tg_topic_id IS ? AND tg_message_id = ? AND user_id = ?",
  );

  const findByMessageStmt = db.prepare(
    "SELECT * FROM message_bookmarks WHERE tg_chat_id = ? AND tg_topic_id IS ? AND tg_message_id = ? ORDER BY id",
  );

  const findByUserStmt = db.prepare(
    "SELECT * FROM message_bookmarks WHERE tg_chat_id = ? AND user_id = ? ORDER BY tg_topic_id, tg_message_id LIMIT 100",
  );

  return {
    upsert(row: InsertableMessageBookmarkRow): void {
      upsertStmt.run(
        row.tg_chat_id,
        row.tg_topic_id ?? null,
        row.tg_message_id,
        row.user_id,
        row.emoji,
      );
    },

    delete(params: {
      tg_chat_id: number;
      tg_topic_id: number | null;
      tg_message_id: number;
      user_id: number;
    }): void {
      deleteStmt.run(
        params.tg_chat_id,
        params.tg_topic_id ?? null,
        params.tg_message_id,
        params.user_id,
      );
    },

    findByMessage(
      tgChatId: number,
      tgTopicId: number | null,
      tgMessageId: number,
    ): MessageBookmarkRow[] {
      return findByMessageStmt.all(tgChatId, tgTopicId ?? null, tgMessageId) as MessageBookmarkRow[];
    },

    findByUser(
      tgChatId: number,
      userId: number,
    ): MessageBookmarkRow[] {
      return findByUserStmt.all(tgChatId, userId) as MessageBookmarkRow[];
    },
  };
}

export type MessageBookmarksRepository = ReturnType<typeof createMessageBookmarksRepository>;
