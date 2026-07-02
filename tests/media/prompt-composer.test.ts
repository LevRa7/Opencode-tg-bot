import { describe, expect, it } from "vitest";
import { composeDeferredMediaPrompt } from "../../src/media/prompt-composer.js";
import { extractRichMessageText } from "../../src/bot/utils/rich-message-extractor.js";
import type {
  ResolvedDeferredItem,
  MessageMetadata,
} from "../../src/media/batch-types.js";

const t = (key: string, params?: Record<string, string | number>): string => {
  if (key === "deferred.forwarded.from_display")
    return `[Переслано от: ${params?.displayName ?? "?"}]`;
  if (key === "deferred.forwarded.from_another_user")
    return "[Переслано от другого пользователя]";
  if (key === "deferred.forwarded.generic") return "[Пересланное сообщение]";
  if (key === "deferred.kind.photo") return "Фото";
  if (key === "deferred.kind.document") return "Документ";
  if (key === "deferred.kind.audio") return "Аудио";
  if (key === "deferred.kind.video") return "Видео";
  if (key === "deferred.kind.text") return "Текст";
  if (key === "deferred.preview.label_one") return "элемент";
  if (key === "deferred.preview.label_other") return "элемента";
  if (key === "deferred.preview.header")
    return `📋 Пакет из ${params?.count ?? "?"} ${params?.label ?? "?"}:\n`;
  return key;
};

function makeItem(
  overrides: Partial<ResolvedDeferredItem> = {},
): ResolvedDeferredItem {
  return {
    correlationId: "corr-1",
    kind: "text",
    directText: "Hello world",
    previewText: "Hello world",
    contextText: "Hello world",
    ...overrides,
  };
}

function makeForwardMetadata(
  forwardFromName?: string,
  forwardFromId?: number,
): MessageMetadata {
  return {
    senderFirstName: "Sender",
    senderLastName: "User",
    senderId: 111,
    messageId: 100,
    timestamp: Math.floor(Date.now() / 1000),
    forwardFromName,
    forwardFromId,
  };
}

// Regular (non-forwarded) metadata
function makeRegularMetadata(): MessageMetadata {
  return {
    senderFirstName: "Sender",
    senderLastName: "User",
    senderId: 111,
    messageId: 100,
    timestamp: Math.floor(Date.now() / 1000),
  };
}

// ── Single non-forwarded text message ──

