import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getDateLocale,
  getLocale,
  getLocaleOptions,
  normalizeLocale,
  resetRuntimeLocale,
  resolveSupportedLocale,
  setRuntimeLocale,
  setUserLocaleResolver,
  SUPPORTED_LOCALES,
  t,
} from "../../src/i18n/index.js";
import {
  __resetSettingsForTests,
  getUserLocale,
  setUserLocale,
} from "../../src/settings/manager.js";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

setUserLocaleResolver(getUserLocale);

const COMMAND_LOCALIZATION_KEYS = [
  "open.access_denied",
  "open.back",
  "open.next_page",
  "open.no_subfolders",
  "open.open_error",
  "open.prev_page",
  "open.roots",
  "open.scan_error",
  "open.select_current",
  "open.select_error",
  "open.select_root",
  "open.selected",
  "open.subfolder_count",
  "open.subfolders_count",
  "skills.arguments_empty",
  "skills.button.cancel",
  "skills.button.execute",
  "skills.button.next_page",
  "skills.button.prev_page",
  "skills.cancelled_callback",
  "skills.confirm",
  "skills.empty",
  "skills.execute_callback",
  "skills.executing_prefix",
  "skills.fetch_error",
  "skills.inactive_callback",
  "skills.no_description",
  "skills.page_empty_callback",
  "skills.page_load_error_callback",
  "skills.select",
  "skills.select_page",
  "mcps.title",
  "mcps.detail_title",
  "mcps.detail_status",
  "mcps.detail_enabled",
  "mcps.detail_connection",
  "mcps.detail_command",
  "mcps.detail_url",
  "mcps.detail_error",
  "mcps.status.connected",
  "mcps.status.disabled",
  "mcps.status.failed",
  "mcps.status.needs_auth",
  "mcps.status.needs_client_registration",
  "mcps.enabled.enabled",
  "mcps.enabled.disabled",
  "mcps.connection.connected",
  "mcps.connection.disconnected",
  "mcps.button.back",
  "mcps.button.cancel",
  "mcps.cancelled_callback",
  "mcps.empty",
  "mcps.fetch_error",
  "mcps.inactive_callback",
] as const;

describe("i18n/index locale helpers", () => {
  afterEach(() => {
    resetRuntimeLocale();
    __resetSettingsForTests();
    vi.unstubAllEnvs();
  });

  it("resolves exact and regional locale values", () => {
    expect(resolveSupportedLocale("ru")).toBe("ru");
    expect(resolveSupportedLocale("ru-RU")).toBe("ru");
    expect(resolveSupportedLocale("en-US")).toBe("en");
    expect(resolveSupportedLocale("de")).toBe("de");
    expect(resolveSupportedLocale("fr")).toBe("fr");
    expect(resolveSupportedLocale("fr-FR")).toBe("fr");
  });

  it("normalizes unsupported locale values with fallback", () => {
    expect(normalizeLocale("pt", "en")).toBe("en");
    expect(normalizeLocale(undefined, "ru")).toBe("ru");
  });

  it("returns date locale from locale definition", () => {
    expect(getDateLocale("ru")).toBe("ru-RU");
    expect(getDateLocale("en")).toBe("en-US");
    expect(getDateLocale("de")).toBe("de-DE");
    expect(getDateLocale("fr")).toBe("fr-FR");
  });

  it("returns locale options from a single registry", () => {
    const optionCodes = getLocaleOptions().map((option) => option.code);
    expect(optionCodes).toEqual(SUPPORTED_LOCALES);
  });

  it("does not expose removed export_data description keys", () => {
    expect(t("cmd.description.export_data" as never, undefined, "en")).toBe(
      "cmd.description.export_data",
    );
    expect(t("cmd.description.export_data" as never, undefined, "ru")).toBe(
      "cmd.description.export_data",
    );
  });

  it("prefers runtime locale override over env locale", () => {
    vi.stubEnv("BOT_LOCALE", "en");
    setRuntimeLocale("ru");

    expect(getLocale()).toBe("ru");
  });

  it("uses scoped user locale before env locale", () => {
    vi.stubEnv("BOT_LOCALE", "en");
    __resetSettingsForTests();

    const locale = runWithTelegramConversationScope(
      { userId: 777, chatId: 123, messageThreadId: 1 },
      () => {
        setUserLocale("ru");
        return getLocale();
      },
    );

    expect(locale).toBe("ru");
  });

  it("keeps open, skills, and mcps localizations non-empty in every locale", () => {
    for (const locale of SUPPORTED_LOCALES) {
      for (const key of COMMAND_LOCALIZATION_KEYS) {
        expect(t(key, undefined, locale)).not.toBe("");
        expect(t(key, undefined, locale)).not.toBe(key);
      }
    }
  });
});
