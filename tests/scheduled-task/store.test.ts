import os from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setRuntimeMode } from "../../src/runtime/mode.js";
import { __resetSettingsForTests, loadSettings } from "../../src/settings/manager.js";
import {
  addScheduledTask,
  getScheduledTask,
  listScheduledTasks,
  removeScheduledTask,
} from "../../src/scheduled-task/store.js";
import type { ScheduledTask } from "../../src/scheduled-task/types.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

function createScheduledTask(overrides: Partial<ScheduledTask> = {}): ScheduledTask {
  return {
    id: "task-1",
    kind: "cron",
    projectId: "project-1",
    projectWorktree: "D:/Projects/Repo",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    },
    scheduleText: "every 5 minutes",
    scheduleSummary: "Every 5 minutes",
    timezone: "UTC",
    cron: "*/5 * * * *",
    prompt: "Check repository status",
    createdAt: "2026-03-15T10:00:00.000Z",
    nextRunAt: "2026-03-15T10:05:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
    ...overrides,
  } as ScheduledTask;
}

describe("scheduled-task/store", () => {
  let tempHome: string;

  beforeEach(async () => {
    tempHome = await mkdtemp(path.join(os.tmpdir(), "opencode-telegram-task-store-"));
    process.env.OPENCODE_TELEGRAM_HOME = tempHome;
    setRuntimeMode("installed");
    __resetSettingsForTests();
    await loadSettings();
  });

  afterEach(async () => {
    delete process.env.OPENCODE_TELEGRAM_HOME;
    __resetSettingsForTests();
    await rm(tempHome, { recursive: true, force: true });
  });

  it("persists scheduled tasks to settings.json", async () => {
    const task = createScheduledTask();

    await addScheduledTask(task);

    expect(listScheduledTasks()).toEqual([task]);

    const settingsPath = path.join(tempHome, "settings.json");
    const settingsFile = JSON.parse(await readFile(settingsPath, "utf-8")) as {
      scheduledTasks?: ScheduledTask[];
    };

    expect(settingsFile.scheduledTasks).toEqual([task]);
  });

  it("removes scheduled task from persisted storage", async () => {
    const firstTask = createScheduledTask();
    const secondTask = createScheduledTask({
      id: "task-2",
      kind: "once",
      scheduleText: "tomorrow at 12:00",
      scheduleSummary: "Tomorrow at 12:00",
      runAt: "2026-03-16T12:00:00.000Z",
      cron: undefined,
      nextRunAt: "2026-03-16T12:00:00.000Z",
    });

    await addScheduledTask(firstTask);
    await addScheduledTask(secondTask);

    await removeScheduledTask("task-1");

    expect(listScheduledTasks()).toEqual([secondTask]);
  });

  it("filters scheduled tasks by owner scope", async () => {
    const adminTask = createScheduledTask({
      id: "admin-task",
      ownerScope: { userId: 123456789, chatId: 123456789 },
    });
    const userTask = createScheduledTask({
      id: "user-task",
      ownerScope: { userId: 555, chatId: 555 },
    });

    await addScheduledTask(adminTask);
    await addScheduledTask(userTask);

    expect(
      runWithTelegramConversationScope({ userId: 123456789, chatId: 123456789 }, () =>
        listScheduledTasks(),
      ),
    ).toEqual([adminTask]);
    expect(
      runWithTelegramConversationScope({ userId: 555, chatId: 555 }, () => listScheduledTasks()),
    ).toEqual([userTask]);
  });

  it("does not remove another user's scheduled task from scoped access", async () => {
    const adminTask = createScheduledTask({
      id: "admin-task",
      ownerScope: { userId: 123456789, chatId: 123456789 },
    });
    const userTask = createScheduledTask({
      id: "user-task",
      ownerScope: { userId: 555, chatId: 555 },
    });

    await addScheduledTask(adminTask);
    await addScheduledTask(userTask);

    await runWithTelegramConversationScope({ userId: 555, chatId: 555 }, () =>
      removeScheduledTask("admin-task"),
    );

    expect(getScheduledTask("admin-task")).toEqual(adminTask);
    expect(listScheduledTasks()).toEqual([adminTask, userTask]);
  });
});
