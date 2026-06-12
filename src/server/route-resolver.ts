import { config } from "../config.js";
import { getOrCreateServerPassword, getTenantRuntimeInfo } from "../settings/manager.js";
import { sshManager } from "../utils/ssh-manager.js";

export interface OpencodeRoute {
  baseUrl: string;
  password?: string;
  kind: "host" | "tenant" | "ssh-host" | "ssh-docker";
}

export function resolveOpencodeRouteForUser(userId: number): OpencodeRoute | null {
  if (sshManager.isSshActive(userId)) {
    const localPort = sshManager.getLocalPort(userId);
    if (localPort) {
      const conn = sshManager.getActiveConnection(userId);
      const deployTarget = conn?.deployTarget ?? "host";
      const password = conn?.opencodePassword ?? getOrCreateServerPassword(userId);
      return {
        baseUrl: `http://127.0.0.1:${localPort}`,
        password,
        kind: deployTarget === "docker" ? "ssh-docker" : "ssh-host",
      };
    }
  }

  if (userId === config.telegram.adminUserId) {
    return {
      baseUrl: config.opencode.apiUrl,
      password: getOrCreateServerPassword(userId, config.opencode.password),
      kind: "host",
    };
  }

  const tenantRuntime = getTenantRuntimeInfo(userId);
  if (tenantRuntime) {
    return {
      baseUrl: tenantRuntime.baseUrl,
      password: getOrCreateServerPassword(userId),
      kind: "tenant",
    };
  }

  // For non-admin users without a tenant runtime, fall back to the
  // host OpenCode server.  This mirrors getCurrentOpencodeRoute() in
  // src/opencode/client.ts, which returns a "pending" route for such
  // users so the bot can bootstrap a tenant runtime on the first API
  // call.  The MiniApp web panel needs the same fallback.
  // Use the admin password for the host server; per-user isolation
  // is provided by the session directory, not by server passwords.
  if (userId !== config.telegram.adminUserId) {
    return {
      baseUrl: config.opencode.apiUrl,
      password: getOrCreateServerPassword(config.telegram.adminUserId, config.opencode.password),
      kind: "tenant",
    };
  }

  return null;
}
