import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createMessageReactionsRepository } from "../../../src/settings/repositories/message-reactions.js";

const DDL = `
CREATE TABLE IF NOT EXISTS message_reactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_chat_id      INTEGER NOT NULL,
    tg_topic_id     INTEGER,
    tg_message_id   INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    emoji           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mr_message ON message_reactions(tg_chat_id, tg_topic_id, tg_message_id);
`;

describe("MessageReactionsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("should insert and find reactions by message", () => {
    const repo = createMessageReactionsRepository(db);
    repo.insert({
      tg_chat_id: -100123,
      tg_topic_id: 5,
      tg_message_id: 42,
      user_id: 111,
      emoji: "👍",
    });
    repo.insert({
      tg_chat_id: -100123,
      tg_topic_id: 5,
      tg_message_id: 42,
      user_id: 222,
      emoji: "👎",
    });

    const reactions = repo.findByMessage(-100123, 5, 42);
    expect(reactions).toHaveLength(2);
    expect(reactions[0].emoji).toBe("👍");
    expect(reactions[1].emoji).toBe("👎");
  });

  it("should return empty array for message with no reactions", () => {
    const repo = createMessageReactionsRepository(db);
    const reactions = repo.findByMessage(-100123, 5, 999);
    expect(reactions).toHaveLength(0);
  });
});
