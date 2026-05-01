# OpenCode Event-Ordered Telegram Delivery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a resilient Telegram delivery pipeline for assistant output that preserves OpenCode event order for durable messages, keeps live updates responsive, survives Telegram `429 retry_after` and send failures, safely chunks long HTML, and preserves readable numbered lists.

**Architecture:** Introduce a session-scoped delivery orchestrator with split `live` and `durable` channels, plus a shared safe Telegram sender. Route assistant-output delivery through this boundary, add parser-aware Telegram HTML chunking, canonicalize numbered lists before chunking, and propagate OpenCode event timestamps/logical-message metadata through the bot pipeline.

**Tech Stack:** TypeScript, Node.js, grammY Telegram API, Vitest, existing Telegram retry helper, existing bot summary/streaming utilities.

---

## File Structure

### New files

- `src/bot/delivery/session-delivery-orchestrator.ts`
  - Session-scoped coordinator for `live` and `durable` assistant-output delivery.
- `src/bot/delivery/safe-telegram-sender.ts`
  - Safe wrappers for assistant-output Telegram send/edit/delete/draft operations with retry-aware behavior.
- `src/bot/utils/telegram-html-chunker.ts`
  - Parser-aware Telegram HTML chunking helpers.
- `tests/bot/delivery/session-delivery-orchestrator.test.ts`
  - Unit tests for durable ordering, arrival tie-breaks, failure isolation, and live/durable dependency behavior.
- `tests/bot/delivery/safe-telegram-sender.test.ts`
  - Unit tests for `429 retry_after`, terminal failures, and wrapped Telegram operations.
- `tests/bot/utils/telegram-html-chunker.test.ts`
  - Unit tests for safe HTML splitting and structural preservation.

### Modified files

- `src/summary/aggregator.ts`
  - Propagate event time and logical-message metadata needed by delivery items.
- `src/bot/assistant-run-state.ts`
  - Track assistant completion timing and delivery state for footer/final message linkage.
- `src/bot/index.ts`
  - Route assistant-output delivery through the orchestrator and safe sender instead of direct sends.
- `src/bot/utils/thinking-draft-lifecycle.ts`
  - Replace ad hoc length splitting with parser-aware chunking and safe sender integration.
- `src/bot/utils/thinking-block-stream.ts`
  - Integrate thinking live/durable delivery with logical-message dependency handling.
- `src/bot/utils/reasoning-format.ts`
  - Canonicalize ordered lists into Telegram-friendly text before HTML chunking.
- `src/bot/utils/telegram-text.ts`
  - Reuse safe sender or expose the minimum plumbing needed for it.
- `tests/bot/index.local-file-follow-up.test.ts`
  - Regression coverage for ordered delivery, footer sequencing, active-draft failures, and rate-limit safety.
- `tests/bot/utils/thinking-draft-lifecycle.test.ts`
  - Regression coverage for long thinking drafts, safe chunking, and failure isolation.
- `CHANGELOG.md`
  - Document user-visible delivery and formatting fixes.
- `PRODUCT.md`
  - Update delivery-related feature bullets to reflect the new guarantees.

## Task 1: Build the session delivery orchestrator

**Files:**

- Create: `src/bot/delivery/session-delivery-orchestrator.ts`
- Test: `tests/bot/delivery/session-delivery-orchestrator.test.ts`

- [ ] **Step 1: Write the failing ordering and dependency tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  SessionDeliveryOrchestrator,
  type DeliveryItem,
} from "../../../src/bot/delivery/session-delivery-orchestrator.js";

