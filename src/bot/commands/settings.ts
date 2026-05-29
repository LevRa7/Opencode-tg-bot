import { InlineKeyboard, type CommandContext, type Context } from "grammy";
import {
  appendInlineMenuCancelButton,
  ensureActiveInlineMenu,
  replyWithInlineMenu,
} from "../handlers/inline-menu.js";
import {
  getHideThinkingMessages,
  getHideToolCallMessages,
  getHideToolFileMessages,
  getSubagentTopicAutoDeleteMinutes,
  getSubagentTopicsEnabled,
  getTelegraphTranslateEnabled,
  getUserLocale,
  setHideThinkingMessages,
  setHideToolCallMessages,
  setHideToolFileMessages,
  setSubagentTopicAutoDeleteMinutes,
  setSubagentTopicsEnabled,
  setTelegraphTranslateEnabled,
  setUserLocale,
} from "../../settings/manager.js";
import { getLocaleOptions, resolveSupportedLocale, t, type Locale } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";

export const SETTINGS_CALLBACK_PREFIX = "settings:";

const SETTINGS_CALLBACK_LANGUAGE = `${SETTINGS_CALLBACK_PREFIX}language`;
const SETTINGS_CALLBACK_LANGUAGE_PREFIX = `${SETTINGS_CALLBACK_LANGUAGE}:`;
const SETTINGS_CALLBACK_SUBAGENT_TIMEOUT = `${SETTINGS_CALLBACK_PREFIX}subagent_timeout`;
const SETTINGS_CALLBACK_SUBAGENT_TIMEOUT_PREFIX = `${SETTINGS_CALLBACK_SUBAGENT_TIMEOUT}:`;
const SETTINGS_CALLBACK_TOGGLE_PREFIX = `${SETTINGS_CALLBACK_PREFIX}toggle:`;
const SUBAGENT_TOPIC_TIMEOUT_OPTIONS = [0, 1, 5, 10, 15, 30] as const;

type ToggleSettingId = "hide_thinking" | "hide_tool_calls" | "hide_tool_files" | "subagent_topics" | "telegraph_translate";

interface SettingsRenderState {
  locale: Locale;
  languageLabel: string;
  hideThinkingMessages: boolean;
  hideToolCallMessages: boolean;
  hideToolFileMessages: boolean;
  telegraphTranslateEnabled: boolean;
  subagentTopicsEnabled: boolean;
  subagentTopicAutoDeleteMinutes: number;
}

function getActiveLocale(): Locale {
  return getUserLocale() ?? resolveSupportedLocale(process.env.BOT_LOCALE) ?? "en";
}

function getLocaleLabel(locale: Locale): string {
  const option = getLocaleOptions().find((entry) => entry.code === locale);
  return option ? `${option.flag} ${option.label}` : locale;
}

function getSettingsRenderState(localeOverride?: Locale): SettingsRenderState {
  const locale = localeOverride ?? getActiveLocale();
  return {
    locale,
    languageLabel: getLocaleLabel(locale),
    hideThinkingMessages: getHideThinkingMessages(),
    hideToolCallMessages: getHideToolCallMessages(),
    hideToolFileMessages: getHideToolFileMessages(),
    telegraphTranslateEnabled: getTelegraphTranslateEnabled(),
    subagentTopicsEnabled: getSubagentTopicsEnabled(),
    subagentTopicAutoDeleteMinutes: getSubagentTopicAutoDeleteMinutes(),
  };
}

function formatToggleState(enabled: boolean, locale: Locale): string {
  return t(enabled ? "settings.state.off" : "settings.state.on", undefined, locale);
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
    .text(
      t(
        "settings.telegraph_translate",
        { state: formatToggleState(!state.telegraphTranslateEnabled, state.locale) },
        state.locale,
      ),
      `${SETTINGS_CALLBACK_TOGGLE_PREFIX}telegraph_translate`,
    )
    .row()
    .text(
      t(
        "settings.subagent_topics",
        { state: formatToggleState(!state.subagentTopicsEnabled, state.locale) },
        state.locale,
      ),
      `${SETTINGS_CALLBACK_TOGGLE_PREFIX}subagent_topics`,
    )
    .row()
    .text(
      t(
        "settings.subagent_topic_timeout",
        { minutes: state.subagentTopicAutoDeleteMinutes },
        state.locale,
      ),
      SETTINGS_CALLBACK_SUBAGENT_TIMEOUT,
    );
}

function buildLanguageKeyboard(_locale: Locale): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const option of getLocaleOptions()) {
    keyboard
      .text(`${option.flag} ${option.label}`, `${SETTINGS_CALLBACK_LANGUAGE_PREFIX}${option.code}`)
      .row();
  }

  return keyboard;
}

function buildSubagentTimeoutKeyboard(locale: Locale): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  for (const minutes of SUBAGENT_TOPIC_TIMEOUT_OPTIONS) {
    keyboard
      .text(
        t("settings.subagent_topic_timeout.option", { minutes }, locale),
        `${SETTINGS_CALLBACK_SUBAGENT_TIMEOUT_PREFIX}${minutes}`,
      )
      .row();
  }

  return keyboard;
}

