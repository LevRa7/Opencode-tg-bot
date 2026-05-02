import type { Api, RawApi } from "grammy";
import { logger } from "../../utils/logger.js";
import {
  editMessageWithMarkdownFallback,
  sendMessageDraftWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";
import { withTelegramDeliveryTarget, type TelegramDeliveryTarget } from "./message-thread.js";

type SendMessageApi = Pick<Api<RawApi>, "sendMessage">;
type SendMessageDraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type EditMessageApi = Pick<Api<RawApi>, "editMessageText">;

type TelegramSendMessageOptions = Parameters<SendMessageApi["sendMessage"]>[2];
type TelegramSendMessageDraftOptions = Parameters<SendMessageDraftApi["sendMessageDraft"]>[3];
type TelegramEditMessageOptions = Parameters<EditMessageApi["editMessageText"]>[3];

export type TelegramTextFormat = "raw" | "markdown_v2" | "html";

export interface SendBotTextParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  /** Telegram sendMessage options, including entities */
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
  messageThreadId?: number;
  deliveryTarget?: TelegramDeliveryTarget | null;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
  rawFallbackText?: string;
  /** Telegram editMessageText options, including entities */
  options?: TelegramEditMessageOptions;
  format?: TelegramTextFormat;
}

interface SendStreamedBotTextSendParams {
  api: SendMessageApi;
  chatId: Parameters<SendMessageApi["sendMessage"]>[0];
  text: string;
  rawFallbackText?: string;
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
  messageThreadId?: number;
  deliveryTarget?: TelegramDeliveryTarget | null;
}

interface SendStreamedBotTextEditParams {
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
  /** Telegram sendMessageDraft options, including entities */
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

function resolveSafeRenderConfig(
  format: TelegramTextFormat,
  rawFallbackText: string | undefined,
): {
  parseMode: "MarkdownV2" | "HTML" | undefined;
  fallbackText: string | undefined;
} {
  if (format === "html") {
    return {
      parseMode: "HTML",
      fallbackText: rawFallbackText,
    };
  }

  return {
    parseMode: resolveMarkdownParseMode(format),
    fallbackText: rawFallbackText,
  };
}

export async function sendStreamedBotText(
  params: SendStreamedBotTextSendParams,
): Promise<number | null>;
export async function sendStreamedBotText(
  params: SendStreamedBotTextEditParams,
): Promise<void>;
export async function sendStreamedBotText(
  params: SendStreamedBotTextSendParams | SendStreamedBotTextEditParams,
): Promise<number | null | void> {
  const format = params.format ?? "raw";
  const renderConfig = resolveSafeRenderConfig(format, params.rawFallbackText);

  if ("messageId" in params) {
    await editMessageWithMarkdownFallback({
      api: params.api,
      chatId: params.chatId,
      messageId: params.messageId,
      text: params.text,
      rawFallbackText: renderConfig.fallbackText,
      options: params.options,
      parseMode: renderConfig.parseMode,
    });
    return;
  }

  const result = await sendMessageWithMarkdownFallback({
    api: params.api,
    chatId: params.chatId,
    text: params.text,
    rawFallbackText: renderConfig.fallbackText,
    options: withTelegramDeliveryTarget(
      params.options,
      params.deliveryTarget ??
        (typeof params.chatId === "number" && typeof params.messageThreadId === "number"
          ? { chatId: params.chatId, messageThreadId: params.messageThreadId }
          : undefined),
    ),
    parseMode: renderConfig.parseMode,
    messageThreadId: params.messageThreadId,
  });

  return (result as { message_id?: number })?.message_id ?? null;
}

export async function sendBotText({
  api,
  chatId,
  text,
  rawFallbackText,
  options,
  format = "raw",
  messageThreadId,
  deliveryTarget,
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
    return await sendStreamedBotText({
      api,
      chatId,
      text,
      rawFallbackText,
      options,
      format,
      messageThreadId,
      deliveryTarget,
    });
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
    await sendStreamedBotText({
      api,
      chatId,
      messageId,
      text,
      rawFallbackText,
      options,
      format,
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

  const renderConfig = resolveSafeRenderConfig(format, undefined);

  logger.debug(
    `[TelegramText] sendBotTextDraft: chatId=${chatId}, draftId=${draftId}, format=${format}, textLength=${text.length}`,
  );

  try {
    await sendMessageDraftWithMarkdownFallback({
      api,
      chatId,
      draftId,
      text,
      rawFallbackText: renderConfig.fallbackText,
      options,
      parseMode: renderConfig.parseMode,
    });
  } catch (error) {
    logger.error(
      `[TelegramText] sendBotTextDraft failed: chatId=${chatId}, draftId=${draftId}, format=${format}, textLength=${text.length}`,
      error,
    );
    throw error;
  }
}
