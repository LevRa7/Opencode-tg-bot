# Response Display Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix response display issues - long messages truncation, incorrect chunk handling

**Architecture:** Changes focus on `reasoning-format.ts` for message splitting and `bot/index.ts` for chunk handling

**Tech Stack:** TypeScript, Vitest, Telegram Bot API

---

## Problem Analysis

### Issue 1: Message Truncation (Mode 3)
- **File:** `src/bot/utils/reasoning-format.ts:200-205`
- **Problem:** When `fullText.length > TELEGRAM_MESSAGE_LIMIT`, text is simply truncated with "..."
- **Expected:** Split into multiple messages with smooth transitions

### Issue 2: Chunk Handling Ignored
- **File:** `src/bot/index.ts:530-537, 589-596`
- **Problem:** Code uses only `chunks[0]`, ignoring additional chunks from `formatReasoningForTelegramHtml`
- **Expected:** Process all chunks, send each as separate message

### Issue 3: Existing Tests Use Wrong Signature
- **File:** `tests/bot/utils/reasoning-format.test.ts`
- **Problem:** Tests use 2-argument call but function expects 4 arguments
- **Expected:** Tests match actual function signature

---

## Important Notes from Senior Review

1. **HTML Splitting Strategy:** Split only at block boundaries, never inside `<blockquote>`
2. **Chunk Sending:** Use `enqueue()` for each chunk, NOT `join()`
3. **Test Signature:** Must use 4 parameters: `(mode, reasoningText, technicals, textPrefix)`

---

## Test Plan

### Task 0: Fix Existing Tests (CRITICAL)

**File:** `tests/bot/utils/reasoning-format.test.ts`

First, fix existing tests to use correct 4-parameter signature:

```typescript
// OLD (broken):
formatReasoningForTelegramHtml("text", "prefix")

// NEW (correct):
formatReasoningForTelegramHtml(
  3,                    // reasoningMode
  "reasoning text",    // reasoningText  
  [],                   // technicals
  "final answer",      // textPrefix
)
```

### Test File: `tests/bot/utils/reasoning-format.test.ts`

Add new tests for message splitting:

```typescript
describe("formatReasoningForTelegramHtml - message splitting", () => {
  it("splits long message into multiple chunks when exceeding limit", () => {
    const longText = "a".repeat(5000);
    const chunks = formatReasoningForTelegramHtml(3, longText, [], "");
    
    // Should return multiple chunks, not single truncated string
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]).not.toContain("...");
  });

  it("each chunk respects message limit of 4096 chars", () => {
    const longText = "b".repeat(8000);
    const chunks = formatReasoningForTelegramHtml(3, longText, [], "");
    
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
    }
  });

  it("does not split inside HTML blockquote tags", () => {
    const longParagraph = "x".repeat(5000);
    const chunks = formatReasoningForTelegramHtml(1, longParagraph, [], "");
    
    // Each chunk should be valid HTML (not mid-tag)
    for (const chunk of chunks) {
      const openCount = (chunk.match(/<blockquote/g) || []).length;
      const closeCount = (chunk.match(/<\/blockquote>/g) || []).length;
      expect(openCount).toBe(closeCount);
    }
  });
});
```

---

## Task 1: Fix Message Splitting in reasoning-format.ts

**Files:**
- Modify: `src/bot/utils/reasoning-format.ts:160-206`

- [ ] **Step 1: Fix existing tests to use correct signature**

Update `tests/bot/utils/reasoning-format.test.ts`:
```typescript
// Change all calls from:
formatReasoningForTelegramHtml("text", "prefix")
// To:
formatReasoningForTelegramHtml(3, "text", [], "prefix")
```

- [ ] **Step 2: Write failing test for message splitting**

```typescript
it("splits long combined message into multiple parts", () => {
  const longReasoning = "Reasoning text".repeat(500);
  const longAnswer = "Answer text".repeat(500);
  const chunks = formatReasoningForTelegramHtml(3, longReasoning, [], longAnswer);
  
  // Current behavior: chunks.length === 1 with truncation
  // Expected: multiple chunks, each under limit
  expect(chunks.length).toBeGreaterThan(1);
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts -t "splits long"`
Expected: FAIL

