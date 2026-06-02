import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { interactionManager } from "../../../src/interaction/manager.js";

const mocked = vi.hoisted(() => ({
  userLocale: undefined as "en" | "ru" | undefined,
  hideThinkingMessages: false,
  hideToolCallMessages: false,
  hideToolFileMessages: false,
  telegraphTranslateEnabled: false,
  subagentTopicsEnabled: false,
  subagentTopicAutoDeleteMinutes: 1,
  setUserLocaleMock: vi.fn(),
  setHideThinkingMessagesMock: vi.fn(),
  setHideToolCallMessagesMock: vi.fn(),
  setHideToolFileMessagesMock: vi.fn(),
  setTelegraphTranslateEnabledMock: vi.fn(),
  setSubagentTopicsEnabledMock: vi.fn(),
  setSubagentTopicAutoDeleteMinutesMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
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
  getTelegraphTranslateEnabled: vi.fn(() => mocked.telegraphTranslateEnabled),
  setTelegraphTranslateEnabled: vi.fn((enabled: boolean) => {
    mocked.setTelegraphTranslateEnabledMock(enabled);
    mocked.telegraphTranslateEnabled = enabled;
  }),
  getSubagentTopicsEnabled: vi.fn(() => mocked.subagentTopicsEnabled),
  setSubagentTopicsEnabled: vi.fn((enabled: boolean) => {
    mocked.setSubagentTopicsEnabledMock(enabled);
    mocked.subagentTopicsEnabled = enabled;
  }),
  getSubagentTopicAutoDeleteMinutes: vi.fn(() => mocked.subagentTopicAutoDeleteMinutes),
  setSubagentTopicAutoDeleteMinutes: vi.fn((minutes: number) => {
    mocked.setSubagentTopicAutoDeleteMinutesMock(minutes);
    mocked.subagentTopicAutoDeleteMinutes = minutes;
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
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function startActiveSettingsMenu(messageId = 10): void {
  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: {
      menuKind: "settings",
      messageId,
    },
  });
}

function getInlineRows(options: unknown): Array<Array<{ text: string; callback_data?: string }>> {
  return (
    options as {
      reply_markup: { inline_keyboard: Array<Array<{ text: string; callback_data?: string }>> };
    }
  ).reply_markup.inline_keyboard;
}

describe("bot/commands/settings", () => {
  beforeEach(() => {
    interactionManager.__resetForTests();
    mocked.userLocale = undefined;
    mocked.hideThinkingMessages = false;
    mocked.hideToolCallMessages = false;
    mocked.hideToolFileMessages = false;
    mocked.subagentTopicsEnabled = false;
    mocked.telegraphTranslateEnabled = false;
    mocked.subagentTopicAutoDeleteMinutes = 1;
    mocked.setUserLocaleMock.mockClear();
    mocked.setHideThinkingMessagesMock.mockClear();
    mocked.setHideToolCallMessagesMock.mockClear();
    mocked.setHideToolFileMessagesMock.mockClear();
    mocked.setTelegraphTranslateEnabledMock.mockClear();
    mocked.setSubagentTopicsEnabledMock.mockClear();
    mocked.setSubagentTopicAutoDeleteMinutesMock.mockClear();
  });

  it("replies with the settings title and root menu", async () => {
    const ctx = createCommandContext();

    await settingsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledTimes(1);
    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    const rows = getInlineRows(options);

    expect(text).toBe(t("settings.title"));
    expect(rows.map((row) => row[0]?.callback_data)).toEqual([
      "settings:language",
      "settings:toggle:hide_thinking",
      "settings:toggle:hide_tool_calls",
      "settings:toggle:hide_tool_files",
      "settings:toggle:telegraph_translate",
      "settings:toggle:subagent_topics",
      "settings:subagent_timeout",
      "inline:cancel:settings",
    ]);
    expect(rows[0]?.[0]?.text).toBe("🌐 🇬🇧 English");
    expect(rows[1]?.[0]?.text).toBe("✅ Thinking");
    expect(rows[5]?.[0]?.text).toBe("X Subagent topics");
    expect(rows[6]?.[0]?.text).toBe("Subagent topic auto-delete: 1 min");
    expect(rows[rows.length - 1]?.[0]?.text).toBe(t("settings.close"));
  });

  it("edits to the language submenu using locale options", async () => {
    startActiveSettingsMenu();
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
    expect(rows[0]?.[0]).toMatchObject({
      text: "🇬🇧 English",
      callback_data: "settings:language:en",
    });
    expect(rows.some((row) => row[0]?.text === "🇷🇺 Русский")).toBe(true);
    expect(rows[rows.length - 1]?.[0]?.callback_data).toBe("inline:cancel:settings");
  });

  it("renders the language submenu title and cancel button with the stored locale", async () => {
    mocked.userLocale = "ru";
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:language");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    const rows = getInlineRows(options);

    expect(text).toBe(t("settings.language.title", undefined, "ru"));
    expect(rows[rows.length - 1]?.[0]?.text).toBe(t("settings.close", undefined, "ru"));
    expect(rows[rows.length - 1]?.[0]?.callback_data).toBe("inline:cancel:settings");
  });

  it("updates language and redraws the root menu in the selected locale", async () => {
    startActiveSettingsMenu();
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
    expect(rows[0]?.[0]?.text).toBe("🌐 🇷🇺 Русский");
  });

  it("toggles hide thinking messages", async () => {
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:toggle:hide_thinking");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setHideThinkingMessagesMock).toHaveBeenCalledWith(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.updated_callback") });
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[1]?.[0]?.text).toBe("X Thinking");
  });

  it("toggles hide tool call messages", async () => {
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:toggle:hide_tool_calls");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setHideToolCallMessagesMock).toHaveBeenCalledWith(true);
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[2]?.[0]?.text).toBe("X Tools");
  });

  it("toggles hide tool file messages", async () => {
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:toggle:hide_tool_files");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setHideToolFileMessagesMock).toHaveBeenCalledWith(true);
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[3]?.[0]?.text).toBe("X File changes");
  });

  it("toggles subagent topics", async () => {
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:toggle:subagent_topics");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);

    expect(mocked.setSubagentTopicsEnabledMock).toHaveBeenCalledWith(true);
    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[5]?.[0]?.text).toBe("✅ Subagent topics");
  });

  it("edits to the subagent timeout submenu", async () => {
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:subagent_timeout");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    const [text, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    const rows = getInlineRows(options);

    expect(text).toBe(t("settings.subagent_topic_timeout.title"));
    expect(rows.slice(0, 6).map((row) => row[0]?.callback_data)).toEqual([
      "settings:subagent_timeout:0",
      "settings:subagent_timeout:1",
      "settings:subagent_timeout:5",
      "settings:subagent_timeout:10",
      "settings:subagent_timeout:15",
      "settings:subagent_timeout:30",
    ]);
  });

  it("updates the subagent timeout and redraws the root menu", async () => {
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:subagent_timeout:30");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.setSubagentTopicAutoDeleteMinutesMock).toHaveBeenCalledWith(30);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.updated_callback") });

    const [, options] = (ctx.editMessageText as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      unknown,
    ];
    expect(getInlineRows(options)[6]?.[0]?.text).toBe("Subagent topic auto-delete: 30 min");
  });

  it("returns false for unknown and non-settings callbacks", async () => {
    expect(await handleSettingsCallback(createCallbackContext("model:select:0"))).toBe(false);
    expect(await handleSettingsCallback(createCallbackContext("inline:cancel:settings"))).toBe(
      false,
    );
    expect(await handleSettingsCallback(createCallbackContext("settings:unknown"))).toBe(false);
  });

  it("does not mutate language when the settings callback is stale", async () => {
    startActiveSettingsMenu(99);
    const ctx = createCallbackContext("settings:language:ru");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.setUserLocaleMock).not.toHaveBeenCalled();
    expect(mocked.userLocale).toBeUndefined();
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
  });

  it("does not mutate toggles when the settings callback is stale", async () => {
    startActiveSettingsMenu(99);
    const ctx = createCallbackContext("settings:toggle:hide_thinking");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    expect(mocked.setHideThinkingMessagesMock).not.toHaveBeenCalled();
    expect(mocked.hideThinkingMessages).toBe(false);
    expect(ctx.editMessageText).not.toHaveBeenCalled();
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("inline.inactive_callback"),
      show_alert: true,
    });
  });

  it("answers with an error when settings storage throws", async () => {
    mocked.setHideToolFileMessagesMock.mockImplementationOnce(() => {
      throw new Error("storage failed");
    });
    startActiveSettingsMenu();
    const ctx = createCallbackContext("settings:toggle:hide_tool_files");

    const handled = await handleSettingsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: t("settings.error_callback") });
  });

  it("exports the settings callback prefix", () => {
    expect(SETTINGS_CALLBACK_PREFIX).toBe("settings:");
  });
});
