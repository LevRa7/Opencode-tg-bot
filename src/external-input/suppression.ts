import type { TelegramConversationScope } from "../telegram/scope.js";
import { buildTelegramConversationScopeKey } from "../telegram/scope.js";

const DEFAULT_TTL_MS = 15_000;

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, " ");
}

function buildSuppressionKey(
  sessionId: string,
  scope: TelegramConversationScope,
  text: string,
): string {
  return `${sessionId}::${buildTelegramConversationScopeKey(scope)}::${normalizeText(text)}`;
}

export class ExternalInputSuppression {
  private readonly ttlMs: number;
  private readonly expiresAtByKey = new Map<string, number>();

  constructor(options: { ttlMs?: number } = {}) {
    this.ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  }

  rememberSelfInput(sessionId: string, scope: TelegramConversationScope, text: string): void {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return;
    }

    this.clearExpired();
    this.expiresAtByKey.set(buildSuppressionKey(sessionId, scope, text), Date.now() + this.ttlMs);
  }

  shouldSuppress(sessionId: string, scope: TelegramConversationScope, text: string): boolean {
    const normalizedText = normalizeText(text);
    if (!normalizedText) {
      return false;
    }

    this.clearExpired();
    const expiresAt = this.expiresAtByKey.get(buildSuppressionKey(sessionId, scope, text));
    if (expiresAt === undefined) {
      return false;
    }

    if (expiresAt <= Date.now()) {
      this.expiresAtByKey.delete(buildSuppressionKey(sessionId, scope, text));
      return false;
    }

    return true;
  }

  clearExpired(now = Date.now()): void {
    for (const [key, expiresAt] of this.expiresAtByKey.entries()) {
      if (expiresAt <= now) {
        this.expiresAtByKey.delete(key);
      }
    }
  }

  __resetForTests(): void {
    this.expiresAtByKey.clear();
  }
}

export const externalInputSuppression = new ExternalInputSuppression();
