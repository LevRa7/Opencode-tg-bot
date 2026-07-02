import { describe, expect, it } from "vitest";
import {
  createForwardedSourceTag,
  extractMessageMetadata,
  formatMetadataLine,
  type ForwardedSourceInfo,
} from "../../src/media/batch-types.js";
import type { Context } from "grammy";

function makeCtx(overrides: Record<string, unknown> = {}): Context {
  const msg: Record<string, unknown> = {
    message_id: 100,
    from: { id: 6931112349, is_bot: false, first_name: "Лев" },
    chat: { id: 6931112349, type: "private" },
    date: Math.floor(Date.now() / 1000),
    ...overrides,
  };
  return { message: msg, update: { update_id: 1, message: msg } } as unknown as Context;
}

const t = (key: string, params?: Record<string, string | number>): string => {
  if (key === "deferred.forwarded.from_display")
    return `[Переслано от: ${params?.displayName ?? "?"}]`;
  if (key === "deferred.forwarded.from_another_user")
    return "[Переслано от другого пользователя]";
  if (key === "deferred.forwarded.generic") return "[Пересланное сообщение]";
  return key;
};

// ── createForwardedSourceTag ──

describe("createForwardedSourceTag", () => {
  it("returns generic tag when source is undefined", () => {
    expect(createForwardedSourceTag(undefined, t)).toBe("[Пересланное сообщение]");
  });

  it("returns display name tag when displayName is provided", () => {
    const source: ForwardedSourceInfo = { displayName: "Иван Петров" };
    expect(createForwardedSourceTag(source, t)).toBe("[Переслано от: Иван Петров]");
  });

  it("returns display name with trimmed whitespace", () => {
    const source: ForwardedSourceInfo = { displayName: "  Анна  " };
    expect(createForwardedSourceTag(source, t)).toBe("[Переслано от: Анна]");
  });

  it("returns empty display name tag when displayName is empty string", () => {
    const source: ForwardedSourceInfo = { displayName: "" };
    // empty displayName -> createForwardedSourceTag checks source?.displayName?.trim()
    // which is falsy, so it falls through
    expect(createForwardedSourceTag(source, t)).toBe("[Пересланное сообщение]");
  });

  it("returns 'from another user' when isFromAnotherUser is true and no displayName", () => {
    const source: ForwardedSourceInfo = { isFromAnotherUser: true };
    expect(createForwardedSourceTag(source, t)).toBe(
      "[Переслано от другого пользователя]",
    );
  });

  it("prefers displayName over isFromAnotherUser", () => {
    const source: ForwardedSourceInfo = {
      displayName: "Мария",
      isFromAnotherUser: true,
    };
    expect(createForwardedSourceTag(source, t)).toBe("[Переслано от: Мария]");
  });

  it("returns generic when isFromAnotherUser is false and no displayName", () => {
    const source: ForwardedSourceInfo = { isFromAnotherUser: false };
    expect(createForwardedSourceTag(source, t)).toBe("[Пересланное сообщение]");
  });
});

// ── extractMessageMetadata ──

