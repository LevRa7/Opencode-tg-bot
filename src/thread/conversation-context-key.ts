import type { TelegramConversationScope } from "../telegram/scope.js";
import type { TelegramThreadTarget } from "../bot/utils/message-thread.js";

function normalizeThreadId(messageThreadId: number | undefined): number | undefined {
  return typeof messageThreadId === "number" && messageThreadId > 0 ? messageThreadId : undefined;
}

function parseInteger(raw: string): number | null {
  const parsed = Number(raw);
  return Number.isInteger(parsed) ? parsed : null;
}

export class ConversationContextKey {
  private constructor(
    readonly userId: number | null,
    readonly chatId: number,
    readonly messageThreadId: number | undefined,
  ) {}

  static fromScope(scope: TelegramConversationScope): ConversationContextKey {
    return new ConversationContextKey(scope.userId, scope.chatId, normalizeThreadId(scope.messageThreadId));
  }

  static parse(raw: string): ConversationContextKey | null {
    const parts = raw.split(":");
    if (parts.length !== 2 && parts.length !== 3) {
      return null;
    }

    if (parts.length === 2) {
      const [chatIdRaw, messageThreadIdRaw] = parts;
      const chatId = parseInteger(chatIdRaw);
      const messageThreadId = parseInteger(messageThreadIdRaw);
      if (chatId === null || messageThreadId === null) {
        return null;
      }

      return new ConversationContextKey(null, chatId, normalizeThreadId(messageThreadId));
    }

    const [userIdRaw, chatIdRaw, messageThreadIdRaw] = parts;
    const userId = parseInteger(userIdRaw);
    const chatId = parseInteger(chatIdRaw);
    const messageThreadId = parseInteger(messageThreadIdRaw);
    if (userId === null || chatId === null || messageThreadId === null) {
      return null;
    }

    return new ConversationContextKey(userId, chatId, normalizeThreadId(messageThreadId));
  }

  equals(other: ConversationContextKey): boolean {
    return (
      this.userId === other.userId &&
      this.chatId === other.chatId &&
      this.messageThreadId === other.messageThreadId
    );
  }

  toScope(): TelegramConversationScope | null {
    if (this.userId === null) {
      return null;
    }

    return {
      userId: this.userId,
      chatId: this.chatId,
      messageThreadId: this.messageThreadId,
    };
  }

  toTarget(): TelegramThreadTarget {
    return {
      chatId: this.chatId,
      messageThreadId: this.messageThreadId,
    };
  }

  toString(): string {
    if (this.userId === null) {
      return `${this.chatId}:${this.messageThreadId ?? 0}`;
    }

    return `${this.userId}:${this.chatId}:${this.messageThreadId ?? 0}`;
  }
}
