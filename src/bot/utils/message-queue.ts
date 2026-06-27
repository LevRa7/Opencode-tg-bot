import type { Api } from "grammy";
import { logger } from "../../utils/logger.js";

/**
 * A message that failed to send and is queued for retry.
 */
export interface QueuedMessage {
  /** UUID for tracking */
  id: string;
  /** Target chat */
  chatId: number;
  /** Forum topic (if any) */
  messageThreadId?: number;
  /** Message text */
  text: string;
  /** Extra sendMessage options (parse_mode, reply_markup, etc.) */
  options?: Record<string, unknown>;
  /** When the message was first queued (epoch ms) */
  createdAt: number;
  /** Number of delivery attempts so far */
  attempts: number;
  /** Timestamp of last attempt (epoch ms) */
  lastAttemptAt: number;
  /** Error message from last failed attempt */
  lastError?: string;
  /** Associated session for context in admin notifications */
  sessionId?: string;
}

/**
 * Retry intervals in milliseconds.  After exhausting the list, the last value
 * is reused (every 30 minutes).
 */
const RETRY_INTERVALS_MS = [
  5_000,       // attempt 2: 5s
  30_000,      // attempt 3: 30s
  120_000,     // attempt 4: 2min
  600_000,     // attempt 5: 10min
  1_800_000,   // attempt 6+: 30min
];

/** Messages undelivered for longer than this trigger an admin notification. */
const ADMIN_NOTIFY_THRESHOLD_MS = 3_600_000; // 1 hour

/** How often the queue processor wakes up to retry pending messages. */
const PROCESSOR_INTERVAL_MS = 30_000; // 30 seconds

export type AdminNotifier = (episode: FailedEpisode) => Promise<void>;

export interface FailedEpisode {
  message: QueuedMessage;
  failedSince: number; // epoch ms when it first crossed the 1h threshold
  totalDuration: number; // ms since createdAt
}

/**
 * Persistent message queue with exponential-backoff retry.
 *
 * Messages that fail to send (network errors, rate limits, chat unavailable)
 * are enqueued and retried automatically.  If a message remains undelivered
 * for more than 1 hour, an admin notification is triggered via the provided
 * `adminNotifier` callback.
 *
 * Usage:
 *   const queue = new MessageQueue(botApi, adminNotifier);
 *   queue.enqueue({ id: "1", chatId: 123, text: "Hello", ... });
 *   // queue auto-processes every 30s
 */
