import { logger } from "../utils/logger.js";

interface BusyWarningSuppressionFlags {
  suppressBusyWarning: boolean;
  reason: string;
}

interface SendDirectPromptInput<TDirectPrompt> {
  scopeKey: string;
  directPrompt: TDirectPrompt;
  busyWarningSuppressionFlags?: BusyWarningSuppressionFlags;
}

interface ResolveDeferredItemsInput<TDeferredItem> {
  scopeKey: string;
  deferredItems: TDeferredItem[];
}

interface SendDeferredFollowUpInput<TResolvedDeferredItems> {
  scopeKey: string;
  resolvedDeferredItems: TResolvedDeferredItems;
  busyWarningSuppressionFlags?: BusyWarningSuppressionFlags;
  silent: true;
}

interface IncomingMediaBatchOptions<TDirectPrompt, TDeferredItem, TResolvedDeferredItems> {
  correlationWindowMs?: number;
  maxWindowMs?: number;
  canFlushNow?: (scopeKey: string) => boolean | Promise<boolean>;
  sendDirectPrompt?: (input: SendDirectPromptInput<TDirectPrompt>) => Promise<void>;
  resolveDeferredItems: (
    input: ResolveDeferredItemsInput<TDeferredItem>,
  ) => Promise<TResolvedDeferredItems>;
  sendDeferredFollowUp: (input: SendDeferredFollowUpInput<TResolvedDeferredItems>) => Promise<void>;
}

interface BatchWindow<TDeferredItem> {
  id: number;
  scopeKey: string;
  busyWarningSuppressionFlags?: BusyWarningSuppressionFlags;
  deferredItems: TDeferredItem[];
  expiresAt: number;
  maxExpiresAt: number;
  hasExpired: boolean;
  isDirectPromptSettled: boolean;
  activeProcessingHolds: number;
  phase: "collecting" | "retrying";
  timer: ReturnType<typeof setTimeout>;
}

const DEFAULT_CORRELATION_WINDOW_MS = 1000;
const DEFAULT_MAX_WINDOW_MS = 3000;

export class IncomingMediaBatch<
  TDirectPrompt = string,
  TDeferredItem = string,
  TResolvedDeferredItems = string,
