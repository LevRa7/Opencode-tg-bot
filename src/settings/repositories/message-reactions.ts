import type Database from "better-sqlite3";

export interface MessageReactionRow {
  id: number;
  tg_chat_id: number;
  tg_topic_id: number | null;
  tg_message_id: number;
  user_id: number;
  emoji: string;
  created_at: string;
}

export type InsertableMessageReactionRow = Omit<MessageReactionRow, "id" | "created_at">;

export function createMessageReactionsRepository(db: Database.Database) {
  const insertStmt = db.prepare(
    `INSERT INTO message_reactions
     (tg_chat_id, tg_topic_id, tg_message_id, user_id, emoji)
     VALUES (?, ?, ?, ?, ?)`,
  );

  const findByMessageStmt = db.prepare(
    "SELECT * FROM message_reactions WHERE tg_chat_id = ? AND tg_topic_id IS ? AND tg_message_id = ? ORDER BY id",
  );

  return {
    insert(row: InsertableMessageReactionRow): void {
      insertStmt.run(
        row.tg_chat_id,
        row.tg_topic_id ?? null,
        row.tg_message_id,
        row.user_id,
        row.emoji,
      );
    },

    findByMessage(
      tgChatId: number,
      tgTopicId: number | null,
      tgMessageId: number,
    ): MessageReactionRow[] {
      return findByMessageStmt.all(
        tgChatId,
        tgTopicId ?? null,
        tgMessageId,
      ) as MessageReactionRow[];
    },
  };
}
