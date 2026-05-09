import type { GetAuth, PluginContext, PluginResult } from "./types.js";
import type { Config } from "@opencode-ai/sdk";
import { readFileSync } from "node:fs";
import { homedir } from "node:os";

const CLIPROXY_PROVIDER_ID = "cliproxyapi";

// Default endpoint and API key for all users
const DEFAULT_ENDPOINT = "http://192.168.2.211:8317/v1";
const DEFAULT_API_KEY = "sk-z705gVI3NrXpmPo8J8YK04E1SKM9rLBY";

// Stored auth shape used by the plugin
interface CliProxyApiStoredAuth {
  type: "api";
  endpoint: string;
  apiKey: string;
}

// Local Model type matching @opencode-ai/sdk's v1 Model shape
interface CtxModel {
  id: string;
  providerID: string;
  api: {
    id: string;
    url: string;
    npm: string;
  };
  name: string;
  capabilities: {
    temperature: boolean;
    reasoning: boolean;
    attachment: boolean;
    toolcall: boolean;
    input: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
    output: {
      text: boolean;
      audio: boolean;
      image: boolean;
      video: boolean;
      pdf: boolean;
    };
  };
  cost: {
    input: number;
    output: number;
    cache: {
      read: number;
      write: number;
    };
  };
  limit: {
    context: number;
    output: number;
  };
  status: "alpha" | "beta" | "deprecated" | "active";
  options: Record<string, unknown>;
  headers: Record<string, string>;
}

// Local Provider type for plugin hooks
interface ProviderCtx {
  id: string;
  options: Record<string, unknown>;
}

type ModelInfo = {
  id?: unknown;
};

type ModelsResponse = {
  data?: ModelInfo[];
};

let latestAuthResolver: GetAuth | undefined;

/**
 * Extract model IDs from API response
 */
function extractModelIds(payload: ModelsResponse): string[] {
  const seen = new Set<string>();

  for (const item of payload.data ?? []) {
    if (typeof item?.id !== "string") continue;
    const id = item.id.trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
  }

  return [...seen];
}

/**
 * Format model ID for display.
 * - If name already looks human-readable (has spaces, mixed case), use as-is
 * - Otherwise, convert kebab-case/snake_case to Title Case while preserving numbers like "2.5"
 */
