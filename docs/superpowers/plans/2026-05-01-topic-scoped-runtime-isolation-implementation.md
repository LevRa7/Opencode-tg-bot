# Topic-Scoped Runtime Isolation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make user-triggered runtime actions affect only the invoking Telegram topic by default, while preparing a safe merge path for later root-abort integration with subagent forum topics from `docs/superpowers/plans/2026-05-01-subagent-topics-and-user-project-defaults.md`.

**Architecture:** Implement topic-scoped isolation first in a way that removes global resets and global session leakage without editing the separate subagent-topics plan. Keep this branch focused on scoped command/runtime behavior. Define explicit extension points so that after the other branch lands, root `/abort` can be expanded into root-tree cleanup, immediate child-topic deletion, active-only subagent cards, topic links, and localized stopped-state rendering without reworking the isolation layer.

**Tech Stack:** TypeScript, Node.js 20, grammY, existing attach/thread/session managers, existing delivery/streaming runtime components, Vitest

---

## Branching Constraint

This plan must **not** modify `docs/superpowers/plans/2026-05-01-subagent-topics-and-user-project-defaults.md` and must not assume that branch is already merged.

Implementation for this branch must therefore be split into two layers:

1. **This branch now** — topic-scoped runtime isolation for user commands and recovery flows, with code structured to allow later subagent-tree integration.
2. **After merge with the subagent-topics branch** — root-abort tree cleanup, immediate child-topic deletion, active-only parent subagent cards, localized topic links, and localized `Subagent was stopped` state.

The code written in this branch should add extension points for later integration, but must not depend on files or APIs that exist only in the other branch unless they are already present in the current branch.

---

## File Structure

### Files to create

- `src/bot/runtime/scope-session-resolver.ts`
  - Resolve the effective session for the current Telegram conversation scope.
- `src/bot/runtime/scoped-runtime-reset.ts`
  - Centralize session-targeted and scope-targeted runtime cleanup helpers, with a forward-compatible extension point for later root-tree cleanup.
- `src/bot/runtime/scope-open-state.ts`
  - Hold `/open` callback-path state per scope instead of process-wide.
- `tests/bot/runtime/scope-session-resolver.test.ts`
  - Unit tests for attached session, thread-bound session, and missing-session resolution.
- `tests/bot/runtime/scoped-runtime-reset.test.ts`
  - Unit tests proving cleanup stays targeted to one session/scope.
- `tests/bot/runtime/scope-open-state.test.ts`
  - Unit tests proving `/open` state is isolated per scope.

### Files to modify in this branch

- `src/bot/commands/abort.ts`
  - Use scoped session resolution and scoped runtime cleanup only for the current topic session.
- `src/summary/aggregator.ts`
  - Add session-targeted cleanup helpers instead of relying on `clear()` for command flows.
- `src/thread/manager.ts`
  - Add active-scope cleanup for `/start`.
- `src/bot/commands/start.ts`
  - Reset only the active topic, never all thread bindings.
- `src/bot/handlers/prompt.ts`
  - Replace global mismatch reset with scoped session/runtime reset.
- `src/bot/commands/commands.ts`
  - Replace mismatch cleanup and session switching side effects with targeted cleanup.
- `src/bot/commands/sessions.ts`
  - Replace global runtime clear on session switch.
- `src/bot/commands/new.ts`
  - Replace global runtime clear on new-session attach.
- `src/bot/commands/projects.ts`
  - Replace global runtime clear on project switch.
- `src/bot/utils/switch-project.ts`
  - Replace shared global reset path with scoped runtime cleanup.
- `src/bot/commands/open.ts`
  - Use scope-keyed callback-path storage.
- `src/bot/index.ts`
  - Stop clearing `/open` path state globally on every inline cancel.
- `tests/bot/commands/abort.test.ts`
- `tests/thread/manager.test.ts`
- `tests/bot/commands/start.test.ts`
- `tests/bot/handlers/prompt-deferred-follow-up.test.ts`
- `tests/bot/commands/commands.test.ts`
- `tests/bot/commands/sessions.test.ts`
- `tests/bot/commands/new.test.ts`
- `tests/bot/commands/projects.handle-project-select.test.ts`
- `tests/bot/utils/switch-project.test.ts`
- `tests/bot/commands/open.test.ts`
- `tests/summary/aggregator.test.ts`
- `CHANGELOG.md`
  - Record the topic-scoped runtime isolation bug fix.
- `PRODUCT.md`
  - Update behavior notes for topic-scoped command/runtime isolation.

### Files intentionally not modified in this branch

- `docs/superpowers/plans/2026-05-01-subagent-topics-and-user-project-defaults.md`
- `src/bot/subagent-topics/service.ts` unless it already exists in the current branch and you are adding only optional adapters that do not change its behavior
- `src/summary/subagent-formatter.ts` for active-only parent-card rendering
- locale files for subagent topic link or stopped-state strings

Those changes belong to the follow-up integration slice after the other branch is merged.

---

### Task 1: Add scoped session resolution and make `/abort` topic-scoped in this branch

**Files:**

- Create: `src/bot/runtime/scope-session-resolver.ts`
- Create: `tests/bot/runtime/scope-session-resolver.test.ts`
- Modify: `src/bot/commands/abort.ts`
- Modify: `tests/bot/commands/abort.test.ts`

- [ ] **Step 1: Write the failing scoped-session tests**

Create `tests/bot/runtime/scope-session-resolver.test.ts` with this code:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

const mocked = vi.hoisted(() => ({
  attachedSession: null as { id: string; title: string; directory: string } | null,
  currentSession: null as { id: string; title: string; directory: string } | null,
}));

