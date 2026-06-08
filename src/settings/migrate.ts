import type Database from "better-sqlite3";
import type { Settings } from "./manager.js";
import { logger } from "../utils/logger.js";

export function migrateSettings(db: Database.Database, settings: Settings): void {
  logger.info("[Migration] Starting settings.json → SQLite migration");

  const runMigration = db.transaction(() => {
    if (settings.scopedUserSettings) {
      const stmt = db.prepare(
        `INSERT INTO user_preferences (user_id, tts_enabled, message_streaming_enabled, thinking_clear_mode, locale, hide_thinking_messages, hide_tool_call_messages, hide_tool_file_messages, telegraph_translate_enabled, subagent_topics_enabled, subagent_topic_auto_delete_minutes, default_project, default_agent, default_model) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const [userIdStr, us] of Object.entries(settings.scopedUserSettings)) {
        stmt.run(
          Number(userIdStr),
          us.ttsEnabled === true ? 1 : 0,
          us.messageStreamingEnabled === false ? 0 : 1,
          us.thinkingClearMode === true ? 1 : 0,
          us.locale ?? null,
          us.hideThinkingMessages === true ? 1 : 0,
          us.hideToolCallMessages === true ? 1 : 0,
          us.hideToolFileMessages === true ? 1 : 0,
          us.telegraphTranslateEnabled === false ? 0 : 1,
          us.subagentTopicsEnabled === false ? 0 : 1,
          typeof us.subagentTopicAutoDeleteMinutes === "number"
            ? us.subagentTopicAutoDeleteMinutes
            : 1,
          us.defaultProject ? JSON.stringify(us.defaultProject) : null,
          us.defaultAgent ?? null,
          us.defaultModel ? JSON.stringify(us.defaultModel) : null,
        );
      }
    }

    if (settings.scopedConversationSettings) {
      const stmt = db.prepare(
        `INSERT INTO conversation_bindings (scope_key, project, session, agent, model, pinned_message_id, reasoning_mode) VALUES (?,?,?,?,?,?,?)`,
      );
      for (const [scopeKey, cs] of Object.entries(settings.scopedConversationSettings)) {
        stmt.run(
          scopeKey,
          cs.currentProject ? JSON.stringify(cs.currentProject) : null,
          cs.currentSession ? JSON.stringify(cs.currentSession) : null,
          cs.currentAgent ?? null,
          cs.currentModel ? JSON.stringify(cs.currentModel) : null,
          cs.pinnedMessageId ?? null,
          cs.reasoningMode ?? null,
        );
      }
    }

    if (settings.approvedTelegramUserIds?.length) {
      const stmt = db.prepare("INSERT INTO approved_users (user_id) VALUES (?)");
      for (const userId of settings.approvedTelegramUserIds) stmt.run(userId);
    }

    if (settings.pendingAccessRequests?.length) {
      const stmt = db.prepare(
        "INSERT INTO access_requests (user_id, first_name, last_name, username, requested_at) VALUES (?,?,?,?,?)",
      );
      for (const req of settings.pendingAccessRequests) {
        stmt.run(
          req.userId,
          req.firstName ?? null,
          req.lastName ?? null,
          req.username ?? null,
          req.requestedAt,
        );
      }
    }

    if (settings.scheduledTasks?.length) {
      db.prepare("INSERT INTO scheduled_tasks (key, data) VALUES ('tasks', ?)").run(
        JSON.stringify(settings.scheduledTasks),
      );
    }

    if (settings.scheduledTaskSessionIgnores?.length) {
      db.prepare("INSERT INTO scheduled_task_ignores (key, data) VALUES ('ignores', ?)").run(
        JSON.stringify(settings.scheduledTaskSessionIgnores),
      );
    }

    if (settings.serverProcess) {
      db.prepare("INSERT INTO server_process (key, data) VALUES ('current', ?)").run(
        JSON.stringify(settings.serverProcess),
      );
    }

    if (settings.lastRestartRequest) {
      db.prepare("INSERT INTO last_restart_request (key, data) VALUES ('current', ?)").run(
        JSON.stringify(settings.lastRestartRequest),
      );
    }

    if (settings.tenantRuntimes) {
      const stmt = db.prepare("INSERT INTO tenant_runtimes (user_id, data) VALUES (?, ?)");
      for (const [userIdStr, rt] of Object.entries(settings.tenantRuntimes)) {
        stmt.run(Number(userIdStr), JSON.stringify(rt));
      }
    }

    if (settings.attachedSessions) {
      const stmt = db.prepare("INSERT INTO attached_sessions (scope_key, session) VALUES (?,?)");
      for (const [key, att] of Object.entries(settings.attachedSessions)) {
        stmt.run(key, att.session ? JSON.stringify(att.session) : null);
      }
    }

    if (settings.scopedSessionDirectoryCache) {
      const stmt = db.prepare(
        "INSERT INTO session_directory_cache (scope_key, data) VALUES (?, ?)",
      );
      for (const [userKey, cache] of Object.entries(settings.scopedSessionDirectoryCache)) {
        if (cache.directories.length > 0) stmt.run(userKey, JSON.stringify(cache));
      }
    }

    if (settings.threadContextBindings?.length) {
      const stmt = db.prepare(
        "INSERT INTO thread_context_bindings (context_key, project, session, agent, model) VALUES (?,?,?,?,?)",
      );
      for (const b of settings.threadContextBindings) {
        stmt.run(
          b.contextKey,
          b.project ? JSON.stringify(b.project) : null,
          b.session ? JSON.stringify(b.session) : null,
          b.agent ?? null,
          b.model ? JSON.stringify(b.model) : null,
        );
      }
    }
  });

  runMigration();
  logger.info("[Migration] settings.json → SQLite migration completed");
}

export async function migrateIfNeeded(
  db: Database.Database,
  settingsFilePath: string,
  markerFilePath: string,
): Promise<void> {
  const fs = await import("node:fs/promises");
  try {
    await fs.access(markerFilePath);
    logger.info("[Migration] Marker exists, skipping");
    return;
  } catch {
    // marker does not exist, proceed
  }
  let settingsJson: string;
  try {
    settingsJson = await fs.readFile(settingsFilePath, "utf-8");
  } catch {
    logger.info("[Migration] No settings.json, fresh start");
    await fs.writeFile(markerFilePath, "");
    return;
  }
  const settings: Settings = JSON.parse(settingsJson);
  migrateSettings(db, settings);
  await fs.writeFile(markerFilePath, "");
  logger.info("[Migration] Done, marker created");
}

export function migrateV2(db: any): void {
  const logger = {
    info: (msg: string, ...args: any[]) => console.log("[Migration] " + msg, ...args),
    warn: (msg: string, ...args: any[]) => console.warn("[Migration] " + msg, ...args),
  };

  const runV2 = db.transaction(() => {
    const tables = db.prepare(
      "SELECT name FROM sqlite_master WHERE type=\x27table\x27 AND name=\x27schema_version\x27"
    ).get();

    if (!tables) {
      db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL DEFAULT 1)");
      db.prepare("INSERT INTO schema_version (version) VALUES (2)").run();
      logger.info("V2 schema_version table created");
    }

    const cols = db.prepare("PRAGMA table_info(conversation_bindings)").all();
    const hasServerConn = cols.some((c: any) => c.name === "server_connection_id");
    if (!hasServerConn) {
      try {
        db.prepare("ALTER TABLE conversation_bindings ADD COLUMN server_connection_id TEXT").run();
        logger.info("Added server_connection_id to conversation_bindings");
      } catch (e) {
        logger.warn("ALTER TABLE server_connection_id failed:", e);
      }
    }

    const hasBindings = db.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='telegraph_article_bindings'"
    ).get();
    if (!hasBindings) {
      db.exec(
        `CREATE TABLE IF NOT EXISTS telegraph_article_bindings (
           id          INTEGER PRIMARY KEY AUTOINCREMENT,
           user_id     INTEGER NOT NULL,
           path        TEXT UNIQUE NOT NULL,
           key_id      INTEGER NOT NULL REFERENCES telegraph_keys(id) ON DELETE CASCADE,
           created_at  INTEGER NOT NULL
         );
         CREATE INDEX IF NOT EXISTS idx_tg_article_bind_path ON telegraph_article_bindings(path);
         CREATE INDEX IF NOT EXISTS idx_tg_article_bind_user ON telegraph_article_bindings(user_id);`
      );
      logger.info("Created telegraph_article_bindings table");
    }
  });

  runV2();
  logger.info("V2 schema migration completed");
}
