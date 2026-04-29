import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";
import { getAgentDisplayName } from "../../../src/agent/types.js";

const mocked = vi.hoisted(() => ({
  fetchCurrentAgentMock: vi.fn(),
  getAvailableAgentsMock: vi.fn(),
  selectAgentMock: vi.fn(),
  getStoredModelMock: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
  formatVariantForButtonMock: vi.fn(() => "Default"),
  createMainKeyboardMock: vi.fn(() => ({ keyboard: "main" })),
  refreshContextLimitMock: vi.fn().mockResolvedValue(undefined),
  getContextInfoMock: vi.fn<() => { tokensUsed: number; tokensLimit: number } | null>(() => null),
  getContextLimitMock: vi.fn(() => 0),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateAgentMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardGetStateMock: vi.fn(() => null),
  bindAgentToActiveContextMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/agent/manager.js", () => ({
  fetchCurrentAgent: mocked.fetchCurrentAgentMock,
  getAvailableAgents: mocked.getAvailableAgentsMock,
  selectAgent: mocked.selectAgentMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    refreshContextLimit: mocked.refreshContextLimitMock,
    getContextInfo: mocked.getContextInfoMock,
    getContextLimit: mocked.getContextLimitMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateAgent: mocked.keyboardUpdateAgentMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
    getState: mocked.keyboardGetStateMock,
  },
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindAgentToActiveContext: mocked.bindAgentToActiveContextMock,
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { handleAgentSelect, showAgentSelectionMenu } from "../../../src/bot/handlers/agent.js";

function createForumMainThreadCommandContext(): Context {
  return {
    chat: { id: 111, type: "supergroup", is_forum: true },
    message: {
      chat: { id: 111, type: "supergroup", is_forum: true },
    },
    reply: vi.fn().mockResolvedValue({ message_id: 500 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function createForumMainThreadCallbackContext(data: string): Context {
  return {
    chat: { id: 111, type: "supergroup", is_forum: true },
    callbackQuery: {
      data,
      message: {
        message_id: 500,
        chat: { id: 111, type: "supergroup", is_forum: true },
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 700 }),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function getInlineKeyboardRows(keyboard: InlineKeyboard): Array<Array<{ text: string; callback_data?: string }>> {
  return keyboard.inline_keyboard as Array<Array<{ text: string; callback_data?: string }>>;
}

describe("bot/handlers/agent", () => {
  beforeEach(() => {
    interactionManager.clearAll("test_setup");
    mocked.fetchCurrentAgentMock.mockReset();
    mocked.fetchCurrentAgentMock.mockResolvedValue("build");
    mocked.getAvailableAgentsMock.mockReset();
    mocked.getAvailableAgentsMock.mockResolvedValue([
      { name: "build", mode: "primary" },
      { name: "plan", mode: "primary" },
    ]);
    mocked.selectAgentMock.mockReset();
    mocked.getStoredModelMock.mockClear();
    mocked.formatVariantForButtonMock.mockClear();
    mocked.createMainKeyboardMock.mockClear();
    mocked.refreshContextLimitMock.mockClear();
    mocked.getContextInfoMock.mockReset();
    mocked.getContextInfoMock.mockReturnValue(null);
    mocked.getContextLimitMock.mockReset();
    mocked.getContextLimitMock.mockReturnValue(0);
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateAgentMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardGetStateMock.mockReset();
    mocked.keyboardGetStateMock.mockReturnValue(null);
    mocked.bindAgentToActiveContextMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("opens agent menu from forum main thread without message_thread_id", async () => {
    const ctx = createForumMainThreadCommandContext();

    await showAgentSelectionMenu(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: InlineKeyboard; message_thread_id?: number },
    ];

    expect(text).toBe(t("agent.menu.current", { name: getAgentDisplayName("build") }));
    expect(options).not.toHaveProperty("message_thread_id");

    const rows = getInlineKeyboardRows(options.reply_markup);
    expect(rows[0]?.[0]?.callback_data).toBe("agent:build");
    expect(rows[1]?.[0]?.callback_data).toBe("agent:plan");
    expect(rows[2]?.[0]?.callback_data).toBe("inline:cancel:agent");
  });

  it("confirms agent change from forum main thread without message_thread_id", async () => {
    const ctx = createForumMainThreadCallbackContext("agent:build");
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "agent",
        messageId: 500,
      },
    });

    const handled = await handleAgentSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("agent.changed_callback", { name: getAgentDisplayName("build") }),
    });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { message_thread_id?: number },
    ];

    expect(text).toBe(t("agent.changed_message", { name: getAgentDisplayName("build") }));
    expect(options).not.toHaveProperty("message_thread_id");
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });
});
