import type Database from "better-sqlite3";
import type { GoalState } from "../../bot/goal/types.js";

export interface GoalsRepository {
  get(scopeKey: string): GoalState | undefined;
  upsert(scopeKey: string, state: GoalState): void;
  delete(scopeKey: string): void;
}

export function createGoalsRepository(db: Database.Database): GoalsRepository {
  const getStmt = db.prepare("SELECT state FROM goals WHERE scope_key = ?");
  const upsertStmt = db.prepare(
    "INSERT INTO goals (scope_key, state, updated_at) VALUES (?, ?, datetime('now')) ON CONFLICT(scope_key) DO UPDATE SET state = excluded.state, updated_at = datetime('now')",
  );
  const deleteStmt = db.prepare("DELETE FROM goals WHERE scope_key = ?");

  return {
    get(scopeKey: string): GoalState | undefined {
      const row = getStmt.get(scopeKey) as { state: string } | undefined;
      if (!row) return undefined;
      try {
        return JSON.parse(row.state) as GoalState;
      } catch {
        return undefined;
      }
    },

    upsert(scopeKey: string, state: GoalState): void {
      upsertStmt.run(scopeKey, JSON.stringify(state));
    },

    delete(scopeKey: string): void {
      deleteStmt.run(scopeKey);
    },
  };
}
