import type { CodeFileData } from "./formatter.js";
import { logger } from "../utils/logger.js";
import type { TelegramTextFormat } from "../bot/utils/telegram-text.js";

type SendTextCallback = (
  sessionId: string,
  text: string,
  format: TelegramTextFormat,
) => Promise<void>;
type SendFileCallback = (sessionId: string, fileData: CodeFileData) => Promise<void>;

interface ToolMessageBatcherOptions {
  intervalSeconds?: number;
  sendText: SendTextCallback;
  sendFile: SendFileCallback;
}

interface QueuedTextMessage {
  text: string;
  format: TelegramTextFormat;
  reason: string;
}

function normalizeIntervalSeconds(value: number | undefined): number {
  if (!Number.isFinite(value ?? Number.NaN)) {
    return 0;
  }

  const normalized = Math.floor(value ?? 0);
  if (normalized < 0) {
    return 0;
  }

  return normalized;
}

export class ToolMessageBatcher {
  private readonly intervalSeconds: number;
  private readonly sendText: SendTextCallback;
  private readonly sendFile: SendFileCallback;
  private readonly sessionTasks: Map<string, Promise<void>> = new Map();
  private readonly textQueues: Map<string, QueuedTextMessage[]> = new Map();
  private readonly timers: Map<string, ReturnType<typeof setTimeout>> = new Map();
  private readonly sessionGenerations: Map<string, number> = new Map();

  constructor(options: ToolMessageBatcherOptions) {
    this.intervalSeconds = normalizeIntervalSeconds(options.intervalSeconds);
    this.sendText = options.sendText;
    this.sendFile = options.sendFile;
  }

  enqueue(sessionId: string, message: string): void {
    this.sendTextNow(sessionId, message, "enqueue");
  }

  sendTextNow(
    sessionId: string,
    message: string,
    reason: string,
    format: TelegramTextFormat = "raw",
  ): void {
    const normalizedMessage = message.trim();
    if (!sessionId || normalizedMessage.length === 0) {
      return;
    }

    if (this.intervalSeconds === 0) {
      const expectedGeneration = this.getSessionGeneration(sessionId);
      logger.debug(`[ToolBatcher] Sending text message: session=${sessionId}, reason=${reason}`);
      void this.enqueueTask(sessionId, () =>
        this.sendTextSafe(sessionId, normalizedMessage, format, reason, expectedGeneration),
      );
      return;
    }

    logger.debug(
      `[ToolBatcher] Queued text message: session=${sessionId}, reason=${reason}, interval=${this.intervalSeconds}s`,
    );
    this.enqueueQueuedText(sessionId, normalizedMessage, format, reason);
  }

  enqueueUniqueByPrefix(sessionId: string, message: string, prefix: string): void {
    void prefix;
    this.sendTextNow(sessionId, message, "enqueue_unique_by_prefix");
  }

  enqueueFile(sessionId: string, fileData: CodeFileData): void {
    if (!sessionId) {
      return;
    }

    const expectedGeneration = this.getSessionGeneration(sessionId);
    logger.debug(`[ToolBatcher] Sending file message: session=${sessionId}`);

    if (this.hasPendingText(sessionId)) {
      void this.flushSession(sessionId, "file_boundary").then(() =>
        this.enqueueTask(sessionId, () => this.sendFileSafe(sessionId, fileData, "enqueue_file", expectedGeneration)),
      );
      return;
    }

    void this.enqueueTask(sessionId, () =>
      this.sendFileSafe(sessionId, fileData, "enqueue_file", expectedGeneration),
    );
  }

  async flushSession(sessionId: string, reason: string): Promise<void> {
    this.clearTimer(sessionId);

    const queuedMessages = this.textQueues.get(sessionId);
    if (!queuedMessages || queuedMessages.length === 0) {
      await (this.sessionTasks.get(sessionId) ?? Promise.resolve());
      return;
    }

    this.textQueues.delete(sessionId);
    const expectedGeneration = this.getSessionGeneration(sessionId);

    await this.enqueueTask(sessionId, async () => {
      logger.debug(
        `[ToolBatcher] Flushing ${queuedMessages.length} tool messages: session=${sessionId}, reason=${reason}`,
      );

      for (const queuedMessage of queuedMessages) {
        await this.sendTextSafe(
          sessionId,
          queuedMessage.text,
          queuedMessage.format,
          `${reason}:${queuedMessage.reason}`,
          expectedGeneration,
        );
      }
    });
  }

