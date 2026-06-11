import type Database from "better-sqlite3";

export interface FileArchiveRow {
  file_path: string;
  content: string;
  content_hash: string | null;
  line_count: number;
  telegraph_url: string | null;
  telegraph_path: string | null;
  key_id: number | null;
  created_at: number;
  updated_at: number;
}

export function createFileArchiveRepository(db: Database.Database) {
  return {
    get(filePath: string): FileArchiveRow | undefined {
      return db.prepare("SELECT * FROM file_archive WHERE file_path = ?").get(filePath) as FileArchiveRow | undefined;
    },
    upsert(params: {
      file_path: string;
      content: string;
      content_hash?: string;
      line_count?: number;
    }): void {
      const now = Date.now();
      db.prepare(`
        INSERT INTO file_archive (file_path, content, content_hash, line_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          content = excluded.content,
          content_hash = excluded.content_hash,
          line_count = excluded.line_count,
          updated_at = excluded.updated_at
      `).run(params.file_path, params.content, params.content_hash ?? null, params.line_count ?? 0, now, now);
    },
    updateTelegraphInfo(filePath: string, url: string, path: string, keyId?: number): void {
      db.prepare("UPDATE file_archive SET telegraph_url = ?, telegraph_path = ?, key_id = ?, updated_at = ? WHERE file_path = ?")
        .run(url, path, keyId ?? null, Date.now(), filePath);
    },
    getAll(): FileArchiveRow[] {
      return db.prepare("SELECT * FROM file_archive ORDER BY updated_at DESC").all() as FileArchiveRow[];
    },
  };
}
