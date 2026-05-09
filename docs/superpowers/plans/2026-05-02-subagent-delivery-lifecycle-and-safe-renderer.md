# Subagent Delivery Lifecycle and Safe Renderer Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make subagent topic delivery deterministic by centralizing topic lifecycle, auto-delete, terminal footer delivery, and Telegram-safe rendering.

**Architecture:** Keep `SubagentTopicService` as the owner of subagent topic lifecycle and introduce a unified child-topic delivery path so child text, reasoning, tool summaries, diffs, and terminal footer all follow the same contract. Consolidate Telegram text rendering behind one safe pipeline so Markdown/raw bugs stop moving between message types.

**Tech Stack:** TypeScript 5, Node.js 20+, grammY, Vitest, existing Telegram delivery helpers in `src/bot/utils/*`

---

## File Structure

- `src/bot/subagent-topics/service.ts`
  - Extend topic lifecycle ownership: naming normalization, terminal delivery confirmation, cleanup state, auto-delete gating.
- `src/bot/subagent-topics/child-delivery.ts`
  - New focused module for child-topic outbound delivery contract.
- `src/bot/utils/telegram-text.ts`
  - Move toward one safe text-delivery entry point for send/edit/draft flows.
- `src/bot/utils/send-with-markdown-fallback.ts`
  - Normalize parse/fallback behavior into a deterministic safe renderer backend.
- `src/bot/index.ts`
  - Replace ad-hoc child send sites with the unified child delivery layer and terminal-footer policy.
- `src/summary/aggregator.ts`
  - Reduce duplicated child/root terminal tool completion effects where needed to support the new delivery contract cleanly.
- `src/bot/runtime/scoped-runtime-reset.ts`
  - Remove or narrow scope-local SSE listener teardown so one scope cannot break another scope in the same directory.
- `src/bot/handlers/question.ts`
  - Bind question replies to stored runtime/session context instead of ambient current session/project.
- `src/bot/handlers/permission.ts`
  - Bind permission replies to stored runtime/session context instead of ambient current session/project.
- `tests/bot/subagent-topics/service.test.ts`
  - Cover lifecycle states, naming normalization, delete gating, orphan/cleanup paths.
- `tests/bot/index.local-file-follow-up.test.ts`
  - Verify child-topic delivery behavior end-to-end, including footer timing and auto-delete.
- `tests/bot/streaming/response-streamer.test.ts`
  - Update only if the new safe rendering pipeline changes stream/final send expectations.
- `tests/bot/utils/send-with-markdown-fallback.test.ts`
  - Add or expand renderer/fallback tests.
- `tests/bot/handlers/question.test.ts`
  - Verify reply uses stored request runtime.
- `tests/bot/handlers/permission.test.ts`
  - Verify reply uses stored request runtime.
- `tests/bot/runtime/scoped-runtime-reset.test.ts`
  - Verify scope reset no longer tears down unrelated event subscriptions.

### Task 1: Lock in topic naming and lifecycle state in `SubagentTopicService`

**Files:**

- Modify: `src/bot/subagent-topics/service.ts`
- Test: `tests/bot/subagent-topics/service.test.ts`

- [ ] **Step 1: Write the failing tests for topic name normalization and lifecycle state initialization**

```ts
it("normalizes child topic names with Agent prefix", async () => {
  const createForumTopic = vi.fn().mockResolvedValue({ messageThreadId: 321 });
  const service = new SubagentTopicService({
    createForumTopic,
    deleteForumTopic: vi.fn(),
    reopenForumTopic: vi.fn(),
    closeForumTopic: vi.fn(),
  });

  await service.syncSubagent({
    childSessionId: "child-1",
    topicName: "Inspect artifact",
    parent: { chatId: -100123, isForum: true },
  });

  expect(createForumTopic).toHaveBeenCalledWith({
    chatId: -100123,
    name: "Agent: Inspect artifact",
  });
});

it("does not duplicate Agent prefix", async () => {
  const createForumTopic = vi.fn().mockResolvedValue({ messageThreadId: 321 });
  const service = new SubagentTopicService({
    createForumTopic,
    deleteForumTopic: vi.fn(),
    reopenForumTopic: vi.fn(),
    closeForumTopic: vi.fn(),
  });

  await service.syncSubagent({
    childSessionId: "child-2",
    topicName: "Agent: Inspect artifact",
    parent: { chatId: -100123, isForum: true },
  });

  expect(createForumTopic).toHaveBeenCalledWith({
    chatId: -100123,
    name: "Agent: Inspect artifact",
  });
});
```

