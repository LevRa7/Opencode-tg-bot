import { logger } from "../utils/logger.js";
import {
  resolveTelegramConversationScopeKey,
  type TelegramConversationScope,
} from "../telegram/scope.js";

export interface ForegroundBusySession {
  sessionId: string;
  directory: string;
  markedAt: number;
}

type ForegroundScope = TelegramConversationScope | string | null;

class ForegroundSessionState {
  private activeSessionIdsByScope = new Map<string, Set<string>>();
  private busyScopeKeyBySessionId = new Map<string, string>();
  private sessionMetaBySessionId = new Map<string, ForegroundBusySession>();

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

  markBusy(sessionId: string, directory: string, scopeKey?: ForegroundScope): void {
    if (!sessionId || !directory) {
      return;
    }

    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const scopeState = this.getScopeState(resolvedScopeKey);
    scopeState.add(sessionId);
    this.busyScopeKeyBySessionId.set(sessionId, resolvedScopeKey);
    this.sessionMetaBySessionId.set(sessionId, { sessionId, directory, markedAt: Date.now() });
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: scope=${resolvedScopeKey}, session=${sessionId}, directory=${directory}, count=${scopeState.size}`,
    );
  }

  tryMarkBusy(sessionId: string, directory: string, scopeKey?: ForegroundScope): boolean {
    this.markBusy(sessionId, directory, scopeKey);
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
      this.sessionMetaBySessionId.delete(sessionId);
      return;
    }
    scopeState.delete(sessionId);
    this.busyScopeKeyBySessionId.delete(sessionId);
    this.sessionMetaBySessionId.delete(sessionId);
    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: scope=${resolvedScopeKey}, session=${sessionId}, count=${scopeState.size}`,
    );

    if (scopeState.size === 0) {
      this.activeSessionIdsByScope.delete(resolvedScopeKey);
    }
  }

  getBusySessions(): ForegroundBusySession[] {
    return Array.from(this.sessionMetaBySessionId.values(), (session) => ({ ...session }));
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
      this.sessionMetaBySessionId.delete(activeSessionId);
    }
    this.activeSessionIdsByScope.delete(resolvedScopeKey);
  }

  __resetForTests(): void {
    this.activeSessionIdsByScope.clear();
    this.busyScopeKeyBySessionId.clear();
    this.sessionMetaBySessionId.clear();
  }

  __setMarkedAtForTests(sessionId: string, markedAt: number): void {
    const session = this.sessionMetaBySessionId.get(sessionId);
    if (!session) {
      return;
    }

    this.sessionMetaBySessionId.set(sessionId, { ...session, markedAt });
  }
}

export const foregroundSessionState = new ForegroundSessionState();
