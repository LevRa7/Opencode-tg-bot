# Response Streaming And Routing Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix response parsing, eliminate duplicate final messages, guarantee final delivery after reasoning, and isolate parallel Telegram thread sessions.

**Architecture:** Introduce one normalization path for streamed and final text, keep delivery reconciliation state per session, and remove active-thread fallback from already running sessions. The fix stays in the bot/presentation layer and does not leak Telegram concerns into formatting helpers.

**Tech Stack:** TypeScript, Vitest, grammY, Telegram Bot API

---

## File Map

- Modify: `src/summary/aggregator.ts`
- Create: `src/bot/utils/response-normalizer.ts`
- Modify: `src/bot/index.ts`
- Modify: `src/bot/utils/message-draft-stream.ts`
- Modify: `src/bot/utils/finalize-assistant-response.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Test: `tests/bot/utils/response-normalizer.test.ts`
- Test: `tests/summary/aggregator.test.ts`
- Test: `tests/bot/utils/message-draft-stream.test.ts`
- Test: `tests/bot/utils/finalize-assistant-response.test.ts`
- Test: `tests/bot/streaming/session-routing-and-delivery.test.ts`

---

## Task 1: Fix Summary Aggregator Root Causes First

**Files:**
- Modify: `src/summary/aggregator.ts`
- Test: `tests/summary/aggregator.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
it("fires onComplete exactly once for one completed assistant message", () => {
  const onComplete = vi.fn();
  summaryAggregator.setOnComplete(onComplete);
  summaryAggregator.setSession("session-1");

  // Arrange assistant message parts and completed message.updated event.

  expect(onComplete).toHaveBeenCalledTimes(1);
});

