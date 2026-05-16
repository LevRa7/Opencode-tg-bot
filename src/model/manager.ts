import { getCurrentModel, setCurrentModel } from "../settings/manager.js";
import { config } from "../config.js";
import { getCurrentOpencodeRuntimeKey, opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";
import type {
  ModelInfo,
  ModelReference,
  ModelSelectionLists,
  RuntimeModelCatalog,
} from "./types.js";

interface RuntimeModelCatalogCacheEntry {
  catalog?: RuntimeModelCatalog;
  expiresAt: number;
  inFlight: Promise<RuntimeModelCatalog> | null;
}

const MODEL_CATALOG_CACHE_TTL_MS = 10 * 60 * 1000;
const SERVER_UNAVAILABLE_ERROR_MARKERS = [
  "fetch failed",
  "econnrefused",
  "connection refused",
  "connect refused",
];
const runtimeModelCatalogCache = new Map<string, RuntimeModelCatalogCacheEntry>();

function hasServerUnavailableMarker(value: string): boolean {
  const lower = value.toLowerCase();
  return SERVER_UNAVAILABLE_ERROR_MARKERS.some((marker) => lower.includes(marker));
}

function isServerUnavailableError(error: unknown): boolean {
  const queue: unknown[] = [error];
  const seen = new Set<unknown>();

  while (queue.length > 0) {
    const current = queue.pop();

    if (!current || seen.has(current)) {
      continue;
    }

    seen.add(current);

    if (typeof current === "string") {
      if (hasServerUnavailableMarker(current)) {
        return true;
      }

      continue;
    }

    if (current instanceof Error) {
      if (hasServerUnavailableMarker(`${current.name}: ${current.message}`)) {
        return true;
      }

      const errorWithCause = current as Error & { cause?: unknown };
      if (errorWithCause.cause) {
        queue.push(errorWithCause.cause);
      }

      continue;
    }

    if (typeof current === "object") {
      const value = current as {
        code?: unknown;
        message?: unknown;
        cause?: unknown;
      };

      if (typeof value.code === "string" && hasServerUnavailableMarker(value.code)) {
        return true;
      }

      if (typeof value.message === "string" && hasServerUnavailableMarker(value.message)) {
        return true;
      }

      if (value.cause) {
        queue.push(value.cause);
      }
    }
  }

  return false;
}

function getModelKey(providerID: string, modelID: string): string {
  return `${providerID}/${modelID}`;
}

function getEnvDefaultModel(): ModelReference | null {
  const providerID = config.opencode.model.provider;
  const modelID = config.opencode.model.modelId;

  if (!providerID || !modelID) {
    return null;
  }

  return { providerID, modelID };
}

function normalizeRuntimeModelCatalog(data: {
  providers: Array<{ id: string; models: Record<string, { id?: string }> }>;
}): RuntimeModelCatalog {
  return {
    providers: data.providers
      .map((provider) => ({
        providerID: provider.id,
        models: Object.keys(provider.models)
          .sort((left, right) => left.localeCompare(right))
          .map((modelID) => ({ providerID: provider.id, modelID })),
      }))
      .sort((left, right) => left.providerID.localeCompare(right.providerID)),
  };
}

export async function getRuntimeModelCatalog(options?: { force?: boolean }): Promise<RuntimeModelCatalog> {
  const runtimeKey = getCurrentOpencodeRuntimeKey();
  const cachedEntry = runtimeModelCatalogCache.get(runtimeKey);

  if (!options?.force && cachedEntry?.catalog && Date.now() < cachedEntry.expiresAt) {
    logger.debug(
      `[ModelManager] Runtime model catalog cache hit: runtime=${runtimeKey}, providers=${cachedEntry.catalog.providers.length}`,
    );
    return cachedEntry.catalog;
  }

  if (cachedEntry?.inFlight) {
    logger.debug(`[ModelManager] Awaiting in-flight runtime model catalog refresh: ${runtimeKey}`);
    return cachedEntry.inFlight;
  }

  const refreshPromise = (async () => {
    try {
      logger.debug(`[ModelManager] Refreshing runtime model catalog: ${runtimeKey}`);
      const response = await opencodeClient.config.providers();

      if (response.error || !response.data) {
        throw response.error ?? new Error("providers catalog is unavailable");
      }

      const catalog = normalizeRuntimeModelCatalog(response.data);
      runtimeModelCatalogCache.set(runtimeKey, {
        catalog,
        expiresAt: Date.now() + MODEL_CATALOG_CACHE_TTL_MS,
        inFlight: null,
      });

      logger.debug(
        `[ModelManager] Runtime model catalog refreshed: runtime=${runtimeKey}, providers=${catalog.providers.length}`,
      );

      return catalog;
    } catch (err) {
      logger.warn(`[ModelManager] Failed to refresh runtime model catalog: ${runtimeKey}`, err);

      if (cachedEntry?.catalog) {
        logger.warn(`[ModelManager] Using stale runtime model catalog cache: ${runtimeKey}`);
        return cachedEntry.catalog;
      }

      throw err;
    } finally {
      const latest = runtimeModelCatalogCache.get(runtimeKey);
      if (latest) {
        runtimeModelCatalogCache.set(runtimeKey, {
          ...latest,
          inFlight: null,
        });
      }
    }
  })();

  runtimeModelCatalogCache.set(runtimeKey, {
    catalog: cachedEntry?.catalog,
    expiresAt: cachedEntry?.expiresAt ?? 0,
    inFlight: refreshPromise,
  });

  return refreshPromise;
}

async function getValidModelKeys(options?: { force?: boolean }): Promise<Set<string> | null> {
  try {
    const catalog = await getRuntimeModelCatalog({ force: options?.force });
    return new Set(
      catalog.providers.flatMap((provider) =>
        provider.models.map((model) => getModelKey(model.providerID, model.modelID)),
      ),
    );
  } catch (err) {
    if (isServerUnavailableError(err)) {
      logger.warn("[ModelManager] OpenCode server is not running; skipping model catalog refresh");
    } else {
      logger.warn("[ModelManager] Skipping stored model validation: runtime catalog unavailable", err);
    }

    return null;
  }
}

export async function getModelSelectionLists(): Promise<ModelSelectionLists> {
  const catalog = await getRuntimeModelCatalog();
  const envDefaultModel = getEnvDefaultModel();
  const favorites = envDefaultModel ? [envDefaultModel] : [];
  const recent = catalog.providers.flatMap((provider) => provider.models);

  return {
    favorites,
    recent: recent.filter(
      (model) => !favorites.some((favorite) => getModelKey(favorite.providerID, favorite.modelID) === getModelKey(model.providerID, model.modelID)),
    ),
  };
}

export async function getFavoriteModels(): Promise<ModelReference[]> {
  const { favorites } = await getModelSelectionLists();
  return favorites;
}

export async function reconcileStoredModelSelection(options?: {
  forceCatalogRefresh?: boolean;
}): Promise<void> {
  const currentModel = getCurrentModel();

  if (!currentModel?.providerID || !currentModel.modelID) {
    return;
  }

  const validModelKeys = await getValidModelKeys({ force: options?.forceCatalogRefresh });

  if (!validModelKeys) {
    return;
  }

  const currentModelKey = getModelKey(currentModel.providerID, currentModel.modelID);
  if (validModelKeys.has(currentModelKey)) {
    return;
  }

  const envDefaultModel = getEnvDefaultModel();
  if (!envDefaultModel) {
    logger.warn(
      `[ModelManager] Stored model ${currentModelKey} is unavailable and env default model is missing`,
    );
    return;
  }

  const fallbackKey = getModelKey(envDefaultModel.providerID, envDefaultModel.modelID);

  if (!validModelKeys.has(fallbackKey)) {
    logger.warn(
      `[ModelManager] Stored model ${currentModelKey} is unavailable and env default model ${fallbackKey} is unavailable`,
    );
    return;
  }

  logger.warn(
    `[ModelManager] Stored model ${currentModelKey} is unavailable, falling back to ${fallbackKey}`,
  );

  setCurrentModel({
    providerID: envDefaultModel.providerID,
    modelID: envDefaultModel.modelID,
    variant: "default",
  });
}

export function __resetModelCatalogCacheForTests(): void {
  runtimeModelCatalogCache.clear();
}

export function fetchCurrentModel(): ModelInfo {
  return getStoredModel();
}

export function selectModel(modelInfo: ModelInfo): void {
  logger.info(`[ModelManager] Selected model: ${modelInfo.providerID}/${modelInfo.modelID}`);
  setCurrentModel(modelInfo);
}

export function getStoredModel(): ModelInfo {
  const storedModel = getCurrentModel();

  if (storedModel) {
    if (!storedModel.variant) {
      storedModel.variant = "default";
    }
    return storedModel;
  }

  if (config.opencode.model.provider && config.opencode.model.modelId) {
    logger.debug("[ModelManager] Using model from config");
    return {
      providerID: config.opencode.model.provider,
      modelID: config.opencode.model.modelId,
      variant: "default",
    };
  }

  logger.warn("[ModelManager] No model found in settings or config, returning empty model");
  return {
    providerID: "",
    modelID: "",
    variant: "default",
  };
}
