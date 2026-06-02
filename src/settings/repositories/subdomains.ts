import type Database from "better-sqlite3";
import type { SubdomainRow } from "../../server/types.js";

export interface SubdomainsRepository {
  getByUserId(userId: number): SubdomainRow | undefined;
  getBySubdomain(subdomain: string): SubdomainRow | undefined;
  upsert(userId: number, fields: Partial<Omit<SubdomainRow, "user_id">> & { user_id?: never }): void;
  deleteByUserId(userId: number): void;
}

export function createSubdomainsRepository(db: Database.Database): SubdomainsRepository {
  const getByUserIdStmt = db.prepare("SELECT * FROM subdomains WHERE user_id = ?");
  const getBySubdomainStmt = db.prepare("SELECT * FROM subdomains WHERE subdomain = ?");
  const deleteStmt = db.prepare("DELETE FROM subdomains WHERE user_id = ?");

  return {
    getByUserId(userId: number): SubdomainRow | undefined {
      return getByUserIdStmt.get(userId) as SubdomainRow | undefined;
    },

    getBySubdomain(subdomain: string): SubdomainRow | undefined {
      return getBySubdomainStmt.get(subdomain) as SubdomainRow | undefined;
    },

    upsert(userId: number, fields: Partial<Omit<SubdomainRow, "user_id">>): void {
      const existing = getByUserIdStmt.get(userId) as SubdomainRow | undefined;
      if (existing) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined) {
            setClauses.push(`${key} = ?`);
            values.push(value);
          }
        }
        if (setClauses.length === 0) return;
        values.push(userId);
        db.prepare(`UPDATE subdomains SET ${setClauses.join(", ")} WHERE user_id = ?`).run(...values);
      } else {
        const columns = ["user_id"];
        const values: unknown[] = [userId];
        for (const [key, value] of Object.entries(fields)) {
          if (value !== undefined) {
            columns.push(key);
            values.push(value);
          }
        }
        const placeholders = columns.map(() => "?").join(", ");
        db.prepare(`INSERT INTO subdomains (${columns.join(", ")}) VALUES (${placeholders})`).run(...values);
      }
    },

    deleteByUserId(userId: number): void {
      deleteStmt.run(userId);
    },
  };
}