- [ ] **Step 4: Implement proper message splitting**

Replace lines 200-205 with:
```typescript
// OLD (broken):
if (fullText.length > TELEGRAM_MESSAGE_LIMIT) {
  return [fullText.slice(0, TELEGRAM_MESSAGE_LIMIT - 3) + "..."];
}

// NEW (fixed):
function splitHtmlTextIntoChunks(text: string, maxLength: number): string[] {
  const chunks: string[] = [];
  let remaining = text;
  
  while (remaining.length > maxLength) {
    // Find safe split point - prefer newlines, then spaces
    let splitIndex = remaining.lastIndexOf("\n", maxLength - 100);
    if (splitIndex <= maxLength / 2) {
      splitIndex = remaining.lastIndexOf(" ", maxLength - 100);
    }
    if (splitIndex <= maxLength / 4) {
      splitIndex = maxLength;
    }
    
    chunks.push(remaining.slice(0, splitIndex));
    remaining = remaining.slice(splitIndex).trimStart();
  }
  
  if (remaining) {
    chunks.push(remaining);
  }
  
  return chunks;
}

if (fullText.length > TELEGRAM_MESSAGE_LIMIT) {
  return splitHtmlTextIntoChunks(fullText, TELEGRAM_MESSAGE_LIMIT);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts -t "splits long"`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/bot/utils/reasoning-format.ts tests/bot/utils/reasoning-format.test.ts
git commit -m "fix: proper message splitting for long responses in mode 3"
```

---

## Task 2: Fix Chunk Handling in bot/index.ts

**Files:**
- Modify: `src/bot/index.ts:530-537`
- Modify: `src/bot/index.ts:589-596`

- [ ] **Step 1: Fix setOnPartial chunk handling**

Update lines 530-537:
```typescript
// OLD (broken):
const chunks = formatReasoningForTelegramHtml(mode, reasoningText || "", formattedTechnicals, assistantText);
const textToSend = chunks[0] || assistantText;
messageDraftStreamManager.enqueue(sessionId, botApi, target, textToSend, "html");

// NEW (fixed):
const chunks = formatReasoningForTelegramHtml(mode, reasoningText || "", formattedTechnicals, assistantText);
for (const chunk of chunks) {
  messageDraftStreamManager.enqueue(sessionId, botApi, target, chunk, "html");
}
```

- [ ] **Step 2: Fix setOnComplete chunk handling**

Update lines 589-596:
```typescript
// OLD (broken):
finalText = chunks[0] || assistantText;
finalParseMode = "html";

// NEW (fixed):
// Pass all chunks to finalizeAssistantResponse for proper multi-message sending
```

- [ ] **Step 3: Modify finalizeAssistantResponse to handle multiple chunks**

In `src/bot/utils/finalize-assistant-response.ts`:
```typescript
export async function finalizeAssistantResponse({
  sessionId,
  messageText, // This is now the first chunk
  chunks,      // NEW: all chunks from formatReasoningForTelegramHtml
  // ... rest
}): Promise<boolean> {
  // Send first chunk
  await sendFirstChunk(messageText);
  
  // Send remaining chunks
  if (chunks && chunks.length > 1) {
    for (let i = 1; i < chunks.length; i++) {
      await sendText(chunks[i], ...);
    }
  }
}
```

- [ ] **Step 4: Run integration tests**

Run: `npm test -- tests/bot/streaming/`
Expected: All streaming tests pass

- [ ] **Step 5: Commit**

```bash
git add src/bot/index.ts src/bot/utils/finalize-assistant-response.ts
git commit -m "fix: process all chunks from formatReasoningForTelegramHtml"
```

---

## Task 3: Integration Testing

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All tests pass

- [ ] **Step 2: Run lint and typecheck**

Run: `npm run lint && npm run build`
Expected: No errors

---

## Summary

| Task | File | Issue | Fix |
|------|------|-------|-----|
| 0 | reasoning-format.test.ts | Wrong test signature | Fix to 4 params |
| 1 | reasoning-format.ts | Truncation | Implement `splitHtmlTextIntoChunks()` |
| 2 | bot/index.ts | Single chunk usage | Process all chunks via enqueue |
| 3 | - | Verification | Run full test suite |