- [ ] **Step 2: Run the targeted tests to confirm failure**

Run: `npm test -- --run tests/bot/subagent-topics/service.test.ts`
Expected: FAIL because `syncSubagent()` currently uses raw `topicName` and has no explicit lifecycle state tracking.

- [ ] **Step 3: Implement centralized topic-name normalization and initial lifecycle state**

```ts
function normalizeSubagentTopicName(name: string): string {
  const trimmed = name.trim() || "Subagent";
  return trimmed.startsWith("Agent: ") ? trimmed : `Agent: ${trimmed}`;
}

type TopicLifecycleState =
  | "created"
  | "active"
  | "terminal_pending_delivery"
  | "delivery_confirmed"
  | "cleanup_pending"
  | "deleted"
  | "orphaned";

interface SubagentTopicRegistryEntry {
  scope: SubagentSessionScope;
  target: SubagentTopicDeliveryTarget | null;
  deletionHandle: SubagentTopicDeletionHandle | null;
  lifecycleState: TopicLifecycleState;
  terminalStatus: string | null;
  finalDeliveryConfirmed: boolean;
}
```

- [ ] **Step 4: Run the targeted tests to confirm they pass**

Run: `npm test -- --run tests/bot/subagent-topics/service.test.ts`
Expected: PASS for the new normalization/lifecycle tests.

- [ ] **Step 5: Commit the isolated lifecycle/naming change**

```bash
git add src/bot/subagent-topics/service.ts tests/bot/subagent-topics/service.test.ts
git commit -m "fix: normalize subagent topic names and track lifecycle state"
```

### Task 2: Make auto-delete wait for confirmed final delivery

**Files:**

- Modify: `src/bot/subagent-topics/service.ts`
- Test: `tests/bot/subagent-topics/service.test.ts`

- [ ] **Step 1: Write the failing tests for delete gating and failure-state retention**

```ts
it("does not schedule topic deletion before final delivery confirmation", async () => {
  const scheduler = createSchedulerSpy();
  const service = new SubagentTopicService({
    createForumTopic: vi.fn().mockResolvedValue({ messageThreadId: 321 }),
    deleteForumTopic: vi.fn(),
    reopenForumTopic: vi.fn(),
    closeForumTopic: vi.fn(),
    scheduleDeletion: scheduler.scheduleDeletion,
  });

  await service.syncSubagent({
    childSessionId: "child-1",
    topicName: "Inspect artifact",
    parent: { chatId: -100123, isForum: true },
  });

  service.markFinalResponseDelivered("child-1", {
    terminalStatus: "completed",
    autoDeleteMinutes: 5,
  });

  expect(scheduler.scheduleDeletion).not.toHaveBeenCalled();
});

it("keeps topic state when terminal delivery failed and cleanup is pending", async () => {
  const service = new SubagentTopicService({
    createForumTopic: vi.fn().mockResolvedValue({ messageThreadId: 321 }),
    deleteForumTopic: vi.fn(),
    reopenForumTopic: vi.fn(),
    closeForumTopic: vi.fn(),
  });

  await service.syncSubagent({
    childSessionId: "child-2",
    topicName: "Inspect artifact",
    parent: { chatId: -100123, isForum: true },
  });

  service.markDeliveryCleanupPending("child-2", "errored");

  expect(service.getScopeForSession("child-2")).not.toBeNull();
});
```

- [ ] **Step 2: Run the targeted tests to verify failure**

Run: `npm test -- --run tests/bot/subagent-topics/service.test.ts`
Expected: FAIL because deletion is currently triggered from looser terminal-delivery assumptions and there is no cleanup-pending state API.

- [ ] **Step 3: Implement explicit final-delivery confirmation and cleanup-pending transitions**

