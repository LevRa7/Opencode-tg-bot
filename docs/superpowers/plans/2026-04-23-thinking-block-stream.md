# Thinking Block Stream Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement a draft-first `thinking-block-stream` so active reasoning blocks update through Telegram `SendMessageDraft`, while finalized reasoning blocks are published as normal messages that remain visible in chat.

**Architecture:** Add a dedicated coordinator that owns per-session active reasoning draft state and dedupe, plus a lower-level draft lifecycle helper that starts/updates one active draft and publishes the final rendered block through `sendMessage`. Integrate `src/bot/index.ts` with this coordinator without merging reasoning semantics into the existing assistant `MessageDraftStreamManager`.

**Tech Stack:** TypeScript, Node.js, grammY Telegram API, Telegram `sendMessageDraft`, existing HTML reasoning formatters, Vitest.

---

## File Map

- `src/bot/utils/thinking-block-stream.ts` - draft-first coordinator for active reasoning blocks per session, route-aware dedupe, finalize, and forced cleanup.
- `tests/bot/utils/thinking-block-stream.test.ts` - coordinator tests for draft updates, finalize publication, route churn, and retry behavior.
- `src/bot/utils/thinking-draft-lifecycle.ts` - new lower-level helper that owns one active reasoning draft lifecycle and publishes completed blocks as normal messages.
- `tests/bot/utils/thinking-draft-lifecycle.test.ts` - lifecycle tests for draft start/update/publish/clear behavior.
- `src/bot/index.ts` - bot integration that routes reasoning snapshots into the coordinator and cleans up terminal state correctly.
- `tests/bot/index.local-file-follow-up.test.ts` - focused integration coverage for draft-first reasoning behavior and routing-loss cleanup.

---

### Task 1: Add the draft-oriented lifecycle helper

**Files:**
- Create: `src/bot/utils/thinking-draft-lifecycle.ts`
- Create: `tests/bot/utils/thinking-draft-lifecycle.test.ts`

- [ ] **Step 1: Write failing lifecycle tests first**

```typescript
// Create tests/bot/utils/thinking-draft-lifecycle.test.ts
import { describe, expect, it, vi } from "vitest";
import { ThinkingDraftLifecycle } from "../../../src/bot/utils/thinking-draft-lifecycle.js";

describe("bot/utils/thinking-draft-lifecycle", () => {
  it("starts a new draft lifecycle for the first active block", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 500 });
    const deleteMessage = vi.fn().mockResolvedValue(true);

    await lifecycle.renderActiveDraft("s1", "<b>Thinking</b>", {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage,
      deleteMessage,
    });

    expect(sendMessageDraft).toHaveBeenCalledWith(123, 1, "<b>Thinking</b>", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("updates the same active draft when the block changes on the same route", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const transport = {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage: vi.fn().mockResolvedValue({ message_id: 500 }),
      deleteMessage: vi.fn().mockResolvedValue(true),
    };

    await lifecycle.renderActiveDraft("s1", "draft-1", transport);
    await lifecycle.renderActiveDraft("s1", "draft-2", transport);

    expect(sendMessageDraft).toHaveBeenCalledTimes(2);
  });

  it("publishes a normal message on finalize and clears active draft state", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 900 });
    const deleteMessage = vi.fn().mockResolvedValue(true);

    await lifecycle.renderActiveDraft("s1", "final-draft", {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage,
      deleteMessage,
    });

    await lifecycle.finalizeDraft("s1", {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage,
      deleteMessage,
    });

    expect(sendMessage).toHaveBeenCalledWith(123, "final-draft", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("starts a fresh draft after finalize instead of reusing the previous one", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 900 });
    const deleteMessage = vi.fn().mockResolvedValue(true);

    const first = {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage,
      deleteMessage,
    };

    await lifecycle.renderActiveDraft("s1", "draft-1", first);
    await lifecycle.finalizeDraft("s1", first);
    await lifecycle.renderActiveDraft("s1", "draft-2", {
      ...first,
      draftId: 2,
    });

    expect(sendMessageDraft).toHaveBeenNthCalledWith(2, 123, 2, "draft-2", {
      parse_mode: "HTML",
      message_thread_id: 456,
      disable_notification: true,
    });
  });

  it("clears only the active unfinished draft when forced cleanup is requested", async () => {
    const lifecycle = new ThinkingDraftLifecycle();
    const sendMessageDraft = vi.fn().mockResolvedValue(true);
    const sendMessage = vi.fn().mockResolvedValue({ message_id: 900 });
    const deleteMessage = vi.fn().mockResolvedValue(true);

    await lifecycle.renderActiveDraft("s1", "draft-1", {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage,
      deleteMessage,
    });

    await lifecycle.clearActiveDraft("s1", true, {
      chatId: 123,
      messageThreadId: 456,
      draftId: 1,
      routingIdentity: "chat:123:thread:456",
      sendMessageDraft,
      sendMessage,
      deleteMessage,
    });

    expect(deleteMessage).toHaveBeenCalled();
    expect(sendMessage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run the lifecycle tests to verify RED**

Run: `npm test -- tests/bot/utils/thinking-draft-lifecycle.test.ts`
Expected: FAIL because `src/bot/utils/thinking-draft-lifecycle.ts` does not exist yet.

- [ ] **Step 3: Implement the minimal draft lifecycle helper**

```typescript
// Create src/bot/utils/thinking-draft-lifecycle.ts
import { logger } from "../../utils/logger.js";

