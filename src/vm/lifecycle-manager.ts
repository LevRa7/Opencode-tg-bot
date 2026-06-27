import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { type VmHandle, type VmSpec, type VmOperationResult, type VmInfo, type VmSpecTier, VM_TIERS } from "./types.js";
import type { VmStatePersistence, VmStateRecord } from "./state-persistence.js";
import type { HealthProxy, HealthStatus } from "./health-proxy.js";
import type { VmManager } from "./manager.js";
import { setVmRuntimeInfo } from "../settings/manager.js";

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
          // Restore routing info from persisted state (survives bot restart)
          setVmRuntimeInfo(userId, {
            userId,
            tier: existing.specTier as VmSpec["tier"],
            domainName: existing.domainName,
            qcow2Path: "",
            cloudInitIsoPath: "",
            bridgeIp: existing.assignedIpv4,
            baseUrl: `http://${existing.assignedIpv4}:4096`,
            startTime: existing.createdAt,
            pid: null,
            sudoPassword: existing.passwordHash,
            serverPassword: handle.password,
            ipv6: "",
          });
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
    // Fix (2026-06-24): clear any leftover row for this user before inserting the fresh record.
    // markDestroyed()/release()/health-timeout rollback only set status='destroyed' but keep the
    // row, and acquire() always generates a new randomUUID() vm_id. save()'s upsert only resolves
    // ON CONFLICT(vm_id), so a new vm_id never matched the stale row and the INSERT violated
    // UNIQUE(user_id) ("UNIQUE constraint failed: vm_states.user_id"), aborting every re-deploy.
    // deleteByUserId is idempotent (no-op when absent) and keeps record.vmId authoritative for the
    // subsequent updateIfCurrent() calls below.
    persistence.deleteByUserId(userId);
    persistence.save(record);

    const handle: VmHandle = {
      vmId: record.vmId,
      userId,
      domainName: vmInfo.domainName,
      ipv4: vmInfo.bridgeIp ?? "",
      mac: "",
      baseUrl: vmInfo.baseUrl,
      password: vmInfo.serverPassword ?? vmInfo.sudoPassword ?? "",
      specTier: spec.tier,
    };

    // Persist VM routing info so getCurrentOpencodeRoute() returns the VM URL,
    // not the fallback vm-pending route (config.opencode.apiUrl = host server).
    setVmRuntimeInfo(userId, vmInfo);

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

  // (2026-06-26): after marking a VM as destroyed/dead, auto-recreate it via acquire()
  // to close the gap where a destroyed VM would stay dead until the user sends
  // another message. Degraded VMs (failureCount ≥ 5) are NOT auto-recreated —
  // they require manual intervention.
  async function tryAutoRecreate(userId: number, record: VmStateRecord, persistence: VmStatePersistence): Promise<void> {
    const spec = VM_TIERS[record.specTier as VmSpecTier];
    if (!spec) {
      logger.error("[Lifecycle] Unknown spec tier %s for userId=%d, cannot auto-recreate", record.specTier, userId);
      return;
    }
    try {
      logger.info("[Lifecycle] Auto-recreating VM for userId=%d (tier=%s)", userId, spec.tier);
      await acquire(userId, persistence, { spec, timeoutMs: 300_000 });
      logger.info("[Lifecycle] Auto-recreation succeeded for userId=%d", userId);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error("[Lifecycle] Auto-recreation failed for userId=%d: %s", userId, msg);
    }
  }

  async function recover(userId: number, persistence: VmStatePersistence): Promise<void> {
    const record = persistence.getByUserId(userId);
    if (!record) return;
    // (2026-06-26): removed "status === destroyed" skip. Destroyed VMs (from previous
    // health-timeout rollbacks) are now auto-recreated via acquire() instead of being
    // skipped forever. vm.attach() will return null for destroyed VMs (domain doesn't
    // exist), which triggers the same auto-recreation path as dead VMs.
    // Fix (2026-06-25): skip VMs still provisioning — cloud-init can take 2-3 min
    // and the initial acquire() health check already runs in parallel with a 5-min timeout.
    // Recovering a provisioning VM with a 30s health check would race with acquire()
    // and destroy the VM before cloud-init finishes.
    if (record.status === "provisioning") return;
    if (record.status === "degraded") {
      logger.warn("[Lifecycle] Recovery skipped: VM %s is degraded (failures=%d)", userId, record.failureCount);
      return;
    }

    const handle = await vm.attach(record);
    if (!handle) {
      logger.warn("[Lifecycle] Recovery: VM %s not running, marking destroyed", userId);
      persistence.markDestroyed(record.vmId);
      await tryAutoRecreate(userId, record, persistence);
      return;
    }

    const healthy = await hp.check(handle, { timeoutMs: 30_000, pollMs: 2000 });
    if (!healthy.healthy) {
      persistence.incrementFailureCount(record.vmId);
      const updated = persistence.getByUserId(userId);
      logger.warn("[Lifecycle] Recovery: VM %s unhealthy, destroying", userId);
      await vm.destroyHandle(handle).catch(() => {});

      // incrementFailureCount already promotes status to "degraded" when
      // failure_count reaches MAX_RETRIES (5). Keep that status — do not
      // overwrite with markDestroyed or auto-recreate.
      if (updated && updated.status === "degraded") {
        logger.error(
          "[Lifecycle] VM %s reached failure threshold (%d), degraded — manual intervention required",
          userId,
          updated.failureCount,
        );
        return;
      }

      persistence.markDestroyed(record.vmId);
      await tryAutoRecreate(userId, record, persistence);
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