```ts
markTerminalStatus(sessionId: string, terminalStatus: string): void {
  const entry = this.registry.get(sessionId);
  if (!entry || entry.scope.kind !== "topic") return;
  entry.terminalStatus = terminalStatus;
  entry.lifecycleState = "terminal_pending_delivery";
}

confirmFinalDelivery(sessionId: string, autoDeleteMinutes?: number): void {
  const entry = this.registry.get(sessionId);
  if (!entry || entry.scope.kind !== "topic") return;

  entry.finalDeliveryConfirmed = true;
  entry.lifecycleState = "delivery_confirmed";
  this.scheduleDeleteIfReady(sessionId, autoDeleteMinutes);
}

markDeliveryCleanupPending(sessionId: string, terminalStatus: string): void {
  const entry = this.registry.get(sessionId);
  if (!entry || entry.scope.kind !== "topic") return;
  entry.terminalStatus = terminalStatus;
  entry.lifecycleState = "cleanup_pending";
}
```

- [ ] **Step 4: Update existing delete scheduling to use the new explicit gates and rerun tests**

Run: `npm test -- --run tests/bot/subagent-topics/service.test.ts`
Expected: PASS, with deletion scheduled only after `confirmFinalDelivery()`.

- [ ] **Step 5: Commit the auto-delete gating change**

```bash
git add src/bot/subagent-topics/service.ts tests/bot/subagent-topics/service.test.ts
git commit -m "fix: gate subagent topic auto-delete on final delivery confirmation"
```

### Task 3: Stop scope-local cleanup from killing shared SSE listeners

**Files:**

- Modify: `src/bot/runtime/scoped-runtime-reset.ts`
- Modify: `src/bot/commands/abort.ts`
- Test: `tests/bot/runtime/scoped-runtime-reset.test.ts`

- [ ] **Step 1: Write the failing test for scope-local reset preserving shared listeners**

```ts
it("does not stop directory event listening during scope-local reset", () => {
  const stopEventListening = vi.fn();
  vi.doMock("../../../src/opencode/events.js", () => ({ stopEventListening }));

  clearScopedSessionRuntime("session-1", "abort_command", {
    directory: "/repo",
    scope: { userId: 1, chatId: 100, messageThreadId: 10 },
  });

  expect(stopEventListening).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run the targeted test to confirm failure**

Run: `npm test -- --run tests/bot/runtime/scoped-runtime-reset.test.ts`
Expected: FAIL because `clearScopedSessionRuntime()` currently calls `stopEventListening(options.directory)`.

- [ ] **Step 3: Remove directory-level listener shutdown from scope-local reset and leave only session-scope cleanup**

```ts
export function clearScopedSessionRuntime(
  sessionId: string,
  reason: string,
  options?: { scope?: TelegramConversationScope },
): void {
  summaryAggregator.clearSession(sessionId);
  clearAllInteractionState(
    reason,
    options?.scope ? buildTelegramConversationScopeKey(options.scope) : undefined,
  );
}
```

- [ ] **Step 4: Run the reset tests and abort tests**

Run: `npm test -- --run tests/bot/runtime/scoped-runtime-reset.test.ts tests/bot/commands/abort.test.ts`
Expected: PASS, confirming scope reset no longer stops unrelated listeners.

- [ ] **Step 5: Commit the listener-isolation fix**

```bash
git add src/bot/runtime/scoped-runtime-reset.ts src/bot/commands/abort.ts tests/bot/runtime/scoped-runtime-reset.test.ts
git commit -m "fix: preserve shared event listeners during scope-local cleanup"
```

### Task 4: Bind question replies to stored runtime context

**Files:**

- Modify: `src/question/manager.ts`
- Modify: `src/bot/handlers/question.ts`
- Test: `tests/bot/handlers/question.test.ts`

- [ ] **Step 1: Write the failing test for replying with stored session directory instead of ambient state**

```ts
it("uses stored question runtime context when replying", async () => {
  getCurrentProjectMock.mockReturnValue({ id: "p2", worktree: "/wrong" });
  getCurrentSessionMock.mockReturnValue({ id: "s2", directory: "/wrong" });

  questionManager.startQuestions(questions, "req-1", "scope-1", "session-1", {
    directory: "/repo",
    sessionId: "session-1",
  });

  await handleQuestionTextAnswer(ctxWithAnswer);

  expect(questionReplyMock).toHaveBeenCalledWith(
    expect.objectContaining({ requestID: "req-1", directory: "/repo" }),
  );
});
```

- [ ] **Step 2: Run the targeted test to verify failure**

Run: `npm test -- --run tests/bot/handlers/question.test.ts`
Expected: FAIL because replies currently derive `directory` from ambient `getCurrentSession()` / `getCurrentProject()`.

- [ ] **Step 3: Extend question manager state to store runtime context with the request**

```ts
interface QuestionRuntimeContext {
  directory: string;
  sessionId: string;
}

