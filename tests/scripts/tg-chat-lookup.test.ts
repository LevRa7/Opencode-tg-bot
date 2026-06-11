/**
 * Tests for tg-chat-lookup.ts --auto mode with active session tracking.
 *
 * Verifies that when multiple sessions exist for the same directory
 * (different Telegram topics), the correct session/topic is chosen
 * based on the active session tracker file.
 */
import { describe, expect, it, beforeEach, afterEach } from "vitest";
import Database from "better-sqlite3";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import { execSync } from "node:child_process";

const ACTIVE_SESSIONS_FILE = "/tmp/tg-active-sessions.json";
const PROJECT_DIR = "/root/Opencode-tg-bot";

/** Path to the tg-chat-lookup script */
const LOOKUP_SCRIPT = path.resolve(
  PROJECT_DIR,
  "scripts",
  "tg-chat-lookup.ts",
);

interface LookupOutput {
  chatId: number;
  messageThreadId: number | null;
  token: string;
  sessionId: string;
  directory: string;
}

function runLookup(
  args: string,
  homeDir: string,
): LookupOutput {
  const output = execSync(`npx tsx "${LOOKUP_SCRIPT}" ${args}`, {
    encoding: "utf-8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      OPENCODE_TELEGRAM_HOME: homeDir,
    },
    cwd: PROJECT_DIR,
  });

  const lines = output.trim().split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(lines[i]) as LookupOutput;
    } catch {
      continue;
    }
  }
  throw new Error(`No valid JSON in output: ${output.slice(0, 200)}`);
}

/** Write the active sessions tracker file */
function writeActiveSessions(entries: Record<string, {
  sessionId: string;
  chatId: number;
  messageThreadId: number | null;
  timestamp: number;
}>): void {
  fs.writeFileSync(ACTIVE_SESSIONS_FILE, JSON.stringify(entries, null, 2));
}

function clearActiveSessions(): void {
  try {
    if (fs.existsSync(ACTIVE_SESSIONS_FILE)) {
      fs.unlinkSync(ACTIVE_SESSIONS_FILE);
    }
  } catch { /* ignore */ }
}

