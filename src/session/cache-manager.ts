import { createHash } from "node:crypto";
import path from "node:path";
import Database from "better-sqlite3";
import { opencodeClient } from "../opencode/client.js";
import { getSessionDirectoryCache, setSessionDirectoryCache } from "../settings/manager.js";
import {
  getCurrentTelegramConversationScope,
  runWithTelegramConversationScope,
} from "../telegram/scope.js";
import { logger } from "../utils/logger.js";

export interface CachedSessionDirectory {
  worktree: string;
  lastUpdated: number;
}

export interface SessionDirectoryProject {
  id: string;
  worktree: string;
  name: string;
  lastUpdated: number;
}

interface SessionDirectoryCacheData {
  version: 1;
  lastSyncedUpdatedAt: number;
  directories: CachedSessionDirectory[];
}

const CACHE_VERSION = 1;
const INITIAL_WARMUP_LIMIT = 1000;
const INCREMENTAL_SYNC_LIMIT = 1000;
const MAX_CACHED_DIRECTORIES = 10;
const SYNC_SAFETY_WINDOW_MS = 60_000;
const SYNC_COOLDOWN_MS = 60_000;
const SQLITE_FALLBACK_QUERY_LIMIT = 200;
const SERVER_UNAVAILABLE_ERROR_MARKERS = [
  "fetch failed",
  "econnrefused",
  "connection refused",
  "connect refused",
];

const EMPTY_CACHE: SessionDirectoryCacheData = {
  version: CACHE_VERSION,
  lastSyncedUpdatedAt: 0,
  directories: [],
};

function createEmptyCacheData(): SessionDirectoryCacheData {
  return {
    version: EMPTY_CACHE.version,
    lastSyncedUpdatedAt: EMPTY_CACHE.lastSyncedUpdatedAt,
    directories: [],
  };
}

const cacheDataByScope = new Map<string, SessionDirectoryCacheData>();
const cacheLoadedByScope = new Set<string>();
const syncInFlightByScope = new Map<string, Promise<void>>();
const lastSyncAttemptAtByScope = new Map<string, number>();
const persistQueueByScope = new Map<string, Promise<void>>();

function worktreeKey(worktree: string): string {
  if (process.platform === "win32") {
    return worktree.toLowerCase();
  }

  return worktree;
}

function getActiveCacheScopeKey(): string {
  const scope = getCurrentTelegramConversationScope();
  return scope ? `user:${scope.userId}` : "global";
}

function getScopeCacheData(): SessionDirectoryCacheData {
  const scopeKey = getActiveCacheScopeKey();
  const existing = cacheDataByScope.get(scopeKey);
  if (existing) {
    return existing;
  }

  const created = createEmptyCacheData();
  cacheDataByScope.set(scopeKey, created);
  return created;
}

function setScopeCacheData(data: SessionDirectoryCacheData): void {
  cacheDataByScope.set(getActiveCacheScopeKey(), data);
}

function isValidWorktree(worktree: string): boolean {
  const trimmed = worktree.trim();
  return trimmed.length > 0 && trimmed !== "/";
}

function normalizeCacheData(raw: unknown): SessionDirectoryCacheData {
  if (!raw || typeof raw !== "object") {
    return createEmptyCacheData();
  }

  const value = raw as {
    version?: unknown;
    lastSyncedUpdatedAt?: unknown;
    directories?: unknown;
  };

  const lastSyncedUpdatedAt =
    typeof value.lastSyncedUpdatedAt === "number" && Number.isFinite(value.lastSyncedUpdatedAt)
      ? value.lastSyncedUpdatedAt
      : 0;

  const directories: CachedSessionDirectory[] = Array.isArray(value.directories)
    ? value.directories
        .filter(
          (item): item is { worktree: string; lastUpdated: number } =>
            Boolean(item) &&
            typeof item === "object" &&
            typeof (item as { worktree?: unknown }).worktree === "string" &&
            typeof (item as { lastUpdated?: unknown }).lastUpdated === "number",
        )
        .map((item) => ({
          worktree: item.worktree.trim(),
          lastUpdated: item.lastUpdated,
        }))
        .filter((item) => isValidWorktree(item.worktree))
    : [];

  const data: SessionDirectoryCacheData = {
    version: CACHE_VERSION,
    lastSyncedUpdatedAt,
    directories,
  };

  dedupeAndTrimDirectories(data);
  return data;
}