startQuestions(
  questions: QuestionInput[],
  requestID: string,
  scopeKey: string | undefined,
  sessionId: string,
  runtime?: QuestionRuntimeContext,
): void
```

- [ ] **Step 4: Update question reply flow to use the stored runtime and rerun the tests**

Run: `npm test -- --run tests/bot/handlers/question.test.ts`
Expected: PASS, with replies bound to the original request runtime.

- [ ] **Step 5: Commit the question-runtime binding change**

```bash
git add src/question/manager.ts src/bot/handlers/question.ts tests/bot/handlers/question.test.ts
git commit -m "fix: bind question replies to stored runtime context"
```

### Task 5: Bind permission replies to stored runtime context

**Files:**

- Modify: `src/permission/manager.ts`
- Modify: `src/bot/handlers/permission.ts`
- Test: `tests/bot/handlers/permission.test.ts`

- [ ] **Step 1: Write the failing test for replying with stored permission runtime context**

```ts
it("uses stored permission runtime context when replying", async () => {
  getCurrentProjectMock.mockReturnValue({ id: "p2", worktree: "/wrong" });
  getCurrentSessionMock.mockReturnValue({ id: "s2", directory: "/wrong" });

  permissionManager.startPermission(request, 101, "scope-1", {
    directory: "/repo",
    sessionId: "session-1",
  });

  await handlePermissionCallback(ctxWithApprove);

  expect(permissionReplyMock).toHaveBeenCalledWith(
    expect.objectContaining({ requestID: request.id, directory: "/repo" }),
  );
});
```

- [ ] **Step 2: Run the targeted test to verify failure**

Run: `npm test -- --run tests/bot/handlers/permission.test.ts`
Expected: FAIL because replies currently use ambient current project/session state.

- [ ] **Step 3: Extend permission manager state to store runtime context and use it on reply**

```ts
interface PermissionRuntimeContext {
  directory: string;
  sessionId: string;
}

startPermission(
  request: PermissionRequest,
  messageId: number,
  scopeKey?: string,
  runtime?: PermissionRuntimeContext,
): void
```

- [ ] **Step 4: Rerun permission tests after switching reply logic to the stored runtime**

Run: `npm test -- --run tests/bot/handlers/permission.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the permission-runtime binding change**

```bash
git add src/permission/manager.ts src/bot/handlers/permission.ts tests/bot/handlers/permission.test.ts
git commit -m "fix: bind permission replies to stored runtime context"
```

### Task 6: Introduce the unified child delivery module

**Files:**

- Create: `src/bot/subagent-topics/child-delivery.ts`
- Modify: `src/bot/index.ts`
- Test: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write the failing integration tests for a single child delivery entry point**

```ts
it("sends child reasoning, tool summaries, diffs, and final text through the same delivery helper", async () => {
  // Arrange a child session with a dedicated topic.
  // Emit reasoning, tool, diff, and final message events.
  // Assert all child sends were observed through the same mocked helper path
  // and arrived in the child thread only.
});

it("does not send the child footer before terminal completion", async () => {
  // Emit child partial text updates.
  // Assert footer text is absent until the final completed event.
});
```

- [ ] **Step 2: Run the targeted integration test to confirm failure**

Run: `npm test -- --run tests/bot/index.local-file-follow-up.test.ts`
Expected: FAIL because child deliveries are currently scattered across multiple direct send sites.

- [ ] **Step 3: Create a focused child delivery helper and wire its core interface**

