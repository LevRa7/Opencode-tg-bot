import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createNetworkPoolAllocator } from "../../src/vm/network-pool.js";

describe("NetworkPoolAllocator", () => {
  let db: Database.Database;
  let pool: ReturnType<typeof createNetworkPoolAllocator>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
      CREATE TABLE IF NOT EXISTS ip_allocations (
        ipv4          TEXT PRIMARY KEY,
        user_id       INTEGER NOT NULL,
        vm_id         TEXT NOT NULL,
        assigned_at   TEXT NOT NULL,
        UNIQUE(user_id)
      );
    `);
    pool = createNetworkPoolAllocator(db);
  });

  it("allocates the first available IP", () => {
    const ip = pool.allocate(1, "vm-1");
    expect(ip).toBe("10.100.0.10");
  });

  it("allocates consecutive IPs to different users", () => {
    const ip1 = pool.allocate(1, "vm-1");
    const ip2 = pool.allocate(2, "vm-2");
    expect(ip1).toBe("10.100.0.10");
    expect(ip2).toBe("10.100.0.11");
  });

  it("reuses freed IPs", () => {
    pool.allocate(1, "vm-1");  // 10.100.0.10
    pool.allocate(2, "vm-2");  // 10.100.0.11
    pool.release(1);
    const ip3 = pool.allocate(3, "vm-3"); // should get 10.100.0.10
    expect(ip3).toBe("10.100.0.10");
  });

  it("returns existing IP for same user", () => {
    const ip1 = pool.allocate(42, "vm-42");
    const ip2 = pool.allocate(42, "vm-42-new");
    expect(ip2).toBe(ip1);
  });

  it("releases by vmId", () => {
    pool.allocate(1, "vm-a");
    pool.allocate(2, "vm-b");
    pool.releaseByVmId("vm-a");
    const ip = pool.allocate(3, "vm-c");
    expect(ip).toBe("10.100.0.10");
  });

  it("getByUserId returns allocation", () => {
    pool.allocate(99, "vm-99");
    const a = pool.getByUserId(99);
    expect(a).toBeDefined();
    expect(a!.ipv4).toBe("10.100.0.10");
    expect(a!.vmId).toBe("vm-99");
  });

  it("getByUserId returns undefined for non-allocated", () => {
    expect(pool.getByUserId(999)).toBeUndefined();
  });

  it("getAllocations returns all active", () => {
    pool.allocate(1, "vm-1");
    pool.allocate(2, "vm-2");
    pool.release(1);
    const all = pool.getAllocations();
    expect(all).toHaveLength(1);
    expect(all[0].userId).toBe(2);
  });

  it("getPoolSize returns correct size", () => {
    expect(pool.getPoolSize()).toBe(241); // 250 - 10 + 1
  });

  it("throws when pool is exhausted", () => {
    // Allocate all IPs in a small test pool
    const smallPool = createNetworkPoolAllocator(db, "10.100.0", 10, 12);
    smallPool.allocate(1, "vm-1"); // .10
    smallPool.allocate(2, "vm-2"); // .11
    smallPool.allocate(3, "vm-3"); // .12
    expect(() => smallPool.allocate(4, "vm-4")).toThrow("No IP addresses available");
  });
});
