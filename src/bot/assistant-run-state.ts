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
    if (info?.logicalMessageId) {
      run.publishedFinalLogicalMessageId = info.logicalMessageId;
    }
    logger.debug(`[AssistantRunState] markFinalResponsePublished: session=${sessionId}, hasPublishedFinalResponse=${run.hasPublishedFinalResponse}`);
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
