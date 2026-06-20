import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVmStatePersistence, type VmStatePersistence } from "../../src/vm/state-persistence.js";
import { createVmLifecycleManager, VmLifecycle, type VmLifecycleManager } from "../../src/vm/lifecycle-manager.js";
import type { VmHandle, VmSpec, VmInfo } from "../../src/vm/types.js";
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

function makeInfo(userId: number): VmInfo {
  return {
    userId, tier: "small", domainName: `opencode-tg-${userId}`,
    qcow2Path: `/tmp/vm-${userId}.qcow2`, cloudInitIsoPath: `/tmp/cloud-init-${userId}.iso`,
    bridgeIp: "10.100.0.50", baseUrl: "http://10.100.0.50:4096",
    startTime: new Date().toISOString(), pid: null, sudoPassword: `pw-${userId}`,
  };
}

function makeHandle(overrides?: Partial<VmHandle>): VmHandle {
  return {
    vmId: "test-vm", userId: 42, domainName: "opencode-tg-42",
    ipv4: "10.100.0.50", mac: "", baseUrl: "http://10.100.0.50:4096",
    password: "pw-42", specTier: "small", ...overrides,
  };
}

describe("createVmLifecycleManager", () => {
  let db: Database.Database;
  let persistence: VmStatePersistence;
  let lifecycle: VmLifecycleManager;
  let mockVm: ReturnType<typeof createMockVmManager>;
  let healthOk: boolean;

  function createMockVmManager() {
    return {
      createAndStart: vi.fn().mockImplementation(async (userId: number) => makeInfo(userId)),
      attach: vi.fn().mockImplementation(async (record: { vmId: string; userId: number; domainName: string; assignedIpv4: string; assignedMac: string; passwordHash: string; specTier: string }) =>
        record ? {
          vmId: record.vmId, userId: record.userId, domainName: record.domainName,
          ipv4: record.assignedIpv4, mac: record.assignedMac,
          baseUrl: `http://${record.assignedIpv4}:4096`,
          password: record.passwordHash, specTier: record.specTier,
        } as VmHandle : null,
      ),
      healthCheck: vi.fn(),
      destroyHandle: vi.fn().mockResolvedValue({ success: true }),
      stop: vi.fn().mockResolvedValue({ success: true }),
      destroy: vi.fn().mockResolvedValue({ success: true }),
      isRunning: vi.fn().mockResolvedValue(true),
    };
  }

  function mockHealthProxy() {
    return {
      check: vi.fn().mockImplementation(async () => {
        if (healthOk) {
          return { healthy: true, services: { opencode: true, network: true } } as HealthStatus;
        }
        return { healthy: false, services: { opencode: false, network: false }, error: "mock fail" } as HealthStatus;
      }),
    };
  }

  beforeEach(() => {
    vi.clearAllMocks();
    db = new Database(":memory:");
    db.exec(DDL);
    persistence = createVmStatePersistence(db);
    healthOk = true;
    mockVm = createMockVmManager();
    lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: mockHealthProxy() as never });
  });

  it("acquire provisions and returns a handle for new user", async () => {
    const handle = await lifecycle.acquire(42, persistence, { spec: testSpec });
    expect(handle.userId).toBe(42);
    expect(handle.baseUrl).toBe("http://10.100.0.50:4096");
    expect(mockVm.createAndStart).toHaveBeenCalledWith(42, testSpec, expect.any(Object));

    const record = persistence.getByUserId(42);
    expect(record).toBeDefined();
    expect(record!.status).toBe("healthy");
  });

  it("acquire returns existing healthy VM without re-provisioning", async () => {
    persistence.save({
      vmId: "existing-vm", userId: 42, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.50", assignedMac: "", domainName: "opencode-tg-42",
      passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
    });
    const handle = await lifecycle.acquire(42, persistence, { spec: testSpec });
    expect(handle.userId).toBe(42);
    expect(mockVm.createAndStart).not.toHaveBeenCalled();
  });

  it("acquire re-provisions when existing VM is dead", async () => {
    persistence.save({
      vmId: "existing-vm", userId: 42, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.50", assignedMac: "", domainName: "opencode-tg-42",
      passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
    });
    mockVm.attach.mockResolvedValue(null);
    const handle = await lifecycle.acquire(42, persistence, { spec: testSpec });
    expect(handle.userId).toBe(42);
    expect(mockVm.createAndStart).toHaveBeenCalled();
    expect(mockVm.destroyHandle).not.toHaveBeenCalled();
  });

  it("release destroys VM and marks state", async () => {
    persistence.save({
      vmId: "vm-to-release", userId: 99, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.99", assignedMac: "", domainName: "opencode-tg-99",
      passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
    });
    const handle = makeHandle({ vmId: "vm-to-release", userId: 99, ipv4: "10.100.0.99", password: "hash" });
    const result = await lifecycle.release(handle, persistence);
    expect(result.success).toBe(true);
    expect(mockVm.destroyHandle).toHaveBeenCalledWith(handle);
    const record = persistence.getByUserId(99);
    expect(record!.status).toBe("destroyed");
  });

  it("recover marks VM destroyed when not running", async () => {
    persistence.save({
      vmId: "vm-to-recover", userId: 55, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.55", assignedMac: "", domainName: "opencode-tg-55",
      passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
    });
    mockVm.attach.mockResolvedValue(null);
    await lifecycle.recover(55, persistence);
    const record = persistence.getByUserId(55);
    expect(record!.status).toBe("destroyed");
  });

  it("recover marks VM destroyed when unhealthy", async () => {
    persistence.save({
      vmId: "vm-unhealthy", userId: 66, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.66", assignedMac: "", domainName: "opencode-tg-66",
      passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
    });
    mockVm.attach.mockResolvedValue(makeHandle({ vmId: "vm-unhealthy", userId: 66, ipv4: "10.100.0.66" }));
    healthOk = false;
    lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: mockHealthProxy() as never });
    await lifecycle.recover(66, persistence);
    const record = persistence.getByUserId(66);
    expect(record!.status).toBe("destroyed");
    expect(mockVm.destroyHandle).toHaveBeenCalled();
  });

  it("VmLifecycle.using acquires, runs fn, and releases", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    const result = await VmLifecycle.using(lifecycle, persistence, 42, testSpec, fn);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalled();
  });
});
