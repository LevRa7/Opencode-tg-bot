interface SessionDeliveryOrchestratorOptions {
  onError?: (error: unknown, item: SessionDeliveryItem) => void | Promise<void>;
}

interface SessionDeliverySettlement {
  resolve: () => void;
  reject: (error: unknown) => void;
}

interface SessionDeliveryItemBase {
  sessionId: string;
  deliver: () => Promise<void>;
}

export interface SessionLiveDeliveryItem extends SessionDeliveryItemBase {
  channel: "live";
  logicalMessageId: string;
  isTerminal?: boolean;
}

export interface SessionDurableDeliveryItem extends SessionDeliveryItemBase {
  channel: "durable";
  eventTimeMs?: number;
  logicalMessageId?: string;
  waitForLogicalMessageLiveTerminal?: string;
  waitForLogicalMessageDurable?: string;
}

export type SessionDeliveryItem = SessionLiveDeliveryItem | SessionDurableDeliveryItem;

interface QueuedDurableItem {
  arrivalSeq: number;
  item: SessionDurableDeliveryItem;
  settlement: SessionDeliverySettlement;
}

function createSettlement(): {
  promise: Promise<void>;
  settlement: SessionDeliverySettlement;
} {
  let resolvePromise!: () => void;
  let rejectPromise!: (error: unknown) => void;

  return {
    promise: new Promise<void>((resolve, reject) => {
      resolvePromise = resolve;
      rejectPromise = reject;
    }),
    settlement: {
      resolve: () => resolvePromise(),
      reject: (error: unknown) => rejectPromise(error),
    },
  };
}

interface LiveTerminalWaiter {
  promise: Promise<void>;
  resolve: () => void;
  settled: boolean;
}

function createLiveTerminalWaiter(): LiveTerminalWaiter {
  let resolvePromise!: () => void;
  const waiter: LiveTerminalWaiter = {
    promise: new Promise<void>((resolve) => {
      resolvePromise = resolve;
    }),
    resolve: () => {
      if (waiter.settled) {
        return;
      }

      waiter.settled = true;
      resolvePromise();
    },
    settled: false,
  };

  return waiter;
}

function compareDurableItems(left: QueuedDurableItem, right: QueuedDurableItem): number {
  const leftTime = left.item.eventTimeMs;
  const rightTime = right.item.eventTimeMs;

  if (typeof leftTime === "number" && typeof rightTime === "number" && leftTime !== rightTime) {
    return leftTime - rightTime;
  }

  return left.arrivalSeq - right.arrivalSeq;
}

export class SessionDeliveryOrchestrator {
  private readonly onError?: SessionDeliveryOrchestratorOptions["onError"];
  private nextArrivalSeq = 0;
  private readonly durableItemsBySession = new Map<string, QueuedDurableItem[]>();
  private readonly durableWaitersBySession = new Map<string, Map<string, LiveTerminalWaiter>>();
  private readonly completedDurableIdsBySession = new Map<string, Set<string>>();
  private readonly liveTerminalWaitersBySession = new Map<string, Map<string, LiveTerminalWaiter>>();
  private readonly completedLiveTerminalIdsBySession = new Map<string, Set<string>>();
  private readonly activityWaitersBySession = new Map<string, Set<LiveTerminalWaiter>>();
  private readonly sessionGenerationBySession = new Map<string, number>();
  private readonly flushTasksBySession = new Map<string, Promise<void>>();

  constructor(options: SessionDeliveryOrchestratorOptions = {}) {
    this.onError = options.onError;
  }

  enqueue(item: SessionDeliveryItem): Promise<void> {
    const { promise, settlement } = createSettlement();

    if (item.channel === "live") {
      if (item.isTerminal) {
        this.clearCompletedLiveTerminal(item.sessionId, item.logicalMessageId);
      }

      this.signalSessionActivity(item.sessionId);
      void this.dispatchLiveItem(item, settlement);
      return promise;
    }

    if (item.logicalMessageId) {
      this.clearCompletedDurable(item.sessionId, item.logicalMessageId);
    }

    const queuedItems = this.durableItemsBySession.get(item.sessionId) ?? [];
    queuedItems.push({
      arrivalSeq: this.nextArrivalSeq++,
      item,
      settlement,
    });
    this.durableItemsBySession.set(item.sessionId, queuedItems);
    this.signalSessionActivity(item.sessionId);
    return promise;
  }

  async flushSession(sessionId: string): Promise<void> {
    const previousTask = this.flushTasksBySession.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(async () => await this.flushSessionInternal(sessionId))
      .finally(() => {
        if (this.flushTasksBySession.get(sessionId) === nextTask) {
          this.flushTasksBySession.delete(sessionId);
        }
      });

    this.flushTasksBySession.set(sessionId, nextTask);
    await nextTask;
  }