vi.mock("../../../src/attach/manager.js", () => ({
  attachManager: {
    getAttachedSession: vi.fn(() => mocked.attachedSession),
  },
}));

vi.mock("../../../src/session/manager.js", () => ({
  getCurrentSession: vi.fn(() => mocked.currentSession),
}));

import { resolveScopedSessionFromContext } from "../../../src/bot/runtime/scope-session-resolver.js";

function createContext(messageThreadId?: number): Context {
  return {
    from: { id: 1 },
    chat: { id: 777, type: "supergroup", is_forum: true },
    message:
      typeof messageThreadId === "number"
        ? ({ message_thread_id: messageThreadId } as Context["message"])
        : ({} as Context["message"]),
  } as unknown as Context;
}

describe("bot/runtime/scope-session-resolver", () => {
  beforeEach(() => {
    mocked.attachedSession = null;
    mocked.currentSession = null;
  });

  it("prefers the attached topic session over current scoped session", () => {
    mocked.attachedSession = { id: "attached", title: "Attached", directory: "/repo-a" };
    mocked.currentSession = { id: "current", title: "Current", directory: "/repo-b" };

    expect(resolveScopedSessionFromContext(createContext(10))).toEqual({
      id: "attached",
      title: "Attached",
      directory: "/repo-a",
    });
  });

  it("falls back to the scoped current session when no attached session exists", () => {
    mocked.currentSession = { id: "current", title: "Current", directory: "/repo-b" };

    expect(resolveScopedSessionFromContext(createContext(20))).toEqual({
      id: "current",
      title: "Current",
      directory: "/repo-b",
    });
  });

  it("returns null when the current topic has no session", () => {
    expect(resolveScopedSessionFromContext(createContext(30))).toBeNull();
  });
});
```

Then add these tests to `tests/bot/commands/abort.test.ts`:

```ts
it("aborts the session attached to the invoking topic instead of a different global session", async () => {
  const topicAScope = { userId: 1, chatId: 777, messageThreadId: 10 };
  const topicBScope = { userId: 1, chatId: 777, messageThreadId: 20 };
  const topicASession = { id: "session-a", title: "Topic A", directory: "D:/repo-a" };
  const topicBSession = { id: "session-b", title: "Topic B", directory: "D:/repo-b" };

  mocked.currentSession = topicBSession;
  attachManager.attach(topicAScope, topicASession);
  attachManager.attach(topicBScope, topicBSession);
  mocked.abortMock.mockResolvedValue({ data: true, error: null });
  mocked.statusMock.mockResolvedValue({ data: { "session-a": { type: "idle" } }, error: null });

  const ctx = {
    from: { id: 1 },
    chat: { id: 777 },
    message: { message_thread_id: 10 },
    reply: vi.fn().mockResolvedValue({ message_id: 88 }),
    api: { editMessageText: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Context;

  await abortCommand(ctx as never);

  expect(mocked.abortMock).toHaveBeenCalledWith(
    { sessionID: "session-a", directory: "D:/repo-a" },
    expect.any(Object),
  );
});

it("does not abort another topic when the current topic has no attached session", async () => {
  const otherScope = { userId: 1, chatId: 777, messageThreadId: 20 };
  attachManager.attach(otherScope, { id: "session-b", title: "Topic B", directory: "D:/repo-b" });
  mocked.currentSession = null;

  const replyMock = vi.fn().mockResolvedValue(undefined);
  const ctx = {
    from: { id: 1 },
    chat: { id: 777 },
    message: { message_thread_id: 10 },
    reply: replyMock,
  } as unknown as Context;

  await abortCommand(ctx as never);

  expect(mocked.abortMock).not.toHaveBeenCalled();
  expect(replyMock).toHaveBeenCalledWith(t("stop.no_active_session"), { message_thread_id: 10 });
});
```

- [ ] **Step 2: Run the focused abort tests and verify they fail**

Run:

```bash
npx vitest run tests/bot/runtime/scope-session-resolver.test.ts tests/bot/commands/abort.test.ts
```

Expected: FAIL with import/module errors for `scope-session-resolver` and assertion failures showing `/abort` still uses the wrong session.

- [ ] **Step 3: Implement scoped session resolution and use scoped cleanup hooks only**

Create `src/bot/runtime/scope-session-resolver.ts` with this code:

```ts
import type { Context } from "grammy";
import { attachManager } from "../../attach/manager.js";
import { getCurrentSession, type SessionInfo } from "../../session/manager.js";
import { extractTelegramConversationScopeFromContext } from "../../telegram/scope.js";

export function resolveScopedSessionFromContext(ctx: Context): SessionInfo | null {
  const scope = extractTelegramConversationScopeFromContext(ctx);
  if (!scope) {
    return null;
  }

  const attachedSession = attachManager.getAttachedSession(scope);
  if (attachedSession) {
    return attachedSession;
  }

  return getCurrentSession();
}
```

Modify `src/bot/commands/abort.ts` so it resolves only the invoking topic session and calls a branch-local cleanup helper for that one session:

```ts
import { resolveScopedSessionFromContext } from "../runtime/scope-session-resolver.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";

const currentSession = resolveScopedSessionFromContext(ctx);
if (!currentSession) {
  clearAllInteractionState("abort_command");
  if (notifyUser) {
    await ctx.reply(t("stop.no_active_session"), withMessageThreadId(undefined, messageThreadId));
  }
  return;
}

if (abortResult === true) {
  await clearScopedSessionRuntime(currentSession.id, "abort_command");
}
```

Do not add child-session-tree cleanup in this branch. Instead, add a short inline comment near the cleanup call stating that root-tree abort expansion happens in the post-merge integration slice.

- [ ] **Step 4: Re-run the focused abort tests and verify they pass**

Run:

```bash
npx vitest run tests/bot/runtime/scope-session-resolver.test.ts tests/bot/commands/abort.test.ts
```

Expected: PASS with `/abort` targeting only the invoking topic session in this branch.

- [ ] **Step 5: Commit the scoped-abort slice if commits are requested for the execution session**

```bash
git add src/bot/runtime/scope-session-resolver.ts src/bot/commands/abort.ts tests/bot/runtime/scope-session-resolver.test.ts tests/bot/commands/abort.test.ts
git commit -m "fix: scope abort to the invoking topic"
```

### Task 2: Add session-targeted runtime cleanup and a forward-compatible tree-cleanup extension point

**Files:**

- Create: `src/bot/runtime/scoped-runtime-reset.ts`
- Create: `tests/bot/runtime/scoped-runtime-reset.test.ts`
- Modify: `src/summary/aggregator.ts`
- Modify: `tests/summary/aggregator.test.ts`

- [ ] **Step 1: Write the failing targeted-cleanup tests**

Create `tests/bot/runtime/scoped-runtime-reset.test.ts` with this code:

```ts
import { describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  clearAggregatorSessionMock: vi.fn(),
  clearToolMessagesMock: vi.fn(),
  clearToolCallsMock: vi.fn(),
  clearResponseStreamerMock: vi.fn(),
  clearDraftStreamMock: vi.fn(),
  clearDeliveryMock: vi.fn(),
  clearFollowUpsMock: vi.fn(),
  clearAssistantRunMock: vi.fn(),
  clearThinkingBlockMock: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/summary/aggregator.js", () => ({
  summaryAggregator: { clearSession: mocked.clearAggregatorSessionMock },
}));
vi.mock("../../../src/summary/tool-message-batcher.js", () => ({
  toolMessageBatcher: { clearSession: mocked.clearToolMessagesMock },
}));
vi.mock("../../../src/bot/streaming/tool-call-streamer.js", () => ({
  toolCallStreamer: { clearSession: mocked.clearToolCallsMock },
}));
vi.mock("../../../src/bot/streaming/response-streamer.js", () => ({
  responseStreamer: { clearSession: mocked.clearResponseStreamerMock },
}));
vi.mock("../../../src/bot/utils/message-draft-stream.js", () => ({
  messageDraftStreamManager: { clearSession: mocked.clearDraftStreamMock },
}));
vi.mock("../../../src/bot/delivery/session-delivery-orchestrator.js", () => ({
  finalAssistantDeliveryOrchestrator: { clearSession: mocked.clearDeliveryMock },
}));
vi.mock("../../../src/bot/utils/telegram-local-file-follow-up.js", () => ({
  localFileFollowUpTracker: { clearSession: mocked.clearFollowUpsMock },
}));
vi.mock("../../../src/bot/assistant-run-state.js", () => ({
  assistantRunState: { clearRun: mocked.clearAssistantRunMock },
}));
vi.mock("../../../src/bot/utils/thinking-block-stream.js", () => ({
  clearThinkingBlockStream: mocked.clearThinkingBlockMock,
}));

