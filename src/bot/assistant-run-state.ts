import type { AssistantCompletionMetadata } from "../assistant-completion-metadata.js";
import { logger } from "../utils/logger.js";

export interface AssistantRunStartInfo {
  startedAt: number;
  configuredAgent?: string;
  configuredProviderID?: string;
  configuredModelID?: string;
}

export type AssistantRunResolvedInfo = AssistantCompletionMetadata;

export interface AssistantRunInfo extends AssistantRunStartInfo {
  sessionId: string;
  actualAgent?: string;
  actualProviderID?: string;
  actualModelID?: string;
  hasCompletedResponse: boolean;
  completionRecorded: boolean;
  hasPublishedFinalResponse: boolean;
  completedLogicalMessageId?: string;
  publishedFinalLogicalMessageId?: string;
  completedAt?: number;
  // 2026-07-02: timestamp of last markFinalResponsePublished call.
  // Used by BusyReconciliation to skip clearing runs that were recently
  // finalized — the model may produce more messages in the same turn.
  finalizedAt?: number;
}

class AssistantRunState {
  private readonly runs = new Map<string, AssistantRunInfo>();

  startRun(sessionId: string, info: AssistantRunStartInfo): void {
    if (!sessionId) {
      return;
    }

    this.runs.set(sessionId, {
      sessionId,
      startedAt: info.startedAt,
      configuredAgent: info.configuredAgent,
      configuredProviderID: info.configuredProviderID,
      configuredModelID: info.configuredModelID,
      hasCompletedResponse: false,
      completionRecorded: false,
      hasPublishedFinalResponse: false,
    });

    logger.debug(
      `[AssistantRunState] Started run: session=${sessionId}, agent=${info.configuredAgent || "unknown"}, model=${info.configuredProviderID || "unknown"}/${info.configuredModelID || "unknown"}`,
    );
  }

  isRunActive(sessionId: string): boolean {
    return this.runs.has(sessionId);
  }

  isFinalResponsePublished(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    return run?.hasPublishedFinalResponse === true;
  }

  // 2026-06-26: the OpenCode server reports a session as idle the moment the model stops
  // generating, but the bot's completion/finalization pipeline (completion queue, durable
  // delivery, thinking finalize, translate) runs asynchronously for a few more seconds.
  // This predicate marks that in-flight window: completion was recorded but the final
  // response has not been published yet. Busy reconciliation uses it to avoid clearing the
  // run mid-finalization, which would turn markFinalResponsePublished into a no-op, break
  // the isFinalResponsePublished guard, and leave a duplicate streaming draft next to the
  // final message.
  isFinalizationInFlight(sessionId: string): boolean {
    const run = this.runs.get(sessionId);
    if (!run) {
      return false;
    }

    return run.completionRecorded === true && run.hasPublishedFinalResponse !== true;
  }

  markResponseCompleted(sessionId: string, info?: AssistantRunResolvedInfo): void {
    const run = this.runs.get(sessionId);
    if (!run) {
      logger.debug(`[AssistantRunState] markResponseCompleted no run: session=${sessionId}`);
      return;
    }

    run.completionRecorded = true;
    if (info?.agent) {
      run.actualAgent = info.agent;
    }
    if (info?.providerID) {
      run.actualProviderID = info.providerID;
    }
    if (info?.modelID) {
      run.actualModelID = info.modelID;
    }
    if (info?.logicalMessageId) {
      // 2026-06-26: a run can complete more than one assistant message (multi-step turns,
      // multiple message.updated(completed) events). hasPublishedFinalResponse is set once
      // on the first published response and was never reset, so isFinalizationInFlight()
      // reported false for the 2nd+ completion. Busy reconciliation then cleared the run
      // mid-finalization (status_reconcile_idle), turning markFinalResponsePublished into a
      // no-op and dropping the final answer (thinking block delivered, answer text missing).
      // Reopen the finalization window only when this completion targets a message that has
      // not been published yet, so a repeated completion for the already-published message
      // does not keep the run busy forever.
      if (info.logicalMessageId !== run.publishedFinalLogicalMessageId) {
        run.hasPublishedFinalResponse = false;
      }
      run.completedLogicalMessageId = info.logicalMessageId;
    }
    if (typeof info?.completedAt === "number") {
      run.completedAt = info.completedAt;
    }
    logger.debug(`[AssistantRunState] markResponseCompleted: session=${sessionId}, hasCompletedResponse=${run.hasCompletedResponse}`);
  }

  markVisibleFinalResponse(sessionId: string, info?: { logicalMessageId?: string }): void {
    const run = this.runs.get(sessionId);
    if (!run) {
      logger.debug(`[AssistantRunState] markVisibleFinalResponse no run: session=${sessionId}`);
      return;
    }

    run.hasCompletedResponse = true;
    if (info?.logicalMessageId) {
      run.completedLogicalMessageId = info.logicalMessageId;
    }
    logger.debug(`[AssistantRunState] markVisibleFinalResponse: session=${sessionId}, hasCompletedResponse=${run.hasCompletedResponse}`);
  }

  markFinalResponsePublished(sessionId: string, info?: { logicalMessageId?: string }): void {
    const run = this.runs.get(sessionId);
    if (!run) {
      logger.debug(`[AssistantRunState] markFinalResponsePublished no run: session=${sessionId}`);
      return;
    }

    run.hasPublishedFinalResponse = true;
    run.finalizedAt = Date.now();
    if (info?.logicalMessageId) {
      run.publishedFinalLogicalMessageId = info.logicalMessageId;
    }
    logger.debug(`[AssistantRunState] markFinalResponsePublished: session=${sessionId}, hasPublishedFinalResponse=${run.hasPublishedFinalResponse}`);
  }

  getFinalizedAt(sessionId: string): number | undefined {
    return this.runs.get(sessionId)?.finalizedAt;
  }

  finishRun(sessionId: string, reason: string): AssistantRunInfo | null {
    const run = this.runs.get(sessionId) ?? null;
    if (!run) {
      logger.debug(`[AssistantRunState] finishRun no run: session=${sessionId}, reason=${reason}, activeSessions=${Array.from(this.runs.keys()).join(',')}`);
      return null;
    }

    this.runs.delete(sessionId);
    logger.debug(`[AssistantRunState] Finished run: session=${sessionId}, reason=${reason}, hasCompletedResponse=${run.hasCompletedResponse}`);
    return { ...run };
  }

  clearRun(sessionId: string, reason: string): void {
    if (!this.runs.delete(sessionId)) {
      logger.debug(`[AssistantRunState] clearRun no run: session=${sessionId}, reason=${reason}`);
      return;
    }

    logger.debug(`[AssistantRunState] Cleared run: session=${sessionId}, reason=${reason}`);
  }

  clearAll(reason: string): void {
    if (this.runs.size === 0) {
      return;
    }

    logger.debug(`[AssistantRunState] Cleared all runs: count=${this.runs.size}, reason=${reason}`);
    this.runs.clear();
  }

  __resetForTests(): void {
    this.runs.clear();
  }
}

const assistantRunStateGlobal = globalThis as typeof globalThis & {
  __opencodeAssistantRunState?: AssistantRunState;
};

// 2026-04-19: bot event handlers can be loaded through different module paths in tests,
// so keep assistant run tracking on globalThis to preserve one shared singleton.
export const assistantRunState =
  assistantRunStateGlobal.__opencodeAssistantRunState ??
  (assistantRunStateGlobal.__opencodeAssistantRunState = new AssistantRunState());
