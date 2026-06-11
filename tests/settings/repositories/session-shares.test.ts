import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createSessionSharesRepository } from "../../../src/settings/repositories/session-shares.js";

const DDL = `
CREATE TABLE IF NOT EXISTS session_shares (
    oc_server       TEXT NOT NULL DEFAULT '',
    oc_session_id   TEXT NOT NULL,
    share_url       TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (oc_server, oc_session_id)
);
`;

describe("SessionSharesRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("should upsert and find a share URL", () => {
    const repo = createSessionSharesRepository(db);
    repo.upsert("local", "sess-1", "https://share.example.com/sess-1");
    const found = repo.find("local", "sess-1");
    expect(found).not.toBeNull();
    expect(found!.share_url).toBe("https://share.example.com/sess-1");
  });

  it("should update existing share URL on upsert", () => {
    const repo = createSessionSharesRepository(db);
    repo.upsert("local", "sess-1", "https://share.example.com/sess-1");
    repo.upsert("local", "sess-1", "https://new.example.com");
    const found = repo.find("local", "sess-1");
    expect(found!.share_url).toBe("https://new.example.com");
  });

  it("should delete a share entry", () => {
    const repo = createSessionSharesRepository(db);
    repo.upsert("local", "sess-1", "https://share.example.com/sess-1");
    repo.delete("local", "sess-1");
    expect(repo.find("local", "sess-1")).toBeNull();
  });

  it("should return null for non-existent entry", () => {
    const repo = createSessionSharesRepository(db);
    expect(repo.find("local", "nonexistent")).toBeNull();
  });
});
