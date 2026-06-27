import type { Api } from "grammy";
import { logger } from "../../utils/logger.js";
import { MessageQueue } from "./message-queue.js";

/**
 * Global message queue instance.  Initialised by the bot entry point.
 * All safeSend calls use this singleton.
 */
let globalQueue: MessageQueue | null = null;

export function setGlobalMessageQueue(queue: MessageQueue): void {
  globalQueue = queue;
}

export function getGlobalMessageQueue(): MessageQueue | null {
  return globalQueue;
}

export interface SafeSendContext {
  sessionId?: string;
}

/**
 * Wraps `api.sendMessage` with automatic retry on failure.
 *
 * On transient errors (network, rate-limit, chat unavailable), the message is
 * enqueued in the global MessageQueue and retried with exponential backoff.
 * Returns the sent Message on success, or null if the message was queued.
 */
export async function safeSendMessage(
  api: Api,
  chatId: number,
  text: string,
  options?: Record<string, unknown>,
  context?: SafeSendContext,
): Promise<Record<string, unknown> | null> {
  try {
    return await (api.sendMessage as any)(chatId, text, options);
  } catch (err) {
    const queue = globalQueue;
    if (queue) {
      const msgId = `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      queue.enqueue({
        id: msgId,
        chatId,
        messageThreadId: options?.message_thread_id as number | undefined,
        text,
        options,
        sessionId: context?.sessionId,
      });
      logger.warn(`[SafeSend] Message queued msg=${msgId} chat=${chatId}:`, err);
    } else {
      logger.error("[SafeSend] No global queue — message lost:", err);
    }
    return null;
  }
}

/**
 * Wraps any API call with automatic retry on failure.
 * Similar to safeSendMessage but for arbitrary API methods (editMessageText, etc.)
 */
export async function safeApiCall<T>(
  apiCall: () => Promise<T>,
  fallbackQueue?: {
    chatId: number;
    text: string;
    options?: Record<string, unknown>;
    context?: SafeSendContext;
  },
): Promise<T | null> {
  try {
    return await apiCall();
  } catch (err) {
    if (fallbackQueue) {
      const queue = globalQueue;
      if (queue) {
        const msgId = `api_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        queue.enqueue({
          id: msgId,
          chatId: fallbackQueue.chatId,
          messageThreadId: fallbackQueue.options?.message_thread_id as number | undefined,
          text: fallbackQueue.text,
          options: fallbackQueue.options,
          sessionId: fallbackQueue.context?.sessionId,
        });
        logger.warn(`[SafeSend] API call queued as msg=${msgId}:`, err);
      }
    }
    return null;
  }
}