export class MessageQueue {
  private pending = new Map<string, QueuedMessage>();
  private notified = new Set<string>(); // message IDs already notified
  private processorTimer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly api: Api,
    private readonly adminNotifier?: AdminNotifier,
    private readonly adminChatId?: number,
    private readonly adminTopicId?: number,
  ) {}

  /** Start the background retry processor. Idempotent. */
  start(): void {
    if (this.processorTimer) return;
    this.processorTimer = setInterval(() => {
      this.processPending().catch((err) => {
        logger.error("[MessageQueue] Processor error:", err);
      });
    }, PROCESSOR_INTERVAL_MS);
    logger.info("[MessageQueue] Started background processor");
  }

  /** Stop the background processor. */
  stop(): void {
    if (this.processorTimer) {
      clearInterval(this.processorTimer);
      this.processorTimer = null;
      logger.info("[MessageQueue] Stopped background processor");
    }
  }

  /** Number of pending messages. */
  get size(): number {
    return this.pending.size;
  }

  /** Enqueue a message for retry. */
  enqueue(msg: Omit<QueuedMessage, "attempts" | "lastAttemptAt" | "createdAt"> & { attempts?: number; lastAttemptAt?: number; createdAt?: number }): void {
    const now = Date.now();
    const entry: QueuedMessage = {
      ...msg,
      attempts: msg.attempts ?? 1,
      lastAttemptAt: msg.lastAttemptAt ?? now,
      createdAt: msg.createdAt ?? now,
    };
    this.pending.set(msg.id, entry);
    logger.info(`[MessageQueue] Enqueued msg=${msg.id} chat=${msg.chatId} attempts=${entry.attempts}`);
  }

  /** Immediately retry all pending messages. */
  async processPending(): Promise<void> {
    if (this.pending.size === 0) return;

    const toRetry = [...this.pending.values()];
    const now = Date.now();

    for (const msg of toRetry) {
      const intervalIndex = Math.min(msg.attempts - 1, RETRY_INTERVALS_MS.length - 1);
      const waitMs = RETRY_INTERVALS_MS[intervalIndex];

      if (now - msg.lastAttemptAt < waitMs) {
        continue; // not time yet
      }

      const sent = await this.trySend(msg);
      if (sent) {
        this.pending.delete(msg.id);
        this.notified.delete(msg.id);
        logger.info(`[MessageQueue] Delivered msg=${msg.id} after ${msg.attempts} attempts`);
      } else {
        // Check if we need to notify admin
        await this.maybeNotifyAdmin(msg);
      }
    }
  }

  private async trySend(msg: QueuedMessage): Promise<boolean> {
    try {
      msg.attempts++;
      msg.lastAttemptAt = Date.now();

      await this.api.sendMessage(msg.chatId, msg.text, {
        ...msg.options,
        message_thread_id: msg.messageThreadId ?? msg.options?.message_thread_id,
      } as any);

      return true;
    } catch (err) {
      msg.lastError = String(err);
      logger.warn(`[MessageQueue] Retry failed msg=${msg.id} attempts=${msg.attempts}:`, err);
      return false;
    }
  }

  private async maybeNotifyAdmin(msg: QueuedMessage): Promise<void> {
    const now = Date.now();
    const age = now - msg.createdAt;

    if (age < ADMIN_NOTIFY_THRESHOLD_MS) return;
    if (this.notified.has(msg.id)) return; // already notified
    if (!this.adminNotifier || !this.adminChatId) return;

    this.notified.add(msg.id);

    const episode: FailedEpisode = {
      message: msg,
      failedSince: msg.createdAt + ADMIN_NOTIFY_THRESHOLD_MS,
      totalDuration: age,
    };

    try {
      await this.adminNotifier(episode);
      logger.warn(`[MessageQueue] Admin notified for msg=${msg.id}`);
    } catch (err) {
      logger.error("[MessageQueue] Failed to notify admin:", err);
    }
  }

  /** Create a default admin notifier that sends to a LOGS topic. */
  static createTelegramNotifier(
    api: Api,
    adminChatId: number,
    adminTopicId?: number,
  ): AdminNotifier {
    return async (episode: FailedEpisode) => {
      const { message: msg, failedSince, totalDuration } = episode;
      const hours = Math.floor(totalDuration / 3_600_000);
      const mins = Math.floor((totalDuration % 3_600_000) / 60_000);

      const report = [
        "🚨 **MESSAGE DELIVERY FAILURE**",
        "",
        `Session: \`${msg.sessionId ?? "N/A"}\``,
        `Message: "${msg.text.slice(0, 200)}${msg.text.length > 200 ? "..." : ""}"`,
        `Chat: \`${msg.chatId}\` / topic \`${msg.messageThreadId ?? "none"}\``,
        `Attempts: ${msg.attempts} / Last error: ${msg.lastError ?? "unknown"}`,
        `Created: ${new Date(msg.createdAt).toISOString()}`,
        `Failed since: ${new Date(failedSince).toISOString()} (${hours}h ${mins}m)`,
      ].join("\n");

      await api.sendMessage(adminChatId, report, {
        parse_mode: "MarkdownV2",
        message_thread_id: adminTopicId,
      }).catch(() => {
        // Fallback: try without markdown
        return api.sendMessage(adminChatId, report.replace(/\*/g, "").replace(/`/g, ""), {
          message_thread_id: adminTopicId,
        });
      });
    };
  }
}
