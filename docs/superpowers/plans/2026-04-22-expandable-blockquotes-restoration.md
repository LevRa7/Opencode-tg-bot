# Expandable Blockquotes Restoration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restore `<blockquote expandable>` as the canonical Telegram HTML wrapper for reasoning and thinking messages, including progressive draft frames.

**Architecture:** Revert the recent regression only in the code paths that generate or progressively stream reasoning/thinking HTML. Keep the rendering pipeline otherwise unchanged, but ensure helper logic that parses or splits quoted HTML recognizes the expandable wrapper consistently.

**Tech Stack:** TypeScript, Vitest, grammY, Telegram Bot API HTML formatting.

---

### Task 1: Restore expandable blockquotes in reasoning and thinking builders

**Files:**
- Modify: `src/bot/utils/reasoning-format.ts`
- Modify: `src/bot/utils/thinking-message.ts`
- Test: `tests/bot/utils/reasoning-format.test.ts`
- Test: `tests/bot/utils/thinking-message.test.ts`

- [ ] **Step 1: Update the failing expectations to require expandable blockquotes**

```typescript
// In tests/bot/utils/reasoning-format.test.ts
it("always uses expandable blockquote when reasoning is shown", () => {
  const [result] = formatReasoningForTelegramHtml(1, "Short reasoning", [], "Answer");

  expect(result).toContain("<blockquote expandable>");
  expect(result).not.toContain("<blockquote>Short reasoning");
});

it("keeps thinking text as visible answer outside the spoiler", () => {
  const [result] = formatReasoningForTelegramHtml(2, "Reasoning body", [], "💭 Thinking...");

  expect(result.startsWith("💭 Thinking...")).toBe(true);
  expect(result).toContain("<blockquote expandable>");
  expect((result.match(/💭 Thinking\.\.\./g) ?? []).length).toBe(1);
});

it("wraps tool call text in expandable blockquote", () => {
  const result = formatToolCallAsSpoiler('💻 "bash" `ls -la`');

  expect(result).toBe("<blockquote expandable>💻 &quot;bash&quot; `ls -la`</blockquote>");
});

// In tests/bot/utils/thinking-message.test.ts
it("builds a full thinking html payload with separate title and expandable body quotes", () => {
  const html = buildThinkingMessageHtml("Thinking...", "**Plan**\n\nNeed to verify formatting.");

  expect(html).toBe(
    "<blockquote><b>Thinking...</b></blockquote>\n\n<blockquote expandable><b>Plan</b>\n\n<i><b>Need to verify formatting.</b></i></blockquote>",
  );
});

it("formats thinking message with reasoning content as expandable quote", () => {
  const result = formatThinkingMessageWithReasoning("Думаю...", "First step\n\nSecond step");

  expect(result.format).toBe("html");
  expect(result.text).toContain("<blockquote><b>Думаю...</b></blockquote>");
  expect(result.text).toContain("<blockquote expandable>");
  expect(result.text).toContain("First step");
  expect(result.text).toContain("Second step");
});
```

- [ ] **Step 2: Run the focused tests to verify RED**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts tests/bot/utils/thinking-message.test.ts`
Expected: FAIL because the current implementation still emits plain `<blockquote>` in reasoning/thinking wrappers.

- [ ] **Step 3: Restore expandable wrappers in the production builders**

```typescript
// In src/bot/utils/reasoning-format.ts
export function formatToolCallAsSpoiler(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) {
    return "";
  }

  return `<blockquote expandable>${escapeHtml(trimmed)}</blockquote>`;
}

export function formatReasoningForTelegramHtml(
  reasoningMode: number,
  reasoningText: string,
  technicals: Array<{ description: string; command?: string }>,
  textPrefix: string = "",
): string[] {
  let spoilerContentHtml = "";

  if (reasoningMode >= 1 && reasoningText) {
    spoilerContentHtml += formatReasoningBlock(reasoningText);
  }

  if (reasoningMode >= 2 && technicals.length > 0) {
    for (const tech of technicals) {
      if (spoilerContentHtml) spoilerContentHtml += "\n\n";
      spoilerContentHtml += formatTechnicalBlock(tech.description, tech.command);
    }
  }

  if (!spoilerContentHtml) {
    return [textPrefix];
  }

  const spoilerHtml = `<blockquote expandable>${spoilerContentHtml}</blockquote>`;

  if (textPrefix) {
    const fullText = `${textPrefix}\n\n${spoilerHtml}`;
    if (fullText.length <= TELEGRAM_MESSAGE_LIMIT) {
      return [fullText];
    }
    return splitTextIntoChunks(fullText, TELEGRAM_MESSAGE_LIMIT);
  }

  if (spoilerHtml.length <= TELEGRAM_MESSAGE_LIMIT) {
    return [spoilerHtml];
  }

  return splitTextIntoChunks(spoilerHtml, TELEGRAM_MESSAGE_LIMIT);
}

