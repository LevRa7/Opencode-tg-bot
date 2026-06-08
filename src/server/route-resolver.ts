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
      return {
        baseUrl: `http://127.0.0.1:${localPort}`,
        password: getOrCreateServerPassword(userId),
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

  return null;
}