function titleizeModelId(id: string): string {
  // If name already looks human-readable, use it as-is
  const hasSpaces = /\s/.test(id);
  const hasMixedCase = /[a-z][A-Z]/.test(id);

  if (hasSpaces && hasMixedCase) {
    return id.trim();
  }

  // Handle version numbers like "3.1" -> "3.1", "2.5" -> "2.5"
  return id
    .replace(/[._-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    // Uppercase first letter, but preserve numbers and dots
    .replace(/^[a-z]/, (char) => char.toUpperCase())
    // Uppercase letters after spaces
    .replace(/\s[a-z]/g, (match) => match.toUpperCase());
}

/**
 * Resolve {file:path} token to file contents
 */
function resolveConfigToken(value: string): string {
  const fileMatch = value.match(/^\{file:(.+)\}$/);
  if (!fileMatch) return value;

  const rawPath = fileMatch[1].trim();
  const path = rawPath.startsWith("~/") ? `${homedir()}/${rawPath.slice(2)}` : rawPath;
  return readFileSync(path, "utf8").trim();
}

/**
 * Resolve base URL from provider config OR from stored auth endpoint
 * Falls back to DEFAULT_ENDPOINT
 */
function resolveBaseUrl(provider: ProviderCtx, storedAuth?: CliProxyApiStoredAuth): string {
  const providerAny = provider as unknown as { options?: Record<string, unknown> };
  const configBaseURL = providerAny.options?.baseURL as string | undefined;

  if (storedAuth?.endpoint?.trim()) {
    return storedAuth.endpoint.replace(/\/+$/, "");
  }

  if (typeof configBaseURL === "string" && configBaseURL.trim()) {
    return configBaseURL.replace(/\/+$/, "");
  }

  return DEFAULT_ENDPOINT;
}

/**
 * Resolve API key from provider config OR from stored auth
 * Falls back to DEFAULT_API_KEY
 */
function resolveApiKey(provider: ProviderCtx, storedAuth?: CliProxyApiStoredAuth): string {
  if (storedAuth?.apiKey?.trim()) {
    return resolveConfigToken(storedAuth.apiKey.trim());
  }

  const providerAny = provider as unknown as { options?: Record<string, unknown>; key?: string };
  const optionKey = providerAny.options?.apiKey as string | undefined;
  if (typeof optionKey === "string" && optionKey.trim()) {
    return resolveConfigToken(optionKey.trim());
  }
  if (typeof providerAny.key === "string" && providerAny.key.trim()) {
    return providerAny.key.trim();
  }

  return DEFAULT_API_KEY;
}

/**
 * Auto-configure provider with default credentials
 */
function ensureProviderDefaults(provider: ProviderCtx): void {
  const providerAny = provider as unknown as { options?: Record<string, unknown> };
  if (!providerAny.options) {
    providerAny.options = {};
  }
  if (!providerAny.options.baseURL) {
    providerAny.options.baseURL = DEFAULT_ENDPOINT;
  }
  if (!providerAny.options.apiKey) {
    providerAny.options.apiKey = DEFAULT_API_KEY;
  }
}

/**
 * Create a model entry from ID
 */
function createModel(provider: ProviderCtx, id: string): CtxModel {
  const baseUrl = resolveBaseUrl(provider);
  return {
    id,
    providerID: provider.id,
    api: {
      id: provider.id,
      url: baseUrl,
      npm: "@ai-sdk/openai-compatible",
    },
    name: titleizeModelId(id),
    capabilities: {
      temperature: true,
      reasoning: false,
      attachment: false,
      toolcall: true,
      input: { text: true, audio: false, image: false, video: false, pdf: false },
      output: { text: true, audio: false, image: false, video: false, pdf: false },
    },
    cost: { input: 0, output: 0, cache: { read: 0, write: 0 } },
    limit: { context: 128000, output: 32768 },
    status: "active",
    options: {},
    headers: {},
  };
}

/**
 * Discover available models from the CliProxyApi endpoint
 */
async function discoverModels(provider: ProviderCtx, storedAuth?: CliProxyApiStoredAuth): Promise<string[]> {
  const baseUrl = resolveBaseUrl(provider, storedAuth);
  const apiKey = resolveApiKey(provider, storedAuth);

  // Determine the models endpoint - prefer /v1/models, fall back to /models
  let modelsEndpoint = `${baseUrl}/v1/models`;
  if (baseUrl.endsWith("/v1") || baseUrl.endsWith("/v1/")) {
    modelsEndpoint = `${baseUrl}/models`;
  }

  const response = await fetch(modelsEndpoint, {
    headers: {
      authorization: `Bearer ${apiKey}`,
      accept: "application/json",
    },
  });

  if (!response.ok) {
    throw new Error(`${CLIPROXY_PROVIDER_ID} model discovery failed with ${response.status}`);
  }

  const payload = (await response.json()) as ModelsResponse;
  const ids = extractModelIds(payload);

  if (ids.length === 0) {
    throw new Error(`${CLIPROXY_PROVIDER_ID} model discovery returned no models`);
  }

  return ids;
}

/**
 * CliProxyApi Plugin for Opencode
 *
 * Provides:
 * - Auto-configuration with default endpoint and API key
 * - Dynamic model discovery from /v1/models endpoint
 */
export const CliProxyApiPlugin = async (
  { client }: PluginContext,
): Promise<PluginResult> => {
  return {
    config: async (config: Config) => {
      config.command = config.command || {};

      // Ensure provider exists
      if (!config.provider) {
        config.provider = {};
      }

      let provider = config.provider[CLIPROXY_PROVIDER_ID] as ProviderCtx | undefined;
      
      // Auto-configure with defaults if provider doesn't exist
      if (!provider) {
        console.log(`[${CLIPROXY_PROVIDER_ID}] Auto-configuring with default endpoint`);
        provider = { id: CLIPROXY_PROVIDER_ID, options: {} };
        config.provider[CLIPROXY_PROVIDER_ID] = provider;
      }

      // Ensure provider has default credentials
      ensureProviderDefaults(provider);

      // Try model discovery using stored auth first, then config fallback
      try {
        const storedAuth = await (async () => {
          try {
            const resolver = latestAuthResolver;
            if (!resolver) return undefined;
            const auth = await resolver();
            if (auth && (auth as CliProxyApiStoredAuth).type === "api" && (auth as CliProxyApiStoredAuth).endpoint) {
              return auth as CliProxyApiStoredAuth;
            }
          } catch { /* no stored auth yet */ }
          return undefined;
        })();

        const modelIds = await discoverModels(provider as unknown as ProviderCtx, storedAuth ?? undefined);
        const models: Record<string, CtxModel> = {};

        for (const id of modelIds) {
          models[id] = createModel(provider as unknown as ProviderCtx, id);
        }

        // Merge with existing models from config
        const existingModels = (provider as unknown as { models?: Record<string, CtxModel> }).models || {};
        for (const [id, model] of Object.entries(existingModels)) {
          if (!models[id]) {
            models[id] = model as CtxModel;
          }
        }

        (provider as unknown as { models?: Record<string, CtxModel> }).models = models;
        console.log(`[${CLIPROXY_PROVIDER_ID}] Discovered ${modelIds.length} models`);
      } catch (error) {
        console.warn(`[${CLIPROXY_PROVIDER_ID}] Model discovery failed: ${error instanceof Error ? error.message : error}`);
      }
    },
    auth: {
      provider: CLIPROXY_PROVIDER_ID,
      loader: async (getAuth: GetAuth, provider: ProviderCtx): Promise<Record<string, unknown>> => {
        latestAuthResolver = getAuth;

        try {
          const storedAuth = await (async () => {
            const auth = await getAuth();
            if (auth && (auth as CliProxyApiStoredAuth).type === "api" && (auth as CliProxyApiStoredAuth).endpoint) {
              return auth as CliProxyApiStoredAuth;
            }
            return undefined;
          })();

          const apiKey = resolveApiKey(provider, storedAuth ?? undefined);
          const baseUrl = resolveBaseUrl(provider, storedAuth ?? undefined);

          return {
            apiKey,
            async fetch(input: RequestInfo, init?: RequestInit) {
              // CliProxyApi sends requests to paths like "/v1/chat/completions"
              // The endpoint already ends with /v1, so we strip the leading /v1
              // from the path to avoid double-v1 paths.
              let finalUrl: string;
              const urlStr = typeof input === "string" ? input : input.toString();

              if (urlStr.startsWith("http://") || urlStr.startsWith("https://")) {
                // Absolute URL — use directly
                finalUrl = urlStr;
              } else {
                // Relative path — strip any leading /v1 prefix since baseUrl already ends with /v1
                const base = baseUrl;
                const path = urlStr.startsWith("/v1") ? urlStr.slice(3) : urlStr;
                finalUrl = `${base}${path}`;
              }

              const headers = new Headers(init?.headers as Record<string, string> | undefined);
              if (!headers.has("Authorization")) {
                headers.set("Authorization", `Bearer ${apiKey}`);
              }

              return fetch(finalUrl, { ...init, headers });
            },
          };
        } catch (error) {
          console.error(`[${CLIPROXY_PROVIDER_ID}] Loader failed: ${error}`);
          return { apiKey: "", fetch: fetch };
        }
      },
      methods: [
        {
          label: "CliProxyApi (API Key)",
          type: "api",
          prompts: [
            {
              type: "text",
              key: "endpoint",
              message: "Enter the CliProxyApi endpoint URL",
              placeholder: "http://192.168.2.211:8317/v1",
              validate: (value: string) => {
                if (!value.trim()) return "Endpoint is required";
                try {
                  new URL(value.trim());
                } catch {
                  return "Please enter a valid URL (e.g. http://192.168.2.211:8317/v1)";
                }
                return undefined;
              },
            },
            {
              type: "text",
              key: "apiKey",
              message: "Enter your CliProxyApi API key",
              placeholder: "sk-...",
              validate: (value: string) => {
                if (!value.trim()) return "API key is required";
                return undefined;
              },
            },
          ],
          authorize: async (inputs?: Record<string, string>) => {
            const endpoint = inputs?.["endpoint"]?.trim();
            const apiKey = inputs?.["apiKey"]?.trim();

            if (!endpoint || !apiKey) {
              return { type: "failed" };
            }

            // Validate the endpoint and apiKey by doing a quick test request
            try {
              // Determine models endpoint based on whether URL already has /v1
              const base = endpoint.replace(/\/+$/, "");
              const modelsUrl = (base.endsWith("/v1") || base.endsWith("/v1/"))
                ? `${base}/models`
                : `${base}/v1/models`;
              const response = await fetch(modelsUrl, {
                headers: {
                  authorization: `Bearer ${apiKey}`,
                  accept: "application/json",
                },
              });

              if (!response.ok) {
                console.error(`[${CLIPROXY_PROVIDER_ID}] Auth validation failed: ${response.status}`);
                return { type: "failed" };
              }

              const payload = (await response.json()) as ModelsResponse;
              const ids = extractModelIds(payload);
              if (ids.length === 0) {
                console.error(`[${CLIPROXY_PROVIDER_ID}] Auth validation: endpoint returned no models`);
                return { type: "failed" };
              }

              console.log(`[${CLIPROXY_PROVIDER_ID}] Auth successful: ${ids.length} models available`);
            } catch (err) {
              console.error(`[${CLIPROXY_PROVIDER_ID}] Auth validation error: ${err}`);
              return { type: "failed" };
            }

            // Store the credentials — they will be read back by loader via getAuth()
            await client.auth.set({
              path: { id: CLIPROXY_PROVIDER_ID },
              body: {
                type: "api",
                endpoint,
                apiKey,
              } as unknown as Parameters<typeof client.auth.set>[0]["body"],
            });

            return {
              type: "success",
              key: apiKey,
              provider: CLIPROXY_PROVIDER_ID,
            };
          },
        },
      ],
    },
  };
};