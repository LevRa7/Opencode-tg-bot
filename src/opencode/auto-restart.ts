import { logger } from "../utils/logger.js";
import type { ProcessOperationResult } from "../process/types.js";

export interface OpenCodeAutoRestartMonitorDependencies {
  enabled: boolean;
  intervalMs: number;
  isRuntimeAvailable: () => Promise<boolean>;
  start: () => Promise<ProcessOperationResult>;
}

export interface OpenCodeAutoRestartMonitor {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
}

export function createOpenCodeAutoRestartMonitor(
  dependencies: OpenCodeAutoRestartMonitorDependencies,
): OpenCodeAutoRestartMonitor {
  let timer: ReturnType<typeof setInterval> | null = null;
  let activeCheck: Promise<void> | null = null;

  const runCheck = async (): Promise<void> => {
    if (!dependencies.enabled) {
      return;
    }

    const runtimeAvailable = await dependencies.isRuntimeAvailable();
    if (runtimeAvailable) {
      return;
    }

    logger.info("[OpenCodeAutoRestart] Runtime unavailable, attempting restart...");
    const startResult = await dependencies.start();

    if (!startResult.success) {
      logger.warn(`[OpenCodeAutoRestart] Restart attempt failed: ${startResult.error}`);
      return;
    }

    logger.info("[OpenCodeAutoRestart] Runtime restarted successfully");
  };

  const checkNow = async (): Promise<void> => {
    if (!dependencies.enabled) {
      return;
    }

    if (!activeCheck) {
      activeCheck = runCheck().finally(() => {
        activeCheck = null;
      });
    }

    await activeCheck;
  };

  return {
    start(): void {
      if (!dependencies.enabled || timer) {
        return;
      }

      // The host app owns this monitor, so these admin-scoped callbacks only manage the host runtime.
      timer = setInterval(() => {
        void checkNow();
      }, dependencies.intervalMs);
      timer.unref?.();
    },
    stop(): void {
      if (!timer) {
        return;
      }

      clearInterval(timer);
      timer = null;
    },
    checkNow,
  };
}