describe("tg-chat-lookup --auto with active sessions", () => {
  let dbDir: string;
  let dbPath: string;
  let db: Database.Database;

  beforeEach(() => {
    dbDir = fs.mkdtempSync(path.join(os.tmpdir(), "tg-chat-lookup-test-"));
    dbPath = path.join(dbDir, "settings.db");
    db = new Database(dbPath);

    // Create the conversation_bindings table
    db.exec(`
      CREATE TABLE IF NOT EXISTS conversation_bindings (
        scope_key TEXT PRIMARY KEY,
        project TEXT,
        session TEXT,
        agent TEXT,
        model TEXT,
        pinned_message_id INTEGER,
        reasoning_mode INTEGER
      );
      CREATE TABLE IF NOT EXISTS thread_context_bindings (
        context_key TEXT PRIMARY KEY,
        session TEXT
      );
      CREATE TABLE IF NOT EXISTS attached_sessions (
        scope_key TEXT PRIMARY KEY,
        session TEXT
      );
    `);

    // Create test .env for the lookup script
    const envPath = path.join(dbDir, ".env");
    fs.writeFileSync(envPath, "TELEGRAM_BOT_TOKEN=test-bot-token-12345\n");

    clearActiveSessions();
  });

  afterEach(() => {
    try { db.close(); } catch { /* ignore */ }
    try { fs.rmSync(dbDir, { recursive: true, force: true }); } catch { /* ignore */ }
    clearActiveSessions();
  });

  const worktree = "/home/user/my-project";
  const sameWorktree = "/home/user/my-project";

  // Helper to insert a conversation binding
  function insertBinding(scopeKey: string, sessionJson: string): void {
    db.prepare(
      `INSERT OR REPLACE INTO conversation_bindings (scope_key, session) VALUES (?, ?)`,
    ).run(scopeKey, sessionJson);
  }

  it("picks the active session when tracker has a fresh entry", () => {
    // Two sessions in the same directory, different topics
    const chatId = -1001234567890;
    const topicA_threadId = 100;
    const topicB_threadId = 200;

    // Scope key format: userId:chatId:messageThreadId
    const scopeKeyA = `12345:${chatId}:${topicA_threadId}`;
    const scopeKeyB = `12345:${chatId}:${topicB_threadId}`;

    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-topic-a", title: "Topic A Session", directory: worktree }),
    );
    insertBinding(
      scopeKeyB,
      JSON.stringify({ id: "session-topic-b", title: "Topic B Session", directory: sameWorktree }),
    );

    // Mark topic B as actively used (more recent timestamp than A)
    writeActiveSessions({
      [worktree]: {
        sessionId: "session-topic-b",
        chatId,
        messageThreadId: topicB_threadId,
        timestamp: Date.now(),
      },
    });

    const result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.chatId).toBe(chatId);
    expect(result.messageThreadId).toBe(topicB_threadId);
    expect(result.sessionId).toBe("session-topic-b");
  });

  it("picks the correct topic when user switches between topics", () => {
    const chatId = -1002003004000;
    const topicA_threadId = 10;
    const topicB_threadId = 20;

    const scopeKeyA = `11111:${chatId}:${topicA_threadId}`;
    const scopeKeyB = `11111:${chatId}:${topicB_threadId}`;

    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-switch-a", title: "Switch A", directory: worktree }),
    );
    insertBinding(
      scopeKeyB,
      JSON.stringify({ id: "session-switch-b", title: "Switch B", directory: sameWorktree }),
    );

    // User is currently active in topic A (most recent timestamp)
    writeActiveSessions({
      [worktree]: {
        sessionId: "session-switch-a",
        chatId,
        messageThreadId: topicA_threadId,
        timestamp: Date.now(),
      },
    });

    const result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.chatId).toBe(chatId);
    expect(result.messageThreadId).toBe(topicA_threadId);
    expect(result.sessionId).toBe("session-switch-a");
  });

  it("falls back to default sorting when active session is stale", () => {
    const chatId = -1004005006000;
    const topicA_threadId = 50;
    const topicB_threadId = 60;

    const scopeKeyA = `22222:${chatId}:${topicA_threadId}`;
    const scopeKeyB = `22222:${chatId}:${topicB_threadId}`;

    // Topic B was created later (will be selected by default sort)
    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-stale-a", title: "Stale A", directory: worktree }),
    );
    // Insert B with a delay so it gets a higher rowid
    insertBinding(
      scopeKeyB,
      JSON.stringify({ id: "session-stale-b", title: "Stale B", directory: sameWorktree }),
    );

    // Active session tracker says topic A was used 10 minutes ago
    writeActiveSessions({
      [worktree]: {
        sessionId: "session-stale-a",
        chatId,
        messageThreadId: topicA_threadId,
        timestamp: Date.now() - 10 * 60 * 1000, // 10 min ago = stale
      },
    });

    // Should fall back to default sort → picks the more recent row (topic B)
    const result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.chatId).toBe(chatId);
    // Falls back to default sorting (higher rowid = topic B)
    expect(result.messageThreadId).toBe(topicB_threadId);
    expect(result.sessionId).toBe("session-stale-b");
  });

  it("falls back to default sort when active sessions file is empty", () => {
    const chatId = -1007008009000;
    const topicA_threadId = 70;

    const scopeKeyA = `33333:${chatId}:${topicA_threadId}`;
    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-nofile", title: "No File", directory: worktree }),
    );

    // No active sessions file at all
    clearActiveSessions();

    const result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.chatId).toBe(chatId);
    expect(result.messageThreadId).toBe(topicA_threadId);
    expect(result.sessionId).toBe("session-nofile");
  });

  it("picks A then B when user switches contexts with active sessions file update", () => {
    const chatId = -1009001002000;
    const topicA_threadId = 300;
    const topicB_threadId = 400;

    const scopeKeyA = `44444:${chatId}:${topicA_threadId}`;
    const scopeKeyB = `44444:${chatId}:${topicB_threadId}`;

    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-seq-a", title: "Sequence A", directory: worktree }),
    );
    insertBinding(
      scopeKeyB,
      JSON.stringify({ id: "session-seq-b", title: "Sequence B", directory: sameWorktree }),
    );

    // Step 1: Active in topic A
    writeActiveSessions({
      [worktree]: {
        sessionId: "session-seq-a",
        chatId,
        messageThreadId: topicA_threadId,
        timestamp: Date.now(),
      },
    });

    let result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.sessionId).toBe("session-seq-a");
    expect(result.messageThreadId).toBe(topicA_threadId);

    // Step 2: User switches to topic B
    writeActiveSessions({
      [worktree]: {
        sessionId: "session-seq-b",
        chatId,
        messageThreadId: topicB_threadId,
        timestamp: Date.now(),
      },
    });

    result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.sessionId).toBe("session-seq-b");
    expect(result.messageThreadId).toBe(topicB_threadId);
  }, 20000);

  it("handles non-forum chat (messageThreadId=0)", () => {
    const chatId = -1009009001000;

    const scopeKeyA = `55555:${chatId}:0`;
    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-nonforum", title: "Non-forum", directory: worktree }),
    );

    writeActiveSessions({
      [worktree]: {
        sessionId: "session-nonforum",
        chatId,
        messageThreadId: null,
        timestamp: Date.now(),
      },
    });

    const result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    expect(result.chatId).toBe(chatId);
    expect(result.messageThreadId).toBeNull();
    expect(result.sessionId).toBe("session-nonforum");
  });

  it("ignores corrupted active sessions file", () => {
    const chatId = -1001002003000;
    const topicA_threadId = 88;

    const scopeKeyA = `66666:${chatId}:${topicA_threadId}`;
    insertBinding(
      scopeKeyA,
      JSON.stringify({ id: "session-corrupt", title: "Corrupt", directory: worktree }),
    );

    // Write invalid JSON as active sessions file
    fs.writeFileSync(ACTIVE_SESSIONS_FILE, "not valid json {{{");

    const result = runLookup(`--auto --dir "${worktree}"`, dbDir);
    // Should fall through to default sort
    expect(result.sessionId).toBe("session-corrupt");
    expect(result.chatId).toBe(chatId);
  });
});
