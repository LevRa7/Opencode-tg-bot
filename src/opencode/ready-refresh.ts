import { reconcileStoredModelSelection } from "../model/manager.js";
import { warmupSessionDirectoryCache } from "../session/cache-manager.js";
import { logger } from "../utils/logger.js";
import { opencodeClient } from "./client.js";
import { opencodeReadyLifecycle } from "./ready-lifecycle.js";

let readyRefreshRegistered = false;
const HEALTH_CHECK_TIMEOUT_MS = 3000;
const HEALTH_CHECK_TIMED_OUT = Symbol("health-check-timed-out");

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
): Promise<T | typeof HEALTH_CHECK_TIMED_OUT> {
  let timeout: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<typeof HEALTH_CHECK_TIMED_OUT>((resolve) => {
        timeout = setTimeout(() => resolve(HEALTH_CHECK_TIMED_OUT), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function isOpencodeServerHealthy(): Promise<boolean> {
  try {
    const result = await withTimeout(opencodeClient.global.health(), HEALTH_CHECK_TIMEOUT_MS);
    if (result === HEALTH_CHECK_TIMED_OUT) {
      return false;
    }

    const { data, error } = result;
    return !error && data?.healthy === true;
  } catch {
    return false;
  }
}

export async function refreshSessionCacheAfterOpencodeReady(reason: string): Promise<void> {
  try {
    await warmupSessionDirectoryCache();
    logger.debug(`[OpenCodeReady] Session cache refreshed: reason=${reason}`);
  } catch (error) {
    logger.warn(`[OpenCodeReady] Failed to refresh session cache: reason=${reason}`, error);
  }

  try {
    await reconcileStoredModelSelection({ forceCatalogRefresh: true });
    logger.debug(`[OpenCodeReady] Model catalog refreshed: reason=${reason}`);
  } catch (error) {
    logger.warn(`[OpenCodeReady] Failed to refresh model catalog: reason=${reason}`, error);
  }
}

export async function refreshSessionCacheIfOpencodeReady(reason: string): Promise<boolean> {
  if (!(await isOpencodeServerHealthy())) {
    opencodeReadyLifecycle.notifyUnavailable(reason);
    logger.warn(
      `[OpenCodeReady] OpenCode server is not running; skipping session cache refresh: reason=${reason}`,
    );
    return false;
  }

  await refreshSessionCacheAfterOpencodeReady(reason);
  return true;
}

export function registerOpenCodeReadyRefreshHandler(): void {
  if (readyRefreshRegistered) {
    return;
  }

  readyRefreshRegistered = true;
  opencodeReadyLifecycle.onReady((reason) => refreshSessionCacheAfterOpencodeReady(reason));
}

export async function notifyOpencodeReadyIfHealthy(reason: string): Promise<boolean> {
  if (!(await isOpencodeServerHealthy())) {
    opencodeReadyLifecycle.notifyUnavailable(reason);
    logger.warn(`[OpenCodeReady] OpenCode server is not running: reason=${reason}`);
    return false;
  }

  return opencodeReadyLifecycle.notifyReady(reason);
}
