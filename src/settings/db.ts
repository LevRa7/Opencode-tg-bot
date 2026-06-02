import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

const DDL = `
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                           INTEGER PRIMARY KEY,
    tts_enabled                       INTEGER NOT NULL DEFAULT 0,
    message_streaming_enabled         INTEGER NOT NULL DEFAULT 1,
    thinking_clear_mode               INTEGER NOT NULL DEFAULT 0,
    locale                            TEXT,
    server_password                  TEXT,
    hide_thinking_messages            INTEGER NOT NULL DEFAULT 0,
    hide_tool_call_messages           INTEGER NOT NULL DEFAULT 0,
    hide_tool_file_messages           INTEGER NOT NULL DEFAULT 0,
    telegraph_translate_enabled       INTEGER NOT NULL DEFAULT 1,
    subagent_topics_enabled           INTEGER NOT NULL DEFAULT 1,
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
CREATE INDEX IF NOT EXISTS idx_access_requests_user ON access_requests(user_id);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    key  TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS scheduled_task_ignores (
    key  TEXT PRIMARY KEY,
    data TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS idx_thread_context_bindings_key ON thread_context_bindings(context_key);
`;

export const SETTINGS_DDL = DDL;

export function openDatabase(filePath: string): Database.Database {
  logger.info("[DB] Opening database", { path: filePath });
  const db = new Database(filePath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(DDL);

  // Ensure server_password column exists (may be missing in databases created from older DDL)
  try {
    db.prepare("ALTER TABLE user_preferences ADD COLUMN server_password TEXT").run();
  } catch {
    // Column already exists — ignore
  }

  logger.info("[DB] Database opened and tables ensured");
  return db;
}

export function closeDatabase(db: Database.Database): void {
  logger.info("[DB] Closing database");
  db.close();
}
