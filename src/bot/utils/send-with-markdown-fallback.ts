import { logger } from "../../utils/logger.js";
import type { Api, RawApi } from "grammy";
import { withMessageThreadId } from "./message-thread.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type SendMessageDraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramSendMessageDraftOptions = Parameters<SendMessageDraftApi["sendMessageDraft"]>[3];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];
type TelegramParseMode = "Markdown" | "MarkdownV2" | "HTML";

interface SendMessageWithMarkdownFallbackParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  parseMode?: TelegramParseMode;
  messageThreadId?: number;
}

interface SendMessageDraftWithMarkdownFallbackParams {
  api: SendMessageDraftApi;
  chatId: Parameters<SendMessageDraftApi["sendMessageDraft"]>[0];
  draftId: Parameters<SendMessageDraftApi["sendMessageDraft"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageDraftOptions;
  parseMode?: TelegramParseMode;
}

interface EditMessageWithMarkdownFallbackParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  parseMode?: TelegramParseMode;
}

const TELEGRAM_PARSE_ERROR_MARKERS = [
  "can't parse entities",
  "can't parse entity",
  "can't find end of the entity",
  "can't find end tag corresponding to start tag",
  "entity beginning",
  "unsupported start tag",
  "unexpected end tag",
  "bad request: can't parse",
];

const MARKDOWN_PARSE_ERROR_MARKERS = [
  "can't parse entities",
  "can't parse entity",
  "can't find end of the entity",
  "entity beginning",
  "bad request: can't parse",
];

