import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";
import { processManager } from "../process/manager.js";
import { getOrCreateServerPassword, getTenantRuntimeInfo, getUserDeployTarget, getVmRuntimeInfo } from "../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../telegram/scope.js";
import { logger } from "../utils/logger.js";
import { sshManager } from "../utils/ssh-manager.js";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

type OpencodeRoute = {
  runtimeKey: string;
  baseUrl: string;
  kind: "host" | "tenant" | "vm";
  userId?: number;
  chatId?: number;
  tenantId?: string;
  password?: string;
};

const clientCache = new Map<string, OpencodeClient>();

function getClientForBaseUrl(baseUrl: string, password?: string): OpencodeClient {
  const cacheKey = password ? `${baseUrl}::${password}` : baseUrl;
  const cachedClient = clientCache.get(cacheKey);
  if (cachedClient) {
    return cachedClient;
  }

  logger.debug(`[Client] Creating client for ${baseUrl}, pw=${password ? "SET" : "NONE"}`);

  const client = createOpencodeClient({
    baseUrl,
    headers: password
      ? { Authorization: `Basic ${Buffer.from(`${config.opencode.username || "opencode"}:${password}`).toString("base64")}` }
      : undefined,
  });
  clientCache.set(cacheKey, client);
  return client;
}

export function getHostOpencodeClient(): OpencodeClient {
  const adminId = config.telegram.adminUserId;
  return getClientForBaseUrl(config.opencode.apiUrl, adminId ? getOrCreateServerPassword(adminId, config.opencode.password) : undefined);
}

function getCurrentScopeUserId(): number | null {
  return getCurrentTelegramConversationScope()?.userId ?? null;
}

export async function ensureCurrentOpencodeRouteReady(): Promise<void> {
  const userId = getCurrentScopeUserId();
  if (userId === null) return;

  // SSH takes priority — verify the tunnel is actually healthy
  if (sshManager.isSshActive(userId)) {
    // Skip health check while bootstrap is in progress — the remote server
    // hasn't started yet, so the tunnel would appear unhealthy and trigger
    // an unnecessary auto-disconnect mid-bootstrap.
    if (sshManager.isBootstrapInProgress(userId)) {
      return;
    }
    const healthy = await sshManager.isTunnelHealthy(userId);
    if (!healthy) {
      logger.warn(`[OpenCodeClient] SSH tunnel unhealthy for user ${userId}, auto-disconnecting`);
      await sshManager.disconnect(userId).catch(() => {});
      // Fall through to local / tenant logic below
    } else {
      return;
    }
  }

  // VM path: ensure VM runtime is ready
  const scope = getCurrentTelegramConversationScope();
  if (scope) {
    const deployTarget = getUserDeployTarget(scope.userId);
    if (deployTarget === "vm") {
      const result = await processManager.ensureRuntime();
      if (!result.success) {
        if (result.needsVmSpec) {
          throw new NeedsDeployTargetError("vm_spec_required", scope.userId);
        }
        throw new Error(result.error || `Failed to init VM runtime for userId=${scope.userId}`);
      }
      return;
    }
  }

  // Admin users use the host server directly
  if (userId === config.telegram.adminUserId) return;

  const result = await processManager.ensureRuntime();
  if (!result.success) {
    throw new Error(result.error || `Failed to initialize tenant runtime for userId=${userId}`);
  }
}