function dedupeAndTrimDirectories(data: SessionDirectoryCacheData): void {
  const unique = new Map<string, CachedSessionDirectory>();

  for (const item of data.directories) {
    const key = worktreeKey(item.worktree);
    const existing = unique.get(key);

    if (!existing || existing.lastUpdated < item.lastUpdated) {
      unique.set(key, item);
    }
  }

  data.directories = Array.from(unique.values())
    .sort((a, b) => b.lastUpdated - a.lastUpdated)
    .slice(0, MAX_CACHED_DIRECTORIES);
}

async function ensureCacheLoaded(): Promise<void> {
  const scopeKey = getActiveCacheScopeKey();
  if (cacheLoadedByScope.has(scopeKey)) {
    return;
  }

  const storedCache = getSessionDirectoryCache();
  const normalizedCache = normalizeCacheData(storedCache);
  setScopeCacheData(normalizedCache);
  cacheLoadedByScope.add(scopeKey);
  logger.debug(
    `[SessionCache] Loaded ${normalizedCache.directories.length} directories for scope=${scopeKey}`,
  );
}

function queuePersist(): Promise<void> {
  const scopeKey = getActiveCacheScopeKey();
  const currentQueue = persistQueueByScope.get(scopeKey) ?? Promise.resolve();
  const nextQueue = currentQueue
    .catch(() => {
      // Keep queue chain alive if previous write failed.
    })
    .then(async () => {
      try {
        await setSessionDirectoryCache(getScopeCacheData());
      } catch (error) {
        logger.error("[SessionCache] Failed to persist sessions cache", error);
      }
    });

  persistQueueByScope.set(scopeKey, nextQueue);
  return nextQueue;
}

function upsertDirectory(worktree: string, lastUpdated: number): boolean {
  if (!isValidWorktree(worktree)) {
    return false;
  }

  const cacheData = getScopeCacheData();
  const normalizedWorktree = worktree.trim();
  const key = worktreeKey(normalizedWorktree);
  const existingIndex = cacheData.directories.findIndex(
    (item) => worktreeKey(item.worktree) === key,
  );

  if (existingIndex >= 0) {
    const existing = cacheData.directories[existingIndex];
    if (existing.lastUpdated >= lastUpdated) {
      return false;
    }

    cacheData.directories[existingIndex] = {
      worktree: existing.worktree,
      lastUpdated,
    };
  } else {
    cacheData.directories.push({
      worktree: normalizedWorktree,
      lastUpdated,
    });
  }

  dedupeAndTrimDirectories(cacheData);
  return true;
}

function buildListParams(options?: { force?: boolean }): { limit: number; start?: number } {
  const cacheData = getScopeCacheData();
  if (options?.force || cacheData.lastSyncedUpdatedAt === 0) {
    return { limit: INITIAL_WARMUP_LIMIT };
  }

  return {
    limit: INCREMENTAL_SYNC_LIMIT,
    start: Math.max(0, cacheData.lastSyncedUpdatedAt - SYNC_SAFETY_WINDOW_MS),
  };
}

function createVirtualProjectId(worktree: string): string {
  const hash = createHash("sha1").update(worktree).digest("hex").slice(0, 16);
  return `dir_${hash}`;
}

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