import {
  clearScopedSessionRuntime,
  clearSessionTreeRuntime,
} from "../../../src/bot/runtime/scoped-runtime-reset.js";

describe("bot/runtime/scoped-runtime-reset", () => {
  it("clears only the addressed session runtime", async () => {
    await clearScopedSessionRuntime("session-1", "abort_command");

    expect(mocked.clearAggregatorSessionMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearToolMessagesMock).toHaveBeenCalledWith("session-1", "abort_command");
    expect(mocked.clearToolCallsMock).toHaveBeenCalledWith("session-1", "abort_command");
    expect(mocked.clearResponseStreamerMock).toHaveBeenCalledWith("session-1", "abort_command");
    expect(mocked.clearDraftStreamMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearDeliveryMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearFollowUpsMock).toHaveBeenCalledWith("session-1");
    expect(mocked.clearAssistantRunMock).toHaveBeenCalledWith("session-1", "abort_command");
    expect(mocked.clearThinkingBlockMock).toHaveBeenCalledWith("session-1", true, undefined);
  });

  it("keeps the tree cleanup stub behavior explicit until the subagent-topics branch is merged", async () => {
    await clearSessionTreeRuntime("root-session", "abort_command");

    expect(mocked.clearAggregatorSessionMock).toHaveBeenCalledWith("root-session");
  });
});
```

Add this test to `tests/summary/aggregator.test.ts`:

```ts
it("clears only one tracked session without dropping other tracked roots", () => {
  summaryAggregator.setSession("root-a");
  summaryAggregator.setSession("root-b");

  summaryAggregator.clearSession("root-a");

  expect(summaryAggregator.getCurrentSessionId()).toBe("root-b");
});
```

- [ ] **Step 2: Run the focused cleanup tests and verify they fail**

Run:

```bash
npx vitest run tests/bot/runtime/scoped-runtime-reset.test.ts tests/summary/aggregator.test.ts
```

Expected: FAIL because `summaryAggregator.clearSession(...)`, `getCurrentSessionId()`, and `clearSessionTreeRuntime(...)` do not exist yet.

- [ ] **Step 3: Implement session cleanup and an explicit tree-cleanup extension point**

Modify `src/summary/aggregator.ts` to add:

```ts
setSession(sessionId: string): void {
  if (!this.trackedSessionParents.has(sessionId)) {
    this.trackedSessionParents.set(sessionId, null);
  }

  this.activeRootSessionIds.add(sessionId);
  this.currentSessionId = sessionId;
}

getCurrentSessionId(): string | null {
  return this.currentSessionId;
}

