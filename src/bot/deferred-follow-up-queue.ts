import type { TelegramThreadTarget } from "./utils/message-thread.js";
import type { TelegramConversationScope } from "../telegram/scope.js";

export interface DeferredFollowUpItem {
  sessionId: string;
  promptText: string;
  target: TelegramThreadTarget;
  scope: TelegramConversationScope | null;
  sourceMessageId?: number;
}

export class DeferredFollowUpQueue {
  private readonly itemsBySessionId = new Map<string, DeferredFollowUpItem[]>();
  private readonly releaseTasksBySessionId = new Map<string, Promise<void>>();

  enqueue(item: DeferredFollowUpItem): void {
    const items = this.itemsBySessionId.get(item.sessionId) ?? [];
    items.push(item);
    this.itemsBySessionId.set(item.sessionId, items);
  }

  peekNext(sessionId: string): DeferredFollowUpItem | null {
    const items = this.itemsBySessionId.get(sessionId);
    if (!items || items.length === 0) {
      return null;
    }

    return items[0] ?? null;
  }

  shiftAfterSuccess(sessionId: string): void {
    const items = this.itemsBySessionId.get(sessionId);
    if (!items || items.length === 0) {
      return;
    }

    items.shift();
    if (items.length === 0) {
      this.itemsBySessionId.delete(sessionId);
    }
  }

  async runSerializedRelease(sessionId: string, operation: () => Promise<void>): Promise<void> {
    const previousTask = this.releaseTasksBySessionId.get(sessionId) ?? Promise.resolve();
    const nextTask = previousTask
      .catch(() => undefined)
      .then(async () => await operation())
      .finally(() => {
        if (this.releaseTasksBySessionId.get(sessionId) === nextTask) {
          this.releaseTasksBySessionId.delete(sessionId);
        }
      });

    this.releaseTasksBySessionId.set(sessionId, nextTask);
    await nextTask;
  }
}
