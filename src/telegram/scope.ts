import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "grammy";
import { extractMessageThreadIdFromContext } from "../bot/utils/message-thread.js";

export interface TelegramConversationScope {
  userId: number;
  chatId: number;
  messageThreadId?: number;
}

export const GLOBAL_TELEGRAM_SCOPE_KEY = "global";

const telegramScopeStorage = new AsyncLocalStorage<TelegramConversationScope | null>();

function normalizeInteger(value: unknown): number | undefined {
  return typeof value === "number" && Number.isInteger(value) ? value : undefined;
}

function extractUserIdFromContext(ctx: Context): number | undefined {
  return normalizeInteger(ctx.from?.id);
}

function extractChatIdFromContext(ctx: Context): number | undefined {
  return normalizeInteger(ctx.chat?.id);
}

export function extractTelegramConversationScopeFromContext(
  ctx: Context,
): TelegramConversationScope | null {
  const userId = extractUserIdFromContext(ctx);
  const chatId = extractChatIdFromContext(ctx);

  if (userId === undefined || chatId === undefined) {
    return null;
  }

  return {
    userId,
    chatId,
    messageThreadId: extractMessageThreadIdFromContext(ctx),
  };
}

export function buildTelegramConversationScopeKey(
  scope: TelegramConversationScope | null | undefined,
): string {
  if (!scope) {
    return GLOBAL_TELEGRAM_SCOPE_KEY;
  }

  return `${scope.userId}:${scope.chatId}:${scope.messageThreadId ?? 0}`;
}

export function getCurrentTelegramConversationScope(): TelegramConversationScope | null {
  return telegramScopeStorage.getStore() ?? null;
}

export function getCurrentTelegramConversationScopeKey(): string {
  return buildTelegramConversationScopeKey(getCurrentTelegramConversationScope());
}

export function resolveTelegramConversationScopeKey(
  scope?: TelegramConversationScope | string | null,
): string {
  if (typeof scope === "string") {
    return scope;
  }

  return buildTelegramConversationScopeKey(scope ?? getCurrentTelegramConversationScope());
}

export function runWithTelegramConversationScope<T>(
  scope: TelegramConversationScope | null,
  fn: () => T,
): T {
  return telegramScopeStorage.run(scope, fn);
}
