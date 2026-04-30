import { InlineKeyboard, type CommandContext, type Context } from "grammy";
import {
  getHideThinkingMessages,
  getHideToolCallMessages,
  getHideToolFileMessages,
  getUserLocale,
  setHideThinkingMessages,
  setHideToolCallMessages,
  setHideToolFileMessages,
  setUserLocale,
} from "../../settings/manager.js";
import { getLocaleOptions, resolveSupportedLocale, t, type Locale } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export const SETTINGS_CALLBACK_PREFIX = "settings:";

const SETTINGS_CALLBACK_LANGUAGE = `${SETTINGS_CALLBACK_PREFIX}language`;
const SETTINGS_CALLBACK_LANGUAGE_PREFIX = `${SETTINGS_CALLBACK_LANGUAGE}:`;
const SETTINGS_CALLBACK_TOGGLE_PREFIX = `${SETTINGS_CALLBACK_PREFIX}toggle:`;
const SETTINGS_CALLBACK_CANCEL = `${SETTINGS_CALLBACK_PREFIX}cancel`;

type ToggleSettingId = "hide_thinking" | "hide_tool_calls" | "hide_tool_files";

interface SettingsRenderState {
  locale: Locale;
  languageLabel: string;
  hideThinkingMessages: boolean;
  hideToolCallMessages: boolean;
  hideToolFileMessages: boolean;
}

function getActiveLocale(): Locale {
  return getUserLocale() ?? resolveSupportedLocale(process.env.BOT_LOCALE) ?? "en";
}

function getLocaleLabel(locale: Locale): string {
  return getLocaleOptions().find((option) => option.code === locale)?.label ?? locale;
}

function getSettingsRenderState(localeOverride?: Locale): SettingsRenderState {
  const locale = localeOverride ?? getActiveLocale();
  return {
    locale,
    languageLabel: getLocaleLabel(locale),
    hideThinkingMessages: getHideThinkingMessages(),
    hideToolCallMessages: getHideToolCallMessages(),
    hideToolFileMessages: getHideToolFileMessages(),
  };
}

function formatToggleState(enabled: boolean, locale: Locale): string {
  return t(enabled ? "settings.state.on" : "settings.state.off", undefined, locale);
}

function buildSettingsRootKeyboard(state: SettingsRenderState): InlineKeyboard {
  return new InlineKeyboard()
    .text(
      t("settings.language", { value: state.languageLabel }, state.locale),
      SETTINGS_CALLBACK_LANGUAGE,
    )
    .row()
    .text(
      t(
        "settings.hide_thinking_messages",
        { state: formatToggleState(state.hideThinkingMessages, state.locale) },
        state.locale,
      ),
      `${SETTINGS_CALLBACK_TOGGLE_PREFIX}hide_thinking`,
    )
    .row()
    .text(
      t(
        "settings.hide_tool_call_messages",
        { state: formatToggleState(state.hideToolCallMessages, state.locale) },
        state.locale,
      ),
      `${SETTINGS_CALLBACK_TOGGLE_PREFIX}hide_tool_calls`,
    )
    .row()
    .text(
      t(
        "settings.hide_tool_file_messages",
        { state: formatToggleState(state.hideToolFileMessages, state.locale) },
        state.locale,
      ),
      `${SETTINGS_CALLBACK_TOGGLE_PREFIX}hide_tool_files`,
    )
    .row()
    .text(t("inline.button.cancel", undefined, state.locale), SETTINGS_CALLBACK_CANCEL);
}

function buildLanguageKeyboard(locale: Locale): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const option of getLocaleOptions()) {
    keyboard.text(option.label, `${SETTINGS_CALLBACK_LANGUAGE_PREFIX}${option.code}`).row();
  }

  keyboard.text(t("inline.button.cancel", undefined, locale), SETTINGS_CALLBACK_CANCEL);
  return keyboard;
}

async function redrawRootMenu(ctx: Context, localeOverride?: Locale): Promise<void> {
  const state = getSettingsRenderState(localeOverride);
  await ctx.editMessageText(t("settings.title", undefined, state.locale), {
    reply_markup: buildSettingsRootKeyboard(state),
  });
}

function toggleSetting(settingId: ToggleSettingId): void {
  switch (settingId) {
    case "hide_thinking":
      setHideThinkingMessages(!getHideThinkingMessages());
      return;
    case "hide_tool_calls":
      setHideToolCallMessages(!getHideToolCallMessages());
      return;
    case "hide_tool_files":
      setHideToolFileMessages(!getHideToolFileMessages());
      return;
  }
}

function isToggleSettingId(value: string): value is ToggleSettingId {
  return value === "hide_thinking" || value === "hide_tool_calls" || value === "hide_tool_files";
}

async function handleSettingsError(ctx: Context, error: unknown): Promise<boolean> {
  logger.error("[SettingsCommand] Failed to update settings", error);
  await ctx.answerCallbackQuery({ text: t("settings.error_callback") }).catch(() => {});
  return true;
}

export async function settingsCommand(ctx: CommandContext<Context>): Promise<void> {
  const state = getSettingsRenderState();
  await ctx.reply(t("settings.title", undefined, state.locale), {
    reply_markup: buildSettingsRootKeyboard(state),
  });
}

export async function handleSettingsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith(SETTINGS_CALLBACK_PREFIX)) {
    return false;
  }

  try {
    if (data === SETTINGS_CALLBACK_LANGUAGE) {
      const locale = getActiveLocale();
      await ctx.editMessageText(t("settings.language.title", undefined, locale), {
        reply_markup: buildLanguageKeyboard(locale),
      });
      return true;
    }

    if (data === SETTINGS_CALLBACK_CANCEL) {
      const locale = getActiveLocale();
      await ctx
        .answerCallbackQuery({ text: t("inline.cancelled_callback", undefined, locale) })
        .catch(() => {});
      await ctx.deleteMessage().catch(() => {});
      return true;
    }

    if (data.startsWith(SETTINGS_CALLBACK_LANGUAGE_PREFIX)) {
      const locale = resolveSupportedLocale(data.slice(SETTINGS_CALLBACK_LANGUAGE_PREFIX.length));
      if (!locale) {
        return false;
      }

      setUserLocale(locale);
      await ctx.answerCallbackQuery({ text: t("settings.language_updated_callback", undefined, locale) });
      await redrawRootMenu(ctx, locale);
      return true;
    }

    if (data.startsWith(SETTINGS_CALLBACK_TOGGLE_PREFIX)) {
      const settingId = data.slice(SETTINGS_CALLBACK_TOGGLE_PREFIX.length);
      if (!isToggleSettingId(settingId)) {
        return false;
      }

      toggleSetting(settingId);
      await ctx.answerCallbackQuery({ text: t("settings.updated_callback") });
      await redrawRootMenu(ctx);
      return true;
    }

    return false;
  } catch (error) {
    return handleSettingsError(ctx, error);
  }
}
