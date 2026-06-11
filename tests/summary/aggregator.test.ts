import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Event } from "@opencode-ai/sdk/v2";
import { summaryAggregator } from "../../src/summary/aggregator.js";

const mocked = vi.hoisted(() => ({
  getCurrentProjectMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
}));

vi.mock("../../src/settings/manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/settings/manager.js")>(
    "../../src/settings/manager.js",
  );

  return {
    ...actual,
    getCurrentProject: mocked.getCurrentProjectMock,
  };
});

vi.mock("../../src/session/manager.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/session/manager.js")>(
    "../../src/session/manager.js",
  );

  return {
    ...actual,
    getCurrentSession: mocked.getCurrentSessionMock,
  };
});

describe("summary/aggregator", () => {
  beforeEach(() => {
    mocked.getCurrentProjectMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.getCurrentProjectMock.mockReturnValue({ id: "p1", worktree: "D:/repo", name: "repo" });
    mocked.getCurrentSessionMock.mockReturnValue(null);
    summaryAggregator.clear();
    summaryAggregator.setSessionDirectoryResolver(() => null);
    summaryAggregator.setOnCleared(() => {});
    summaryAggregator.setOnTool(() => {});
    summaryAggregator.setOnToolFile(() => {});
    summaryAggregator.setOnPartial(() => {});
    summaryAggregator.setOnThinking(() => {});
    summaryAggregator.setOnSubagent(() => {});
    summaryAggregator.setOnSessionError(() => {});
    summaryAggregator.setOnSessionRetry(() => {});
  });

  it("invokes onCleared callback when aggregator is cleared", () => {
    const onCleared = vi.fn();
    summaryAggregator.setOnCleared(onCleared);

    summaryAggregator.clear();

    expect(onCleared).toHaveBeenCalledTimes(1);
  });

  it("resolves compacted session directory from resolver before falling back", async () => {
    const onSessionCompacted = vi.fn();
    summaryAggregator.setOnSessionCompacted(onSessionCompacted);
    summaryAggregator.setSessionDirectoryResolver((sessionId) =>
      sessionId === "session-1" ? "D:/isolated" : null,
    );
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.compacted",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionCompacted).toHaveBeenCalledWith("session-1", "D:/isolated");
  });

  it("notifies when the current root session becomes idle", async () => {
    const onSessionIdle = vi.fn();
    summaryAggregator.setOnSessionIdle(onSessionIdle);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionIdle).toHaveBeenCalledTimes(1);
    expect(onSessionIdle).toHaveBeenCalledWith("session-1");
  });

  it("keeps emitting assistant partials for an earlier root session after another root session starts", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);

    summaryAggregator.setSession("session-1");
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.setSession("session-2");
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-2",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "text",
          text: "stream from session 1",
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith(
      "session-1",
      "message-1",
      "stream from session 1",
      "",
      [],
    );
  });

  it("keeps delivering question and permission events for all active root sessions", async () => {
    const onQuestion = vi.fn();
    const onPermission = vi.fn();
    summaryAggregator.setOnQuestion(onQuestion);
    summaryAggregator.setOnPermission(onPermission);

    summaryAggregator.setSession("session-1");
    summaryAggregator.setSession("session-2");

    summaryAggregator.processEvent({
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "session-1",
        questions: [{ header: "Question", options: [], multiple: false, question: "Q?" }],
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "permission.asked",
      properties: {
        id: "permission-1",
        sessionID: "session-1",
        permission: "bash",
        patterns: [],
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onQuestion).toHaveBeenCalledWith(
      "session-1",
      expect.arrayContaining([expect.objectContaining({ question: "Q?" })]),
      "question-1",
    );
    expect(onPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: "permission-1", sessionID: "session-1" }),
    );
  });

  it("delivers question and permission events for tracked child sessions", async () => {
    const onQuestion = vi.fn();
    const onPermission = vi.fn();
    summaryAggregator.setOnQuestion(onQuestion);
    summaryAggregator.setOnPermission(onPermission);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-child-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Inspect artifact",
          description: "Inspect artifact",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session-1",
          parentID: "root-session",
          title: "Inspect artifact (@explore subagent)",
          directory: "D:/repo",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "question.asked",
      properties: {
        id: "question-child-1",
        sessionID: "child-session-1",
        questions: [{ header: "Question", options: [], multiple: false, question: "Child Q?" }],
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "permission.asked",
      properties: {
        id: "permission-child-1",
        sessionID: "child-session-1",
        permission: "bash",
        patterns: [],
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onQuestion).toHaveBeenCalledWith(
      "child-session-1",
      expect.arrayContaining([expect.objectContaining({ question: "Child Q?" })]),
      "question-child-1",
    );
    expect(onPermission).toHaveBeenCalledWith(
      expect.objectContaining({ id: "permission-child-1", sessionID: "child-session-1" }),
    );
  });

  it("propagates child session idle and error callbacks after subagent status updates", async () => {
    const onSessionIdle = vi.fn();
    const onSessionError = vi.fn();
    summaryAggregator.setOnSessionIdle(onSessionIdle);
    summaryAggregator.setOnSessionError(onSessionError);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-child-lifecycle",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Inspect artifact",
          description: "Inspect artifact",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session-lifecycle",
          parentID: "root-session",
          title: "Inspect artifact (@explore subagent)",
          directory: "D:/repo",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-session-lifecycle",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "child-session-lifecycle",
        error: {
          data: { message: "Child task failed" },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionIdle).toHaveBeenCalledWith("child-session-lifecycle");
    expect(onSessionError).toHaveBeenCalledWith("child-session-lifecycle", "Child task failed");
  });

  it("includes sessionId in tool callback payload", () => {
    const onTool = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-1",
          tool: "bash",
          state: {
            status: "completed",
            input: {
              command: "npm test",
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        callId: "call-1",
        tool: "bash",
        hasFileAttachment: false,
      }),
    );
  });

  it("emits running bash tool updates when stdout metadata changes", () => {
    const onTool = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-running",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-running-1",
          sessionID: "session-1",
          messageID: "message-running",
          type: "tool",
          callID: "call-running",
          tool: "bash",
          state: {
            status: "running",
            input: {
              command: "python watcher.py",
            },
            metadata: {
              output: '{"ok":true,"data":{"step":"scan-started"}}',
            },
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-running-2",
          sessionID: "session-1",
          messageID: "message-running",
          type: "tool",
          callID: "call-running",
          tool: "bash",
          state: {
            status: "running",
            input: {
              command: "python watcher.py",
            },
            metadata: {
              output:
                '{"ok":true,"data":{"step":"scan-started"}}\n{"ok":true,"data":{"step":"scan-complete"}}',
            },
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(2);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        callId: "call-running",
        tool: "bash",
      }),
    );
    expect(onTool.mock.calls[1][0]).toEqual(
      expect.objectContaining({
        sessionId: "session-1",
        callId: "call-running",
        tool: "bash",
      }),
    );
  });

  it("emits live subagent updates with per-session model, context, cost, and current tool", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Inspect pinned manager",
          description: "task description",
          agent: "explore",
          command: "inspect",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "task-tool-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "tool",
          callID: "task-call-1",
          tool: "task",
          state: {
            status: "running",
            input: {
              description: "Explore project architecture",
              subagent_type: "explore",
              prompt: "Inspect architecture",
            },
            title: "Launching subagent",
            metadata: {},
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-session-1",
          parentID: "root-session",
          title: "Explore project architecture (@explore subagent)",
          slug: "child",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "child-message-1",
          sessionID: "child-session-1",
          role: "assistant",
          parentID: "root-message",
          providerID: "openai",
          modelID: "gpt-5.4",
          agent: "explore",
          path: { cwd: "D:/repo", root: "D:/repo" },
          mode: "all",
          cost: 0.18,
          tokens: {
            input: 54000,
            output: 1200,
            reasoning: 0,
            cache: { read: 1000, write: 0 },
          },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "child-tool-1",
          sessionID: "child-session-1",
          messageID: "child-message-1",
          type: "tool",
          callID: "call-child-1",
          tool: "read",
          state: {
            status: "running",
            input: {
              filePath: "src/pinned/manager.ts",
              offset: 1,
              limit: 280,
            },
            title: "Reading pinned manager",
            metadata: {},
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent).toHaveBeenCalled();
    expect(onSubagent.mock.lastCall?.[0]).toBe("root-session");
    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: "child-session-1",
        parentSessionId: "root-session",
        agent: "explore",
        description: "Explore project architecture",
        status: "running",
        providerID: "openai",
        modelID: "gpt-5.4",
        cost: 0.18,
        currentTool: "read",
        currentToolTitle: "Reading pinned manager",
        currentToolInput: expect.objectContaining({
          filePath: "src/pinned/manager.ts",
          offset: 1,
          limit: 280,
        }),
        tokens: expect.objectContaining({
          input: 54000,
          cacheRead: 1000,
        }),
      }),
    ]);
  });

  it("attaches unknown child session events to pending subagent cards before session.created", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "Explore architecture",
          description: "Explore architecture",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-1",
          sessionID: "child-unknown",
          messageID: "child-message-1",
          type: "step-finish",
          reason: "done",
          cost: 0.12,
          snapshot: "step snapshot",
          tokens: {
            input: 1000,
            output: 50,
            reasoning: 0,
            cache: { read: 200, write: 0 },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: "child-unknown",
        cost: 0.12,
        tokens: expect.objectContaining({ input: 1000, cacheRead: 200 }),
        currentToolTitle: "step snapshot",
      }),
    ]);
  });

  it("keeps unknown child session updates unbound when multiple pending subagents exist", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    for (const [id, description, agent] of [
      ["subtask-1", "first task", "explore"],
      ["subtask-2", "second task", "general"],
    ] as const) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id,
            sessionID: "root-session",
            messageID: "root-message",
            type: "subtask",
            prompt: description,
            description,
            agent,
          },
        },
      } as unknown as Event);
    }

    onSubagent.mockClear();

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-ambiguous",
          sessionID: "child-unknown",
          messageID: "child-message-1",
          type: "step-finish",
          reason: "done",
          cost: 0.12,
          snapshot: "step snapshot",
          tokens: {
            input: 1000,
            output: 50,
            reasoning: 0,
            cache: { read: 200, write: 0 },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent).not.toHaveBeenCalled();
  });

  it("keeps unknown child session updates unbound when multiple root sessions are active", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-a");

    // Regression: root-a has the only pending card, but root-b is also active.
    // An early child event must stay unbound until session.created identifies its parent.
    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-root-a",
          sessionID: "root-a",
          messageID: "root-message-a",
          type: "subtask",
          prompt: "task for root a",
          description: "task for root a",
          agent: "explore",
        },
      },
    } as unknown as Event);

    onSubagent.mockClear();
    summaryAggregator.setSession("root-b");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "step-child-b-early",
          sessionID: "child-b-unknown",
          messageID: "child-message-b",
          type: "step-finish",
          reason: "done",
          cost: 0.07,
          snapshot: "child b early snapshot",
          tokens: {
            input: 600,
            output: 40,
            reasoning: 0,
            cache: { read: 100, write: 0 },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent).not.toHaveBeenCalled();
  });

  it("emits subagent updates under the parent root session instead of the latest current root", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-a");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-root-a",
          sessionID: "root-a",
          messageID: "root-message-a",
          type: "subtask",
          prompt: "task for root a",
          description: "task for root a",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-a",
          parentID: "root-a",
          title: "task for root a (@explore subagent)",
          slug: "child-a",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    onSubagent.mockClear();
    summaryAggregator.setSession("root-b");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "child-tool-a",
          sessionID: "child-a",
          messageID: "child-message-a",
          type: "tool",
          callID: "call-child-a",
          tool: "read",
          state: {
            status: "running",
            input: {
              filePath: "src/example.ts",
            },
            title: "Reading file",
            metadata: {},
            time: { start: Date.now() },
          },
        },
      },
    } as unknown as Event);

    expect(onSubagent).toHaveBeenCalledTimes(1);
    expect(onSubagent.mock.calls[0][0]).toBe("root-a");
    expect(onSubagent.mock.calls[0][1]).toEqual([
      expect.objectContaining({
        parentSessionId: "root-a",
        sessionId: "child-a",
        currentTool: "read",
      }),
    ]);
  });

  it("keeps question.asked visible for an older still-tracked root session", async () => {
    const onQuestion = vi.fn();
    summaryAggregator.setOnQuestion(onQuestion);

    summaryAggregator.setSession("root-a");
    summaryAggregator.setSession("root-b");

    summaryAggregator.processEvent({
      type: "question.asked",
      properties: {
        id: "question-1",
        sessionID: "root-a",
        questions: [
          {
            question: "Proceed with action?",
            header: "Confirm",
            options: [{ label: "Yes", description: "Continue" }],
            multiple: false,
          },
        ],
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onQuestion).toHaveBeenCalledTimes(1);
    expect(onQuestion).toHaveBeenCalledWith(
      "root-a",
      expect.arrayContaining([
        expect.objectContaining({ question: "Proceed with action?", header: "Confirm" }),
      ]),
      "question-1",
    );
  });

  it("tracks multiple parallel subagents independently", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    const subtasks = [
      { id: "subtask-1", agent: "explore", description: "first task", child: "child-1" },
      { id: "subtask-2", agent: "general", description: "second task", child: "child-2" },
    ];

    for (const item of subtasks) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: item.id,
            sessionID: "root-session",
            messageID: "root-message",
            type: "subtask",
            prompt: item.description,
            description: item.description,
            agent: item.agent,
          },
        },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "session.created",
        properties: {
          info: {
            id: item.child,
            parentID: "root-session",
            title: `${item.description} (@${item.agent} subagent)`,
            slug: item.child,
            directory: "D:/repo",
            projectID: "p1",
            version: "1",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `tool-${item.child}`,
            sessionID: item.child,
            messageID: `message-${item.child}`,
            type: "tool",
            callID: `call-${item.child}`,
            tool: "bash",
            state: {
              status: "running",
              input: { command: `echo ${item.child}` },
              title: `Running ${item.child}`,
              metadata: {},
              time: { start: Date.now() },
            },
          },
        },
      } as unknown as Event);
    }

    expect(onSubagent.mock.lastCall?.[1]).toHaveLength(2);
    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({
        sessionId: "child-1",
        description: "first task",
        agent: "explore",
      }),
      expect.objectContaining({
        sessionId: "child-2",
        description: "second task",
        agent: "general",
      }),
    ]);
  });

  it("keeps subagent cards and updates terminal status for child sessions", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "done task",
          description: "done task",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-done",
          parentID: "root-session",
          title: "done task (@explore subagent)",
          slug: "child-done",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-done",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-2",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "failed task",
          description: "failed task",
          agent: "general",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-error",
          parentID: "root-session",
          title: "failed task (@general subagent)",
          slug: "child-error",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "child-error",
        error: {
          data: { message: "Task failed" },
        },
      },
    } as unknown as Event);

    expect(onSubagent.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ sessionId: "child-done", status: "completed" }),
      expect.objectContaining({
        sessionId: "child-error",
        status: "error",
        terminalMessage: "Task failed",
      }),
    ]);
  });

  it("does not emit duplicate completion updates for unchanged completed subagents", () => {
    const onSubagent = vi.fn();
    summaryAggregator.setOnSubagent(onSubagent);
    summaryAggregator.setSession("root-session");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "subtask-1",
          sessionID: "root-session",
          messageID: "root-message",
          type: "subtask",
          prompt: "done task",
          description: "done task",
          agent: "explore",
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.created",
      properties: {
        info: {
          id: "child-done",
          parentID: "root-session",
          title: "done task (@explore subagent)",
          slug: "child-done",
          directory: "D:/repo",
          projectID: "p1",
          version: "1",
          time: { created: Date.now(), updated: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-done",
      },
    } as unknown as Event);

    onSubagent.mockClear();

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "child-done",
      },
    } as unknown as Event);

    expect(onSubagent).not.toHaveBeenCalled();
  });

  it("marks write tool without file attachment when payload is oversized", () => {
    const onTool = vi.fn();
    const onToolFile = vi.fn();
    summaryAggregator.setOnTool(onTool);
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-oversized",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-oversized",
          sessionID: "session-1",
          messageID: "message-oversized",
          type: "tool",
          callID: "call-oversized",
          tool: "write",
          state: {
            status: "completed",
            input: {
              filePath: "src/huge.ts",
              content: "x".repeat(101 * 1024),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onTool).toHaveBeenCalledTimes(1);
    expect(onTool.mock.calls[0][0]).toEqual(
      expect.objectContaining({
        tool: "write",
        hasFileAttachment: false,
      }),
    );
    expect(onToolFile).not.toHaveBeenCalled();
  });

  it("passes sessionId to thinking callback when reasoning part arrives", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-reasoning-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "reasoning",
          text: "Let me think about this...",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("fires thinking callback only once per session run even when multiple assistant messages reason", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-a",
          sessionID: "session-1",
          messageID: "message-a",
          type: "reasoning",
          text: "first thought",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-b",
          sessionID: "session-1",
          messageID: "message-b",
          type: "reasoning",
          text: "second thought",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("allows thinking callback again after session becomes idle", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-first-run",
          sessionID: "session-1",
          messageID: "message-first-run",
          type: "reasoning",
          text: "first run",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-second-run",
          sessionID: "session-1",
          messageID: "message-second-run",
          type: "reasoning",
          text: "second run",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(2);
  });

  it("keeps thinking state when another tracked root session is still active", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);

    summaryAggregator.setSession("session-1");
    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-root-1",
          sessionID: "session-1",
          messageID: "message-root-1",
          type: "reasoning",
          text: "first root thinking",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.setSession("session-2");
    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-1",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-root-2",
          sessionID: "session-2",
          messageID: "message-root-2",
          type: "reasoning",
          text: "second root thinking",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("keeps typing indicator running while another tracked root session stays active", () => {
    vi.useFakeTimers();

    try {
      const sendChatAction = vi.fn().mockResolvedValue(true);
      summaryAggregator.setBotAndChatId(
        {
          api: {
            sendChatAction,
          },
        } as never,
        123,
      );

      summaryAggregator.setSession("session-1");
      summaryAggregator.processEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "message-typing-1",
            sessionID: "session-1",
            role: "assistant",
            time: { created: Date.now() },
          },
        },
      } as unknown as Event);

      summaryAggregator.setSession("session-2");
      summaryAggregator.processEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "message-typing-2",
            sessionID: "session-2",
            role: "assistant",
            time: { created: Date.now() },
          },
        },
      } as unknown as Event);

      expect(sendChatAction).toHaveBeenCalledTimes(1);

      summaryAggregator.processEvent({
        type: "session.idle",
        properties: {
          sessionID: "session-1",
        },
      } as unknown as Event);

      vi.advanceTimersByTime(4000);

      expect(sendChatAction).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it("passes message_thread_id to sendChatAction when messageThreadId is set", () => {
    vi.useFakeTimers();

    try {
      const sendChatAction = vi.fn().mockResolvedValue(true);
      summaryAggregator.setBotAndChatId(
        {
          api: {
            sendChatAction,
          },
        } as never,
        123,
        42,
      );

      summaryAggregator.setSession("session-thread");
      summaryAggregator.processEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "message-thread-typing",
            sessionID: "session-thread",
            role: "assistant",
            time: { created: Date.now() },
          },
        },
      } as unknown as Event);

      expect(sendChatAction).toHaveBeenCalledTimes(1);
      expect(sendChatAction).toHaveBeenCalledWith(123, "typing", {
        message_thread_id: 42,
      });
    } finally {
      vi.useRealTimers();
    }
  });

  it("sends typing without message_thread_id when messageThreadId is not set", () => {
    vi.useFakeTimers();

    try {
      const sendChatAction = vi.fn().mockResolvedValue(true);
      summaryAggregator.setBotAndChatId(
        {
          api: {
            sendChatAction,
          },
        } as never,
        123,
      );

      summaryAggregator.setSession("session-no-thread");
      summaryAggregator.processEvent({
        type: "message.updated",
        properties: {
          info: {
            id: "message-no-thread-typing",
            sessionID: "session-no-thread",
            role: "assistant",
            time: { created: Date.now() },
          },
        },
      } as unknown as Event);

      expect(sendChatAction).toHaveBeenCalledTimes(1);
      expect(sendChatAction).toHaveBeenCalledWith(123, "typing");
    } finally {
      vi.useRealTimers();
    }
  });

  it("clears tracked root bookkeeping after one root errors and another later goes idle", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);

    summaryAggregator.setSession("session-1");
    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-error-1",
          sessionID: "session-1",
          messageID: "message-error-1",
          type: "reasoning",
          text: "first root thinking",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.setSession("session-2");
    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: { message: "boom" },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "session.idle",
      properties: {
        sessionID: "session-2",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-next-run",
          sessionID: "session-2",
          messageID: "message-next-run",
          type: "reasoning",
          text: "second root thinking after cleanup",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(2);
    expect(onThinking).toHaveBeenNthCalledWith(1, "session-1");
    expect(onThinking).toHaveBeenNthCalledWith(2, "session-2");
  });

  it("streams partial text and passes messageId on completion", () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();

    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-stream-1",
          sessionID: "session-1",
          messageID: "message-stream-1",
          type: "text",
          text: "Partial answer",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    const completedAt = Date.now();

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-stream-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: completedAt },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith(
      "session-1",
      "message-stream-1",
      "Partial answer",
      "",
      [],
    );
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-stream-1",
      "Partial answer",
      "",
      [],
      {
        agent: undefined,
        providerID: undefined,
        modelID: undefined,
        logicalMessageId: "message-stream-1",
        completedAt,
      },
    );
  });



  it("combines multiple text parts into a single final message", () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();

    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multipart-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-a",
          sessionID: "session-1",
          messageID: "message-multipart-1",
          type: "text",
          text: "Hello ",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-b",
          sessionID: "session-1",
          messageID: "message-multipart-1",
          type: "text",
          text: "world",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multipart-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenLastCalledWith(
      "session-1",
      "message-multipart-1",
      "Hello world",
      "",
      [],
    );
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-multipart-1",
      "Hello world",
      "",
      [],
      {
        agent: undefined,
        providerID: undefined,
        modelID: undefined,
        logicalMessageId: "message-multipart-1",
        completedAt: expect.any(Number),
      },
    );
  });

  it("starts optimistic partial streaming after second unknown text update", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-unknown-1",
          sessionID: "session-1",
          messageID: "message-unknown-1",
          type: "text",
          text: "H",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-unknown-2",
          sessionID: "session-1",
          messageID: "message-unknown-1",
          type: "text",
          text: "Hello",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledTimes(1);
    expect(onPartial).toHaveBeenCalledWith("session-1", "message-unknown-1", "Hello", "", []);
  });

  it("keeps streaming events for an earlier active root session after another session becomes current", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);

    summaryAggregator.setSession("session-1");
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-s1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.setSession("session-2");
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-s2",
          sessionID: "session-2",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-s1-1",
          sessionID: "session-1",
          messageID: "message-s1",
          type: "text",
          text: "Hello from session 1",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-s1-1",
          sessionID: "session-1",
          messageID: "message-s1",
          type: "text",
          text: "Hello from session 1 again",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith(
      "session-1",
      "message-s1",
      "Hello from session 1 again",
      "",
      [],
    );
  });

  it("does not stream unknown text when only one update arrived", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-unknown-single",
          sessionID: "session-1",
          messageID: "message-unknown-single",
          type: "text",
          text: "Single update",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).not.toHaveBeenCalled();
  });

  it("does not emit partial when pending text is attached on completed message", () => {
    const onPartial = vi.fn();
    const onComplete = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-pending-complete",
          sessionID: "session-1",
          messageID: "message-pending-complete",
          type: "text",
          text: "Final text",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-pending-complete",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).not.toHaveBeenCalled();
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-pending-complete",
      "Final text",
      "",
      [],
      {
        agent: undefined,
        providerID: undefined,
        modelID: undefined,
        logicalMessageId: "message-pending-complete",
        completedAt: expect.any(Number),
      },
    );
  });

  it("streams text from message.part.delta events", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-delta-1",
          sessionID: "session-1",
          messageID: "message-delta-1",
          type: "text",
        },
        delta: "Hel",
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-delta-1",
          sessionID: "session-1",
          messageID: "message-delta-1",
          type: "text",
        },
        delta: "lo",
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenNthCalledWith(1, "session-1", "message-delta-1", "Hel", "", []);
    expect(onPartial).toHaveBeenNthCalledWith(2, "session-1", "message-delta-1", "Hello", "", []);
  });

  it("streams delta events even when part type is omitted", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "part-delta-unknown-type",
          sessionID: "session-1",
          messageID: "message-delta-unknown-type",
        },
        delta: "Hi",
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenCalledWith("session-1", "message-delta-unknown-type", "Hi", "", []);
  });

  it("does not stream unknown delta part after reasoning started", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "reasoning-part-1",
          sessionID: "session-1",
          messageID: "message-reasoning-1",
          type: "reasoning",
          text: "thinking",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.delta",
      properties: {
        part: {
          id: "unknown-part-after-reasoning",
          sessionID: "session-1",
          messageID: "message-reasoning-1",
        },
        delta: "internal thoughts",
      },
    } as unknown as Event);

    expect(onPartial).not.toHaveBeenCalled();
  });

  it("does not send thinking callback when no reasoning part arrives", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    // Only a message.updated event without any reasoning part — should NOT trigger thinking
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-no-reasoning",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-text-1",
          sessionID: "session-1",
          messageID: "message-no-reasoning",
          type: "text",
          text: "Here is my answer.",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).not.toHaveBeenCalled();
  });

  it("fires thinking callback only once per message even with multiple reasoning parts", async () => {
    const onThinking = vi.fn();
    summaryAggregator.setOnThinking(onThinking);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-multi-reasoning",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    for (let i = 0; i < 3; i++) {
      summaryAggregator.processEvent({
        type: "message.part.updated",
        properties: {
          part: {
            id: `part-reasoning-${i}`,
            sessionID: "session-1",
            messageID: "message-multi-reasoning",
            type: "reasoning",
            text: `Thinking step ${i}`,
            time: { start: Date.now() },
          },
        },
      } as unknown as Event);
    }

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onThinking).toHaveBeenCalledTimes(1);
    expect(onThinking).toHaveBeenCalledWith("session-1");
  });

  it("reports session.error message through callback", async () => {
    const onSessionError = vi.fn();
    summaryAggregator.setOnSessionError(onSessionError);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.error",
      properties: {
        sessionID: "session-1",
        error: {
          name: "UnknownError",
          data: {
            message: "Model not found: opencode/foo.",
          },
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionError).toHaveBeenCalledWith("session-1", "Model not found: opencode/foo.");
  });

  it("reports session.status retry through callback", async () => {
    const onSessionRetry = vi.fn();
    summaryAggregator.setOnSessionRetry(onSessionRetry);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "session.status",
      properties: {
        sessionID: "session-1",
        status: {
          type: "retry",
          attempt: 2,
          message: "Your current subscription plan does not yet include access to GLM-5",
          next: 1772203141283,
        },
      },
    } as unknown as Event);

    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(onSessionRetry).toHaveBeenCalledWith({
      sessionId: "session-1",
      attempt: 2,
      message: "Your current subscription plan does not yet include access to GLM-5",
      next: 1772203141283,
    });
  });

  it("sends apply_patch payload as tool file", () => {
    const onToolFile = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-1",
          sessionID: "session-1",
          messageID: "message-1",
          type: "tool",
          callID: "call-apply-patch",
          tool: "apply_patch",
          state: {
            status: "completed",
            input: {
              patchText: "irrelevant for formatter in this path",
            },
            metadata: {
              filediff: {
                file: "D:/repo/src/one.ts",
                additions: 2,
                deletions: 1,
              },
              diff: [
                "@@ -1,2 +1,3 @@",
                "--- a/src/one.ts",
                "+++ b/src/one.ts",
                " old",
                "-before",
                "+after",
                "+extra",
              ].join("\n"),
            },
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).toHaveBeenCalledTimes(1);

    const filePayload = onToolFile.mock.calls[0][0] as {
      sessionId: string;
      tool: string;
      hasFileAttachment: boolean;
      fileData: {
        filename: string;
        buffer: Buffer;
      };
    };

    expect(filePayload.sessionId).toBe("session-1");
    expect(filePayload.tool).toBe("apply_patch");
    expect(filePayload.hasFileAttachment).toBe(true);
    expect(filePayload.fileData.filename).toBe("edit_one.ts.txt");
    expect(filePayload.fileData.buffer.toString("utf8")).toContain("Edit File/Path: src/one.ts");
  });

  it("sends apply_patch file using title and patchText fallback", () => {
    const onToolFile = vi.fn();
    summaryAggregator.setOnToolFile(onToolFile);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-2",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-2",
          sessionID: "session-1",
          messageID: "message-2",
          type: "tool",
          callID: "call-apply-patch-fallback",
          tool: "apply_patch",
          state: {
            status: "completed",
            title: "Success. Updated the following files:\nM README.md",
            input: {
              patchText: [
                "--- a/README.md",
                "+++ b/README.md",
                "@@ -1,1 +1,2 @@",
                " old",
                "+new",
              ].join("\n"),
            },
            metadata: {},
          },
        },
      },
    } as unknown as Event);

    expect(onToolFile).toHaveBeenCalledTimes(1);

    const filePayload = onToolFile.mock.calls[0][0] as {
      hasFileAttachment: boolean;
      fileData: {
        filename: string;
        buffer: Buffer;
      };
    };

    expect(filePayload.hasFileAttachment).toBe(true);
    expect(filePayload.fileData.filename).toBe("edit_README.md.txt");
    expect(filePayload.fileData.buffer.toString("utf8")).toContain("Edit File/Path: README.md");
  });

  it("fires onTokens with isCompleted=true when message has completed timestamp", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setOnComplete(() => {});
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tokens-completed",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-text-tokens",
          sessionID: "session-1",
          messageID: "msg-tokens-completed",
          type: "text",
          text: "Done",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tokens-completed",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 800, output: 200, reasoning: 0, cache: { read: 100, write: 0 } },
          cost: 0.01,
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 800, output: 200, cacheRead: 100 }),
      true,
    );
  });

  it("fires onTokens with isCompleted=false for non-completed message with tokens", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-tokens-intermediate",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 500, output: 50, reasoning: 0, cache: { read: 200, write: 0 } },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 500, output: 50, cacheRead: 200 }),
      false,
    );
  });

  it("fires onTokens for non-completed message with non-zero tokens (intermediate update)", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    // First message with zero tokens (new message starting)
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-step2",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    // The callback IS fired (filtering zero tokens is done at bot/index.ts level)
    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 0, cacheRead: 0 }),
      false,
    );

    onTokens.mockClear();

    // Later update with real tokens
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-step2",
          sessionID: "session-1",
          role: "assistant",
          tokens: { input: 4000, output: 300, reasoning: 0, cache: { read: 12000, write: 0 } },
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).toHaveBeenCalledTimes(1);
    expect(onTokens).toHaveBeenCalledWith(
      expect.objectContaining({ input: 4000, cacheRead: 12000 }),
      false,
    );
  });

  it("does not fire onTokens when message.updated has no tokens field", () => {
    const onTokens = vi.fn();
    summaryAggregator.setOnTokens(onTokens);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "msg-no-tokens",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onTokens).not.toHaveBeenCalled();
  });

  it("fires onComplete only once for a completed assistant message", () => {
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-once",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-complete-once",
          sessionID: "session-1",
          messageID: "message-complete-once",
          type: "text",
          text: "Only once",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-complete-once",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-complete-once",
      "Only once",
      "",
      [],
      {
        agent: undefined,
        providerID: undefined,
        modelID: undefined,
        logicalMessageId: "message-complete-once",
        completedAt: expect.any(Number),
      },
    );
  });

  it("emits completion metadata even when the assistant message has no visible content", () => {
    const onComplete = vi.fn();
    summaryAggregator.setOnComplete(onComplete);
    summaryAggregator.setSession("session-1");
    const completedAt = Date.now();

    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-empty-complete",
          sessionID: "session-1",
          role: "assistant",
          time: { created: Date.now(), completed: completedAt },
        },
      },
    } as unknown as Event);

    expect(onComplete).toHaveBeenCalledTimes(1);
    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-empty-complete",
      "",
      "",
      [],
      {
        agent: undefined,
        providerID: undefined,
        modelID: undefined,
        logicalMessageId: "message-empty-complete",
        completedAt,
      },
    );
  });

  it("keeps first root session partial state after second root session starts", () => {
    const onPartial = vi.fn();
    summaryAggregator.setOnPartial(onPartial);

    summaryAggregator.setSession("session-a");
    summaryAggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-a",
          sessionID: "session-a",
          role: "assistant",
          time: { created: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-a-1",
          sessionID: "session-a",
          messageID: "message-a",
          type: "text",
          text: "Hello",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    summaryAggregator.setSession("session-b");

    summaryAggregator.processEvent({
      type: "message.part.updated",
      properties: {
        part: {
          id: "part-a-2",
          sessionID: "session-a",
          messageID: "message-a",
          type: "text",
          text: " world",
          time: { start: Date.now() },
        },
      },
    } as unknown as Event);

    expect(onPartial).toHaveBeenLastCalledWith("session-a", "message-a", "Hello world", "", []);
  });

  describe("getSessionTree", () => {
    it("returns correct root/child mapping", () => {
      summaryAggregator.setSession("root-1");

      summaryAggregator.processEvent({
        type: "session.created",
        properties: {
          info: {
            id: "child-1",
            parentID: "root-1",
            title: "Child 1",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "session.created",
        properties: {
          info: {
            id: "child-2",
            parentID: "root-1",
            title: "Child 2",
            time: { created: Date.now(), updated: Date.now() },
          },
        },
      } as unknown as Event);

      const tree = summaryAggregator.getSessionTree("root-1");
      expect(tree.rootSessionId).toBe("root-1");
      expect(tree.childSessionIds).toHaveLength(2);
      expect(tree.childSessionIds).toEqual(expect.arrayContaining(["child-1", "child-2"]));
    });

    it("returns empty children when root has no child sessions", () => {
      summaryAggregator.setSession("orphan-root");

      const tree = summaryAggregator.getSessionTree("orphan-root");
      expect(tree.rootSessionId).toBe("orphan-root");
      expect(tree.childSessionIds).toEqual([]);
    });
  });

  describe("getActiveSubagents", () => {
    it("returns only active (non-completed, non-errored) children", () => {
      const onSubagent = vi.fn();
      summaryAggregator.setOnSubagent(onSubagent);
      summaryAggregator.setSession("root-session");

      for (const [id, agent, description] of [
        ["child-completed", "explore", "completed task"],
        ["child-error", "general", "errored task"],
        ["child-pending", "coder", "pending task"],
      ] as const) {
        summaryAggregator.processEvent({
          type: "message.part.updated",
          properties: {
            part: {
              id: `subtask-${id}`,
              sessionID: "root-session",
              messageID: "root-message",
              type: "subtask",
              prompt: description,
              description,
              agent,
            },
          },
        } as unknown as Event);

        summaryAggregator.processEvent({
          type: "session.created",
          properties: {
            info: {
              id,
              parentID: "root-session",
              title: `${description} (@${agent} subagent)`,
              time: { created: Date.now(), updated: Date.now() },
            },
          },
        } as unknown as Event);
      }

      summaryAggregator.processEvent({
        type: "session.idle",
        properties: { sessionID: "child-completed" },
      } as unknown as Event);

      summaryAggregator.processEvent({
        type: "session.error",
        properties: {
          sessionID: "child-error",
          error: { data: { message: "Failed" } },
        },
      } as unknown as Event);

      const active = summaryAggregator.getActiveSubagents("root-session");
      expect(active).toHaveLength(1);
      expect(active[0].sessionId).toBe("child-pending");
      expect(active[0].status).toBe("pending");
    });
  });

  describe("typing indicator lifecycle", () => {
    function createFakeBot(sendChatAction = vi.fn().mockResolvedValue(true)) {
      return { api: { sendChatAction } } as never;
    }

    function setupTypingSession(
      sessionId: string,
      chatId = 123,
      messageThreadId?: number,
      sendChatAction = vi.fn().mockResolvedValue(true),
    ) {
      summaryAggregator.setBotAndChatId(createFakeBot(sendChatAction), chatId, messageThreadId);
      summaryAggregator.setSession(sessionId);
      return sendChatAction;
    }

    function emitAssistantMessage(
      sessionId: string,
      messageId: string,
      time?: { created: number; completed?: number },
    ) {
      summaryAggregator.processEvent({
        type: "message.updated",
        properties: {
          info: {
            id: messageId,
            sessionID: sessionId,
            role: "assistant",
            time: time ?? { created: Date.now() },
          },
        },
      } as unknown as Event);
    }

    function emitMessagePartDelta(
      sessionId: string,
      messageId: string,
      partId: string,
      delta: string,
      partType = "text",
    ) {
      summaryAggregator.processEvent({
        type: "message.part.delta",
        properties: {
          part: {
            id: partId,
            sessionID: sessionId,
            messageID: messageId,
            type: partType,
          },
          delta,
        },
      } as unknown as Event);
    }

    function emitSessionIdle(sessionId: string) {
      summaryAggregator.processEvent({
        type: "session.idle",
        properties: { sessionID: sessionId },
      } as unknown as Event);
    }

    it("stops typing after the last assistant message completes", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1");

        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitAssistantMessage("session-1", "msg-1", {
          created: Date.now() - 1000,
          completed: Date.now(),
        });

        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("stops typing after the last assistant message completes (via session.idle)", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1");

        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitSessionIdle("session-1");

        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT restart typing from late message.part.delta after message completion", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1");

        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitAssistantMessage("session-1", "msg-1", {
          created: Date.now() - 1000,
          completed: Date.now(),
        });

        emitMessagePartDelta("session-1", "msg-1", "part-1", "late text");

        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT restart typing from late reasoning message.part.delta after message completion", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1");

        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitAssistantMessage("session-1", "msg-1", {
          created: Date.now() - 1000,
          completed: Date.now(),
        });

        emitMessagePartDelta("session-1", "msg-1", "reasoning-part-1", "late thinking", "reasoning");

        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("does NOT restart typing from late message.part.delta after session.idle", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1");

        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitSessionIdle("session-1");

        emitMessagePartDelta("session-1", "msg-1", "part-1", "late text after idle");

        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("keeps typing stopped after multiple exit paths (completion then idle)", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1");
        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitAssistantMessage("session-1", "msg-1", {
          created: Date.now() - 1000,
          completed: Date.now(),
        });

        emitSessionIdle("session-1");

        emitMessagePartDelta("session-1", "msg-1", "part-1", "stale delta");

        vi.advanceTimersByTime(4000);
        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(1);
      } finally {
        vi.useRealTimers();
      }
    });

    it("continues typing for other sessions when one session completes", () => {
      vi.useFakeTimers();
      try {
        const sendChatAction = setupTypingSession("session-1");

        emitAssistantMessage("session-1", "msg-1a");
        summaryAggregator.setSession("session-2");
        emitAssistantMessage("session-2", "msg-2a");

        expect(sendChatAction).toHaveBeenCalledTimes(1);

        emitAssistantMessage("session-2", "msg-2a", {
          created: Date.now() - 1000,
          completed: Date.now(),
        });

        emitSessionIdle("session-2");

        emitMessagePartDelta("session-2", "msg-2a", "p-1", "late delta for completed session");

        vi.advanceTimersByTime(4000);
        expect(sendChatAction).toHaveBeenCalledTimes(2);
      } finally {
        vi.useRealTimers();
      }
    });
  });
});
