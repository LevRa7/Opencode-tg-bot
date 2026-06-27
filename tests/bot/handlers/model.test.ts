import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context, InlineKeyboard } from "grammy";
import type { ModelInfo, RuntimeModelCatalog } from "../../../src/model/types.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  fetchCurrentModelMock: vi.fn(),
  getRuntimeModelCatalogMock: vi.fn(),
  getModelSelectionListsMock: vi.fn(),
  selectModelMock: vi.fn(),
  formatVariantForButtonMock: vi.fn(() => "Default"),
  getAvailableVariantsMock: vi.fn(),
  showVariantSelectionMenuMock: vi.fn().mockResolvedValue(undefined),
  createMainKeyboardMock: vi.fn(() => ({ keyboard: "main" })),
  getStoredAgentMock: vi.fn(() => "assistant"),
  refreshContextLimitMock: vi.fn().mockResolvedValue(undefined),
  getContextInfoMock: vi.fn<() => { tokensUsed: number; tokensLimit: number } | null>(() => null),
  getContextLimitMock: vi.fn(() => 0),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  keyboardSendKeyboardUpdateMock: vi.fn().mockResolvedValue(undefined),
  appendInlineMenuCancelButtonMock: vi.fn((keyboard: InlineKeyboard) => keyboard),
  ensureActiveInlineMenuMock: vi.fn().mockResolvedValue(true),
  replyWithInlineMenuMock: vi.fn().mockResolvedValue(500),
  clearActiveInlineMenuMock: vi.fn(),
  bindModelToActiveContextMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/model/manager.js", () => ({
  fetchCurrentModel: mocked.fetchCurrentModelMock,
  getRuntimeModelCatalog: mocked.getRuntimeModelCatalogMock,
  getModelSelectionLists: mocked.getModelSelectionListsMock,
  selectModel: mocked.selectModelMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
  getAvailableVariants: mocked.getAvailableVariantsMock,
}));

