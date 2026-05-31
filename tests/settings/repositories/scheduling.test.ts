import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSchedulingRepository } from "../../../src/settings/repositories/scheduling.js";

const DDL = `
CREATE TABLE IF NOT EXISTS scheduled_tasks (key TEXT PRIMARY KEY, data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS scheduled_task_ignores (key TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

describe("SchedulingRepository", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); db.exec(DDL); });

  it("returns null for tasks when empty", () => {
    const repo = createSchedulingRepository(db);
    expect(repo.getScheduledTasks()).toBeNull();
  });

  it("sets and retrieves tasks JSON blob", () => {
    const repo = createSchedulingRepository(db);
    const tasks = JSON.stringify([{ id: "task-1", kind: "cron", cron: "0 9 * * *", prompt: "Review" }]);
    repo.setScheduledTasks(tasks);
    expect(repo.getScheduledTasks()).toBe(tasks);
  });

  it("replaces tasks on second set", () => {
    const repo = createSchedulingRepository(db);
    repo.setScheduledTasks(JSON.stringify([{ id: "a" }]));
    repo.setScheduledTasks(JSON.stringify([{ id: "b" }]));
    expect(JSON.parse(repo.getScheduledTasks()!)).toEqual([{ id: "b" }]);
  });

  it("returns null for ignores when empty", () => {
    const repo = createSchedulingRepository(db);
    expect(repo.getScheduledTaskSessionIgnores()).toBeNull();
  });

  it("sets and retrieves ignores JSON blob", () => {
    const repo = createSchedulingRepository(db);
    const ignores = JSON.stringify([{ sessionId: "s1", createdAt: "2026-01-01T00:00:00Z" }]);
    repo.setScheduledTaskSessionIgnores(ignores);
    expect(repo.getScheduledTaskSessionIgnores()).toBe(ignores);
  });
});