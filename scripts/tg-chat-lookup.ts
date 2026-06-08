#!/usr/bin/env -S npx tsx
/**
 * tg-chat-lookup — resolve (chat_id, message_thread_id) from session_id
 *
 * Queries settings.db via conversation_bindings and thread_context_bindings.
 * scope_key / context_key format: "userId:chatId:messageThreadId" or "chatId:messageThreadId"
 *
 * Usage:
 *   npx tsx scripts/tg-chat-lookup.ts <sessionId>          → JSON to stdout
 *   npx tsx scripts/tg-chat-lookup.ts --auto [--dir <path>] → auto-find most recent session for cwd
 *   npx tsx scripts/tg-chat-lookup.ts --env <dir> <sid>     → use .env from <dir>
 */

import Database from "better-sqlite3";
import { config as dotenvConfig } from "dotenv";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---- resolve paths ----

const ARGS = process.argv.slice(2);
const AUTO = ARGS.includes("--auto");
const envArgIdx = ARGS.indexOf("--env");
const dirArgIdx = ARGS.indexOf("--dir");
let envDir: string | null = envArgIdx >= 0 ? (ARGS[envArgIdx + 1] ?? null) : null;
const searchDir: string | null = dirArgIdx >= 0 ? (ARGS[dirArgIdx + 1] ?? null) : null;
function isFlagValueIndex(idx: number, flagIdx: number): boolean {
  return flagIdx >= 0 && (idx === flagIdx + 1);
}

const positionalArgs = ARGS.filter(
  (a, i) =>
    !a.startsWith("--") &&
    !isFlagValueIndex(i, envArgIdx) &&
    !isFlagValueIndex(i, dirArgIdx),
);

function resolveAppHome(): string {
  const override = process.env.OPENCODE_TELEGRAM_HOME;
  if (override) return path.resolve(override);
  if (envDir) return path.resolve(envDir);
  return path.resolve(__dirname, "..");
}

function loadEnv(appHome: string): void {
  const envPath = path.join(appHome, ".env");
  if (fs.existsSync(envPath)) {
    dotenvConfig({ path: envPath, quiet: true });
  }
}

function resolveDbPath(appHome: string): string {
  return path.join(appHome, "settings.db");
}

// ---- scope_key / context_key parsing ----

interface TelegramTarget {
  chatId: number;
  messageThreadId?: number;
}

function parseScopeKey(raw: string): { chatId: number; messageThreadId: number } | null {
  const parts = raw.split(":");
  if (parts.length === 2) {
    const chatId = Number(parts[0]);
    const messageThreadId = Number(parts[1]);
    if (!Number.isInteger(chatId) || !Number.isInteger(messageThreadId)) return null;
    return { chatId, messageThreadId };
  }
  if (parts.length === 3) {
    const chatId = Number(parts[1]);
    const messageThreadId = Number(parts[2]);
    if (!Number.isInteger(chatId) || !Number.isInteger(messageThreadId)) return null;
    return { chatId, messageThreadId };
  }
  return null;
}

function normalizeTarget(parsed: { chatId: number; messageThreadId: number }): TelegramTarget {
  return {
    chatId: parsed.chatId,
    messageThreadId: parsed.messageThreadId > 0 ? parsed.messageThreadId : undefined,
  };
}

// ---- queries ----

function lookupConversationBindings(db: Database.Database, sessionId: string): TelegramTarget | null {
  const row = db
    .prepare("SELECT scope_key FROM conversation_bindings WHERE session LIKE ? LIMIT 1")
    .get(`%"id":"${sessionId}"%`) as { scope_key: string } | undefined;
  if (!row?.scope_key) return null;
  const parsed = parseScopeKey(row.scope_key);
  return parsed ? normalizeTarget(parsed) : null;
}

function lookupThreadContextBindings(
  db: Database.Database,
  sessionId: string,
): TelegramTarget | null {
  const rows = db
    .prepare("SELECT context_key, session FROM thread_context_bindings WHERE session IS NOT NULL")
    .all() as { context_key: string; session: string }[];

  for (const row of rows) {
    try {
      const sessionObj = JSON.parse(row.session);
      if (sessionObj.id === sessionId) {
        const key = parseScopeKey(row.context_key);
        if (key) return normalizeTarget(key);
      }
    } catch {
      continue;
    }
  }
  return null;
}

function lookupAttachedSessions(db: Database.Database, sessionId: string): TelegramTarget | null {
  const row = db
    .prepare("SELECT scope_key FROM attached_sessions WHERE session = ? LIMIT 1")
    .get(sessionId) as { scope_key: string } | undefined;
  if (!row?.scope_key) return null;
  const parsed = parseScopeKey(row.scope_key);
  return parsed ? normalizeTarget(parsed) : null;
}

// ---- auto-detection: find most recent session for current directory ----

interface AutoResult extends TelegramTarget {
  sessionId: string;
  directory: string;
}

