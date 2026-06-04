import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

// Column header comments (table registry):
//   1: user_preferences — user-level settings (tts, streaming, locale, etc.)
//   2: conversation_bindings — per-chat binding config (frameworks, models, etc.)
//   3: file_diff_log — file diff change log for recall
//   4: file_edit_session_files — files tracked during edit sessions
//   5: topic_registry — Telegram topic registry
//   6: goals — standing goals for the Ralph goal loop
//      scope_key | state (JSON GoalState)

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

CREATE TABLE IF NOT EXISTS subdomains (
    user_id         INTEGER PRIMARY KEY,
    username        TEXT NOT NULL,
    subdomain       TEXT NOT NULL UNIQUE,
    password_hash   TEXT NOT NULL,
    kind            TEXT NOT NULL,
    ssh_connection_id TEXT,
    hostname        TEXT,
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_subdomains_subdomain ON subdomains(subdomain);

CREATE TABLE IF NOT EXISTS schema_version (
    version INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS telegraph_keys (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    token_encrypted TEXT NOT NULL,
    author_name TEXT,
    is_active INTEGER NOT NULL DEFAULT 1,
    last_used_at INTEGER,
    flood_wait_until INTEGER DEFAULT 0,
    usage_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_telegraph_keys_select ON telegraph_keys(user_id, is_active, flood_wait_until, last_used_at);

CREATE TABLE IF NOT EXISTS file_diff_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    telegraph_url TEXT,
    telegraph_path TEXT,
    telegraph_key_id INTEGER REFERENCES telegraph_keys(id) ON DELETE SET NULL,
    diff_content TEXT NOT NULL,
    diff_size_bytes INTEGER NOT NULL CHECK(diff_size_bytes > 0 AND diff_size_bytes <= 102400),
    continued_to_id INTEGER REFERENCES file_diff_log(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_file_diff_log_user_file ON file_diff_log(user_id, file_path, id DESC);

CREATE TABLE IF NOT EXISTS file_edit_session_files (
    file_diff_log_id INTEGER NOT NULL REFERENCES file_diff_log(id) ON DELETE CASCADE,
    file_path TEXT NOT NULL,
    telegraph_url TEXT,
    session_id TEXT,
    PRIMARY KEY (file_diff_log_id, file_path)
);

CREATE TABLE IF NOT EXISTS topic_registry (
    scope_key TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL,
    chat_id INTEGER NOT NULL,
    message_thread_id INTEGER DEFAULT 0,
    topic_name TEXT,
    kind TEXT NOT NULL CHECK(kind IN ('main','ssh','subagent')),
    server_connection_id TEXT,
    bound_session_id TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_topic_registry_user_kind ON topic_registry(user_id, is_deleted, kind);
CREATE INDEX IF NOT EXISTS idx_topic_registry_server ON topic_registry(server_connection_id) WHERE server_connection_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS goals (
    scope_key TEXT PRIMARY KEY,
    state TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);


`;

export const SETTINGS_DDL = DDL;

export function openDatabase(filePath: string): Database.Database {
  logger.info("[DB] Opening database", { path: filePath });
  const db = new Database(filePath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(DDL);

  // Ensure schema_version table and run V2 migration if needed
  {
    const ver = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='schema_version'").get();
    if (!ver) {
    }
  }

  // Ensure server_password column exists (may be missing in databases created from older DDL)
  try {
    db.prepare("ALTER TABLE user_preferences ADD COLUMN server_password TEXT").run();
  } catch {
    // Column already exists — ignore
  }

  try {
    db.prepare("ALTER TABLE subdomains ADD COLUMN ssh_connection_id TEXT").run();
  } catch { /* ignore */ }
  try {
    db.prepare("ALTER TABLE subdomains ADD COLUMN hostname TEXT").run();
  } catch { /* ignore */ }

  logger.info("[DB] Database opened and tables ensured");
  return db;
}

export function closeDatabase(db: Database.Database): void {
  logger.info("[DB] Closing database");
  db.close();
}
