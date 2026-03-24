import { logger } from "../utils/logger.js";
import type { TelegramConversationScope } from "../telegram/scope.js";
import {
  getCurrentTelegramConversationScope,
  resolveTelegramConversationScopeKey,
} from "../telegram/scope.js";

const MAX_PARALLEL_FOREGROUND_REQUESTS_PER_USER = 5;

interface SessionForegroundBinding {
  userKey: string;
  topicKey: string;
}

class ForegroundSessionState {
  private activeSessionsByUser = new Map<string, Map<string, string>>();
  private bindingBySessionId = new Map<string, SessionForegroundBinding>();

  private resolveScope(scope?: TelegramConversationScope | null): TelegramConversationScope | null {
    return scope ?? getCurrentTelegramConversationScope();
  }

  private resolveUserKey(scope?: TelegramConversationScope | null): string {
    const resolvedScope = this.resolveScope(scope);
    return resolvedScope ? String(resolvedScope.userId) : "global";
  }

  private resolveTopicKey(scope?: TelegramConversationScope | null): string {
    return resolveTelegramConversationScopeKey(this.resolveScope(scope));
  }

  private getOrCreateUserSessions(userKey: string): Map<string, string> {
    let activeSessions = this.activeSessionsByUser.get(userKey);
    if (!activeSessions) {
      activeSessions = new Map<string, string>();
      this.activeSessionsByUser.set(userKey, activeSessions);
    }

    return activeSessions;
  }

  private getTotalActiveCount(): number {
    let count = 0;
    for (const userSessions of this.activeSessionsByUser.values()) {
      count += userSessions.size;
    }

    return count;
  }

  tryMarkBusy(sessionId: string, scope?: TelegramConversationScope | null): boolean {
    if (!sessionId) {
      return false;
    }

    const userKey = this.resolveUserKey(scope);
    const topicKey = this.resolveTopicKey(scope);
    const activeSessions = this.getOrCreateUserSessions(userKey);
    const existingSessionId = activeSessions.get(topicKey);

    if (existingSessionId === sessionId) {
      return true;
    }

    if (existingSessionId) {
      logger.info(
        `[ScheduledTaskForeground] Rejected foreground slot for active topic: user=${userKey}, topic=${topicKey}, existingSession=${existingSessionId}, requestedSession=${sessionId}`,
      );
      return false;
    }

    if (activeSessions.size >= MAX_PARALLEL_FOREGROUND_REQUESTS_PER_USER) {
      logger.info(
        `[ScheduledTaskForeground] Rejected foreground slot because user limit was reached: user=${userKey}, limit=${MAX_PARALLEL_FOREGROUND_REQUESTS_PER_USER}, requestedSession=${sessionId}`,
      );
      return false;
    }

    activeSessions.set(topicKey, sessionId);
    this.bindingBySessionId.set(sessionId, { userKey, topicKey });
    logger.debug(
      `[ScheduledTaskForeground] Marked session busy: session=${sessionId}, user=${userKey}, topic=${topicKey}, userCount=${activeSessions.size}, totalCount=${this.getTotalActiveCount()}`,
    );

    return true;
  }

  markBusy(sessionId: string, scope?: TelegramConversationScope | null): void {
    this.tryMarkBusy(sessionId, scope);
  }

  markIdle(sessionId: string, scope?: TelegramConversationScope | null): void {
    if (!sessionId) {
      return;
    }

    const binding = this.bindingBySessionId.get(sessionId);
    const userKey = binding?.userKey ?? this.resolveUserKey(scope);
    const topicKey = binding?.topicKey ?? this.resolveTopicKey(scope);
    const activeSessions = this.activeSessionsByUser.get(userKey);
    if (!activeSessions) {
      return;
    }

    activeSessions.delete(topicKey);
    this.bindingBySessionId.delete(sessionId);
    if (activeSessions.size === 0) {
      this.activeSessionsByUser.delete(userKey);
    }

    logger.debug(
      `[ScheduledTaskForeground] Marked session idle: session=${sessionId}, user=${userKey}, topic=${topicKey}, userCount=${activeSessions.size}, totalCount=${this.getTotalActiveCount()}`,
    );
  }

  isBusy(scope?: TelegramConversationScope | null): boolean {
    const resolvedScope = this.resolveScope(scope);
    if (!resolvedScope) {
      return this.bindingBySessionId.size > 0;
    }

    return (this.activeSessionsByUser.get(String(resolvedScope.userId))?.size ?? 0) > 0;
  }

  getActiveCount(scope?: TelegramConversationScope | null): number {
    const resolvedScope = this.resolveScope(scope);
    if (!resolvedScope) {
      return this.bindingBySessionId.size;
    }

    return this.activeSessionsByUser.get(String(resolvedScope.userId))?.size ?? 0;
  }

  clearAll(reason: string, scope?: TelegramConversationScope | null): void {
    const resolvedScope = this.resolveScope(scope);
    if (!resolvedScope) {
      if (this.bindingBySessionId.size === 0) {
        return;
      }

      logger.info(
        `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, count=${this.bindingBySessionId.size}`,
      );
      this.activeSessionsByUser.clear();
      this.bindingBySessionId.clear();
      return;
    }

    const userKey = String(resolvedScope.userId);
    const activeSessions = this.activeSessionsByUser.get(userKey);
    if (!activeSessions || activeSessions.size === 0) {
      return;
    }

    logger.info(
      `[ScheduledTaskForeground] Cleared foreground busy state: reason=${reason}, user=${userKey}, count=${activeSessions.size}`,
    );
    for (const sessionId of activeSessions.values()) {
      this.bindingBySessionId.delete(sessionId);
    }
    this.activeSessionsByUser.delete(userKey);
  }

  __resetForTests(): void {
    this.activeSessionsByUser.clear();
    this.bindingBySessionId.clear();
  }
}

export const foregroundSessionState = new ForegroundSessionState();
