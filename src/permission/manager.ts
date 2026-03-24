import { PermissionRequest, PermissionState } from "./types.js";
import type { TelegramConversationScope } from "../telegram/scope.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";
import { logger } from "../utils/logger.js";

function createInitialState(): PermissionState {
  return {
    requestsByMessageId: new Map(),
  };
}

class PermissionManager {
  private states = new Map<string, PermissionState>();

  private getScopeKey(scope?: TelegramConversationScope | null): string {
    return resolveTelegramConversationScopeKey(scope);
  }

  private getOrCreateState(scope?: TelegramConversationScope | null): PermissionState {
    const scopeKey = this.getScopeKey(scope);
    let state = this.states.get(scopeKey);
    if (!state) {
      state = createInitialState();
      this.states.set(scopeKey, state);
    }

    return state;
  }

  private getState(scope?: TelegramConversationScope | null): PermissionState {
    return this.states.get(this.getScopeKey(scope)) ?? createInitialState();
  }

  /**
   * Register a new permission request message
   */
  startPermission(
    request: PermissionRequest,
    messageId: number,
    scope?: TelegramConversationScope | null,
  ): void {
    const state = this.getOrCreateState(scope);
    const scopeKey = this.getScopeKey(scope);
    logger.debug(
      `[PermissionManager] startPermission: scope=${scopeKey}, id=${request.id}, permission=${request.permission}, messageId=${messageId}`,
    );

    if (state.requestsByMessageId.has(messageId)) {
      logger.warn(`[PermissionManager] Message ID already tracked, replacing: ${messageId}`);
    }

    state.requestsByMessageId.set(messageId, request);

    logger.info(
      `[PermissionManager] New permission request: scope=${scopeKey}, type=${request.permission}, patterns=${request.patterns.join(", ")}, pending=${state.requestsByMessageId.size}`,
    );
  }

  /**
   * Get permission request by Telegram message ID
   */
  getRequest(
    messageId: number | null,
    scope?: TelegramConversationScope | null,
  ): PermissionRequest | null {
    if (messageId === null) {
      return null;
    }

    return this.getState(scope).requestsByMessageId.get(messageId) ?? null;
  }

  /**
   * Get request ID for API reply by Telegram message ID
   */
  getRequestID(messageId: number | null, scope?: TelegramConversationScope | null): string | null {
    return this.getRequest(messageId, scope)?.id ?? null;
  }

  /**
   * Get permission type (bash, edit, etc.) by message ID
   */
  getPermissionType(
    messageId: number | null,
    scope?: TelegramConversationScope | null,
  ): string | null {
    return this.getRequest(messageId, scope)?.permission ?? null;
  }

  /**
   * Get patterns (commands/files) by message ID
   */
  getPatterns(messageId: number | null, scope?: TelegramConversationScope | null): string[] {
    return this.getRequest(messageId, scope)?.patterns ?? [];
  }

  /**
   * Check if callback message ID belongs to active permission request
   */
  isActiveMessage(messageId: number | null, scope?: TelegramConversationScope | null): boolean {
    return messageId !== null && this.getState(scope).requestsByMessageId.has(messageId);
  }

  /**
   * Get latest Telegram message ID
   */
  getMessageId(scope?: TelegramConversationScope | null): number | null {
    const messageIds = this.getMessageIds(scope);
    if (messageIds.length === 0) {
      return null;
    }

    return messageIds[messageIds.length - 1];
  }

  /**
   * Get Telegram message IDs for all active requests
   */
  getMessageIds(scope?: TelegramConversationScope | null): number[] {
    return Array.from(this.getState(scope).requestsByMessageId.keys());
  }

  /**
   * Remove permission request by Telegram message ID
   */
  removeByMessageId(
    messageId: number | null,
    scope?: TelegramConversationScope | null,
  ): PermissionRequest | null {
    const state = this.getOrCreateState(scope);
    const request = this.getRequest(messageId, scope);
    if (!request || messageId === null) {
      return null;
    }

    state.requestsByMessageId.delete(messageId);

    logger.debug(
      `[PermissionManager] Removed permission request: scope=${this.getScopeKey(scope)}, id=${request.id}, messageId=${messageId}, pending=${state.requestsByMessageId.size}`,
    );

    return request;
  }

  /**
   * Get number of active permission requests
   */
  getPendingCount(scope?: TelegramConversationScope | null): number {
    return this.getState(scope).requestsByMessageId.size;
  }

  /**
   * Check if there are active permission requests
   */
  isActive(scope?: TelegramConversationScope | null): boolean {
    return this.getState(scope).requestsByMessageId.size > 0;
  }

  /**
   * Clear state after reply
   */
  clear(scope?: TelegramConversationScope | null): void {
    const state = this.getOrCreateState(scope);
    logger.debug(
      `[PermissionManager] Clearing permission state: scope=${this.getScopeKey(scope)}, pending=${state.requestsByMessageId.size}`,
    );

    this.states.set(this.getScopeKey(scope), createInitialState());
  }

  __resetForTests(): void {
    this.states.clear();
  }
}

export const permissionManager = new PermissionManager();
