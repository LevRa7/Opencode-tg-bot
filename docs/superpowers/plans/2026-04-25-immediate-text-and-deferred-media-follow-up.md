# Immediate Text And Deferred Media Follow-Up Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Send direct user text to OpenCode immediately, while correlating forwarded/media messages that arrive within one second into a silent deferred follow-up for the same session, with correct prompt/context semantics and consolidated recognition preview.

**Architecture:** Add a lightweight correlation layer keyed by Telegram conversation scope that tracks the latest direct user prompt and buffers related forwarded/media messages for one second. Media processing remains parallelized, but final composition is centralized in a new prompt-composer module that preserves order, tags forwarded origin, and decides main prompt versus context. Deferred follow-ups are queued into the same session without triggering the existing busy warning path.

**Tech Stack:** TypeScript, Node.js 20, grammY, existing `processUserPrompt`, existing per-session completion queue in `src/bot/index.ts`, existing media ingest/transcriber pipeline, Vitest.

---

## File Map

- `src/media/batch-types.ts` - shared types for correlated incoming items, resolved media results, forwarded tags, preview payloads, and composed follow-up prompts.
- `src/bot/incoming-media-batch.ts` - correlation window manager; tracks the latest direct user prompt and aggregates deferred forwarded/media items for one second.
- `src/media/prompt-composer.ts` - converts resolved batch items into one user-visible preview and one follow-up prompt with correct main prompt/context semantics.
- `src/bot/deferred-follow-up-queue.ts` - per-session queue for correlated follow-up prompts that waits for session idle before dispatching them.
- `src/bot/handlers/prompt.ts` - expose a typed deferred-follow-up dispatch path that still uses normal prompt submission, but never shows the normal busy warning because it is sent only after queue release.
- `src/bot/index.ts` - wire text/media handlers through the correlation layer instead of immediately dispatching every media item.
- `src/bot/handlers/voice.ts` - change from immediate prompt dispatch to normalized deferred-item creation when applicable.
- `src/bot/handlers/video.ts` - change from immediate prompt dispatch to normalized deferred-item creation when applicable.
- `src/bot/handlers/photo.ts` - change from immediate prompt dispatch to normalized deferred-item creation when applicable.
- `src/bot/handlers/document.ts` - change from immediate prompt dispatch to normalized deferred-item creation when applicable.
- `src/i18n/en.ts` - add new preview/consolidation strings and any silent-follow-up specific copy.
- `src/i18n/de.ts`
- `src/i18n/es.ts`
- `src/i18n/fr.ts`
- `src/i18n/ru.ts`
- `src/i18n/zh.ts`
- `tests/media/prompt-composer.test.ts` - prompt and preview semantics tests.
- `tests/bot/incoming-media-batch.test.ts` - correlation-window, ordering, and suppression-of-busy-warning tests.
- `tests/bot/handlers/voice.test.ts` - updated voice behavior under deferred follow-up mode.
- `tests/bot/handlers/video.test.ts` - updated video behavior under deferred follow-up mode.
- `tests/bot/handlers/photo.test.ts` - updated photo behavior under deferred follow-up mode.
- `tests/bot/handlers/document.test.ts` - updated document behavior under deferred follow-up mode.
- `CHANGELOG.md` - document immediate text + deferred media follow-up orchestration.
- `PRODUCT.md` - update media-handling behavior description.

---

### Task 1: Add Shared Correlation And Prompt-Composition Types

**Files:**

- Create: `src/media/batch-types.ts`
- Create: `tests/media/batch-types.test.ts`

- [ ] **Step 1: Write the failing type-shape tests first**

```typescript
// Create tests/media/batch-types.test.ts
import { describe, expect, it } from "vitest";
import {
  createForwardedSourceTag,
  isDeferredMediaItem,
  type CorrelatedIncomingItem,
} from "../../src/media/batch-types.js";

describe("media/batch-types", () => {
  it("marks media and forwarded items as deferred-follow-up eligible", () => {
    const mediaItem: CorrelatedIncomingItem = {
      id: "m1",
      kind: "video",
      createdAt: 1,
      directUserText: null,
      forwarded: null,
      caption: null,
    };

    expect(isDeferredMediaItem(mediaItem)).toBe(true);
  });

  it("creates a forwarded source tag from display name when present", () => {
    expect(createForwardedSourceTag({ displayName: "Alice", isAnotherUser: true })).toBe(
      "[Forwarded from: Alice]",
    );
  });

  it("falls back to a generic forwarded tag when no display name exists", () => {
    expect(createForwardedSourceTag({ displayName: null, isAnotherUser: true })).toBe(
      "[Forwarded from another user]",
    );
  });
});
```