async function runSync(options?: { force?: boolean }): Promise<void> {
  await ensureCacheLoaded();

  const cacheData = getScopeCacheData();
  const shouldPrune = options?.force || cacheData.lastSyncedUpdatedAt === 0;
  const params = buildListParams(options);
  const { data: sessions, error } = await opencodeClient.session.list(params);

  if (error || !sessions) {
    throw error || new Error("No session list received from server");
  }

  let changed = false;
  let maxUpdated = cacheData.lastSyncedUpdatedAt;
  const seenDirectories = new Set<string>();

  for (const session of sessions) {
    const updatedAt = session.time?.updated ?? Date.now();
    if (upsertDirectory(session.directory, updatedAt)) {
      changed = true;
    }

    if (session.directory && isValidWorktree(session.directory)) {
      seenDirectories.add(worktreeKey(session.directory.trim()));
    }

    if (updatedAt > maxUpdated) {
      maxUpdated = updatedAt;
    }
  }

  const responseIsTruncated = sessions.length >= INITIAL_WARMUP_LIMIT;

  if (shouldPrune && !responseIsTruncated) {
    const before = cacheData.directories.length;
    cacheData.directories = cacheData.directories.filter((d) =>
      seenDirectories.has(worktreeKey(d.worktree)),
    );
    if (cacheData.directories.length !== before) {
      changed = true;
      logger.info(
        `[SessionCache] Pruned ${before - cacheData.directories.length} stale directories from cache`,
      );
    }
  }

  if (maxUpdated !== cacheData.lastSyncedUpdatedAt) {
    cacheData.lastSyncedUpdatedAt = maxUpdated;
    changed = true;
  }

  if (changed) {
    await queuePersist();
  }

  logger.debug(
    `[SessionCache] Synced sessions: fetched=${sessions.length}, directories=${cacheData.directories.length}, lastSyncedUpdatedAt=${cacheData.lastSyncedUpdatedAt}`,
  );
}

function getStorageRootCandidates(pathInfo: { home?: string; state?: string }): string[] {
  const candidates = new Set<string>();

  if (pathInfo.home) {
    candidates.add(path.join(pathInfo.home, ".local", "share", "opencode"));
  }

  if (pathInfo.state) {
    const normalizedState = pathInfo.state.replace(/[\\/]+$/, "");
    const lowerState = normalizedState.toLowerCase();
    const marker = `${path.sep}state${path.sep}opencode`;
    const lowerMarker = marker.toLowerCase();

    if (lowerState.endsWith(lowerMarker)) {
      const prefix = normalizedState.slice(0, normalizedState.length - marker.length);
      candidates.add(path.join(prefix, "share", "opencode"));
    }
  }

  return Array.from(candidates);
}

function getPathApi():
  | {
      get?: () => Promise<{
        data?: { home?: string; state?: string };
        error?: unknown;
      }>;
    }
  | undefined {
  return opencodeClient.path as
    | {
        get?: () => Promise<{
          data?: { home?: string; state?: string };
          error?: unknown;
        }>;
      }
    | undefined;
}

async function getStorageRootsFromApi(): Promise<string[]> {
  const pathApi = getPathApi();
  if (!pathApi?.get) {
    return [];
  }

  const { data: pathInfo, error } = await pathApi.get();
  if (error || !pathInfo) {
    return [];
  }

  return getStorageRootCandidates(pathInfo);
}

async function querySessionDirectoriesFromSqlite(
  dbPath: string,
): Promise<CachedSessionDirectory[] | null> {
  try {
    const db = new Database(dbPath, {
      readonly: true,
      fileMustExist: true,
    });

    try {
      const rows = db
        .prepare(
          `
            SELECT directory, MAX(time_updated) AS updated
            FROM session
            GROUP BY directory
            ORDER BY updated DESC
            LIMIT ?
          `,
        )
        .all(SQLITE_FALLBACK_QUERY_LIMIT) as Array<{ directory?: string; updated?: number | null }>;

      return rows
        .filter(
          (item): item is { directory: string; updated: number | null } =>
            Boolean(item) && typeof item.directory === "string",
        )
        .map((item) => ({
          worktree: item.directory,
          lastUpdated:
            typeof item.updated === "number" && Number.isFinite(item.updated) ? item.updated : 0,
        }));
    } finally {
      db.close();
    }
  } catch (error) {
    logger.debug(`[SessionCache] Failed to read sqlite fallback at ${dbPath}`, error);
  }

  return null;
}

async function ingestFromSqliteSessionDatabase(): Promise<void> {
  await ensureCacheLoaded();

  const cacheData = getScopeCacheData();
  const fs = await import("node:fs/promises");
  const roots = await getStorageRootsFromApi();

  for (const root of roots) {
    const dbPath = path.join(root, "opencode.db");

    try {
      await fs.access(dbPath);
    } catch {
      continue;
    }

    const rows = await querySessionDirectoriesFromSqlite(dbPath);
    if (!rows || rows.length === 0) {
      continue;
    }

    let changed = false;
    let maxUpdated = cacheData.lastSyncedUpdatedAt;

    for (const row of rows) {
      if (upsertDirectory(row.worktree, row.lastUpdated)) {
        changed = true;
      }

      if (row.lastUpdated > maxUpdated) {
        maxUpdated = row.lastUpdated;
      }
    }

    if (maxUpdated !== cacheData.lastSyncedUpdatedAt) {
      cacheData.lastSyncedUpdatedAt = maxUpdated;
      changed = true;
    }

    if (changed) {
      await queuePersist();
    }

    logger.debug(
      `[SessionCache] SQLite fallback loaded: db=${dbPath}, rows=${rows.length}, directories=${cacheData.directories.length}`,
    );

    return;
  }
}