interface ThinkingDraftTransport {
  chatId: number;
  messageThreadId?: number;
  draftId: number;
  routingIdentity: string;
  sendMessageDraft: (
    chatId: number,
    draftId: number,
    text: string,
    options?: {
      parse_mode?: "HTML";
      message_thread_id?: number;
      disable_notification?: boolean;
    },
  ) => Promise<unknown>;
  sendMessage: (
    chatId: number,
    text: string,
    options?: {
      parse_mode?: "HTML";
      message_thread_id?: number;
      disable_notification?: boolean;
    },
  ) => Promise<{ message_id: number }>;
  deleteMessage: (chatId: number, messageId: number) => Promise<unknown>;
}

interface ActiveDraftState {
  lastText: string;
  draftId: number;
  routingIdentity: string;
  task: Promise<void>;
}

export class ThinkingDraftLifecycle {
  private readonly states = new Map<string, ActiveDraftState>();

  async renderActiveDraft(
    sessionId: string,
    text: string,
    transport: ThinkingDraftTransport,
  ): Promise<void> {
    if (!sessionId || !text.trim()) {
      return;
    }

    const state = this.getOrCreateState(sessionId, transport);
    state.task = state.task
      .catch(() => undefined)
      .then(async () => {
        if (
          state.lastText === text &&
          state.routingIdentity === transport.routingIdentity &&
          state.draftId === transport.draftId
        ) {
          return;
        }

        if (state.routingIdentity !== transport.routingIdentity) {
          state.lastText = "";
          state.routingIdentity = transport.routingIdentity;
          state.draftId = transport.draftId;
        }

        await transport.sendMessageDraft(transport.chatId, transport.draftId, text, {
          parse_mode: "HTML",
          message_thread_id: transport.messageThreadId,
          disable_notification: true,
        });

        state.lastText = text;
        state.routingIdentity = transport.routingIdentity;
        state.draftId = transport.draftId;
      })
      .catch((error) => {
        logger.error(`[ThinkingDraftLifecycle] Failed to render draft for session=${sessionId}`, error);
        throw error;
      });

    await state.task;
  }

  async finalizeDraft(sessionId: string, transport: ThinkingDraftTransport): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    await state.task.catch(() => undefined);
    if (!state.lastText) {
      this.states.delete(sessionId);
      return;
    }

    await transport.sendMessage(transport.chatId, state.lastText, {
      parse_mode: "HTML",
      message_thread_id: transport.messageThreadId,
      disable_notification: true,
    });

    this.states.delete(sessionId);
  }

  async clearActiveDraft(
    sessionId: string,
    shouldClear: boolean,
    transport: ThinkingDraftTransport,
  ): Promise<void> {
    const state = this.states.get(sessionId);
    if (!state) {
      return;
    }

    await state.task.catch(() => undefined);
    if (shouldClear && state.routingIdentity === transport.routingIdentity) {
      try {
        await transport.deleteMessage(transport.chatId, state.draftId);
      } catch (error) {
        logger.warn(`[ThinkingDraftLifecycle] Failed to clear draft for session=${sessionId}`, error);
      }
    }

    this.states.delete(sessionId);
  }

  clearSession(sessionId: string): void {
    this.states.delete(sessionId);
  }

  clearAll(): void {
    this.states.clear();
  }

  private getOrCreateState(sessionId: string, transport: ThinkingDraftTransport): ActiveDraftState {
    const existing = this.states.get(sessionId);
    if (existing) {
      return existing;
    }

    const created: ActiveDraftState = {
      lastText: "",
      draftId: transport.draftId,
      routingIdentity: transport.routingIdentity,
      task: Promise.resolve(),
    };
    this.states.set(sessionId, created);
    return created;
  }
}
```

- [ ] **Step 4: Run the lifecycle tests to verify GREEN**

Run: `npm test -- tests/bot/utils/thinking-draft-lifecycle.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the draft lifecycle helper**