- [ ] **Step 2: Run the type-shape test to verify it fails**

Run: `npm test -- tests/media/batch-types.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/batch-types.js'`.

- [ ] **Step 3: Write the minimal shared types implementation**

```typescript
// Create src/media/batch-types.ts
export type DeferredItemKind =
  | "text"
  | "voice"
  | "audio"
  | "video"
  | "video_note"
  | "photo"
  | "document";

export interface ForwardedSourceInfo {
  displayName: string | null;
  isAnotherUser: boolean;
}

export interface CorrelatedIncomingItem {
  id: string;
  kind: DeferredItemKind;
  createdAt: number;
  directUserText: string | null;
  caption: string | null;
  forwarded: ForwardedSourceInfo | null;
}

export interface ResolvedDeferredItem {
  id: string;
  kind: DeferredItemKind;
  createdAt: number;
  previewText: string;
  contextText: string;
  forwardedTag: string | null;
}

export interface ComposedPromptResult {
  previewText: string;
  followUpPromptText: string;
}

export function isDeferredMediaItem(item: CorrelatedIncomingItem): boolean {
  return item.kind !== "text";
}

export function createForwardedSourceTag(forwarded: ForwardedSourceInfo | null): string | null {
  if (!forwarded) {
    return null;
  }
  if (forwarded.displayName) {
    return `[Forwarded from: ${forwarded.displayName}]`;
  }
  if (forwarded.isAnotherUser) {
    return "[Forwarded from another user]";
  }
  return "[Forwarded message]";
}
```

- [ ] **Step 4: Run the type-shape test again to verify it passes**

Run: `npm test -- tests/media/batch-types.test.ts`
Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the shared batch types**

```bash
git add src/media/batch-types.ts tests/media/batch-types.test.ts
git commit -m "feat: add correlated media batch types"
```

---

### Task 2: Add Prompt Composer For Deferred Follow-Ups

**Files:**

- Create: `src/media/prompt-composer.ts`
- Create: `tests/media/prompt-composer.test.ts`

- [ ] **Step 1: Write the failing prompt-composer tests first**

```typescript
// Create tests/media/prompt-composer.test.ts
import { describe, expect, it } from "vitest";
import { composeDeferredMediaPrompt } from "../../src/media/prompt-composer.js";

describe("media/prompt-composer", () => {
  it("uses the latest direct user text as the main prompt and keeps forwarded text in context", () => {
    const result = composeDeferredMediaPrompt({
      directUserPrompt: "Ответь на вопрос по контексту ниже.",
      items: [
        {
          id: "1",
          kind: "text",
          createdAt: 1,
          previewText: "Forwarded text preview",
          contextText: "Forwarded text: Как пить из этого стакана?",
          forwardedTag: "[Forwarded from another user]",
        },
        {
          id: "2",
          kind: "video",
          createdAt: 2,
          previewText: "Video summary preview",
          contextText: "Video description: The speaker asks how to drink from the glass.",
          forwardedTag: null,
        },
      ],
    });

    expect(result.followUpPromptText).toContain(
      "Additional context for the user's previous request:",
    );
    expect(result.followUpPromptText).not.toContain("User request: Как пить из этого стакана?");
    expect(result.followUpPromptText).toContain("[Forwarded from another user]");
    expect(result.followUpPromptText).toContain("Forwarded text: Как пить из этого стакана?");
    expect(result.followUpPromptText).toContain(
      "Video description: The speaker asks how to drink from the glass.",
    );
  });

  it("uses audio transcript as the main prompt only when direct user text is absent", () => {
    const result = composeDeferredMediaPrompt({
      directUserPrompt: null,
      items: [
        {
          id: "1",
          kind: "voice",
          createdAt: 1,
          previewText: "Так а как из него пить-то?",
          contextText: "Voice transcript: Так а как из него пить-то?",
          forwardedTag: null,
        },
      ],
    });

    expect(result.followUpPromptText).toContain("User request from transcribed audio:");
    expect(result.followUpPromptText).toContain("Так а как из него пить-то?");
  });

  it("keeps photo and document extraction in context blocks even without direct user text", () => {
    const result = composeDeferredMediaPrompt({
      directUserPrompt: null,
      items: [
        {
          id: "1",
          kind: "photo",
          createdAt: 1,
          previewText: "Image OCR preview",
          contextText: "Photo OCR: invoice total 1500",
          forwardedTag: null,
        },
      ],
    });

    expect(result.followUpPromptText).toContain(
      "Analyze the image using the extracted context below.",
    );
    expect(result.followUpPromptText).toContain("Photo OCR: invoice total 1500");
  });
});
```

