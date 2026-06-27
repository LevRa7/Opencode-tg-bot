import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVmStatePersistence, type VmStatePersistence } from "../../src/vm/state-persistence.js";
import { createVmLifecycleManager } from "../../src/vm/lifecycle-manager.js";
import { createVmOrchestrator } from "../../src/vm/orchestrator.js";
import type { VmHandle, VmSpec } from "../../src/vm/types.js";
import type { HealthStatus } from "../../src/vm/health-proxy.js";

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

const testSpec: VmSpec = { tier: "small", ramMb: 4096, vcpus: 2, diskGb: 20, label: "Test" };

function makeHandle(userId: number): VmHandle {
  return {
    vmId: `vm-${userId}`, userId, domainName: `opencode-tg-${userId}`,
    ipv4: "10.100.0.50", mac: "", baseUrl: "http://10.100.0.50:4096",
    password: "pw", specTier: "small",
  };
}

describe("createVmOrchestrator", () => {
  let db: Database.Database;
  let persistence: VmStatePersistence;
  let orchestrator: ReturnType<typeof createVmOrchestrator>;

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    db.exec(DDL);
    persistence = createVmStatePersistence(db);

    const mockVm = {
      createAndStart: vi.fn().mockImplementation(async (userId: number) => ({
        userId, tier: "small", domainName: `opencode-tg-${userId}`,
        qcow2Path: `/tmp/vm-${userId}.qcow2`, cloudInitIsoPath: `/tmp/ci-${userId}.iso`,
        bridgeIp: "10.100.0.50", baseUrl: "http://10.100.0.50:4096",
        startTime: new Date().toISOString(), pid: null, sudoPassword: "pw",
      })),
      attach: vi.fn().mockResolvedValue(makeHandle(0)),
      destroyHandle: vi.fn().mockResolvedValue({ success: true }),
      destroy: vi.fn().mockResolvedValue({ success: true }),
      healthCheck: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockResolvedValue(true),
    };

    const mockHealth = {
      check: vi.fn().mockResolvedValue({ healthy: true, services: { opencode: true, network: true } } as HealthStatus),
    };

    const lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: mockHealth as never });
    orchestrator = createVmOrchestrator(lifecycle);
  });

  it("parallel runs tasks on multiple VMs", async () => {
    const results = await orchestrator.parallel(persistence, [
      { userId: 1, spec: testSpec, fn: async (h) => `done-${h.userId}` },
      { userId: 2, spec: testSpec, fn: async (h) => `done-${h.userId}` },
    ]);

    expect(results).toHaveLength(2);
    expect(results).toContain("done-1");
    expect(results).toContain("done-2");
  });

  it("recoverAll handles degraded VMs gracefully", async () => {
    persistence.save({
      vmId: "vm-deg", userId: 99, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.99", assignedMac: "", domainName: "opencode-tg-99",
      passwordHash: "h", version: 1, createdAt: "", updatedAt: "",
      status: "degraded", failureCount: 5,
    });

    await orchestrator.recoverAll(persistence);
    // Should not throw — degraded VMs are skipped with a warning
  });

  // (2026-06-26): recoverAll now triggers auto-recreation of dead/unhealthy VMs
  // via lifecycle.recover() → tryAutoRecreate(). This test verifies that a dead
  // VM inside recoverAll gets auto-recreated rather than staying destroyed.
  it("recoverAll auto-recreates dead VMs", async () => {
    // Build lifecycle with always-healthy proxy so auto-recreation succeeds
    const alwaysHealthy = {
      check: vi.fn().mockResolvedValue({ healthy: true, services: { opencode: true, network: true } } as HealthStatus),
    };
    const mockVmRecreate = {
      createAndStart: vi.fn().mockImplementation(async (userId: number) => ({
        userId, tier: "small", domainName: `opencode-tg-${userId}`,
        qcow2Path: `/tmp/vm-${userId}.qcow2`, cloudInitIsoPath: `/tmp/ci-${userId}.iso`,
        bridgeIp: "10.100.0.50", baseUrl: "http://10.100.0.50:4096",
        startTime: new Date().toISOString(), pid: null, sudoPassword: "pw",
      })),
      attach: vi.fn().mockResolvedValue(null), // dead VM
      destroyHandle: vi.fn().mockResolvedValue({ success: true }),
      destroy: vi.fn().mockResolvedValue({ success: true }),
      healthCheck: vi.fn(),
      stop: vi.fn(),
      isRunning: vi.fn().mockResolvedValue(true),
    };

    const lifecycleRecreate = createVmLifecycleManager({
      vmManager: mockVmRecreate as never,
      healthProxy: alwaysHealthy as never,
    });
    const orchRecreate = createVmOrchestrator(lifecycleRecreate);

    persistence.save({
      vmId: "vm-dead-auto", userId: 77, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.77", assignedMac: "", domainName: "opencode-tg-77",
      passwordHash: "h", version: 1, createdAt: "", updatedAt: "",
      status: "healthy", failureCount: 0,
    });

    await orchRecreate.recoverAll(persistence);

    // Dead VM was destroyed and a fresh one provisioned
    expect(mockVmRecreate.createAndStart).toHaveBeenCalled();
    const record = persistence.getByUserId(77);
    expect(record).toBeDefined();
    expect(record!.status).toBe("healthy");
  });
});