// In src/bot/utils/thinking-message.ts
export function buildThinkingMessageHtml(title: string, reasoningText: string): string {
  const renderedReasoning = formatReasoningBlock(reasoningText);
  if (!renderedReasoning) {
    return `<blockquote><b>${escapeHtml(title)}</b></blockquote>`;
  }

  return `<blockquote><b>${escapeHtml(title)}</b></blockquote>\n\n<blockquote expandable>${renderedReasoning}</blockquote>`;
}
```

- [ ] **Step 4: Run the focused tests to verify GREEN**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts tests/bot/utils/thinking-message.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the focused restore**

```bash
git add src/bot/utils/reasoning-format.ts src/bot/utils/thinking-message.ts tests/bot/utils/reasoning-format.test.ts tests/bot/utils/thinking-message.test.ts
git commit -m "fix: restore expandable reasoning and thinking quotes"
```

---

### Task 2: Restore expandable blockquotes in draft-effect HTML frame generation

**Files:**
- Modify: `src/bot/utils/send-message-draft-effect.ts`
- Test: `tests/bot/utils/send-message-draft-effect.test.ts`

- [ ] **Step 1: Update the draft-effect test to require expandable HTML frames**

```typescript
// In tests/bot/utils/send-message-draft-effect.test.ts
it("streams html reasoning messages as progressively parsed html frames", async () => {
  const sendMessageDraft = vi.fn().mockResolvedValue(true);
  const manager = new SendMessageDraftEffectManager();

  await manager.play(
    { sendMessageDraft },
    {
      chat_id: 123,
      text: "💭 Thinking...\n\n<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>",
      parse_mode: "HTML",
    },
  );

  expect(sendMessageDraft).toHaveBeenCalledTimes(2);
  expect(sendMessageDraft.mock.calls[0][2]).toBe(
    "💭 Thinking...\n\n<blockquote expandable><b>Title</b></blockquote>",
  );
  expect(sendMessageDraft.mock.calls[0][3]).toEqual({ parse_mode: "HTML" });
  expect(sendMessageDraft.mock.calls[1][2]).toBe(
    "💭 Thinking...\n\n<blockquote expandable><b>Title</b>\n\n<i>Body text</i></blockquote>",
  );
});
```

- [ ] **Step 2: Run the focused draft-effect test to verify RED**

Run: `npm test -- tests/bot/utils/send-message-draft-effect.test.ts`
Expected: FAIL because the current matcher and generated frames still use plain `<blockquote>`.

- [ ] **Step 3: Restore expandable parsing and frame generation in the draft effect**

```typescript
// In src/bot/utils/send-message-draft-effect.ts
function buildHtmlDraftFrames(text: string): string[] {
  const normalized = text.trim();
  if (!normalized) {
    return [];
  }

  const blockquoteMatch = normalized.match(
    /^(?<prefix>[\s\S]*?)<blockquote expandable>(?<body>[\s\S]*)<\/blockquote>$/,
  );

  if (!blockquoteMatch?.groups) {
    return [
      normalized.length > TELEGRAM_MESSAGE_LIMIT
        ? normalized.slice(0, TELEGRAM_MESSAGE_LIMIT)
        : normalized,
    ];
  }

  const prefix = blockquoteMatch.groups.prefix.trimEnd();
  const body = blockquoteMatch.groups.body.trim();
  const bodySections = body
    .split(/\n\n+/)
    .map((section) => section.trim())
    .filter(Boolean);

  if (bodySections.length === 0) {
    return [normalized];
  }

  const frames: string[] = [];
  for (let index = 0; index < bodySections.length; index += 1) {
    const renderedBody = bodySections.slice(0, index + 1).join("\n\n");
    const frame = `${prefix}\n\n<blockquote expandable>${renderedBody}</blockquote>`;
    frames.push(
      frame.length > TELEGRAM_MESSAGE_LIMIT ? frame.slice(0, TELEGRAM_MESSAGE_LIMIT) : frame,
    );
  }

  return Array.from(new Set(frames));
}
```

- [ ] **Step 4: Run the focused draft-effect test to verify GREEN**

Run: `npm test -- tests/bot/utils/send-message-draft-effect.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the draft-effect restore**

```bash
git add src/bot/utils/send-message-draft-effect.ts tests/bot/utils/send-message-draft-effect.test.ts
git commit -m "fix: restore expandable draft reasoning frames"
```

---

### Task 3: Preserve expandable wrappers in long streamed HTML chunks

**Files:**
- Modify: `src/bot/streaming/tool-call-streamer.ts`
- Test: `tests/bot/streaming/tool-call-streamer.test.ts`

- [ ] **Step 1: Add a failing test for splitting long expandable blockquotes without dropping the wrapper**