```bash
git add src/bot/utils/thinking-draft-lifecycle.ts tests/bot/utils/thinking-draft-lifecycle.test.ts
git commit -m "feat: add draft lifecycle for thinking blocks"
```

---

### Task 2: Rebuild the coordinator around draft-first behavior

**Files:**
- Modify: `src/bot/utils/thinking-block-stream.ts`
- Modify: `tests/bot/utils/thinking-block-stream.test.ts`

- [ ] **Step 1: Rewrite coordinator tests for draft-first behavior**

```typescript
// Replace tests/bot/utils/thinking-block-stream.test.ts with draft-first expectations.
// Required cases:
// - first block snapshot starts a draft lifecycle
// - same active block updates the same draft lifecycle
// - identical full snapshot dedupes
// - finalize publishes a normal message and clears active draft state
// - next block after finalize starts a fresh draft lifecycle
// - forced cleanup only clears the active unfinished draft block
// - same text on a different route must still start/update a fresh draft lifecycle instead of deduping away
```

- [ ] **Step 2: Run the coordinator tests to verify RED**

Run: `npm test -- tests/bot/utils/thinking-block-stream.test.ts`
Expected: FAIL because the current coordinator still reflects the old persistent-message model.

- [ ] **Step 3: Implement the draft-first coordinator**

