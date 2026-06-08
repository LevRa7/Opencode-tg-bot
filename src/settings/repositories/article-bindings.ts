import type Database from "better-sqlite3";

export interface ArticleBindingRow {
  id: number;
  user_id: number;
  path: string;
  key_id: number;
  created_at: number;
}

export function createArticleBindingsRepository(db: Database.Database) {
  const insertStmt = db.prepare(
    "INSERT INTO telegraph_article_bindings (user_id, path, key_id, created_at) VALUES (?, ?, ?, ?)"
  );
  const getStmt = db.prepare(
    "SELECT * FROM telegraph_article_bindings WHERE path = ?"
  );
  const getUserStmt = db.prepare(
    "SELECT * FROM telegraph_article_bindings WHERE user_id = ? ORDER BY created_at"
  );
  const deleteStmt = db.prepare(
    "DELETE FROM telegraph_article_bindings WHERE path = ?"
  );

  return {
    insert(params: { userId: number; path: string; keyId: number }): number {
      const result = insertStmt.run(params.userId, params.path, params.keyId, Date.now());
      return Number(result.lastInsertRowid);
    },
    getByPath(path: string): ArticleBindingRow | undefined {
      return getStmt.get(path) as ArticleBindingRow | undefined;
    },
    getByUser(userId: number): ArticleBindingRow[] {
      return getUserStmt.all(userId) as ArticleBindingRow[];
    },
    deleteByPath(path: string): number {
      const result = deleteStmt.run(path);
      return result.changes;
    },
  };
}
