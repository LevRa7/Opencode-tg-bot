import { logger } from "../../utils/logger.js";
import type { Api, RawApi } from "grammy";
import { withMessageThreadId } from "./message-thread.js";
import { sanitizeHtmlForTelegram } from "./html-sanitize.js";
import { markdownToHtml } from "./reasoning-format.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type SendMessageDraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;
type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramSendMessageDraftOptions = Parameters<SendMessageDraftApi["sendMessageDraft"]>[3];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];
type TelegramParseMode = "Markdown" | "MarkdownV2" | "HTML";
type TelegramFormattingOptions =
  | TelegramSendMessageOptions
  | TelegramSendMessageDraftOptions
  | TelegramEditMessageOptions;

interface SendMessageWithMarkdownFallbackParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  parseMode?: TelegramParseMode;
  messageThreadId?: number;
  useHtmlFallback?: boolean;
}

interface SendMessageDraftWithMarkdownFallbackParams {
  api: SendMessageDraftApi;
  chatId: Parameters<SendMessageDraftApi["sendMessageDraft"]>[0];
  draftId: Parameters<SendMessageDraftApi["sendMessageDraft"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageDraftOptions;
  parseMode?: TelegramParseMode;
  messageThreadId?: number;
}

interface EditMessageWithMarkdownFallbackParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  parseMode?: TelegramParseMode;
  messageThreadId?: number;
  useHtmlFallback?: boolean;
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
  "entity url",
  "wrong http url",
  "url host is empty",
];

const TELEGRAM_ENTITY_URL_ERROR_MARKERS = ["entity url", "wrong http url", "url host is empty"];

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

function resolveMessageThreadOptions<T extends TelegramFormattingOptions | undefined>(
  options: T,
  messageThreadId: number | undefined,
): T {
  const explicitThreadId = Reflect.get(options ?? {}, "message_thread_id");
  const resolvedThreadId =
    typeof explicitThreadId === "number" && Number.isInteger(explicitThreadId) && explicitThreadId > 0
      ? explicitThreadId
      : messageThreadId;

  return withMessageThreadId(options, resolvedThreadId) as T;
}

interface SafeTelegramRender<TOptions extends TelegramFormattingOptions | undefined> {
  initialText: string;
  initialOptions: NonNullable<TOptions> | Record<string, never>;
  escapedRetryText: string | null;
  htmlFallbackText: string | null;
  htmlFallbackOptions: NonNullable<TOptions> | Record<string, never>;
  fallbackText: string;
  fallbackOptions: NonNullable<TOptions> | Record<string, never>;
  hasFormatting: boolean;
  shouldRetryEscapedMarkdown: boolean;
  formatName: string;
}

