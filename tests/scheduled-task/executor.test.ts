import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  createMock: vi.fn(),
  promptAsyncMock: vi.fn(),
  messagesMock: vi.fn(),
  statusMock: vi.fn(),
  abortMock: vi.fn(),
  deleteMock: vi.fn(),
  questionListMock: vi.fn(),
  questionRejectMock: vi.fn(),
  permissionListMock: vi.fn(),
  permissionReplyMock: vi.fn(),
  loggerWarnMock: vi.fn(),
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: mocked.createMock,
      promptAsync: mocked.promptAsyncMock,
      messages: mocked.messagesMock,
      status: mocked.statusMock,
      abort: mocked.abortMock,
      delete: mocked.deleteMock,
    },
    question: {
      list: mocked.questionListMock,
      reject: mocked.questionRejectMock,
    },
    permission: {
      list: mocked.permissionListMock,
      reply: mocked.permissionReplyMock,
    },
  },
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: mocked.loggerWarnMock,
    error: vi.fn(),
  },
}));

vi.mock("../../src/scheduled-task/session-ignore.js", () => ({
  cleanupScheduledTaskSessionIgnores: vi.fn().mockResolvedValue(0),
  registerScheduledTaskSessionIgnore: vi.fn().mockResolvedValue(undefined),
}));

import type { ScheduledOnceTask } from "../../src/scheduled-task/types.js";

function createTask(partial: Partial<ScheduledOnceTask> = {}): ScheduledOnceTask {
  return {
    id: "task-1",
    kind: "once",
    projectId: "project-1",
    projectWorktree: "D:\\Projects\\Repo",
    model: {
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    },
    scheduleText: "tomorrow at 12:00",
    scheduleSummary: "Tomorrow at 12:00",
    timezone: "UTC",
    runAt: "2026-03-16T10:00:00.000Z",
    prompt: "Check weather forecast",
    createdAt: "2026-03-16T09:00:00.000Z",
    nextRunAt: "2026-03-16T10:00:00.000Z",
    lastRunAt: null,
    runCount: 0,
    lastStatus: "idle",
    lastError: null,
    ...partial,
  };
}

function createAssistantMessage(
  text: string,
  options: {
    completed?: boolean;
    error?: unknown;
    summary?: boolean;
    parts?: Array<Record<string, unknown>>;
  } = {},
) {
  return {
    info: {
      id: "assistant-1",
      role: "assistant",
      time: {
        created: 1_700_000_000_000,
        completed: options.completed ? 1_700_000_000_500 : undefined,
        cache: { read: 0, write: 0 },
      },
      error: options.error,
      summary: options.summary,
    },
    parts:
      options.parts ??
      (text
        ? [{ id: "part-1", sessionID: "session-1", messageID: "assistant-1", type: "text", text }]
        : []),
  };
}

