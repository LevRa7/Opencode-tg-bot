import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

vi.mock("../../src/config.js", async () => {
  const actual = await vi.importActual<typeof import("../../src/config.js")>("../../src/config.js");
  return {
    ...actual,
    config: {
      ...actual.config,
      bot: {
        ...actual.config.bot,
        responseStreaming: false,
      },
    },
  };
});

const mocked = vi.hoisted(() => ({
  settingsFilePath: `${process.env.TMPDIR ?? "/home/me/.claude/debug"}/opencode-telegram-bot-settings-manager.test.json`,
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: vi.fn(() => ({
    settingsFilePath: mocked.settingsFilePath,
  })),
}));

import {
  __resetSettingsForTests,
  clearCurrentAgent,
  clearCurrentModel,
  clearPinnedMessageId,
  clearProject,
  clearSession,
  getCurrentAgent,
  getCurrentModel,
  getCurrentProject,
  getCurrentSession,
  getReasoningMode,
  getThinkingClearMode,
  getPinnedMessageId,
  isMessageStreamingEnabled,
  setCurrentAgent,
  setCurrentModel,
  setCurrentProject,
  setCurrentSession,
  setReasoningMode,
  setThinkingClearMode,
  setPinnedMessageId,
  setMessageStreamingEnabled,
} from "../../src/settings/manager.js";

