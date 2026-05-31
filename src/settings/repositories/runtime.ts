import type Database from "better-sqlite3";
import type { TenantRuntimeRow } from "./types.js";

export interface RuntimeRepository {
  getServerProcess(): string | null;
  setServerProcess(data: string): void;
  clearServerProcess(): void;
  getLastRestartRequest(): string | null;
  setLastRestartRequest(data: string): void;
  getTenantRuntime(userId: number): string | undefined;
  getAllTenantRuntimes(): TenantRuntimeRow[];
  upsertTenantRuntime(userId: number, data: string): void;
  deleteTenantRuntime(userId: number): void;
}

export function createRuntimeRepository(db: Database.Database): RuntimeRepository {
  const getServerStmt = db.prepare("SELECT data FROM server_process WHERE key = 'current'");
  const setServerStmt = db.prepare("INSERT INTO server_process (key, data) VALUES ('current', ?) ON CONFLICT(key) DO UPDATE SET data = ?");
  const clearServerStmt = db.prepare("DELETE FROM server_process WHERE key = 'current'");
  const getRestartStmt = db.prepare("SELECT data FROM last_restart_request WHERE key = 'current'");
  const setRestartStmt = db.prepare("INSERT INTO last_restart_request (key, data) VALUES ('current', ?) ON CONFLICT(key) DO UPDATE SET data = ?");
  const getTenantStmt = db.prepare("SELECT data FROM tenant_runtimes WHERE user_id = ?");
  const getAllTenantsStmt = db.prepare("SELECT * FROM tenant_runtimes");
  const upsertTenantStmt = db.prepare("INSERT INTO tenant_runtimes (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = ?");
  const deleteTenantStmt = db.prepare("DELETE FROM tenant_runtimes WHERE user_id = ?");

  return {
    getServerProcess(): string | null {
      const row = getServerStmt.get() as { data: string | null } | undefined;
      return row?.data ?? null;
    },
    setServerProcess(data: string): void { setServerStmt.run(data, data); },
    clearServerProcess(): void { clearServerStmt.run(); },
    getLastRestartRequest(): string | null {
      const row = getRestartStmt.get() as { data: string | null } | undefined;
      return row?.data ?? null;
    },
    setLastRestartRequest(data: string): void { setRestartStmt.run(data, data); },
    getTenantRuntime(userId: number): string | undefined {
      const row = getTenantStmt.get(userId) as { data: string } | undefined;
      return row?.data;
    },
    getAllTenantRuntimes(): TenantRuntimeRow[] {
      return getAllTenantsStmt.all() as TenantRuntimeRow[];
    },
    upsertTenantRuntime(userId: number, data: string): void {
      upsertTenantStmt.run(userId, data, data);
    },
    deleteTenantRuntime(userId: number): void {
      deleteTenantStmt.run(userId);
    },
  };
}
