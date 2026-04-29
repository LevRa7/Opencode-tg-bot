import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

async function loadConfig() {
  vi.resetModules();
  const module = await import("../src/config.js");
  return module.config;
}

describe("config boolean env parsing", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "test-telegram-token");
    vi.stubEnv("TELEGRAM_ADMIN_USER_ID", "123456789");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "test-provider");
    vi.stubEnv("OPENCODE_MODEL_ID", "test-model");
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("uses false defaults for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("parses truthy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "YES");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "1");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(true);
    expect(config.bot.hideToolCallMessages).toBe(true);
  });

  it("parses falsy values for hide service message flags", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "off");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "0");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("falls back to defaults on invalid values", async () => {
    vi.stubEnv("HIDE_THINKING_MESSAGES", "banana");
    vi.stubEnv("HIDE_TOOL_CALL_MESSAGES", "nope");

    const config = await loadConfig();

    expect(config.bot.hideThinkingMessages).toBe(false);
    expect(config.bot.hideToolCallMessages).toBe(false);
  });

  it("uses markdown as default message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses markdown message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "MARKDOWN");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("falls back to markdown on invalid message format mode", async () => {
    vi.stubEnv("MESSAGE_FORMAT_MODE", "html");

    const config = await loadConfig();

    expect(config.bot.messageFormatMode).toBe("markdown");
  });

  it("parses supported locale from BOT_LOCALE", async () => {
    vi.stubEnv("BOT_LOCALE", "fr");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("fr");
  });

  it("normalizes regional locale tags", async () => {
    vi.stubEnv("BOT_LOCALE", "ru-RU");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("ru");
  });

  it("falls back to default locale on unsupported value", async () => {
    vi.stubEnv("BOT_LOCALE", "pt");

    const config = await loadConfig();

    expect(config.bot.locale).toBe("en");
  });

  it("uses default task limit when TASK_LIMIT is missing", async () => {
    vi.stubEnv("TASK_LIMIT", "");

    const config = await loadConfig();

    expect(config.bot.taskLimit).toBe(10);
  });

  it("uses enabled streaming by default when RESPONSE_STREAMING is missing", async () => {
    vi.stubEnv("RESPONSE_STREAMING", "");

    const config = await loadConfig();

    expect(config.bot.responseStreaming).toBe(true);
  });

  it("parses RESPONSE_STREAMING boolean values", async () => {
    vi.stubEnv("RESPONSE_STREAMING", "off");

    const config = await loadConfig();

    expect(config.bot.responseStreaming).toBe(false);
  });

  it("uses default response stream throttle when RESPONSE_STREAM_THROTTLE_MS is missing", async () => {
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "");

    const config = await loadConfig();

    expect(config.bot.responseStreamThrottleMs).toBe(500);
  });

  it("uses default service messages interval when SERVICE_MESSAGES_INTERVAL_SEC is missing", async () => {
    vi.stubEnv("SERVICE_MESSAGES_INTERVAL_SEC", "");

    const config = await loadConfig();

    expect(config.bot.serviceMessagesIntervalSec).toBe(5);
  });

  it("parses SERVICE_MESSAGES_INTERVAL_SEC as a non-negative integer", async () => {
    vi.stubEnv("SERVICE_MESSAGES_INTERVAL_SEC", "12");

    const config = await loadConfig();

    expect(config.bot.serviceMessagesIntervalSec).toBe(12);
  });

  it("parses RESPONSE_STREAM_THROTTLE_MS as a positive integer", async () => {
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "750");

    const config = await loadConfig();

    expect(config.bot.responseStreamThrottleMs).toBe(750);
  });

  it("parses BASH_TOOL_DISPLAY_MAX_LENGTH as a positive integer", async () => {
    vi.stubEnv("BASH_TOOL_DISPLAY_MAX_LENGTH", "96");

    const config = await loadConfig();

    expect(config.bot.bashToolDisplayMaxLength).toBe(96);
  });

  it("falls back to default bash tool display length on invalid value", async () => {
    vi.stubEnv("BASH_TOOL_DISPLAY_MAX_LENGTH", "zero");

    const config = await loadConfig();

    expect(config.bot.bashToolDisplayMaxLength).toBe(128);
  });

  it("falls back to default response stream throttle on invalid value", async () => {
    vi.stubEnv("RESPONSE_STREAM_THROTTLE_MS", "zero");

    const config = await loadConfig();

    expect(config.bot.responseStreamThrottleMs).toBe(500);
  });

  it("parses TASK_LIMIT as a positive integer", async () => {
    vi.stubEnv("TASK_LIMIT", "25");

    const config = await loadConfig();

    expect(config.bot.taskLimit).toBe(25);
  });

  it("falls back to default task limit on invalid TASK_LIMIT", async () => {
    vi.stubEnv("TASK_LIMIT", "zero");

    const config = await loadConfig();

    expect(config.bot.taskLimit).toBe(10);
  });

  it("keeps TTS credentials unset when dedicated vars are missing", async () => {
    vi.stubEnv("STT_API_URL", "https://api.openai.com/v1");
    vi.stubEnv("STT_API_KEY", "sk-test-key");
    vi.stubEnv("TTS_PROVIDER", "");
    vi.stubEnv("TTS_API_URL", "");
    vi.stubEnv("TTS_API_KEY", "");
    vi.stubEnv("TTS_VOICE", "");

    const config = await loadConfig();

    expect(config.tts.provider).toBe("openai");
    expect(config.tts.apiUrl).toBe("");
    expect(config.tts.apiKey).toBe("");
    expect(config.tts.model).toBe("gpt-4o-mini-tts");
    expect(config.tts.voice).toBe("alloy");
  });

  it("parses the google TTS provider", async () => {
    vi.stubEnv("TTS_PROVIDER", "GOOGLE");
    vi.stubEnv("TTS_VOICE", "");

    const config = await loadConfig();

    expect(config.tts.provider).toBe("google");
    expect(config.tts.voice).toBe("en-US-Standard-A");
  });

  it("falls back to openai when TTS_PROVIDER is invalid", async () => {
    vi.stubEnv("TTS_PROVIDER", "azure");

    const config = await loadConfig();

    expect(config.tts.provider).toBe("openai");
  });

  it("loads host telegram and bot defaults from admin env file", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "opencode-admin-env-"));
    const admin = path.join(root, "admin");
    const user = path.join(root, "user");
    await fs.mkdir(admin, { recursive: true });
    await fs.mkdir(user, { recursive: true });
    await fs.writeFile(
      path.join(admin, ".env"),
      [
        "TELEGRAM_BOT_TOKEN=admin-bot-token",
        "TELEGRAM_ADMIN_USER_ID=777",
        "BOT_LOCALE=ru",
        "STT_API_URL=https://host-stt.local/v1",
        "TTS_API_URL=https://host-tts.local/v1",
        "OPENCODE_MODEL_PROVIDER=openai",
        "OPENCODE_MODEL_ID=gpt-5.4",
      ].join("\n"),
      "utf-8",
    );
    await fs.writeFile(path.join(user, ".env"), "OPENCODE_MODEL_ID=gpt-5.4-mini\n", "utf-8");

    vi.stubEnv("OPENCODE_TELEGRAM_ADMIN_HOME", admin);
    vi.stubEnv("OPENCODE_TELEGRAM_HOME", user);
    vi.stubEnv("TELEGRAM_BOT_TOKEN", "");
    vi.stubEnv("TELEGRAM_ADMIN_USER_ID", "");
    vi.stubEnv("BOT_LOCALE", "");
    vi.stubEnv("STT_API_URL", "");
    vi.stubEnv("TTS_API_URL", "");
    vi.stubEnv("OPENCODE_MODEL_PROVIDER", "");
    vi.stubEnv("OPENCODE_MODEL_ID", "");

    const config = await loadConfig();

    expect(config.telegram.token).toBe("admin-bot-token");
    expect(config.telegram.adminUserId).toBe(777);
    expect(config.bot.locale).toBe("ru");
    expect(config.stt.apiUrl).toBe("https://host-stt.local/v1");
    expect(config.tts.apiUrl).toBe("https://host-tts.local/v1");
    expect(config.opencode.model.provider).toBe("openai");
    expect(config.opencode.model.modelId).toBe("gpt-5.4-mini");
  });

  it("parses OPEN_BROWSER_ROOTS into a trimmed string array", async () => {
    vi.stubEnv("OPEN_BROWSER_ROOTS", " /workspace, /tmp/project , /var/data ");

    const config = await loadConfig();

    expect(config.open.browserRoots).toEqual(["/workspace", "/tmp/project", "/var/data"]);
  });

  it("uses an empty OPEN_BROWSER_ROOTS list by default", async () => {
    vi.stubEnv("OPEN_BROWSER_ROOTS", "");

    const config = await loadConfig();

    expect(config.open.browserRoots).toEqual([]);
  });

  it("parses new optional config values for bot, server, tasks, and stt", async () => {
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "true");
    vi.stubEnv("LOG_RETENTION", "30");
    vi.stubEnv("SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES", "45");
    vi.stubEnv("STT_NOTE_PROMPT", "Summarize the note before sending.");

    const config = await loadConfig();

    expect(config.bot.hideToolFileMessages).toBe(true);
    expect(config.bot.logRetention).toBe(30);
    expect(config.bot.scheduledTaskExecutionTimeoutMinutes).toBe(45);
    expect(config.stt.notePrompt).toBe("Summarize the note before sending.");
  });

  it("uses defaults for new optional config values when env vars are missing", async () => {
    vi.stubEnv("HIDE_TOOL_FILE_MESSAGES", "");
    vi.stubEnv("LOG_RETENTION", "");
    vi.stubEnv("SCHEDULED_TASK_EXECUTION_TIMEOUT_MINUTES", "");
    vi.stubEnv("STT_NOTE_PROMPT", "");

    const config = await loadConfig();

    expect(config.bot.hideToolFileMessages).toBe(false);
    expect(config.bot.logRetention).toBe(10);
    expect(config.bot.scheduledTaskExecutionTimeoutMinutes).toBe(120);
    expect(config.stt.notePrompt).toBe("");
  });

  it("uses disabled auto-restart defaults when env vars are missing", async () => {
    vi.stubEnv("OPENCODE_AUTO_RESTART_ENABLED", "");
    vi.stubEnv("OPENCODE_MONITOR_INTERVAL_SEC", "");

    const config = await loadConfig();

    expect(config.opencode.autoRestart.enabled).toBe(false);
    expect(config.opencode.autoRestart.monitorIntervalSec).toBe(300);
  });

  it("parses optional auto-restart config values", async () => {
    vi.stubEnv("OPENCODE_AUTO_RESTART_ENABLED", "true");
    vi.stubEnv("OPENCODE_MONITOR_INTERVAL_SEC", "45");

    const config = await loadConfig();

    expect(config.opencode.autoRestart.enabled).toBe(true);
    expect(config.opencode.autoRestart.monitorIntervalSec).toBe(45);
  });

  it("falls back to default monitor interval when configured value is invalid", async () => {
    vi.stubEnv("OPENCODE_MONITOR_INTERVAL_SEC", "zero");

    const config = await loadConfig();

    expect(config.opencode.autoRestart.monitorIntervalSec).toBe(300);
  });
});
