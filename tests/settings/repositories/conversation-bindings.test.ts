import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createConversationBindingsRepository } from "../../../src/settings/repositories/conversation-bindings.js";

const DDL = `
CREATE TABLE IF NOT EXISTS conversation_bindings (
    scope_key          TEXT PRIMARY KEY,
    project            TEXT,
    session            TEXT,
    agent              TEXT,
    model              TEXT,
    pinned_message_id  INTEGER,
    reasoning_mode     INTEGER
);
`;

describe("ConversationBindingsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("returns undefined for non-existent scope key", () => {
    const repo = createConversationBindingsRepository(db);
    expect(repo.get("1:2:3")).toBeUndefined();
  });

  it("upserts and retrieves a binding", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { agent: "build", reasoning_mode: 2 });
    const row = repo.get("1:2:3");
    expect(row).toBeDefined();
    expect(row!.agent).toBe("build");
    expect(row!.reasoning_mode).toBe(2);
  });

  it("stores and retrieves JSON value-objects", () => {
    const repo = createConversationBindingsRepository(db);
    const project = JSON.stringify({ id: "p1", worktree: "/tmp" });
    const session = JSON.stringify({ id: "s1", title: "Test", directory: "/tmp" });
    const model = JSON.stringify({ providerID: "openai", modelID: "gpt-5", variant: "high" });
    repo.upsert("1:2:3", { project, session, model, agent: "plan" });
    const row = repo.get("1:2:3");
    expect(JSON.parse(row!.project!)).toEqual({ id: "p1", worktree: "/tmp" });
    expect(JSON.parse(row!.session!)).toEqual({ id: "s1", title: "Test", directory: "/tmp" });
    expect(JSON.parse(row!.model!)).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "high" });
    expect(row!.agent).toBe("plan");
  });

  it("clears individual fields to null", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { agent: "build", project: JSON.stringify({ id: "p1", worktree: "/tmp" }) });
    repo.upsert("1:2:3", { agent: null as unknown as string });
    const row = repo.get("1:2:3");
    expect(row!.agent).toBeNull();
    expect(row!.project).not.toBeNull();
  });

  it("deletes a binding", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { agent: "build" });
    repo.delete("1:2:3");
    expect(repo.get("1:2:3")).toBeUndefined();
  });

  it("pinned_message_id and reasoning_mode accept null", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { pinned_message_id: 42 });
    repo.upsert("1:2:3", { pinned_message_id: null });
    expect(repo.get("1:2:3")!.pinned_message_id).toBeNull();
  });
});
