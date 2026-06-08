#!/usr/bin/env -S npx tsx
/**
 * current-chat — получить данные о текущем активном чате Telegram
 *
 * Определяет последний активный диалог и кеширует результат в
 * /tmp/tg-current-chat.json для использования tg-upload.ts --auto.
 *
 * Использование:
 *   npx tsx scripts/current-chat.ts                        # JSON в stdout
 *   npx tsx scripts/current-chat.ts --session-id <id>      # по session_id
 *   npx tsx scripts/current-chat.ts --verbose               # подробно
 *
 * Пример вывода:
 *   { "chatId": -1001234567890, "messageThreadId": 123, "sessionId": "...", "title": "Чат" }
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2);
const VERBOSE = ARGS.includes("--verbose");
const sessionIdIdx = ARGS.indexOf("--session-id");
const sessionId = sessionIdIdx >= 0 ? ARGS[sessionIdIdx + 1] : process.env.TG_CURRENT_SESSION_ID || null;
const CACHE_FILE = "/tmp/tg-current-chat.json";
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 час

function run(argv: string): string {
  const lookupScript = path.resolve(__dirname, "tg-chat-lookup.ts");
  return execSync(`npx tsx "${lookupScript}" ${argv}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
  });
}

function resolveSessionIdByWorktree(): string {
  // читаем последнюю сессию из settings.db через tg-chat-lookup --auto
  const out = run("--auto");
  const lines = out.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const parsed = JSON.parse(lines[i]) as {
        chatId?: number;
        messageThreadId?: number | null;
        sessionId?: string;
        directory?: string;
        token?: string;
      };
      if (parsed.sessionId) return parsed.sessionId;
    } catch { /* skip */ }
  }
  throw new Error("No active session found for current worktree");
}

function readCache(): { chatId: number; messageThreadId: number | null; sessionId: string } | null {
  try {
    if (!fs.existsSync(CACHE_FILE)) return null;
    const stat = fs.statSync(CACHE_FILE);
    if (Date.now() - stat.mtimeMs > CACHE_TTL_MS) {
      if (VERBOSE) console.error("Cache stale, refetching");
      return null;
    }
    return JSON.parse(fs.readFileSync(CACHE_FILE, "utf-8"));
  } catch {
    return null;
  }
}

function writeCache(data: { chatId: number; messageThreadId: number | null; sessionId: string }): void {
  try {
    fs.writeFileSync(CACHE_FILE, JSON.stringify(data, null, 2));
  } catch { /* best effort */ }
}

function main(): void {
  try {
    // Try cache first when no explicit session_id given
    if (!sessionId) {
      const cached = readCache();
      if (cached) {
        console.log(JSON.stringify(cached));
        return;
      }
    }

    const sid = sessionId || resolveSessionIdByWorktree();
    if (VERBOSE) console.error(`Session: ${sid}`);

    const result = run(sid);
    const lines = result.trim().split("\n");
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const parsed = JSON.parse(lines[i]) as {
          chatId?: number;
          messageThreadId?: number | null;
          sessionId?: string;
          directory?: string;
        };
        const output = {
          chatId: parsed.chatId!,
          messageThreadId: parsed.messageThreadId ?? null,
          sessionId: parsed.sessionId || sid,
          directory: parsed.directory || null,
        };
        // Cache successful result
        writeCache(output);
        console.log(JSON.stringify(output));
        process.exit(0);
      } catch { /* skip */ }
    }
    throw new Error("Failed to resolve chat info");
  } catch (err: unknown) {
    const msg = (err as Error).message;
    console.error(JSON.stringify({ error: msg }));
    process.exit(1);
  }
}

main();