clearSession(sessionId: string): void {
  for (const [messageId, state] of Array.from(this.textMessageStates.entries())) {
    if (state.sessionId !== sessionId) {
      continue;
    }

    this.textMessageStates.delete(messageId);
    this.messages.delete(messageId);
    this.partHashes.delete(messageId);
    this.knownTextPartIds.delete(messageId);
    this.thinkingFiredForMessages.delete(messageId);
  }

  this.activeRootSessionIds.delete(sessionId);
  this.trackedSessionParents.delete(sessionId);
  this.subagentCardIdBySessionId.delete(sessionId);

  if (this.currentSessionId === sessionId) {
    this.currentSessionId = [...this.activeRootSessionIds].at(-1) ?? null;
  }
}
```

Create `src/bot/runtime/scoped-runtime-reset.ts` with this code:

```ts
import { summaryAggregator } from "../../summary/aggregator.js";
import { toolMessageBatcher } from "../../summary/tool-message-batcher.js";
import { toolCallStreamer } from "../streaming/tool-call-streamer.js";
import { responseStreamer } from "../streaming/response-streamer.js";
import { messageDraftStreamManager } from "../utils/message-draft-stream.js";
import { finalAssistantDeliveryOrchestrator } from "../delivery/session-delivery-orchestrator.js";
import { localFileFollowUpTracker } from "../utils/telegram-local-file-follow-up.js";
import { assistantRunState } from "../assistant-run-state.js";
import { clearThinkingBlockStream } from "../utils/thinking-block-stream.js";

export async function clearScopedSessionRuntime(sessionId: string, reason: string): Promise<void> {
  summaryAggregator.clearSession(sessionId);
  toolMessageBatcher.clearSession(sessionId, reason);
  toolCallStreamer.clearSession(sessionId, reason);
  responseStreamer.clearSession(sessionId, reason);
  messageDraftStreamManager.clearSession(sessionId);
  finalAssistantDeliveryOrchestrator.clearSession(sessionId);
  localFileFollowUpTracker.clearSession(sessionId);
  assistantRunState.clearRun(sessionId, reason);
  await clearThinkingBlockStream(sessionId, true);
}

export async function clearSessionTreeRuntime(
  rootSessionId: string,
  reason: string,
): Promise<void> {
  // Forward-compatible extension point: after the subagent-topics branch lands,
  // expand this helper to clean child sessions and delete child topics.
  await clearScopedSessionRuntime(rootSessionId, reason);
}
```

This branch intentionally keeps `clearSessionTreeRuntime(...)` as a single-session adapter so later merge work can widen it safely without changing call sites.

- [ ] **Step 4: Re-run the focused cleanup tests and verify they pass**

Run:

```bash
npx vitest run tests/bot/runtime/scoped-runtime-reset.test.ts tests/summary/aggregator.test.ts
```

Expected: PASS with targeted session cleanup and an explicit integration hook for later tree cleanup.

- [ ] **Step 5: Commit the runtime-cleanup slice if commits are requested for the execution session**

```bash
git add src/summary/aggregator.ts src/bot/runtime/scoped-runtime-reset.ts tests/bot/runtime/scoped-runtime-reset.test.ts tests/summary/aggregator.test.ts
git commit -m "refactor: add scoped runtime cleanup hooks"
```

### Task 3: Replace global reset paths in `/start`, prompt mismatch, and `/commands`

**Files:**

- Modify: `src/thread/manager.ts`
- Modify: `src/bot/commands/start.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Modify: `src/bot/commands/commands.ts`
- Modify: `tests/thread/manager.test.ts`
- Modify: `tests/bot/commands/start.test.ts`
- Modify: `tests/bot/handlers/prompt-deferred-follow-up.test.ts`
- Modify: `tests/bot/commands/commands.test.ts`

- [ ] **Step 1: Write the failing scoped-reset tests**

Add this test to `tests/thread/manager.test.ts`:

```ts
it("clears only the active context bindings without wiping other topics", () => {
  threadContextManager.activateFromContext(createMessageContext(-100100, 10));
  threadContextManager.bindProjectToActiveContext({ id: "project-a", worktree: "/repo-a" });
  threadContextManager.bindSessionToActiveContext({
    id: "session-a",
    title: "A",
    directory: "/repo-a",
  });

  threadContextManager.activateFromContext(createMessageContext(-100100, 20));
  threadContextManager.bindProjectToActiveContext({ id: "project-b", worktree: "/repo-b" });
  threadContextManager.bindSessionToActiveContext({
    id: "session-b",
    title: "B",
    directory: "/repo-b",
  });

  threadContextManager.activateFromContext(createMessageContext(-100100, 10));
  threadContextManager.clearActiveContext("topic_reset");

  expect(threadContextManager.getSessionTarget("session-a")).toBeNull();
  expect(threadContextManager.getSessionTarget("session-b")).toEqual({
    chatId: -100100,
    messageThreadId: 20,
  });
});
```

Update `tests/bot/commands/start.test.ts`:

```ts
expect(mocked.threadClearAllMock).not.toHaveBeenCalled();
expect(mocked.threadClearActiveContextMock).toHaveBeenCalledWith("start_command_reset");
```

Add this test to `tests/bot/commands/commands.test.ts`:

