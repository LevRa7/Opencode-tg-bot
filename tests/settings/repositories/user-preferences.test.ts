import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserPreferencesRepository } from "../../../src/settings/repositories/user-preferences.js";

const DDL = `
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
`;

describe("UserPreferencesRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("returns undefined for non-existent user", () => {
    const repo = createUserPreferencesRepository(db);
    expect(repo.get(999)).toBeUndefined();
  });

  it("creates a row via upsert and retrieves it", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru", tts_enabled: 1 });
    const row = repo.get(1);
    expect(row).toBeDefined();
    expect(row!.locale).toBe("ru");
    expect(row!.tts_enabled).toBe(1);
  });

  it("updates an existing row via upsert", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "en" });
    repo.upsert(1, { locale: "ru", tts_enabled: 1 });
    const row = repo.get(1);
    expect(row!.locale).toBe("ru");
    expect(row!.tts_enabled).toBe(1);
  });

  it("preserves untouched fields on upsert", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru", tts_enabled: 1 });
    repo.upsert(1, { locale: "en" });
    const row = repo.get(1);
    expect(row!.locale).toBe("en");
    expect(row!.tts_enabled).toBe(1);
  });

  it("stores and retrieves JSON value-object (default_project)", () => {
    const repo = createUserPreferencesRepository(db);
    const project = { id: "proj-1", worktree: "/tmp/repo", name: "Test" };
    repo.upsert(1, { default_project: JSON.stringify(project) });
    const row = repo.get(1);
    expect(JSON.parse(row!.default_project!)).toEqual(project);
  });

  it("stores and retrieves JSON value-object (default_model)", () => {
    const repo = createUserPreferencesRepository(db);
    const model = { providerID: "openai", modelID: "gpt-5", variant: "high" };
    repo.upsert(1, { default_model: JSON.stringify(model) });
    const row = repo.get(1);
    expect(JSON.parse(row!.default_model!)).toEqual(model);
  });

  it("uses default values (0/1/empty) for new row fields not explicitly set", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(42, {});
    const row = repo.get(42);
    expect(row).toBeDefined();
    expect(row!.tts_enabled).toBe(0);
    expect(row!.message_streaming_enabled).toBe(1);
  });

  it("returns all users", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru" });
    repo.upsert(2, { locale: "en" });
    const all = repo.getAll();
    expect(all).toHaveLength(2);
  });

  it("deletes a user preferences row", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru" });
    repo.delete(1);
    expect(repo.get(1)).toBeUndefined();
  });
});