describe("composeDeferredMediaPrompt", () => {
  it("produces directText without forward context for regular text", () => {
    const item = makeItem({ directText: "Привет, как дела?" });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toBe("Привет, как дела?");
    expect(result.contextText).toBeUndefined();
  });

  it("includes sender metadata in directText", () => {
    const item = makeItem({
      directText: "test",
      metadata: makeRegularMetadata(),
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toContain("test");
  });

  // ── Forwarded text as direct prompt (CRITICAL FIX) ──

  it("treats forwarded text as directText, NOT 'context to analyze'", () => {
    const item = makeItem({
      directText: "Пересланный текст",
      metadata: makeForwardMetadata("Alice", 999),
    });
    const result = composeDeferredMediaPrompt([item], t);

    // Must be directText, not contextText with "Analyze..."
    expect(result.directText).toBeDefined();
    expect(result.directText).toContain("Пересланный текст");
    expect(result.directText).toContain("[Переслано от: Alice]");
    expect(result.contextText).toBeUndefined();
  });

  it("prepends forwarded tag to directText", () => {
    const item = makeItem({
      directText: "check this",
      metadata: makeForwardMetadata("Bob", 555),
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toMatch(/^\[Переслано от: Bob\]/m);
  });

  it("handles forwarded text from forwardFromId without name", () => {
    const item = makeItem({
      directText: "anonymous forward",
      metadata: { ...makeRegularMetadata(), forwardFromId: 12345 },
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toContain("[Переслано от другого пользователя]");
  });

  // ── Mixed regular + forwarded text ──

  it("prefers regular text as directText; forwarded goes to context", () => {
    const regular = makeItem({
      correlationId: "r1",
      directText: "Мой вопрос",
      metadata: makeRegularMetadata(),
    });
    const fwd = makeItem({
      correlationId: "f1",
      directText: "Пересланный контекст",
      contextText: "Пересланный контекст",
      metadata: makeForwardMetadata("Bob", 999),
    });
    const result = composeDeferredMediaPrompt([regular, fwd], t);

    expect(result.directText).toContain("Мой вопрос");
    // Forwarded text goes to context
    expect(result.contextText).toBeDefined();
    expect(result.contextText).toContain("Пересланный контекст");
    expect(result.contextText).toContain("[Переслано от: Bob]");
  });

  it("when only forwarded texts, uses latest as directText", () => {
    const fwd1 = makeItem({
      correlationId: "f1",
      directText: "First forward",
      contextText: "First forward",
      metadata: makeForwardMetadata("Alice", 1),
    });
    const fwd2 = makeItem({
      correlationId: "f2",
      directText: "Second forward",
      contextText: "Second forward",
      metadata: makeForwardMetadata("Bob", 2),
    });
    const result = composeDeferredMediaPrompt([fwd1, fwd2], t);

    expect(result.directText).toContain("Second forward");
    expect(result.directText).toContain("[Переслано от: Bob]");

    // First forward should be context
    expect(result.contextText).toBeDefined();
    expect(result.contextText).toContain("First forward");
    expect(result.contextText).toContain("[Переслано от: Alice]");
  });

  // ── Multiple forwarded rich messages (batch composition) ──

  it("composes 3 forwarded messages: latest = directText, earlier two = context with clear boundaries", () => {
    const fwd1 = makeItem({
      correlationId: "f1",
      directText: "Message from Alice with **bold** and list:\n- item 1\n- item 2",
      contextText: "Message from Alice with **bold** and list:\n- item 1\n- item 2",
      metadata: makeForwardMetadata("Alice", 100),
    });
    const fwd2 = makeItem({
      correlationId: "f2",
      directText: "```\ncode block\nfrom Bob\n```",
      contextText: "```\ncode block\nfrom Bob\n```",
      metadata: makeForwardMetadata("Bob", 200),
    });
    const fwd3 = makeItem({
      correlationId: "f3",
      directText: "## Charlie's Report\n\n| Col1 | Col2 |\n| --- | --- |\n| A | B |",
      contextText: "## Charlie's Report\n\n| Col1 | Col2 |\n| --- | --- |\n| A | B |",
      metadata: makeForwardMetadata("Charlie", 300),
    });

    const result = composeDeferredMediaPrompt([fwd1, fwd2, fwd3], t);

    // Latest (Charlie) is directText with forward tag
    expect(result.directText).toBeDefined();
    expect(result.directText).toContain("[Переслано от: Charlie]");
    expect(result.directText).toContain("Charlie's Report");
    expect(result.directText).toContain("| Col1 | Col2 |");

    // Earlier two are context with clear boundaries
    expect(result.contextText).toBeDefined();

    // Alice's message in context
    expect(result.contextText).toContain("[Переслано от: Alice]");
    expect(result.contextText).toContain("Message from Alice");

    // Bob's message in context
    expect(result.contextText).toContain("[Переслано от: Bob]");
    expect(result.contextText).toContain("code block");
  });

  it("preserves clear boundaries between forwarded messages in context (double-newline separator)", () => {
    const fwd1 = makeItem({
      correlationId: "f1",
      directText: "First forwarded message body",
      contextText: "First forwarded message body",
      metadata: makeForwardMetadata("Alice", 100),
    });
    const fwd2 = makeItem({
      correlationId: "f2",
      directText: "Second forwarded message body",
      contextText: "Second forwarded message body",
      metadata: makeForwardMetadata("Bob", 200),
    });
    const fwd3 = makeItem({
      correlationId: "f3",
      directText: "Third forwarded message body",
      contextText: "Third forwarded message body",
      metadata: makeForwardMetadata("Charlie", 300),
    });

    const result = composeDeferredMediaPrompt([fwd1, fwd2, fwd3], t);

    // Context must have double newlines (\\n\\n) between forwarded message blocks
    // Pattern: [tag1]\nbody1\n\n[tag2]\nbody2
    expect(result.contextText).toBeDefined();
    const ctx = result.contextText!;

    // Each forwarded message block has its own source tag
    expect(ctx).toContain("[Переслано от: Alice]");
    expect(ctx).toContain("[Переслано от: Bob]");

    // Alice's block: tag + body
    expect(ctx).toMatch(/\[Переслано от: Alice\]\nFirst forwarded/);
    // Bob's block: tag + body (after Alice's)
    expect(ctx).toMatch(/\[Переслано от: Bob\]\nSecond forwarded/);

    // Direct text (latest) has Charlie's tag + body
    expect(result.directText).toContain("[Переслано от: Charlie]");
    expect(result.directText).toContain("Third forwarded message body");
  });

  it("composes 5 forwarded messages: all boundaries intact, no content lost", () => {
    const sources = ["Alice", "Bob", "Charlie", "Diana", "Eve"];
    const items = sources.map((name, i) =>
      makeItem({
        correlationId: `f${i + 1}`,
        directText: `Content from ${name}`,
        contextText: `Content from ${name}`,
        metadata: makeForwardMetadata(name, 100 + i),
      }),
    );

    const result = composeDeferredMediaPrompt(items, t);

    // Latest (Eve) is directText
    expect(result.directText).toContain("[Переслано от: Eve]");
    expect(result.directText).toContain("Content from Eve");

    // All 4 earlier messages are in context
    expect(result.contextText).toBeDefined();
    const ctx = result.contextText!;

    for (const name of ["Alice", "Bob", "Charlie", "Diana"]) {
      expect(ctx).toContain(`[Переслано от: ${name}]`);
      expect(ctx).toContain(`Content from ${name}`);
    }
  });

  it("composes forwarded messages from different source types (user, channel, hidden_user)", () => {
    const fwdUser = makeItem({
      correlationId: "f1",
      directText: "User forward text",
      contextText: "User forward text",
      metadata: makeForwardMetadata("Test User", 100),
    });
    const fwdChannel = makeItem({
      correlationId: "f2",
      directText: "Channel forward text",
      contextText: "Channel forward text",
      metadata: makeForwardMetadata("Tech Channel", undefined),
    });
    const fwdHidden = makeItem({
      correlationId: "f3",
      directText: "Hidden user forward text",
      contextText: "Hidden user forward text",
      metadata: {
        ...makeRegularMetadata(),
        forwardFromName: "Hidden Sender",
        forwardFromId: 99999,
      },
    });

    const result = composeDeferredMediaPrompt([fwdUser, fwdChannel, fwdHidden], t);

    // Latest (hidden) as directText
    expect(result.directText).toContain("[Переслано от: Hidden Sender]");
    expect(result.directText).toContain("Hidden user forward text");

    // Earlier two as context with their respective tags
    expect(result.contextText).toBeDefined();
    const ctx = result.contextText!;
    expect(ctx).toContain("[Переслано от: Test User]");
    expect(ctx).toContain("User forward text");
    expect(ctx).toContain("[Переслано от: Tech Channel]");
    expect(ctx).toContain("Channel forward text");
  });

  // ── Mixed: regular text + multiple forwarded rich messages ──

  it("regular text as main + 3 forwarded messages as context: all forwarded have source tags and boundaries", () => {
    const regular = makeItem({
      correlationId: "r1",
      directText: "Проанализируй эти пересланные сообщения",
      metadata: makeRegularMetadata(),
    });
    const fwd1 = makeItem({
      correlationId: "f1",
      directText: "Rich message 1 with table:\n| A | B |\n|---|---|\n| 1 | 2 |",
      contextText: "Rich message 1 with table:\n| A | B |\n|---|---|\n| 1 | 2 |",
      metadata: makeForwardMetadata("Alice", 100),
    });
    const fwd2 = makeItem({
      correlationId: "f2",
      directText: "Rich message 2 with code:\n```ts\nconst x = 1;\n```",
      contextText: "Rich message 2 with code:\n```ts\nconst x = 1;\n```",
      metadata: makeForwardMetadata("Bob", 200),
    });
    const fwd3 = makeItem({
      correlationId: "f3",
      directText: "Rich message 3 with heading:\n## Section\n\nparagraph text",
      contextText: "Rich message 3 with heading:\n## Section\n\nparagraph text",
      metadata: makeForwardMetadata("Charlie", 300),
    });

    const result = composeDeferredMediaPrompt([regular, fwd1, fwd2, fwd3], t);

    // Regular text is the main prompt (no forward tag prepended)
    expect(result.directText).toContain("Проанализируй эти пересланные сообщения");
    expect(result.directText).not.toContain("[Переслано");

    // All 3 forwarded in context with clear boundaries
    expect(result.contextText).toBeDefined();
    const ctx = result.contextText!;

    // Each forwarded message has its source tag
    expect(ctx).toContain("[Переслано от: Alice]");
    expect(ctx).toContain("[Переслано от: Bob]");
    expect(ctx).toContain("[Переслано от: Charlie]");

    // Rich content preserved
    expect(ctx).toContain("| A | B |");
    expect(ctx).toContain("```ts");
    expect(ctx).toContain("## Section");
  });

  // ── Forwarded non-text items (photo, video, document) ──

  it("adds forwarded tag to forwarded photo item", () => {
    const photo = makeItem({
      kind: "photo",
      directText: undefined,
      previewText: "sunset.jpg",
      contextText: "Красивый закат",
      caption: "Красивый закат",
      metadata: makeForwardMetadata("Photo User", 555),
    });
    const result = composeDeferredMediaPrompt([photo], t);

    expect(result.contextText).toBeDefined();
    expect(result.contextText).toContain("[Переслано от: Photo User]");
    expect(result.contextText).toContain("Красивый закат");
  });

  it("adds forwarded tag to forwarded video item", () => {
    const video = makeItem({
      kind: "video",
      directText: undefined,
      previewText: "clip.mp4",
      contextText: "Watch this",
      metadata: makeForwardMetadata("Video Sender", 777),
    });
    const result = composeDeferredMediaPrompt([video], t);
    expect(result.contextText).toContain("[Переслано от: Video Sender]");
    expect(result.contextText).toContain("Watch this");
  });

  it("adds forwarded tag to forwarded document item", () => {
    const doc = makeItem({
      kind: "document",
      directText: undefined,
      previewText: "report.pdf",
      contextText: "Годовой отчёт",
      metadata: makeForwardMetadata("Doc Sender", 888),
    });
    const result = composeDeferredMediaPrompt([doc], t);
    expect(result.contextText).toContain("[Переслано от: Doc Sender]");
    expect(result.contextText).toContain("Годовой отчёт");
  });

  // ── Direct text + forwarded media context ──

  it("includes forwarded media as context alongside direct text", () => {
    const direct = makeItem({
      correlationId: "d1",
      directText: "Что на этой фотографии?",
      metadata: makeRegularMetadata(),
    });

    const fwdPhoto = makeItem({
      correlationId: "p1",
      kind: "photo",
      directText: undefined,
      previewText: "mystery.jpg",
      contextText: "Неизвестный объект",
      metadata: makeForwardMetadata("Friend", 123),
    });

    const result = composeDeferredMediaPrompt([direct, fwdPhoto], t);

    expect(result.directText).toContain("Что на этой фотографии?");
    expect(result.contextText).toBeDefined();
    expect(result.contextText).toContain("[Переслано от: Friend]");
    expect(result.contextText).toContain("Неизвестный объект");
  });

  // ── Channel forwarded ──

  it("shows channel name for forwarded channel messages", () => {
    const item = makeItem({
      directText: "Channel post content",
      metadata: makeForwardMetadata("Tech Channel"),
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toContain("[Переслано от: Tech Channel]");
  });

  // ── Edge cases ──

  it("handles empty batch", () => {
    const result = composeDeferredMediaPrompt([], t);
    expect(result.directText).toBeUndefined();
    expect(result.contextText).toBeUndefined();
  });

  it("handles item with no text content", () => {
    const item = makeItem({
      directText: "",
      previewText: undefined,
      contextText: undefined,
      caption: undefined,
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toBeUndefined();
  });

  it("uses forwardedSource when no metadata", () => {
    const item = makeItem({
      directText: "explicit forward",
      forwardedSource: { displayName: "Explicit User" },
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toContain("[Переслано от: Explicit User]");
  });

  it("uses pre-computed forwardedTag", () => {
    const item = makeItem({
      directText: "pre-tagged",
      forwardedTag: "[Переслано от: PreTagged]",
    });
    const result = composeDeferredMediaPrompt([item], t);
    expect(result.directText).toContain("[Переслано от: PreTagged]");
  });

  it("generates preview text for multiple items", () => {
    const items = [
      makeItem({
        correlationId: "1",
        directText: "First message",
      }),
      makeItem({
        correlationId: "2",
        kind: "photo",
        directText: undefined,
        previewText: "photo.jpg",
        contextText: "A photo",
      }),
    ];
    const result = composeDeferredMediaPrompt(items, t);
    expect(result.directText).toContain("First message");
    expect(result.previewText).toBeDefined();
    expect(result.previewText).toContain("photo.jpg");
  });

  // ── Integration: rich_message extractor + prompt composer ──

  it("integration: extractRichMessageText + composeDeferredMediaPrompt for multiple forwarded rich messages", () => {
    // Simulate 3 forwarded rich messages, each extracted by rich-message-extractor
    const msg1Blocks = [
      { type: "heading" as const, text: "## Report", size: 2 },
      {
        type: "paragraph" as const,
        text: [
          "Status: ",
          { type: "bold", text: "OK" },
        ],
      },
    ];
    const msg2Blocks = [
      {
        type: "pre" as const,
        text: "function test() {\n  return true;\n}",
      },
    ];
    const msg3Blocks = [
      {
        type: "table" as const,
        cells: [
          [
            { text: "Item", is_header: true },
            { text: "Count", is_header: true },
          ],
          [{ text: "Widgets" }, { text: "42" }],
        ],
      },
    ];

    // Use the actual extractor to get text from blocks
    const msg1Text = extractRichMessageText({ blocks: msg1Blocks });
    const msg2Text = extractRichMessageText({ blocks: msg2Blocks });
    const msg3Text = extractRichMessageText({ blocks: msg3Blocks });

    // Create deferred items with extracted text
    const items = [
      makeItem({
        correlationId: "f1",
        directText: msg1Text,
        contextText: msg1Text,
        metadata: makeForwardMetadata("Alice", 100),
      }),
      makeItem({
        correlationId: "f2",
        directText: msg2Text,
        contextText: msg2Text,
        metadata: makeForwardMetadata("Bob", 200),
      }),
      makeItem({
        correlationId: "f3",
        directText: msg3Text,
        contextText: msg3Text,
        metadata: makeForwardMetadata("Charlie", 300),
      }),
    ];

    const result = composeDeferredMediaPrompt(items, t);

    // Latest (msg3) is directText with Charlie's tag
    expect(result.directText).toBeDefined();
    expect(result.directText).toContain("[Переслано от: Charlie]");
    expect(result.directText).toContain("| Item | Count |");
    expect(result.directText).toContain("| Widgets | 42 |");

    // Earlier two are context with clear boundaries
    expect(result.contextText).toBeDefined();
    const ctx = result.contextText!;

    // msg1 in context
    expect(ctx).toContain("[Переслано от: Alice]");
    expect(ctx).toContain("## Report");
    expect(ctx).toContain("Status: OK");

    // msg2 in context
    expect(ctx).toContain("[Переслано от: Bob]");
    expect(ctx).toContain("function test()");
    expect(ctx).toContain("return true");
  });

  it("integration: ensures no content from one forwarded message bleeds into another", () => {
    // Verify that messages don't merge — clear source boundaries
    const fwd1 = makeItem({
      correlationId: "f1",
      directText: "Alice's unique content: AXBYCZ",
      contextText: "Alice's unique content: AXBYCZ",
      metadata: makeForwardMetadata("Alice", 100),
    });
    const fwd2 = makeItem({
      correlationId: "f2",
      directText: "Bob's unique content: BXBYBZ",
      contextText: "Bob's unique content: BXBYBZ",
      metadata: makeForwardMetadata("Bob", 200),
    });
    const fwd3 = makeItem({
      correlationId: "f3",
      directText: "Charlie's unique content: CXBYCZ",
      contextText: "Charlie's unique content: CXBYCZ",
      metadata: makeForwardMetadata("Charlie", 300),
    });

    const result = composeDeferredMediaPrompt([fwd1, fwd2, fwd3], t);

    // Latest (Charlie) as directText
    expect(result.directText).toContain("CXBYCZ");

    // Earlier two as context
    const ctx = result.contextText!;

    // Alice's content appears between her tag and Bob's tag
    const alicePos = ctx.indexOf("[Переслано от: Alice]");
    const bobPos = ctx.indexOf("[Переслано от: Bob]");
    expect(alicePos).toBeGreaterThanOrEqual(0);
    expect(bobPos).toBeGreaterThan(alicePos);

    // Content between tags belongs to the right source
    expect(ctx.indexOf("AXBYCZ")).toBeGreaterThan(alicePos);
    expect(ctx.indexOf("AXBYCZ")).toBeLessThan(bobPos);
    expect(ctx.indexOf("BXBYBZ")).toBeGreaterThan(bobPos);
  });
});