```ts
it("does not call global summary clear when resetting a mismatched topic session", async () => {
  mocked.currentProject = { id: "project-2", worktree: "D:\\Other" };
  mocked.currentSession = { id: "session-1", title: "Session", directory: "D:\\Projects\\Repo" };

  const ctx = createTextContext("build this", 42);
  await handleCommandTextArguments(ctx as never, createDeps());

  expect(mocked.clearSummaryMock).not.toHaveBeenCalled();
  expect(mocked.threadClearSessionForActiveContextMock).toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused mismatch/start tests and verify they fail**

Run:

```bash
npx vitest run tests/thread/manager.test.ts tests/bot/commands/start.test.ts tests/bot/handlers/prompt-deferred-follow-up.test.ts tests/bot/commands/commands.test.ts
```

Expected: FAIL because `threadContextManager.clearActiveContext(...)` does not exist and mismatch code still calls global summary reset.

- [ ] **Step 3: Implement active-scope cleanup and scoped mismatch reset**

Add this method to `src/thread/manager.ts`:

```ts
clearActiveContext(reason: string): void {
  this.ensureHydrated();

  if (!this.activeContextKey) {
    return;
  }

  logger.info(`[ThreadContext] Clearing active context: reason=${reason}, context=${this.activeContextKey}`);

  const previousSession = this.sessionByContext.get(this.activeContextKey);
  if (previousSession) {
    this.scopeBySessionId.delete(previousSession.id);
  }

  this.projectByContext.delete(this.activeContextKey);
  this.sessionByContext.delete(this.activeContextKey);
  this.agentByContext.delete(this.activeContextKey);
  this.modelByContext.delete(this.activeContextKey);
  this.persistBindings();
}
```

Modify `src/bot/commands/start.ts` to use this reset block:

```ts
await abortCurrentOperation(ctx, { notifyUser: false });
foregroundSessionState.clearAll("start_command_reset");

clearSession();
clearProject();
threadContextManager.clearActiveContext("start_command_reset");
keyboardManager.clearContext();
await pinnedMessageManager.clear();
```

Modify `src/bot/handlers/prompt.ts` to use scoped mismatch reset:

```ts
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";

