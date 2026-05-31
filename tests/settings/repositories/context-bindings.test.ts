import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createContextBindingsRepository } from "../../../src/settings/repositories/context-bindings.js";

const DDL = `
CREATE TABLE IF NOT EXISTS thread_context_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, context_key TEXT NOT NULL,
    project TEXT, session TEXT, agent TEXT, model TEXT
);
`;

describe("ContextBindingsRepository", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); db.exec(DDL); });

  it("returns empty array when no bindings", () => {
    const repo = createContextBindingsRepository(db);
    expect(repo.getAll()).toEqual([]);
  });

  it("sets and retrieves bindings (auto-assigns IDs)", () => {
    const repo = createContextBindingsRepository(db);
    const bindings = [
      { context_key: "1:100:10", project: JSON.stringify({ id: "p1", worktree: "/tmp" }), session: null, agent: "build", model: null },
      { context_key: "2:200:20", project: null, session: null, agent: "plan", model: JSON.stringify({ providerID: "openai", modelID: "gpt-5", variant: "high" }) },
    ];
    repo.setBindings(bindings);
    const result = repo.getAll();
    expect(result).toHaveLength(2);
    expect(result[0].agent).toBe("build");
    expect(result[1].context_key).toBe("2:200:20");
    expect(result[0].id).toEqual(expect.any(Number));
    expect(result[1].id).toEqual(expect.any(Number));
  });

  it("replaces existing bindings on set", () => {
    const repo = createContextBindingsRepository(db);
    repo.setBindings([{ context_key: "1:1:1", project: null, session: null, agent: "x", model: null }]);
    repo.setBindings([{ context_key: "2:2:2", project: null, session: null, agent: "y", model: null }]);
    const result = repo.getAll();
    expect(result).toHaveLength(1);
    expect(result[0].agent).toBe("y");
  });
});