```ts
export interface ChildTopicDeliveryRequest {
  sessionId: string;
  kind:
    | "live_text"
    | "diagnostic"
    | "terminal_footer"
    | "interactive_prompt"
    | "file_or_media_notice";
  text?: string;
  format?: TelegramTextFormat;
  options?: TelegramSendMessageOptions;
  rawFallbackText?: string;
}

export interface ChildTopicDeliveryDependencies {
  getRoutingApi(sessionId: string): SendMessageApi | null;
  getDeliveryTarget(sessionId: string): TelegramDeliveryTarget | null;
  withTopicReopenClose<T>(sessionId: string, fn: () => Promise<T>): Promise<T>;
  sendText(params: SendBotTextParams): Promise<number | null>;
}
```

- [ ] **Step 4: Replace child reasoning/tool/diff/final-footer send paths in `src/bot/index.ts` with the helper and rerun tests**

Run: `npm test -- --run tests/bot/index.local-file-follow-up.test.ts tests/bot/subagent-topics/service.test.ts`
Expected: PASS, with footer sent only once on terminal delivery.

- [ ] **Step 5: Commit the delivery-layer extraction**

```bash
git add src/bot/subagent-topics/child-delivery.ts src/bot/index.ts tests/bot/index.local-file-follow-up.test.ts
git commit -m "refactor: route child topic outbound messages through one delivery layer"
```

### Task 7: Move renderer behavior behind one deterministic safe pipeline

**Files:**

- Modify: `src/bot/utils/telegram-text.ts`
- Modify: `src/bot/utils/send-with-markdown-fallback.ts`
- Test: `tests/bot/utils/send-with-markdown-fallback.test.ts`
- Test: `tests/bot/streaming/response-streamer.test.ts`

- [ ] **Step 1: Write the failing renderer tests for shared safe normalization and fallback**

```ts
it("escapes markdown_v2 punctuation consistently before degrading to raw", async () => {
  const text = "a.b-c_(d)!";
  // first send fails with parse error
  // second send retries with escaped content
  // final fallback sends deterministic plain text if needed
});

it("uses the same safe fallback policy for child and root text sends", async () => {
  // Call sendBotText twice with different callers but same text/format.
  // Assert retry/fallback behavior is identical.
});
```

- [ ] **Step 2: Run the targeted renderer tests to confirm failure**

Run: `npm test -- --run tests/bot/utils/send-with-markdown-fallback.test.ts tests/bot/streaming/response-streamer.test.ts`
Expected: FAIL or require updates because current fallback behavior is split between caller assumptions and helper internals.

- [ ] **Step 3: Implement a single safe-render decision flow in the Telegram text helpers**

```ts
interface SafeRenderResult {
  text: string;
  parseMode?: "MarkdownV2" | "HTML";
  options: TelegramSendMessageOptions | TelegramEditMessageOptions;
  degraded: boolean;
}

function buildSafeTelegramRender(...): SafeRenderResult {
  // normalize input
  // sanitize HTML if needed
  // escape MarkdownV2 if needed
  // strip parse/entities for deterministic raw fallback
}
```

- [ ] **Step 4: Rerun renderer and streaming tests**

Run: `npm test -- --run tests/bot/utils/send-with-markdown-fallback.test.ts tests/bot/streaming/response-streamer.test.ts`
Expected: PASS, with deterministic fallback behavior.

- [ ] **Step 5: Commit the safe renderer unification**

```bash
git add src/bot/utils/telegram-text.ts src/bot/utils/send-with-markdown-fallback.ts tests/bot/utils/send-with-markdown-fallback.test.ts tests/bot/streaming/response-streamer.test.ts
git commit -m "fix: unify Telegram text rendering behind a safe fallback pipeline"
```

### Task 8: Finish terminal footer policy and cleanup integration

**Files:**

- Modify: `src/bot/index.ts`
- Modify: `src/bot/subagent-topics/service.ts`
- Test: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write failing tests for footer-only-on-terminal and cleanup after failed terminal delivery**

