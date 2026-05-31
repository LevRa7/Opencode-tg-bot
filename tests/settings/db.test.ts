import { describe, expect, it } from "vitest";
import { openDatabase, closeDatabase } from "../../src/settings/db.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("openDatabase", () => {
  it("creates all expected tables", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-db-"));
    const dbPath = path.join(tmpDir, "test.db");

    const db = openDatabase(dbPath);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[])
      .map((t: any) => t.name);

    const expected = [
      "access_requests", "approved_users", "attached_sessions",
      "conversation_bindings", "last_restart_request", "scheduled_task_ignores",
      "scheduled_tasks", "server_process", "session_directory_cache",
      "tenant_runtimes", "thread_context_bindings", "user_preferences",
    ];
    for (const name of expected) {
      expect(tables).toContain(name);
    }

    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is idempotent (CREATE IF NOT EXISTS)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-db2-"));
    const dbPath = path.join(tmpDir, "test.db");

    const db1 = openDatabase(dbPath);
    const before = (db1.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table'").get() as any).cnt;
    closeDatabase(db1);

    const db2 = openDatabase(dbPath);
    const after = (db2.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table'").get() as any).cnt;
    closeDatabase(db2);

    expect(after).toBe(before);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
