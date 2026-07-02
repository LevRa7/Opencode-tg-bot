import Database from "better-sqlite3";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createVmStatePersistence, type VmStatePersistence } from "../../src/vm/state-persistence.js";
import { createVmLifecycleManager, VmLifecycle, type VmLifecycleManager } from "../../src/vm/lifecycle-manager.js";
import type { VmHandle, VmSpec, VmInfo } from "../../src/vm/types.js";
import type { HealthStatus } from "../../src/vm/health-proxy.js";

const mockSetVmRuntimeInfo = vi.fn();
const mockClearVmRuntimeInfo = vi.fn();

vi.mock("../../src/settings/manager.js", () => ({
  setVmRuntimeInfo: (...args: unknown[]) => mockSetVmRuntimeInfo(...args),
  clearVmRuntimeInfo: (...args: unknown[]) => mockClearVmRuntimeInfo(...args),
}));

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

// auto-recreation uses VM_TIERS from persisted specTier — must match src/vm/types.ts
const smallSpec: VmSpec = { tier: "small", ramMb: 2048, vcpus: 1, diskGb: 20, label: "Базовый" };

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
    startDomain: vi.fn().mockResolvedValue(false),
    healthCheck: vi.fn(),
    destroyHandle: vi.fn().mockResolvedValue({ success: true }),
    stop: vi.fn().mockResolvedValue({ success: true }),
    destroy: vi.fn().mockResolvedValue({ success: true }),
    isRunning: vi.fn().mockResolvedValue(true),
  };
}

