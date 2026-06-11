import type Database from "better-sqlite3";

export interface SessionShareRow {
  oc_server: string;
  oc_session_id: string;
  share_url: string;
  created_at: string;
}

export function createSessionSharesRepository(db: Database.Database) {
  const upsertStmt = db.prepare(
    `INSERT INTO session_shares (oc_server, oc_session_id, share_url)
     VALUES (?, ?, ?)
     ON CONFLICT(oc_server, oc_session_id) DO UPDATE SET share_url = excluded.share_url`,
  );

  const findStmt = db.prepare(
    "SELECT * FROM session_shares WHERE oc_server = ? AND oc_session_id = ?",
  );

  const deleteStmt = db.prepare(
    "DELETE FROM session_shares WHERE oc_server = ? AND oc_session_id = ?",
  );

  return {
    upsert(ocServer: string, ocSessionId: string, shareUrl: string): void {
      upsertStmt.run(ocServer, ocSessionId, shareUrl);
    },

    find(ocServer: string, ocSessionId: string): SessionShareRow | null {
      const row = findStmt.get(ocServer, ocSessionId) as SessionShareRow | undefined;
      return row ?? null;
    },

    delete(ocServer: string, ocSessionId: string): void {
      deleteStmt.run(ocServer, ocSessionId);
    },
  };
}