it("does not erase session A in-flight state when session B starts", () => {
  const onPartial = vi.fn();
  summaryAggregator.setOnPartial(onPartial);

  summaryAggregator.setSession("session-a");
  // Arrange partial text for session A.
  summaryAggregator.setSession("session-b");
  // Continue session A events.

  expect(onPartial).toHaveBeenCalledWith("session-a", expect.any(String), expect.stringContaining("A"), expect.anything(), expect.anything());
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/summary/aggregator.test.ts`
Expected: FAIL because aggregator is currently single-session and double-calls completion

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:
- remove duplicate `onCompleteCallback` path for one assistant message
- stop calling global `clear()` when switching root sessions if another root session can still emit events
- keep text message state keyed by session and message, not by one global current root session

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/summary/aggregator.test.ts`
Expected: PASS

- [ ] **Step 5: Continue without committing unless user asks**

---

## Task 2: Add Line-By-Line Response Normalizer

**Files:**
- Create: `src/bot/utils/response-normalizer.ts`
- Test: `tests/bot/utils/response-normalizer.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, it } from "vitest";
import { normalizeResponseSnapshot } from "../../../src/bot/utils/response-normalizer.js";

describe("bot/utils/response-normalizer", () => {
  it("normalizes markdown headings line by line into html", () => {
    expect(normalizeResponseSnapshot("## Title\nBody")).toContain("<b>Title</b>");
  });

  it("renders fenced code blocks as preformatted html", () => {
    const result = normalizeResponseSnapshot("```sh\nnpm test\n```");
    expect(result).toContain("<pre>");
    expect(result).toContain("npm test");
  });

  it("does not duplicate repeated adjacent streamed lines", () => {
    const result = normalizeResponseSnapshot("line one\nline one\nline two");
    expect(result).not.toContain("line one\nline one");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/response-normalizer.test.ts`
Expected: FAIL with module/function missing

- [ ] **Step 3: Write minimal implementation**

```typescript
import { escapeHtml } from "./reasoning-format.js";

export function normalizeResponseSnapshot(text: string): string {
  const normalized = text.replace(/\r\n/g, "\n");
  const lines = normalized.split("\n");
  const output: string[] = [];
  let inCodeBlock = false;

  for (const line of lines) {
    if (line.startsWith("```")) {
      output.push(inCodeBlock ? "</pre>" : "<pre>");
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (output[output.length - 1] === line) {
      continue;
    }

    if (inCodeBlock) {
      output.push(escapeHtml(line));
      continue;
    }

    const heading = line.match(/^#{1,6}\s+(.+)$/);
    if (heading) {
      output.push(`<b>${escapeHtml(heading[1])}</b>`);
      continue;
    }

    output.push(escapeHtml(line));
  }

  if (inCodeBlock) {
    output.push("</pre>");
  }

  return output.join("\n");
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/utils/response-normalizer.test.ts`
Expected: PASS

- [ ] **Step 5: Continue without committing unless user asks**

---

## Task 3: Make Draft Streaming Use Normalized Snapshots

**Files:**
- Modify: `src/bot/index.ts`
- Modify: `src/bot/utils/message-draft-stream.ts`
- Test: `tests/bot/utils/message-draft-stream.test.ts`

- [ ] **Step 1: Write the failing tests**

Add tests asserting:

```typescript
it("streams normalized html frames for markdown-like assistant text", async () => {
  const sendMessageDraft = vi.fn().mockResolvedValue(true);
  const manager = new MessageDraftStreamManager(0);

  manager.enqueue("s1", { sendMessageDraft }, { chatId: 1 }, "## Title\n```sh\nnpm test\n```", "html");
  await manager.flushSession("s1");

  expect(sendMessageDraft).toHaveBeenCalledWith(
    1,
    1,
    expect.stringContaining("<pre>"),
    { parse_mode: "HTML" },
  );
});

it("does not send the same html draft frame twice", async () => {
  const sendMessageDraft = vi.fn().mockResolvedValue(true);
  const manager = new MessageDraftStreamManager(0);

  manager.enqueue("s1", { sendMessageDraft }, { chatId: 1 }, "same", "html");
  manager.enqueue("s1", { sendMessageDraft }, { chatId: 1 }, "same", "html");
  await manager.flushSession("s1");

  expect(sendMessageDraft).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/message-draft-stream.test.ts`
Expected: FAIL on normalized HTML expectations

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:
- normalize assistant snapshots before enqueue when reasoning mode uses HTML
- keep html frames stable so identical normalized content is deduplicated
- do not disable final-path state when a draft send fails

Code shape to implement in `src/bot/index.ts`:

```typescript
const normalizedAssistantText = normalizeResponseSnapshot(messageText);
const chunks = formatReasoningForTelegramHtml(
  mode,
  reasoningText || "",
  formattedTechnicals,
  normalizedAssistantText,
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/utils/message-draft-stream.test.ts`
Expected: PASS

- [ ] **Step 5: Continue without committing unless user asks**

---

## Task 4: Prevent Duplicate Final Replies With Payload Signatures

**Files:**
- Modify: `src/bot/utils/finalize-assistant-response.ts`
- Modify: `src/bot/index.ts`
- Test: `tests/bot/utils/finalize-assistant-response.test.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
it("does not send duplicate final response when streamed draft already matches final payload", async () => {
  const sendText = vi.fn().mockResolvedValue(undefined);

  await finalizeAssistantResponse({
    sessionId: "s1",
    messageText: "final",
    chunks: ["final"],
    lastDraftText: "final",
    flushDraftStream: vi.fn().mockResolvedValue(undefined),
    flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
    formatSummary: vi.fn(() => ["final"]),
    formatRawSummary: vi.fn(() => ["final"]),
    resolveFormat: vi.fn(() => "html" as const),
    getReplyKeyboard: vi.fn(() => undefined),
    sendText,
  });

  expect(sendText).not.toHaveBeenCalled();
});

it("still sends final response after draft failure state", async () => {
  const sendText = vi.fn().mockResolvedValue(undefined);

  await finalizeAssistantResponse({
    sessionId: "s1",
    messageText: "final",
    draftFailed: true,
    flushDraftStream: vi.fn().mockResolvedValue(undefined),
    flushPendingServiceMessages: vi.fn().mockResolvedValue(undefined),
    formatSummary: vi.fn(() => ["final"]),
    formatRawSummary: vi.fn(() => ["final"]),
    resolveFormat: vi.fn(() => "html" as const),
    getReplyKeyboard: vi.fn(() => undefined),
    sendText,
  });

  expect(sendText).toHaveBeenCalledTimes(1);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/finalize-assistant-response.test.ts`
Expected: FAIL because reconciliation state does not exist yet

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:
- extend options with one delivery-state input, for example:
  - `lastDraftPayloadSignature?: string`
  - `draftFailed?: boolean`
- compute final payload signature from normalized format plus chunks
- skip duplicate final send only when signatures match and `draftFailed !== true`
- still send final response when `draftFailed === true`

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/utils/finalize-assistant-response.test.ts`
Expected: PASS

- [ ] **Step 5: Continue without committing unless user asks**

---

## Task 5: Isolate Session Routing Per Threaded Session

**Files:**
- Modify: `src/bot/index.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Test: `tests/bot/streaming/session-routing-and-delivery.test.ts`

- [ ] **Step 1: Write the failing integration tests**

```typescript
it("keeps two sessions in different message threads fully isolated", async () => {
  // Arrange two sessions with different messageThreadId values.
  // Feed partial and complete events interleaved.
  // Assert sendMessage/sendMessageDraft calls for session A always use thread 101
  // and session B always use thread 202.
});

it("does not silence session A when session B becomes active later", async () => {
  // Start routing for session A.
  // Start routing for session B.
  // Complete session A after B starts.
  // Assert A still delivers final response to its original thread.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/streaming/session-routing-and-delivery.test.ts`
Expected: FAIL because session routing still falls back to active thread context

- [ ] **Step 3: Write minimal implementation**

Implementation requirements:
- once a session routing context is stored, never resolve that running session through active thread fallback
- `getThreadTargetForSession(sessionId)` must prefer explicit stored session target only
- session cleanup must delete only that session routing entry

Minimal target behavior in `src/bot/index.ts`:

```typescript
function getSessionRoutingTarget(sessionId: string) {
  const routing = getSessionRoutingContext(sessionId);
  if (routing) {
    return routing.target;
  }

  return undefined;
}
```

And session start in prompt handler must always call `setPromptRoutingContext(currentSession.id, routingContext)` before background prompt execution.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/streaming/session-routing-and-delivery.test.ts`
Expected: PASS

- [ ] **Step 5: Continue without committing unless user asks**

---

## Task 6: Verify End-To-End Reliability

**Files:**
- Test: existing suites and all modified files above

- [ ] **Step 1: Run targeted suites**

Run: `npm test -- tests/bot/utils/response-normalizer.test.ts tests/bot/utils/message-draft-stream.test.ts tests/bot/utils/finalize-assistant-response.test.ts tests/bot/streaming/session-routing-and-delivery.test.ts`
Expected: PASS

- [ ] **Step 2: Run full test suite**

Run: `npm test`
Expected: PASS

- [ ] **Step 3: Run build**

Run: `npm run build`
Expected: PASS

- [ ] **Step 4: Run lint**

Run: `npm run lint`
Expected: PASS or document tooling issue if lint is currently broken in repo setup

- [ ] **Step 5: Summarize verification evidence for user**

---

## Self-Review

- Spec coverage: plan addresses aggregator root causes, normalization, duplicate final delivery, draft/final reconciliation, and parallel thread isolation.
- Placeholder scan: no TBD or deferred implementation markers remain.
- Type consistency: `normalizeResponseSnapshot`, payload signatures, and draft failure state are named consistently across tasks.