describe("scheduled-task/executor", () => {
  beforeEach(() => {
    mocked.createMock.mockReset();
    mocked.promptAsyncMock.mockReset();
    mocked.messagesMock.mockReset();
    mocked.statusMock.mockReset();
    mocked.abortMock.mockReset();
    mocked.deleteMock.mockReset();
    mocked.questionListMock.mockReset();
    mocked.questionRejectMock.mockReset();
    mocked.permissionListMock.mockReset();
    mocked.permissionReplyMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.questionListMock.mockResolvedValue({ data: [], error: null });
    mocked.questionRejectMock.mockResolvedValue({ data: true, error: null });
    mocked.permissionListMock.mockResolvedValue({ data: [], error: null });
    mocked.permissionReplyMock.mockResolvedValue({ data: true, error: null });
    mocked.abortMock.mockResolvedValue({ data: true, error: null });
    mocked.deleteMock.mockResolvedValue(undefined);
  });

  it("creates a session, sends prompt, and returns the result", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [createAssistantMessage("Done", { completed: true })],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Done",
      errorMessage: null,
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("fails when session creation returns an error", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: null,
      error: new Error("create failed"),
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "create failed",
    });
    expect(mocked.deleteMock).not.toHaveBeenCalled();
  });

  it("fails when promptAsync returns an error", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({
      data: undefined,
      error: new Error("prompt failed"),
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "prompt failed",
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("fails when assistant response has an error", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [createAssistantMessage("", { completed: true, error: new Error("API error") })],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: expect.stringContaining("API error"),
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("fails, logs diagnostics, keeps session, and cleans up when empty completed assistant response persists", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValue({
      data: [createAssistantMessage("", { completed: true })],
      error: null,
    });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(
      createTask({
        kind: "once",
        runAt: new Date(Date.now() + 10000).toISOString(),
      } as Partial<ScheduledOnceTask>),
    );

    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage: "Scheduled task returned an empty assistant response",
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(4);
    expect(mocked.deleteMock).not.toHaveBeenCalled();
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      "[ScheduledTaskExecutor] Empty completed assistant response diagnostics",
      expect.objectContaining({
        taskId: "task-1",
        sessionId: "session-1",
        directory: "D:\\Projects\\Repo",
        readCount: 4,
        assistantMessage: expect.objectContaining({
          completed: true,
          summary: false,
          parts: [],
        }),
      }),
    );
    expect(mocked.loggerWarnMock).toHaveBeenCalledWith(
      expect.stringContaining("Keeping temporary session for inspection"),
    );

    vi.useRealTimers();
  });

  it("re-reads an empty completed assistant reply before accepting late text", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock
      .mockResolvedValueOnce({
        data: [createAssistantMessage("", { completed: true })],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [createAssistantMessage("", { completed: true })],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [createAssistantMessage("", { completed: true })],
        error: null,
      })
      .mockResolvedValueOnce({
        data: [createAssistantMessage("Late completed output", { completed: true })],
        error: null,
      });

    vi.useFakeTimers();

    const resultPromise = executeScheduledTask(createTask());

    await vi.advanceTimersByTimeAsync(1500);

    await expect(resultPromise).resolves.toMatchObject({
      status: "success",
      resultText: "Late completed output",
      errorMessage: null,
    });
    expect(mocked.messagesMock).toHaveBeenCalledTimes(4);
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });

    vi.useRealTimers();
  });

  it("ignores technical summary assistant messages when finding the scheduled task result", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [
        createAssistantMessage("Real scheduled result", { completed: true }),
        createAssistantMessage("", { completed: true, summary: true }),
      ],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Real scheduled result",
      errorMessage: null,
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("fails, rejects, aborts, and cleans up when scheduled task asks a question", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.questionListMock.mockResolvedValueOnce({
      data: [
        {
          id: "question-1",
          sessionID: "session-1",
          questions: [{ header: "Choice", question: "Continue?", options: [] }],
        },
      ],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage:
        "Scheduled task requested an interactive question and cannot continue unattended.",
    });
    expect(mocked.questionRejectMock).toHaveBeenCalledWith({
      requestID: "question-1",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.abortMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(mocked.messagesMock).not.toHaveBeenCalled();
  });

  it("fails, rejects, aborts, and cleans up when scheduled task asks permission", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.permissionListMock.mockResolvedValueOnce({
      data: [
        {
          id: "permission-1",
          sessionID: "session-1",
          permission: "edit",
          patterns: ["src/index.ts"],
          metadata: {},
          always: [],
        },
      ],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "error",
      resultText: null,
      errorMessage:
        "Scheduled task requested interactive permission and cannot continue unattended.",
    });
    expect(mocked.permissionReplyMock).toHaveBeenCalledWith({
      requestID: "permission-1",
      directory: "D:\\Projects\\Repo",
      reply: "reject",
      message: "Scheduled task cannot continue because it requires interactive permission.",
    });
    expect(mocked.abortMock).toHaveBeenCalledWith({
      sessionID: "session-1",
      directory: "D:\\Projects\\Repo",
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
    expect(mocked.messagesMock).not.toHaveBeenCalled();
  });

  it("ignores pending interactive requests for other sessions", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.questionListMock.mockResolvedValueOnce({
      data: [
        {
          id: "question-1",
          sessionID: "other-session",
          questions: [{ header: "Choice", question: "Continue?", options: [] }],
        },
      ],
      error: null,
    });
    mocked.permissionListMock.mockResolvedValueOnce({
      data: [
        {
          id: "permission-1",
          sessionID: "other-session",
          permission: "edit",
          patterns: ["src/index.ts"],
          metadata: {},
          always: [],
        },
      ],
      error: null,
    });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [createAssistantMessage("Done", { completed: true })],
      error: null,
    });

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Done",
      errorMessage: null,
    });
    expect(mocked.questionRejectMock).not.toHaveBeenCalled();
    expect(mocked.permissionReplyMock).not.toHaveBeenCalled();
    expect(mocked.abortMock).not.toHaveBeenCalled();
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });

  it("keeps the successful result even if temporary session cleanup fails", async () => {
    const { executeScheduledTask } = await import("../../src/scheduled-task/executor.js");

    mocked.createMock.mockResolvedValueOnce({
      data: { id: "session-1", directory: "D:\\Projects\\Repo", title: "Scheduled task run" },
      error: null,
    });
    mocked.promptAsyncMock.mockResolvedValueOnce({ data: undefined, error: null });
    mocked.messagesMock.mockResolvedValueOnce({
      data: [createAssistantMessage("Success", { completed: true })],
      error: null,
    });
    mocked.deleteMock.mockRejectedValueOnce(new Error("cleanup failed"));

    await expect(executeScheduledTask(createTask())).resolves.toMatchObject({
      status: "success",
      resultText: "Success",
      errorMessage: null,
    });
    expect(mocked.deleteMock).toHaveBeenCalledWith({ sessionID: "session-1" });
  });
});
