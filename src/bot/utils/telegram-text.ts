import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";
import {
  editMessageWithMarkdownFallback,
  sendMessageDraftWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import { withMessageThreadId } from "./message-thread.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type SendMessageDraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

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

function getFullErrorText(error: unknown): string {
  const parts: string[] = [];
  if (error instanceof Error) {
    parts.push(error.message);
  }
  if (typeof error === "object" && error !== null) {
    const description = Reflect.get(error, "description");
    if (typeof description === "string") {
      parts.push(description);
    }
  }
  if (typeof error === "string") {
    parts.push(error);
  }
  return parts.join(" ").toLowerCase();
}

function resolveMarkdownParseMode(
  format: TelegramTextFormat | undefined,
): "MarkdownV2" | undefined {
  if (format === "markdown_v2") {
    return "MarkdownV2";
  }

  return undefined;
}

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
  messageThreadId,
}: SendBotTextParams): Promise<number | null> {
  logger.debug(
    `[TelegramText] sendBotText: chatId=${chatId}, threadId=${messageThreadId ?? "none"}, format=${format}, textLength=${text.length}`,
  );

  if (!text.trim()) {
    logger.debug(
      `[TelegramText] sendBotText skipped empty text: chatId=${chatId}, threadId=${messageThreadId ?? "none"}, format=${format}`,
    );
    return null;
  }

  try {
    const result = await sendMessageWithMarkdownFallback({
      api,
      chatId,
      text,
      rawFallbackText: format === "html" ? text : rawFallbackText,
      options: withMessageThreadId(options, messageThreadId),
      parseMode: format === "html" ? "HTML" : resolveMarkdownParseMode(format),
      messageThreadId,
    });
    return (result as { message_id?: number })?.message_id ?? null;
  } catch (error) {
    logger.error(
      `[TelegramText] sendBotText failed: chatId=${chatId}, threadId=${messageThreadId ?? "none"}, format=${format}, textLength=${text.length}`,
      error,
    );
    throw error;
  }
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
  logger.debug(
    `[TelegramText] editBotText: chatId=${chatId}, messageId=${messageId}, format=${format}, textLength=${text.length}`,
  );

  if (!text.trim()) {
    logger.debug(
      `[TelegramText] editBotText skipped empty text: chatId=${chatId}, messageId=${messageId}, format=${format}`,
    );
    return;
  }

  try {
    await editMessageWithMarkdownFallback({
      api,
      chatId,
      messageId,
      text,
      rawFallbackText: format === "html" ? text : rawFallbackText,
      options,
      parseMode: format === "html" ? "HTML" : resolveMarkdownParseMode(format),
    });
  } catch (error) {
    const errorText = getFullErrorText(error);
    if (errorText.includes("message is not modified")) {
      logger.debug(
        `[TelegramText] editBotText skipped: message already has same content, chatId=${chatId}, messageId=${messageId}`,
      );
      return;
    }
    logger.error(
      `[TelegramText] editBotText failed: chatId=${chatId}, messageId=${messageId}, format=${format}, textLength=${text.length}`,
      error,
    );
    throw error;
  }
}

export async function sendBotTextDraft({
  api,
  chatId,
  draftId,
  text,
  options,
  format = "raw",
}: SendBotTextDraftParams): Promise<void> {
  if (!text.trim()) {
    logger.debug(
      `[TelegramText] sendBotTextDraft skipped empty text: chatId=${chatId}, draftId=${draftId}, format=${format}`,
    );
    return;
  }

  const parseMode = format === "html" ? "HTML" : resolveMarkdownParseMode(format);

  logger.debug(
    `[TelegramText] sendBotTextDraft: chatId=${chatId}, draftId=${draftId}, format=${format}, textLength=${text.length}`,
  );

  try {
    await sendMessageDraftWithMarkdownFallback({
      api,
      chatId,
      draftId,
      text,
      rawFallbackText: format === "html" ? text : undefined,
      options,
      parseMode,
    });
  } catch (error) {
    logger.error(
      `[TelegramText] sendBotTextDraft failed: chatId=${chatId}, draftId=${draftId}, format=${format}, textLength=${text.length}`,
      error,
    );
    throw error;
  }
}