const MARKDOWN_V2_RESERVED_CHARS = new Set([
  "_",
  "*",
  "[",
  "]",
  "(",
  ")",
  "~",
  "`",
  ">",
  "#",
  "+",
  "-",
  "=",
  "|",
  "{",
  "}",
  ".",
  "!",
  "\\",
]);
const MARKDOWN_V2_ESCAPED_CHAR = /\\([_\*\[\]\(\)~`>#+\-=|{}.!\\])/g;

export function escapeTelegramMarkdownV2(text: string): string {
  let result = "";
  let trailingBackslashes = 0;

  for (const char of text) {
    if (char === "\\") {
      result += char;
      trailingBackslashes += 1;
      continue;
    }

    const isEscaped = trailingBackslashes % 2 === 1;
    trailingBackslashes = 0;

    if (MARKDOWN_V2_RESERVED_CHARS.has(char) && !isEscaped) {
      result += `\\${char}`;
      continue;
    }

    result += char;
  }

  return result;
}

function unescapeTelegramMarkdownV2(text: string): string {
  return text.replace(MARKDOWN_V2_ESCAPED_CHAR, "$1");
}

function stripTelegramFormattingOptions<
  T extends
    | TelegramSendMessageOptions
    | TelegramSendMessageDraftOptions
    | TelegramEditMessageOptions
    | undefined,
>(options: T): T {
  if (!options) {
    return options;
  }

  const rawOptions = {
    ...options,
  } as NonNullable<T> & {
    parse_mode?: unknown;
    entities?: unknown;
  };

  delete rawOptions.parse_mode;
  delete rawOptions.entities;

  return rawOptions as T;
}

function getErrorText(error: unknown): string {
  const parts: string[] = [];

  if (error instanceof Error) {
    parts.push(error.message);
  }

  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }

    const message = Reflect.get(error, "message");
    if (typeof message === "string") {
      parts.push(message);
    }
  }

  if (typeof error === "string") {
    parts.push(error);
  }

  if (parts.length === 0) {
    return "";
  }

  return parts.join("\n").toLowerCase();
}

export function isTelegramParseError(error: unknown): boolean {
  const errorText = getErrorText(error);
  if (!errorText) {
    return false;
  }

  return TELEGRAM_PARSE_ERROR_MARKERS.some((marker) => errorText.includes(marker));
}

export function isTelegramMarkdownParseError(error: unknown): boolean {
  const errorText = getErrorText(error);
  if (!errorText) {
    return false;
  }

  return MARKDOWN_PARSE_ERROR_MARKERS.some((marker) => errorText.includes(marker));
}

export async function sendMessageWithMarkdownFallback({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  parseMode,
  messageThreadId,
}: SendMessageWithMarkdownFallbackParams): Promise<Awaited<ReturnType<SendMessageApi["sendMessage"]>>> {
  if (!parseMode) {
    return api.sendMessage(chatId, text, withMessageThreadId(options, messageThreadId));
  }

  const telegramOptions: TelegramSendMessageOptions = {
    ...withMessageThreadId(options, messageThreadId),
    parse_mode: parseMode,
  };

  const fallbackText = rawFallbackText ?? (parseMode === "MarkdownV2" ? unescapeTelegramMarkdownV2(text) : text);

  try {
    return await api.sendMessage(chatId, text, telegramOptions);
  } catch (error) {
    if (!isTelegramParseError(error)) {
      throw error;
    }

    if (parseMode === "MarkdownV2") {
      const escapedText = escapeTelegramMarkdownV2(text);
      if (escapedText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying assistant message with escaped MarkdownV2",
          error,
        );

        try {
          return await api.sendMessage(chatId, escapedText, telegramOptions);
        } catch (escapedError) {
          if (!isTelegramParseError(escapedError)) {
            throw escapedError;
          }

          logger.warn(
            "[Bot] Escaped Markdown parse failed, retrying assistant message in raw mode",
            escapedError,
          );
          return api.sendMessage(
            chatId,
            fallbackText,
            stripTelegramFormattingOptions(withMessageThreadId(options, messageThreadId)),
          );
        }
      }
    }

    logger.warn(
      `[Bot] ${parseMode === "HTML" ? "HTML" : "Markdown"} parse failed, retrying assistant message in raw mode`,
      error,
    );
    return api.sendMessage(
      chatId,
      fallbackText,
      stripTelegramFormattingOptions(withMessageThreadId(options, messageThreadId)),
    );
  }
}

export async function sendMessageDraftWithMarkdownFallback({
  api,
  chatId,
  draftId,
  text,
  rawFallbackText,
  options,
  parseMode,
}: SendMessageDraftWithMarkdownFallbackParams): Promise<Awaited<ReturnType<SendMessageDraftApi["sendMessageDraft"]>>> {
  if (!parseMode) {
    return api.sendMessageDraft(chatId, draftId, text, options);
  }

  const draftOptions: TelegramSendMessageDraftOptions = {
    ...(options || {}),
    parse_mode: parseMode,
  };

  const fallbackText = rawFallbackText ?? (parseMode === "MarkdownV2" ? unescapeTelegramMarkdownV2(text) : text);

  try {
    return await api.sendMessageDraft(chatId, draftId, text, draftOptions);
  } catch (error) {
    if (!isTelegramParseError(error)) {
      throw error;
    }

    if (parseMode === "MarkdownV2") {
      const escapedText = escapeTelegramMarkdownV2(text);
      if (escapedText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying assistant draft with escaped MarkdownV2",
          error,
        );

        try {
          return await api.sendMessageDraft(chatId, draftId, escapedText, draftOptions);
        } catch (escapedError) {
          if (!isTelegramParseError(escapedError)) {
            throw escapedError;
          }

          logger.warn(
            "[Bot] Escaped Markdown parse failed, retrying assistant draft in raw mode",
            escapedError,
          );
          return api.sendMessageDraft(
            chatId,
            draftId,
            fallbackText,
            stripTelegramFormattingOptions(options),
          );
        }
      }
    }

    logger.warn(
      `[Bot] ${parseMode === "HTML" ? "HTML" : "Markdown"} parse failed, retrying assistant draft in raw mode`,
      error,
    );
    return api.sendMessageDraft(
      chatId,
      draftId,
      fallbackText,
      stripTelegramFormattingOptions(options),
    );
  }
}

export async function editMessageWithMarkdownFallback({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  parseMode,
}: EditMessageWithMarkdownFallbackParams): Promise<Awaited<ReturnType<EditMessageApi["editMessageText"]>>> {
  if (!parseMode) {
    return api.editMessageText(chatId, messageId, text, options);
  }

  const telegramOptions: TelegramEditMessageOptions = {
    ...(options || {}),
    parse_mode: parseMode,
  };

  const fallbackText = rawFallbackText ?? (parseMode === "MarkdownV2" ? unescapeTelegramMarkdownV2(text) : text);

  try {
    return await api.editMessageText(chatId, messageId, text, telegramOptions);
  } catch (error) {
    if (!isTelegramParseError(error)) {
      throw error;
    }

    if (parseMode === "MarkdownV2") {
      const escapedText = escapeTelegramMarkdownV2(text);
      if (escapedText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying edited message with escaped MarkdownV2",
          error,
        );

        try {
          return await api.editMessageText(chatId, messageId, escapedText, telegramOptions);
        } catch (escapedError) {
          if (!isTelegramParseError(escapedError)) {
            throw escapedError;
          }

          logger.warn(
            "[Bot] Escaped Markdown parse failed, retrying edited message in raw mode",
            escapedError,
          );
          return api.editMessageText(
            chatId,
            messageId,
            fallbackText,
            stripTelegramFormattingOptions(options),
          );
        }
      }
    }

    logger.warn(
      `[Bot] ${parseMode === "HTML" ? "HTML" : "Markdown"} parse failed, retrying edited message in raw mode`,
      error,
    );
    return api.editMessageText(
      chatId,
      messageId,
      fallbackText,
      stripTelegramFormattingOptions(options),
    );
  }
}