```typescript
// Update src/bot/utils/thinking-block-stream.ts
import type { Api, RawApi } from "grammy";
import type { MessageDraftIdAllocator } from "./message-draft-id.js";
import { formatThinkingMessageWithReasoning } from "./thinking-message.js";
import { ThinkingDraftLifecycle } from "./thinking-draft-lifecycle.js";
import type { TelegramThreadTarget } from "./message-thread.js";

type DraftApi = Pick<Api<RawApi>, "sendMessageDraft">;
type SendApi = Pick<Api<RawApi>, "sendMessage" | "deleteMessage">;

interface ActiveThinkingBlockState {
  lastRenderedText: string;
  routingIdentity: string;
}

interface SessionTaskState {
  task: Promise<void>;
}

interface StreamThinkingBlocksOptions {
  sessionId: string;
  draftApi: DraftApi;
  sendApi: SendApi;
  target: TelegramThreadTarget;
  title: string;
  reasoningText: string;
}

interface FinalizeThinkingBlockStreamOptions {
  sessionId: string;
  draftApi: DraftApi;
  sendApi: SendApi;
  target: TelegramThreadTarget;
  title: string;
}

const lifecycle = new ThinkingDraftLifecycle();
const activeBlocks = new Map<string, ActiveThinkingBlockState>();
const sessionTasks = new Map<string, SessionTaskState>();
let allocator: MessageDraftIdAllocator | null = null;

export function configureThinkingBlockDraftIdAllocator(nextAllocator: MessageDraftIdAllocator): void {
  allocator = nextAllocator;
}

function buildRoutingIdentity(target: TelegramThreadTarget): string {
  return `chat:${target.chatId}:thread:${target.messageThreadId ?? "none"}`;
}

function nextDraftId(): number {
  if (!allocator) {
    throw new Error("Thinking block draft allocator is not configured");
  }
  return allocator.next();
}

function runSessionTask(sessionId: string, task: () => Promise<void>): Promise<void> {
  const state = sessionTasks.get(sessionId) ?? { task: Promise.resolve() };
  const nextTask = state.task.catch(() => undefined).then(task).finally(() => {
    if (sessionTasks.get(sessionId)?.task === nextTask) {
      sessionTasks.delete(sessionId);
    }
  });
  state.task = nextTask;
  sessionTasks.set(sessionId, state);
  return nextTask;
}

export async function streamThinkingBlocks(options: StreamThinkingBlocksOptions): Promise<void> {
  if (!options.sessionId || !options.reasoningText.trim()) {
    return;
  }

  await runSessionTask(options.sessionId, async () => {
    const rendered = formatThinkingMessageWithReasoning(options.title, options.reasoningText);
    const routingIdentity = buildRoutingIdentity(options.target);
    const existing = activeBlocks.get(options.sessionId);
    if (
      existing?.lastRenderedText === rendered.text &&
      existing.routingIdentity === routingIdentity
    ) {
      return;
    }

    const draftId = nextDraftId();
    await lifecycle.renderActiveDraft(options.sessionId, rendered.text, {
      chatId: options.target.chatId,
      messageThreadId: options.target.messageThreadId,
      draftId,
      routingIdentity,
      sendMessageDraft: options.draftApi.sendMessageDraft.bind(options.draftApi),
      sendMessage: options.sendApi.sendMessage.bind(options.sendApi),
      deleteMessage: options.sendApi.deleteMessage.bind(options.sendApi),
    });

    activeBlocks.set(options.sessionId, {
      lastRenderedText: rendered.text,
      routingIdentity,
    });
  });
}

export async function finalizeThinkingBlockStream(
  options: FinalizeThinkingBlockStreamOptions,
): Promise<void> {
  await runSessionTask(options.sessionId, async () => {
    const draftId = nextDraftId();
    await lifecycle.finalizeDraft(options.sessionId, {
      chatId: options.target.chatId,
      messageThreadId: options.target.messageThreadId,
      draftId,
      routingIdentity: buildRoutingIdentity(options.target),
      sendMessageDraft: options.draftApi.sendMessageDraft.bind(options.draftApi),
      sendMessage: options.sendApi.sendMessage.bind(options.sendApi),
      deleteMessage: options.sendApi.deleteMessage.bind(options.sendApi),
    });
    activeBlocks.delete(options.sessionId);
  });
}

export async function clearThinkingBlockStream(
  sessionId: string,
  shouldClear = true,
  transport?: Parameters<ThinkingDraftLifecycle["clearActiveDraft"]>[2],
): Promise<void> {
  await runSessionTask(sessionId, async () => {
    if (transport) {
      await lifecycle.clearActiveDraft(sessionId, shouldClear, transport);
    } else {
      lifecycle.clearSession(sessionId);
    }
    activeBlocks.delete(sessionId);
  });
}

export function clearAllThinkingBlockStreams(): void {
  activeBlocks.clear();
  sessionTasks.clear();
  lifecycle.clearAll();
}
```

- [ ] **Step 4: Run the coordinator tests to verify GREEN**

Run: `npm test -- tests/bot/utils/thinking-block-stream.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the draft-first coordinator**

```bash
git add src/bot/utils/thinking-block-stream.ts tests/bot/utils/thinking-block-stream.test.ts
git commit -m "refactor: switch thinking blocks to draft-first streaming"
```

---

### Task 3: Rewire bot integration to use draft-first thinking blocks

**Files:**
- Modify: `src/bot/index.ts`
- Modify: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Add or rewrite focused integration tests first**

```typescript
// Update tests/bot/index.local-file-follow-up.test.ts so the bot-level contract becomes:
// - active reasoning updates call sendMessageDraft rather than sending visible intermediate reasoning messages
// - finalize publishes a normal completed reasoning message via sendMessage
// - next reasoning block starts a fresh draft lifecycle
// - thinkingClearMode only affects active unfinished drafts
// - routing-loss terminal cleanup still drops stale draft/text/tool state and never deletes completed messages
```

- [ ] **Step 2: Run the focused bot integration tests to verify RED**

Run: `npm test -- tests/bot/index.local-file-follow-up.test.ts`
Expected: FAIL because current integration still assumes the previous persistent-message active-block model.

- [ ] **Step 3: Implement the minimal bot integration changes**

```typescript
// In src/bot/index.ts update the thinking-block coordinator call sites:

// Partial updates must pass both draftApi and sendApi.
await streamThinkingBlocks({
  sessionId,
  draftApi: botApi,
  sendApi: botApi,
  target,
  title: t("bot.thinking"),
  reasoningText,
});

// Finalize must publish through sendMessage using the same target.
await finalizeThinkingBlockStream({
  sessionId,
  draftApi: botApi,
  sendApi: botApi,
  target,
  title: t("bot.thinking"),
});