```typescript
// In tests/bot/streaming/tool-call-streamer.test.ts
it("keeps expandable blockquote wrappers when splitting long streamed HTML tool text", async () => {
  vi.useFakeTimers();

  let nextMessageId = 200;
  const sendText = vi.fn(async () => nextMessageId++);
  const editText = vi.fn().mockResolvedValue(undefined);
  const deleteText = vi.fn().mockResolvedValue(undefined);
  const streamer = new ToolCallStreamer({
    throttleMs: 0,
    sendText,
    editText,
    deleteText,
  });

  streamer.append(
    "s1",
    `<blockquote expandable>${"x".repeat(4500)}</blockquote>`,
  );

  await vi.waitFor(() => {
    expect(sendText).toHaveBeenCalled();
  });

  for (const [, text] of sendText.mock.calls as Array<[string, string]>) {
    expect(text.startsWith("<blockquote expandable>")).toBe(true);
    expect(text.endsWith("</blockquote>")).toBe(true);
  }
});
```

- [ ] **Step 2: Run the focused tool streamer test to verify RED**

Run: `npm test -- tests/bot/streaming/tool-call-streamer.test.ts`
Expected: FAIL because `splitLongText` currently only recognizes plain `<blockquote>` wrappers.

- [ ] **Step 3: Teach the splitter to preserve the expandable opening tag**

```typescript
// In src/bot/streaming/tool-call-streamer.ts
function splitLongText(text: string, limit: number): string[] {
  if (text.length <= limit) {
    return [text];
  }

  const blockquoteMatch = text.match(
    /^(<blockquote(?: expandable)?\>)([\s\S]*?)(<\/blockquote>)$/,
  );
  if (blockquoteMatch) {
    const openTag = blockquoteMatch[1];
    const innerContent = blockquoteMatch[2];
    const closeTag = blockquoteMatch[3];

    if (innerContent.length <= limit - openTag.length - closeTag.length) {
      return [text];
    }

    const innerLimit = limit - openTag.length - closeTag.length;
    const innerChunks = splitLongText(innerContent, innerLimit);
    return innerChunks.map((chunk) => `${openTag}${chunk}${closeTag}`);
  }

  const chunks: string[] = [];
  let remaining = text;

  while (remaining.length > limit) {
    let splitIndex = remaining.lastIndexOf("\n", limit);
    if (splitIndex <= 0 || splitIndex < Math.floor(limit * 0.5)) {
      splitIndex = limit;
    }

    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).replace(/^\n+/, "");
  }

  if (remaining.length > 0) {
    chunks.push(remaining);
  }

  return chunks;
}
```

- [ ] **Step 4: Run the focused tool streamer test to verify GREEN**

Run: `npm test -- tests/bot/streaming/tool-call-streamer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the splitter compatibility fix**

```bash
git add src/bot/streaming/tool-call-streamer.ts tests/bot/streaming/tool-call-streamer.test.ts
git commit -m "fix: preserve expandable quotes in streamed chunks"
```

---

### Task 4: Run full verification and prepare Git sync

**Files:**
- Modify: `tests/bot/utils/reasoning-format.test.ts`
- Modify: `tests/bot/utils/thinking-message.test.ts`
- Modify: `tests/bot/utils/send-message-draft-effect.test.ts`
- Modify: `tests/bot/streaming/tool-call-streamer.test.ts`
- Modify: `src/bot/utils/reasoning-format.ts`
- Modify: `src/bot/utils/thinking-message.ts`
- Modify: `src/bot/utils/send-message-draft-effect.ts`
- Modify: `src/bot/streaming/tool-call-streamer.ts`

- [ ] **Step 1: Run all targeted tests together**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts tests/bot/utils/thinking-message.test.ts tests/bot/utils/send-message-draft-effect.test.ts tests/bot/streaming/tool-call-streamer.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the full test suite**

Run: `npm test`
Expected: PASS with all Vitest files green.

- [ ] **Step 3: Run type/build verification**

Run: `npm run build`
Expected: TypeScript build succeeds with exit code 0.

- [ ] **Step 4: Run lint verification**

Run: `npm run lint`
Expected: ESLint completes with 0 errors and 0 warnings.

- [ ] **Step 5: Commit the final verified restore**

```bash
git add src/bot/utils/reasoning-format.ts src/bot/utils/thinking-message.ts src/bot/utils/send-message-draft-effect.ts src/bot/streaming/tool-call-streamer.ts tests/bot/utils/reasoning-format.test.ts tests/bot/utils/thinking-message.test.ts tests/bot/utils/send-message-draft-effect.test.ts tests/bot/streaming/tool-call-streamer.test.ts docs/superpowers/specs/2026-04-22-expandable-blockquotes-design.md docs/superpowers/plans/2026-04-22-expandable-blockquotes-restoration.md
git commit -m "fix: restore expandable blockquote formatting"
```
