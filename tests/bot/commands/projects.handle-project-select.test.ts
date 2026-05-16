import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { handleProjectSelect } from "../../../src/bot/commands/projects.js";
import { foregroundSessionState } from "../../../src/scheduled-task/foreground-state.js";
import {
  runWithTelegramConversationScope,
  type TelegramConversationScope,
} from "../../../src/telegram/scope.js";
import { __resetSettingsForTests, getCurrentProject } from "../../../src/settings/manager.js";

const mocked = vi.hoisted(() => ({
  getProjectsMock: vi.fn(),
  ensureActiveInlineMenuMock: vi.fn(),
  clearAllInteractionStateMock: vi.fn(),
  clearSummaryMock: vi.fn(),
  clearScopedSessionRuntimeMock: vi.fn(),
  getCurrentSessionMock: vi.fn(),
  settingsFilePath: `${process.env.TMPDIR ?? "/tmp"}/opencode-telegram-bot-project-select.test.json`,
}));

vi.mock("../../../src/runtime/paths.js", () => ({
  getRuntimePaths: vi.fn(() => ({
    settingsFilePath: mocked.settingsFilePath,
  })),
}));

vi.mock("../../../src/project/manager.js", () => ({
  getProjects: mocked.getProjectsMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn(),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: vi.fn(),
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: mocked.clearAllInteractionStateMock,
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: { clear: mocked.clearSummaryMock },
}));

vi.mock("../../../src/bot/runtime/scoped-runtime-reset.js", () => ({
  clearScopedSessionRuntime: mocked.clearScopedSessionRuntimeMock,
}));

vi.mock("../../../src/session/manager.js", () => ({
  clearSession: vi.fn(),
  getCurrentSession: mocked.getCurrentSessionMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    clear: vi.fn().mockResolvedValue(undefined),
    refreshContextLimit: vi.fn().mockResolvedValue(undefined),
    getContextLimit: vi.fn(() => 0),
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: vi.fn(),
    updateContext: vi.fn(),
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: vi.fn(() => "build"),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: vi.fn(() => "Default"),
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: vi.fn(() => ({ keyboard: true })),
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindProjectToActiveContext: vi.fn(),
    clearSessionForActiveContext: vi.fn(),
  },
}));

function createCallbackContext(data: string): Context {
  return {
    chat: { id: 321 } as Context["chat"],
    callbackQuery: { data } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/projects handleProjectSelect", () => {
  const scopeA: TelegramConversationScope = { userId: 1, chatId: 100, messageThreadId: 10 };
  const scopeAOtherTopic: TelegramConversationScope = {
    userId: 1,
    chatId: 100,
    messageThreadId: 11,
  };
  const scopeB: TelegramConversationScope = { userId: 2, chatId: 100, messageThreadId: 10 };

  beforeEach(() => {
    foregroundSessionState.__resetForTests();
    __resetSettingsForTests();
    mocked.getProjectsMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.clearAllInteractionStateMock.mockReset();
    mocked.clearSummaryMock.mockReset();
    mocked.clearScopedSessionRuntimeMock.mockReset();
    mocked.getCurrentSessionMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
  });

  it("uses callback feedback and does not send chat reply on projects:page:* load error", async () => {
    const ctx = createCallbackContext("projects:page:1");
    const pageLoadError = new Error("failed to load page");
    mocked.getProjectsMock.mockRejectedValue(pageLoadError);

    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("projects.page_load_error"),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mocked.clearAllInteractionStateMock).not.toHaveBeenCalled();
  });

  it("keeps project:* selection error behavior with state cleanup and chat error reply", async () => {
    const ctx = createCallbackContext("project:abc");
    mocked.getProjectsMock.mockResolvedValue([
      {
        id: "different-id",
        name: "Other project",
        worktree: "/tmp/other",
      },
    ]);

    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.clearAllInteractionStateMock).toHaveBeenCalledWith("project_select_error");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
    expect(ctx.reply).toHaveBeenCalledWith(t("projects.select_error"));
  });

  it("blocks project selection callback while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "test");

    const ctx = createCallbackContext("project:abc");
    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("interaction.blocked.finish_current"),
    });
  });

  it("does not block permission callbacks while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "test");

    const ctx = createCallbackContext("permission:once");
    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
  });

  it("does not block question callbacks while foreground session is busy", async () => {
    foregroundSessionState.markBusy("session-1", "test");

    const ctx = createCallbackContext("question:select:0:1");
    const handled = await handleProjectSelect(ctx);

    expect(handled).toBe(false);
    expect(ctx.answerCallbackQuery).not.toHaveBeenCalled();
    expect(mocked.getProjectsMock).not.toHaveBeenCalled();
  });

  it("persists explicit project selection as a user default across new topics without leaking across users", async () => {
    mocked.getProjectsMock.mockResolvedValue([
      {
        id: "project-a",
        name: "Project A",
        worktree: "/repo-a",
      },
    ]);
    mocked.getCurrentSessionMock.mockReturnValue({
      id: "session-0",
      title: "Previous",
      directory: "/repo-a",
    });

    const ctx = createCallbackContext("project:project-a");

    const handled = await runWithTelegramConversationScope(scopeA, () => handleProjectSelect(ctx));

    expect(handled).toBe(true);
    expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentProject())).toEqual({
      id: "project-a",
      name: "Project A",
      worktree: "/repo-a",
    });
    expect(runWithTelegramConversationScope(scopeB, () => getCurrentProject())).toBeUndefined();
    expect(mocked.clearScopedSessionRuntimeMock).toHaveBeenCalledWith(
      "session-0",
      "project_switched",
    );
    expect(mocked.clearSummaryMock).not.toHaveBeenCalled();
  });
});
