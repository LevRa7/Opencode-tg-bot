# Router Test Specification (Global)

> **Status:** Draft · **Target:** `src/bot/index.ts` + session routing infrastructure
> **Author:** AI agent (per user request) · **Date:** 2026-06-11

---

## 0. Scope & Architecture Note

There is **no standalone Router class** in this project. Routing is grammY-native and spread across:

| Component | File | Lines |
|-----------|------|-------|
| Bot wiring (`createBot`) | `src/bot/index.ts` | 3979–4803 |
| Individual callback handlers | `src/bot/commands/*.ts`, `src/bot/handlers/*.ts` | — |
| Session routing context | `src/bot/index.ts:310–367, 561–900` | — |
| Middleware chain | `src/bot/index.ts:3921–3943` | — |
| `bot.hears()` patterns | `src/bot/index.ts:4223–4333` | — |
| Text routing chain | `src/bot/index.ts:3946–4017, 4335, 4550` | — |

This spec treats the **entire routing infrastructure** as a single testable surface, organized by routing dimension.

---

## 1. Test Infrastructure (Prerequisites)

### 1.1 What already works

- `vitest` + `vi.mock()` / `vi.hoisted()` pattern established in 35+ test files
- `FakeBot` class captures `onHandlers[]` and `useHandlers[]` arrays
- Context factory helpers: `createCallbackContext(data)`, `createTextContext(text, messageId)`
- `tests/setup.ts` resets singleton state between tests
- `safeBackgroundTask` mocked to run synchronously

### 1.2 What needs to be added for router tests

| Need | Why |
|------|-----|
| `FakeBot.commandHandlers` map | `bot.command()` currently drops handlers — must capture `{command, handler}` |
| `FakeBot.hearsHandlers` array | `bot.hears()` currently drops handlers — must capture `{pattern, handler}` |
| `createCallbackContext` → extract to shared helper | Currently duplicated or inline |
| `createTextContext` → extract to shared helper | Same as above |
| Session routing test harness | Isolate `routingBySessionId` + `attachManager` + `getPromptRoutingContext` without spinning up full `createBot()` |

### 1.3 Recommended test file structure

```
tests/bot/routing/
├── command-registration.test.ts      # 35 commands registered
├── hears-registration.test.ts        # 5 hears patterns
├── callback-chain.test.ts            # 28+ callback handlers, order, early-return
├── text-chain.test.ts                # 4 message:text layers, short-circuit logic
├── media-handlers.test.ts            # voice/audio/photo/document/video/location registration
├── middleware-ordering.test.ts       # 5 middleware layers, auth gate
├── session-routing-context.test.ts   # set/get/clear/sync/priority/clone/child
├── error-handling.test.ts            # bot.catch, callback try/catch
├── forum-topic-lifecycle.test.ts     # topic edit → session deletion
├── reaction-routing.test.ts          # bookmarks, 💔 abort
└── edited-message.test.ts            # inline keyboard on edits
```

---

## 2. Dimension 1: Command Registration

### 2.1 What to test

**GIVEN** `createBot()` is called
**WHEN** inspecting the FakeBot's command registration
**THEN** all 35 commands are registered with correct handlers

### 2.2 Test cases

| # | Test name | Priority |
|---|-----------|----------|
| C1 | registers all 35 bot commands | 🔴 HIGH |
| C2 | each command maps to the correct imported handler function | 🔴 HIGH |
| C3 | no duplicate command registrations | 🟡 MED |
| C4 | commands are registered in a deterministic order | 🟢 LOW |

### 2.3 How to test

```typescript
// FakeBot must be extended:
class FakeBot {
  commandHandlers: Map<string, Function> = new Map();
  command(cmd: string, handler: Function): this {
    this.commandHandlers.set(cmd, handler);
    return this;
  }
}

// Test:
it("registers all 35 bot commands", () => {
  const bot = createBot();
  expect(bot.commandHandlers.size).toBe(35);
});

it("/new maps to newCommand handler", () => {
  const bot = createBot();
  expect(bot.commandHandlers.get("new")).toBe(newCommandMock);
});
```

### 2.4 Coverage gap

**Current state:** 0% — `FakeBot.command()` is a no-op that discards all handler references.

---

## 3. Dimension 2: Hears Pattern Registration