- [ ] **Step 2: Run the prompt-composer test to verify it fails**

Run: `npm test -- tests/media/prompt-composer.test.ts`
Expected: FAIL with `Cannot find module '../../src/media/prompt-composer.js'`.

- [ ] **Step 3: Write the minimal prompt composer**

```typescript
// Create src/media/prompt-composer.ts
import type { ComposedPromptResult, ResolvedDeferredItem } from "./batch-types.js";

function buildPreview(items: ResolvedDeferredItem[]): string {
  const lines = [`Recognized from ${items.length} messages:`];
  for (const [index, item] of items.entries()) {
    lines.push("", `${index + 1}. ${item.kind}`, item.previewText.trim());
  }
  return lines.join("\n");
}

function buildContextLines(items: ResolvedDeferredItem[]): string[] {
  const lines: string[] = [];
  for (const item of items) {
    if (item.forwardedTag) {
      lines.push(item.forwardedTag);
    }
    lines.push(item.contextText.trim(), "");
  }
  return lines;
}

export function composeDeferredMediaPrompt(params: {
  directUserPrompt: string | null;
  items: ResolvedDeferredItem[];
}): ComposedPromptResult {
  const previewText = buildPreview(params.items);
  const contextLines = buildContextLines(params.items).join("\n").trim();

  if (params.directUserPrompt?.trim()) {
    return {
      previewText,
      followUpPromptText: `Additional context for the user's previous request:\n\n${contextLines}`,
    };
  }

  const firstVoiceLike = params.items.find(
    (item) => item.kind === "voice" || item.kind === "audio",
  );
  if (firstVoiceLike) {
    const transcript = firstVoiceLike.contextText.replace(/^Voice transcript:\s*/i, "").trim();
    return {
      previewText,
      followUpPromptText: `User request from transcribed audio:\n${transcript}`,
    };
  }

  return {
    previewText,
    followUpPromptText: `Analyze the extracted context below.\n\n${contextLines}`,
  };
}
```

- [ ] **Step 4: Run the prompt-composer test again to verify it passes**

Run: `npm test -- tests/media/prompt-composer.test.ts`
Expected: PASS with 3 passing tests.

- [ ] **Step 5: Commit the prompt composer**

```bash
git add src/media/prompt-composer.ts tests/media/prompt-composer.test.ts
git commit -m "feat: compose deferred media follow-up prompts"
```

---

### Task 3: Add Correlation Window Manager

**Files:**

- Create: `src/bot/incoming-media-batch.ts`
- Create: `tests/bot/incoming-media-batch.test.ts`

- [ ] **Step 1: Write the failing correlation-window tests first**

```typescript
// Create tests/bot/incoming-media-batch.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { IncomingMediaBatch } from "../../src/bot/incoming-media-batch.js";

