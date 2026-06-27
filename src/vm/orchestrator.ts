import { logger } from "../utils/logger.js";
import type { VmHandle, VmSpec } from "./types.js";
import type { VmLifecycleManager } from "./lifecycle-manager.js";
import type { VmStatePersistence } from "./state-persistence.js";

export interface ParallelTask<T = void> {
  userId: number;
  spec: VmSpec;
  fn: (handle: VmHandle) => Promise<T>;
}

export interface VmOrchestrator {
  parallel<T>(persistence: VmStatePersistence, tasks: ParallelTask<T>[], options?: { maxConcurrent?: number }): Promise<T[]>;
  recoverAll(persistence: VmStatePersistence): Promise<void>;
}

export function createVmOrchestrator(lifecycle: VmLifecycleManager): VmOrchestrator {
  const MAX_CONCURRENT = 4;

  async function parallel<T>(
    persistence: VmStatePersistence,
    tasks: ParallelTask<T>[],
    options?: { maxConcurrent?: number },
  ): Promise<T[]> {
    const limit = options?.maxConcurrent ?? MAX_CONCURRENT;
    const results: T[] = [];
    const errors: Error[] = [];

    for (let i = 0; i < tasks.length; i += limit) {
      const batch = tasks.slice(i, i + limit);
      const batchResults = await Promise.allSettled(
        batch.map(async (task) => {
          const handle = await lifecycle.acquire(task.userId, persistence, { spec: task.spec });
          try {
            return await task.fn(handle);
          } finally {
            await lifecycle.release(handle, persistence);
          }
        }),
      );

      for (const result of batchResults) {
        if (result.status === "fulfilled") {
          results.push(result.value);
        } else {
          errors.push(result.reason as Error);
          logger.error("[Orchestrator] Task failed: %s", result.reason);
        }
      }
    }

    if (errors.length > 0 && results.length === 0) {
      throw new Error(`All ${errors.length} tasks failed: ${errors[0].message}`);
    }

    return results;
  }

  async function recoverAll(persistence: VmStatePersistence): Promise<void> {
    const active = persistence.listActive();
    const destroyed = persistence.listDestroyed();
    const degraded = persistence.listDegraded();

    const allToProcess = [...active, ...destroyed];
    logger.info("[Orchestrator] Recovering %d active, %d destroyed, %d degraded VMs",
      active.length, destroyed.length, degraded.length);

    const recovered: number[] = [];
    const failed: number[] = [];

    for (const record of allToProcess) {
      try {
        await lifecycle.recover(record.userId, persistence);
        recovered.push(record.userId);
      } catch (err) {
        failed.push(record.userId);
        logger.error("[Orchestrator] Recovery failed for userId=%d: %s", record.userId, err);
      }
    }

    if (recovered.length > 0) {
      logger.info("[Orchestrator] Recovered VMs: %s", recovered.join(", "));
    }
    if (failed.length > 0) {
      logger.warn("[Orchestrator] Failed to recover VMs: %s", failed.join(", "));
    }
    if (degraded.length > 0) {
      logger.warn("[Orchestrator] %d VMs in degraded state (skipped): %s",
        degraded.length,
        degraded.map(r => r.userId).join(", "));
    }
  }

  return { parallel, recoverAll };
}

export const VmOrchestration = {
  async runAll<T>(
    orchestrator: VmOrchestrator,
    persistence: VmStatePersistence,
    tasks: ParallelTask<T>[],
    options?: { maxConcurrent?: number },
  ): Promise<T[]> {
    return orchestrator.parallel(persistence, tasks, options);
  },
};
