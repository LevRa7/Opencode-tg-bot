import type Database from "better-sqlite3";
import type { UserPreferencesRow } from "./types.js";

export interface UserPreferencesRepository {
  get(userId: number): UserPreferencesRow | undefined;
  getAll(): UserPreferencesRow[];
  upsert(userId: number, fields: Partial<UserPreferencesRow>): void;
  delete(userId: number): void;
}

export function createUserPreferencesRepository(
  db: Database.Database,
): UserPreferencesRepository {
  const getStmt = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?");
  const getAllStmt = db.prepare("SELECT * FROM user_preferences");
  const deleteStmt = db.prepare("DELETE FROM user_preferences WHERE user_id = ?");

  return {
    get(userId: number): UserPreferencesRow | undefined {
      return getStmt.get(userId) as UserPreferencesRow | undefined;
    },

    getAll(): UserPreferencesRow[] {
      return getAllStmt.all() as UserPreferencesRow[];
    },

    upsert(userId: number, fields: Partial<UserPreferencesRow>): void {
      const existing = getStmt.get(userId) as UserPreferencesRow | undefined;
      if (existing) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(fields)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        values.push(userId);
        db.prepare(
          `UPDATE user_preferences SET ${setClauses.join(", ")} WHERE user_id = ?`,
        ).run(...values);
      } else {
        const columns = ["user_id", ...Object.keys(fields)];
        const placeholders = columns.map(() => "?").join(", ");
        const values = [userId, ...Object.values(fields)];
        db.prepare(
          `INSERT INTO user_preferences (${columns.join(", ")}) VALUES (${placeholders})`,
        ).run(...values);
      }
    },

    delete(userId: number): void {
      deleteStmt.run(userId);
    },
  };
}