function buildSafeTelegramRender<TOptions extends TelegramFormattingOptions | undefined>({
  text,
  rawFallbackText,
  options,
  parseMode,
  messageThreadId,
  useHtmlFallback,
}: {
  text: string;
  rawFallbackText?: string;
  options?: TOptions;
  parseMode?: TelegramParseMode;
  messageThreadId?: number;
  useHtmlFallback?: boolean;
}): SafeTelegramRender<TOptions> {
  const resolvedOptions = resolveMessageThreadOptions(options, messageThreadId);
  const hasEntities = !!resolvedOptions?.entities?.length;
  const hasFormatting = !!parseMode || hasEntities;
  const initialText = parseMode === "HTML" && !hasEntities ? sanitizeHtmlForTelegram(text) : text;

  const initialOptions = {
    ...(resolvedOptions ?? {}),
  } as NonNullable<TOptions> | Record<string, never>;

  if (parseMode && !hasEntities) {
    Reflect.set(initialOptions, "parse_mode", parseMode);
  }

  const strippedOptions = stripTelegramFormattingOptions(resolvedOptions) ?? {};

  // HTML fallback: convert markdown to HTML for a middle-ground fallback
  // between entities/MarkdownV2 and raw text (opt-in, only when source is not already HTML)
  const shouldTryHtmlFallback = useHtmlFallback && parseMode !== "HTML" && hasFormatting;
  const htmlText = shouldTryHtmlFallback ? markdownToHtml(rawFallbackText ?? text) : null;
  const htmlFallbackOptions = {
    ...strippedOptions,
    ...(htmlText ? { parse_mode: "HTML" } : {}),
  } as unknown as NonNullable<TOptions> | Record<string, never>;

  return {
    initialText,
    initialOptions,
    escapedRetryText: parseMode === "MarkdownV2" && !hasEntities ? escapeTelegramMarkdownV2(text) : null,
    htmlFallbackText: htmlText,
    htmlFallbackOptions,
    fallbackText: rawFallbackText ?? (parseMode === "MarkdownV2" ? unescapeTelegramMarkdownV2(text) : text),
    fallbackOptions: strippedOptions ?? {},
    hasFormatting,
    shouldRetryEscapedMarkdown: parseMode === "MarkdownV2" && !hasEntities,
    formatName: parseMode ? (parseMode === "HTML" ? "HTML" : "Markdown") : "entities",
  };
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
  useHtmlFallback,
}: SendMessageWithMarkdownFallbackParams): Promise<Awaited<ReturnType<SendMessageApi["sendMessage"]>>> {
  const render = buildSafeTelegramRender({
    text,
    rawFallbackText,
    options,
    parseMode,
    messageThreadId,
    useHtmlFallback,
  });

  if (!render.hasFormatting) {
    return api.sendMessage(chatId, render.initialText, render.initialOptions);
  }

  try {
    return await api.sendMessage(chatId, render.initialText, render.initialOptions);
  } catch (error) {
    if (!isTelegramParseError(error)) {
      throw error;
    }

    if (render.shouldRetryEscapedMarkdown && render.escapedRetryText && render.escapedRetryText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying assistant message with escaped MarkdownV2",
          error,
        );

        try {
          return await api.sendMessage(chatId, render.escapedRetryText, render.initialOptions);
        } catch (escapedError) {
          if (!isTelegramParseError(escapedError)) {
            throw escapedError;
          }
        }
    }

    // HTML fallback: render markdown as HTML before falling to raw
    if (render.htmlFallbackText) {
      logger.warn(
        `[Bot] ${render.formatName} parse failed, retrying with HTML fallback`,
      );
      try {
        return await api.sendMessage(chatId, render.htmlFallbackText, render.htmlFallbackOptions);
      } catch (htmlError) {
        if (!isTelegramParseError(htmlError)) {
          throw htmlError;
        }
      }
    }

    logger.warn(
      `[Bot] All formatted attempts failed, sending in raw mode`,
    );
    return api.sendMessage(chatId, render.fallbackText, render.fallbackOptions);
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
  messageThreadId,
}: SendMessageDraftWithMarkdownFallbackParams): Promise<Awaited<ReturnType<SendMessageDraftApi["sendMessageDraft"]>>> {
  const render = buildSafeTelegramRender({
    text,
    rawFallbackText,
    options,
    parseMode,
    messageThreadId,
  });

  if (!render.hasFormatting) {
    return api.sendMessageDraft(chatId, draftId, render.initialText, render.initialOptions);
  }

  try {
    return await api.sendMessageDraft(chatId, draftId, render.initialText, render.initialOptions);
  } catch (error) {
    if (!isTelegramParseError(error)) {
      throw error;
    }

    if (render.shouldRetryEscapedMarkdown && render.escapedRetryText && render.escapedRetryText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying assistant draft with escaped MarkdownV2",
          error,
        );

        try {
          return await api.sendMessageDraft(
            chatId,
            draftId,
            render.escapedRetryText,
            render.initialOptions,
          );
        } catch (escapedError) {
          if (!isTelegramParseError(escapedError)) {
            throw escapedError;
          }
        }
    }

    if (render.htmlFallbackText) {
      try {
        return await api.sendMessageDraft(chatId, draftId, render.htmlFallbackText, render.htmlFallbackOptions);
      } catch (htmlError) {
        if (!isTelegramParseError(htmlError)) {
          throw htmlError;
        }
      }
    }

    return api.sendMessageDraft(chatId, draftId, render.fallbackText, render.fallbackOptions);
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
  messageThreadId,
  useHtmlFallback,
}: EditMessageWithMarkdownFallbackParams): Promise<Awaited<ReturnType<EditMessageApi["editMessageText"]>>> {
  const render = buildSafeTelegramRender({
    text,
    rawFallbackText,
    options,
    parseMode,
    messageThreadId,
    useHtmlFallback,
  });

  if (!render.hasFormatting) {
    return api.editMessageText(chatId, messageId, render.initialText, render.initialOptions);
  }

  try {
    return await api.editMessageText(chatId, messageId, render.initialText, render.initialOptions);
  } catch (error) {
    if (!isTelegramParseError(error)) {
      throw error;
    }

    if (render.shouldRetryEscapedMarkdown && render.escapedRetryText && render.escapedRetryText !== text) {
        logger.warn(
          "[Bot] Markdown parse failed, retrying edited message with escaped MarkdownV2",
          error,
        );

        try {
          return await api.editMessageText(
            chatId,
            messageId,
            render.escapedRetryText,
            render.initialOptions,
          );
        } catch (escapedError) {
          if (!isTelegramParseError(escapedError)) {
            throw escapedError;
          }
        }
    }

    // HTML fallback: render markdown as HTML before falling to raw
    if (render.htmlFallbackText) {
      logger.warn(
        `[Bot] ${render.formatName} parse failed, retrying edit with HTML fallback`,
      );
      try {
        return await api.editMessageText(chatId, messageId, render.htmlFallbackText, render.htmlFallbackOptions);
      } catch (htmlError) {
        if (!isTelegramParseError(htmlError)) {
          throw htmlError;
        }
      }
    }

    logger.warn(
      `[Bot] All formatted attempts failed, editing in raw mode`,
    );
    return api.editMessageText(chatId, messageId, render.fallbackText, render.fallbackOptions);
  }
}
