import { logger } from "../utils/logger.js";
import {
  resolveTelegramConversationScopeKey,
  type TelegramConversationScope,
} from "../telegram/scope.js";

type ForegroundScope = TelegramConversationScope | string | null;

class ForegroundSessionState {
  private activeSessionIdsByScope = new Map<string, Set<string>>();
  private busyScopeKeyBySessionId = new Map<string, string>();

  private getScopeState(scopeKey?: ForegroundScope): Set<string> {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    return this.getOrCreateScopeState(resolvedScopeKey);
  }

  private getOrCreateScopeState(resolvedScopeKey: string): Set<string> {
    const existingState = this.activeSessionIdsByScope.get(resolvedScopeKey);
    if (existingState) {
      return existingState;
    }

    const nextState = new Set<string>();
    this.activeSessionIdsByScope.set(resolvedScopeKey, nextState);
    return nextState;
  }

  private getExistingScopeState(scopeKey?: ForegroundScope): Set<string> | undefined {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    return this.activeSessionIdsByScope.get(resolvedScopeKey);
  }

  markBusy(sessionId: string, scopeKey?: ForegroundScope): void {
    if (!sessionId) {
      return;
    }

    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.getScopeState(resolvedScopeKey);
    scopeState.add(sessionId);
    this.busyScopeKeyBySessionId.set(sessionId, resolvedScopeKey);
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: scope=${resolvedScopeKey}, session=${sessionId}, count=${scopeState.size}`,
    );
  }

  tryMarkBusy(sessionId: string, scopeKey?: ForegroundScope): boolean {
    this.markBusy(sessionId, scopeKey);
    return true;
  }

  markIdle(sessionId: string, scopeKey?: ForegroundScope): void {
    if (!sessionId) {
      return;
    }

    const resolvedScopeKey =
      this.busyScopeKeyBySessionId.get(sessionId) ?? resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.activeSessionIdsByScope.get(resolvedScopeKey);
    if (!scopeState) {
      this.busyScopeKeyBySessionId.delete(sessionId);
      return;
    }
    scopeState.delete(sessionId);
    this.busyScopeKeyBySessionId.delete(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: scope=${resolvedScopeKey}, session=${sessionId}, count=${scopeState.size}`,
    );

    if (scopeState.size === 0) {
      this.activeSessionIdsByScope.delete(resolvedScopeKey);
    }
  }

  isBusy(scopeKey?: ForegroundScope): boolean {
    return (this.getExistingScopeState(scopeKey)?.size ?? 0) > 0;
  }

  isBusyForScope(scopeKey?: ForegroundScope): boolean {
    return this.isBusy(scopeKey);
  }

  getActiveCount(scopeKey?: ForegroundScope): number {
    return this.getExistingScopeState(scopeKey)?.size ?? 0;
  }

  clearAll(reason: string, scopeKey?: ForegroundScope): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.activeSessionIdsByScope.get(resolvedScopeKey);
    if (!scopeState || scopeState.size === 0) {
      return;
    }

    logger.info(
      `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, scope=${resolvedScopeKey}, count=${scopeState.size}`,
    );
    for (const activeSessionId of scopeState) {
      if (this.busyScopeKeyBySessionId.get(activeSessionId) === resolvedScopeKey) {
        this.busyScopeKeyBySessionId.delete(activeSessionId);
      }
    }
    this.activeSessionIdsByScope.delete(resolvedScopeKey);
  }

  __resetForTests(): void {
    this.activeSessionIdsByScope.clear();
    this.busyScopeKeyBySessionId.clear();
  }
}

export const foregroundSessionState = new ForegroundSessionState();