function appendSettingsCloseButton(keyboard: InlineKeyboard, locale: Locale): InlineKeyboard {
  return appendInlineMenuCancelButton(keyboard, "settings", t("settings.close", undefined, locale));
}

async function replyWithSettingsMenu(
  ctx: CommandContext<Context>,
  state: SettingsRenderState,
): Promise<void> {
  await replyWithInlineMenu(ctx, {
    menuKind: "settings",
    text: t("settings.title", undefined, state.locale),
    keyboard: buildSettingsRootKeyboard(state),
    cancelLabel: t("settings.close", undefined, state.locale),
  });
}

async function redrawRootMenu(ctx: Context, localeOverride?: Locale): Promise<void> {
  const state = getSettingsRenderState(localeOverride);
  await ctx.editMessageText(t("settings.title", undefined, state.locale), {
    reply_markup: appendSettingsCloseButton(buildSettingsRootKeyboard(state), state.locale),
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
    case "subagent_topics":
      setSubagentTopicsEnabled(!getSubagentTopicsEnabled());
      return;
    case "telegraph_translate":
      setTelegraphTranslateEnabled(!getTelegraphTranslateEnabled());
      return;
  }
}

function isToggleSettingId(value: string): value is ToggleSettingId {
  return (
    value === "hide_thinking" ||
    value === "hide_tool_calls" ||
    value === "hide_tool_files" ||
    value === "subagent_topics" ||
    value === "telegraph_translate"
  );
}

async function handleSettingsError(ctx: Context, error: unknown): Promise<boolean> {
  logger.error("[SettingsCommand] Failed to update settings", error);
  await ctx.answerCallbackQuery({ text: t("settings.error_callback") }).catch(() => {});
  return true;
}

export async function settingsCommand(ctx: CommandContext<Context>): Promise<void> {
  const state = getSettingsRenderState();
  await replyWithSettingsMenu(ctx, state);
}

export async function handleSettingsCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith(SETTINGS_CALLBACK_PREFIX)) {
    return false;
  }

  try {
    if (data === SETTINGS_CALLBACK_LANGUAGE) {
      const isActiveMenu = await ensureActiveInlineMenu(ctx, "settings");
      if (!isActiveMenu) {
        return true;
      }

      const locale = getActiveLocale();
      await ctx.editMessageText(t("settings.language.title", undefined, locale), {
        reply_markup: appendSettingsCloseButton(buildLanguageKeyboard(locale), locale),
      });
      return true;
    }

    if (data.startsWith(SETTINGS_CALLBACK_LANGUAGE_PREFIX)) {
      const locale = resolveSupportedLocale(data.slice(SETTINGS_CALLBACK_LANGUAGE_PREFIX.length));
      if (!locale) {
        return false;
      }

      const isActiveMenu = await ensureActiveInlineMenu(ctx, "settings");
      if (!isActiveMenu) {
        return true;
      }

      setUserLocale(locale);
      await ctx.answerCallbackQuery({
        text: t("settings.language_updated_callback", undefined, locale),
      });
      await redrawRootMenu(ctx, locale);
      return true;
    }

    if (data === SETTINGS_CALLBACK_SUBAGENT_TIMEOUT) {
      const isActiveMenu = await ensureActiveInlineMenu(ctx, "settings");
      if (!isActiveMenu) {
        return true;
      }

      const locale = getActiveLocale();
      await ctx.editMessageText(t("settings.subagent_topic_timeout.title", undefined, locale), {
        reply_markup: appendSettingsCloseButton(buildSubagentTimeoutKeyboard(locale), locale),
      });
      return true;
    }

    if (data.startsWith(SETTINGS_CALLBACK_SUBAGENT_TIMEOUT_PREFIX)) {
      const minutes = Number.parseInt(
        data.slice(SETTINGS_CALLBACK_SUBAGENT_TIMEOUT_PREFIX.length),
        10,
      );
      if (
        !SUBAGENT_TOPIC_TIMEOUT_OPTIONS.includes(
          minutes as (typeof SUBAGENT_TOPIC_TIMEOUT_OPTIONS)[number],
        )
      ) {
        return false;
      }

      const isActiveMenu = await ensureActiveInlineMenu(ctx, "settings");
      if (!isActiveMenu) {
        return true;
      }

      setSubagentTopicAutoDeleteMinutes(minutes);
      await ctx.answerCallbackQuery({ text: t("settings.updated_callback") });
      await redrawRootMenu(ctx);
      return true;
    }

    if (data.startsWith(SETTINGS_CALLBACK_TOGGLE_PREFIX)) {
      const settingId = data.slice(SETTINGS_CALLBACK_TOGGLE_PREFIX.length);
      if (!isToggleSettingId(settingId)) {
        return false;
      }

      const isActiveMenu = await ensureActiveInlineMenu(ctx, "settings");
      if (!isActiveMenu) {
        return true;
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