### 3.1 What to test

**GIVEN** `createBot()` is called
**WHEN** inspecting registrations
**THEN** all 5 `bot.hears()` patterns are registered

### 3.2 Test cases

| # | Test name | Priority |
|---|-----------|----------|
| H1 | registers AGENT_MODE_BUTTON_TEXT_PATTERN → `cycleAgentMode` | 🔴 HIGH |
| H2 | registers MODEL_BUTTON_TEXT_PATTERN → `showModelSelectionMenu` | 🔴 HIGH |
| H3 | registers STOP_BUTTON_TEXT_PATTERN → stop handler | 🔴 HIGH |
| H4 | registers NEW_WINDOW_BUTTON_TEXT_PATTERN → `openTerminalTopic` | 🔴 HIGH |
| H5 | registers `/^🖥\s/` → `lsCommand` | 🟡 MED |
| H6 | all patterns have correct regex sources | 🟢 LOW |

### 3.3 How to test

```typescript
// FakeBot must be extended:
class FakeBot {
  hearsHandlers: Array<{pattern: RegExp; handler: Function}> = [];
  hears(pattern: RegExp, handler: Function): this {
    this.hearsHandlers.push({pattern, handler});
    return this;
  }
}
```

### 3.4 Coverage gap

**Current state:** 0% — `FakeBot.hears()` is a no-op.

---

## 4. Dimension 3: Callback Routing Chain

### 4.1 What to test

**GIVEN** a `callback_query:data` event
**WHEN** the single dispatcher runs
**THEN** handlers are tried in the correct order with correct early-return semantics

### 4.2 Test cases

| # | Test name | Priority |
|---|-----------|----------|
| CB1 | single `callback_query:data` handler is registered (already tested) | 🟢 LOW |
| CB2 | handler 1: `handleInlineMenuCancel` called first | 🔴 HIGH |
| CB3 | handler 2: `handleSshCallback` called — **short-circuits on true** | 🔴 HIGH |
| CB4 | handler 3: `handleSessionSelect` called | 🔴 HIGH |
| CB5 | handler 4: `handleBackgroundSessionOpen` called | 🔴 HIGH |
| CB6 | handler 5: `handleProjectSelect` called with `ensureEventSubscription` | 🔴 HIGH |
| CB7 | handler 6: `handleQuestionCallback` called | 🔴 HIGH |
| CB8 | handler 7: `handleAccessApprovalCallback` called | 🔴 HIGH |
| CB9 | handler 8: `handlePermissionCallback` called | 🔴 HIGH |
| CB10 | handler 9: `handleAgentSelect` called | 🔴 HIGH |
| CB11 | handler 10: `model:add_provider` prefix → `connectCommand` — **short-circuits** | 🔴 HIGH |
| CB12 | handler 11: `handleModelSelect` called | 🔴 HIGH |
| CB13 | handler 12: `handleVariantSelect` called | 🔴 HIGH |
| CB14 | handler 13: `handleCompactConfirm` called | 🔴 HIGH |
| CB15 | handler 14: `handleTaskCallback` called | 🔴 HIGH |
| CB16 | handler 15: `handleTaskListCallback` called | 🔴 HIGH |
| CB17 | handler 16: `handleRenameCancel` called | 🔴 HIGH |
| CB18 | handler 17: `handleCommandsCallback` called with `{bot, ensureEventSubscription}` | 🔴 HIGH |
| CB19 | handler 18: `handleSettingsCallback` called (already tested) | 🟢 LOW |
| CB20 | handler 19: `handleWorktreeCallback` called with `{ensureEventSubscription}` | 🔴 HIGH |
| CB21 | handler 20: `handleOpenCallback` called with `{ensureEventSubscription}` | 🔴 HIGH |
| CB22 | handler 21: `handleLsCallback` called | 🔴 HIGH |
| CB23 | handler 22: `handleSkillsCallback` called with `{bot, ensureEventSubscription}` | 🔴 HIGH |
| CB24 | handler 23: `handleMcpsCallback` called | 🔴 HIGH |
| CB25 | handler 24: `handleServerCallback` called | 🔴 HIGH |
| CB26 | handler 25: `handleOnboardingCallback` called | 🔴 HIGH |
| CB27 | handler 26: `mj_fork_` prefix → fire-and-forget `handleMessageJournalFork` | 🟡 MED |
| CB28 | handler 27: `mj_revert_` prefix → fire-and-forget `handleMessageJournalRevert` | 🟡 MED |
| CB29 | handler 28: `connect:cancel` prefix → inline cancel message — **short-circuits** | 🟡 MED |
| CB30 | handler 29: `provider:start:X:Y` regex → `startProviderAuth` — **short-circuits** | 🟡 MED |
| CB31 | handler 30: `provider:auth:X` regex → `handleProviderAuth` | 🟡 MED |
| CB32 | **ORDER**: all handlers called in the exact sequence defined above | 🔴 HIGH |
| CB33 | when NO handler returns true → answers with "callback.unknown_command" | 🔴 HIGH |
| CB34 | on exception → clears all interaction state + sends "Processing error" | 🔴 HIGH |
| CB35 | handlers AFTER a `true` return are NOT skipped (current behavior) | 🟡 MED |

