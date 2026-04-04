import { logger } from "../utils/logger.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";

interface RenameState {
  isWaiting: boolean;
  sessionId: string | null;
  sessionDirectory: string | null;
  currentTitle: string | null;
  messageId: number | null;
}

function createRenameState(): RenameState {
  return {
    isWaiting: false,
    sessionId: null,
    sessionDirectory: null,
    currentTitle: null,
    messageId: null,
  };
}

class RenameManager {
  private states = new Map<string, RenameState>();

  private getScopeState(scopeKey?: string): RenameState {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    const existingState = this.states.get(resolvedScopeKey);
    if (existingState) {
      return existingState;
    }

    const nextState = createRenameState();
    this.states.set(resolvedScopeKey, nextState);
    return nextState;
  }

  startWaiting(sessionId: string, directory: string, currentTitle: string, scopeKey?: string): void {
    const resolvedScopeKey = resolveTelegramConversationScopeKey(scopeKey);
    logger.info(
      `[RenameManager] Starting rename flow for scope=${resolvedScopeKey}, session=${sessionId}`,
    );
    this.states.set(resolvedScopeKey, {
      isWaiting: true,
      sessionId,
      sessionDirectory: directory,
      currentTitle,
      messageId: null,
    });
  }

  setMessageId(messageId: number, scopeKey?: string): void {
    this.getScopeState(scopeKey).messageId = messageId;
  }

  getMessageId(scopeKey?: string): number | null {
    return this.getScopeState(scopeKey).messageId;
  }

  isActiveMessage(messageId: number | null, scopeKey?: string): boolean {
    const state = this.getScopeState(scopeKey);
    return state.isWaiting && state.messageId !== null && state.messageId === messageId;
  }

  isWaitingForName(scopeKey?: string): boolean {
    return this.getScopeState(scopeKey).isWaiting;
  }

  getSessionInfo(
    scopeKey?: string,
  ): { sessionId: string; directory: string; currentTitle: string } | null {
    const state = this.getScopeState(scopeKey);
    if (!state.isWaiting || !state.sessionId) {
      return null;
    }
    return {
      sessionId: state.sessionId,
      directory: state.sessionDirectory!,
      currentTitle: state.currentTitle!,
    };
  }

  clear(scopeKey?: string): void {
    logger.debug(
      `[RenameManager] Clearing rename state for scope=${resolveTelegramConversationScopeKey(scopeKey)}`,
    );
    this.states.set(resolveTelegramConversationScopeKey(scopeKey), createRenameState());
  }

  clearAll(): void {
    this.states.clear();
  }
}

export const renameManager = new RenameManager();
