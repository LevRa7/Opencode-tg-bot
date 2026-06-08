import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createArticleBindingsRepository } from "../../../src/settings/repositories/article-bindings.js";

const DDL = `
CREATE TABLE IF NOT EXISTS telegraph_article_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    path        TEXT UNIQUE NOT NULL,
    key_id      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tg_article_bind_path ON telegraph_article_bindings(path);
CREATE INDEX IF NOT EXISTS idx_tg_article_bind_user ON telegraph_article_bindings(user_id);
`;

describe("ArticleBindingsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("should insert and retrieve by path", () => {
    const repo = createArticleBindingsRepository(db);
    repo.insert({ userId: 1, path: "my-article-123", keyId: 3 });
    const found = repo.getByPath("my-article-123");
    expect(found).toBeDefined();
    expect(found!.key_id).toBe(3);
    expect(found!.user_id).toBe(1);
  });

  it("should return undefined for unknown path", () => {
    const repo = createArticleBindingsRepository(db);
    expect(repo.getByPath("nonexistent")).toBeUndefined();
  });

  it("should get all bindings for a user", () => {
    const repo = createArticleBindingsRepository(db);
    const id1 = repo.insert({ userId: 1, path: "a", keyId: 1 });
    const id2 = repo.insert({ userId: 1, path: "b", keyId: 2 });
    repo.insert({ userId: 2, path: "c", keyId: 1 });
    const user1 = repo.getByUser(1);
    expect(user1).toHaveLength(2);
    expect(id1).toBeGreaterThan(0);
    expect(id2).toBeGreaterThan(id1);
  });

  it("should delete by path", () => {
    const repo = createArticleBindingsRepository(db);
    repo.insert({ userId: 1, path: "my-article", keyId: 1 });
    const deleted = repo.deleteByPath("my-article");
    expect(deleted).toBe(1);
    expect(repo.getByPath("my-article")).toBeUndefined();
  });
});
