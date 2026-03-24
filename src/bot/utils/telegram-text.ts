import type { Api, RawApi } from "grammy";
import {
  editMessageWithMarkdownFallback,
  sendMessageWithMarkdownFallback,
} from "./send-with-markdown-fallback.js";

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
  options?: TelegramSendMessageOptions;
  format?: TelegramTextFormat;
}

interface EditBotTextParams {
  api: EditMessageApi;
  chatId: Parameters<EditMessageApi["editMessageText"]>[0];
  messageId: Parameters<EditMessageApi["editMessageText"]>[1];
  text: string;
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

export async function sendBotText({
  api,
  chatId,
  text,
  options,
  format = "raw",
}: SendBotTextParams): Promise<void> {
  if (format === "html") {
    await api.sendMessage(chatId, text, {
      ...(options || {}),
      parse_mode: "HTML",
    });
    return;
  }

  await sendMessageWithMarkdownFallback({
    api,
    chatId,
    text,
    options,
    parseMode: resolveMarkdownParseMode(format),
  });
}

export async function editBotText({
  api,
  chatId,
  messageId,
  text,
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

  await api.sendMessageDraft(chatId, draftId, text, {
    ...(options || {}),
    ...(parseMode ? { parse_mode: parseMode } : {}),
  });
}
