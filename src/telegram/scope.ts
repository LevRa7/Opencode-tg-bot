import { AsyncLocalStorage } from "node:async_hooks";
import type { Context } from "grammy";
import { extractMessageThreadIdFromContext, isForumChat } from "../bot/utils/message-thread.js";
import { ConversationContextKey } from "../thread/conversation-context-key.js";

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

  let messageThreadId = extractMessageThreadIdFromContext(ctx);
  if (isForumChat(ctx)) {
    if (messageThreadId === undefined) {
      messageThreadId = 0; // main thread
    }
  } else if (ctx.chat?.type === "private") {
    // Private chats with Direct Messages topics (bot `has_topics_enabled`)
    // carry a real per-topic message_thread_id. Keep it so each topic gets its
    // own conversation scope; plain private chats simply have no thread id.
    //
    // Fixed 2026-06-25: a previous blanket strip set messageThreadId=undefined
    // for every non-forum chat, collapsing all private-chat topics into the
    // single scope key `userId:chatId:0`. That broke topic isolation —
    // getCurrentSession() then resolved every topic to the last-created session
    // and foregroundSessionState marked all topics busy together. Delivery
    // targeting is sanitized separately by extractThreadTargetFromContext, so
    // preserving the real topic id here is safe.
  } else {
    // Non-forum groups/channels should never use a stray message_thread_id as a
    // scope discriminator — strip it even if Telegram provides one.
    messageThreadId = undefined;
  }

  return {
    userId,
    chatId,
    messageThreadId,
  };
}

export function buildTelegramConversationScopeKey(
  scope: TelegramConversationScope | null | undefined,
): string {
  if (!scope) {
    return GLOBAL_TELEGRAM_SCOPE_KEY;
  }

  return ConversationContextKey.fromScope(scope).toString();
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