### 4.3 Important architectural note

**CB35** documents current behavior: most handlers run even when a previous one already returned `true`. Only `handleSshCallback`, `model:add_provider`, `connect:cancel`, and `provider:start:*` have explicit early returns. This may be a bug — should be confirmed with the user whether all handlers should short-circuit.

### 4.4 How to test

```typescript
it("callback chain: handleSshCallback short-circuits on true", async () => {
  const bot = createBot();
  const handler = findCallbackHandler(bot);
  const ctx = createCallbackContext("ssh:connect:123");

  handleSshCallbackMock.mockResolvedValue(true);
  handleSessionSelectMock.mockResolvedValue(false);

  await handler(ctx);

  expect(handleSshCallbackMock).toHaveBeenCalledTimes(1);
  // After short-circuit, remaining handlers should NOT be called
  expect(handleSessionSelectMock).not.toHaveBeenCalled();
});
```

### 4.5 Coverage gap

**Current state:** ~7% — only CB1, CB19, CB33 partially tested. 26 of 35 test cases are missing.

---

## 5. Dimension 4: Text Message Routing Chain

### 5.1 What to test

**GIVEN** a `message:text` event
**WHEN** text flows through the 4-layer chain + terminal handler
**THEN** each layer gates correctly and the right handler consumes the text

### 5.2 Test cases — Layer 1: Provider input interceptor

| # | Test name | Priority |
|---|-----------|----------|
| T1 | calls `isAnyProviderPrompt(userId)` for every text message | 🔴 HIGH |
| T2 | when provider prompt is active → calls `handleProviderInput`, does NOT call `next()` | 🔴 HIGH |
| T3 | when provider prompt is NOT active → calls `next()` | 🔴 HIGH |
| T4 | when user ID is undefined → calls `next()` | 🟡 MED |
| T5 | when text is empty → calls `next()` | 🟡 MED |
| T6 | when text length >= 500 chars → calls `next()` | 🟢 LOW |

### 5.3 Test cases — Layer 2: Unknown command middleware

| # | Test name | Priority |
|---|-----------|----------|
| T7 | `unknownCommandMiddleware` is registered as second `message:text` handler | 🔴 HIGH |
| T8 | middleware calls `next()` for normal text | 🟡 MED |

### 5.4 Test cases — Layer 3: Debug logging middleware

| # | Test name | Priority |
|---|-----------|----------|
| T9 | debug logging middleware is registered as third `message:text` handler | 🟢 LOW |
| T10 | always calls `next()` | 🟢 LOW |

### 5.5 Test cases — Layer 4: Terminal text handler (chain-of-responsibility)

