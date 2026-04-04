import { beforeEach, describe, expect, it, vi } from "vitest";
import type { TelegramConversationScope } from "../../src/telegram/scope.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const mocked = vi.hoisted(() => ({
  settingsFilePath: "/tmp/opencode-telegram-bot-settings-manager.test.json",
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
  getPinnedMessageId,
  isMessageStreamingEnabled,
  setCurrentAgent,
  setCurrentModel,
  setCurrentProject,
  setCurrentSession,
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

  it("isolates agent and model by topic while keeping streaming per user", async () => {
    runWithTelegramConversationScope(scopeA, () => {
      setCurrentAgent("build");
      setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" });
    });
    await runWithTelegramConversationScope(scopeA, () => setMessageStreamingEnabled(false));

    runWithTelegramConversationScope(scopeAOtherTopic, () => {
      setCurrentAgent("plan");
      setCurrentModel({ providerID: "anthropic", modelID: "claude", variant: "fast" });
    });

    runWithTelegramConversationScope(scopeB, () => {
      setCurrentAgent("review");
    });
    await runWithTelegramConversationScope(scopeB, () => setMessageStreamingEnabled(true));

    expect(runWithTelegramConversationScope(scopeA, () => getCurrentAgent())).toBe("build");
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentAgent())).toBe("plan");
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
    expect(runWithTelegramConversationScope(scopeA, () => isMessageStreamingEnabled())).toBe(false);
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => isMessageStreamingEnabled())).toBe(false);
    expect(runWithTelegramConversationScope(scopeB, () => isMessageStreamingEnabled())).toBe(true);
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
});
