import type Database from "better-sqlite3";

export interface SchedulingRepository {
  getScheduledTasks(): string | null;
  setScheduledTasks(data: string): void;
  getScheduledTaskSessionIgnores(): string | null;
  setScheduledTaskSessionIgnores(data: string): void;
}

export function createSchedulingRepository(db: Database.Database): SchedulingRepository {
  const getTasksStmt = db.prepare("SELECT data FROM scheduled_tasks WHERE key = 'tasks'");
  const upsertTasksStmt = db.prepare(
    "INSERT INTO scheduled_tasks (key, data) VALUES ('tasks', ?) ON CONFLICT(key) DO UPDATE SET data = ?",
  );
  const getIgnoresStmt = db.prepare("SELECT data FROM scheduled_task_ignores WHERE key = 'ignores'");
  const upsertIgnoresStmt = db.prepare(
    "INSERT INTO scheduled_task_ignores (key, data) VALUES ('ignores', ?) ON CONFLICT(key) DO UPDATE SET data = ?",
  );

  return {
    getScheduledTasks(): string | null {
      const row = getTasksStmt.get() as { data: string } | undefined;
      return row?.data ?? null;
    },
    setScheduledTasks(data: string): void {
      upsertTasksStmt.run(data, data);
    },
    getScheduledTaskSessionIgnores(): string | null {
      const row = getIgnoresStmt.get() as { data: string } | undefined;
      return row?.data ?? null;
    },
    setScheduledTaskSessionIgnores(data: string): void {
      upsertIgnoresStmt.run(data, data);
    },
  };
}