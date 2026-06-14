import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createVmRuntimeRepository } from "../../../src/settings/repositories/vm-runtimes.js";

const DDL = `
CREATE TABLE IF NOT EXISTS vm_runtimes (
    user_id INTEGER PRIMARY KEY,
    data    TEXT NOT NULL
);
`;

describe("VmRuntimeRepository", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); db.exec(DDL); });

  it("returns undefined for non-existent user", () => {
    const repo = createVmRuntimeRepository(db);
    expect(repo.get(999)).toBeUndefined();
  });

  it("upserts and retrieves JSON blob", () => {
    const repo = createVmRuntimeRepository(db);
    const vm = JSON.stringify({ userId: 1, tier: "medium", domainName: "vm-1", baseUrl: "http://vm-1.local" });
    repo.upsert(1, vm);
    expect(repo.get(1)).toBe(vm);
  });

  it("returns all runtimes", () => {
    const repo = createVmRuntimeRepository(db);
    repo.upsert(1, JSON.stringify({ userId: 1 }));
    repo.upsert(2, JSON.stringify({ userId: 2 }));
    expect(repo.getAll()).toHaveLength(2);
    expect(JSON.parse(repo.getAll()[0].data).userId).toBe(1);
  });

  it("deletes a runtime", () => {
    const repo = createVmRuntimeRepository(db);
    repo.upsert(1, JSON.stringify({ userId: 1 }));
    repo.delete(1);
    expect(repo.get(1)).toBeUndefined();
  });
});
