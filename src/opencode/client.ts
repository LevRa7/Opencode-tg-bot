import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";
import { processManager } from "../process/manager.js";
import { getTenantRuntimeInfo } from "../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../telegram/scope.js";

type OpencodeClient = ReturnType<typeof createOpencodeClient>;

type OpencodeRoute = {
  runtimeKey: string;
  baseUrl: string;
  kind: "host" | "tenant";
  userId?: number;
  chatId?: number;
  tenantId?: string;
};

const clientCache = new Map<string, OpencodeClient>();

function getAuthHeader(): string | undefined {
  if (!config.opencode.password) {
    return undefined;
  }

  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
}

function getClientForBaseUrl(baseUrl: string): OpencodeClient {
  const cachedClient = clientCache.get(baseUrl);
  if (cachedClient) {
    return cachedClient;
  }

  const client = createOpencodeClient({
    baseUrl,
    headers: config.opencode.password ? { Authorization: getAuthHeader() } : undefined,
  });
  clientCache.set(baseUrl, client);
  return client;
}

export function getHostOpencodeClient(): OpencodeClient {
  return getClientForBaseUrl(config.opencode.apiUrl);
}

function getCurrentScopeUserId(): number | null {
  return getCurrentTelegramConversationScope()?.userId ?? null;
}

export async function ensureCurrentOpencodeRouteReady(): Promise<void> {
  const userId = getCurrentScopeUserId();
  if (userId === null || userId === config.telegram.adminUserId) {
    return;
  }

  const result = await processManager.ensureRuntime();
  if (!result.success) {
    throw new Error(result.error || `Failed to initialize tenant runtime for userId=${userId}`);
  }
}

export function getCurrentOpencodeRoute(): OpencodeRoute {
  const scope = getCurrentTelegramConversationScope();
  if (!scope || scope.userId === config.telegram.adminUserId) {
    return {
      runtimeKey: "host",
      baseUrl: config.opencode.apiUrl,
      kind: "host",
    };
  }

  const tenantRuntime = getTenantRuntimeInfo(scope.userId);
  if (!tenantRuntime) {
    return {
      runtimeKey: `tenant-pending:${scope.userId}`,
      baseUrl: config.opencode.apiUrl,
      kind: "tenant",
      userId: scope.userId,
      chatId: scope.chatId,
      tenantId: `tg-${scope.userId}`,
    };
  }

  return {
    runtimeKey: `tenant:${scope.userId}:${tenantRuntime.tenantId}`,
    baseUrl: tenantRuntime.baseUrl,
    kind: "tenant",
    userId: tenantRuntime.userId,
    chatId: tenantRuntime.chatId,
    tenantId: tenantRuntime.tenantId,
  };
}

export function getCurrentOpencodeRuntimeKey(): string {
  return getCurrentOpencodeRoute().runtimeKey;
}

export function getOpencodeClientForCurrentScope(): OpencodeClient {
  return getClientForBaseUrl(getCurrentOpencodeRoute().baseUrl);
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
      await ensureCurrentOpencodeRouteReady();
      const route = getCurrentOpencodeRoute();
      const client = getClientForBaseUrl(route.baseUrl);
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