export async function warmupSessionDirectoryCache(): Promise<void> {
  await syncSessionDirectoryCache({ force: true });

  try {
    await ingestFromSqliteSessionDatabase();
  } catch (error) {
    logger.warn("[SessionCache] Failed sqlite fallback warmup", error);
  }
}

export async function warmupHostSessionDirectoryCache(): Promise<void> {
  await runWithTelegramConversationScope(null, async () => {
    await warmupSessionDirectoryCache();
  });
}

export async function syncSessionDirectoryCache(options?: { force?: boolean }): Promise<void> {
  await ensureCacheLoaded();

  const scopeKey = getActiveCacheScopeKey();
  const lastSyncAttemptAt = lastSyncAttemptAtByScope.get(scopeKey) ?? 0;
  if (!options?.force && Date.now() - lastSyncAttemptAt < SYNC_COOLDOWN_MS) {
    return;
  }

  const syncInFlight = syncInFlightByScope.get(scopeKey);
  if (syncInFlight) {
    return syncInFlight;
  }

  const nextSync = runSync(options)
    .then(() => {
      lastSyncAttemptAtByScope.set(scopeKey, Date.now());
    })
    .catch((error) => {
      if (isServerUnavailableError(error)) {
        logger.warn("[SessionCache] OpenCode server is not running. Start it with: opencode serve");
      } else {
        logger.warn("[SessionCache] Failed to sync sessions cache", error);
      }

      lastSyncAttemptAtByScope.set(scopeKey, 0);
    })
    .finally(() => {
      syncInFlightByScope.delete(scopeKey);
    });

  syncInFlightByScope.set(scopeKey, nextSync);
  return nextSync;
}

export async function getCachedSessionDirectories(): Promise<CachedSessionDirectory[]> {
  await ensureCacheLoaded();
  return getScopeCacheData().directories.map((item) => ({ ...item }));
}

export async function getCachedSessionProjects(): Promise<SessionDirectoryProject[]> {
  const directories = await getCachedSessionDirectories();

  return directories.map((item) => ({
    id: createVirtualProjectId(item.worktree),
    worktree: item.worktree,
    name: item.worktree,
    lastUpdated: item.lastUpdated,
  }));
}

export async function upsertSessionDirectory(
  worktree: string,
  lastUpdated: number = Date.now(),
): Promise<void> {
  await ensureCacheLoaded();

  if (!upsertDirectory(worktree, lastUpdated)) {
    return;
  }

  const cacheData = getScopeCacheData();
  if (lastUpdated > cacheData.lastSyncedUpdatedAt) {
    cacheData.lastSyncedUpdatedAt = lastUpdated;
  }

  await queuePersist();
}

export async function ingestSessionInfoForCache(session: {
  directory?: string;
  time?: { updated?: number };
}): Promise<void> {
  const directory = session.directory;
  if (!directory) {
    return;
  }

  const updated = session.time?.updated ?? Date.now();
  await upsertSessionDirectory(directory, updated);
}

export async function clearSessionDirectoryCacheForScope(): Promise<void> {
  const scopeKey = getActiveCacheScopeKey();
  cacheDataByScope.delete(scopeKey);
  cacheLoadedByScope.delete(scopeKey);
  syncInFlightByScope.delete(scopeKey);
  lastSyncAttemptAtByScope.delete(scopeKey);
  persistQueueByScope.delete(scopeKey);
}

export function __resetSessionDirectoryCacheForTests(): void {
  cacheDataByScope.clear();
  cacheLoadedByScope.clear();
  syncInFlightByScope.clear();
  lastSyncAttemptAtByScope.clear();
  persistQueueByScope.clear();
}
