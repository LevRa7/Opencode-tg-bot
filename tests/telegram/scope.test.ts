import { describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

vi.mock("../../src/bot/utils/message-thread.js", () => ({
  extractMessageThreadIdFromContext: vi.fn((ctx: any) => ctx._mockThreadId),
  isForumChat: vi.fn((ctx: any) => ctx._mockIsForum === true),
}));

async function loadScope() {
  return import("../../src/telegram/scope.js");
}

describe("extractTelegramConversationScopeFromContext", () => {
  it("returns null when userId is missing", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = { from: undefined, chat: { id: -1001 } } as unknown as Context;
    expect(extractTelegramConversationScopeFromContext(ctx)).toBeNull();
  });

  it("returns null when chatId is missing", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = { from: { id: 123 }, chat: undefined } as unknown as Context;
    expect(extractTelegramConversationScopeFromContext(ctx)).toBeNull();
  });

  it("returns scope with userId and chatId for private chat", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = {
      from: { id: 12345 },
      chat: { id: 67890 },
      _mockIsForum: false,
      _mockThreadId: undefined,
    } as unknown as Context;

    const scope = extractTelegramConversationScopeFromContext(ctx);
    expect(scope).toEqual({ userId: 12345, chatId: 67890 });
  });

  // Regression guard (2026-06-25): a private chat with Direct Messages topics
  // (bot `has_topics_enabled`) carries a real per-topic `message_thread_id`.
  // It MUST be preserved so every topic gets its own conversation scope key.
  // The previous blanket strip collapsed all private-chat topics into the same
  // `userId:chatId:0` key, which broke session and busy-state isolation:
  // messages typed in an older topic were routed to the newest session, and a
  // session busy in one topic blocked commands in every other topic.
  it("keeps messageThreadId for a private chat with a Direct Messages topic", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = {
      from: { id: 12345 },
      chat: { id: 67890, type: "private" },
      message: { message_thread_id: 999 },
      _mockIsForum: false,
      _mockThreadId: 999,
    } as unknown as Context;

    const scope = extractTelegramConversationScopeFromContext(ctx);
    expect(scope).toEqual({ userId: 12345, chatId: 67890, messageThreadId: 999 });
  });

  it("two private-chat topics produce distinct scopes (topic isolation)", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const topicA = {
      from: { id: 12345 },
      chat: { id: 67890, type: "private" },
      _mockIsForum: false,
      _mockThreadId: 100,
    } as unknown as Context;
    const topicB = {
      from: { id: 12345 },
      chat: { id: 67890, type: "private" },
      _mockIsForum: false,
      _mockThreadId: 200,
    } as unknown as Context;

    const scopeA = extractTelegramConversationScopeFromContext(topicA);
    const scopeB = extractTelegramConversationScopeFromContext(topicB);
    expect(scopeA!.messageThreadId).toBe(100);
    expect(scopeB!.messageThreadId).toBe(200);
    expect(scopeA!.messageThreadId).not.toBe(scopeB!.messageThreadId);
  });

  it("keeps messageThreadId for forum chat", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = {
      from: { id: 12345 },
      chat: { id: -1001, type: "supergroup" },
      message: { message_thread_id: 42 },
      _mockIsForum: true,
      _mockThreadId: 42,
    } as unknown as Context;

    const scope = extractTelegramConversationScopeFromContext(ctx);
    expect(scope).toEqual({ userId: 12345, chatId: -1001, messageThreadId: 42 });
  });

  it("sets messageThreadId to 0 for forum main thread (no thread_id)", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = {
      from: { id: 12345 },
      chat: { id: -1001, type: "supergroup" },
      _mockIsForum: true,
      _mockThreadId: undefined,
    } as unknown as Context;

    const scope = extractTelegramConversationScopeFromContext(ctx);
    expect(scope).toEqual({ userId: 12345, chatId: -1001, messageThreadId: 0 });
  });

  it("strips messageThreadId for group chat", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = {
      from: { id: 12345 },
      chat: { id: -1001, type: "group" },
      message: { message_thread_id: 999 },
      _mockIsForum: false,
      _mockThreadId: 999,
    } as unknown as Context;

    const scope = extractTelegramConversationScopeFromContext(ctx);
    expect(scope).toEqual({ userId: 12345, chatId: -1001 });
    expect(scope!.messageThreadId).toBeUndefined();
  });

  it("strips messageThreadId for channel", async () => {
    const { extractTelegramConversationScopeFromContext } = await loadScope();
    const ctx = {
      from: { id: 12345 },
      chat: { id: -1001, type: "channel" },
      message: { message_thread_id: 999 },
      _mockIsForum: false,
      _mockThreadId: 999,
    } as unknown as Context;

    const scope = extractTelegramConversationScopeFromContext(ctx);
    expect(scope).toEqual({ userId: 12345, chatId: -1001 });
    expect(scope!.messageThreadId).toBeUndefined();
  });
});
