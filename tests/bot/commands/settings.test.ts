import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  userLocale: undefined as "en" | "ru" | undefined,
  hideThinkingMessages: false,
  hideToolCallMessages: false,
  hideToolFileMessages: false,
  setUserLocaleMock: vi.fn(),
  setHideThinkingMessagesMock: vi.fn(),
  setHideToolCallMessagesMock: vi.fn(),
  setHideToolFileMessagesMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getUserLocale: vi.fn(() => mocked.userLocale),
  setUserLocale: vi.fn((locale: "en" | "ru") => {
    mocked.setUserLocaleMock(locale);
    mocked.userLocale = locale;
  }),
  getHideThinkingMessages: vi.fn(() => mocked.hideThinkingMessages),
  setHideThinkingMessages: vi.fn((enabled: boolean) => {
    mocked.setHideThinkingMessagesMock(enabled);
    mocked.hideThinkingMessages = enabled;
  }),
  getHideToolCallMessages: vi.fn(() => mocked.hideToolCallMessages),
  setHideToolCallMessages: vi.fn((enabled: boolean) => {
    mocked.setHideToolCallMessagesMock(enabled);
    mocked.hideToolCallMessages = enabled;
  }),
  getHideToolFileMessages: vi.fn(() => mocked.hideToolFileMessages),
  setHideToolFileMessages: vi.fn((enabled: boolean) => {
    mocked.setHideToolFileMessagesMock(enabled);
    mocked.hideToolFileMessages = enabled;
  }),
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  SETTINGS_CALLBACK_PREFIX,
  handleSettingsCallback,
  settingsCommand,
} from "../../../src/bot/commands/settings.js";

function createCommandContext(): Context {
  return {
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as Context;
}

function createCallbackContext(data: string): Context {
  return {
    callbackQuery: {
      data,
      message: { message_id: 10 },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function getInlineRows(options: unknown): Array<Array<{ text: string; callback_data?: string }>> {
  return (options as { reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> } })
    .reply_markup.inline_keyboard;
}

describe("bot/commands/settings", () => {
  beforeEach(() => {
    mocked.userLocale = undefined;
    mocked.hideThinkingMessages = false;
    mocked.hideToolCallMessages = false;
    mocked.hideToolFileMessages = false;
    mocked.setUserLocaleMock.mockClear();
    mocked.setHideThinkingMessagesMock.mockClear();
    mocked.setHideToolCallMessagesMock.mockClear();
    mocked.setHideToolFileMessagesMock.mockClear();
  });

  it("replies with the settings title and root menu", async () => {
    const ctx = createCommandContext();

    await settingsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    const rows = getInlineRows(options);

    expect(text).toBe(t("settings.title"));
    expect(rows.map((row) => row[0]?.callback_data)).toEqual([
      "settings:language",
      "settings:toggle:hide_thinking",
      "settings:toggle:hide_tool_calls",
      "settings:toggle:hide_tool_files",
      "settings:cancel",
    ]);
    expect(rows[0]?.[0]?.text).toBe(t("settings.language", { value: "English" }));
    expect(rows[1]?.[0]?.text).toBe(
      t("settings.hide_thinking_messages", { state: t("settings.state.off") }),
    );
  });

  it("edits to the language submenu using locale options", async () => {
    const ctx = createCallbackContext("settings:language");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    const rows = getInlineRows(options);

    expect(text).toBe(t("settings.language.title"));
    expect(rows[0]?.[0]).toMatchObject({ text: "English", callback_data: "settings:language:en" });
    expect(rows.some((row) => row[0]?.callback_data === "settings:language:ru")).toBe(true);
    expect(rows[rows.length - 1]?.[0]?.callback_data).toBe("settings:cancel");
  });

  it("updates language and redraws the root menu in the selected locale", async () => {
    const ctx = createCallbackContext("settings:language:ru");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setUserLocaleMock).toHaveBeenCalledWith("ru");
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("settings.language_updated_callback", undefined, "ru"),
    });
    expect(ctx.editMessageText).toHaveBeenCalledTimes(1);
    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    const rows = getInlineRows(options);

    expect(text).toBe(t("settings.title", undefined, "ru"));
    expect(rows[0]?.[0]?.text).toBe(t("settings.language", { value: "Русский" }, "ru"));
  });

  it("toggles hide thinking messages", async () => {
    const ctx = createCallbackContext("settings:toggle:hide_thinking");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setHideThinkingMessagesMock).toHaveBeenCalledWith(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.updated_callback") });
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[1]?.[0]?.text).toBe(
      t("settings.hide_thinking_messages", { state: t("settings.state.on") }),
    );
  });

  it("toggles hide tool call messages", async () => {
    const ctx = createCallbackContext("settings:toggle:hide_tool_calls");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setHideToolCallMessagesMock).toHaveBeenCalledWith(true);
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[2]?.[0]?.text).toBe(
      t("settings.hide_tool_call_messages", { state: t("settings.state.on") }),
    );
  });

  it("toggles hide tool file messages", async () => {
    const ctx = createCallbackContext("settings:toggle:hide_tool_files");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setHideToolFileMessagesMock).toHaveBeenCalledWith(true);
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[3]?.[0]?.text).toBe(
      t("settings.hide_tool_file_messages", { state: t("settings.state.on") }),
    );
  });

  it("returns false for unknown and non-settings callbacks", async () => {
    expect(await handleSettingsCallback(createCallbackContext("model:select:0"))).toBe(false);
    expect(await handleSettingsCallback(createCallbackContext("settings:unknown"))).toBe(false);
  });

  it("answers with an error when settings storage throws", async () => {
    mocked.setHideToolFileMessagesMock.mockImplementationOnce(() => {
      throw new Error("storage failed");
    });
    const ctx = createCallbackContext("settings:toggle:hide_tool_files");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.error_callback") });
  });

  it("exports the settings callback prefix", () => {
    expect(SETTINGS_CALLBACK_PREFIX).toBe("settings:");
  });
});
