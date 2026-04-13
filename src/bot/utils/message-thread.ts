import type { Context } from "grammy";

export interface TelegramThreadTarget {
  chatId: number;
  messageThreadId?: number;
}

type WithMessageThreadId = {
  message_thread_id?: number;
};

type WithChatId = {
  chat?: {
    id?: unknown;
  };
};

function normalizeMessageThreadId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : undefined;
}

function normalizeChatId(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function extractChatIdFromContext(ctx: Context): number | undefined {
  const messageChatId = normalizeChatId((ctx.message as WithChatId | undefined)?.chat?.id);
  if (messageChatId !== undefined) {
    return messageChatId;
  }

  const callbackMessageChatId = normalizeChatId(
    (ctx.callbackQuery?.message as WithChatId | undefined)?.chat?.id,
  );
  if (callbackMessageChatId !== undefined) {
    return callbackMessageChatId;
  }

  return normalizeChatId(ctx.chat?.id);
}

export function extractMessageThreadIdFromContext(ctx: Context): number | undefined {
  const messageThreadIdFromMessage = normalizeMessageThreadId(
    (ctx.message as { message_thread_id?: unknown } | undefined)?.message_thread_id,
  );

  if (messageThreadIdFromMessage !== undefined) {
    return messageThreadIdFromMessage;
  }

  const callbackMessage = ctx.callbackQuery?.message as
    | { message_thread_id?: unknown }
    | undefined;
  return normalizeMessageThreadId(callbackMessage?.message_thread_id);
}

export function extractCallbackMessageIdFromContext(ctx: Context): number | null {
  const callbackMessage = ctx.callbackQuery?.message as { message_id?: unknown } | undefined;
  return typeof callbackMessage?.message_id === "number" ? callbackMessage.message_id : null;
}

export function extractThreadTargetFromContext(ctx: Context): TelegramThreadTarget | null {
  const chatId = extractChatIdFromContext(ctx);
  const messageThreadId = extractMessageThreadIdFromContext(ctx);
  if (chatId === undefined || messageThreadId === undefined) {
    return null;
  }

  return {
    chatId,
    messageThreadId,
  };
}

export function withMessageThreadId<T extends object>(
  options: T | undefined,
  messageThreadId: number | undefined,
): T & WithMessageThreadId {
  if (messageThreadId === undefined) {
    return (options ?? {}) as T & WithMessageThreadId;
  }

  return {
    ...(options ?? ({} as T)),
    message_thread_id: messageThreadId,
  };
}
