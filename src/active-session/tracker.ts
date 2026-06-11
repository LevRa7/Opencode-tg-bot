import * as fs from "node:fs";
import * as path from "node:path";
import { logger } from "../utils/logger.js";

const ACTIVE_SESSIONS_FILE = "/tmp/tg-active-sessions.json";

const ACTIVE_TTL_MS = 5 * 60 * 1000; // 5 min — session considered "actively used"
const STALE_TTL_MS = 60 * 60 * 1000; // 1 hour — cleanup old entries

export interface ActiveSessionEntry {
  sessionId: string;
  chatId: number;
  messageThreadId: number | null;
  timestamp: number;
}

/**
 * Records that a session in a given directory was just used from a specific Telegram scope.
 * Called by the bot whenever setCurrentSession() is invoked.
 */
export function recordActiveSession(
  directory: string,
  sessionId: string,
  chatId: number,
  messageThreadId: number | null,
): void {
  try {
    const normalizedDir = path.resolve(directory);
    const store = readStore();

    store[normalizedDir] = {
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
 * Returns the most recently active session entry for the given directory
 * if it is still fresh (< 5 min). Returns null otherwise.
 */
export function getActiveSessionForDirectory(
  directory: string,
): ActiveSessionEntry | null {
  try {
    const normalizedDir = path.resolve(directory);
    const store = readStore();
    const entry = store[normalizedDir];
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > ACTIVE_TTL_MS) return null;

    return entry;
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
