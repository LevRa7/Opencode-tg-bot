import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.js";

const ACTIVE_SESSIONS_FILE = "/tmp/tg-active-sessions.json";
const CURRENT_CONTEXT_FILE = "/tmp/tg-current-context.json";

const ACTIVE_TTL_MS = 5 * 60 * 1000; // 5 min — session considered "actively used"
const STALE_TTL_MS = 60 * 60 * 1000; // 1 hour — cleanup old entries
const CONTEXT_TTL_MS = 10 * 60 * 1000; // 10 min — context considered fresh for routing

export interface ActiveSessionEntry {
  sessionId: string;
  chatId: number;
  messageThreadId: number | null;
  timestamp: number;
}

export interface CurrentContext {
  chatId: number;
  messageThreadId: number | null;
  sessionId: string;
  timestamp: number;
}

function buildTrackerKey(directory: string, messageThreadId: number | null): string {
  return `${path.resolve(directory)}::${messageThreadId ?? "main"}`;
}

/**
 * Records that a session in a given directory was just used from a specific Telegram scope.
 * Called by the bot whenever setCurrentSession() is invoked.
 *
 * Uses a compound key of directory + messageThreadId so that different topics
 * sharing the same directory do not overwrite each other.
 */
export function recordActiveSession(
  directory: string,
  sessionId: string,
  chatId: number,
  messageThreadId: number | null,
): void {
  try {
    const store = readStore();
    const key = buildTrackerKey(directory, messageThreadId);

    store[key] = {
      sessionId,
      chatId,
      messageThreadId,
      timestamp: Date.now(),
    };

    cleanupStale(store);
    writeStore(store);
  } catch (err) {
    logger.warn("[ActiveSession] Failed to record active session", err);
  }
}

/**
 * Returns the most recently active session entry for the given directory.
 * When messageThreadId is provided, prefers an exact thread match.
 * Falls back to the most recent entry for the directory otherwise.
 */
export function getActiveSessionForDirectory(
  directory: string,
  messageThreadId?: number | null,
): ActiveSessionEntry | null {
  try {
    const store = readStore();
    const normalizedDir = path.resolve(directory);

    // First try exact thread match
    if (messageThreadId !== undefined) {
      const exactKey = buildTrackerKey(normalizedDir, messageThreadId ?? null);
      const exactEntry = store[exactKey];
      if (exactEntry && Date.now() - exactEntry.timestamp <= ACTIVE_TTL_MS) {
        return exactEntry;
      }
    }

    // Fall back: find the most recent entry for this directory
    let bestEntry: ActiveSessionEntry | null = null;
    const dirPrefix = normalizedDir + "::";
    for (const [key, entry] of Object.entries(store)) {
      if (!key.startsWith(dirPrefix)) continue;
      if (Date.now() - entry.timestamp > ACTIVE_TTL_MS) continue;
      if (!bestEntry || entry.timestamp > bestEntry.timestamp) {
        bestEntry = entry;
      }
    }

    return bestEntry;
  } catch {
    return null;
  }
}

// ---- current context file ----

/**
 * Writes the current Telegram conversation context to a well-known file
 * so that external agents (tg-upload, current-chat) can resolve the exact
 * target topic without relying on directory-based heuristics.
 *
 * Called by the bot middleware on every incoming message.
 */
export function writeCurrentContext(context: CurrentContext): void {
  try {
    const tmpFile = CURRENT_CONTEXT_FILE + ".tmp";
    fs.writeFileSync(tmpFile, JSON.stringify(context, null, 2));
    fs.renameSync(tmpFile, CURRENT_CONTEXT_FILE);
  } catch (err) {
    logger.warn("[ActiveSession] Failed to write current context", err);
  }
}

/**
 * Reads the current context file if it is still fresh (< CONTEXT_TTL_MS).
 * Returns null if the file is missing, stale, or unreadable.
 */
export function readCurrentContext(): CurrentContext | null {
  try {
    if (!fs.existsSync(CURRENT_CONTEXT_FILE)) return null;
    const raw = fs.readFileSync(CURRENT_CONTEXT_FILE, "utf-8");
    const context = JSON.parse(raw) as CurrentContext;
    if (!context.chatId || !context.sessionId || !context.timestamp) return null;
    if (Date.now() - context.timestamp > CONTEXT_TTL_MS) return null;
    return context;
  } catch {
    return null;
  }
}

// ---- internal helpers ----

function readStore(): Record<string, ActiveSessionEntry> {
  try {
    if (!fs.existsSync(ACTIVE_SESSIONS_FILE)) return {};
    const raw = fs.readFileSync(ACTIVE_SESSIONS_FILE, "utf-8");
    return JSON.parse(raw) as Record<string, ActiveSessionEntry>;
  } catch {
    return {};
  }
}

function writeStore(store: Record<string, ActiveSessionEntry>): void {
  const tmpFile = ACTIVE_SESSIONS_FILE + ".tmp";
  fs.writeFileSync(tmpFile, JSON.stringify(store, null, 2));
  fs.renameSync(tmpFile, ACTIVE_SESSIONS_FILE);
}

function cleanupStale(store: Record<string, ActiveSessionEntry>): void {
  const cutoff = Date.now() - STALE_TTL_MS;
  for (const [dir, entry] of Object.entries(store)) {
    if (entry.timestamp < cutoff) {
      delete store[dir];
    }
  }
}