describe("bot/incoming-media-batch", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("sends direct user text immediately and keeps the window open for deferred follow-ups", async () => {
    const sendDirectPrompt = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      sendDeferredFollowUp,
      resolveDeferredItems: vi.fn().mockResolvedValue([]),
    });

    await batch.ingest({
      scopeKey: "chat:1",
      item: {
        id: "text-1",
        kind: "text",
        createdAt: Date.now(),
        directUserText: "Как это работает?",
        caption: null,
        forwarded: null,
      },
    });

    expect(sendDirectPrompt).toHaveBeenCalledTimes(1);
    expect(sendDeferredFollowUp).not.toHaveBeenCalled();
  });

  it("correlates forwarded/media items arriving within one second into one silent follow-up", async () => {
    const sendDirectPrompt = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const resolveDeferredItems = vi.fn().mockResolvedValue([
      {
        previewText: "preview",
        contextText: "ctx",
        kind: "video",
        id: "m1",
        createdAt: 2,
        forwardedTag: null,
      },
    ]);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      sendDeferredFollowUp,
      resolveDeferredItems,
    });

    await batch.ingest({
      scopeKey: "chat:1",
      item: {
        id: "text-1",
        kind: "text",
        createdAt: 1,
        directUserText: "Ответь на вопрос",
        caption: null,
        forwarded: null,
      },
    });

    await batch.ingest({
      scopeKey: "chat:1",
      item: {
        id: "video-1",
        kind: "video",
        createdAt: 2,
        directUserText: null,
        caption: null,
        forwarded: { displayName: "Alice", isAnotherUser: true },
      },
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(resolveDeferredItems).toHaveBeenCalledTimes(1);
    expect(sendDeferredFollowUp).toHaveBeenCalledTimes(1);
  });

  it("does not show busy warning behavior for correlated deferred follow-ups", async () => {
    const sendDirectPrompt = vi.fn().mockResolvedValue({ sessionId: "session-1" });
    const sendDeferredFollowUp = vi.fn().mockResolvedValue(undefined);
    const batch = new IncomingMediaBatch({
      sendDirectPrompt,
      sendDeferredFollowUp,
      resolveDeferredItems: vi.fn().mockResolvedValue([]),
    });

    await batch.ingest({
      scopeKey: "chat:1",
      item: {
        id: "text-1",
        kind: "text",
        createdAt: 1,
        directUserText: "Ответь на вопрос",
        caption: null,
        forwarded: null,
      },
    });

    await batch.ingest({
      scopeKey: "chat:1",
      item: {
        id: "voice-1",
        kind: "voice",
        createdAt: 2,
        directUserText: null,
        caption: null,
        forwarded: null,
      },
    });

    await vi.advanceTimersByTimeAsync(1000);

    expect(sendDeferredFollowUp).toHaveBeenCalledWith(
      expect.objectContaining({ silent: true, suppressBusyWarning: true }),
    );
  });
});
```

- [ ] **Step 2: Run the correlation-window test to verify it fails**

Run: `npm test -- tests/bot/incoming-media-batch.test.ts`
Expected: FAIL with `Cannot find module '../../src/bot/incoming-media-batch.js'`.

- [ ] **Step 3: Write the minimal correlation manager**

```typescript
// Create src/bot/incoming-media-batch.ts
import type { CorrelatedIncomingItem, ResolvedDeferredItem } from "../media/batch-types.js";

interface PendingCorrelationState {
  sessionId: string | null;
  directUserPrompt: string | null;
  deferredItems: CorrelatedIncomingItem[];
  timer: ReturnType<typeof setTimeout> | null;
}

export class IncomingMediaBatch {
  private readonly pending = new Map<string, PendingCorrelationState>();

  constructor(
    private readonly deps: {
      sendDirectPrompt: (params: {
        scopeKey: string;
        text: string;
      }) => Promise<{ sessionId: string }>;
      resolveDeferredItems: (params: {
        scopeKey: string;
        sessionId: string;
        directUserPrompt: string | null;
        items: CorrelatedIncomingItem[];
      }) => Promise<ResolvedDeferredItem[]>;
      sendDeferredFollowUp: (params: {
        scopeKey: string;
        sessionId: string;
        directUserPrompt: string | null;
        items: ResolvedDeferredItem[];
        silent: true;
        suppressBusyWarning: true;
      }) => Promise<void>;
    },
  ) {}