> {
  private readonly correlationWindowMs: number;
  private readonly maxWindowMs: number;
  private readonly canFlushNowOperation: IncomingMediaBatchOptions<
    TDirectPrompt,
    TDeferredItem,
    TResolvedDeferredItems
  >["canFlushNow"];
  private readonly sendDirectPromptOperation: IncomingMediaBatchOptions<
    TDirectPrompt,
    TDeferredItem,
    TResolvedDeferredItems
  >["sendDirectPrompt"];
  private readonly resolveDeferredItemsOperation: IncomingMediaBatchOptions<
    TDirectPrompt,
    TDeferredItem,
    TResolvedDeferredItems
  >["resolveDeferredItems"];
  private readonly sendDeferredFollowUpOperation: IncomingMediaBatchOptions<
    TDirectPrompt,
    TDeferredItem,
    TResolvedDeferredItems
  >["sendDeferredFollowUp"];
  private readonly windowsByScope = new Map<string, BatchWindow<TDeferredItem>[]>();
  private nextBatchId = 0;

  constructor(
    options: IncomingMediaBatchOptions<TDirectPrompt, TDeferredItem, TResolvedDeferredItems>,
  ) {
    this.correlationWindowMs = Math.max(
      0,
      Math.floor(options.correlationWindowMs ?? DEFAULT_CORRELATION_WINDOW_MS),
    );
    this.maxWindowMs = Math.max(
      this.correlationWindowMs,
      Math.floor(options.maxWindowMs ?? DEFAULT_MAX_WINDOW_MS),
    );
    this.canFlushNowOperation = options.canFlushNow;
    this.sendDirectPromptOperation = options.sendDirectPrompt;
    this.resolveDeferredItemsOperation = options.resolveDeferredItems;
    this.sendDeferredFollowUpOperation = options.sendDeferredFollowUp;
  }

  async sendDirectPrompt(input: SendDirectPromptInput<TDirectPrompt>): Promise<void> {
    if (!this.sendDirectPromptOperation) {
      throw new Error("sendDirectPrompt is not configured on this batch instance");
    }

    const openWindow = this.findOpenWindow(input.scopeKey);
    if (openWindow) {
      openWindow.deferredItems.push(input.directPrompt as unknown as TDeferredItem);
      if (!openWindow.busyWarningSuppressionFlags && input.busyWarningSuppressionFlags) {
        openWindow.busyWarningSuppressionFlags = input.busyWarningSuppressionFlags;
      }
      this.extendWindowTimer(openWindow);
      return;
    }

    const window = this.createWindow({
      scopeKey: input.scopeKey,
      busyWarningSuppressionFlags: input.busyWarningSuppressionFlags,
      deferredItems: [],
      isDirectPromptSettled: false,
      phase: "collecting",
    });
    this.addWindow(window);

    try {
      await this.sendDirectPromptOperation({
        scopeKey: input.scopeKey,
        directPrompt: input.directPrompt,
        busyWarningSuppressionFlags: input.busyWarningSuppressionFlags,
      });

      window.isDirectPromptSettled = true;
      if (window.hasExpired) {
        await this.flushWindow(window.id);
      }
    } catch (error) {
      window.isDirectPromptSettled = true;
      clearTimeout(window.timer);

      if (!this.hasWindow(window.id)) {
        throw error;
      }

      this.removeWindow(window.id);

      if (window.deferredItems.length > 0) {
        try {
          await this.deliverBufferedWindowOnce(window, false);
        } catch (deliveryError) {
          this.restoreWindow(window, [...window.deferredItems]);
          logger.error(
            `[IncomingMediaBatch] Buffered delivery failed after direct prompt error for scope=${input.scopeKey}`,
            deliveryError,
          );
        }
      }

      throw error;
    }
  }

  async deferItem(input: {
    scopeKey: string;
    deferredItem: TDeferredItem;
    busyWarningSuppressionFlags?: BusyWarningSuppressionFlags;
    initialExpiresMs?: number;
  }): Promise<void> {
    const openWindow = this.findOpenWindow(input.scopeKey);
    if (openWindow) {
      openWindow.deferredItems.push(input.deferredItem);
      if (!openWindow.busyWarningSuppressionFlags && input.busyWarningSuppressionFlags) {
        openWindow.busyWarningSuppressionFlags = input.busyWarningSuppressionFlags;
      }
      this.extendWindowTimer(openWindow);
      return;
    }

    const window = this.createWindow({
      scopeKey: input.scopeKey,
      busyWarningSuppressionFlags: input.busyWarningSuppressionFlags,
      deferredItems: [input.deferredItem],
      isDirectPromptSettled: true,
      phase: "collecting",
      initialExpiresMs: input.initialExpiresMs ?? this.maxWindowMs,
    });
    this.addWindow(window);
  }

  async flushExpiredWindowsForScope(scopeKey: string): Promise<void> {
    const windows = this.windowsByScope.get(scopeKey) ?? [];
    const expiredWindows = [...windows];
    for (const window of expiredWindows) {
      if (window.hasExpired && window.isDirectPromptSettled) {
        await this.flushWindow(window.id);
      }
    }
  }

  enqueueDeferredItem(input: {
    scopeKey: string;
    deferredItem: TDeferredItem;
    extendMs?: number;
  }): boolean {
    const window = this.findEnqueueableWindow(input.scopeKey);
    if (!window) {
      return false;
    }

    window.deferredItems.push(input.deferredItem);
    if (!window.hasExpired) {
      this.extendWindowTimer(window, input.extendMs);
    }
    return true;
  }

  /**
   * Acquires a processing hold for the currently open window.
   * Holds do NOT extend user-visible waiting time by themselves.
   * They only prevent flush while media is still processing.
   * When the returned release function is called, a timed-out window flushes immediately.
   */
  acquireProcessingHold(scopeKey: string): (() => void) | null {
    const window = this.findOpenWindow(scopeKey);
    if (!window) {
      return null;
    }

    window.activeProcessingHolds += 1;

    let released = false;
    return () => {
      if (released) {
        return;
      }
      released = true;

      const currentWindow = this.getWindow(window.id);
      if (!currentWindow) {
        return;
      }

      currentWindow.activeProcessingHolds = Math.max(0, currentWindow.activeProcessingHolds - 1);

      if (currentWindow.activeProcessingHolds === 0 && currentWindow.hasExpired) {
        void this.flushWindow(currentWindow.id).catch((error: unknown) => {
          logger.error(
            `[IncomingMediaBatch] Delayed flush after hold release failed for batch=${currentWindow.id}`,
            error,
          );
        });
      }
    };
  }

  private extendWindowTimer(window: BatchWindow<TDeferredItem>, customMs?: number): void {
    if (window.hasExpired) return;

    const now = Date.now();
    const extendMs = customMs ?? this.correlationWindowMs;
    const newExpiresAt = now + extendMs;

    if (newExpiresAt > window.expiresAt) {
      window.expiresAt = newExpiresAt;
      clearTimeout(window.timer);
      const remainingMs = newExpiresAt - now;
      window.timer = setTimeout(() => {
        void this.handleWindowExpiry(window.id).catch((error: unknown) => {
          logger.error(`[IncomingMediaBatch] Timer flush failed for batch=${window.id}`, error);
        });
      }, remainingMs);
    }
  }

  private createWindow(input: {
    scopeKey: string;
    deferredItems: TDeferredItem[];
    busyWarningSuppressionFlags?: BusyWarningSuppressionFlags;
    isDirectPromptSettled: boolean;
    phase: "collecting" | "retrying";
    initialExpiresMs?: number;
  }): BatchWindow<TDeferredItem> {
    const now = Date.now();
    const initialMs = input.initialExpiresMs ?? this.correlationWindowMs;
    const expiresAt = now + initialMs;
    const maxExpiresAt = Math.max(expiresAt, now + this.maxWindowMs);
    const id = ++this.nextBatchId;
    const timer = setTimeout(() => {
      void this.handleWindowExpiry(id).catch((error: unknown) => {
        logger.error(`[IncomingMediaBatch] Timer flush failed for batch=${id}`, error);
      });
    }, initialMs);

    return {
      id,
      scopeKey: input.scopeKey,
      busyWarningSuppressionFlags: input.busyWarningSuppressionFlags,
      deferredItems: [...input.deferredItems],
      expiresAt,
      maxExpiresAt,
      hasExpired: false,
      isDirectPromptSettled: input.isDirectPromptSettled,
      activeProcessingHolds: 0,
      phase: input.phase,
      timer,
    };
  }

  private async handleWindowExpiry(batchId: number): Promise<void> {
    const window = this.getWindow(batchId);
    if (!window) {
      return;
    }

    window.hasExpired = true;
    clearTimeout(window.timer);

    if (window.isDirectPromptSettled && window.activeProcessingHolds === 0) {
      const canFlush = this.canFlushNowOperation
        ? await this.canFlushNowOperation(window.scopeKey)
        : true;
      if (canFlush) {
        await this.flushWindow(batchId);
      } else {
        // Session is busy — retry instead of abandoning the window.
        // promptAsync queues on the server, so the window will eventually flush.
        this.scheduleRetry(window);
      }
    }
  }

  /**
   * Retry flushing an expired window after a delay, up to a bounded number of attempts.
   * While retrying, the window remains discoverable by findEnqueueableWindow so
   * follow-up messages can still be batched into it.
   */
  private scheduleRetry(window: BatchWindow<TDeferredItem>, attempt = 1): void {
    const MAX_RETRIES = 60;
    if (attempt > MAX_RETRIES) {
      logger.warn(
        `[IncomingMediaBatch] Abandoning batch=${window.id} after ${MAX_RETRIES} retries for scope=${window.scopeKey}`,
      );
      this.removeWindow(window.id);
      return;
    }

    window.phase = "retrying";
    const delayMs = Math.min(2000, 500 * attempt);
    window.timer = setTimeout(() => {
      void this.handleRetry(window.id, attempt).catch((error: unknown) => {
        logger.error(`[IncomingMediaBatch] Retry failed for batch=${window.id}`, error);
      });
    }, delayMs);
  }

  private async handleRetry(batchId: number, attempt: number): Promise<void> {
    const window = this.getWindow(batchId);
    if (!window) return;

    clearTimeout(window.timer);

    if (window.activeProcessingHolds > 0) {
      // Media still processing — wait for hold release
      return;
    }

    const canFlush = this.canFlushNowOperation
      ? await this.canFlushNowOperation(window.scopeKey)
      : true;
    if (canFlush) {
      await this.flushWindow(batchId);
    } else {
      this.scheduleRetry(window, attempt + 1);
    }
  }

  private async flushWindow(batchId: number): Promise<void> {
    const window = this.getWindow(batchId);
    if (
      !window ||
      !window.hasExpired ||
      !window.isDirectPromptSettled ||
      window.activeProcessingHolds > 0
    ) {
      return;
    }

    clearTimeout(window.timer);
    this.removeWindow(batchId);

    if (window.deferredItems.length === 0) {
      return;
    }

    await this.deliverBufferedWindowOnce(window, true);
  }

  private async deliverBufferedWindowOnce(
    window: BatchWindow<TDeferredItem>,
    restoreOnFailure: boolean,
  ): Promise<void> {
    const deferredItems = [...window.deferredItems];

    try {
      const resolvedDeferredItems = await this.resolveDeferredItemsOperation({
        scopeKey: window.scopeKey,
        deferredItems,
      });

      await this.sendDeferredFollowUpOperation({
        scopeKey: window.scopeKey,
        resolvedDeferredItems,
        busyWarningSuppressionFlags: window.busyWarningSuppressionFlags,
        silent: true,
      });
    } catch (error) {
      if (restoreOnFailure) {
        this.restoreWindow(window, deferredItems);
      }
      throw error;
    }
  }

  private restoreWindow(window: BatchWindow<TDeferredItem>, deferredItems: TDeferredItem[]): void {
    const restoredWindow = this.createWindow({
      scopeKey: window.scopeKey,
      busyWarningSuppressionFlags: window.busyWarningSuppressionFlags,
      deferredItems,
      isDirectPromptSettled: true,
      phase: "retrying",
    });
    this.addWindow(restoredWindow);
  }

  private findOpenWindow(scopeKey: string): BatchWindow<TDeferredItem> | undefined {
    const windows = this.windowsByScope.get(scopeKey) ?? [];
    return windows.find(
      (window) =>
        window.phase === "collecting" && !window.hasExpired && Date.now() < window.expiresAt,
    );
  }

  private findEnqueueableWindow(scopeKey: string): BatchWindow<TDeferredItem> | undefined {
    const windows = this.windowsByScope.get(scopeKey) ?? [];
    return windows.find(
      (window) =>
        window.phase === "collecting" &&
        ((!window.hasExpired && Date.now() < window.expiresAt) ||
          (window.hasExpired && window.activeProcessingHolds > 0)),
    );
  }

  private addWindow(window: BatchWindow<TDeferredItem>): void {
    const windows = this.windowsByScope.get(window.scopeKey) ?? [];
    windows.push(window);
    this.windowsByScope.set(window.scopeKey, windows);
  }

  private getWindow(batchId: number): BatchWindow<TDeferredItem> | undefined {
    for (const windows of this.windowsByScope.values()) {
      const window = windows.find((candidate) => candidate.id === batchId);
      if (window) {
        return window;
      }
    }
    return undefined;
  }

  private hasWindow(batchId: number): boolean {
    return this.getWindow(batchId) !== undefined;
  }

  private removeWindow(batchId: number): void {
    for (const [scopeKey, windows] of this.windowsByScope.entries()) {
      const nextWindows = windows.filter((window) => window.id !== batchId);
      if (nextWindows.length === windows.length) {
        continue;
      }

      if (nextWindows.length === 0) {
        this.windowsByScope.delete(scopeKey);
      } else {
        this.windowsByScope.set(scopeKey, nextWindows);
      }
      return;
    }
  }

  /** Clear all timers and windows. Call during shutdown to prevent
   *  deferred batch processing from accessing a closed database. */
  dispose(): void {
    for (const windows of this.windowsByScope.values()) {
      for (const window of windows) {
        clearTimeout(window.timer);
      }
    }
    this.windowsByScope.clear();
  }
}

export type {
  BusyWarningSuppressionFlags,
  IncomingMediaBatchOptions,
  ResolveDeferredItemsInput,
  SendDeferredFollowUpInput,
  SendDirectPromptInput,
};
