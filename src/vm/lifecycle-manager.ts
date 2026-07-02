import { randomUUID } from "node:crypto";
import { logger } from "../utils/logger.js";
import { type VmHandle, type VmSpec, type VmOperationResult, type VmInfo, type VmSpecTier, VM_TIERS } from "./types.js";
import type { VmStatePersistence, VmStateRecord } from "./state-persistence.js";
import type { HealthProxy, HealthStatus } from "./health-proxy.js";
import { fireVmAlarmBg } from "./alarm.js";
import type { VmManager } from "./manager.js";
import { setVmRuntimeInfo, clearVmRuntimeInfo } from "../settings/manager.js";

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
  /** Abort all in-flight health checks. Call during shutdown. */
  shutdown(): void;
}

export interface LifecycleDeps {
  vmManager: VmManager;
  healthProxy: HealthProxy;
}

export function createVmLifecycleManager(deps: LifecycleDeps): VmLifecycleManager {
  const { vmManager: vm, healthProxy: hp } = deps;
  let shutdownController: AbortController | null = null;

  async function acquire(
    userId: number,
    persistence: VmStatePersistence,
    options?: AcquireOptions,
  ): Promise<VmHandle> {
    // Create a fresh AbortController for this acquire call so health checks
    // can be cancelled during shutdown.
    shutdownController = new AbortController();
    const signal = shutdownController.signal;

    const existing = persistence.getByUserId(userId);

    if (existing && existing.status !== "destroyed" && existing.status !== "degraded") {
      const handle = await vm.attach(existing);
      if (handle) {
        const healthy = await hp.check(handle, {
          timeoutMs: options?.timeoutMs ?? 60_000,
          pollMs: options?.pollMs ?? 2000,
          signal,
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
        // (2026-07-02): NEVER destroy existing user VM — fire alarm instead.
        // User data on the VM must be preserved. Admin can decide to recreate.
        fireVmAlarmBg({
          severity: "WARN",
          userId,
          domainName: existing.domainName,
          reason: `Existing VM is unhealthy (health check failed). Would have destroyed. User data preserved.`,
          blockedAction: `destroyHandle() → virsh destroy ${existing.domainName} + undefine + unlink qcow2`,
          caller: "acquire (existing unhealthy)",
          source: "lifecycle-manager.ts:75",
          timestamp: new Date().toISOString(),
        });
        throw new Error(`Existing VM for userId=${userId} is unhealthy. Admin notified.`);
      } else {
        // VM domain exists but is not running (e.g. host reboot, libvirt restart).
        // Try to start it in-place before destroying — preserves user sessions.
        const started = await vm.startDomain(userId);
        if (started) {
          const handle = await vm.attach(existing);
          if (handle) {
            const healthy = await hp.check(handle, {
              timeoutMs: options?.timeoutMs ?? 60_000,
              pollMs: options?.pollMs ?? 2000,
              signal,
            });
            if (healthy.healthy) {
              persistence.updateIfCurrent(existing.vmId, existing.version, { status: "healthy" });
              persistence.resetFailureCount(existing.vmId);
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
            // Started but unhealthy — fire alarm, do NOT destroy
            fireVmAlarmBg({
              severity: "WARN",
              userId,
              domainName: existing.domainName,
              reason: `VM started but health check failed after start. Would have destroyed. User data preserved.`,
              blockedAction: `destroyHandle() → virsh destroy ${existing.domainName} + undefine + unlink qcow2`,
              caller: "acquire (started but unhealthy)",
              source: "lifecycle-manager.ts:119",
              timestamp: new Date().toISOString(),
            });
            throw new Error(`VM for userId=${userId} started but is unhealthy. Admin notified.`);
          }
        }
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
      signal,
    });

    if (!healthy.healthy) {
      // (2026-07-02): Health timeout on NEWLY CREATED VM — this VM just started,
      // no user data on it yet. Safe to clean up, but still fire alarm for audit.
      const domainName = handle.domainName || record.domainName;
      fireVmAlarmBg({
        severity: "WARN",
        userId,
        domainName,
        reason: `Newly provisioned VM did not become healthy within timeout. Cleaned up (no user data lost — VM was freshly created).`,
        blockedAction: `destroyHandle() on freshly created VM ${domainName}`,
        caller: "acquire (health timeout rollback)",
        source: "lifecycle-manager.ts:203",
        timestamp: new Date().toISOString(),
      });
      await vm.destroyHandle(handle).catch(() => {});
      persistence.markDestroyed(record.vmId);
      // Fix (2026-07-01): clear vm_runtimes on rollback so stale routing info
      // doesn't survive the destroyed VM. Without this, getCurrentOpencodeRoute()
      // returns the dead VM's URL (from vm_runtimes) while vm_states shows "destroyed" —
      // dual-write inconsistency from Hermes memory module port lacking atomicity.
      clearVmRuntimeInfo(userId);
      throw new Error(`VM at ${handle.baseUrl} did not become healthy within timeout`);
    }

    persistence.updateIfCurrent(record.vmId, savedVersion, { status: "healthy" });
    return handle;
  }

  async function release(handle: VmHandle, persistence: VmStatePersistence): Promise<VmOperationResult> {
    // (2026-07-02): NEVER destroy user VM on release.
    // Release is called after orchestrator parallel tasks — the VM should remain
    // running for the user. Fire an INFO alarm for audit trail.
    fireVmAlarmBg({
      severity: "INFO",
      userId: handle.userId,
      domainName: handle.domainName,
      reason: `release() called — VM preserved (would have destroyed before 2026-07-02).`,
      blockedAction: `destroyHandle() → virsh destroy ${handle.domainName} + undefine + unlink qcow2`,
      caller: "release",
      source: "lifecycle-manager.ts:231",
      timestamp: new Date().toISOString(),
    });
    logger.info("[Lifecycle] Released VM %s for userId=%d (preserved, no destruction)", handle.vmId, handle.userId);
    return { success: true };
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
      // (2026-07-02): VM domain not found in libvirt — fire alarm, do NOT auto-recreate.
      // Auto-recreation via tryAutoRecreate → acquire → createAndStart would
      // overwrite the user's data disk. Admin must decide.
      fireVmAlarmBg({
        severity: "CRITICAL",
        userId,
        domainName: record.domainName,
        reason: `VM domain not found in libvirt (virsh attach returned null). Auto-recreation BLOCKED to protect user data.`,
        blockedAction: `tryAutoRecreate → createAndStart (would overwrite qcow2)`,
        caller: "recover (domain not found)",
        source: "lifecycle-manager.ts:287",
        timestamp: new Date().toISOString(),
      });
      persistence.markDestroyed(record.vmId);
      return;
    }

    const healthy = await hp.check(handle, { timeoutMs: 30_000, pollMs: 2000 });
    if (!healthy.healthy) {
      persistence.incrementFailureCount(record.vmId);
      const updated = persistence.getByUserId(userId);
      // (2026-07-02): NEVER destroy unhealthy VM — fire alarm.
      // User data must be preserved. Admin can decide to recreate.
      fireVmAlarmBg({
        severity: updated?.status === "degraded" ? "DEGRADED" : "WARN",
        userId,
        domainName: record.domainName,
        reason: `VM unhealthy in recovery cycle (failures=${updated?.failureCount ?? record.failureCount}). Would have destroyed. User data preserved.`,
        blockedAction: `destroyHandle() → virsh destroy ${record.domainName} + undefine + unlink qcow2`,
        caller: "recover (unhealthy)",
        source: "lifecycle-manager.ts:295",
        timestamp: new Date().toISOString(),
      });

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

      // (2026-07-02): Non-degraded but unhealthy — mark as destroyed, do NOT auto-recreate.
      // Admin alarm already fired above.
      persistence.markDestroyed(record.vmId);
      return;
    }

    persistence.updateIfCurrent(record.vmId, record.version, { status: "healthy" });
    persistence.resetFailureCount(record.vmId);

    // Fix (2026-07-01): recover() must populate vm_runtimes so getCurrentOpencodeRoute()
    // returns the correct VM URL. Without this, a healthy recovered VM has vm_states.status
    // = "healthy" but vm_runtimes may be empty/stale — routing falls to vm-pending (host
    // server), host models differ from VM models → "models unavailable" for the user.
    setVmRuntimeInfo(userId, {
      userId,
      tier: record.specTier as VmSpec["tier"],
      domainName: record.domainName,
      qcow2Path: "",
      cloudInitIsoPath: "",
      bridgeIp: record.assignedIpv4,
      baseUrl: `http://${record.assignedIpv4}:4096`,
      startTime: record.createdAt,
      pid: null,
      sudoPassword: record.passwordHash,
      serverPassword: handle.password,
      ipv6: "",
    });
  }

  return { acquire, release, recover, shutdown() { shutdownController?.abort(); } };
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