export function getCurrentOpencodeRoute(preCapturedScope?: ReturnType<typeof getCurrentTelegramConversationScope>): OpencodeRoute {
  const scope = preCapturedScope ?? getCurrentTelegramConversationScope();

  // SSH always takes top priority — even for admin users
  if (scope && sshManager.isSshActive(scope.userId)) {
    const localPort = sshManager.getLocalPort(scope.userId);
    if (localPort) {
      const conn = sshManager.getActiveConnection(scope.userId);
      logger.debug(`[Route] SSH route: password=${conn?.opencodePassword ? "SET" : "UNDEFINED"}`);
      return {
        runtimeKey: `ssh:${scope.userId}`,
        baseUrl: `http://127.0.0.1:${localPort}`,
        kind: "tenant",
        password: conn?.opencodePassword,
        userId: scope.userId,
        chatId: scope.chatId,
        tenantId: `ssh-${scope.userId}`,
      };
    }
  }

  // VM tenant — bridge IP based route
  if (scope) {
    const deployTarget = getUserDeployTarget(scope.userId);
    if (deployTarget === "vm") {
      const vmInfo = getVmRuntimeInfo(scope.userId);
      const vmPassword = getOrCreateServerPassword(scope.userId);
      if (!vmInfo) {
        return {
          runtimeKey: `vm-pending:${scope.userId}`,
          baseUrl: config.opencode.apiUrl,
          kind: "vm",
          userId: scope.userId,
          chatId: scope.chatId,
          tenantId: `vm-${scope.userId}`,
          password: vmPassword,
        };
      }
      return {
        runtimeKey: `vm:${scope.userId}:${vmInfo.domainName}`,
        baseUrl: vmInfo.baseUrl,
        kind: "vm",
        userId: vmInfo.userId,
        chatId: scope.chatId,
        tenantId: vmInfo.domainName,
        password: vmPassword,
      };
    }
  }

  // Admin users (without SSH) use the host server
  if (!scope || scope.userId === config.telegram.adminUserId) {
    const adminId = config.telegram.adminUserId;
    return {
      runtimeKey: "host",
      baseUrl: config.opencode.apiUrl,
      kind: "host",
      password: adminId ? getOrCreateServerPassword(adminId, config.opencode.password) : undefined,
    };
  }

  const tenantRuntime = getTenantRuntimeInfo(scope.userId);
  const tenantPassword = getOrCreateServerPassword(scope.userId);
  if (!tenantRuntime) {
    return {
      runtimeKey: `tenant-pending:${scope.userId}`,
      baseUrl: config.opencode.apiUrl,
      kind: "tenant",
      userId: scope.userId,
      chatId: scope.chatId,
      tenantId: `tg-${scope.userId}`,
      password: tenantPassword,
    };
  }

  return {
    runtimeKey: `tenant:${scope.userId}:${tenantRuntime.tenantId}`,
    baseUrl: tenantRuntime.baseUrl,
    kind: "tenant",
    userId: tenantRuntime.userId,
    chatId: tenantRuntime.chatId,
    tenantId: tenantRuntime.tenantId,
    password: tenantPassword,
  };
}

export function getCurrentOpencodeRuntimeKey(): string {
  return getCurrentOpencodeRoute().runtimeKey;
}

export function getOpencodeClientForCurrentScope(): OpencodeClient {
  const route = getCurrentOpencodeRoute();
  return getClientForBaseUrl(route.baseUrl, route.password);
}

export function __resetOpencodeClientRegistryForTests(): void {
  clientCache.clear();
}

function resolvePath(target: unknown, path: PropertyKey[]): unknown {
  let current = target;
  for (const segment of path) {
    if (current === null || current === undefined) {
      return undefined;
    }
    current = Reflect.get(current as object, segment);
  }
  return current;
}

export class NeedsDeployTargetError extends Error {
  constructor(
    public code: string,
    public userId: number,
  ) {
    super(code);
    this.name = "NeedsDeployTargetError";
  }
}

function createClientProxy(path: PropertyKey[] = []): unknown {
  const callableTarget = function opencodeClientProxy() {
    return undefined;
  };

  return new Proxy(callableTarget, {
    get(_target, property) {
      if (property === "then") {
        return undefined;
      }
      return createClientProxy([...path, property]);
    },
    async apply(_target, _thisArg, argArray) {
      // Capture scope before ensureRuntime() — the AsyncLocalStorage
      // context may be lost after synchronous child_process operations
      // inside ensureVmRuntime, causing scope to be null afterward.
      const scope = getCurrentTelegramConversationScope();
      await ensureCurrentOpencodeRouteReady();
      const route = getCurrentOpencodeRoute(scope ?? undefined);
      const client = getClientForBaseUrl(route.baseUrl, route.password);
      const fn = resolvePath(client, path);
      const receiver = resolvePath(client, path.slice(0, -1));

      if (typeof fn !== "function") {
        throw new Error(`OpenCode client member is not callable: ${path.join(".")}`);
      }

      return Reflect.apply(fn, receiver, argArray);
    },
  });
}

export const opencodeClient = createClientProxy() as OpencodeClient;
