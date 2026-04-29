import { logger } from "../utils/logger.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";
import { PermissionRequest, PermissionState } from "./types.js";

interface PermissionRestoreEntry {
  request: PermissionRequest;
  sourceScopeKey: string;
  sourceMessageId: number;
}

interface PermissionRestorePlan {
  sessionId: string;
  targetScopeKey: string;
  staleTargetMessageIds: number[];
  entries: PermissionRestoreEntry[];
}

function clonePermissionRequest(request: PermissionRequest): PermissionRequest {
  return {
    ...request,
    patterns: [...request.patterns],
    metadata: { ...request.metadata },
    always: [...request.always],
    tool: request.tool ? { ...request.tool } : undefined,
  };
}

function createPermissionState(): PermissionState {
  return {
    requestsByMessageId: new Map(),
  };
}

class PermissionManager {
  private states = new Map<string, PermissionState>();

  private getScopeState(scopeKey?: string): PermissionState {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const existingState = this.states.get(resolvedScopeKey);
    if (existingState) {
      return existingState;
    }

    const nextState = createPermissionState();
    this.states.set(resolvedScopeKey, nextState);
    return nextState;
  }

  previewSessionRestore(
    sessionId: string,
    targetScopeKey: string,
    sourceScopeKeyOverride?: string,
  ): PermissionRestorePlan {
    const staleTargetMessageIds: number[] = [];
    const targetState = this.getScopeState(targetScopeKey);

    for (const [messageId, request] of targetState.requestsByMessageId.entries()) {
      if (request.sessionID !== sessionId) {
        staleTargetMessageIds.push(messageId);
      }
    }

    const entries: PermissionRestoreEntry[] = [];
    for (const [scopeKey, state] of this.states.entries()) {
      if (scopeKey === targetScopeKey) {
        continue;
      }

      if (sourceScopeKeyOverride && scopeKey !== sourceScopeKeyOverride) {
        continue;
      }

      for (const [messageId, request] of state.requestsByMessageId.entries()) {
        if (request.sessionID !== sessionId) {
          continue;
        }

        entries.push({
          request: clonePermissionRequest(request),
          sourceScopeKey: scopeKey,
          sourceMessageId: messageId,
        });
      }
    }

    return {
      sessionId,
      targetScopeKey,
      staleTargetMessageIds,
      entries,
    };
  }

  clearMismatchedTargetScopeRequests(sessionId: string, targetScopeKey: string): void {
    const state = this.getScopeState(targetScopeKey);
    for (const [messageId, request] of state.requestsByMessageId.entries()) {
      if (request.sessionID !== sessionId) {
        state.requestsByMessageId.delete(messageId);
      }
    }
  }

  commitSessionRestore(plan: PermissionRestorePlan): void {
    this.clearMismatchedTargetScopeRequests(plan.sessionId, plan.targetScopeKey);

    for (const entry of plan.entries) {
      const state = this.getScopeState(entry.sourceScopeKey);
      state.requestsByMessageId.delete(entry.sourceMessageId);
    }

    if (plan.entries.length > 0) {
      logger.info(
        `[PermissionManager] Restored ${plan.entries.length} pending permission request(s) for session=${plan.sessionId} into scope=${plan.targetScopeKey}`,
      );
    }
  }

  restoreSessionToScope(sessionId: string, targetScopeKey: string): PermissionRequest[] {
    const plan = this.previewSessionRestore(sessionId, targetScopeKey);
    this.commitSessionRestore(plan);
    return plan.entries.map((entry) => entry.request);
  }

  startPermission(request: PermissionRequest, messageId: number, scopeKey?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const state = this.getScopeState(resolvedScopeKey);

    logger.debug(
      `[PermissionManager] startPermission: scope=${resolvedScopeKey}, id=${request.id}, permission=${request.permission}, messageId=${messageId}`,
    );

    if (state.requestsByMessageId.has(messageId)) {
      logger.warn(
        `[PermissionManager] Message ID already tracked for scope=${resolvedScopeKey}, replacing: ${messageId}`,
      );
    }

    state.requestsByMessageId.set(messageId, request);

    logger.info(
      `[PermissionManager] New permission request: scope=${resolvedScopeKey}, type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${state.requestsByMessageId.size}`,
    );
  }

  getRequest(messageId: number | null, scopeKey?: string): PermissionRequest | null {
    if (messageId === null) {
      return null;
    }

    return this.getScopeState(scopeKey).requestsByMessageId.get(messageId) ?? null;
  }

  getRequestID(messageId: number | null, scopeKey?: string): string | null {
    return this.getRequest(messageId, scopeKey)?.id ?? null;
  }

  getPermissionType(messageId: number | null, scopeKey?: string): string | null {
    return this.getRequest(messageId, scopeKey)?.permission ?? null;
  }

  getPatterns(messageId: number | null, scopeKey?: string): string[] {
    return this.getRequest(messageId, scopeKey)?.patterns ?? [];
  }

  isActiveMessage(messageId: number | null, scopeKey?: string): boolean {
    return messageId !== null && this.getScopeState(scopeKey).requestsByMessageId.has(messageId);
  }

  getMessageId(scopeKey?: string): number | null {
    const messageIds = this.getMessageIds(scopeKey);
    if (messageIds.length === 0) {
      return null;
    }

    return messageIds[messageIds.length - 1];
  }

  getMessageIds(scopeKey?: string): number[] {
    return Array.from(this.getScopeState(scopeKey).requestsByMessageId.keys());
  }

  removeByMessageId(messageId: number | null, scopeKey?: string): PermissionRequest | null {
    const state = this.getScopeState(scopeKey);
    const request = this.getRequest(messageId, scopeKey);
    if (!request || messageId === null) {
      return null;
    }

    state.requestsByMessageId.delete(messageId);

    logger.debug(
      `[PermissionManager] Removed permission request: scope=${resolveTelegramConversationScopeKey(scopeKey)}, id=${request.id}, messageId=${messageId}, pending=${state.requestsByMessageId.size}`,
    );

    return request;
  }

  getPendingCount(scopeKey?: string): number {
    return this.getScopeState(scopeKey).requestsByMessageId.size;
  }

  isActive(scopeKey?: string): boolean {
    return this.getScopeState(scopeKey).requestsByMessageId.size > 0;
  }

  clear(scopeKey?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const state = this.getScopeState(resolvedScopeKey);
    logger.debug(
      `[PermissionManager] Clearing permission state: scope=${resolvedScopeKey}, pending=${state.requestsByMessageId.size}`,
    );

    this.states.set(resolvedScopeKey, createPermissionState());
  }

  clearAll(): void {
    this.states.clear();
  }
}

export const permissionManager = new PermissionManager();
