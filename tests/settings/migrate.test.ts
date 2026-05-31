import Database from "better-sqlite3";
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { migrateSettings, migrateIfNeeded } from "../../src/settings/migrate.js";
import type { Settings } from "../../src/settings/manager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const MIGRATION_DDL = `
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                           INTEGER PRIMARY KEY,
    tts_enabled                       INTEGER NOT NULL DEFAULT 0,
    message_streaming_enabled         INTEGER NOT NULL DEFAULT 1,
    thinking_clear_mode               INTEGER NOT NULL DEFAULT 0,
    locale                            TEXT,
    hide_thinking_messages            INTEGER NOT NULL DEFAULT 0,
    hide_tool_call_messages           INTEGER NOT NULL DEFAULT 0,
    hide_tool_file_messages           INTEGER NOT NULL DEFAULT 0,
    telegraph_translate_enabled       INTEGER NOT NULL DEFAULT 0,
    subagent_topics_enabled           INTEGER NOT NULL DEFAULT 0,
    subagent_topic_auto_delete_minutes INTEGER NOT NULL DEFAULT 1,
    default_project                   TEXT,
    default_agent                     TEXT,
    default_model                     TEXT
);
CREATE TABLE IF NOT EXISTS conversation_bindings (
    scope_key          TEXT PRIMARY KEY,
    project            TEXT,
    session            TEXT,
    agent              TEXT,
    model              TEXT,
    pinned_message_id  INTEGER,
    reasoning_mode     INTEGER
);
CREATE TABLE IF NOT EXISTS approved_users (
    user_id INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS access_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    first_name   TEXT,
    last_name    TEXT,
    username     TEXT,
    requested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_tasks (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scheduled_task_ignores (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS server_process (
    key  TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT
);
CREATE TABLE IF NOT EXISTS last_restart_request (
    key  TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_runtimes (
    user_id INTEGER PRIMARY KEY,
    data    TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS attached_sessions (
    scope_key TEXT PRIMARY KEY,
    session   TEXT
);
CREATE TABLE IF NOT EXISTS session_directory_cache (
    scope_key TEXT PRIMARY KEY,
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS thread_context_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    context_key TEXT NOT NULL,
    project     TEXT,
    session     TEXT,
    agent       TEXT,
    model       TEXT
);
`;

describe("migrateSettings", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(MIGRATION_DDL);
  });

  it("migrates scopedUserSettings to user_preferences", () => {
    const settings: Settings = {
      scopedUserSettings: { "123": { locale: "ru", ttsEnabled: true } },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = 123").get() as any;
    expect(row.locale).toBe("ru");
    expect(row.tts_enabled).toBe(1);
  });

  it("migrates scopedConversationSettings to conversation_bindings", () => {
    const settings: Settings = {
      scopedConversationSettings: {
        "1:100:10": { currentAgent: "build", reasoningMode: 2 },
      },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT * FROM conversation_bindings").get() as any;
    expect(row.agent).toBe("build");
    expect(row.reasoning_mode).toBe(2);
  });

  it("migrates approvedTelegramUserIds", () => {
    const settings: Settings = { approvedTelegramUserIds: [111, 222] };
    migrateSettings(db, settings);
    const rows = db.prepare("SELECT user_id FROM approved_users").all() as any[];
    expect(rows.map((r: any) => r.user_id)).toEqual([111, 222]);
  });

  it("migrates pendingAccessRequests", () => {
    const settings: Settings = {
      pendingAccessRequests: [
        {
          userId: 123,
          chatId: 100,
          username: "john",
          firstName: "John",
          lastName: "Doe",
          requestedAt: "2026-01-01T00:00:00Z",
          adminChatId: 999,
        },
      ],
    };
    migrateSettings(db, settings);
    const reqs = db.prepare("SELECT * FROM access_requests").all() as any[];
    expect(reqs).toHaveLength(1);
    expect(reqs[0].first_name).toBe("John");
  });

  it("migrates serverProcess", () => {
    const settings: Settings = {
      serverProcess: { pid: 12345, startTime: "2026-01-01T00:00:00Z" },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT data FROM server_process WHERE key='current'").get() as any;
    expect(JSON.parse(row.data)).toEqual({ pid: 12345, startTime: "2026-01-01T00:00:00Z" });
  });

  it("migrates lastRestartRequest", () => {
    const settings: Settings = {
      lastRestartRequest: { updateId: 42, requestedAt: "2026-01-01T00:00:00Z" },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT data FROM last_restart_request WHERE key='current'").get() as any;
    expect(JSON.parse(row.data).updateId).toBe(42);
  });

  it("migrates tenantRuntimes", () => {
    const settings: Settings = {
      tenantRuntimes: {
        "123": { userId: 123, chatId: 100, port: 4096, baseUrl: "http://localhost:4096", tenantId: "t1" },
      },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT data FROM tenant_runtimes WHERE user_id=123").get() as any;
    const parsed = JSON.parse(row.data);
    expect(parsed.port).toBe(4096);
    expect(parsed.baseUrl).toBe("http://localhost:4096");
  });

  it("migrates attachedSessions", () => {
    const settings: Settings = {
      attachedSessions: {
        "1:2:3": {
          scope: { userId: 1, chatId: 2, messageThreadId: 3 },
          session: { id: "s1", title: "T", directory: "/tmp" },
          attachedAt: "x",
          busy: false,
        },
      },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT * FROM attached_sessions WHERE scope_key='1:2:3'").get() as any;
    expect(JSON.parse(row.session)).toEqual({ id: "s1", title: "T", directory: "/tmp" });
  });

  it("migrates scopedSessionDirectoryCache", () => {
    const settings: Settings = {
      scopedSessionDirectoryCache: {
        "123": {
          version: 1,
          lastSyncedUpdatedAt: 1000,
          directories: [{ worktree: "/tmp", lastUpdated: 2000 }],
        },
      },
    };
    migrateSettings(db, settings);
    const row = db
      .prepare("SELECT * FROM session_directory_cache WHERE scope_key='123'")
      .get() as any;
    const parsed = JSON.parse(row.data);
    expect(parsed).toEqual({
      version: 1,
      lastSyncedUpdatedAt: 1000,
      directories: [{ worktree: "/tmp", lastUpdated: 2000 }],
    });
  });

  it("migrates threadContextBindings", () => {
    const settings: Settings = {
      threadContextBindings: [
        { contextKey: "1:100:10", project: { id: "p1", worktree: "/tmp" }, agent: "build" },
      ],
    };
    migrateSettings(db, settings);
    const rows = db.prepare("SELECT * FROM thread_context_bindings").all() as any[];
    expect(rows).toHaveLength(1);
    expect(rows[0].context_key).toBe("1:100:10");
    expect(JSON.parse(rows[0].project)).toEqual({ id: "p1", worktree: "/tmp" });
  });

  it("migrates scheduledTasks and ignores", () => {
    const settings: Settings = {
      scheduledTasks: [{ id: "daily", kind: "cron", cron: "0 9 * * *", prompt: "Review" } as any],
      scheduledTaskSessionIgnores: [{ sessionId: "s1", createdAt: "2026-06-01T00:00:00Z" }],
    };
    migrateSettings(db, settings);
    const tasksRow = db.prepare("SELECT data FROM scheduled_tasks WHERE key='tasks'").get() as any;
    expect(JSON.parse(tasksRow.data)).toHaveLength(1);
    const ignoresRow = db.prepare("SELECT data FROM scheduled_task_ignores WHERE key='ignores'").get() as any;
    expect(JSON.parse(ignoresRow.data)).toHaveLength(1);
    expect(JSON.parse(ignoresRow.data)[0].sessionId).toBe("s1");
  });

  it("skips legacy global fields", () => {
    const settings: Settings = {
      currentProject: { id: "x", worktree: "/x" },
      currentAgent: "old",
      currentSession: { id: "ls", title: "Legacy", directory: "/legacy" },
      pinnedMessageId: 999,
      scopedUserSettings: { "1": { locale: "ru" } },
    };
    migrateSettings(db, settings);
    expect(db.prepare("SELECT * FROM user_preferences").all()).toHaveLength(1);
    expect(db.prepare("SELECT * FROM conversation_bindings").all()).toHaveLength(0);
  });

  it("handles empty settings", () => {
    expect(() => migrateSettings(db, {} as any)).not.toThrow();
  });
});

describe("migrateIfNeeded", () => {
  let tmpDir: string;
  let settingsPath: string;
  let markerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-if-"));
    settingsPath = path.join(tmpDir, "settings.json");
    markerPath = path.join(tmpDir, "settings.migrated-to-sqlite");
  });
  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates marker and migrates when no marker", async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ scopedUserSettings: { "1": { locale: "en" } } }),
    );
    const db = new Database(":memory:");
    db.exec(MIGRATION_DDL);
    await migrateIfNeeded(db, settingsPath, markerPath);
    expect(fs.existsSync(markerPath)).toBe(true);
    expect((db.prepare("SELECT * FROM user_preferences").get() as any).locale).toBe("en");
  });

  it("skips when marker exists", async () => {
    fs.writeFileSync(
      settingsPath,
      JSON.stringify({ scopedUserSettings: { "1": { locale: "en" } } }),
    );
    fs.writeFileSync(markerPath, "");
    const db = new Database(":memory:");
    db.exec(MIGRATION_DDL);
    await migrateIfNeeded(db, settingsPath, markerPath);
    expect(db.prepare("SELECT * FROM user_preferences").get()).toBeUndefined();
  });

  it("creates empty marker when no settings.json", async () => {
    const db = new Database(":memory:");
    await migrateIfNeeded(db, settingsPath, markerPath);
    expect(fs.existsSync(markerPath)).toBe(true);
  });
});
