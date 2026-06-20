import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import type { VmHandle, VmSpec, VmOperationResult, VmInfo } from "./types.js";
import type { VmStatePersistence, VmStateRecord } from "./state-persistence.js";
import type { HealthProxy, HealthStatus } from "./health-proxy.js";
import type { VmManager } from "./manager.js";

export interface AcquireOptions {
  spec?: VmSpec;
  timeoutMs?: number;
  pollMs?: number;
  onProgress?: (step: string) => void;
}

export interface VmLifecycleManager {
  acquire(userId: number, persistence: VmStatePersistence, options?: AcquireOptions): Promise<VmHandle>;
  release(handle: VmHandle, persistence: VmStatePersistence): Promise<VmOperationResult>;
  recover(userId: number, persistence: VmStatePersistence): Promise<void>;
}

export interface LifecycleDeps {
  vmManager: VmManager;
  healthProxy: HealthProxy;
}

export function createVmLifecycleManager(deps: LifecycleDeps): VmLifecycleManager {
  const { vmManager: vm, healthProxy: hp } = deps;

  async function acquire(
    userId: number,
    persistence: VmStatePersistence,
    options?: AcquireOptions,
  ): Promise<VmHandle> {
    const existing = persistence.getByUserId(userId);

    if (existing && existing.status !== "destroyed" && existing.status !== "degraded") {
      const handle = await vm.attach(existing);
      if (handle) {
        const healthy = await hp.check(handle, {
          timeoutMs: options?.timeoutMs ?? 60_000,
          pollMs: options?.pollMs ?? 2000,
        });
        if (healthy.healthy) {
          persistence.updateIfCurrent(existing.vmId, existing.version, { status: "healthy" });
          persistence.resetFailureCount(existing.vmId);
          return handle;
        }
        persistence.incrementFailureCount(existing.vmId);
        logger.warn("[Lifecycle] VM %s exists but unhealthy, re-provisioning", userId);
        await vm.destroyHandle(handle);
      } else {
        persistence.incrementFailureCount(existing.vmId);
        logger.warn("[Lifecycle] VM %s exists but not running, re-provisioning", userId);
      }
      persistence.deleteByUserId(userId);
    } else if (existing && existing.status === "degraded") {
      throw new Error(`VM for userId=${userId} is degraded after ${existing.failureCount} failures. Manual intervention required.`);
    }

    const spec = options?.spec;
    if (!spec) {
      throw new Error("No VM spec provided and no existing VM found");
    }

    let vmInfo: VmInfo;
    try {
      vmInfo = await vm.createAndStart(userId, spec, { onProgress: options?.onProgress });
    } catch (err) {
      logger.error("[Lifecycle] Failed to provision VM for userId=%d: %s", userId, err);
      throw err;
    }

    const record: VmStateRecord = {
      vmId: randomUUID(),
      userId,
      environmentType: "libvirt",
      specTier: spec.tier,
      assignedIpv4: vmInfo.bridgeIp ?? "",
      assignedMac: "",
      domainName: vmInfo.domainName,
      passwordHash: vmInfo.sudoPassword ?? "",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "provisioning",
      failureCount: 0,
    };
    persistence.save(record);

    const handle: VmHandle = {
      vmId: record.vmId,
      userId,
      domainName: vmInfo.domainName,
      ipv4: vmInfo.bridgeIp ?? "",
      mac: "",
      baseUrl: vmInfo.baseUrl,
      password: vmInfo.sudoPassword ?? "",
      specTier: spec.tier,
    };

    const saved = persistence.getByUserId(userId)!;
    const savedVersion = saved.version;

    const healthy = await hp.check(handle, {
      timeoutMs: options?.timeoutMs ?? 300_000,
      pollMs: options?.pollMs ?? 2000,
    });

    if (!healthy.healthy) {
      logger.error("[Lifecycle] Health timeout for VM userId=%d, rolling back", userId);
      await vm.destroyHandle(handle).catch(() => {});
      persistence.markDestroyed(record.vmId);
      throw new Error(`VM at ${handle.baseUrl} did not become healthy within timeout`);
    }

    persistence.updateIfCurrent(record.vmId, savedVersion, { status: "healthy" });
    return handle;
  }

  async function release(handle: VmHandle, persistence: VmStatePersistence): Promise<VmOperationResult> {
    try {
      const result = await vm.destroyHandle(handle);
      if (result.success) {
        persistence.markDestroyed(handle.vmId);
        logger.info("[Lifecycle] Released VM %s for userId=%d", handle.vmId, handle.userId);
      }
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[Lifecycle] Release failed for VM %s: %s", handle.vmId, msg);
      return { success: false, error: msg };
    }
  }

  async function recover(userId: number, persistence: VmStatePersistence): Promise<void> {
    const record = persistence.getByUserId(userId);
    if (!record || record.status === "destroyed") return;
    if (record.status === "degraded") {
      logger.warn("[Lifecycle] Recovery skipped: VM %s is degraded (failures=%d)", userId, record.failureCount);
      return;
    }

    const handle = await vm.attach(record);
    if (!handle) {
      logger.warn("[Lifecycle] Recovery: VM %s not running, marking destroyed", userId);
      persistence.markDestroyed(record.vmId);
      return;
    }

    const healthy = await hp.check(handle, { timeoutMs: 30_000, pollMs: 2000 });
    if (!healthy.healthy) {
      persistence.incrementFailureCount(record.vmId);
      logger.warn("[Lifecycle] Recovery: VM %s unhealthy, destroying", userId);
      await vm.destroyHandle(handle).catch(() => {});
      persistence.markDestroyed(record.vmId);
      return;
    }

    persistence.updateIfCurrent(record.vmId, record.version, { status: "healthy" });
    persistence.resetFailureCount(record.vmId);
  }

  return { acquire, release, recover };
}

export const VmLifecycle = {
  async using<T>(
    lifecycle: VmLifecycleManager,
    persistence: VmStatePersistence,
    userId: number,
    spec: VmSpec,
    fn: (handle: VmHandle) => Promise<T>,
    options?: AcquireOptions,
  ): Promise<T> {
    const handle = await lifecycle.acquire(userId, persistence, { spec, ...options });
    try {
      return await fn(handle);
    } finally {
      await lifecycle.release(handle, persistence);
    }
  },
};
