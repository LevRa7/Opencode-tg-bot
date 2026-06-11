import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createMessageJournalRepository } from "../../../src/settings/repositories/message-journal.js";

const DDL = `
CREATE TABLE IF NOT EXISTS message_journal (
    tg_chat_id      INTEGER NOT NULL,
    tg_topic_id     INTEGER,
    tg_message_id   INTEGER NOT NULL,
    oc_server       TEXT NOT NULL DEFAULT '',
    oc_project      TEXT NOT NULL DEFAULT '',
    oc_session_id   TEXT NOT NULL,
    oc_message_id   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tg_chat_id, tg_message_id)
);
CREATE INDEX IF NOT EXISTS idx_mj_oc_session ON message_journal(oc_session_id);
CREATE INDEX IF NOT EXISTS idx_mj_oc_message ON message_journal(oc_message_id);
`;

const sampleRow = {
  tg_chat_id: -100123456,
  tg_topic_id: null as number | null,
  tg_message_id: 42,
  oc_server: "local",
  oc_project: "/test",
  oc_session_id: "sess-abc",
  oc_message_id: "msg-xyz",
};

describe("MessageJournalRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  describe("insert", () => {
    it("should insert a row and allow lookup by TG message", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert(sampleRow);

      const found = repo.findByTgMessage(
        sampleRow.tg_message_id,
        sampleRow.tg_chat_id,
        sampleRow.tg_topic_id,
      );
      expect(found).not.toBeNull();
      expect(found!.oc_session_id).toBe("sess-abc");
      expect(found!.oc_message_id).toBe("msg-xyz");
    });

    it("should upsert on duplicate primary key", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert(sampleRow);
      repo.insert({ ...sampleRow, oc_message_id: "msg-new" });

      const found = repo.findByTgMessage(
        sampleRow.tg_message_id,
        sampleRow.tg_chat_id,
        sampleRow.tg_topic_id,
      );
      expect(found!.oc_message_id).toBe("msg-new");
    });
  });

  describe("findByTgMessage", () => {
    it("should return null for non-existent message", () => {
      const repo = createMessageJournalRepository(db);
      const found = repo.findByTgMessage(999, sampleRow.tg_chat_id, sampleRow.tg_topic_id);
      expect(found).toBeNull();
    });
  });

  describe("findByOcMessage", () => {
    it("should find rows by OpenCode session + message ID", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert(sampleRow);

      const results = repo.findByOcMessage("sess-abc", "msg-xyz");
      expect(results).toHaveLength(1);
      expect(results[0].tg_message_id).toBe(42);
    });

    it("should return empty array for unknown OC message", () => {
      const repo = createMessageJournalRepository(db);
      const results = repo.findByOcMessage("sess-abc", "nonexistent");
      expect(results).toHaveLength(0);
    });
  });

  describe("findByOcSession", () => {
    it("should return all messages for a session", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert({ ...sampleRow, tg_message_id: 42, oc_message_id: "msg-1" });
      repo.insert({ ...sampleRow, tg_message_id: 43, oc_message_id: "msg-2" });

      const results = repo.findByOcSession("sess-abc");
      expect(results).toHaveLength(2);
    });

    it("should return empty array for unknown session", () => {
      const repo = createMessageJournalRepository(db);
      const results = repo.findByOcSession("unknown");
      expect(results).toHaveLength(0);
    });
  });

  describe("findByTgTopic", () => {
    it("should return all messages for a topic", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert({ ...sampleRow, tg_topic_id: 10, tg_message_id: 1 });
      repo.insert({ ...sampleRow, tg_topic_id: 10, tg_message_id: 2 });
      repo.insert({ ...sampleRow, tg_topic_id: 20, tg_message_id: 3 });

      const results = repo.findByTgTopic(sampleRow.tg_chat_id, 10);
      expect(results).toHaveLength(2);
    });
  });

  describe("deleteByTgMessage", () => {
    it("should remove the entry", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert(sampleRow);
      repo.deleteByTgMessage(
        sampleRow.tg_message_id,
        sampleRow.tg_chat_id,
        sampleRow.tg_topic_id,
      );

      const found = repo.findByTgMessage(
        sampleRow.tg_message_id,
        sampleRow.tg_chat_id,
        sampleRow.tg_topic_id,
      );
      expect(found).toBeNull();
    });
  });

  describe("deleteByOcSession", () => {
    it("should remove all entries for a session", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert({ ...sampleRow, tg_message_id: 1, oc_message_id: "msg-1" });
      repo.insert({ ...sampleRow, tg_message_id: 2, oc_message_id: "msg-2" });

      repo.deleteByOcSession("sess-abc");
      const results = repo.findByOcSession("sess-abc");
      expect(results).toHaveLength(0);
    });
  });

  describe("deleteByTgTopic", () => {
    it("should remove all entries for a topic", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert({ ...sampleRow, tg_topic_id: 5, tg_message_id: 1 });
      repo.insert({ ...sampleRow, tg_topic_id: 5, tg_message_id: 2 });

      repo.deleteByTgTopic(sampleRow.tg_chat_id, 5);
      const results = repo.findByTgTopic(sampleRow.tg_chat_id, 5);
      expect(results).toHaveLength(0);
    });
  });
});
