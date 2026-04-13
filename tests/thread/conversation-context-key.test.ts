import { describe, expect, it } from "vitest";
import { ConversationContextKey } from "../../src/thread/conversation-context-key.js";

describe("thread/conversation-context-key", () => {
  it("creates a stable key from a scoped conversation", () => {
    const key = ConversationContextKey.fromScope({
      userId: 123,
      chatId: 456,
      messageThreadId: 789,
    });

    expect(key.toString()).toBe("123:456:789");
  });

  it("round-trips scope through string form", () => {
    const key = ConversationContextKey.fromScope({
      userId: 123,
      chatId: -456,
      messageThreadId: 789,
    });

    expect(ConversationContextKey.parse(key.toString())?.toScope()).toEqual({
      userId: 123,
      chatId: -456,
      messageThreadId: 789,
    });
  });

  it("normalizes zero thread ids to undefined", () => {
    const key = ConversationContextKey.parse("123:456:0");

    expect(key?.messageThreadId).toBeUndefined();
    expect(key?.toScope()).toEqual({
      userId: 123,
      chatId: 456,
      messageThreadId: undefined,
    });
  });

  it("parses legacy persisted keys without a user id", () => {
    const key = ConversationContextKey.parse("456:789");

    expect(key?.userId).toBeNull();
    expect(key?.chatId).toBe(456);
    expect(key?.messageThreadId).toBe(789);
    expect(key?.toScope()).toBeNull();
    expect(key?.toTarget()).toEqual({
      chatId: 456,
      messageThreadId: 789,
    });
  });

  it("rejects malformed keys", () => {
    expect(ConversationContextKey.parse("broken")).toBeNull();
    expect(ConversationContextKey.parse("1:2:3:4")).toBeNull();
    expect(ConversationContextKey.parse("1:2:nope")).toBeNull();
  });

  it("compares keys by normalized identity", () => {
    const left = ConversationContextKey.fromScope({
      userId: 123,
      chatId: 456,
      messageThreadId: undefined,
    });
    const right = ConversationContextKey.parse("123:456:0");

    expect(right).not.toBeNull();
    expect(left.equals(right!)).toBe(true);
  });
});
