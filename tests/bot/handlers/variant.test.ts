import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getAvailableVariantsMock: vi.fn(),
  getCurrentVariantMock: vi.fn(),
  setCurrentVariantMock: vi.fn(),
  formatVariantForDisplayMock: vi.fn((variantId: string) => {
    if (variantId === "fast") {
      return "Fast";
    }

    if (variantId === "default") {
      return "Default";
    }

    return variantId;
  }),
  formatVariantForButtonMock: vi.fn(() => "Fast"),
  getStoredModelMock: vi.fn(() => ({ providerID: "openai", modelID: "gpt-5", variant: "default" })),
  getStoredAgentMock: vi.fn(() => "build"),
  createMainKeyboardMock: vi.fn(() => ({ keyboard: "main" })),
  refreshContextLimitMock: vi.fn().mockResolvedValue(undefined),
  getContextInfoMock: vi.fn<() => { tokensUsed: number; tokensLimit: number } | null>(() => null),
  getContextLimitMock: vi.fn(() => 0),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateVariantMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  bindModelToActiveContextMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/variant/manager.js", () => ({
  getAvailableVariants: mocked.getAvailableVariantsMock,
  getCurrentVariant: mocked.getCurrentVariantMock,
  setCurrentVariant: mocked.setCurrentVariantMock,
  formatVariantForDisplay: mocked.formatVariantForDisplayMock,
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getStoredModel: mocked.getStoredModelMock,
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateVariant: mocked.keyboardUpdateVariantMock,
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    refreshContextLimit: mocked.refreshContextLimitMock,
    getContextInfo: mocked.getContextInfoMock,
    getContextLimit: mocked.getContextLimitMock,
  },
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindModelToActiveContext: mocked.bindModelToActiveContextMock,
  },
}));

import {
  handleVariantSelect,
  showVariantSelectionMenu,
} from "../../../src/bot/handlers/variant.js";

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

describe("bot/handlers/variant", () => {
  beforeEach(() => {
    interactionManager.clearAll("test_setup");
    mocked.getAvailableVariantsMock.mockReset();
    mocked.getAvailableVariantsMock.mockResolvedValue([
      { id: "default", disabled: false },
      { id: "fast", disabled: false },
      { id: "slow", disabled: true },
    ]);
    mocked.getCurrentVariantMock.mockReset();
    mocked.getCurrentVariantMock.mockReturnValue("fast");
    mocked.setCurrentVariantMock.mockReset();
    mocked.formatVariantForDisplayMock.mockClear();
    mocked.formatVariantForButtonMock.mockClear();
    mocked.getStoredModelMock.mockReset();
    mocked.getStoredModelMock.mockReturnValue({
      providerID: "openai",
      modelID: "gpt-5",
      variant: "default",
    });
    mocked.getStoredAgentMock.mockClear();
    mocked.createMainKeyboardMock.mockClear();
    mocked.refreshContextLimitMock.mockClear();
    mocked.getContextInfoMock.mockReset();
    mocked.getContextInfoMock.mockReturnValue(null);
    mocked.getContextLimitMock.mockReset();
    mocked.getContextLimitMock.mockReturnValue(0);
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateVariantMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.bindModelToActiveContextMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("opens variant menu from forum main thread without message_thread_id", async () => {
    const ctx = createForumMainThreadCommandContext();

    await showVariantSelectionMenu(ctx);

    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: InlineKeyboard; message_thread_id?: number },
    ];

    expect(text).toBe(t("variant.menu.current", { name: "Fast" }));
    expect(options).not.toHaveProperty("message_thread_id");

    const rows = getInlineKeyboardRows(options.reply_markup);
    expect(rows[0]?.[0]?.callback_data).toBe("variant:default");
    expect(rows[1]?.[0]?.callback_data).toBe("variant:fast");
    expect(rows[2]?.[0]?.callback_data).toBe("inline:cancel:variant");
  });

  it("confirms variant change from forum main thread without message_thread_id", async () => {
    const ctx = createForumMainThreadCallbackContext("variant:fast");
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "variant",
        messageId: 500,
      },
    });

    const handled = await handleVariantSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.setCurrentVariantMock).toHaveBeenCalledWith("fast");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("variant.changed_callback", { name: "Fast" }),
    });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { message_thread_id?: number },
    ];

    expect(text).toBe(t("variant.changed_message", { name: "Fast" }));
    expect(options).not.toHaveProperty("reply_markup");
    expect(options).not.toHaveProperty("message_thread_id");
    expect(ctx.deleteMessage).toHaveBeenCalledTimes(1);
    expect(interactionManager.getSnapshot()).toBeNull();
  });

  it("rejects a forged unknown variant callback without mutating state", async () => {
    const ctx = createForumMainThreadCallbackContext("variant:forged");
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "variant",
        messageId: 500,
      },
    });

    const handled = await handleVariantSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.getAvailableVariantsMock).toHaveBeenCalledWith("openai", "gpt-5");
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("variant.command.not_found", { name: "forged" }),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });

  it("rejects a disabled variant callback without mutating state", async () => {
    const ctx = createForumMainThreadCallbackContext("variant:slow");
    interactionManager.start({
      kind: "inline",
      expectedInput: "callback",
      metadata: {
        menuKind: "variant",
        messageId: 500,
      },
    });

    const handled = await handleVariantSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.getAvailableVariantsMock).toHaveBeenCalledWith("openai", "gpt-5");
    expect(mocked.setCurrentVariantMock).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("variant.command.not_found", { name: "slow" }),
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
  });
});
