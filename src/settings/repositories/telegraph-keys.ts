import type Database from "better-sqlite3";
import { logger } from "../../utils/logger.js";

export interface TelegraphKeyRow {
  id: number;
  user_id: number;
  token_encrypted: string;
  author_name: string | null;
  is_active: number;
  last_used_at: number | null;
  flood_wait_until: number;
  usage_count: number;
  created_at: number;
}

export function createTelegraphKeysRepository(db: Database.Database) {
  return {
    insert(params: {
      user_id: number;
      token_encrypted: string;
      author_name?: string;
      created_at: number;
    }): number {
      const stmt = db.prepare(
        `INSERT INTO telegraph_keys (user_id, token_encrypted, author_name, created_at)
         VALUES (?, ?, ?, ?)`
      );
      const result = stmt.run(params.user_id, params.token_encrypted, params.author_name ?? null, params.created_at);
      return Number(result.lastInsertRowid);
    },

    getById(id: number): TelegraphKeyRow | undefined {
      return db.prepare("SELECT * FROM telegraph_keys WHERE id = ?").get(id) as TelegraphKeyRow | undefined;
    },

    selectAvailableKey(userId: number): TelegraphKeyRow | undefined {
      const now = Date.now();
      return db.prepare(
        `SELECT * FROM telegraph_keys
         WHERE user_id = ? AND is_active = 1
           AND (flood_wait_until = 0 OR flood_wait_until < ?)
         ORDER BY last_used_at ASC NULLS FIRST
         LIMIT 1`
      ).get(userId, now) as TelegraphKeyRow | undefined;
    },

    markUsed(id: number): void {
      db.prepare(
        "UPDATE telegraph_keys SET last_used_at = ?, usage_count = usage_count + 1 WHERE id = ?"
      ).run(Date.now(), id);
    },

    markFloodWait(id: number, untilMs: number): void {
      db.prepare(
        "UPDATE telegraph_keys SET flood_wait_until = ? WHERE id = ?"
      ).run(untilMs, id);
    },

    getAllByUser(userId: number): TelegraphKeyRow[] {
      return db.prepare(
        "SELECT * FROM telegraph_keys WHERE user_id = ? AND is_active = 1 ORDER BY id"
      ).all(userId) as TelegraphKeyRow[];
    },

    countByUser(userId: number): number {
      const row = db.prepare(
        "SELECT COUNT(*) as cnt FROM telegraph_keys WHERE user_id = ? AND is_active = 1"
      ).get(userId) as { cnt: number };
      return row.cnt;
    },

    pruneUnused(userId: number, minKeep: number, unusedSinceMs: number): number {
      const count = this.countByUser(userId);
      if (count <= minKeep) return 0;

      const result = db.prepare(
        `DELETE FROM telegraph_keys
         WHERE user_id = ? AND is_active = 1
           AND (last_used_at IS NULL OR last_used_at < ?)
           AND id NOT IN (
             SELECT id FROM telegraph_keys
             WHERE user_id = ? AND is_active = 1
             ORDER BY last_used_at DESC NULLS LAST
             LIMIT ?
           )`
      ).run(userId, unusedSinceMs, userId, minKeep);
      return result.changes;
    },

    deactivateKey(id: number): void {
      db.prepare("UPDATE telegraph_keys SET is_active = 0 WHERE id = ?").run(id);
    },
  };
}
