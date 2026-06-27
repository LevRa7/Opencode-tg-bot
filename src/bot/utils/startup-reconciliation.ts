import { logger } from "../../utils/logger.js";
import { foregroundSessionState } from "../../scheduled-task/foreground-state.js";
import { assistantRunState } from "../assistant-run-state.js";
import { MessageQueue } from "./message-queue.js";

/**
 * Performs startup cleanup to reconcile state after a bot restart.
 *
 * When the bot restarts during an active session:
 * 1. In-memory state (foreground, run state, session claims) is lost
 * 2. SSE subscriptions are lost — model responses won't be delivered
 *
 * This class handles cleanup of local state and message queue processing.
 * Keyboard cleanup is handled separately by pinnedMessageManager recreation.
 */
export class StartupReconciliation {
  constructor(private readonly messageQueue?: MessageQueue) {}

  /**
   * Run all reconciliation steps.  Safe to call multiple times (idempotent).
   */
  async reconcile(): Promise<void> {
    logger.info("[StartupReconciliation] Starting...");

    // Step 1: Clear all local state — everything is stale after restart
    this.clearLocalState();

    // Step 2: Process any queued messages that were pending before restart
    await this.processMessageQueue();

    logger.info("[StartupReconciliation] Complete");
  }

  /**
   * Step 1: Clear all in-memory state that was lost on restart.
   */
  private clearLocalState(): void {
    // In-memory Maps are already empty after restart, but clear for safety
    // and to ensure no stale references survive hot-reloads.
    foregroundSessionState.clearAll("startup_reconciliation");
    assistantRunState.clearAll("startup_reconciliation");

    logger.info("[StartupReconciliation] Local state cleared");
  }

  /**
   * Step 2: Process queued messages that were pending before restart.
   */
  private async processMessageQueue(): Promise<void> {
    if (this.messageQueue) {
      this.messageQueue.start();
      await this.messageQueue.processPending();
      logger.info("[StartupReconciliation] Message queue processing started");
    }
  }
}