| # | Test name | Priority |
|---|-----------|----------|
| T11 | null/undefined text → returns immediately | 🟡 MED |
| T12 | text starts with `/` → returns immediately (commands already handled) | 🔴 HIGH |
| T13 | `questionManager.isActive(scopeKey)` → `handleQuestionTextAnswer(ctx)` — short-circuits | 🔴 HIGH |
| T14 | `handleTaskTextInput(ctx)` → returns `handledTask`; when `true` — short-circuits | 🔴 HIGH |
| T15 | `handleRenameTextAnswer(ctx)` → returns `handledRename`; when `true` — short-circuits | 🔴 HIGH |
| T16 | `handleSshTextArguments(ctx)` → returns `handledSshArgs`; when `true` — short-circuits | 🔴 HIGH |
| T17 | `handleCommandTextArguments(ctx, promptDeps)` → returns `handledCommandArgs`; when `true` — short-circuits | 🔴 HIGH |
| T18 | `handleSkillTextArguments(ctx, promptDeps)` → returns `handledSkillArgs`; when `true` — short-circuits | 🔴 HIGH |
| T19 | `isTerminalTopic(mtId)` → executes terminal command, renames topic — short-circuits | 🔴 HIGH |
| T20 | **DEFAULT**: none of the above → calls `processUserPrompt(ctx, text, promptDeps)` | 🔴 HIGH |
| T21 | short-circuit order is respected (question → task → rename → ssh → cmdArgs → skillArgs → terminal → prompt) | 🔴 HIGH |
| T22 | `processUserPrompt` receives correct `promptDeps` object | 🟡 MED |

### 5.6 How to test

```typescript
it("text chain: active question short-circuits before processUserPrompt", async () => {
  questionManagerMock.isActive.mockReturnValue(true);

  const bot = createBot();
  const handler = findTerminalTextHandler(bot);
  const ctx = createTextContext("answer to question", 1);

  await handler(ctx);

  expect(handleQuestionTextAnswerMock).toHaveBeenCalledWith(ctx);
  expect(processUserPromptMock).not.toHaveBeenCalled();
});
```

### 5.7 Coverage gap

**Current state:** 0% — no text chain routing tests exist.

---

## 6. Dimension 5: Media Message Handlers

### 6.1 Test cases

| # | Test name | Priority |
|---|-----------|----------|
| M1 | `message:voice` → `handleVoiceMessage` registered | 🔴 HIGH |
| M2 | `message:audio` → `handleVoiceMessage` registered | 🔴 HIGH |
| M3 | `message` → `createMediaGroupAttachmentMiddleware(...)` registered | 🔴 HIGH |
| M4 | `message:photo` → `handlePhotoMessage` registered | 🔴 HIGH |
| M5 | `message:document` → `handleDocumentMessage` registered | 🔴 HIGH |
| M6 | `["message:video", "message:video_note"]` → `handleVideoMessage` registered | 🔴 HIGH |
| M7 | `message:location` → `handleLocationMessage` registered | 🟡 MED |

### 6.2 How to test

```typescript
it("registers voice message handler", () => {
  const bot = createBot();
  const voiceHandler = bot.onHandlers.find(h => h.event === "message:voice");
  expect(voiceHandler).toBeDefined();
});

// Higher-value: invoke handler with a mock ctx and verify it calls handleVoiceMessage
it("voice message handler delegates to handleVoiceMessage", async () => {
  const bot = createBot();
  const voiceHandler = bot.onHandlers.find(h => h.event === "message:voice");
  const ctx = createMediaContext({ voice: { file_id: "v1", duration: 5 } });

  await voiceHandler.handler(ctx);

  expect(handleVoiceMessageMock).toHaveBeenCalledWith(ctx);
});
```

### 6.3 Coverage gap

**Current state:** 0%.

---

## 7. Dimension 6: Middleware Chain

### 7.1 What to test

**GIVEN** `createBot()` is called
**WHEN** inspecting the middleware stack
**THEN** 5 middleware layers are registered in the correct order

### 7.2 Test cases

| # | Test name | Priority |
|---|-----------|----------|
| MW1 | 5 middleware layers registered via `bot.use()` | 🔴 HIGH |
| MW2 | **Order**: debug logger → authMiddleware → ensureCommandsInitialized → scope extraction → interactionGuard | 🔴 HIGH |
| MW3 | `authMiddleware` blocks unauthorized users (does not call `next()`) | 🔴 HIGH |
| MW4 | `authMiddleware` allows authorized users (calls `next()`) | 🔴 HIGH |
| MW5 | `ensureCommandsInitialized` skips for `!ctx.from` | 🟡 MED |
| MW6 | `ensureCommandsInitialized` skips for `!ctx.chat` | 🟡 MED |
| MW7 | `ensureCommandsInitialized` skips for non-admin, non-allowed users | 🟡 MED |
| MW8 | scope extraction activates thread context via `threadContextManager.activateFromContext` | 🔴 HIGH |
| MW9 | scope extraction sets TERMINAL keyboard mode for terminal topics | 🟡 MED |
| MW10 | `interactionGuardMiddleware` blocks messages when interaction is active | 🟡 MED |
| MW11 | `interactionGuardMiddleware` allows messages when no interaction is active | 🟡 MED |

