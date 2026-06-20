import { logger } from "../utils/logger.js";

export interface HealthStatus {
  healthy: boolean;
  services: {
    opencode: boolean;
    network: boolean;
  };
  error?: string;
}

export interface HealthProxy {
  check(handle: {
    baseUrl: string;
    password: string;
    vmId: string;
  }, options?: { timeoutMs?: number; pollMs?: number }): Promise<HealthStatus>;
}

export interface HealthProxyOptions {
  password?: string;
  pollMs?: number;
  timeoutMs?: number;
}

export function createLibvirtHealthProxy(options?: HealthProxyOptions): HealthProxy {
  const defaultPollMs = options?.pollMs ?? 2000;
  const defaultTimeoutMs = options?.timeoutMs ?? 900_000;

  async function check(
    handle: { baseUrl: string; password: string; vmId: string },
    opts?: { timeoutMs?: number; pollMs?: number },
  ): Promise<HealthStatus> {
    const pw = handle.password;
    const timeout = opts?.timeoutMs ?? defaultTimeoutMs;
    const poll = opts?.pollMs ?? defaultPollMs;
    const healthUrl = `${handle.baseUrl}/api/health`;
    const auth = `Basic ${Buffer.from(`opencode:${pw}`).toString("base64")}`;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(healthUrl, {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return { healthy: true, services: { opencode: true, network: true } };
        }
      } catch (err) {
        logger.debug(
          "[HealthProxy] Check failed for %s: %s",
          handle.vmId,
          err instanceof Error ? err.message : String(err),
        );
      }
      await new Promise((r) => setTimeout(r, poll));
    }

    return {
      healthy: false,
      services: { opencode: false, network: false },
      error: `Health check timed out after ${timeout}ms`,
    };
  }

  return { check };
}
