import type { Context } from "grammy";

/**
 * Extract a stable scope key from a grammy context.
 * Format: "chatId:threadId" for group threads, or just "chatId" for private chats.
 */
export function extractScopeKey(ctx: Context): string {
  const chatId = ctx.chat?.id;
  if (!chatId) return "unknown";
  const threadId = (ctx as any)?.message?.message_thread_id ?? undefined;
  return threadId ? `${chatId}:${threadId}` : String(chatId);
}