### 7.3 Coverage gap

**Current state:** ~18% — only MW2 (partial) tested. The existing test checks `authMiddleware` comes before `interactionGuardMiddleware` but doesn't test the other 3 middleware layers, actual auth logic, or scope extraction.

---

## 8. Dimension 7: Session Routing Context

**This is the most under-tested dimension and the highest risk area.** All event delivery (SSE → Telegram) depends on correct routing context resolution.

### 8.1 Core CRUD

| # | Test name | Priority |
|---|-----------|----------|
| SR1 | `setSessionRoutingContext` stores context in `routingBySessionId` | 🔴 HIGH |
| SR2 | `getSessionRoutingContext` returns stored context | 🔴 HIGH |
| SR3 | `getSessionRoutingContext` calls `syncSessionRoutingContext` when cache miss | 🔴 HIGH |
| SR4 | `clearSessionRoutingContext` removes from map | 🔴 HIGH |
| SR5 | `clearSessionRoutingContext` unregisters permission send function | 🟡 MED |
| SR6 | `clearSessionRoutingContext` clears prompt routing for the session | 🟡 MED |

### 8.2 Sync & Priority

| # | Test name | Priority |
|---|-----------|----------|
| SR7 | `syncSessionRoutingContext`: attached target overrides prompt routing | 🔴 HIGH |
| SR8 | `syncSessionRoutingContext`: prompt routing used when no attached target | 🔴 HIGH |
| SR9 | `syncSessionRoutingContext`: `targetSource` is `"attached"` when attach target present | 🔴 HIGH |
| SR10 | `syncSessionRoutingContext`: `targetSource` is `"prompt"` when only prompt routing present | 🟡 MED |
| SR11 | `syncSessionRoutingContext`: returns `null` when no routing source available | 🔴 HIGH |

### 8.3 Target resolution

| # | Test name | Priority |
|---|-----------|----------|
| SR12 | `getSessionRoutingTarget`: attached target returned first | 🔴 HIGH |
| SR13 | `getSessionRoutingTarget`: falls back to routing context target | 🔴 HIGH |
| SR14 | `getSessionRoutingTarget`: returns `null` when no target available | 🔴 HIGH |
| SR15 | `getSessionDeliveryTarget`: returns `deliveryTarget` from routing context | 🔴 HIGH |
| SR16 | `getSessionDeliveryTarget`: falls back to routing target when no `deliveryTarget` | 🟡 MED |
| SR17 | `getSessionRoutingApi`: returns API from routing context | 🔴 HIGH |
| SR18 | `getSessionRoutingApi`: falls back to `activeBotInstance.api` | 🟡 MED |
| SR19 | `getSessionRoutingScope`: returns scope from routing context | 🔴 HIGH |
| SR20 | `getSessionRoutingScope`: falls back to `attachManager.getScopeForSession` | 🟡 MED |
| SR21 | `getSessionRoutingScope`: falls back to `threadContextManager.getSessionScope` | 🟡 MED |
| SR22 | `isSessionCurrent`: returns `true` when live routing exists | 🔴 HIGH |
| SR23 | `isSessionCurrent`: returns `false` when no routing target | 🔴 HIGH |

### 8.4 Child session / subagent routing

| # | Test name | Priority |
|---|-----------|----------|
| SR24 | `cloneRoutingContextForChildSession` copies parent routing to child | 🔴 HIGH |
| SR25 | `cloneRoutingContextForChildSession` adds child ID to `managedChildSessionIds` | 🔴 HIGH |
| SR26 | `seedChildRoutingFromSubagent` seeds child routing from subagent parent | 🔴 HIGH |
| SR27 | `syncSubagentDeliveryContextForSession` creates forum topic | 🔴 HIGH |
| SR28 | `syncSubagentDeliveryContextForSession` pins the topic message | 🔴 HIGH |
| SR29 | `syncSubagentDeliveryContextForSession` stores routing context for child session | 🔴 HIGH |
| SR30 | `syncSubagentDeliverySerialized` prevents concurrent setup (mutex) | 🔴 HIGH |

