import type Database from "better-sqlite3";

export interface FileDiffLogRow {
  id: number;
  user_id: number;
  file_path: string;
  session_id: string | null;
  telegraph_url: string | null;
  telegraph_path: string | null;
  telegraph_key_id: number | null;
  diff_content: string;
  description: string | null;
  old_line_start: number | null;
  old_line_end: number | null;
  new_line_start: number | null;
  new_line_end: number | null;
  diff_size_bytes: number;
  continued_to_id: number | null;
  created_at: number;
}

export interface FileEditSessionRow {
  file_diff_log_id: number;
  file_path: string;
  telegraph_url: string | null;
  session_id: string | null;
}

export function createFileDiffLogRepository(db: Database.Database) {
  return {
    insert(params: {
      user_id: number;
      file_path: string;
      session_id?: string;
      telegraph_url?: string;
      telegraph_path?: string;
      telegraph_key_id?: number;
      diff_content: string;
      description?: string;
      old_line_start?: number;
      old_line_end?: number;
      new_line_start?: number;
      new_line_end?: number;
    }): number {
      const diffBytes = Buffer.byteLength(params.diff_content, "utf-8");

      const stmt = db.prepare(
        `INSERT INTO file_diff_log (user_id, file_path, session_id, telegraph_url, telegraph_path, telegraph_key_id, diff_content, description, old_line_start, old_line_end, new_line_start, new_line_end, diff_size_bytes, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );
      const result = stmt.run(
        params.user_id,
        params.file_path,
        params.session_id ?? null,
        params.telegraph_url ?? null,
        params.telegraph_path ?? null,
        params.telegraph_key_id ?? null,
        params.diff_content,
        params.description ?? null,
        params.old_line_start ?? null,
        params.old_line_end ?? null,
        params.new_line_start ?? null,
        params.new_line_end ?? null,
        diffBytes,
        Date.now(),
      );
      return Number(result.lastInsertRowid);
    },

    findLatestByUserAndFile(userId: number, filePath: string): FileDiffLogRow | undefined {
      return db.prepare(
        "SELECT * FROM file_diff_log WHERE user_id = ? AND file_path = ? ORDER BY id DESC LIMIT 1"
      ).get(userId, filePath) as FileDiffLogRow | undefined;
    },

    updateTelegraphInfo(id: number, url: string, path: string, keyId?: number): void {
      db.prepare(
        "UPDATE file_diff_log SET telegraph_url = ?, telegraph_path = ?, telegraph_key_id = ? WHERE id = ?"
      ).run(url, path, keyId ?? null, id);
    },

    setContinuation(id: number, continuedToId: number): void {
      db.prepare(
        "UPDATE file_diff_log SET continued_to_id = ? WHERE id = ?"
      ).run(continuedToId, id);
    },

    // Junction table operations
    insertEditSessionFile(params: {
      file_diff_log_id: number;
      file_path: string;
      telegraph_url?: string;
      session_id?: string;
    }): void {
      db.prepare(
        `INSERT OR REPLACE INTO file_edit_session_files (file_diff_log_id, file_path, telegraph_url, session_id)
         VALUES (?, ?, ?, ?)`
      ).run(params.file_diff_log_id, params.file_path, params.telegraph_url ?? null, params.session_id ?? null);
    },

    getEditSessionFiles(logId: number): FileEditSessionRow[] {
      return db.prepare(
        "SELECT * FROM file_edit_session_files WHERE file_diff_log_id = ?"
      ).all(logId) as FileEditSessionRow[];
    },
  };
}
