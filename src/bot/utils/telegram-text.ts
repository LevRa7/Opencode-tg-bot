import type { Api, RawApi } from "grammy";
import {
  editMessageWithMarkdownFallback,
  isTelegramMarkdownParseError,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import { withMessageThreadId } from "./message-thread.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type SendMessageDraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

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

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramSendMessageDraftOptions = Parameters<SendMessageDraftApi["sendMessageDraft"]>[3];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type TelegramTextFormat = "raw" | "markdown_v2" | "html";

interface SendBotTextParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
  messageThreadId?: number;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  options?: TelegramEditMessageOptions;
  format?: TelegramTextFormat;
}

interface SendBotTextDraftParams {
  api: SendMessageDraftApi;
  chatId: Parameters<SendMessageDraftApi["sendMessageDraft"]>[0];
  draftId: Parameters<SendMessageDraftApi["sendMessageDraft"]>[1];
  text: string;
  options?: TelegramSendMessageDraftOptions;
  format?: TelegramTextFormat;
}

function resolveMarkdownParseMode(
  format: TelegramTextFormat | undefined,
): "MarkdownV2" | undefined {
  if (format === "markdown_v2") {
    return "MarkdownV2";
  }

  return undefined;
}

function escapeTelegramMarkdownV2(text: string): string {
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

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
  messageThreadId,
}: SendBotTextParams): Promise<void> {
  if (format === "html") {
    await api.sendMessage(chatId, text, {
      ...(options || {}),
      ...withMessageThreadId(undefined, messageThreadId),
      parse_mode: "HTML",
    });
    return;
  }

  await sendMessageWithMarkdownFallback({
    api,
    chatId,
    text,
    rawFallbackText,
    options: withMessageThreadId(options, messageThreadId),
    parseMode: resolveMarkdownParseMode(format),
  });
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
  rawFallbackText,
  options,
  format = "raw",
}: EditBotTextParams): Promise<void> {
  if (format === "html") {
    await api.editMessageText(chatId, messageId, text, {
      ...(options || {}),
      parse_mode: "HTML",
    });
    return;
  }

  await editMessageWithMarkdownFallback({
    api,
    chatId,
    messageId,
    text,
    rawFallbackText,
    options,
    parseMode: resolveMarkdownParseMode(format),
  });
}

export async function sendBotTextDraft({
  api,
  chatId,
  draftId,
  text,
  options,
  format = "raw",
}: SendBotTextDraftParams): Promise<void> {
  const parseMode = format === "html" ? "HTML" : resolveMarkdownParseMode(format);
  const draftOptions = parseMode
    ? {
        ...(options || {}),
        parse_mode: parseMode as "MarkdownV2" | "HTML",
      }
    : (options || {});

  try {
    await api.sendMessageDraft(chatId, draftId, text, draftOptions as any);
  } catch (error) {
    if (format === "html" || !parseMode || !isTelegramMarkdownParseError(error)) {
      throw error;
    }

    if (parseMode === "MarkdownV2") {
      const escapedText = escapeTelegramMarkdownV2(text);
      if (escapedText !== text) {
        await api.sendMessageDraft(chatId, draftId, escapedText, draftOptions as any);
        return;
      }
    }

    throw error;
  }
}