### 8.5 How to test session routing

Session routing functions are exported from `src/bot/index.ts` and can be tested **without** `createBot()`:

```typescript
import {
  setSessionRoutingContext,
  getSessionRoutingContext,
  clearSessionRoutingContext,
  getSessionRoutingTarget,
  getSessionDeliveryTarget,
  resolveAttachedSessionTarget,
  isSessionCurrent,
  cloneRoutingContextForChildSession,
} from "../../src/bot/index.js";

it("getSessionRoutingTarget returns attached target first", () => {
  attachManagerMock.getTargetForSession.mockReturnValue({
    chatId: 123,
    messageThreadId: 456,
  });

  const target = getSessionRoutingTarget("session-a");

  expect(target).toEqual({ chatId: 123, messageThreadId: 456 });
});
```

### 8.6 Coverage gap

**Current state:** 0% — no session routing context functions are tested directly. The existing callback routing test exercises them indirectly through SSE event delivery (tests SR12 implicitly), but there are no unit tests for the functions themselves.

---

## 9. Dimension 8: Error Handling

### 9.1 Test cases

| # | Test name | Priority |
|---|-----------|----------|
| E1 | `bot.catch` handler is registered | 🔴 HIGH |
| E2 | `bot.catch` clears all interaction state on unhandled error | 🔴 HIGH |
| E3 | callback `try/catch`: on error → clears interaction state | 🔴 HIGH |
| E4 | callback `try/catch`: on error → sends "Processing error" callback answer | 🔴 HIGH |
| E5 | callback `try/catch`: error does NOT crash the bot (other callbacks still work) | 🔴 HIGH |
| E6 | subagent delivery failure → blocks topic deletion, marks cleanup pending | 🟡 MED |

### 9.2 Coverage gap

**Current state:** 0%.

---

## 10. Dimension 9: Forum Topic Lifecycle

| # | Test name | Priority |
|---|-----------|----------|
| FT1 | `message:forum_topic_edited` handler is registered | 🔴 HIGH |
| FT2 | when topic is closed → deletes associated OpenCode sessions via message journal | 🔴 HIGH |
| FT3 | when topic is NOT closed → no session deletion | 🟡 MED |

---

## 11. Dimension 10: Message Reactions

| # | Test name | Priority |
|---|-----------|----------|
| R1 | `message_reaction` handler is registered | 🔴 HIGH |
| R2 | ❤ reaction → creates bookmark | 🟡 MED |
| R3 | ✍ reaction → creates bookmark | 🟡 MED |
| R4 | 💔 reaction by admin → aborts session | 🔴 HIGH |
| R5 | 💔 reaction by non-admin → no abort | 🟡 MED |

---

## 12. Dimension 11: Edited Message Routing

| # | Test name | Priority |
|---|-----------|----------|
| EM1 | `edited_message` handler is registered | 🔴 HIGH |
| EM2 | edited location → calls `handleEditedLocation` | 🟡 MED |
| EM3 | edited journaled message → shows fork/revert inline keyboard | 🔴 HIGH |

---

## 13. Implementation Priority Matrix

```
P0 (CRITICAL — ship-blocking):
  ├── C1: 35 command registrations
  ├── CB2-CB25: callback chain handler order
  ├── CB32: callback chain exact order
  ├── T2, T13-T20: text chain short-circuits
  ├── T21: text chain order
  ├── MW2: middleware ordering
  ├── MW3-MW4: auth gate
  ├── SR7-SR9: routing source priority
  ├── SR12-SR14: target resolution
  ├── SR24-SR30: child session routing
  └── E1-E5: error handling

P1 (HIGH — before next feature):
  ├── H1-H4: hears patterns
  ├── M1-M6: media handlers
  ├── CB33-CB34: fallback + error in callback chain
  ├── SR1-SR6: routing CRUD
  ├── SR15-SR23: target/API/scope resolution
  ├── FT1-FT2: forum topic lifecycle
  ├── R1, R4: reactions → abort
  └── EM1, EM3: edited message → fork/revert

P2 (MEDIUM — within 2 sprints):
  ├── C4: command registration order
  ├── H5: 🖥 pattern
  ├── T4-T6, T8: text chain edge cases
  ├── T22: promptDeps correctness
  ├── CB27-CB31: message journal + provider auth callbacks
  ├── CB35: no-short-circuit behavior confirmation
  ├── MW5-MW11: middleware edge cases
  ├── SR5-SR6: cleanup side effects
  ├── SR10-SR11: sync edge cases
  └── FT3, R2-R3, R5, EM2: edge cases

P3 (LOW — backlog):
  ├── C3: no duplicate commands
  ├── H6: regex source correctness
  ├── T9-T10: debug logging middleware
  ├── SR30: serialized subagent setup mutex
  └── E6: subagent delivery failure handling
```