```ts
it("emits the subagent footer exactly once after terminal completion", async () => {
  // Emit multiple child text updates and then completion.
  // Assert the footer appears once and only after completion.
});

it("keeps topic cleanup state after failed final delivery instead of clearing it immediately", async () => {
  // Force final child send to fail.
  // Assert topic state remains available for cleanup handling.
});
```

- [ ] **Step 2: Run the targeted integration test to verify failure**

Run: `npm test -- --run tests/bot/index.local-file-follow-up.test.ts`
Expected: FAIL because footer and cleanup logic are currently intertwined in the completion branch.

- [ ] **Step 3: Move footer emission and final cleanup transitions behind explicit terminal-delivery confirmation APIs**

```ts
subagentTopicService.markTerminalStatus(childSessionId, pendingDeletionTerminalStatus ?? "completed");

await childTopicDelivery.deliver({
  sessionId: childSessionId,
  kind: "terminal_footer",
  text: formatAssistantRunFooter(...),
  format: "html",
});

subagentTopicService.confirmFinalDelivery(childSessionId, autoDeleteMinutes);
```

- [ ] **Step 4: Rerun the integration tests and verify footer timing and cleanup state**

Run: `npm test -- --run tests/bot/index.local-file-follow-up.test.ts tests/bot/subagent-topics/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit the terminal-footer/cleanup integration**

```bash
git add src/bot/index.ts src/bot/subagent-topics/service.ts tests/bot/index.local-file-follow-up.test.ts tests/bot/subagent-topics/service.test.ts
git commit -m "fix: send child footer only on terminal completion and preserve cleanup state"
```

### Task 9: Run full verification and update docs/changelog

**Files:**

- Modify: `CHANGELOG.md`
- Review: `docs/superpowers/specs/2026-05-02-subagent-delivery-lifecycle-and-safe-renderer-design.md`

- [ ] **Step 1: Add a changelog entry for the user-visible behavior changes**

```md
- Changed subagent topic delivery to use centralized lifecycle ownership, terminal-only footer delivery, and a unified safe Telegram renderer.
  - Why: child-topic behavior had accumulated routing, auto-delete, and parse-mode regressions that required one coherent delivery contract.
  - Affects: `src/bot/index.ts`, `src/bot/subagent-topics/service.ts`, `src/bot/utils/telegram-text.ts`, `src/bot/utils/send-with-markdown-fallback.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/bot/subagent-topics/service.test.ts`
```

- [ ] **Step 2: Run the focused verification commands**

Run: `npm test -- --run tests/bot/subagent-topics/service.test.ts tests/bot/index.local-file-follow-up.test.ts tests/bot/handlers/question.test.ts tests/bot/handlers/permission.test.ts tests/bot/runtime/scoped-runtime-reset.test.ts tests/bot/utils/send-with-markdown-fallback.test.ts tests/bot/streaming/response-streamer.test.ts`
Expected: PASS

- [ ] **Step 3: Run the full project verification commands**

Run: `npm run build && npm run lint && npm test`
Expected: all commands succeed with no lint warnings

- [ ] **Step 4: Review touched files for dead code and remove temporary compatibility code not required by the final design**

```ts
// Remove transitional ad-hoc child send helpers once all child-topic sends
// are routed through the dedicated delivery layer.
```

- [ ] **Step 5: Commit the final cleanup and verification pass**

```bash
git add CHANGELOG.md src tests
git commit -m "fix: stabilize subagent topic lifecycle and safe text rendering"
```

## Self-Review

- Spec coverage checked:
  - `Agent: ` prefix -> Task 1
  - auto-delete ownership and cleanup gating -> Tasks 1, 2, 8
  - footer only on terminal -> Tasks 6, 8
  - unified child delivery layer -> Task 6
  - unified safe renderer -> Task 7
  - private/supergroup distinction -> Tasks 1, 2, 6
  - shared SSE listener isolation -> Task 3
  - question/permission runtime binding -> Tasks 4, 5
- Placeholder scan checked: no `TODO`, `TBD`, or “implement later” steps remain.
- Type consistency checked:
  - `markTerminalStatus`, `confirmFinalDelivery`, and `markDeliveryCleanupPending` are introduced in Tasks 2 and reused consistently in Task 8.
  - runtime context objects for question/permission managers are explicitly named and reused consistently.