  async flushAll(reason: string): Promise<void> {
    this.clearAllTimers();

    for (const sessionId of Array.from(this.textQueues.keys())) {
      await this.flushSession(sessionId, reason);
    }

    for (const task of this.sessionTasks.values()) {
      await task;
    }
  }

  clearSession(sessionId: string, reason: string): void {
    this.sessionGenerations.set(sessionId, this.getSessionGeneration(sessionId) + 1);
    this.clearTimer(sessionId);
    if (this.textQueues.delete(sessionId)) {
      logger.debug(`[ToolBatcher] Cleared session sends: session=${sessionId}, reason=${reason}`);
    }
  }

  clearAll(reason: string): void {
    for (const sessionId of new Set([
      ...this.sessionGenerations.keys(),
      ...this.sessionTasks.keys(),
      ...this.textQueues.keys(),
      ...this.timers.keys(),
    ])) {
      this.sessionGenerations.set(sessionId, this.getSessionGeneration(sessionId) + 1);
    }

    this.clearAllTimers();
    const queuedSessions = this.textQueues.size;
    this.textQueues.clear();

    if (queuedSessions > 0) {
      logger.debug(`[ToolBatcher] Cleared all pending tool sends: reason=${reason}`);
    }
  }

  private hasPendingText(sessionId: string): boolean {
    const queuedMessages = this.textQueues.get(sessionId);
    return (queuedMessages?.length ?? 0) > 0 || this.timers.has(sessionId);
  }

  private enqueueQueuedText(
    sessionId: string,
    message: string,
    format: TelegramTextFormat,
    reason: string,
  ): void {
    const queue = this.textQueues.get(sessionId) ?? [];
    queue.push({ text: message, format, reason });
    this.textQueues.set(sessionId, queue);
    this.ensureTimer(sessionId);
  }

  private clearTimer(sessionId: string): void {
    const timer = this.timers.get(sessionId);
    if (!timer) {
      return;
    }

    clearTimeout(timer);
    this.timers.delete(sessionId);
  }

  private clearAllTimers(): void {
    for (const timer of this.timers.values()) {
      clearTimeout(timer);
    }

    this.timers.clear();
  }

  private ensureTimer(sessionId: string): void {
    if (this.timers.has(sessionId)) {
      return;
    }

    if (this.intervalSeconds === 0) {
      void this.flushSession(sessionId, "immediate").catch((error) => {
        logger.error(`[ToolBatcher] Immediate flush failed: session=${sessionId}`, error);
      });
      return;
    }

    const timer = setTimeout(() => {
      this.timers.delete(sessionId);
      void this.flushSession(sessionId, "interval_elapsed").catch((error) => {
        logger.error(`[ToolBatcher] Timed flush failed: session=${sessionId}`, error);
      });
    }, this.intervalSeconds * 1000);

    this.timers.set(sessionId, timer);
  }

  private getSessionGeneration(sessionId: string): number {
    return this.sessionGenerations.get(sessionId) ?? 0;
  }

  private enqueueTask(sessionId: string, task: () => Promise<void>): Promise<void> {
    const previousTask = this.sessionTasks.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(task)
      .finally(() => {
        if (this.sessionTasks.get(sessionId) === nextTask) {
          this.sessionTasks.delete(sessionId);
        }
      });

    this.sessionTasks.set(sessionId, nextTask);
    return nextTask;
  }

  private async sendTextSafe(
    sessionId: string,
    text: string,
    format: TelegramTextFormat,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.getSessionGeneration(sessionId) !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool text message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendText(sessionId, text, format);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool text message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }

  private async sendFileSafe(
    sessionId: string,
    fileData: CodeFileData,
    reason: string,
    expectedGeneration: number,
  ): Promise<void> {
    if (this.getSessionGeneration(sessionId) !== expectedGeneration) {
      logger.debug(
        `[ToolBatcher] Dropping stale tool file message: session=${sessionId}, reason=${reason}`,
      );
      return;
    }

    try {
      await this.sendFile(sessionId, fileData);
    } catch (err) {
      logger.error(
        `[ToolBatcher] Failed to send tool file message: session=${sessionId}, reason=${reason}`,
        err,
      );
    }
  }
}
