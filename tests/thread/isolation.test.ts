import { describe, it, expect } from "vitest";
import { buildTelegramConversationScopeKey } from "../../src/telegram/scope.js";
import { ConversationContextKey } from "../../src/thread/conversation-context-key.js";

describe("Telegram Thread Isolation", () => {
  describe("topic context key isolation", () => {
    it("should generate different keys for different topics in same chat", () => {
      const scope1 = {
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      };
      const scope2 = {
        userId: 123,
        chatId: 456,
        messageThreadId: 200,
      };

      const key1 = buildTelegramConversationScopeKey(scope1);
      const key2 = buildTelegramConversationScopeKey(scope2);

      expect(key1).not.toBe(key2);

      const parsed1 = ConversationContextKey.parse(key1);
      const parsed2 = ConversationContextKey.parse(key2);

      expect(parsed1?.toTarget()).toEqual({ chatId: 456, messageThreadId: 100 });
      expect(parsed2?.toTarget()).toEqual({ chatId: 456, messageThreadId: 200 });
    });

    it("should generate same key for same topic", () => {
      const scope = {
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      };

      const key1 = buildTelegramConversationScopeKey(scope);
      const key2 = buildTelegramConversationScopeKey(scope);

      expect(key1).toBe(key2);
    });

    it("should generate different keys for different chats", () => {
      const scope1 = {
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      };
      const scope2 = {
        userId: 123,
        chatId: 789,
        messageThreadId: 100,
      };

      const key1 = buildTelegramConversationScopeKey(scope1);
      const key2 = buildTelegramConversationScopeKey(scope2);

      expect(key1).not.toBe(key2);
    });

    it("should generate same key for identical topic copies", () => {
      const scope1 = {
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      };
      const scope2 = {
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      };

      const key1 = buildTelegramConversationScopeKey(scope1);
      const key2 = buildTelegramConversationScopeKey(scope2);

      expect(key1).toBe(key2);
    });
  });

  describe("potential cross-topic interference", () => {
    it("documents: different threads in same chat should have isolated settings", () => {
      const topic100Scope = {
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      };
      const topic200Scope = {
        userId: 123,
        chatId: 456,
        messageThreadId: 200,
      };

      const key100 = buildTelegramConversationScopeKey(topic100Scope);
      const key200 = buildTelegramConversationScopeKey(topic200Scope);

      expect(key100).not.toBe(key200);
    });

    it("keeps parsed conversation identity isolated between topics", () => {
      const topic100 = ConversationContextKey.parse("123:456:100");
      const topic200 = ConversationContextKey.parse("123:456:200");

      expect(topic100).not.toBeNull();
      expect(topic200).not.toBeNull();
      expect(topic100?.equals(topic200!)).toBe(false);
      expect(topic100?.toTarget()).toEqual({ chatId: 456, messageThreadId: 100 });
      expect(topic200?.toTarget()).toEqual({ chatId: 456, messageThreadId: 200 });
    });

    it("round-trips interleaved prompt thread keys without collapsing delivery targets", () => {
      const firstPromptKey = ConversationContextKey.fromScope({
        userId: 123,
        chatId: 456,
        messageThreadId: 100,
      }).toString();
      const secondPromptKey = ConversationContextKey.fromScope({
        userId: 123,
        chatId: 456,
        messageThreadId: 200,
      }).toString();

      const firstPrompt = ConversationContextKey.parse(firstPromptKey);
      const secondPrompt = ConversationContextKey.parse(secondPromptKey);

      expect(firstPromptKey).not.toBe(secondPromptKey);
      expect(firstPrompt?.toTarget()).toEqual({ chatId: 456, messageThreadId: 100 });
      expect(secondPrompt?.toTarget()).toEqual({ chatId: 456, messageThreadId: 200 });
    });
  });
});
