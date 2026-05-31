import type Database from "better-sqlite3";
import type { AttachedSessionRow } from "./types.js";

export interface SessionAttachmentsRepository {
  getAttachedSessions(): Record<string, AttachedSessionRow>;
  setAttachedSessions(sessions: Record<string, AttachedSessionRow>): void;
  getSessionDirectoryCache(scopeKey: string): string | undefined;
  setSessionDirectoryCache(scopeKey: string, data: string): void;
  clearSessionDirectoryCache(scopeKey: string): void;
}

export function createSessionAttachmentsRepository(
  db: Database.Database,
): SessionAttachmentsRepository {
  const getAllAttachedStmt = db.prepare("SELECT * FROM attached_sessions");
  const deleteAllAttachedStmt = db.prepare("DELETE FROM attached_sessions");
  const getCacheStmt = db.prepare(
    "SELECT data FROM session_directory_cache WHERE scope_key = ?",
  );
  const upsertCacheStmt = db.prepare(
    "INSERT INTO session_directory_cache (scope_key, data) VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET data = ?",
  );
  const deleteCacheStmt = db.prepare(
    "DELETE FROM session_directory_cache WHERE scope_key = ?",
  );

  return {
    getAttachedSessions(): Record<string, AttachedSessionRow> {
      const rows = getAllAttachedStmt.all() as AttachedSessionRow[];
      const result: Record<string, AttachedSessionRow> = {};
      for (const row of rows) result[row.scope_key] = row;
      return result;
    },

    setAttachedSessions(sessions: Record<string, AttachedSessionRow>): void {
      const runInTx = db.transaction((s: Record<string, AttachedSessionRow>) => {
        deleteAllAttachedStmt.run();
        const insert = db.prepare(
          "INSERT INTO attached_sessions (scope_key, session) VALUES (?, ?)",
        );
        for (const [key, row] of Object.entries(s)) insert.run(key, row.session);
      });
      runInTx(sessions);
    },

    getSessionDirectoryCache(scopeKey: string): string | undefined {
      const row = getCacheStmt.get(scopeKey) as { data: string } | undefined;
      return row?.data;
    },

    setSessionDirectoryCache(scopeKey: string, data: string): void {
      upsertCacheStmt.run(scopeKey, data, data);
    },

    clearSessionDirectoryCache(scopeKey: string): void {
      deleteCacheStmt.run(scopeKey);
    },
  };
}