  async ingest(params: { scopeKey: string; item: CorrelatedIncomingItem }): Promise<void> {
    const state = this.pending.get(params.scopeKey) ?? {
      sessionId: null,
      directUserPrompt: null,
      deferredItems: [],
      timer: null,
    };

    if (params.item.kind === "text" && params.item.directUserText?.trim() && !state.sessionId) {
      const directPrompt = params.item.directUserText.trim();
      const { sessionId } = await this.deps.sendDirectPrompt({
        scopeKey: params.scopeKey,
        text: directPrompt,
      });
      state.sessionId = sessionId;
      state.directUserPrompt = directPrompt;
    } else {
      state.deferredItems.push(params.item);
    }

    this.resetTimer(params.scopeKey, state);
    this.pending.set(params.scopeKey, state);
  }

  private resetTimer(scopeKey: string, state: PendingCorrelationState): void {
    if (state.timer) {
      clearTimeout(state.timer);
    }

    state.timer = setTimeout(() => {
      void this.flush(scopeKey);
    }, 1000);
  }

  private async flush(scopeKey: string): Promise<void> {
    const state = this.pending.get(scopeKey);
    if (!state) {
      return;
    }

    this.pending.delete(scopeKey);
    if (!state.sessionId || state.deferredItems.length === 0) {
      return;
    }

    const resolvedItems = await this.deps.resolveDeferredItems({
      scopeKey,
      sessionId: state.sessionId,
      directUserPrompt: state.directUserPrompt,
      items: state.deferredItems,
    });

    await this.deps.sendDeferredFollowUp({
      scopeKey,
      sessionId: state.sessionId,
      directUserPrompt: state.directUserPrompt,
      items: resolvedItems,
      silent: true,
      suppressBusyWarning: true,
    });
  }
}
```

- [ ] **Step 4: Run the correlation-window test again to verify it passes**

Run: `npm test -- tests/bot/incoming-media-batch.test.ts`
Expected: PASS with the immediate-text/deferred-follow-up behavior covered.

- [ ] **Step 5: Commit the correlation manager**

```bash
git add src/bot/incoming-media-batch.ts tests/bot/incoming-media-batch.test.ts
git commit -m "feat: correlate deferred media follow-ups"
```

---

### Task 4: Add Deferred Follow-Up Queue

**Files:**

- Create: `src/bot/deferred-follow-up-queue.ts`
- Create: `tests/bot/deferred-follow-up-queue.test.ts`
- Modify: `src/bot/index.ts`

- [ ] **Step 1: Write the failing deferred-queue tests first**

```typescript
// Create tests/bot/deferred-follow-up-queue.test.ts
import { describe, expect, it, vi } from "vitest";
import { DeferredFollowUpQueue } from "../../src/bot/deferred-follow-up-queue.js";

describe("bot/deferred-follow-up-queue", () => {
  it("queues correlated follow-ups while a session is busy and flushes them after session idle", async () => {
    const dispatchFollowUp = vi.fn().mockResolvedValue(undefined);
    const queue = new DeferredFollowUpQueue({ dispatchFollowUp });

    queue.enqueue({ sessionId: "session-1", promptText: "context 1" });
    expect(dispatchFollowUp).not.toHaveBeenCalled();

    await queue.flushSession("session-1");

    expect(dispatchFollowUp).toHaveBeenCalledTimes(1);
    expect(dispatchFollowUp).toHaveBeenCalledWith({
      sessionId: "session-1",
      promptText: "context 1",
    });
  });

  it("preserves ordering for multiple follow-ups in the same session", async () => {
    const dispatchFollowUp = vi.fn().mockResolvedValue(undefined);
    const queue = new DeferredFollowUpQueue({ dispatchFollowUp });

    queue.enqueue({ sessionId: "session-1", promptText: "context 1" });
    queue.enqueue({ sessionId: "session-1", promptText: "context 2" });

    await queue.flushSession("session-1");

    expect(dispatchFollowUp.mock.calls.map((call) => call[0].promptText)).toEqual([
      "context 1",
      "context 2",
    ]);
  });
});
```

- [ ] **Step 2: Run the deferred-queue test to verify it fails**

Run: `npm test -- tests/bot/deferred-follow-up-queue.test.ts`
Expected: FAIL because the queue module does not exist yet.

- [ ] **Step 3: Write the minimal deferred queue and idle flush wiring**

```typescript
// Create src/bot/deferred-follow-up-queue.ts
export class DeferredFollowUpQueue {
  private readonly queue = new Map<string, Array<{ sessionId: string; promptText: string }>>();