describe("extractMessageMetadata", () => {
  it("returns undefined when context has no message", () => {
    const ctx = { message: undefined } as unknown as Context;
    expect(extractMessageMetadata(ctx)).toBeUndefined();
  });

  it("extracts basic sender metadata", () => {
    const ctx = makeCtx({
      from: {
        id: 111,
        is_bot: false,
        first_name: "Alice",
        last_name: "Smith",
        username: "asmith",
        language_code: "en",
      },
      text: "hello",
    });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.senderFirstName).toBe("Alice");
    expect(meta.senderLastName).toBe("Smith");
    expect(meta.senderUsername).toBe("asmith");
    expect(meta.senderId).toBe(111);
    expect(meta.messageId).toBe(100);
    expect(meta.languageCode).toBe("en");
  });

  it("extracts forward_origin user metadata", () => {
    const ctx = makeCtx({
      text: "forwarded",
      forward_origin: {
        type: "user",
        sender_user: {
          id: 999,
          first_name: "Bob",
          last_name: "Jones",
          username: "bjones",
          is_bot: false,
        },
      },
      forward_date: Math.floor(Date.now() / 1000),
    });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.forwardFromName).toBe("Bob Jones");
    expect(meta.forwardFromId).toBe(999);
    expect(meta.forwardFromUsername).toBe("bjones");
  });

  it("extracts forward_origin channel metadata", () => {
    const ctx = makeCtx({
      text: "from channel",
      forward_origin: {
        type: "channel",
        chat: {
          id: -1001234567890,
          type: "channel",
          title: "Tech News",
          username: "technews",
        },
        message_id: 555,
      },
    });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.forwardFromName).toBe("Tech News");
    expect(meta.forwardFromUsername).toBe("technews");
    expect(meta.forwardFromId).toBeUndefined();
  });

  it("extracts forward_origin chat (group) metadata", () => {
    const ctx = makeCtx({
      text: "from group",
      forward_origin: {
        type: "chat",
        sender_chat: {
          id: -1009876543210,
          type: "group",
          title: "Dev Chat",
          username: "devchat",
        },
        message_id: 42,
      },
    });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.forwardFromName).toBe("Dev Chat");
    expect(meta.forwardFromUsername).toBe("devchat");
  });

  it("extracts forward_origin hidden_user metadata", () => {
    const ctx = makeCtx({
      text: "anonymous forward",
      forward_origin: {
        type: "hidden_user",
        sender_user_name: "Аноним",
      },
    });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.forwardFromName).toBe("Аноним");
    expect(meta.forwardFromId).toBeUndefined();
  });

  it("returns undefined forward fields when no forward_origin", () => {
    const ctx = makeCtx({ text: "regular message" });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.forwardFromName).toBeUndefined();
    expect(meta.forwardFromId).toBeUndefined();
    expect(meta.forwardFromUsername).toBeUndefined();
  });

  it("extracts sender with only first_name", () => {
    const ctx = makeCtx({
      from: { id: 1, is_bot: false, first_name: "Single" },
      text: "hi",
    });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.senderFirstName).toBe("Single");
    expect(meta.senderLastName).toBeUndefined();
  });

  it("captures message timestamp", () => {
    const ts = Math.floor(Date.now() / 1000);
    const ctx = makeCtx({ text: "ts test", date: ts });
    const meta = extractMessageMetadata(ctx)!;
    expect(meta.timestamp).toBe(ts);
  });
});

// ── formatMetadataLine ──

describe("formatMetadataLine", () => {
  it("returns label when metadata is undefined", () => {
    expect(formatMetadataLine(undefined, "prefix")).toBe("prefix");
  });

  it("returns label when metadata has no relevant fields", () => {
    const meta = {
      liveLocationTag: undefined,
      movementTag: undefined,
      senderFirstName: undefined,
      senderLastName: undefined,
      timestamp: undefined,
      languageCode: undefined,
      forwardFromName: undefined,
      forwardFromId: undefined,
      forwardFromUsername: undefined,
    };
    expect(formatMetadataLine(meta, "hello")).toBe("hello");
  });

  it("adds sender name tag", () => {
    const meta = {
      senderFirstName: "John",
      senderLastName: "Doe",
    };
    const result = formatMetadataLine(meta, "");
    expect(result).toContain('[name="John Doe"]');
  });

  it("adds forwardFromName tag", () => {
    const meta = {
      forwardFromName: "Alice",
    };
    const result = formatMetadataLine(meta, "");
    expect(result).toContain('[forwarded_at_name="Alice"]');
  });

  it("adds language code tag", () => {
    const meta = {
      languageCode: "ru",
    };
    const result = formatMetadataLine(meta, "");
    expect(result).toContain("[RU]");
  });

  it("adds timestamp tag", () => {
    const ts = 1700000000;
    const meta = {
      timestamp: ts,
    };
    const result = formatMetadataLine(meta, "");
    expect(result).toContain("[datetime=");
    expect(result).toContain("UTC");
  });

  it("combines multiple metadata tags", () => {
    const meta = {
      senderFirstName: "Alice",
      senderLastName: "Smith",
      forwardFromName: "Bob",
      languageCode: "en",
    };
    const result = formatMetadataLine(meta, "prompt");
    // Order: name, timestamp (if present), language, forwardFromName
    expect(result).toContain('[name="Alice Smith"]');
    expect(result).toContain("[EN]");
    expect(result).toContain('[forwarded_at_name="Bob"]');
  });

  it("prefixes label when provided", () => {
    const meta = {
      senderFirstName: "Test",
    };
    const result = formatMetadataLine(meta, "Message:");
    expect(result).toContain("Message:");
    expect(result).toContain('[name="Test"]');
  });
});
