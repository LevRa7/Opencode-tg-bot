import type { SessionInfo } from "../settings/manager.js";
import {
  buildTelegramConversationScopeKey,
  type TelegramConversationScope,
} from "../telegram/scope.js";
import type { AttachedSessionState } from "./types.js";
import { logger } from "../utils/logger.js";

interface TelegramTarget {
  chatId: number;
  messageThreadId?: number;
}

interface InternalAttachedSessionState extends AttachedSessionState {
  sequence: number;
}

function cloneScope(scope: TelegramConversationScope): TelegramConversationScope {
  return { ...scope };
}

function cloneSession(session: SessionInfo): SessionInfo {
  return { ...session };
}

function cloneState(state: AttachedSessionState): AttachedSessionState {
  return {
    scope: cloneScope(state.scope),
    session: cloneSession(state.session),
    attachedAt: state.attachedAt,
    busy: state.busy,
    lastEventId: state.lastEventId,
  };
}

class AttachManager {
  private readonly statesByScopeKey = new Map<string, InternalAttachedSessionState>();
  private readonly scopeKeyBySessionId = new Map<string, string>();
  private nextSequence = 0;

  private   canReplaceSessionRoute(sessionId: string, nextScope: TelegramConversationScope): boolean {
    const currentScopeKey = this.scopeKeyBySessionId.get(sessionId);
    if (!currentScopeKey) {
      return true; // no existing route — always allow
    }

    const currentState = this.statesByScopeKey.get(currentScopeKey);
    if (!currentState) {
      return true; // stale scope key, no state — allow
    }

    // Only block if different user AND the current user still has an active scope
    if (currentState.scope.userId !== nextScope.userId) {
      logger.warn(`[AttachManager] Reassigning session ${sessionId} from user ${currentState.scope.userId} to ${nextScope.userId}`);
      // Remove old route before setting new one — this is a re-assignment
      this.scopeKeyBySessionId.delete(sessionId);
    }
    return true;
  }

  attach(
    scope: TelegramConversationScope,
    session: SessionInfo,
    options: { attachedAt?: string; busy?: boolean; lastEventId?: string } = {},
  ): void {
    const scopeKey = buildTelegramConversationScopeKey(scope);
    const previousState = this.statesByScopeKey.get(scopeKey);

    const state: InternalAttachedSessionState = {
      scope: cloneScope(scope),
      session: cloneSession(session),
      attachedAt: options.attachedAt ?? new Date().toISOString(),
      busy: options.busy ?? false,
      lastEventId: options.lastEventId,
      sequence: this.nextSequence,
    };
    this.nextSequence += 1;

    this.statesByScopeKey.set(scopeKey, state);

    if (
      previousState &&
      previousState.session.id !== session.id &&
      this.scopeKeyBySessionId.get(previousState.session.id) === scopeKey
    ) {
      this.restoreNewestRouteForSession(previousState.session.id);
    }

    // Keep same-user reattach routing, but do not let another user take over a session route.
    if (this.canReplaceSessionRoute(session.id, scope)) {
      this.scopeKeyBySessionId.set(session.id, scopeKey);
    }
  }

  detach(scope: TelegramConversationScope): void {
    const scopeKey = buildTelegramConversationScopeKey(scope);
    const state = this.statesByScopeKey.get(scopeKey);
    if (!state) {
      return;
    }

    this.statesByScopeKey.delete(scopeKey);
    if (this.scopeKeyBySessionId.get(state.session.id) === scopeKey) {
      this.restoreNewestRouteForSession(state.session.id);
    }
  }

  getAttachedSession(scope: TelegramConversationScope): SessionInfo | null {
    return this.getStateForScope(scope)?.session ?? null;
  }

  getStateForScope(scope: TelegramConversationScope): AttachedSessionState | null {
    const state = this.statesByScopeKey.get(buildTelegramConversationScopeKey(scope));
    return state ? cloneState(state) : null;
  }

  getTargetForSession(sessionId: string): TelegramTarget | null {
    const scope = this.getScopeForSession(sessionId);
    if (!scope) {
      return null;
    }

    return scope.messageThreadId === undefined
      ? { chatId: scope.chatId }
      : { chatId: scope.chatId, messageThreadId: scope.messageThreadId };
  }

  getScopeForSession(sessionId: string): TelegramConversationScope | null {
    const scopeKey = this.scopeKeyBySessionId.get(sessionId);
    if (!scopeKey) {
      return null;
    }

    const state = this.statesByScopeKey.get(scopeKey);
    return state ? cloneScope(state.scope) : null;
  }

  getAllStates(): AttachedSessionState[] {
    return Array.from(this.statesByScopeKey.values()).map((state) => cloneState(state));
  }

  setBusy(sessionId: string, busy: boolean): void {
    const scopeKey = this.scopeKeyBySessionId.get(sessionId);
    if (!scopeKey) {
      return;
    }

    const state = this.statesByScopeKey.get(scopeKey);
    if (!state) {
      return;
    }

    state.busy = busy;
  }

  __resetForTests(): void {
    this.statesByScopeKey.clear();
    this.scopeKeyBySessionId.clear();
    this.nextSequence = 0;
  }

  private restoreNewestRouteForSession(sessionId: string): void {
    let newestState: { scopeKey: string; state: InternalAttachedSessionState } | null = null;

    for (const [scopeKey, state] of this.statesByScopeKey.entries()) {
      if (state.session.id !== sessionId) {
        continue;
      }

      if (!newestState || state.sequence > newestState.state.sequence) {
        newestState = { scopeKey, state };
      }
    }

    if (newestState) {
      this.scopeKeyBySessionId.set(sessionId, newestState.scopeKey);
    } else {
      this.scopeKeyBySessionId.delete(sessionId);
    }
  }
}

export const attachManager = new AttachManager();
