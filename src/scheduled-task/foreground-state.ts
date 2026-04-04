import { logger } from "../utils/logger.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";

class ForegroundSessionState {
  private activeSessionIdsByScope = new Map<string, Set<string>>();

  private getScopeState(scopeKey?: string): Set<string> {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const existingState = this.activeSessionIdsByScope.get(resolvedScopeKey);
    if (existingState) {
      return existingState;
    }

    const nextState = new Set<string>();
    this.activeSessionIdsByScope.set(resolvedScopeKey, nextState);
    return nextState;
  }

  markBusy(sessionId: string, scopeKey?: string): void {
    if (!sessionId) {
      return;
    }

    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.getScopeState(resolvedScopeKey);
    scopeState.add(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: scope=${resolvedScopeKey}, session=${sessionId}, count=${scopeState.size}`,
    );
  }

  tryMarkBusy(sessionId: string, scopeKey?: string): boolean {
    this.markBusy(sessionId, scopeKey);
    return true;
  }

  markIdle(sessionId: string, scopeKey?: string): void {
    if (!sessionId) {
      return;
    }

    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.getScopeState(resolvedScopeKey);
    scopeState.delete(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: scope=${resolvedScopeKey}, session=${sessionId}, count=${scopeState.size}`,
    );

    if (scopeState.size === 0) {
      this.activeSessionIdsByScope.delete(resolvedScopeKey);
    }
  }

  isBusy(scopeKey?: string): boolean {
    return this.getScopeState(scopeKey).size > 0;
  }

  getActiveCount(scopeKey?: string): number {
    return this.getScopeState(scopeKey).size;
  }

  clearAll(reason: string, scopeKey?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.activeSessionIdsByScope.get(resolvedScopeKey);
    if (!scopeState || scopeState.size === 0) {
      return;
    }

    logger.info(
      `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, scope=${resolvedScopeKey}, count=${scopeState.size}`,
    );
    this.activeSessionIdsByScope.delete(resolvedScopeKey);
  }

  __resetForTests(): void {
    this.activeSessionIdsByScope.clear();
  }
}

export const foregroundSessionState = new ForegroundSessionState();
