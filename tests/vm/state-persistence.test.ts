import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import {
  createVmStatePersistence,
  type VmStateRecord,
} from "../../src/vm/state-persistence.js";

const DDL = `
CREATE TABLE IF NOT EXISTS vm_states (
  vm_id           TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  environment_type TEXT NOT NULL DEFAULT 'libvirt',
  spec_tier       TEXT NOT NULL DEFAULT 'small',
  assigned_ipv4   TEXT,
  assigned_mac    TEXT,
  domain_name     TEXT,
  password_hash   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'provisioning',
  failure_count   INTEGER NOT NULL DEFAULT 0,
  UNIQUE(user_id)
);
`;

function makeRecord(overrides: Partial<VmStateRecord> & { userId: number; vmId: string }): VmStateRecord {
  return {
    environmentType: "libvirt",
    specTier: "small",
    assignedIpv4: "10.100.0.50",
    assignedMac: "52:54:00:ab:cd:ef",
    domainName: "opencode-tg-" + overrides.userId,
    passwordHash: "test-hash",
    version: 1,
    createdAt: "2025-01-01T00:00:00.000Z",
    updatedAt: "2025-01-01T00:00:00.000Z",
    status: "provisioning",
    failureCount: 0,
    ...overrides,
  };
}

describe("VmStatePersistence", () => {
  let db: Database.Database;
  let persistence: ReturnType<typeof createVmStatePersistence>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
    persistence = createVmStatePersistence(db);
  });

  it("returns undefined for non-existent user", () => {
    const result = persistence.getByUserId(999);
    expect(result).toBeUndefined();
  });

  it("saves and retrieves a state record", () => {
    const record = makeRecord({ vmId: "vm-1", userId: 42 });
    persistence.save(record);
    const loaded = persistence.getByUserId(42);
    expect(loaded).toBeDefined();
    expect(loaded!.vmId).toBe("vm-1");
    expect(loaded!.userId).toBe(42);
    expect(loaded!.status).toBe("provisioning");
    expect(loaded!.version).toBe(1);
    expect(loaded!.specTier).toBe("small");
    expect(loaded!.assignedIpv4).toBe("10.100.0.50");
  });

  it("increments version on each save", () => {
    const record = makeRecord({ vmId: "vm-1", userId: 42 });
    persistence.save(record);
    const v1 = persistence.getByUserId(42);
    expect(v1!.version).toBe(1);
    persistence.save({ ...v1!, version: v1!.version });
    const v2 = persistence.getByUserId(42);
    expect(v2!.version).toBe(2);
  });

  it("updateIfCurrent succeeds when version matches", () => {
    const record = makeRecord({ vmId: "vm-1", userId: 42 });
    persistence.save(record);
    const saved = persistence.getByUserId(42)!;
    const result = persistence.updateIfCurrent(saved.vmId, saved.version, { status: "healthy" });
    expect(result).toBe(true);
    const updated = persistence.getByUserId(42);
    expect(updated!.status).toBe("healthy");
    expect(updated!.version).toBe(saved.version + 1);
  });

  it("updateIfCurrent fails when version does not match", () => {
    const record = makeRecord({ vmId: "vm-1", userId: 42 });
    persistence.save(record);
    const result = persistence.updateIfCurrent("vm-1", 999, { status: "healthy" });
    expect(result).toBe(false);
  });

  it("listActive returns only non-destroyed records", () => {
    persistence.save(makeRecord({ vmId: "vm-1", userId: 1, status: "healthy" }));
    persistence.save(makeRecord({ vmId: "vm-2", userId: 2, status: "destroyed" }));
    persistence.save(makeRecord({ vmId: "vm-3", userId: 3, status: "provisioning" }));

    const active = persistence.listActive();
    expect(active).toHaveLength(2);
    expect(active.map((r) => r.vmId).sort()).toEqual(["vm-1", "vm-3"]);
  });

  it("markDestroyed updates status to destroyed", () => {
    persistence.save(makeRecord({ vmId: "vm-1", userId: 1, status: "healthy" }));
    const result = persistence.markDestroyed("vm-1");
    expect(result).toBe(true);
    const loaded = persistence.getByUserId(1);
    expect(loaded!.status).toBe("destroyed");
    expect(loaded!.version).toBe(2);
  });

  it("getByVmId retrieves by vm_id", () => {
    persistence.save(makeRecord({ vmId: "vm-42", userId: 99 }));
    const loaded = persistence.getByVmId("vm-42");
    expect(loaded).toBeDefined();
    expect(loaded!.userId).toBe(99);
  });

  it("deleteByUserId removes the record", () => {
    persistence.save(makeRecord({ vmId: "vm-del", userId: 77 }));
    expect(persistence.getByUserId(77)).toBeDefined();
    persistence.deleteByUserId(77);
    expect(persistence.getByUserId(77)).toBeUndefined();
  });

  it("deleteByUserId returns false for non-existent user", () => {
    const result = persistence.deleteByUserId(999);
    expect(result).toBe(false);
  });

  it("incrementFailureCount increases failure_count", () => {
    persistence.save(makeRecord({ vmId: "vm-fail", userId: 55 }));
    persistence.incrementFailureCount("vm-fail");
    const loaded = persistence.getByUserId(55);
    expect(loaded!.failureCount).toBe(1);
  });

  it("resetFailureCount sets failure_count to 0", () => {
    persistence.save(makeRecord({ vmId: "vm-fail", userId: 66, failureCount: 3 }));
    persistence.resetFailureCount("vm-fail");
    const loaded = persistence.getByUserId(66);
    expect(loaded!.failureCount).toBe(0);
  });

  it("incrementFailureCount marks as degraded after 5 failures", () => {
    persistence.save(makeRecord({ vmId: "vm-deg", userId: 77, status: "healthy" }));
    for (let i = 0; i < 5; i++) {
      persistence.incrementFailureCount("vm-deg");
    }
    const loaded = persistence.getByUserId(77);
    expect(loaded!.status).toBe("degraded");
    expect(loaded!.failureCount).toBe(5);
  });

  it("listDegraded returns only degraded records", () => {
    persistence.save(makeRecord({ vmId: "vm-ok", userId: 1, status: "healthy" }));
    persistence.save(makeRecord({ vmId: "vm-bad", userId: 2, status: "degraded" }));
    persistence.save(makeRecord({ vmId: "vm-dead", userId: 3, status: "destroyed" }));
    const degraded = persistence.listDegraded();
    expect(degraded).toHaveLength(1);
    expect(degraded[0].vmId).toBe("vm-bad");
  });

  it("listActive excludes degraded records", () => {
    persistence.save(makeRecord({ vmId: "vm-ok", userId: 1, status: "healthy" }));
    persistence.save(makeRecord({ vmId: "vm-bad", userId: 2, status: "degraded" }));
    const active = persistence.listActive();
    expect(active).toHaveLength(1);
    expect(active[0].vmId).toBe("vm-ok");
  });
});