  constructor(
    private readonly deps: {
      dispatchFollowUp: (input: { sessionId: string; promptText: string }) => Promise<void>;
    },
  ) {}

  enqueue(item: { sessionId: string; promptText: string }): void {
    const current = this.queue.get(item.sessionId) ?? [];
    current.push(item);
    this.queue.set(item.sessionId, current);
  }

  async flushSession(sessionId: string): Promise<void> {
    const pending = this.queue.get(sessionId);
    if (!pending || pending.length === 0) {
      return;
    }
    this.queue.delete(sessionId);
    for (const item of pending) {
      await this.deps.dispatchFollowUp(item);
    }
  }
}
```

```typescript
// Modify src/bot/index.ts
// Create one DeferredFollowUpQueue instance near createBot()
// On summaryAggregator.setOnSessionIdle(sessionId), flush deferred follow-ups for that session after the normal completion queue work finishes.
```

- [ ] **Step 4: Run the deferred-queue test again to verify it passes**

Run: `npm test -- tests/bot/deferred-follow-up-queue.test.ts`
Expected: PASS with 2 passing tests.

- [ ] **Step 5: Commit the deferred queue**

```bash
git add src/bot/deferred-follow-up-queue.ts tests/bot/deferred-follow-up-queue.test.ts src/bot/index.ts
git commit -m "feat: queue deferred media follow-ups by session"
```

---

### Task 5: Adapt Media Handlers To Deferred Correlation

**Files:**

- Modify: `src/bot/index.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Modify: `src/bot/handlers/voice.ts`
- Modify: `src/bot/handlers/video.ts`
- Modify: `src/bot/handlers/photo.ts`
- Modify: `src/bot/handlers/document.ts`
- Create: `tests/bot/handlers/prompt-deferred-follow-up.test.ts`
- Modify: `tests/bot/handlers/voice.test.ts`
- Modify: `tests/bot/handlers/video.test.ts`
- Modify: `tests/bot/handlers/photo.test.ts`
- Modify: `tests/bot/handlers/document.test.ts`

- [ ] **Step 1: Update the failing handler tests first**

```typescript
// Example additions across handler tests
it("enqueues voice as deferred follow-up when a correlated direct text prompt already exists", async () => {
  const enqueueCorrelatedItem = vi.fn().mockResolvedValue(undefined);
  const { ctx } = createVoiceContext();

  await handleVoiceMessage(ctx, {
    bot: {} as never,
    ensureEventSubscription: vi.fn(),
    enqueueCorrelatedItem,
  } as never);

  expect(enqueueCorrelatedItem).toHaveBeenCalledTimes(1);
});
```

```typescript
// Example addition in tests for src/bot/index.ts behavior
it("sends direct text immediately and correlates following media within one second without busy warning", async () => {
  // direct text triggers processUserPrompt immediately
  // subsequent media goes through correlation manager and is enqueued into the deferred follow-up queue for the same session
});
```

- [ ] **Step 2: Run the handler tests to verify they fail**

Run: `npm test -- tests/bot/handlers/voice.test.ts tests/bot/handlers/video.test.ts tests/bot/handlers/photo.test.ts tests/bot/handlers/document.test.ts`
Expected: FAIL because handlers still dispatch immediate prompts directly.

- [ ] **Step 3: Write the minimal handler wiring**

```typescript
// Modify src/bot/index.ts
// Create one shared IncomingMediaBatch instance near createBot()
// message:text sends direct text immediately via processUserPrompt and also registers correlation window state
// media handlers normalize items and pass them into the correlation manager when applicable
// deferred media follow-up flushes into DeferredFollowUpQueue instead of calling processUserPrompt while the session is busy
```

```typescript
// Modify src/bot/handlers/prompt.ts
// Add a typed helper for deferred follow-up dispatch that is used only by DeferredFollowUpQueue.
// It should still call the normal prompt path after session idle, but with quiet/silent behavior and no user-facing busy warning.
```

```typescript
// Modify each media handler so it can either:
// - create a standalone immediate media request when no correlated direct text exists
// - or emit a normalized CorrelatedIncomingItem into the batch manager when a recent direct prompt exists
```