describe("createVmLifecycleManager", () => {
  let db: Database.Database;
  let persistence: VmStatePersistence;
  let lifecycle: VmLifecycleManager;
  let mockVm: ReturnType<typeof createMockVmManager>;
  let healthOk: boolean;

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
    mockSetVmRuntimeInfo.mockClear();
    mockClearVmRuntimeInfo.mockClear();
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

  // Regression (2026-06-24): user VMs stopped deploying. A leftover "destroyed" row
  // (left behind by release()/health-timeout rollback, which only set status='destroyed'
  // without deleting the row) collided with the new provision. acquire() always inserts a
  // fresh randomUUID() vm_id, but save() only resolves ON CONFLICT(vm_id); the table also has
  // UNIQUE(user_id), so the INSERT raised "UNIQUE constraint failed: vm_states.user_id" and the
  // deploy aborted. This test drives the path: a destroyed row must not block re-provisioning.
  // Pass = acquire succeeds, a new VM is provisioned, and exactly one healthy row remains.
  it("acquire re-provisions over a leftover destroyed row without UNIQUE(user_id) collision", async () => {
    persistence.save({
      vmId: "old-destroyed-vm", userId: 42, environmentType: "libvirt", specTier: "small",
      assignedIpv4: "10.100.0.50", assignedMac: "", domainName: "opencode-tg-42",
      passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "destroyed",
      failureCount: 0,
    });

    const handle = await lifecycle.acquire(42, persistence, { spec: testSpec });

    expect(handle.userId).toBe(42);
    expect(mockVm.createAndStart).toHaveBeenCalled();
    const record = persistence.getByUserId(42);
    expect(record).toBeDefined();
    expect(record!.status).toBe("healthy");
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

  describe("recover — auto-recreation", () => {
    // Dedicated health proxy for recover tests: unhealthy for recover's own check
    // (the first call), healthy for acquire's check (second+ calls).
    function createRecoverHealthProxy(firstHealthy: boolean) {
      let callCount = 0;
      return {
        check: vi.fn().mockImplementation(async () => {
          callCount++;
          // recover's own health check is the first call
          if (callCount === 1) {
            return firstHealthy
              ? { healthy: true, services: { opencode: true, network: true } } as HealthStatus
              : { healthy: false, services: { opencode: false, network: false }, error: "mock fail" } as HealthStatus;
          }
          // acquire's health check (after auto-recreation) is healthy
          return { healthy: true, services: { opencode: true, network: true } } as HealthStatus;
        }),
      };
    }

    // (2026-06-26): recover() now auto-recreates VMs via acquire() after destroying dead/unhealthy
    // ones, instead of just walking away. This prevents the gap where a VM stays "destroyed"
    // indefinitely and the user gets no runtime until they send another message.

    it("auto-recreates VM when not running (attach returns null)", async () => {
      persistence.save({
        vmId: "vm-dead", userId: 55, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.55", assignedMac: "", domainName: "opencode-tg-55",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
      });
      mockVm.attach.mockResolvedValue(null);
      const hp = createRecoverHealthProxy(true);
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: hp as never });

      await lifecycle.recover(55, persistence);

      // VM should have been destroyed and auto-recreated
      expect(mockVm.createAndStart).toHaveBeenCalledWith(55, smallSpec, expect.any(Object));
      const record = persistence.getByUserId(55);
      expect(record).toBeDefined();
      expect(record!.status).toBe("healthy");
    });

    it("auto-recreates VM when unhealthy with failureCount below threshold", async () => {
      persistence.save({
        vmId: "vm-unhealthy-low", userId: 66, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.66", assignedMac: "", domainName: "opencode-tg-66",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
        failureCount: 2,
      });
      mockVm.attach.mockResolvedValue(makeHandle({ vmId: "vm-unhealthy-low", userId: 66, ipv4: "10.100.0.66" }));
      const hp = createRecoverHealthProxy(false);
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: hp as never });

      await lifecycle.recover(66, persistence);

      // Old VM destroyed, new one provisioned
      expect(mockVm.destroyHandle).toHaveBeenCalled();
      expect(mockVm.createAndStart).toHaveBeenCalledWith(66, smallSpec, expect.any(Object));
      const record = persistence.getByUserId(66);
      expect(record).toBeDefined();
      expect(record!.status).toBe("healthy");
    });

    it("does NOT auto-recreate when failureCount reaches degraded threshold (5)", async () => {
      persistence.save({
        vmId: "vm-almost-degraded", userId: 77, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.77", assignedMac: "", domainName: "opencode-tg-77",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
        failureCount: 4, // next increment → 5 → degraded
      });
      mockVm.attach.mockResolvedValue(makeHandle({ vmId: "vm-almost-degraded", userId: 77, ipv4: "10.100.0.77" }));
      const hp = createRecoverHealthProxy(false);
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: hp as never });

      await lifecycle.recover(77, persistence);

      // Old VM destroyed
      expect(mockVm.destroyHandle).toHaveBeenCalled();
      // Must NOT auto-recreate — degraded means manual intervention
      expect(mockVm.createAndStart).not.toHaveBeenCalled();
      const record = persistence.getByUserId(77);
      expect(record).toBeDefined();
      expect(record!.failureCount).toBeGreaterThanOrEqual(5);
      expect(record!.status).toBe("degraded");
    });

    it("skips already degraded VMs without action", async () => {
      persistence.save({
        vmId: "vm-degraded", userId: 88, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.88", assignedMac: "", domainName: "opencode-tg-88",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "degraded",
        failureCount: 5,
      });

      await lifecycle.recover(88, persistence);

      // No provisioning, no destruction — just skip
      expect(mockVm.createAndStart).not.toHaveBeenCalled();
      expect(mockVm.destroyHandle).not.toHaveBeenCalled();
      const record = persistence.getByUserId(88);
      expect(record!.status).toBe("degraded");
    });

    it("skips provisioning VMs (cloud-init may still be running)", async () => {
      persistence.save({
        vmId: "vm-provisioning", userId: 99, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.99", assignedMac: "", domainName: "opencode-tg-99",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "provisioning",
        failureCount: 0,
      });

      await lifecycle.recover(99, persistence);

      // No action on provisioning VMs
      expect(mockVm.createAndStart).not.toHaveBeenCalled();
      expect(mockVm.destroyHandle).not.toHaveBeenCalled();
    });

    it("skips non-existent (no-op) user gracefully", async () => {
      await lifecycle.recover(999, persistence);
      // Should not throw and not provision anything
      expect(mockVm.createAndStart).not.toHaveBeenCalled();
    });

    it("keeps VM healthy when it passes health check", async () => {
      persistence.save({
        vmId: "vm-ok", userId: 33, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.33", assignedMac: "", domainName: "opencode-tg-33",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
      });
      mockVm.attach.mockResolvedValue(makeHandle({ vmId: "vm-ok", userId: 33, ipv4: "10.100.0.33" }));
      const hp = createRecoverHealthProxy(true);
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: hp as never });

      await lifecycle.recover(33, persistence);

      expect(mockVm.createAndStart).not.toHaveBeenCalled();
      expect(mockVm.destroyHandle).not.toHaveBeenCalled();
      const record = persistence.getByUserId(33);
      expect(record!.status).toBe("healthy");
    });
  });

  // Legacy tests — keep the old semantics as regression guards, but adapt
  // them to the new auto-recreation behavior.
  describe("recover — legacy behavior adapted", () => {
    it("recover auto-recreates when VM not running (was: marks destroyed)", async () => {
      // Build lifecycle with always-healthy proxy (auto-recreation will succeed)
      const alwaysHealthy = {
        check: vi.fn().mockResolvedValue({ healthy: true, services: { opencode: true, network: true } } as HealthStatus),
      };
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: alwaysHealthy as never });

      persistence.save({
        vmId: "vm-dead-legacy", userId: 55, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.55", assignedMac: "", domainName: "opencode-tg-55",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
      });
      mockVm.attach.mockResolvedValue(null);
      await lifecycle.recover(55, persistence);

      // Old behavior: status was "destroyed"
      // New behavior: VM was auto-recreated → status is "healthy"
      const record = persistence.getByUserId(55);
      expect(record).toBeDefined();
      expect(record!.status).toBe("healthy");
      expect(mockVm.createAndStart).toHaveBeenCalled();
    });

    it("recover auto-recreates when unhealthy below threshold (was: marks destroyed)", async () => {
      // recover's check fails, acquire's check succeeds
      let callCount = 0;
      const twoPhaseHealth = {
        check: vi.fn().mockImplementation(async () => {
          callCount++;
          return callCount === 1
            ? { healthy: false, error: "fail" } as HealthStatus
            : { healthy: true, services: { opencode: true, network: true } } as HealthStatus;
        }),
      };
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: twoPhaseHealth as never });

      persistence.save({
        vmId: "vm-unhealthy-legacy", userId: 66, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.66", assignedMac: "", domainName: "opencode-tg-66",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
        failureCount: 0,
      });
      mockVm.attach.mockResolvedValue(makeHandle({ vmId: "vm-unhealthy-legacy", userId: 66, ipv4: "10.100.0.66" }));
      await lifecycle.recover(66, persistence);

      // Old behavior: status was "destroyed", destroyHandle was called
      // New behavior: VM was destroyed then auto-recreated
      expect(mockVm.destroyHandle).toHaveBeenCalled();
      expect(mockVm.createAndStart).toHaveBeenCalled();
      const record = persistence.getByUserId(66);
      expect(record).toBeDefined();
      expect(record!.status).toBe("healthy");
    });
  });

  it("VmLifecycle.using acquires, runs fn, and releases", async () => {
    const fn = vi.fn().mockResolvedValue("done");
    const result = await VmLifecycle.using(lifecycle, persistence, 42, testSpec, fn);
    expect(result).toBe("done");
    expect(fn).toHaveBeenCalled();
  });

  // Fix (2026-07-01): verify dual-write consistency fixes ported from Hermes memory-ts.
  // Hermes uses atomic file rename — single file = single source of truth.
  // The bot uses two SQL tables (vm_states + vm_runtimes) which must stay in sync.
  describe("vm_states ↔ vm_runtimes consistency (Hermes port fixes)", () => {
    it("acquire calls setVmRuntimeInfo after successful provision", async () => {
      await lifecycle.acquire(42, persistence, { spec: testSpec });

      expect(mockSetVmRuntimeInfo).toHaveBeenCalledTimes(1);
      expect(mockSetVmRuntimeInfo).toHaveBeenCalledWith(42, expect.objectContaining({
        userId: 42,
        baseUrl: "http://10.100.0.50:4096",
      }));
    });

    it("acquire calls clearVmRuntimeInfo on health-check failure rollback", async () => {
      healthOk = false;
      // Rebuild lifecycle with the failing health proxy
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: mockHealthProxy() as never });

      await expect(
        lifecycle.acquire(42, persistence, { spec: testSpec }),
      ).rejects.toThrow("did not become healthy");

      // Must clear routing info on rollback to prevent orphan vm_runtimes
      expect(mockClearVmRuntimeInfo).toHaveBeenCalledWith(42);
    });

    it("recover calls setVmRuntimeInfo when VM passes health check", async () => {
      persistence.save({
        vmId: "vm-recover-setruntime", userId: 33, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.33", assignedMac: "", domainName: "opencode-tg-33",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "healthy",
      });
      mockVm.attach.mockResolvedValue(makeHandle({ vmId: "vm-recover-setruntime", userId: 33, ipv4: "10.100.0.33" }));
      const healthyHp = { check: vi.fn().mockResolvedValue({ healthy: true, services: { opencode: true, network: true } } as HealthStatus) };
      lifecycle = createVmLifecycleManager({ vmManager: mockVm as never, healthProxy: healthyHp as never });

      // reset mock call count from setup
      mockSetVmRuntimeInfo.mockClear();

      await lifecycle.recover(33, persistence);

      expect(mockSetVmRuntimeInfo).toHaveBeenCalledTimes(1);
      expect(mockSetVmRuntimeInfo).toHaveBeenCalledWith(33, expect.objectContaining({
        userId: 33,
        baseUrl: "http://10.100.0.33:4096",
      }));
    });

    it("recover does NOT call setVmRuntimeInfo when VM is degraded (skipped)", async () => {
      persistence.save({
        vmId: "vm-degraded-noset", userId: 88, environmentType: "libvirt", specTier: "small",
        assignedIpv4: "10.100.0.88", assignedMac: "", domainName: "opencode-tg-88",
        passwordHash: "hash", version: 1, createdAt: "", updatedAt: "", status: "degraded",
        failureCount: 5,
      });
      mockSetVmRuntimeInfo.mockClear();

      await lifecycle.recover(88, persistence);

      expect(mockSetVmRuntimeInfo).not.toHaveBeenCalled();
    });
  });
});
