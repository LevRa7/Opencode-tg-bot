import type {
  InteractionClearReason,
  InteractionState,
  StartInteractionOptions,
  TransitionInteractionOptions,
} from "./types.js";
import type { TelegramConversationScope } from "../telegram/scope.js";
import { resolveTelegramConversationScopeKey } from "../telegram/scope.js";
import { logger } from "../utils/logger.js";

export const DEFAULT_ALLOWED_INTERACTION_COMMANDS = ["/help", "/status", "/abort"] as const;

function normalizeCommand(command: string): string | null {
  const trimmed = command.trim().toLowerCase();
  if (!trimmed) {
    return null;
  }

  const withSlash = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
  const withoutMention = withSlash.split("@")[0];

  if (withoutMention.length <= 1) {
    return null;
  }

  return withoutMention;
}

function normalizeAllowedCommands(commands?: string[]): string[] {
  if (commands === undefined) {
    return [...DEFAULT_ALLOWED_INTERACTION_COMMANDS];
  }

  const normalized = new Set<string>();

  for (const command of commands) {
    const value = normalizeCommand(command);
    if (value) {
      normalized.add(value);
    }
  }

  return Array.from(normalized);
}

function cloneState(state: InteractionState): InteractionState {
  return {
    ...state,
    allowedCommands: [...state.allowedCommands],
    metadata: { ...state.metadata },
  };
}

class InteractionManager {
  private states = new Map<string, InteractionState>();

  private getState(scope?: TelegramConversationScope | null): InteractionState | null {
    return this.states.get(resolveTelegramConversationScopeKey(scope)) ?? null;
  }

  start(
    options: StartInteractionOptions,
    scope?: TelegramConversationScope | null,
  ): InteractionState {
    const now = Date.now();
    let expiresAt: number | null = null;
    const scopeKey = resolveTelegramConversationScopeKey(scope);
    const currentState = this.states.get(scopeKey) ?? null;

    if (currentState) {
      this.clear("state_replaced", scope);
    }

    if (typeof options.expiresInMs === "number") {
      expiresAt = now + options.expiresInMs;
    }

    const nextState: InteractionState = {
      kind: options.kind,
      expectedInput: options.expectedInput,
      allowedCommands: normalizeAllowedCommands(options.allowedCommands),
      metadata: options.metadata ? { ...options.metadata } : {},
      createdAt: now,
      expiresAt,
    };

    this.states.set(scopeKey, nextState);

    logger.info(
      `[InteractionManager] Started interaction: scope=${scopeKey}, kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(nextState);
  }

  get(scope?: TelegramConversationScope | null): InteractionState | null {
    const state = this.getState(scope);
    if (!state) {
      return null;
    }

    return cloneState(state);
  }

  getSnapshot(scope?: TelegramConversationScope | null): InteractionState | null {
    return this.get(scope);
  }

  isActive(scope?: TelegramConversationScope | null): boolean {
    return this.getState(scope) !== null;
  }

  isExpired(
    referenceTimeMs: number = Date.now(),
    scope?: TelegramConversationScope | null,
  ): boolean {
    const state = this.getState(scope);
    if (!state || state.expiresAt === null) {
      return false;
    }

    return referenceTimeMs >= state.expiresAt;
  }

  transition(
    options: TransitionInteractionOptions,
    scope?: TelegramConversationScope | null,
  ): InteractionState | null {
    const scopeKey = resolveTelegramConversationScopeKey(scope);
    const state = this.states.get(scopeKey) ?? null;
    if (!state) {
      return null;
    }

    const now = Date.now();

    const nextState: InteractionState = {
      ...state,
      kind: options.kind ?? state.kind,
      expectedInput: options.expectedInput ?? state.expectedInput,
      allowedCommands:
        options.allowedCommands !== undefined
          ? normalizeAllowedCommands(options.allowedCommands)
          : [...state.allowedCommands],
      metadata: options.metadata ? { ...options.metadata } : { ...state.metadata },
      expiresAt:
        options.expiresInMs === undefined
          ? state.expiresAt
          : options.expiresInMs === null
            ? null
            : now + options.expiresInMs,
    };

    this.states.set(scopeKey, nextState);

    logger.debug(
      `[InteractionManager] Transitioned interaction: scope=${scopeKey}, kind=${nextState.kind}, expectedInput=${nextState.expectedInput}, allowedCommands=${nextState.allowedCommands.join(",") || "none"}`,
    );

    return cloneState(nextState);
  }

  clear(reason: InteractionClearReason = "manual", scope?: TelegramConversationScope | null): void {
    const scopeKey = resolveTelegramConversationScopeKey(scope);
    const state = this.states.get(scopeKey) ?? null;
    if (!state) {
      return;
    }

    logger.info(
      `[InteractionManager] Cleared interaction: scope=${scopeKey}, reason=${reason}, kind=${state.kind}, expectedInput=${state.expectedInput}`,
    );

    this.states.delete(scopeKey);
  }

  __resetForTests(): void {
    this.states.clear();
  }
}

export const interactionManager = new InteractionManager();