describe("settings/manager scoped state", () => {
  const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
  const scopeAOtherTopic: TelegramConversationScope = {
    userId: 1,
    chatId: 100,
    messageThreadId: 11,
  };
  const scopeAMainThread: TelegramConversationScope = {
    userId: 1,
    chatId: 100,
    messageThreadId: 0,
  };
  const scopeB: TelegramConversationScope = { userId: 2, chatId: 100, messageThreadId: 10 };

  beforeEach(() => {
    __resetSettingsForTests();
  });

  it("isolates project and session state by user scope", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setCurrentProject({ id: "project-a", worktree: "/repo-a" });
      setCurrentSession({ id: "session-a", title: "A", directory: "/repo-a" });
    });

    runWithTelegramConversationScope(scopeB, () => {
      setCurrentProject({ id: "project-b", worktree: "/repo-b" });
      setCurrentSession({ id: "session-b", title: "B", directory: "/repo-b" });
    });

    expect(
      runWithTelegramConversationScope(scopeA, () => ({
        project: getCurrentProject(),
        session: getCurrentSession(),
      })),
    ).toEqual({
      project: { id: "project-a", worktree: "/repo-a" },
      session: { id: "session-a", title: "A", directory: "/repo-a" },
    });

    expect(
      runWithTelegramConversationScope(scopeB, () => ({
        project: getCurrentProject(),
        session: getCurrentSession(),
      })),
    ).toEqual({
      project: { id: "project-b", worktree: "/repo-b" },
      session: { id: "session-b", title: "B", directory: "/repo-b" },
    });
  });

  it("isolates project and session state by topic scope for the same user", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setCurrentProject({ id: "project-a", worktree: "/repo-a" });
      setCurrentSession({ id: "session-a", title: "A", directory: "/repo-a" });
    });

    runWithTelegramConversationScope(scopeAOtherTopic, () => {
      setCurrentProject({ id: "project-a-topic-b", worktree: "/repo-a-topic-b" });
      setCurrentSession({
        id: "session-a-topic-b",
        title: "A topic B",
        directory: "/repo-a-topic-b",
      });
    });

    expect(
      runWithTelegramConversationScope(scopeA, () => ({
        project: getCurrentProject(),
        session: getCurrentSession(),
      })),
    ).toEqual({
      project: { id: "project-a", worktree: "/repo-a" },
      session: { id: "session-a", title: "A", directory: "/repo-a" },
    });

    expect(
      runWithTelegramConversationScope(scopeAOtherTopic, () => ({
        project: getCurrentProject(),
        session: getCurrentSession(),
      })),
    ).toEqual({
      project: { id: "project-a-topic-b", worktree: "/repo-a-topic-b" },
      session: {
        id: "session-a-topic-b",
        title: "A topic B",
        directory: "/repo-a-topic-b",
      },
    });
  });

  it("defaults streaming to env-configured value when settings are unset", () => {
    expect(runWithTelegramConversationScope(scopeA, () => isMessageStreamingEnabled())).toBe(false);
  });

  it("isolates agent, model, and reasoning mode by topic while keeping streaming per user", async () => {
    runWithTelegramConversationScope(scopeA, () => {
      setCurrentAgent("build");
      setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" });
      setReasoningMode(2);
    });
    await runWithTelegramConversationScope(scopeA, () => setMessageStreamingEnabled(false));

    runWithTelegramConversationScope(scopeAOtherTopic, () => {
      setCurrentAgent("plan");
      setCurrentModel({ providerID: "anthropic", modelID: "claude", variant: "fast" });
      setReasoningMode(2);
    });

    runWithTelegramConversationScope(scopeB, () => {
      setCurrentAgent("review");
      setReasoningMode(1);
    });
    await runWithTelegramConversationScope(scopeB, () => setMessageStreamingEnabled(true));

    expect(runWithTelegramConversationScope(scopeA, () => getCurrentAgent())).toBe("build");
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentAgent())).toBe(
      "plan",
    );
    expect(runWithTelegramConversationScope(scopeA, () => getCurrentModel())).toEqual({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    });
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentModel())).toEqual({
      providerID: "anthropic",
      modelID: "claude",
      variant: "fast",
    });
    expect(runWithTelegramConversationScope(scopeA, () => getReasoningMode())).toBe(2);
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getReasoningMode())).toBe(2);
    expect(runWithTelegramConversationScope(scopeB, () => getReasoningMode())).toBe(1);
    expect(runWithTelegramConversationScope(scopeA, () => isMessageStreamingEnabled())).toBe(false);
    expect(
      runWithTelegramConversationScope(scopeAOtherTopic, () => isMessageStreamingEnabled()),
    ).toBe(false);
    expect(runWithTelegramConversationScope(scopeB, () => isMessageStreamingEnabled())).toBe(true);
  });

  it("clears only the active topic-local agent and model for the same user", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setCurrentAgent("build");
      setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" });
    });

    runWithTelegramConversationScope(scopeAOtherTopic, () => {
      setCurrentAgent("plan");
      setCurrentModel({ providerID: "anthropic", modelID: "claude", variant: "fast" });
    });

    runWithTelegramConversationScope(scopeA, () => {
      clearCurrentAgent();
      clearCurrentModel();
    });

    expect(
      runWithTelegramConversationScope(scopeA, () => ({
        agent: getCurrentAgent(),
        model: getCurrentModel(),
      })),
    ).toEqual({
      agent: undefined,
      model: undefined,
    });

    expect(
      runWithTelegramConversationScope(scopeAOtherTopic, () => ({
        agent: getCurrentAgent(),
        model: getCurrentModel(),
      })),
    ).toEqual({
      agent: "plan",
      model: { providerID: "anthropic", modelID: "claude", variant: "fast" },
    });
  });

  it("stores main-thread agent and model as global defaults for new topics", () => {
    runWithTelegramConversationScope(scopeAMainThread, () => {
      setCurrentAgent("build");
      setCurrentModel({ providerID: "openai", modelID: "gpt-4.1", variant: "default" });
    });

    expect(getCurrentAgent()).toBe("build");
    expect(getCurrentModel()).toEqual({
      providerID: "openai",
      modelID: "gpt-4.1",
      variant: "default",
    });

    expect(
      runWithTelegramConversationScope(scopeAOtherTopic, () => ({
        agent: getCurrentAgent(),
        model: getCurrentModel(),
      })),
    ).toEqual({
      agent: undefined,
      model: undefined,
    });
  });

  it("keeps global fallback values outside scoped execution", () => {
    setCurrentProject({ id: "project-global", worktree: "/repo-global" });
    setCurrentSession({ id: "session-global", title: "Global", directory: "/repo-global" });

    runWithTelegramConversationScope(scopeA, () => {
      setCurrentProject({ id: "project-a", worktree: "/repo-a" });
      clearSession();
    });

    expect(getCurrentProject()).toEqual({ id: "project-global", worktree: "/repo-global" });
    expect(getCurrentSession()).toEqual({
      id: "session-global",
      title: "Global",
      directory: "/repo-global",
    });
  });

  it("does not inherit global project and session inside a new scoped topic", () => {
    setCurrentProject({ id: "project-global", worktree: "/repo-global" });
    setCurrentSession({ id: "session-global", title: "Global", directory: "/repo-global" });

    expect(
      runWithTelegramConversationScope(scopeAOtherTopic, () => ({
        project: getCurrentProject(),
        session: getCurrentSession(),
      })),
    ).toEqual({
      project: undefined,
      session: undefined,
    });
  });

  it("clears only the active scoped state", async () => {
    runWithTelegramConversationScope(scopeA, () => {
      setCurrentProject({ id: "project-a", worktree: "/repo-a" });
      setCurrentSession({ id: "session-a", title: "A", directory: "/repo-a" });
      setCurrentAgent("build");
      setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" });
      setReasoningMode(2);
    });
    await runWithTelegramConversationScope(scopeA, () => setMessageStreamingEnabled(false));

    runWithTelegramConversationScope(scopeB, () => {
      setCurrentProject({ id: "project-b", worktree: "/repo-b" });
    });

    runWithTelegramConversationScope(scopeA, () => {
      clearProject();
      clearSession();
      clearCurrentAgent();
      clearCurrentModel();
    });

    expect(runWithTelegramConversationScope(scopeA, () => getCurrentProject())).toBeUndefined();
    expect(runWithTelegramConversationScope(scopeA, () => getCurrentSession())).toBeUndefined();
    expect(runWithTelegramConversationScope(scopeA, () => getCurrentAgent())).toBeUndefined();
    expect(runWithTelegramConversationScope(scopeA, () => getCurrentModel())).toBeUndefined();
    expect(runWithTelegramConversationScope(scopeA, () => getReasoningMode())).toBe(2);
    expect(runWithTelegramConversationScope(scopeB, () => getCurrentProject())).toEqual({
      id: "project-b",
      worktree: "/repo-b",
    });
  });

  it("isolates pinned message ids by topic scope", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setPinnedMessageId(101);
    });

    runWithTelegramConversationScope(scopeAOtherTopic, () => {
      setPinnedMessageId(202);
    });

    expect(runWithTelegramConversationScope(scopeA, () => getPinnedMessageId())).toBe(101);
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getPinnedMessageId())).toBe(
      202,
    );

    runWithTelegramConversationScope(scopeA, () => {
      clearPinnedMessageId();
    });

    expect(runWithTelegramConversationScope(scopeA, () => getPinnedMessageId())).toBeUndefined();
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getPinnedMessageId())).toBe(
      202,
    );
  });

  it("defaults thinking clear mode to off and stores it as a user-scoped setting", () => {
    expect(runWithTelegramConversationScope(scopeA, () => getThinkingClearMode())).toBe(false);

    runWithTelegramConversationScope(scopeA, () => {
      setThinkingClearMode(true);
    });

    expect(runWithTelegramConversationScope(scopeA, () => getThinkingClearMode())).toBe(true);
  });

  it("does not leak thinking clear mode across users", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setThinkingClearMode(true);
    });

    expect(runWithTelegramConversationScope(scopeB, () => getThinkingClearMode())).toBe(false);
  });

  it("keeps reasoning mode after scoped project and session are cleared", () => {
    runWithTelegramConversationScope(scopeA, () => {
      setReasoningMode(1);
      setCurrentProject({ id: "project-a", worktree: "/repo-a" });
      setCurrentSession({ id: "session-a", title: "A", directory: "/repo-a" });
      clearProject();
      clearSession();
    });

    expect(runWithTelegramConversationScope(scopeA, () => getReasoningMode())).toBe(1);
  });
});
