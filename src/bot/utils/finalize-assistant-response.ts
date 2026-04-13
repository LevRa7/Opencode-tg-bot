import type { PreparedLocalFileFollowUp } from "./telegram-local-file-follow-up.js";
import type { TelegramTextFormat } from "./telegram-text.js";

interface FinalizeAssistantResponseOptions {
  sessionId: string;
  messageText: string;
  sourceText?: string;
  chunks?: string[];
  draftFailed?: boolean;
  flushDraftStream: (sessionId: string) => Promise<void>;
  flushPendingServiceMessages: () => Promise<void>;
  formatSummary: (messageText: string) => string[];
  formatRawSummary: (messageText: string) => string[];
  resolveFormat: () => TelegramTextFormat;
  getReplyKeyboard: () => unknown;
  prepareLocalFileFollowUps?: (messageText: string) => Promise<PreparedLocalFileFollowUp[]>;
  sendText: (
    text: string,
    rawFallbackText: string | undefined,
    options: { reply_markup: unknown } | undefined,
    format: TelegramTextFormat,
  ) => Promise<void>;
}

interface FinalizeAssistantResponseResult {
  followUpFiles: PreparedLocalFileFollowUp[];
}

export async function finalizeAssistantResponse({
  sessionId,
  messageText,
  sourceText,
  chunks,
  draftFailed = false,
  flushDraftStream,
  flushPendingServiceMessages,
  formatSummary,
  formatRawSummary,
  resolveFormat,
  getReplyKeyboard,
  prepareLocalFileFollowUps,
  sendText,
}: FinalizeAssistantResponseOptions): Promise<FinalizeAssistantResponseResult> {
  void draftFailed;

  // Что делает этот код:
  // - завершает основной поток ответа (draft/service flush + отправка текста),
  // - отдельно подготавливает follow-up файлы из сырого текста,
  // - но не отправляет их здесь, чтобы не блокировать основной ответ.
  // Почему выбрано это решение:
  // - асинхронная отправка follow-up медиа должна быть вынесена в orchestration слой,
  //   иначе следующий ответ может попасть в ненужную очередь ожидания.
  // Исправлено:
  // - убрана QR-специфичная блокирующая отправка из финализации.
  // Цель:
  // - вернуть кандидатов на media follow-up без влияния на отправку основного текста.
  const followUpFiles = prepareLocalFileFollowUps
    ? await prepareLocalFileFollowUps(sourceText ?? messageText)
    : [];

  await flushDraftStream(sessionId);
  await flushPendingServiceMessages();

  const format = resolveFormat();
  const keyboard = getReplyKeyboard();
  const options = keyboard ? { reply_markup: keyboard } : undefined;

  if (chunks && chunks.length > 0) {
    for (const chunk of chunks) {
      if (!chunk.trim()) {
        continue;
      }

      await sendText(chunk, undefined, options, format);
    }
    return { followUpFiles };
  }

  if (format === "html") {
    if (messageText.trim().length > 0) {
      await sendText(messageText, undefined, options, format);
    }
    return { followUpFiles };
  }

  const parts = formatSummary(messageText);
  const rawParts = formatRawSummary(messageText);

  for (let partIndex = 0; partIndex < parts.length; partIndex++) {
    const part = parts[partIndex];
    const rawFallbackText = rawParts[partIndex];
    if (!part.trim()) {
      continue;
    }
    await sendText(part, rawFallbackText, options, format);
  }

  return { followUpFiles };
}
