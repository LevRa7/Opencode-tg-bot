import type Database from "better-sqlite3";

export interface TopicRegistryRow {
  scope_key: string;
  user_id: number;
  chat_id: number;
  message_thread_id: number;
  topic_name: string | null;
  kind: "main" | "ssh" | "subagent";
  server_connection_id: string | null;
  bound_session_id: string | null;
  created_at: number;
  updated_at: number;
  is_deleted: number;
}

export function createTopicRegistryRepository(db: Database.Database) {
  return {
    upsert(params: {
      scope_key: string;
      user_id: number;
      chat_id: number;
      message_thread_id?: number;
      topic_name?: string;
      kind: "main" | "ssh" | "subagent";
      server_connection_id?: string | null;
      bound_session_id?: string | null;
    }): void {
      const now = Date.now();
      db.prepare(
        `INSERT INTO topic_registry
         (scope_key, user_id, chat_id, message_thread_id, topic_name, kind, server_connection_id, bound_session_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(scope_key) DO UPDATE SET
           topic_name = excluded.topic_name,
           kind = excluded.kind,
           server_connection_id = excluded.server_connection_id,
           bound_session_id = excluded.bound_session_id,
           updated_at = excluded.updated_at,
           is_deleted = 0`
      ).run(
        params.scope_key,
        params.user_id,
        params.chat_id,
        params.message_thread_id ?? 0,
        params.topic_name ?? null,
        params.kind,
        params.server_connection_id ?? null,
        params.bound_session_id ?? null,
        now,
        now,
      );
    },

    getByScopeKey(scopeKey: string): TopicRegistryRow | undefined {
      return db.prepare(
        "SELECT * FROM topic_registry WHERE scope_key = ? AND is_deleted = 0"
      ).get(scopeKey) as TopicRegistryRow | undefined;
    },

    findByUserIdAndKind(userId: number, kind: string): TopicRegistryRow[] {
      return db.prepare(
        "SELECT * FROM topic_registry WHERE user_id = ? AND kind = ? AND is_deleted = 0 ORDER BY updated_at DESC"
      ).all(userId, kind) as TopicRegistryRow[];
    },

    findByServerConnectionId(connectionId: string): TopicRegistryRow[] {
      return db.prepare(
        "SELECT * FROM topic_registry WHERE server_connection_id = ? AND is_deleted = 0"
      ).all(connectionId) as TopicRegistryRow[];
    },

    updateBoundSession(scopeKey: string, sessionId: string | null): void {
      db.prepare(
        "UPDATE topic_registry SET bound_session_id = ?, updated_at = ? WHERE scope_key = ?"
      ).run(sessionId, Date.now(), scopeKey);
    },

    softDelete(scopeKey: string): void {
      db.prepare(
        "UPDATE topic_registry SET is_deleted = 1, updated_at = ? WHERE scope_key = ?"
      ).run(Date.now(), scopeKey);
    },

    deleteByScopeKey(scopeKey: string): void {
      db.prepare("DELETE FROM topic_registry WHERE scope_key = ?").run(scopeKey);
    },
  };
}
