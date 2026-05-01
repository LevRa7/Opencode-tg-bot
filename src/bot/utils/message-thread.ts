import type { Context } from "grammy";

export interface BotTopicCapability {
  has_topics_enabled?: boolean;
}

export interface TelegramThreadTarget {
  chatId: number;
  messageThreadId?: number;
}

export interface TelegramDeliveryTarget extends TelegramThreadTarget {
  disableNotification?: boolean;
}

type WithMessageThreadId = {
  message_thread_id?: number;
};

type WithChatId = {
  chat?: {
    id?: unknown;
  };
};

type WithForumFlag = {
  chat?: {
    is_forum?: unknown;
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

export function isForumChat(ctx: Context): boolean {
  const messageForum = (ctx.message as WithForumFlag | undefined)?.chat?.is_forum;
  if (messageForum === true) {
    return true;
  }

  const callbackForum = (ctx.callbackQuery?.message as WithForumFlag | undefined)?.chat?.is_forum;
  if (callbackForum === true) {
    return true;
  }

  return ctx.chat?.is_forum === true;
}

export function isTopicCapableChat(ctx: Context, botInfo?: BotTopicCapability): boolean {
  if (isForumChat(ctx)) {
    return true;
  }

  if (ctx.chat?.type === "private" && botInfo?.has_topics_enabled === true) {
    return true;
  }

  return false;
}

export function extractMessageThreadIdFromContext(ctx: Context): number | undefined {
  const messageThreadIdFromMessage = normalizeMessageThreadId(
    (ctx.message as { message_thread_id?: unknown } | undefined)?.message_thread_id,
  );

  if (messageThreadIdFromMessage !== undefined) {
    return messageThreadIdFromMessage;
  }

  const callbackMessage = ctx.callbackQuery?.message as { message_thread_id?: unknown } | undefined;
  return normalizeMessageThreadId(callbackMessage?.message_thread_id);
}

export function isForumMainThreadContext(ctx: Context): boolean {
  return isForumChat(ctx) && extractMessageThreadIdFromContext(ctx) === undefined;
}

export function resolveReplyKeyboardActionThreadId(ctx: Context): number | undefined {
  return isForumMainThreadContext(ctx) ? 0 : extractMessageThreadIdFromContext(ctx);
}

export function extractCallbackMessageIdFromContext(ctx: Context): number | null {
  const callbackMessage = ctx.callbackQuery?.message as { message_id?: unknown } | undefined;
  return typeof callbackMessage?.message_id === "number" ? callbackMessage.message_id : null;
}

export function extractThreadTargetFromContext(ctx: Context): TelegramThreadTarget | null {
  const chatId = extractChatIdFromContext(ctx);
  const messageThreadId = extractMessageThreadIdFromContext(ctx);
  if (chatId === undefined) {
    return null;
  }

  if (messageThreadId !== undefined) {
    return {
      chatId,
      messageThreadId,
    };
  }

  if (!isForumChat(ctx)) {
    return null;
  }

  return {
    chatId,
    messageThreadId: 0,
  };
}

export function withMessageThreadId<T extends object>(
  options: T | undefined,
  messageThreadId: number | undefined,
): T & WithMessageThreadId {
  if (messageThreadId === undefined || messageThreadId <= 0) {
    return (options ?? {}) as T & WithMessageThreadId;
  }

  return {
    ...(options ?? ({} as T)),
    message_thread_id: messageThreadId,
  };
}

export function withTelegramDeliveryTarget<T extends object>(
  options: T | undefined,
  target: TelegramDeliveryTarget | null | undefined,
): T & WithMessageThreadId & { disable_notification?: true } {
  const withThread = withMessageThreadId(options, target?.messageThreadId);
  if (!target?.disableNotification) {
    return withThread;
  }

  return {
    ...withThread,
    disable_notification: true,
  };
}
