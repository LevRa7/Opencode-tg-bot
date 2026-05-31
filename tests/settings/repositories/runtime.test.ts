import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createRuntimeRepository } from "../../../src/settings/repositories/runtime.js";

const DDL = `
CREATE TABLE IF NOT EXISTS server_process (key TEXT PRIMARY KEY DEFAULT 'current', data TEXT);
CREATE TABLE IF NOT EXISTS last_restart_request (key TEXT PRIMARY KEY DEFAULT 'current', data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tenant_runtimes (
    user_id INTEGER PRIMARY KEY,
    data    TEXT NOT NULL
);
`;

describe("RuntimeRepository", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); db.exec(DDL); });

  describe("server_process", () => {
    it("returns null when empty", () => {
      const repo = createRuntimeRepository(db);
      expect(repo.getServerProcess()).toBeNull();
    });
    it("sets and retrieves", () => {
      const repo = createRuntimeRepository(db);
      repo.setServerProcess(JSON.stringify({ pid: 12345, startTime: "2026-01-01T00:00:00Z" }));
      expect(repo.getServerProcess()).toBe(JSON.stringify({ pid: 12345, startTime: "2026-01-01T00:00:00Z" }));
    });
    it("clears", () => {
      const repo = createRuntimeRepository(db);
      repo.setServerProcess(JSON.stringify({ pid: 1, startTime: "x" }));
      repo.clearServerProcess();
      expect(repo.getServerProcess()).toBeNull();
    });
  });

  describe("last_restart_request", () => {
    it("returns null when empty", () => {
      const repo = createRuntimeRepository(db);
      expect(repo.getLastRestartRequest()).toBeNull();
    });
    it("sets and retrieves", () => {
      const repo = createRuntimeRepository(db);
      repo.setLastRestartRequest(JSON.stringify({ updateId: 1, requestedAt: "x" }));
      expect(repo.getLastRestartRequest()).toBe(JSON.stringify({ updateId: 1, requestedAt: "x" }));
    });
  });

  describe("tenant_runtimes", () => {
    it("returns undefined for non-existent", () => {
      const repo = createRuntimeRepository(db);
      expect(repo.getTenantRuntime(999)).toBeUndefined();
    });
    it("upserts and retrieves JSON blob", () => {
      const repo = createRuntimeRepository(db);
      const rt = JSON.stringify({ userId: 1, chatId: 100, port: 4096, baseUrl: "http://localhost:4096", tenantId: "t1" });
      repo.upsertTenantRuntime(1, rt);
      expect(repo.getTenantRuntime(1)).toBe(rt);
    });
    it("returns all runtimes", () => {
      const repo = createRuntimeRepository(db);
      repo.upsertTenantRuntime(1, JSON.stringify({ userId: 1 }));
      repo.upsertTenantRuntime(2, JSON.stringify({ userId: 2 }));
      expect(repo.getAllTenantRuntimes()).toHaveLength(2);
      expect(JSON.parse(repo.getAllTenantRuntimes()[0].data).userId).toBe(1);
    });
    it("deletes runtime", () => {
      const repo = createRuntimeRepository(db);
      repo.upsertTenantRuntime(1, JSON.stringify({ userId: 1 }));
      repo.deleteTenantRuntime(1);
      expect(repo.getTenantRuntime(1)).toBeUndefined();
    });
  });
});
