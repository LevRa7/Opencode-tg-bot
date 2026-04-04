import type { TelegramTextFormat } from "./telegram-text.js";

interface FinalizeAssistantResponseOptions {
  sessionId: string;
  messageText: string;
  flushDraftStream: (sessionId: string) => Promise<void>;
  flushPendingServiceMessages: () => Promise<void>;
  formatSummary: (messageText: string) => string[];
  formatRawSummary: (messageText: string) => string[];
  resolveFormat: () => TelegramTextFormat;
  getReplyKeyboard: () => unknown;
  sendQrCodes?: (messageText: string) => Promise<void>;
  sendText: (
    text: string,
    rawFallbackText: string | undefined,
    options: { reply_markup: unknown } | undefined,
    format: TelegramTextFormat,
  ) => Promise<void>;
}

export async function finalizeAssistantResponse({
  sessionId,
  messageText,
  flushDraftStream,
  flushPendingServiceMessages,
  formatSummary,
  formatRawSummary,
  resolveFormat,
  getReplyKeyboard,
  sendQrCodes,
  sendText,
}: FinalizeAssistantResponseOptions): Promise<boolean> {
  await flushDraftStream(sessionId);
  await flushPendingServiceMessages();
  await sendQrCodes?.(messageText);

  const parts = formatSummary(messageText);
  const rawParts = formatRawSummary(messageText);
  const format = resolveFormat();

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const rawFallbackText = rawParts[partIndex];
    const keyboard = getReplyKeyboard();
    const options = keyboard ? { reply_markup: keyboard } : undefined;
    await sendText(part, rawFallbackText, options, format);
  }

  return false;
}