vi.mock("../../../src/bot/handlers/variant.js", () => ({
  showVariantSelectionMenu: mocked.showVariantSelectionMenuMock,
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
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
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
    sendKeyboardUpdate: mocked.keyboardSendKeyboardUpdateMock,
    getKeyboard: mocked.createMainKeyboardMock,
  },
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  appendInlineMenuCancelButton: mocked.appendInlineMenuCancelButtonMock,
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
  replyWithInlineMenu: mocked.replyWithInlineMenuMock,
  clearActiveInlineMenu: mocked.clearActiveInlineMenuMock,
  INLINE_MENU_TTL_MS: 300_000,
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindModelToActiveContext: mocked.bindModelToActiveContextMock,
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

import { handleModelSelect, showModelSelectionMenu } from "../../../src/bot/handlers/model.js";

function createCatalog(overrides?: Partial<RuntimeModelCatalog>): RuntimeModelCatalog {
  return {
    providers: [
      {
        providerID: "anthropic",
        models: [{ providerID: "anthropic", modelID: "claude-sonnet-4" }],
      },
      {
        providerID: "empty-provider",
        models: [],
      },
      {
        providerID: "openai",
        models: Array.from({ length: 12 }, (_, index) => ({
          providerID: "openai",
          modelID: `gpt-4.${String(index + 1).padStart(2, "0")}`,
        })),
      },
    ],
    ...overrides,
  };
}

function createCurrentModel(overrides?: Partial<ModelInfo>): ModelInfo {
  return {
    providerID: "openai",
    modelID: "gpt-4.01",
    variant: "default",
    ...overrides,
  };
}

function createCommandContext(): Context {
  return {
    chat: { id: 111 },
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

function createCallbackContext(data: string): Context {
  return {
    chat: { id: 111 },
    callbackQuery: {
      data,
      message: {
        message_id: 500,
      },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 700 }),
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
    editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue({ message_id: 700 }),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 999 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
      editMessageText: vi.fn().mockResolvedValue(true),
    },
  } as unknown as Context;
}

function getInlineKeyboardRows(
  keyboard: InlineKeyboard,
): Array<Array<{ text: string; callback_data?: string }>> {
  return keyboard.inline_keyboard as Array<Array<{ text: string; callback_data?: string }>>;
}

describe("bot/handlers/model", () => {
  beforeEach(() => {
    mocked.fetchCurrentModelMock.mockReset();
    mocked.fetchCurrentModelMock.mockReturnValue(createCurrentModel());
    mocked.getRuntimeModelCatalogMock.mockReset();
    mocked.getRuntimeModelCatalogMock.mockResolvedValue(createCatalog());
    mocked.getModelSelectionListsMock.mockReset();
    mocked.getModelSelectionListsMock.mockResolvedValue({ favorites: [], recent: [] });
    mocked.selectModelMock.mockReset();
    mocked.formatVariantForButtonMock.mockClear();
    mocked.getAvailableVariantsMock.mockReset();
    mocked.getAvailableVariantsMock.mockResolvedValue([{ id: "default" }]);
    mocked.showVariantSelectionMenuMock.mockClear();
    mocked.createMainKeyboardMock.mockClear();
    mocked.getStoredAgentMock.mockClear();
    mocked.refreshContextLimitMock.mockClear();
    mocked.getContextInfoMock.mockReset();
    mocked.getContextInfoMock.mockReturnValue(null);
    mocked.getContextLimitMock.mockReset();
    mocked.getContextLimitMock.mockReturnValue(0);
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.keyboardSendKeyboardUpdateMock.mockReset();
    mocked.keyboardSendKeyboardUpdateMock.mockResolvedValue(undefined);
    mocked.appendInlineMenuCancelButtonMock.mockClear();
    mocked.ensureActiveInlineMenuMock.mockReset();
    mocked.ensureActiveInlineMenuMock.mockResolvedValue(true);
    mocked.replyWithInlineMenuMock.mockReset();
    mocked.replyWithInlineMenuMock.mockResolvedValue(500);
    mocked.clearActiveInlineMenuMock.mockReset();
    mocked.bindModelToActiveContextMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
  });

  it("renders provider list from the runtime catalog", async () => {
    const ctx = createCommandContext();

    await showModelSelectionMenu(ctx);

    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledTimes(1);

    const [, options] = mocked.replyWithInlineMenuMock.mock.calls[0] as [
      Context,
      { text: string; keyboard: InlineKeyboard; menuKind: string },
    ];

    expect(options.menuKind).toBe("model");
    expect(options.text).toContain("Current model: openai / gpt-4.01");

    const rows = getInlineKeyboardRows(options.keyboard);
    expect(rows[0]?.[0]?.callback_data).toBe("model_provider:anthropic");
    expect(rows[1]?.[0]?.callback_data).toBe("model_provider:empty-provider");
    expect(rows[2]?.[0]?.callback_data).toBe("model_provider:openai");
  });

  it("opens a provider with the first page of models", async () => {
    const ctx = createCallbackContext("model_provider:openai");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: InlineKeyboard },
    ];

    expect(text).toContain("Provider: openai");
    const rows = getInlineKeyboardRows(options.reply_markup);
    expect(rows).toHaveLength(13);
    expect(rows[0]?.[0]?.callback_data).toBe("model:openai:0");
    expect(rows[9]?.[0]?.callback_data).toBe("model:openai:9");
    expect(rows[10]?.[0]?.callback_data).toBe("model_provider_page:openai:1");
    expect(rows[11]?.[0]?.callback_data).toBe("model_back");
  });

  it("renders the second page with prev and back navigation", async () => {
    const ctx = createCallbackContext("model_provider_page:openai:1");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);

    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: InlineKeyboard },
    ];

    expect(text).toContain("Provider: openai");
    const rows = getInlineKeyboardRows(options.reply_markup);
    expect(rows[0]?.[0]?.callback_data).toBe("model:openai:10");
    expect(rows[1]?.[0]?.callback_data).toBe("model:openai:11");
    expect(rows[2]?.[0]?.callback_data).toBe("model_provider_page:openai:0");
    expect(rows[3]?.[0]?.callback_data).toBe("model_back");
  });

  it("normalizes out-of-range model pages to the last page", async () => {
    const ctx = createCallbackContext("model_provider_page:openai:99");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);

    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: InlineKeyboard },
    ];

    const rows = getInlineKeyboardRows(options.reply_markup);
    expect(rows[0]?.[0]?.callback_data).toBe("model:openai:10");
    expect(rows[1]?.[0]?.callback_data).toBe("model:openai:11");
  });

  it("shows an empty provider state with a back button", async () => {
    const ctx = createCallbackContext("model_provider:empty-provider");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);

    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: InlineKeyboard },
    ];

    expect(text).toContain("Provider: empty-provider");
    expect(text).toContain("No models available");
    const rows = getInlineKeyboardRows(options.reply_markup);
    expect(rows[0]?.[0]?.callback_data).toBe("model_back");
  });

  it("preserves model selection side effects when a model is chosen", async () => {
    const ctx = createCallbackContext("model:openai:10");
    mocked.getContextInfoMock.mockReturnValue({ tokensUsed: 120, tokensLimit: 1000 });

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.selectModelMock).toHaveBeenCalledWith({
      providerID: "openai",
      modelID: "gpt-4.11",
      variant: "default",
    });
    expect(mocked.bindModelToActiveContextMock).toHaveBeenCalledWith({
      providerID: "openai",
      modelID: "gpt-4.11",
      variant: "default",
    });
    expect(mocked.keyboardInitializeMock).toHaveBeenCalledWith(ctx.api, 111);
    expect(mocked.keyboardUpdateModelMock).toHaveBeenCalledWith({
      providerID: "openai",
      modelID: "gpt-4.11",
      variant: "default",
    });
    expect(mocked.refreshContextLimitMock).toHaveBeenCalledTimes(1);
    expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(120, 1000);
    expect(mocked.createMainKeyboardMock).toHaveBeenCalledTimes(1);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("model.changed_callback", { name: "openai / gpt-4.11" }),
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      t("model.changed_message", { name: "openai / gpt-4.11" }),
      { reply_markup: { keyboard: "main" } },
    );
    expect(mocked.clearActiveInlineMenuMock).toHaveBeenCalledWith("model_selected");

    // Task B: the host keyboard must be force-refreshed immediately after applying.
    expect(mocked.keyboardSendKeyboardUpdateMock).toHaveBeenCalledWith(111, undefined, {
      force: true,
    });

    // Task C: the model list is re-rendered in place with the checkmark on the new model
    // and the menu is NOT deleted.
    expect(ctx.deleteMessage).not.toHaveBeenCalled();
    expect(ctx.editMessageReplyMarkup).toHaveBeenCalledTimes(1);

    const [editArgs] = (ctx.editMessageReplyMarkup as ReturnType<typeof vi.fn>).mock.calls[0] as [
      { reply_markup: InlineKeyboard },
    ];
    const rebuiltRows = getInlineKeyboardRows(editArgs.reply_markup);
    const selectedRow = rebuiltRows.find((row) => row[0]?.callback_data === "model:openai:10");
    const otherRow = rebuiltRows.find((row) => row[0]?.callback_data === "model:openai:11");
    expect(selectedRow?.[0]?.text.startsWith("✅")).toBe(true);
    expect(otherRow?.[0]?.text.startsWith("✅")).toBe(false);
  });

  it("opens variant selection after choosing a model with multiple enabled variants", async () => {
    const ctx = createCallbackContext("model:openai:10");
    mocked.getAvailableVariantsMock.mockResolvedValue([
      { id: "default" },
      { id: "high" },
      { id: "disabled", disabled: true },
    ]);

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.getAvailableVariantsMock).toHaveBeenCalledWith("openai", "gpt-4.11");
    expect(mocked.showVariantSelectionMenuMock).toHaveBeenCalledWith(ctx);
  });

  it("confirms model change in forum main thread without message_thread_id", async () => {
    const ctx = createForumMainThreadCallbackContext("model:openai:10");
    mocked.getContextInfoMock.mockReturnValue({ tokensUsed: 120, tokensLimit: 1000 });

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("model.changed_message", { name: "openai / gpt-4.11" }),
      expect.not.objectContaining({ message_thread_id: expect.anything() }),
    );
  });

  it("parses delimiter-safe model callbacks for provider ids containing colons", async () => {
    mocked.getRuntimeModelCatalogMock.mockResolvedValueOnce({
      providers: [
        {
          providerID: "tenant:openai",
          models: [{ providerID: "tenant:openai", modelID: "gpt-4.11:thinking" }],
        },
      ],
    });

    const ctx = createCallbackContext("model:tenant%3Aopenai:gpt-4.11%3Athinking");
    mocked.getContextInfoMock.mockReturnValue({ tokensUsed: 120, tokensLimit: 1000 });

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(mocked.selectModelMock).toHaveBeenCalledWith({
      providerID: "tenant:openai",
      modelID: "gpt-4.11:thinking",
      variant: "default",
    });
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("model.changed_callback", { name: "tenant:openai / gpt-4.11:thinking" }),
    });
    expect(ctx.reply).toHaveBeenCalledWith(
      t("model.changed_message", { name: "tenant:openai / gpt-4.11:thinking" }),
      expect.anything(),
    );
  });

  it("consumes malformed encoded model callbacks safely", async () => {
    const ctx = createCallbackContext("model:tenant%ZZopenai:gpt-4.11");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("model.change_error_callback"),
    });
    expect(mocked.clearActiveInlineMenuMock).toHaveBeenCalledWith("model_select_invalid_callback");
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("answers stale provider callbacks safely", async () => {
    const ctx = createCallbackContext("model_provider:missing-provider");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "This provider is no longer available",
      show_alert: true,
    });
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
  });

  it("answers stale model callbacks safely", async () => {
    const ctx = createCallbackContext("model:openai:999");

    const handled = await handleModelSelect(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: "This model is no longer available",
      show_alert: true,
    });
    expect(ctx.reply).not.toHaveBeenCalled();
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
  });

  it("replies with the load error when showing the model menu fails", async () => {
    const ctx = createCommandContext();
    mocked.getRuntimeModelCatalogMock.mockRejectedValueOnce(new Error("boom"));

    await showModelSelectionMenu(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("model.menu.error"));
    expect(mocked.replyWithInlineMenuMock).not.toHaveBeenCalled();
  });
});