  clearSession(sessionId: string): void {
    this.sessionGenerationBySession.set(sessionId, this.getSessionGeneration(sessionId) + 1);
    const queuedItems = this.durableItemsBySession.get(sessionId) ?? [];
    queuedItems.forEach(({ settlement }) => settlement.resolve());
    this.durableItemsBySession.delete(sessionId);

    const waiters = this.liveTerminalWaitersBySession.get(sessionId);
    waiters?.forEach((waiter) => waiter.resolve());
    this.liveTerminalWaitersBySession.delete(sessionId);

    const durableWaiters = this.durableWaitersBySession.get(sessionId);
    durableWaiters?.forEach((waiter) => waiter.resolve());
    this.durableWaitersBySession.delete(sessionId);

    const activityWaiters = this.activityWaitersBySession.get(sessionId);
    activityWaiters?.forEach((waiter) => waiter.resolve());
    this.activityWaitersBySession.delete(sessionId);

    this.completedLiveTerminalIdsBySession.delete(sessionId);
    this.completedDurableIdsBySession.delete(sessionId);
  }

  clearAll(): void {
    for (const sessionId of new Set([
      ...this.durableItemsBySession.keys(),
      ...this.durableWaitersBySession.keys(),
      ...this.completedDurableIdsBySession.keys(),
      ...this.liveTerminalWaitersBySession.keys(),
      ...this.completedLiveTerminalIdsBySession.keys(),
      ...this.sessionGenerationBySession.keys(),
    ])) {
      this.clearSession(sessionId);
    }
    this.flushTasksBySession.clear();
  }

  private async flushSessionInternal(sessionId: string): Promise<void> {
    const sessionGeneration = this.getSessionGeneration(sessionId);

    while (true) {
      const queuedItems = this.durableItemsBySession.get(sessionId);
      if (!queuedItems || queuedItems.length === 0) {
        this.durableItemsBySession.delete(sessionId);
        return;
      }

      queuedItems.sort(compareDurableItems);
      const nextItemIndex = this.findNextDispatchableDurableIndex(sessionId, queuedItems);
      if (nextItemIndex < 0) {
        await this.waitForSessionActivity(sessionId);
        if (this.getSessionGeneration(sessionId) !== sessionGeneration) {
          return;
        }
        continue;
      }

      const nextItem = queuedItems.splice(nextItemIndex, 1)[0];
      if (!nextItem) {
        return;
      }

      if (queuedItems.length === 0) {
        this.durableItemsBySession.delete(sessionId);
      }

      if (this.getSessionGeneration(sessionId) !== sessionGeneration) {
        return;
      }

      try {
        await nextItem.item.deliver();
        this.markDurableComplete(nextItem.item.sessionId, nextItem.item.logicalMessageId, sessionGeneration);
        nextItem.settlement.resolve();
      } catch (error) {
        await this.handleError(error, nextItem.item);
        nextItem.settlement.reject(error);
      }
    }
  }

  private async dispatchLiveItem(
    item: SessionLiveDeliveryItem,
    settlement: SessionDeliverySettlement,
  ): Promise<void> {
    const sessionGeneration = this.getSessionGeneration(item.sessionId);

    try {
      await item.deliver();
      settlement.resolve();
    } catch (error) {
      await this.handleError(error, item);
      settlement.reject(error);
    } finally {
      if (item.isTerminal) {
        this.markLiveTerminalComplete(item.sessionId, item.logicalMessageId, sessionGeneration);
      }
    }
  }

  private async waitForSessionActivity(sessionId: string): Promise<void> {
    const waiter = createLiveTerminalWaiter();
    const waiters = this.activityWaitersBySession.get(sessionId) ?? new Set<LiveTerminalWaiter>();
    waiters.add(waiter);
    this.activityWaitersBySession.set(sessionId, waiters);
    await waiter.promise;
  }

  private markLiveTerminalComplete(sessionId: string, logicalMessageId: string, sessionGeneration: number): void {
    if (this.getSessionGeneration(sessionId) !== sessionGeneration) {
      return;
    }

    const completedIds = this.completedLiveTerminalIdsBySession.get(sessionId) ?? new Set<string>();
    completedIds.add(logicalMessageId);
    this.completedLiveTerminalIdsBySession.set(sessionId, completedIds);

    const waiters = this.liveTerminalWaitersBySession.get(sessionId);
    const waiter = waiters?.get(logicalMessageId);
    waiter?.resolve();
    this.signalSessionActivity(sessionId);

    if (!waiters) {
      return;
    }

    waiters.delete(logicalMessageId);
    if (waiters.size === 0) {
      this.liveTerminalWaitersBySession.delete(sessionId);
    }
  }