async function resetMismatchedSessionContext(sessionId?: string): Promise<void> {
  if (sessionId) {
    await clearScopedSessionRuntime(sessionId, "session_mismatch_reset");
    foregroundSessionState.markIdle(sessionId, attachManager.getScopeForSession(sessionId));
  }

  clearAllInteractionState("session_mismatch_reset");
  clearSession();
  threadContextManager.clearSessionForActiveContext();
  keyboardManager.clearContext();

  if (!pinnedMessageManager.isInitialized()) {
    return;
  }

  await pinnedMessageManager.clear();
}
```

Modify `src/bot/commands/commands.ts` to use this mismatch block:

```ts
if (currentSession && currentSession.directory !== projectDirectory) {
  foregroundSessionState.markIdle(
    currentSession.id,
    attachManager.getScopeForSession(currentSession.id),
  );
  await clearScopedSessionRuntime(currentSession.id, "session_project_mismatch");
  clearSession();
  threadContextManager.clearSessionForActiveContext();
  await ctx.reply(t("bot.session_reset_project_mismatch"), threadOptions);
  currentSession = null;
}
```

- [ ] **Step 4: Re-run the focused mismatch/start tests and verify they pass**

Run:

```bash
npx vitest run tests/thread/manager.test.ts tests/bot/commands/start.test.ts tests/bot/handlers/prompt-deferred-follow-up.test.ts tests/bot/commands/commands.test.ts
```

Expected: PASS with no global thread wipe and no global summary clear in mismatch flows.

- [ ] **Step 5: Commit the scoped-reset slice if commits are requested for the execution session**

```bash
git add src/thread/manager.ts src/bot/commands/start.ts src/bot/handlers/prompt.ts src/bot/commands/commands.ts tests/thread/manager.test.ts tests/bot/commands/start.test.ts tests/bot/handlers/prompt-deferred-follow-up.test.ts tests/bot/commands/commands.test.ts
git commit -m "fix: scope topic reset paths"
```

### Task 4: Migrate session and project switching flows to targeted cleanup

**Files:**

- Modify: `src/bot/commands/sessions.ts`
- Modify: `src/bot/commands/new.ts`
- Modify: `src/bot/commands/projects.ts`
- Modify: `src/bot/utils/switch-project.ts`
- Modify: `tests/bot/commands/sessions.test.ts`
- Modify: `tests/bot/commands/new.test.ts`
- Modify: `tests/bot/commands/projects.handle-project-select.test.ts`
- Modify: `tests/bot/utils/switch-project.test.ts`

- [ ] **Step 1: Write the failing switch-flow tests**

Update `tests/bot/utils/switch-project.test.ts`:

```ts
expect(mocked.summaryAggregatorClearMock).not.toHaveBeenCalled();
expect(mocked.clearScopedSessionRuntimeMock).toHaveBeenCalledWith("session-1", "test_reason");
```

Add this test to `tests/bot/commands/sessions.test.ts`:

```ts
it("does not call global summary clear when switching the current topic session", async () => {
  mocked.sessionGetMock.mockResolvedValueOnce({
    data: { id: "session-2", title: "Session 2" },
    error: null,
  });

  interactionManager.start({
    kind: "inline",
    expectedInput: "callback",
    metadata: { menuKind: "session", messageId: 456 },
  });

  const ctx = createCallbackContext("session:session-2", 456);
  const handled = await handleSessionSelect(ctx);

  expect(handled).toBe(true);
  expect(mocked.clearSummaryMock).not.toHaveBeenCalled();
  expect(mocked.clearScopedSessionRuntimeMock).toHaveBeenCalled();
});
```

Add this test to `tests/bot/commands/new.test.ts`:

```ts
it("does not clear global summary state when attaching a new session to the topic", async () => {
  mocked.sessionCreateMock.mockResolvedValue({
    data: { id: "session-1", title: "Scoped Session" },
    error: null,
  });

  const ctx = createContext();
  await newCommand(ctx as never);

  expect(mocked.clearSummaryMock).not.toHaveBeenCalled();
  expect(mocked.clearScopedSessionRuntimeMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the focused switch-flow tests and verify they fail**

Run:

```bash
npx vitest run tests/bot/commands/sessions.test.ts tests/bot/commands/new.test.ts tests/bot/commands/projects.handle-project-select.test.ts tests/bot/utils/switch-project.test.ts
```

Expected: FAIL because the command flows still call `summaryAggregator.clear()` directly and do not use the scoped reset helper.

- [ ] **Step 3: Replace global reset calls in session/project switching flows**

Modify `src/bot/commands/sessions.ts` to use this block:

```ts
import { getCurrentSession } from "../../session/manager.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { attachManager } from "../../attach/manager.js";

const previousSession = getCurrentSession();
if (previousSession && previousSession.id !== sessionInfo.id) {
  await clearScopedSessionRuntime(previousSession.id, "session_switched");
  foregroundSessionState.markIdle(
    previousSession.id,
    attachManager.getScopeForSession(previousSession.id),
  );
}

setCurrentSession(sessionInfo);
const activeScope = threadContextManager.getActiveScope();
if (activeScope) {
  await attachSessionForScope({
    scope: activeScope,
    session: sessionInfo,
    reason: "selected_session",
    restoreQuestion: () =>
      showCurrentQuestion(ctx.api, activeScope.chatId, activeScope.messageThreadId),
    restorePermission: (request) =>
      showPermissionRequest(ctx.api, activeScope.chatId, request, activeScope.messageThreadId),
  });
}
clearAllInteractionState("session_switched");
```

Modify `src/bot/commands/new.ts` to use this block:

```ts
import { getCurrentSession, setCurrentSession } from "../../session/manager.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";
import { attachManager } from "../../attach/manager.js";

const previousSession = getCurrentSession();
if (previousSession) {
  await clearScopedSessionRuntime(previousSession.id, "session_created");
  foregroundSessionState.markIdle(
    previousSession.id,
    attachManager.getScopeForSession(previousSession.id),
  );
}

setCurrentSession(sessionInfo);
const activeScope = threadContextManager.getActiveScope();
if (activeScope) {
  await attachSessionForScope({
    scope: activeScope,
    session: sessionInfo,
    reason: "new_session",
    restoreQuestion: () =>
      showCurrentQuestion(ctx.api, activeScope.chatId, activeScope.messageThreadId),
    restorePermission: (request) =>
      showPermissionRequest(ctx.api, activeScope.chatId, request, activeScope.messageThreadId),
  });
}
await ingestSessionInfoForCache(session);
clearAllInteractionState("session_created");
```

Modify `src/bot/utils/switch-project.ts` to use this exact body:

```ts
import { getCurrentSession } from "../../session/manager.js";
import { clearScopedSessionRuntime } from "../runtime/scoped-runtime-reset.js";

export async function switchToProject(ctx: Context, project: ProjectInfo, reason: string) {
  const previousSession = getCurrentSession();
  if (previousSession) {
    await clearScopedSessionRuntime(previousSession.id, reason);
  }

  setCurrentProject(project);
  clearSession();
  clearAllInteractionState(reason);

  try {
    await pinnedMessageManager.clear();
  } catch (err) {
    logger.error("[Bot] Error clearing pinned message:", err);
  }

  if (ctx.chat) {
    keyboardManager.initialize(ctx.api, ctx.chat.id);
  }

  await pinnedMessageManager.refreshContextLimit();
  const contextLimit = pinnedMessageManager.getContextLimit();
  keyboardManager.updateContext(0, contextLimit);

  const currentAgent = await resolveProjectAgent(getStoredAgent());
  const currentModel = getStoredModel();
  const contextInfo = { tokensUsed: 0, tokensLimit: contextLimit };
  const variantName = formatVariantForButton(currentModel.variant || "default");
  keyboardManager.updateAgent(currentAgent);

  return createMainKeyboard(currentAgent, currentModel, contextInfo, variantName);
}
```

Modify `src/bot/commands/projects.ts` to use this block:

```ts
threadContextManager.bindProjectToActiveContext(selectedProject);

const replyKeyboard = await switchToProject(ctx, selectedProject, "project_switched");
threadContextManager.clearSessionForActiveContext();

const projectName = selectedProject.name || selectedProject.worktree;

await ctx.answerCallbackQuery();
await ctx.reply(
  t("projects.selected", { project: projectName }),
  withMessageThreadId({ reply_markup: replyKeyboard }, extractMessageThreadIdFromContext(ctx)),
);

await ctx.deleteMessage();
```

- [ ] **Step 4: Re-run the focused switch-flow tests and verify they pass**

Run:

```bash
npx vitest run tests/bot/commands/sessions.test.ts tests/bot/commands/new.test.ts tests/bot/commands/projects.handle-project-select.test.ts tests/bot/utils/switch-project.test.ts
```

Expected: PASS with no command-level `summaryAggregator.clear()` usage.

- [ ] **Step 5: Commit the session/project switch slice if commits are requested for the execution session**

```bash
git add src/bot/commands/sessions.ts src/bot/commands/new.ts src/bot/commands/projects.ts src/bot/utils/switch-project.ts tests/bot/commands/sessions.test.ts tests/bot/commands/new.test.ts tests/bot/commands/projects.handle-project-select.test.ts tests/bot/utils/switch-project.test.ts
git commit -m "fix: isolate session and project switches by topic"
```

### Task 5: Make `/open` callback-path state scope-local

**Files:**

- Create: `src/bot/runtime/scope-open-state.ts`
- Create: `tests/bot/runtime/scope-open-state.test.ts`
- Modify: `src/bot/commands/open.ts`
- Modify: `src/bot/index.ts`
- Modify: `tests/bot/commands/open.test.ts`

- [ ] **Step 1: Write the failing scope-local `/open` state tests**

Create `tests/bot/runtime/scope-open-state.test.ts` with this code:

```ts
import { describe, expect, it } from "vitest";
import {
  clearScopeOpenPathIndex,
  encodeScopedPathReference,
  decodeScopedPathReference,
} from "../../../src/bot/runtime/scope-open-state.js";

describe("bot/runtime/scope-open-state", () => {
  it("keeps indexed paths isolated per scope", () => {
    const longPathA = "/workspace/" + "a".repeat(80);
    const longPathB = "/workspace/" + "b".repeat(80);

    const encodedA = encodeScopedPathReference("1:777:10", longPathA);
    const encodedB = encodeScopedPathReference("1:777:20", longPathB);

    expect(decodeScopedPathReference("1:777:10", encodedA)).toBe(longPathA);
    expect(decodeScopedPathReference("1:777:20", encodedB)).toBe(longPathB);
    expect(decodeScopedPathReference("1:777:10", encodedB)).toBeNull();
  });

  it("clears only one scope index", () => {
    const longPathA = "/workspace/" + "a".repeat(80);
    const encodedA = encodeScopedPathReference("1:777:10", longPathA);

    clearScopeOpenPathIndex("1:777:10");

    expect(decodeScopedPathReference("1:777:10", encodedA)).toBeNull();
  });
});
```

Update `tests/bot/commands/open.test.ts` with this test:

```ts
it("does not let one topic invalidate another topic's indexed callback", async () => {
  const longPath = "/home/user/" + "x".repeat(60);
  mocked.scanDirectoryMock.mockResolvedValue(
    makeScanResult([{ name: "x".repeat(60), fullPath: longPath }], "/home/user"),
  );

  const topicA = createCommandContext();
  (topicA as unknown as { from?: { id: number }; message?: { message_thread_id?: number } }).from =
    { id: 1 };
  (topicA as unknown as { message?: { message_thread_id?: number } }).message = {
    message_thread_id: 10,
  };
  await openCommand(topicA as never);

  const callbackData = (topicA.reply as ReturnType<typeof vi.fn>).mock.calls[0][1]?.reply_markup
    ?.inline_keyboard?.[0]?.[0]?.callback_data as string;

  const topicB = createCommandContext();
  (topicB as unknown as { from?: { id: number }; message?: { message_thread_id?: number } }).from =
    { id: 1 };
  (topicB as unknown as { message?: { message_thread_id?: number } }).message = {
    message_thread_id: 20,
  };
  await openCommand(topicB as never);

  mocked.scanDirectoryMock.mockReset();
  mocked.scanDirectoryMock.mockResolvedValue(makeScanResult([], longPath));

  const navCtx = createCallbackContext(callbackData);
  (
    navCtx as unknown as {
      from?: { id: number };
      callbackQuery?: { message?: { message_thread_id?: number } };
    }
  ).from = { id: 1 };
  (
    navCtx.callbackQuery as unknown as {
      message: { message_id: number; message_thread_id?: number };
    }
  ).message.message_thread_id = 10;

  const result = await handleOpenCallback(navCtx);
  expect(result).toBe(true);
  expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(longPath, 0);
});
```

- [ ] **Step 2: Run the focused `/open` state tests and verify they fail**

Run:

```bash
npx vitest run tests/bot/runtime/scope-open-state.test.ts tests/bot/commands/open.test.ts
```

Expected: FAIL because `/open` still uses the shared module-level `pathIndex` map.

- [ ] **Step 3: Move `/open` path indexing into scope-keyed storage**

Create `src/bot/runtime/scope-open-state.ts` with this code:

```ts
const pathIndexByScope = new Map<string, Map<string, string>>();
const counterByScope = new Map<string, number>();

function getScopeIndex(scopeKey: string): Map<string, string> {
  const existing = pathIndexByScope.get(scopeKey);
  if (existing) {
    return existing;
  }

  const created = new Map<string, string>();
  pathIndexByScope.set(scopeKey, created);
  return created;
}

export function clearScopeOpenPathIndex(scopeKey: string): void {
  pathIndexByScope.delete(scopeKey);
  counterByScope.delete(scopeKey);
}

export function encodeScopedPathReference(scopeKey: string, fullPath: string): string {
  const nextCounter = counterByScope.get(scopeKey) ?? 0;
  const key = `#${nextCounter}`;
  counterByScope.set(scopeKey, nextCounter + 1);
  getScopeIndex(scopeKey).set(key, fullPath);
  return key;
}

export function decodeScopedPathReference(scopeKey: string, reference: string): string | null {
  return pathIndexByScope.get(scopeKey)?.get(reference) ?? null;
}
```

Modify `src/bot/commands/open.ts` to add:

```ts
import {
  clearScopeOpenPathIndex,
  encodeScopedPathReference,
  decodeScopedPathReference,
} from "../runtime/scope-open-state.js";
import { getCurrentTelegramConversationScopeKey } from "../../telegram/scope.js";

function encodePathForCallback(
  scopeKey: string,
  prefix: string,
  fullPath: string,
  reserveBytes: number = 0,
): string {
  const naive = `${prefix}${fullPath}`;
  if (Buffer.byteLength(naive, "utf-8") + reserveBytes <= 64) {
    return naive;
  }

  const key = encodeScopedPathReference(scopeKey, fullPath);
  return `${prefix}${key}`;
}

function decodePathFromCallback(scopeKey: string, prefix: string, data: string): string | null {
  if (!data.startsWith(prefix)) {
    return null;
  }

  const raw = data.slice(prefix.length);
  if (raw.startsWith("#")) {
    return decodeScopedPathReference(scopeKey, raw);
  }

  return raw;
}
```

Then update the entrypoints:

```ts
export async function openCommand(ctx: CommandContext<Context>) {
  const scopeKey = getCurrentTelegramConversationScopeKey();
  clearScopeOpenPathIndex(scopeKey);
  // call encodePathForCallback(scopeKey, ...) for every callback path
}

export async function handleOpenCallback(ctx: Context): Promise<boolean> {
  const scopeKey = getCurrentTelegramConversationScopeKey();
  // call decodePathFromCallback(scopeKey, ...) for every callback path
}
```

Modify `src/bot/index.ts`:

```ts
import { getCurrentTelegramConversationScopeKey } from "../telegram/scope.js";
import { clearScopeOpenPathIndex } from "./runtime/scope-open-state.js";

if (handledInlineCancel) {
  clearScopeOpenPathIndex(getCurrentTelegramConversationScopeKey());
}
```

- [ ] **Step 4: Re-run the focused `/open` state tests and verify they pass**

Run:

```bash
npx vitest run tests/bot/runtime/scope-open-state.test.ts tests/bot/commands/open.test.ts
```

Expected: PASS with callback-path indexes isolated by topic.

- [ ] **Step 5: Commit the scoped-open-state slice if commits are requested for the execution session**

```bash
git add src/bot/runtime/scope-open-state.ts src/bot/commands/open.ts src/bot/index.ts tests/bot/runtime/scope-open-state.test.ts tests/bot/commands/open.test.ts
git commit -m "fix: scope open browser state by topic"
```

### Task 6: Update docs, run branch-local verification, and record the post-merge integration contract

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `PRODUCT.md`

- [ ] **Step 1: Update the changelog entry for this branch's behavior fix**

Add this entry to `CHANGELOG.md`:

```md
## Unreleased

- fix: isolate Telegram runtime actions so `/abort`, session/project switches, `/start`, prompt mismatch recovery, and `/open` browser state no longer interrupt unrelated topics or users; keep explicit extension hooks for later root-abort integration with subagent forum topics
```

- [ ] **Step 2: Update product documentation to reflect branch-local topic isolation**

Add or update these bullets in `PRODUCT.md`:

```md
- Keep attached-session routing isolated per private chat or forum topic so follow-up updates, aborts, project/session switches, and runtime resets stay within the invoking scope by default
- Reserve root-session-tree abort expansion and dedicated subagent-topic cleanup for the merge-integration slice with the separate subagent-topics branch
```

- [ ] **Step 3: Add a short merge note to the plan output section of this branch**

Append this note to `PRODUCT.md` or another appropriate internal note section if one already exists:

```md
- Merge note: after integrating `docs/superpowers/plans/2026-05-01-subagent-topics-and-user-project-defaults.md`, widen `clearSessionTreeRuntime(...)` from single-session cleanup to root-tree cleanup, then add immediate child-topic deletion, active-only subagent parent cards, localized topic links, and localized stopped-state rendering.
```

- [ ] **Step 4: Run the targeted regression suite and verify this branch passes**

Run:

```bash
npx vitest run tests/bot/runtime/scope-session-resolver.test.ts tests/bot/runtime/scoped-runtime-reset.test.ts tests/bot/runtime/scope-open-state.test.ts tests/bot/commands/abort.test.ts tests/thread/manager.test.ts tests/bot/commands/start.test.ts tests/bot/handlers/prompt-deferred-follow-up.test.ts tests/bot/commands/commands.test.ts tests/bot/commands/sessions.test.ts tests/bot/commands/new.test.ts tests/bot/commands/projects.handle-project-select.test.ts tests/bot/utils/switch-project.test.ts tests/bot/commands/open.test.ts tests/summary/aggregator.test.ts
```

Expected: PASS for topic isolation, scoped abort, scoped resets, scoped switching, and scoped `/open` behavior in this branch alone.

- [ ] **Step 5: Run the full required repository checks**

Run:

```bash
npm run build && npm run lint && npm test
```

Expected: PASS for TypeScript build, ESLint, and the full Vitest suite.

- [ ] **Step 6: Record the post-merge follow-up checklist for the other branch**

Create or update an internal note in the implementation summary with this checklist:

```md
- After merging the subagent-topics branch:
  - widen `clearSessionTreeRuntime(...)` to clean child sessions too
  - integrate `SubagentTopicService` for immediate child-topic deletion on root abort
  - make parent subagent cards active-only
  - add localized topic-link line while child is active
  - replace the topic-link line with localized `Subagent was stopped` after forced interruption
```

- [ ] **Step 7: Commit the final verification/docs slice if commits are requested for the execution session**

```bash
git add CHANGELOG.md PRODUCT.md
git commit -m "docs: record topic-scoped runtime isolation"
```

---

## Post-Merge Integration Contract

After `docs/superpowers/plans/2026-05-01-subagent-topics-and-user-project-defaults.md` is implemented and merged, perform a separate integration slice with these rules:

1. Keep this branch's topic-scoped command isolation unchanged.
2. Widen only the cleanup helper contract from single-session cleanup to root-tree cleanup.
3. Make root `/abort` call the widened tree helper without changing command-level routing decisions again.
4. Add immediate child-topic deletion through the merged `SubagentTopicService`.
5. Add localized topic links and localized `Subagent was stopped` rendering in parent subagent cards.
6. Do not retroactively reintroduce `summaryAggregator.clear()` or any process-wide reset helpers.

This keeps both branches independently mergeable and reduces conflict risk to the later integration surface only.
