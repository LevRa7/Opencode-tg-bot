import dotenv from "dotenv";
import fs from "node:fs";
import { getRuntimePaths } from "./runtime/paths.js";
import { normalizeLocale, type Locale } from "./i18n/index.js";

const runtimePaths = getRuntimePaths();

function loadEnvFile(filePath: string | null): Record<string, string> {
  if (!filePath || !fs.existsSync(filePath)) {
    return {};
  }

  return dotenv.parse(fs.readFileSync(filePath, "utf-8"));
}

function loadMergedEnv(): void {
  const admin = loadEnvFile(runtimePaths.adminEnvFilePath);
  const user = loadEnvFile(runtimePaths.envFilePath);

  for (const [key, value] of Object.entries(admin)) {
    if (!process.env[key] || process.env[key]?.trim().length === 0) {
      process.env[key] = value;
    }
  }

  for (const [key, value] of Object.entries(user)) {
    if (value.trim().length > 0) {
      process.env[key] = value;
    }
  }
}

loadMergedEnv();

export type MessageFormatMode = "raw" | "markdown";

function getEnvVar(key: string, required: boolean = true): string {
  const value = process.env[key];
  if (required && !value) {
    throw new Error(
      `Missing required environment variable: ${key} (expected in ${runtimePaths.envFilePath})`,
    );
  }
  return value || "";
}

function getOptionalPositiveIntEnvVar(key: string, defaultValue: number): number {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const parsedValue = Number.parseInt(value, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return defaultValue;
  }

  return parsedValue;
}

function getOptionalNonNegativeIntEnvVarFromKeys(keys: string[], defaultValue: number): number {
  for (const key of keys) {
    const value = getEnvVar(key, false);
    if (!value) {
      continue;
    }

    const parsedValue = Number.parseInt(value, 10);
    if (Number.isNaN(parsedValue) || parsedValue < 0) {
      return defaultValue;
    }

    return parsedValue;
  }

  return defaultValue;
}

function getOptionalLocaleEnvVar(key: string, defaultValue: Locale): Locale {
  const value = getEnvVar(key, false);
  return normalizeLocale(value, defaultValue);
}

function getOptionalBooleanEnvVar(key: string, defaultValue: boolean): boolean {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();

  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return defaultValue;
}

function getOptionalMessageFormatModeEnvVar(
  key: string,
  defaultValue: MessageFormatMode,
): MessageFormatMode {
  const value = getEnvVar(key, false);

  if (!value) {
    return defaultValue;
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "raw" || normalized === "markdown") {
    return normalized;
  }

  return defaultValue;
}

function parsePositiveInteger(value: string): number | null {
  const normalized = value.trim();
  if (!/^\d+$/.test(normalized)) {
    return null;
  }

  const parsedValue = Number.parseInt(normalized, 10);
  if (Number.isNaN(parsedValue) || parsedValue <= 0) {
    return null;
  }

  return parsedValue;
}

function getTelegramAdminUserId(): number {
  const adminUserId = parsePositiveInteger(getEnvVar("TELEGRAM_ADMIN_USER_ID", false));
  if (adminUserId !== null) {
    return adminUserId;
  }

  const legacyAllowedUserId = parsePositiveInteger(getEnvVar("TELEGRAM_ALLOWED_USER_ID", false));
  if (legacyAllowedUserId !== null) {
    return legacyAllowedUserId;
  }

  throw new Error(
    `Missing required environment variable: TELEGRAM_ADMIN_USER_ID (or legacy TELEGRAM_ALLOWED_USER_ID) (expected in ${runtimePaths.envFilePath})`,
  );
}

function getOptionalTelegramUserIdListEnvVar(key: string): number[] {
  const value = getEnvVar(key, false);
  if (!value) {
    return [];
  }

  const ids = new Set<number>();

  for (const rawPart of value.split(/[\s,]+/)) {
    const parsedValue = parsePositiveInteger(rawPart);
    if (parsedValue !== null) {
      ids.add(parsedValue);
    }
  }

  return Array.from(ids);
}

const adminUserId = getTelegramAdminUserId();
const configuredAllowedUserIds = new Set<number>([
  adminUserId,
  ...getOptionalTelegramUserIdListEnvVar("TELEGRAM_ALLOWED_USER_IDS"),
]);

export const config = {
  telegram: {
    token: getEnvVar("TELEGRAM_BOT_TOKEN"),
    adminUserId,
    allowedUserIds: Array.from(configuredAllowedUserIds),
    proxyUrl: getEnvVar("TELEGRAM_PROXY_URL", false),
  },
  opencode: {
    apiUrl: getEnvVar("OPENCODE_API_URL", false) || "http://localhost:4096",
    username: getEnvVar("OPENCODE_SERVER_USERNAME", false) || "opencode",
    password: getEnvVar("OPENCODE_SERVER_PASSWORD", false),
    model: {
      provider: getEnvVar("OPENCODE_MODEL_PROVIDER", true),
      modelId: getEnvVar("OPENCODE_MODEL_ID", true),
    },
  },
  server: {
    logLevel: getEnvVar("LOG_LEVEL", false) || "info",
  },
  bot: {
    sessionsListLimit: getOptionalPositiveIntEnvVar("SESSIONS_LIST_LIMIT", 10),
    projectsListLimit: getOptionalPositiveIntEnvVar("PROJECTS_LIST_LIMIT", 10),
    commandsListLimit: getOptionalPositiveIntEnvVar("COMMANDS_LIST_LIMIT", 10),
    taskLimit: getOptionalPositiveIntEnvVar("TASK_LIMIT", 10),
    responseStreaming: getOptionalBooleanEnvVar("RESPONSE_STREAMING", true),
    responseStreamThrottleMs: getOptionalPositiveIntEnvVar("RESPONSE_STREAM_THROTTLE_MS", 500),
    bashToolDisplayMaxLength: getOptionalPositiveIntEnvVar("BASH_TOOL_DISPLAY_MAX_LENGTH", 128),
    serviceMessagesIntervalSec: getOptionalNonNegativeIntEnvVarFromKeys(
      ["SERVICE_MESSAGES_INTERVAL_SEC", "TOOL_MESSAGES_INTERVAL_SEC"],
      5,
    ),
    locale: getOptionalLocaleEnvVar("BOT_LOCALE", "en"),
    hideThinkingMessages: getOptionalBooleanEnvVar("HIDE_THINKING_MESSAGES", false),
    hideToolCallMessages: getOptionalBooleanEnvVar("HIDE_TOOL_CALL_MESSAGES", false),
    messageFormatMode: getOptionalMessageFormatModeEnvVar("MESSAGE_FORMAT_MODE", "markdown"),
  },
  files: {
    maxFileSizeKb: parseInt(getEnvVar("CODE_FILE_MAX_SIZE_KB", false) || "100", 10),
  },
  stt: {
    apiUrl: getEnvVar("STT_API_URL", false),
    apiKey: getEnvVar("STT_API_KEY", false),
    model: getEnvVar("STT_MODEL", false) || "whisper-large-v3-turbo",
    language: getEnvVar("STT_LANGUAGE", false),
  },
  tts: {
    apiUrl: getEnvVar("TTS_API_URL", false),
    apiKey: getEnvVar("TTS_API_KEY", false),
    model: getEnvVar("TTS_MODEL", false) || "gpt-4o-mini-tts",
    voice: getEnvVar("TTS_VOICE", false) || "alloy",
  },
};
