import type Database from "better-sqlite3";

export interface MessageJournalRow {
  tg_chat_id: number;
  tg_topic_id: number | null;
  tg_message_id: number;
  oc_server: string;
  oc_project: string;
  oc_session_id: string;
  oc_message_id: string;
  created_at: string;
}

export type InsertableMessageJournalRow = Omit<MessageJournalRow, "created_at">;

export function createMessageJournalRepository(db: Database.Database) {
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO message_journal
     (tg_chat_id, tg_topic_id, tg_message_id, oc_server, oc_project, oc_session_id, oc_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const findByTgMsgStmt = db.prepare(
    "SELECT * FROM message_journal WHERE tg_message_id = ? AND tg_chat_id = ? AND tg_topic_id IS ?",
  );

  const findByTgChatAndMsgStmt = db.prepare(
    "SELECT * FROM message_journal WHERE tg_chat_id = ? AND tg_message_id = ? LIMIT 1",
  );

  const findByOcMsgStmt = db.prepare(
    "SELECT * FROM message_journal WHERE oc_session_id = ? AND oc_message_id = ?",
  );

  const findByOcSessionStmt = db.prepare(
    "SELECT * FROM message_journal WHERE oc_session_id = ? ORDER BY tg_message_id",
  );

  const findByTgTopicStmt = db.prepare(
    "SELECT * FROM message_journal WHERE tg_chat_id = ? AND tg_topic_id IS ?",
  );

  const deleteByTgMsgStmt = db.prepare(
    "DELETE FROM message_journal WHERE tg_message_id = ? AND tg_chat_id = ? AND tg_topic_id IS ?",
  );

  const deleteByOcSessionStmt = db.prepare(
    "DELETE FROM message_journal WHERE oc_session_id = ?",
  );

  const deleteByTgTopicStmt = db.prepare(
    "DELETE FROM message_journal WHERE tg_chat_id = ? AND tg_topic_id IS ?",
  );

  return {
    insert(row: InsertableMessageJournalRow): void {
      insertStmt.run(
        row.tg_chat_id,
        row.tg_topic_id ?? null,
        row.tg_message_id,
        row.oc_server,
        row.oc_project,
        row.oc_session_id,
        row.oc_message_id,
      );
    },

    findByTgMessage(
      tgMessageId: number,
      tgChatId: number,
      tgTopicId: number | null,
    ): MessageJournalRow | null {
      const row = findByTgMsgStmt.get(
        tgMessageId,
        tgChatId,
        tgTopicId ?? null,
      ) as MessageJournalRow | undefined;
      return row ?? null;
    },

    findByTgChatAndMessage(
      tgChatId: number,
      tgMessageId: number,
    ): MessageJournalRow | null {
      const row = findByTgChatAndMsgStmt.get(
        tgChatId,
        tgMessageId,
      ) as MessageJournalRow | undefined;
      return row ?? null;
    },

    findByOcMessage(
      ocSessionId: string,
      ocMessageId: string,
    ): MessageJournalRow[] {
      return findByOcMsgStmt.all(ocSessionId, ocMessageId) as MessageJournalRow[];
    },

    findByOcSession(ocSessionId: string): MessageJournalRow[] {
      return findByOcSessionStmt.all(ocSessionId) as MessageJournalRow[];
    },

    findByTgTopic(
      tgChatId: number,
      tgTopicId: number | null,
    ): MessageJournalRow[] {
      return findByTgTopicStmt.all(tgChatId, tgTopicId ?? null) as MessageJournalRow[];
    },

    deleteByTgMessage(
      tgMessageId: number,
      tgChatId: number,
      tgTopicId: number | null,
    ): void {
      deleteByTgMsgStmt.run(tgMessageId, tgChatId, tgTopicId ?? null);
    },

    deleteByOcSession(ocSessionId: string): void {
      deleteByOcSessionStmt.run(ocSessionId);
    },

    deleteByTgTopic(
      tgChatId: number,
      tgTopicId: number | null,
    ): void {
      deleteByTgTopicStmt.run(tgChatId, tgTopicId ?? null);
    },
  };
}
