import type Database from "better-sqlite3";
import type { VmRuntimeRow } from "./types.js";

export interface VmRuntimeRepository {
  get(userId: number): string | undefined;
  getAll(): VmRuntimeRow[];
  upsert(userId: number, data: string): void;
  delete(userId: number): void;
}

export function createVmRuntimeRepository(db: Database.Database): VmRuntimeRepository {
  const getStmt = db.prepare("SELECT data FROM vm_runtimes WHERE user_id = ?");
  const getAllStmt = db.prepare("SELECT * FROM vm_runtimes");
  const upsertStmt = db.prepare("INSERT INTO vm_runtimes (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = ?");
  const deleteStmt = db.prepare("DELETE FROM vm_runtimes WHERE user_id = ?");

  return {
    get(userId: number): string | undefined {
      const row = getStmt.get(userId) as { data: string } | undefined;
      return row?.data;
    },
    getAll(): VmRuntimeRow[] {
      return getAllStmt.all() as VmRuntimeRow[];
    },
    upsert(userId: number, data: string): void {
      upsertStmt.run(userId, data, data);
    },
    delete(userId: number): void {
      deleteStmt.run(userId);
    },
  };
}