function findMostRecentSessionByDirectory(
  db: Database.Database,
  searchDirAbsolute: string,
): AutoResult | null {
  // Scope is encoded as "userId:chatId:messageThreadId"
  // We group by scope_key (which identifies a chat/thread) and find the
  // session with the highest messageThreadId (== most recently created in that scope)
  // that is bound to the search directory.
  const rows = db
    .prepare(
      `SELECT rowid, scope_key, session FROM conversation_bindings
       WHERE session IS NOT NULL
       ORDER BY rowid DESC
       LIMIT 200`,
    )
    .all() as { rowid: number; scope_key: string; session: string }[];

  // Collect all sessions bound to the search directory, grouped by scope
  const candidates: { scope: string; sessionId: string; directory: string; parsed: ReturnType<typeof parseScopeKey>; exact: boolean; rowid: number }[] = [];

  for (const row of rows) {
    try {
      const sessionObj = JSON.parse(row.session);
      const dir = sessionObj.directory as string;
      if (!dir) continue;

      // Match: exact path preferred, then parent-of-search
      const normalizedDir = path.resolve(dir);
      // Exclude root "/" as too broad (everything matches)
      if (normalizedDir === "/" || normalizedDir.length < 3) {
        continue;
      }
      const isExact = normalizedDir === searchDirAbsolute;
      const isParent =
        searchDirAbsolute.startsWith(normalizedDir + "/") ||
        normalizedDir.startsWith(searchDirAbsolute + "/");
      if (!isExact && !isParent) {
        continue;
      }

      const parsed = parseScopeKey(row.scope_key);
      if (!parsed) continue;

      candidates.push({
        scope: row.scope_key,
        sessionId: sessionObj.id,
        directory: normalizedDir,
        parsed,
        exact: normalizedDir === searchDirAbsolute,
        rowid: row.rowid,
      });
    } catch {
      continue;
    }
  }

  if (candidates.length === 0) return null;

  // Sort: exact match first, then with real thread, then deeper directory,
  // then most recent (higher rowid = more recently created)
  candidates.sort((a, b) => {
    if (a.exact && !b.exact) return -1;
    if (!a.exact && b.exact) return 1;
    const aHasThread = a.parsed && a.parsed.messageThreadId > 0 ? 1 : 0;
    const bHasThread = b.parsed && b.parsed.messageThreadId > 0 ? 1 : 0;
    if (aHasThread !== bHasThread) return bHasThread - aHasThread;
    if (a.directory.length !== b.directory.length)
      return b.directory.length - a.directory.length;
    // Most recent session first (higher rowid = newer)
    return b.rowid - a.rowid;
  });

  const best = candidates[0]!;
  return {
    ...normalizeTarget(best.parsed),
    sessionId: best.sessionId,
    directory: best.directory,
  };
}

// ---- main ----

function main(): void {
  const appHome = resolveAppHome();
  loadEnv(appHome);

  const dbPath = resolveDbPath(appHome);
  if (!fs.existsSync(dbPath)) {
    console.error(JSON.stringify({ error: `settings.db not found at ${dbPath}` }));
    process.exit(1);
  }

  const db = new Database(dbPath, { readonly: true });
  db.pragma("busy_timeout = 5000");

  try {
    // --auto mode: find most recent session for current directory
    if (AUTO) {
      const targetDir = searchDir ? path.resolve(searchDir) : process.cwd();
      const autoResult = findMostRecentSessionByDirectory(db, targetDir);

      if (!autoResult) {
        console.error(
          JSON.stringify({ error: `No session found for directory ${targetDir}` }),
        );
        process.exit(1);
      }

      const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
      console.log(
        JSON.stringify({
          chatId: autoResult.chatId,
          messageThreadId: autoResult.messageThreadId ?? null,
          token,
          sessionId: autoResult.sessionId,
          directory: autoResult.directory,
        }),
      );
      return;
    }

    // Explicit sessionId mode (CLI arg, then TG_CURRENT_SESSION_ID env var)
    let [sessionId] = positionalArgs;
    if (!sessionId) {
      sessionId = process.env.TG_CURRENT_SESSION_ID || null;
    }
    if (!sessionId) {
      console.error(
        JSON.stringify({
          error:
            "Usage: tg-chat-lookup.ts [--env <dir>] [--auto [--dir <path>]] [<sessionId>]",
        }),
      );
      process.exit(1);
    }

    const target =
      lookupConversationBindings(db, sessionId) ??
      lookupThreadContextBindings(db, sessionId) ??
      lookupAttachedSessions(db, sessionId);

    if (!target) {
      console.error(
        JSON.stringify({ error: `No target found for session ${sessionId}` }),
      );
      process.exit(1);
    }

    const token = process.env.TELEGRAM_BOT_TOKEN ?? "";
    console.log(
      JSON.stringify({
        chatId: target.chatId,
        messageThreadId: target.messageThreadId ?? null,
        token,
        sessionId,
      }),
    );
  } finally {
    db.close();
  }
}

main();
