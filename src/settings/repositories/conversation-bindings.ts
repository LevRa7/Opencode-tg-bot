import type Database from "better-sqlite3";
import type { ConversationBindingsRow } from "./types.js";

export interface ConversationBindingsRepository {
  get(scopeKey: string): ConversationBindingsRow | undefined;
  upsert(scopeKey: string, fields: Partial<Omit<ConversationBindingsRow, "scope_key">>): void;
  delete(scopeKey: string): void;
}

export function createConversationBindingsRepository(
  db: Database.Database,
): ConversationBindingsRepository {
  const getStmt = db.prepare("SELECT * FROM conversation_bindings WHERE scope_key = ?");
  const deleteStmt = db.prepare("DELETE FROM conversation_bindings WHERE scope_key = ?");

  return {
    get(scopeKey: string): ConversationBindingsRow | undefined {
      return getStmt.get(scopeKey) as ConversationBindingsRow | undefined;
    },

    upsert(
      scopeKey: string,
      fields: Partial<Omit<ConversationBindingsRow, "scope_key">>,
    ): void {
      const existing = getStmt.get(scopeKey) as ConversationBindingsRow | undefined;
      if (existing) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(fields)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        values.push(scopeKey);
        db.prepare(
          `UPDATE conversation_bindings SET ${setClauses.join(", ")} WHERE scope_key = ?`,
        ).run(...values);
      } else {
        const allFields: Record<string, unknown> = { scope_key: scopeKey, ...fields };
        const columns = Object.keys(allFields).join(", ");
        const placeholders = Object.keys(allFields).map(() => "?").join(", ");
        db.prepare(
          `INSERT INTO conversation_bindings (${columns}) VALUES (${placeholders})`,
        ).run(...Object.values(allFields));
      }
    },

    delete(scopeKey: string): void {
      deleteStmt.run(scopeKey);
    },
  };
}
