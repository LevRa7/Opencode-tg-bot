import type Database from "better-sqlite3";
import type { ThreadContextBindingRow } from "./types.js";

export interface ContextBindingsRepository {
  getAll(): ThreadContextBindingRow[];
  setBindings(bindings: Omit<ThreadContextBindingRow, "id">[]): void;
}

export function createContextBindingsRepository(db: Database.Database): ContextBindingsRepository {
  const getAllStmt = db.prepare("SELECT * FROM thread_context_bindings");
  const deleteAllStmt = db.prepare("DELETE FROM thread_context_bindings");

  return {
    getAll(): ThreadContextBindingRow[] {
      return getAllStmt.all() as ThreadContextBindingRow[];
    },
    setBindings(bindings: Omit<ThreadContextBindingRow, "id">[]): void {
      const runInTx = db.transaction((b: Omit<ThreadContextBindingRow, "id">[]) => {
        deleteAllStmt.run();
        const insert = db.prepare(
          "INSERT INTO thread_context_bindings (context_key, project, session, agent, model) VALUES (?,?,?,?,?)",
        );
        for (const binding of b) insert.run(binding.context_key, binding.project, binding.session, binding.agent, binding.model);
      });
      runInTx(bindings);
    },
  };
}