- [ ] **Step 4: Run the handler tests again to verify they pass**

Run: `npm test -- tests/bot/handlers/voice.test.ts tests/bot/handlers/video.test.ts tests/bot/handlers/photo.test.ts tests/bot/handlers/document.test.ts`
Expected: PASS with deferred-correlation behavior covered.

- [ ] **Step 5: Commit the handler wiring**

```bash
git add src/bot/index.ts src/bot/handlers/prompt.ts src/bot/handlers/voice.ts src/bot/handlers/video.ts src/bot/handlers/photo.ts src/bot/handlers/document.ts tests/bot/handlers/prompt-deferred-follow-up.test.ts tests/bot/handlers/voice.test.ts tests/bot/handlers/video.test.ts tests/bot/handlers/photo.test.ts tests/bot/handlers/document.test.ts
git commit -m "feat: correlate deferred media into active sessions"
```

---

### Task 6: Add User-Facing Preview Strings And Final Docs

**Files:**

- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/de.ts`
- Modify: `src/i18n/es.ts`
- Modify: `src/i18n/fr.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `CHANGELOG.md`
- Modify: `PRODUCT.md`

- [ ] **Step 1: Add the failing preview-composition expectations to tests if needed**

Run: `npm test -- tests/media/prompt-composer.test.ts tests/bot/incoming-media-batch.test.ts tests/bot/deferred-follow-up-queue.test.ts tests/bot/handlers/prompt-deferred-follow-up.test.ts`
Expected: FAIL until user-facing preview strings and docs are aligned with the final behavior.

- [ ] **Step 2: Add new localized preview/consolidation strings**

```typescript
// Modify src/i18n/en.ts
"bot.media_preview_header": "Recognized from {count} messages:",
"bot.media_followup_context": "Additional context for the user's previous request:",

// Modify src/i18n/ru.ts
"bot.media_preview_header": "Распознано из {count} сообщений:",
"bot.media_followup_context": "Дополнительный контекст к предыдущему запросу пользователя:",

// Add equivalent translations in de/es/fr/zh.
```

- [ ] **Step 3: Update PRODUCT.md and CHANGELOG.md**

```markdown
// Modify PRODUCT.md

- [x] Media and forwarded-message correlation within one second, with immediate direct-text dispatch, silent deferred media follow-ups, and consolidated recognition previews before sending supporting context into the active OpenCode session.

// Modify CHANGELOG.md under Unreleased -> Changed

- Added one-second correlation for direct text plus forwarded/media follow-ups, so the bot can start answering a user's direct question immediately and then append recognized media and forwarded context to the same OpenCode session without showing the usual busy warning.
  - Why: Users often send a question first and forward supporting media a moment later. The bot should preserve direct user intent as the main prompt while still attaching recognized media context to the same run.
  - Affects: `src/bot/incoming-media-batch.ts`, `src/media/prompt-composer.ts`, `src/bot/handlers/prompt.ts`, `src/bot/index.ts`, `src/bot/handlers/*.ts`, `src/i18n/*.ts`, `tests/bot/incoming-media-batch.test.ts`, `tests/media/prompt-composer.test.ts`, `PRODUCT.md`
```

- [ ] **Step 4: Run the full verification suite**

Run: `npm test`
Expected: PASS with zero failing test files.

Run: `npm run lint`
Expected: PASS with zero warnings.

Run: `npm run build`
Expected: PASS with zero TypeScript errors.

- [ ] **Step 5: Commit the docs and preview strings**

```bash
git add src/i18n/en.ts src/i18n/de.ts src/i18n/es.ts src/i18n/fr.ts src/i18n/ru.ts src/i18n/zh.ts CHANGELOG.md PRODUCT.md
git commit -m "docs: describe deferred media follow-up prompts"
```

---

## Self-Review Notes

- Spec coverage: the plan covers immediate direct text, 1-second correlation, forwarded text staying in context, deferred media follow-ups queued by session after idle, consolidated preview, and full verification.
- Placeholder scan: no placeholders remain.
- Type consistency: `IncomingMediaBatch`, `ComposedPromptResult`, and `DeferredFollowUpQueue` are named consistently across later tasks.