  private getOrCreateLiveTerminalWaiter(sessionId: string, logicalMessageId: string): LiveTerminalWaiter {
    const waiters = this.liveTerminalWaitersBySession.get(sessionId) ?? new Map<string, LiveTerminalWaiter>();
    const existingWaiter = waiters.get(logicalMessageId);
    if (existingWaiter) {
      return existingWaiter;
    }

    const waiter = createLiveTerminalWaiter();
    waiters.set(logicalMessageId, waiter);
    this.liveTerminalWaitersBySession.set(sessionId, waiters);
    return waiter;
  }

  private getOrCreateDurableWaiter(sessionId: string, logicalMessageId: string): LiveTerminalWaiter {
    const waiters = this.durableWaitersBySession.get(sessionId) ?? new Map<string, LiveTerminalWaiter>();
    const existingWaiter = waiters.get(logicalMessageId);
    if (existingWaiter) {
      return existingWaiter;
    }

    const waiter = createLiveTerminalWaiter();
    waiters.set(logicalMessageId, waiter);
    this.durableWaitersBySession.set(sessionId, waiters);
    return waiter;
  }

  private clearCompletedLiveTerminal(sessionId: string, logicalMessageId: string): void {
    const completedIds = this.completedLiveTerminalIdsBySession.get(sessionId);
    if (!completedIds) {
      return;
    }

    completedIds.delete(logicalMessageId);
    if (completedIds.size === 0) {
      this.completedLiveTerminalIdsBySession.delete(sessionId);
    }
  }

  private clearCompletedDurable(sessionId: string, logicalMessageId: string): void {
    const completedIds = this.completedDurableIdsBySession.get(sessionId);
    if (!completedIds) {
      return;
    }

    completedIds.delete(logicalMessageId);
    if (completedIds.size === 0) {
      this.completedDurableIdsBySession.delete(sessionId);
    }
  }

  private markDurableComplete(
    sessionId: string,
    logicalMessageId: string | undefined,
    sessionGeneration: number,
  ): void {
    if (!logicalMessageId || this.getSessionGeneration(sessionId) !== sessionGeneration) {
      return;
    }

    const completedIds = this.completedDurableIdsBySession.get(sessionId) ?? new Set<string>();
    completedIds.add(logicalMessageId);
    this.completedDurableIdsBySession.set(sessionId, completedIds);

    const waiters = this.durableWaitersBySession.get(sessionId);
    const waiter = waiters?.get(logicalMessageId);
    waiter?.resolve();
    this.signalSessionActivity(sessionId);

    if (!waiters) {
      return;
    }

    waiters.delete(logicalMessageId);
    if (waiters.size === 0) {
      this.durableWaitersBySession.delete(sessionId);
    }
  }

  private findNextDispatchableDurableIndex(
    sessionId: string,
    queuedItems: QueuedDurableItem[],
  ): number {
    for (let index = 0; index < queuedItems.length; index += 1) {
      const candidate = queuedItems[index];
      if (!this.isDurableReadyToDispatch(sessionId, candidate.item, queuedItems)) {
        continue;
      }

      return index;
    }

    return -1;
  }

  private isDurableReadyToDispatch(
    sessionId: string,
    item: SessionDurableDeliveryItem,
    _queuedItems: QueuedDurableItem[],
  ): boolean {
    if (!this.isLiveTerminalCompleted(sessionId, item.waitForLogicalMessageLiveTerminal)) {
      return false;
    }

    const dependencyId = item.waitForLogicalMessageDurable;
    if (!dependencyId) {
      return true;
    }

    const completedIds = this.completedDurableIdsBySession.get(sessionId);
    return completedIds?.has(dependencyId) ?? false;
  }

  private isLiveTerminalCompleted(sessionId: string, logicalMessageId?: string): boolean {
    if (!logicalMessageId) {
      return true;
    }

    return this.completedLiveTerminalIdsBySession.get(sessionId)?.has(logicalMessageId) ?? false;
  }

  private signalSessionActivity(sessionId: string): void {
    const waiters = this.activityWaitersBySession.get(sessionId);
    if (!waiters || waiters.size === 0) {
      return;
    }

    this.activityWaitersBySession.delete(sessionId);
    waiters.forEach((waiter) => waiter.resolve());
  }

  private async handleError(error: unknown, item: SessionDeliveryItem): Promise<void> {
    await this.onError?.(error, item);
  }

  private getSessionGeneration(sessionId: string): number {
    return this.sessionGenerationBySession.get(sessionId) ?? 0;
  }
}
