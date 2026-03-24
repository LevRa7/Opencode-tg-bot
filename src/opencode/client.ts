import { createOpencodeClient } from "@opencode-ai/sdk/v2";
import { config } from "../config.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";

const getAuth = () => {
  if (!config.opencode.password) {
    return undefined;
  }
  const credentials = `${config.opencode.username}:${config.opencode.password}`;
  return `Basic ${Buffer.from(credentials).toString("base64")}`;
};

export type OpencodeClient = ReturnType<typeof createOpencodeClient>;

const clientRegistry = new Map<string, OpencodeClient>();

function createClient(): OpencodeClient {
  return createOpencodeClient({
    baseUrl: config.opencode.apiUrl,
    headers: config.opencode.password ? { Authorization: getAuth() } : undefined,
  });
}

export function getOpencodeClient(): OpencodeClient {
  const scopeKey = resolveTelegramConversationScopeKey();
  const existingClient = clientRegistry.get(scopeKey);
  if (existingClient) {
    return existingClient;
  }

  const client = createClient();
  clientRegistry.set(scopeKey, client);
  return client;
}

export function __resetOpencodeClientRegistryForTests(): void {
  clientRegistry.clear();
}

export const opencodeClient = new Proxy({} as OpencodeClient, {
  get(_target, property, receiver) {
    return Reflect.get(getOpencodeClient(), property, receiver);
  },
});