// Forced cleanup paths must build a draft-oriented transport for the active unfinished block.
await clearThinkingBlockStream(sessionId, shouldClearThinkingBlock, {
  chatId: target.chatId,
  messageThreadId: target.messageThreadId,
  draftId: 0,
  routingIdentity: buildThinkingRoutingIdentity(target),
  sendMessageDraft: botApi.sendMessageDraft.bind(botApi),
  sendMessage: botApi.sendMessage.bind(botApi),
  deleteMessage: botApi.deleteMessage.bind(botApi),
});

// Keep the visible placeholder path only for reasoningMode === 0.
// Keep terminal cleanup symmetry across onComplete/onSessionIdle/onSessionError.
```

- [ ] **Step 4: Run the focused bot integration tests to verify GREEN**

Run: `npm test -- tests/bot/index.local-file-follow-up.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the draft-first bot integration**

```bash
git add src/bot/index.ts tests/bot/index.local-file-follow-up.test.ts
git commit -m "fix: publish completed thinking blocks after draft streaming"
```

---

### Task 4: Run verification and review gates

**Files:**
- No code changes expected unless verification or review finds a real issue

- [ ] **Step 1: Run the focused draft-first reasoning regression suite**

Run: `npm test -- tests/bot/utils/thinking-draft-lifecycle.test.ts tests/bot/utils/thinking-block-stream.test.ts tests/bot/index.local-file-follow-up.test.ts tests/bot/utils/thinking-message.test.ts tests/bot/utils/message-draft-stream.test.ts`
Expected: PASS.

- [ ] **Step 2: Run the project build verification**

Run: `npm run build`
Expected: PASS.

- [ ] **Step 3: Run the full project test suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 4: Run security and architecture reviews in parallel**

Use the `task` tool twice in parallel after verification is green.

```text
Security review prompt:
Review these changes for security issues only.

Context:
- Implemented draft-first `thinking-block-stream` where active reasoning uses Telegram `SendMessageDraft` and finalize publishes a normal message.
- Touched files: src/bot/utils/thinking-draft-lifecycle.ts, src/bot/utils/thinking-block-stream.ts, src/bot/index.ts, tests/bot/utils/thinking-draft-lifecycle.test.ts, tests/bot/utils/thinking-block-stream.test.ts, tests/bot/index.local-file-follow-up.test.ts.
- Checks already passed: npm run build, npm test.

Focus on cross-session leakage, cross-chat draft reuse, stale published output after routing loss, malformed state transitions, and misuse of Telegram draft vs normal message APIs.
For each finding, report: severity, file:line, why it matters, exploitability, and the smallest safe fix.
If there are no findings, say so and mention any residual risk.
Do not suggest unrelated refactors.
```

```text
Architecture review prompt:
Review these changes for architecture and complexity quality.

Context:
- Implemented a draft-first thinking-block coordinator and a dedicated draft lifecycle helper.
- Active reasoning now uses `SendMessageDraft`, while completed reasoning is published via `sendMessage` and preserved in chat.
- Touched files: src/bot/utils/thinking-draft-lifecycle.ts, src/bot/utils/thinking-block-stream.ts, src/bot/index.ts, tests/bot/utils/thinking-draft-lifecycle.test.ts, tests/bot/utils/thinking-block-stream.test.ts, tests/bot/index.local-file-follow-up.test.ts.
- Checks already passed: npm run build, npm test.

Focus on cohesion, session-state ownership, lifecycle boundaries, coupling in src/bot/index.ts, and testability. For each finding, report: severity, file:line, why it matters, and the smallest useful refactor.
Keep the focus on maintainability, not style.
```

Expected: either explicit "no findings" or concrete issues to address.

---

## Self-Review

- **Spec coverage:** this plan covers the new draft-first contract: active reasoning through `SendMessageDraft`, finalize through `sendMessage`, completed-message retention, next-block fresh draft lifecycle, and `thinkingClearMode` on only active unfinished drafts.
- **Placeholder scan:** there are no `TODO`, `TBD`, or "implement later" placeholders; each task includes concrete files, commands, and implementation direction.
- **Type consistency:** the plan consistently uses `ThinkingDraftLifecycle`, `streamThinkingBlocks`, `finalizeThinkingBlockStream`, `clearThinkingBlockStream`, and the active-draft vs completed-message distinction throughout.