describe("bot/delivery/session-delivery-orchestrator", () => {
  it("orders durable items by eventTimeMs then arrivalSeq", async () => {
    const delivered: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "m1",
      kind: "assistant-final",
      channel: "durable",
      eventTimeMs: 20,
      arrivalSeq: 2,
      execute: async () => {
        delivered.push("second");
      },
    });

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "m0",
      kind: "tool",
      channel: "durable",
      eventTimeMs: 10,
      arrivalSeq: 1,
      execute: async () => {
        delivered.push("first");
      },
    });

    await orchestrator.flushSession("s1", "test");

    expect(delivered).toEqual(["first", "second"]);
  });

  it("uses arrivalSeq when durable items have equal eventTimeMs", async () => {
    const delivered: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "m2",
      kind: "subagent",
      channel: "durable",
      eventTimeMs: 30,
      arrivalSeq: 7,
      execute: async () => {
        delivered.push("later-arrival");
      },
    });

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "m1",
      kind: "tool",
      channel: "durable",
      eventTimeMs: 30,
      arrivalSeq: 6,
      execute: async () => {
        delivered.push("earlier-arrival");
      },
    });

    await orchestrator.flushSession("s1", "test");

    expect(delivered).toEqual(["earlier-arrival", "later-arrival"]);
  });

  it("waits for the same logical message live item before durable delivery", async () => {
    const delivered: string[] = [];
    let resolveLive!: () => void;
    const livePromise = new Promise<void>((resolve) => {
      resolveLive = resolve;
    });
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "answer-1",
      kind: "thinking-live",
      channel: "live",
      arrivalSeq: 1,
      execute: async () => {
        delivered.push("live-start");
        await livePromise;
        delivered.push("live-done");
      },
    });

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "answer-1",
      kind: "assistant-final",
      channel: "durable",
      eventTimeMs: 50,
      arrivalSeq: 2,
      waitForLogicalMessageLiveTerminal: true,
      execute: async () => {
        delivered.push("durable");
      },
    });

    await Promise.resolve();
    expect(delivered).toEqual(["live-start"]);

    resolveLive();
    await orchestrator.flushSession("s1", "test");

    expect(delivered).toEqual(["live-start", "live-done", "durable"]);
  });

  it("does not make a durable item wait for unrelated live items", async () => {
    const delivered: string[] = [];
    let resolveUnrelated!: () => void;
    const unrelatedLive = new Promise<void>((resolve) => {
      resolveUnrelated = resolve;
    });
    const orchestrator = new SessionDeliveryOrchestrator();

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "answer-0",
      kind: "thinking-live",
      channel: "live",
      arrivalSeq: 1,
      execute: async () => {
        await unrelatedLive;
        delivered.push("unrelated-live");
      },
    });

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "answer-1",
      kind: "assistant-final",
      channel: "durable",
      eventTimeMs: 40,
      arrivalSeq: 2,
      waitForLogicalMessageLiveTerminal: true,
      execute: async () => {
        delivered.push("durable");
      },
    });

    await orchestrator.flushSession("s1", "test");
    expect(delivered).toEqual(["durable"]);

    resolveUnrelated();
    await orchestrator.flushSession("s1", "cleanup");
  });

  it("continues processing durable items after one item fails", async () => {
    const delivered: string[] = [];
    const orchestrator = new SessionDeliveryOrchestrator({
      onItemError: vi.fn(),
    });

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "m1",
      kind: "tool",
      channel: "durable",
      eventTimeMs: 10,
      arrivalSeq: 1,
      execute: async () => {
        throw new Error("boom");
      },
    });

    orchestrator.enqueue({
      sessionId: "s1",
      logicalMessageId: "m2",
      kind: "assistant-final",
      channel: "durable",
      eventTimeMs: 20,
      arrivalSeq: 2,
      execute: async () => {
        delivered.push("still-runs");
      },
    });

    await orchestrator.flushSession("s1", "test");

    expect(delivered).toEqual(["still-runs"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/delivery/session-delivery-orchestrator.test.ts`
Expected: FAIL because `src/bot/delivery/session-delivery-orchestrator.ts` does not exist yet.

- [ ] **Step 3: Write the minimal orchestrator implementation**

```ts
export type DeliveryChannel = "live" | "durable";

export type LiveDeliveryTerminalState = "applied" | "dropped" | "failed";

export interface DeliveryItem {
  sessionId: string;
  logicalMessageId: string;
  kind: string;
  channel: DeliveryChannel;
  eventTimeMs?: number;
  arrivalSeq: number;
  waitForLogicalMessageLiveTerminal?: boolean;
  execute: () => Promise<void>;
}

interface OrchestratorOptions {
  onItemError?: (item: DeliveryItem, error: unknown) => void;
}

interface SessionState {
  liveTask: Promise<void>;
  durableTask: Promise<void>;
  durableItems: DeliveryItem[];
  liveTerminalByLogicalMessageId: Map<string, Promise<LiveDeliveryTerminalState>>;
  resolveLiveTerminalByLogicalMessageId: Map<string, (state: LiveDeliveryTerminalState) => void>;
}

function compareDurableItems(left: DeliveryItem, right: DeliveryItem): number {
  if (typeof left.eventTimeMs === "number" && typeof right.eventTimeMs === "number") {
    if (left.eventTimeMs !== right.eventTimeMs) {
      return left.eventTimeMs - right.eventTimeMs;
    }
  } else if (typeof left.eventTimeMs === "number") {
    return -1;
  } else if (typeof right.eventTimeMs === "number") {
    return 1;
  }

  return left.arrivalSeq - right.arrivalSeq;
}

export class SessionDeliveryOrchestrator {
  private readonly sessions = new Map<string, SessionState>();
  private readonly onItemError?: OrchestratorOptions["onItemError"];

  constructor(options: OrchestratorOptions = {}) {
    this.onItemError = options.onItemError;
  }

  enqueue(item: DeliveryItem): void {
    const state = this.getOrCreateSessionState(item.sessionId);

    if (item.channel === "live") {
      this.enqueueLiveItem(state, item);
      return;
    }

    state.durableItems.push(item);
    state.durableItems.sort(compareDurableItems);
    state.durableTask = state.durableTask
      .catch(() => undefined)
      .then(() => this.drainDurableQueue(state))
      .catch(() => undefined);
  }

  async flushSession(sessionId: string, _reason: string): Promise<void> {
    const state = this.sessions.get(sessionId);
    if (!state) {
      return;
    }

    await state.liveTask.catch(() => undefined);
    await state.durableTask.catch(() => undefined);
  }

  clearSession(sessionId: string): void {
    this.sessions.delete(sessionId);
  }

  private getOrCreateSessionState(sessionId: string): SessionState {
    const existing = this.sessions.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: SessionState = {
      liveTask: Promise.resolve(),
      durableTask: Promise.resolve(),
      durableItems: [],
      liveTerminalByLogicalMessageId: new Map(),
      resolveLiveTerminalByLogicalMessageId: new Map(),
    };

    this.sessions.set(sessionId, created);
    return created;
  }

  private ensureLiveTerminalPromise(
    state: SessionState,
    logicalMessageId: string,
  ): Promise<LiveDeliveryTerminalState> {
    const existing = state.liveTerminalByLogicalMessageId.get(logicalMessageId);
    if (existing) {
      return existing;
    }

    const promise = new Promise<LiveDeliveryTerminalState>((resolve) => {
      state.resolveLiveTerminalByLogicalMessageId.set(logicalMessageId, resolve);
    });
    state.liveTerminalByLogicalMessageId.set(logicalMessageId, promise);
    return promise;
  }

  private resolveLiveTerminal(
    state: SessionState,
    logicalMessageId: string,
    terminalState: LiveDeliveryTerminalState,
  ): void {
    const resolve = state.resolveLiveTerminalByLogicalMessageId.get(logicalMessageId);
    if (resolve) {
      resolve(terminalState);
      state.resolveLiveTerminalByLogicalMessageId.delete(logicalMessageId);
    }
  }

  private enqueueLiveItem(state: SessionState, item: DeliveryItem): void {
    this.ensureLiveTerminalPromise(state, item.logicalMessageId);
    state.liveTask = state.liveTask
      .catch(() => undefined)
      .then(async () => {
        try {
          await item.execute();
          this.resolveLiveTerminal(state, item.logicalMessageId, "applied");
        } catch (error) {
          this.onItemError?.(item, error);
          this.resolveLiveTerminal(state, item.logicalMessageId, "failed");
        }
      });
  }

  private async drainDurableQueue(state: SessionState): Promise<void> {
    while (state.durableItems.length > 0) {
      const item = state.durableItems.shift();
      if (!item) {
        return;
      }

      if (item.waitForLogicalMessageLiveTerminal) {
        const liveTerminal = state.liveTerminalByLogicalMessageId.get(item.logicalMessageId);
        if (liveTerminal) {
          await liveTerminal.catch(() => "failed");
        }
      }

      try {
        await item.execute();
      } catch (error) {
        this.onItemError?.(item, error);
      }
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/delivery/session-delivery-orchestrator.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/delivery/session-delivery-orchestrator.ts tests/bot/delivery/session-delivery-orchestrator.test.ts
git commit -m "feat: add session delivery orchestrator"
```

## Task 2: Add a safe Telegram sender with retry-aware wrappers

**Files:**

- Create: `src/bot/delivery/safe-telegram-sender.ts`
- Test: `tests/bot/delivery/safe-telegram-sender.test.ts`

- [ ] **Step 1: Write the failing retry and failure-isolation tests**

```ts
import { describe, expect, it, vi } from "vitest";
import {
  createSafeTelegramSender,
  type SafeTelegramSenderContext,
} from "../../../src/bot/delivery/safe-telegram-sender.js";

describe("bot/delivery/safe-telegram-sender", () => {
  it("retries sendMessage when Telegram returns retry_after", async () => {
    const sendMessage = vi
      .fn()
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 1 } })
      .mockResolvedValueOnce({ message_id: 10 });

    const sender = createSafeTelegramSender({
      sendMessage,
      editMessageText: vi.fn(),
      deleteMessage: vi.fn(),
      sendMessageDraft: vi.fn(),
    });

    const result = await sender.sendMessage(
      {
        sessionId: "s1",
        kind: "assistant-final",
        chatId: 123,
      },
      123,
      "hello",
      { disable_notification: true },
    );

    expect(result.message_id).toBe(10);
    expect(sendMessage).toHaveBeenCalledTimes(2);
  });

  it("retries sendMessageDraft when Telegram returns retry_after", async () => {
    const sendMessageDraft = vi
      .fn()
      .mockRejectedValueOnce({ error_code: 429, parameters: { retry_after: 1 } })
      .mockResolvedValueOnce(undefined);

    const sender = createSafeTelegramSender({
      sendMessage: vi.fn(),
      editMessageText: vi.fn(),
      deleteMessage: vi.fn(),
      sendMessageDraft,
    });

    await sender.sendMessageDraft(
      {
        sessionId: "s1",
        logicalMessageId: "answer-1",
        kind: "thinking-live",
        chatId: 123,
      },
      123,
      777,
      "draft",
      { parse_mode: "HTML", disable_notification: true },
    );

    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
  });

  it("rethrows terminal non-rate-limit failures", async () => {
    const sender = createSafeTelegramSender({
      sendMessage: vi.fn().mockRejectedValue(new Error("Bad Request")),
      editMessageText: vi.fn(),
      deleteMessage: vi.fn(),
      sendMessageDraft: vi.fn(),
    });

    await expect(
      sender.sendMessage({ sessionId: "s1", kind: "footer", chatId: 123 }, 123, "x", undefined),
    ).rejects.toThrow("Bad Request");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/delivery/safe-telegram-sender.test.ts`
Expected: FAIL because `src/bot/delivery/safe-telegram-sender.ts` does not exist yet.

- [ ] **Step 3: Write the minimal safe sender implementation**

```ts
import { logger } from "../../utils/logger.js";
import { withTelegramRateLimitRetry } from "../../utils/telegram-rate-limit-retry.js";

export interface SafeTelegramSenderContext {
  sessionId: string;
  kind: string;
  chatId?: number;
  messageThreadId?: number;
  logicalMessageId?: string;
}

interface SafeTelegramSenderDependencies {
  sendMessage: (chatId: number, text: string, options?: unknown) => Promise<{ message_id: number }>;
  editMessageText: (
    chatId: number,
    messageId: number,
    text: string,
    options?: unknown,
  ) => Promise<unknown>;
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
  sendMessageDraft: (
    chatId: number,
    draftId: number,
    text: string,
    options?: unknown,
  ) => Promise<unknown>;
}

export function createSafeTelegramSender(dependencies: SafeTelegramSenderDependencies) {
  const run = async <T>(
    context: SafeTelegramSenderContext,
    operation: () => Promise<T>,
  ): Promise<T> => {
    return withTelegramRateLimitRetry(operation, {
      onRetry: ({ attempt, retryAfterMs, error }) => {
        logger.warn(
          `[SafeTelegramSender] Retry Telegram delivery: session=${context.sessionId}, kind=${context.kind}, attempt=${attempt}, retryAfterMs=${retryAfterMs}`,
          error,
        );
      },
    });
  };

  return {
    async sendMessage(
      context: SafeTelegramSenderContext,
      chatId: number,
      text: string,
      options?: unknown,
    ): Promise<{ message_id: number }> {
      return run(context, () => dependencies.sendMessage(chatId, text, options));
    },

    async editMessageText(
      context: SafeTelegramSenderContext,
      chatId: number,
      messageId: number,
      text: string,
      options?: unknown,
    ): Promise<void> {
      await run(context, () => dependencies.editMessageText(chatId, messageId, text, options));
    },

    async deleteMessage(
      context: SafeTelegramSenderContext,
      chatId: number,
      messageId: number,
    ): Promise<void> {
      await run(context, () => dependencies.deleteMessage(chatId, messageId));
    },

    async sendMessageDraft(
      context: SafeTelegramSenderContext,
      chatId: number,
      draftId: number,
      text: string,
      options?: unknown,
    ): Promise<void> {
      await run(context, () => dependencies.sendMessageDraft(chatId, draftId, text, options));
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/delivery/safe-telegram-sender.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/delivery/safe-telegram-sender.ts tests/bot/delivery/safe-telegram-sender.test.ts
git commit -m "feat: add safe telegram sender"
```

## Task 3: Replace ad hoc HTML splitting with parser-aware chunking

**Files:**

- Create: `src/bot/utils/telegram-html-chunker.ts`
- Modify: `src/bot/utils/thinking-draft-lifecycle.ts`
- Test: `tests/bot/utils/telegram-html-chunker.test.ts`
- Test: `tests/bot/utils/thinking-draft-lifecycle.test.ts`

- [ ] **Step 1: Write the failing HTML chunking tests**

```ts
import { describe, expect, it } from "vitest";
import {
  splitTelegramHtmlIntoChunks,
  takeTelegramHtmlFirstChunk,
} from "../../../src/bot/utils/telegram-html-chunker.js";

describe("bot/utils/telegram-html-chunker", () => {
  it("keeps expandable blockquotes valid across chunks", () => {
    const html = `<blockquote expandable><b>${"A".repeat(5000)}</b></blockquote>`;

    const chunks = splitTelegramHtmlIntoChunks(html, 4096);

    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(4096);
      expect(chunk.startsWith("<blockquote expandable>")).toBe(true);
      expect(chunk.endsWith("</blockquote>")).toBe(true);
    }
  });

  it("preserves nested formatting tags when splitting", () => {
    const html = `<blockquote expandable><i><b>${"B".repeat(5000)}</b></i></blockquote>`;

    const chunks = splitTelegramHtmlIntoChunks(html, 4096);

    for (const chunk of chunks) {
      expect(chunk.includes("<i><b>") || chunk.includes("<b><i>")).toBe(true);
      expect(chunk.includes("</b></i>") || chunk.includes("</i></b>")).toBe(true);
    }
  });

  it("takes a first chunk suitable for active draft rendering", () => {
    const html = `<b>💭 Думаю...</b>\n\n<blockquote expandable>${"C".repeat(5000)}</blockquote>`;
    const firstChunk = takeTelegramHtmlFirstChunk(html, 4096);

    expect(firstChunk.length).toBeLessThanOrEqual(4096);
    expect(firstChunk).toContain("<b>💭 Думаю...</b>");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/telegram-html-chunker.test.ts`
Expected: FAIL because `src/bot/utils/telegram-html-chunker.ts` does not exist yet.

- [ ] **Step 3: Write the minimal parser-aware chunker implementation**

```ts
const SAFE_TELEGRAM_HTML_HEADROOM = 64;

interface Token {
  type: "tag" | "text";
  raw: string;
}

function tokenizeHtml(html: string): Token[] {
  return html
    .split(/(<[^>]+>)/g)
    .filter(Boolean)
    .map((raw) => ({
      type: raw.startsWith("<") ? "tag" : "text",
      raw,
    }));
}

function isClosingTag(raw: string): boolean {
  return /^<\//.test(raw);
}

function getTagName(raw: string): string | null {
  const match = raw.match(/^<\/?([a-z0-9]+)/i);
  return match?.[1]?.toLowerCase() ?? null;
}

function isSelfClosingTag(raw: string): boolean {
  return /\/>$/.test(raw);
}

function reopenTags(tags: string[]): string {
  return tags.join("");
}

function closeTags(tags: string[]): string {
  return [...tags]
    .reverse()
    .map((tag) => {
      const tagName = getTagName(tag);
      return tagName ? `</${tagName}>` : "";
    })
    .join("");
}

export function splitTelegramHtmlIntoChunks(html: string, maxLength: number): string[] {
  if (html.length <= maxLength) {
    return [html];
  }

  const limit = maxLength - SAFE_TELEGRAM_HTML_HEADROOM;
  const tokens = tokenizeHtml(html);
  const chunks: string[] = [];
  let current = "";
  let openTags: string[] = [];

  const flush = () => {
    if (!current) {
      return;
    }
    const closed = `${current}${closeTags(openTags)}`;
    chunks.push(closed);
    current = reopenTags(openTags);
  };

  for (const token of tokens) {
    if (token.type === "tag") {
      const next = `${current}${token.raw}`;
      if (next.length > limit && current) {
        flush();
      }
      current += token.raw;
      const tagName = getTagName(token.raw);
      if (!tagName || isSelfClosingTag(token.raw)) {
        continue;
      }
      if (isClosingTag(token.raw)) {
        const lastIndex = [...openTags].reverse().findIndex((tag) => getTagName(tag) === tagName);
        if (lastIndex !== -1) {
          openTags.splice(openTags.length - 1 - lastIndex, 1);
        }
      } else {
        openTags.push(token.raw);
      }
      continue;
    }

    let remainingText = token.raw;
    while (remainingText) {
      const capacity = Math.max(1, limit - current.length);
      if (remainingText.length <= capacity) {
        current += remainingText;
        remainingText = "";
        continue;
      }

      let splitIndex = remainingText.lastIndexOf("\n", capacity);
      if (splitIndex <= 0 || splitIndex < Math.floor(capacity * 0.5)) {
        splitIndex = remainingText.lastIndexOf(" ", capacity);
      }
      if (splitIndex <= 0) {
        splitIndex = capacity;
      }

      current += remainingText.slice(0, splitIndex);
      remainingText = remainingText.slice(splitIndex).trimStart();
      flush();
    }
  }

  if (current) {
    chunks.push(`${current}${closeTags(openTags)}`);
  }

  return chunks.filter(Boolean);
}

export function takeTelegramHtmlFirstChunk(html: string, maxLength: number): string {
  return splitTelegramHtmlIntoChunks(html, maxLength)[0] ?? "";
}
```

- [ ] **Step 4: Update the thinking draft lifecycle to use the chunker**

```ts
import {
  splitTelegramHtmlIntoChunks,
  takeTelegramHtmlFirstChunk,
} from "./telegram-html-chunker.js";

function truncateTelegramHtml(text: string): string {
  return takeTelegramHtmlFirstChunk(text, TELEGRAM_MESSAGE_LIMIT);
}

function splitTelegramHtml(text: string): string[] {
  return splitTelegramHtmlIntoChunks(text, TELEGRAM_MESSAGE_LIMIT);
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/bot/utils/telegram-html-chunker.test.ts tests/bot/utils/thinking-draft-lifecycle.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add src/bot/utils/telegram-html-chunker.ts src/bot/utils/thinking-draft-lifecycle.ts tests/bot/utils/telegram-html-chunker.test.ts tests/bot/utils/thinking-draft-lifecycle.test.ts
git commit -m "feat: add safe telegram html chunking"
```

## Task 4: Canonicalize numbered lists for Telegram rendering

**Files:**

- Modify: `src/bot/utils/reasoning-format.ts`
- Test: `tests/bot/utils/reasoning-format.test.ts`

- [ ] **Step 1: Write the failing numbered-list tests**

```ts
import { describe, expect, it } from "vitest";
import { formatReasoningForTelegramHtml } from "../../../src/bot/utils/reasoning-format.js";

describe("bot/utils/reasoning-format ordered lists", () => {
  it("preserves numbered list order in Telegram-friendly output", () => {
    const reasoning = [
      "Есть 3 варианта:",
      "",
      "1. Первый вариант",
      "2. Второй вариант",
      "3. Третий вариант",
    ].join("\n");

    const html = formatReasoningForTelegramHtml(1, reasoning);

    expect(html).toContain("1. Первый вариант");
    expect(html).toContain("2. Второй вариант");
    expect(html).toContain("3. Третий вариант");
  });

  it("preserves multiline numbered items without flattening numbering", () => {
    const reasoning = [
      "План:",
      "",
      "1. Первый пункт",
      "   дополнительная строка первого пункта",
      "2. Второй пункт",
    ].join("\n");

    const html = formatReasoningForTelegramHtml(1, reasoning);

    expect(html).toContain("1. Первый пункт");
    expect(html).toContain("дополнительная строка первого пункта");
    expect(html).toContain("2. Второй пункт");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts -t "ordered lists"`
Expected: FAIL because the current formatter does not canonicalize numbered lists for Telegram.

- [ ] **Step 3: Write the minimal numbered-list canonicalization**

```ts
function canonicalizeTelegramOrderedLists(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const normalized: string[] = [];

  for (const line of lines) {
    const orderedMatch = line.match(/^(\s*)(\d+)\.\s+(.*)$/);
    if (!orderedMatch) {
      normalized.push(line);
      continue;
    }

    const indent = orderedMatch[1] ?? "";
    const number = orderedMatch[2] ?? "1";
    const content = orderedMatch[3] ?? "";
    normalized.push(`${indent}${number}. ${content}`);
  }

  return normalized.join("\n");
}

function normalizeReasoning(text: string): string {
  return canonicalizeTelegramOrderedLists(text).trim();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/utils/reasoning-format.test.ts -t "ordered lists"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/utils/reasoning-format.ts tests/bot/utils/reasoning-format.test.ts
git commit -m "fix: preserve numbered lists in telegram output"
```

## Task 5: Thread logical-message metadata and completion timing through the assistant pipeline

**Files:**

- Modify: `src/summary/aggregator.ts`
- Modify: `src/bot/assistant-run-state.ts`
- Modify: `tests/summary/aggregator.test.ts`

- [ ] **Step 1: Write the failing metadata propagation tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { SummaryAggregator } from "../../src/summary/aggregator.js";

describe("summary/aggregator completion metadata", () => {
  it("passes assistant completion time in onComplete metadata", () => {
    const aggregator = new SummaryAggregator();
    const onComplete = vi.fn();
    aggregator.setCurrentSession("session-1");
    aggregator.setOnComplete(onComplete);

    aggregator.processEvent({
      type: "message.updated",
      properties: {
        info: {
          id: "message-1",
          sessionID: "session-1",
          role: "assistant",
          providerID: "openai",
          modelID: "gpt-5.4",
          time: { created: 100, completed: 250 },
        },
      },
    } as never);

    expect(onComplete).toHaveBeenCalledWith(
      "session-1",
      "message-1",
      "",
      "",
      [],
      expect.objectContaining({ completedAt: 250 }),
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/summary/aggregator.test.ts -t "completion metadata"`
Expected: FAIL until the metadata is propagated consistently.

- [ ] **Step 3: Implement metadata propagation in the aggregator and run state**

```ts
export interface AssistantCompletionInfo {
  agent?: string;
  providerID?: string;
  modelID?: string;
  completedAt?: number;
  logicalMessageId?: string;
}
```

```ts
export interface AssistantRunResolvedInfo {
  agent?: string;
  providerID?: string;
  modelID?: string;
  completedAt?: number;
  logicalMessageId?: string;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/summary/aggregator.test.ts -t "completion metadata"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/summary/aggregator.ts src/bot/assistant-run-state.ts tests/summary/aggregator.test.ts
git commit -m "refactor: propagate assistant delivery metadata"
```

## Task 6: Move thinking live/final delivery onto the orchestrator and safe sender

**Files:**

- Modify: `src/bot/utils/thinking-draft-lifecycle.ts`
- Modify: `src/bot/utils/thinking-block-stream.ts`
- Modify: `tests/bot/utils/thinking-draft-lifecycle.test.ts`
- Modify: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write the failing live/durable thinking regression tests**

```ts
it("waits for the related live thinking item before final thinking publication", async () => {
  // Extend existing local-file-follow-up integration fixture so
  // a delayed live draft retry finishes before the durable final thinking publish.
});

it("does not crash when finalizeDraft hits Telegram retry_after", async () => {
  // Mock sendMessage to reject once with retry_after and then resolve.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/utils/thinking-draft-lifecycle.test.ts tests/bot/index.local-file-follow-up.test.ts -t "related live thinking item|retry_after"`
Expected: FAIL with the current direct-send thinking lifecycle.

- [ ] **Step 3: Route live and final thinking sends through the new abstractions**

```ts
// src/bot/utils/thinking-block-stream.ts
orchestrator.enqueue({
  sessionId: options.sessionId,
  logicalMessageId: options.logicalMessageId,
  kind: "thinking-live",
  channel: "live",
  arrivalSeq: nextArrivalSeq(),
  execute: async () => {
    await lifecycleManager.renderActiveDraft(options.sessionId, rendered.text, transport);
  },
});
```

```ts
// final publish path
orchestrator.enqueue({
  sessionId,
  logicalMessageId,
  kind: "thinking-final",
  channel: "durable",
  eventTimeMs: completedAt,
  arrivalSeq: nextArrivalSeq(),
  waitForLogicalMessageLiveTerminal: true,
  execute: async () => {
    await lifecycleManager.finalizeDraft(sessionId, transport);
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bot/utils/thinking-draft-lifecycle.test.ts tests/bot/index.local-file-follow-up.test.ts -t "related live thinking item|retry_after|keeps assistant text streaming when active thinking draft rendering fails"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/utils/thinking-draft-lifecycle.ts src/bot/utils/thinking-block-stream.ts tests/bot/utils/thinking-draft-lifecycle.test.ts tests/bot/index.local-file-follow-up.test.ts
git commit -m "refactor: orchestrate thinking delivery"
```

## Task 7: Move final assistant answer and footer onto durable delivery ordering

**Files:**

- Modify: `src/bot/index.ts`
- Modify: `src/bot/assistant-run-state.ts`
- Modify: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write the failing final-answer/footer ordering tests**

```ts
it("delivers tool output, then final assistant answer, then footer by durable event ordering", async () => {
  // Extend the existing regression so item ordering is asserted through the new orchestrator path.
});

it("makes footer wait for final assistant materialization of the same logical message", async () => {
  // Mock a delayed final assistant delivery and assert footer does not appear first.
});

it("uses OpenCode completion time for footer elapsed", async () => {
  // Set run startedAt and completedAt deterministically and assert footer duration text.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/index.local-file-follow-up.test.ts -t "tool output, then final assistant answer, then footer|footer wait|footer elapsed"`
Expected: FAIL while final answer and footer are still routed by mixed direct-send logic.

- [ ] **Step 3: Move final answer and footer delivery to durable items**

```ts
orchestrator.enqueue({
  sessionId,
  logicalMessageId: messageId,
  kind: "assistant-final",
  channel: "durable",
  eventTimeMs: completionInfo?.completedAt,
  arrivalSeq: nextArrivalSeq(),
  waitForLogicalMessageLiveTerminal: true,
  execute: async () => {
    await finalizeAssistantResponse({
      sessionId,
      messageId,
      messageText,
      sourceCommand,
      responseStreamer,
      flushPendingServiceMessages,
      prepareStreamingPayload: prepareFinalStreamingPayload,
      renderFinalParts: renderAssistantFinalPartsSafe,
      getReplyKeyboard: () => getReplyKeyboardForSession(sessionId),
      sendRenderedPart,
    });
  },
});

orchestrator.enqueue({
  sessionId,
  logicalMessageId: messageId,
  kind: "footer",
  channel: "durable",
  eventTimeMs: completionInfo?.completedAt,
  arrivalSeq: nextArrivalSeq(),
  waitForLogicalMessageLiveTerminal: false,
  dependsOnDurableLogicalMessageId: messageId,
  execute: async () => {
    await sendSessionCompletionFooter({ sessionId, botApi, target });
  },
});
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bot/index.local-file-follow-up.test.ts -t "tool output, then final assistant answer, then footer|footer wait|footer elapsed"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/index.ts src/bot/assistant-run-state.ts tests/bot/index.local-file-follow-up.test.ts
git commit -m "refactor: order final assistant delivery"
```

## Task 8: Integrate tool and subagent publications with durable ordering

**Files:**

- Modify: `src/bot/index.ts`
- Modify: `src/bot/streaming/tool-call-streamer.ts`
- Modify: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write the failing durable ordering tests for tool/subagent items**

```ts
it("delivers tool and subagent publications by event time rather than async completion race", async () => {
  // Emit mixed tool/subagent/final events with deterministic times and assert Telegram order.
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/index.local-file-follow-up.test.ts -t "tool and subagent publications by event time"`
Expected: FAIL while tool/subagent sends still use direct async timing.

- [ ] **Step 3: Route tool/subagent durable publications through the orchestrator**

```ts
orchestrator.enqueue({
  sessionId: toolInfo.sessionId,
  logicalMessageId: toolInfo.callId,
  kind: "tool",
  channel: "durable",
  eventTimeMs: toolInfo.startedAt,
  arrivalSeq: nextArrivalSeq(),
  execute: async () => {
    toolCallStreamer.replaceByPrefix(toolInfo.sessionId, `tool:${toolInfo.callId}`, spoilerMessage);
  },
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- tests/bot/index.local-file-follow-up.test.ts -t "tool and subagent publications by event time"`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/bot/index.ts src/bot/streaming/tool-call-streamer.ts tests/bot/index.local-file-follow-up.test.ts
git commit -m "refactor: order tool and subagent publications"
```

## Task 9: Full verification and documentation updates

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `PRODUCT.md`

- [ ] **Step 1: Update changelog entry with finalized delivery guarantees**

```md
### Fixed

- Fixed Telegram assistant delivery ordering so durable assistant outputs now follow OpenCode event timing, active thinking retries no longer crash the bot on `429 retry_after`, long HTML reasoning is chunked safely, and numbered lists remain readable instead of collapsing into repeated `1.` items.
```

- [ ] **Step 2: Update product bullets to reflect the new delivery behavior**

```md
- Keep live assistant streaming responsive while durable chat publications follow OpenCode event ordering
- Keep Telegram delivery resilient to `429 retry_after` and per-message send failures
- Preserve numbered list readability in Telegram responses
```

- [ ] **Step 3: Run focused regression tests**

Run: `npm test -- tests/bot/delivery/session-delivery-orchestrator.test.ts tests/bot/delivery/safe-telegram-sender.test.ts tests/bot/utils/telegram-html-chunker.test.ts tests/bot/utils/thinking-draft-lifecycle.test.ts tests/bot/index.local-file-follow-up.test.ts tests/bot/utils/reasoning-format.test.ts tests/summary/aggregator.test.ts`
Expected: PASS

- [ ] **Step 4: Run full verification**

Run: `npm run build && npm run lint && npm test`
Expected: all commands succeed with exit code 0

- [ ] **Step 5: Commit**

```bash
git add CHANGELOG.md PRODUCT.md
git commit -m "fix: harden telegram assistant delivery"
```