---

## 14. FakeBot Extensions Required

```typescript
// In the grammy mock (tests/bot/index.callback-routing.test.ts or shared mock):
class FakeBot {
  // NEW: capture command registrations
  commandHandlers: Map<string, Function> = new Map();

  // NEW: capture hears registrations
  hearsHandlers: Array<{pattern: RegExp; handler: Function}> = [];

  // EXISTING: capture on() registrations
  onHandlers: Array<{event: string | string[]; handler: Function}> = [];

  // EXISTING: capture use() registrations
  // (via module-level useHandlers array)

  // MODIFIED: capture commands
  command(cmd: string, handler: Function): this {
    this.commandHandlers.set(cmd, handler);
    return this;
  }

  // MODIFIED: capture hears
  hears(pattern: RegExp, handler: Function): this {
    this.hearsHandlers.push({pattern, handler});
    return this;
  }

  // NEW: capture catch handler
  catchHandler: Function | null = null;
  catch(handler: Function): this {
    this.catchHandler = handler;
    return this;
  }
}
```

---

## 15. Shared Test Helpers to Extract

```typescript
// tests/bot/routing/helpers.ts

export function createCallbackContext(data: string) {
  return {
    callbackQuery: { data, message: { message_id: 777 } },
    from: { id: 1 },
    chat: { id: 123, type: "private" },
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
  };
}

export function createTextContext(text: string, messageId = 1) {
  return {
    message: {
      message_id: messageId,
      text,
      chat: { id: 123 },
      message_thread_id: 99,
    },
    chat: { id: 123, type: "private" },
    from: { id: 1 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: messageId + 1000 }),
  };
}

export function createMediaContext(media: Record<string, unknown>) {
  return {
    message: {
      message_id: 1,
      chat: { id: 123 },
      message_thread_id: 99,
      ...media,
    },
    chat: { id: 123, type: "private" },
    from: { id: 1 },
    api: {},
    reply: vi.fn().mockResolvedValue({ message_id: 2 }),
  };
}

export function findCallbackHandler(bot: FakeBot): Function {
  return bot.onHandlers.find(e => e.event === "callback_query:data")?.handler;
}

export function findTerminalTextHandler(bot: FakeBot): Function {
  return bot.onHandlers.filter(e => e.event === "message:text").at(-1)?.handler;
}

export function findMediaHandler(bot: FakeBot, event: string): Function {
  return bot.onHandlers.find(e => {
    if (Array.isArray(e.event)) return e.event.includes(event);
    return e.event === event;
  })?.handler;
}
```

---

## 16. Risks & Caveats

1. **No short-circuit in callback chain (CB35).** Most handlers run even after a match. If this is intentional (e.g., for logging), the tests should document it. If it's a bug, fixing it would be a breaking change that needs its own test.

2. **Session routing context is tightly coupled to `src/bot/index.ts`.** Exporting functions for testing is fine, but be careful not to leak internal state between tests — `tests/setup.ts` already handles `resetSingletonState()` in `afterEach`.

3. **35 command mocks will be verbose.** Consider generating mock registrations programmatically from `COMMAND_DEFINITIONS` in `src/bot/commands/definitions.ts`.

4. **Callback handler tests are integration-level by nature.** Each `handle*Callback` function internally checks callback data prefixes. The routing test only verifies that the handler is called in the right order — not that it correctly identifies its own callbacks.

5. **New test files vs extending existing.** Adding 11 new test files (section 1.3) is the clean approach. The existing `tests/bot/index.callback-routing.test.ts` (825 lines) can be refactored into `tests/bot/routing/callback-chain.test.ts`.
