# Main Thread Reply Keyboard And Scope Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Telegram reply keyboard show reliably in forum main thread and regular topics, preserve the native manual hide control, and keep reply-keyboard-triggered actions from forum main thread inside main thread without creating a new topic.

**Architecture:** Keep the current topic-scoped storage and routing model, then add a narrow main-thread-aware path only for reply-keyboard-driven actions. Fix reply keyboard UX by relaxing the current persistent keyboard configuration and by normalizing how reply-keyboard-driven menus and confirmation replies reuse the current Telegram thread target.

**Tech Stack:** TypeScript, Node.js, grammY, Vitest, existing settings/thread managers, Telegram forum thread routing helpers.

---

## File Map

- Modify: `src/bot/utils/keyboard.ts`
  - Adjust reply keyboard construction so Telegram clients keep the native hide control.
- Modify: `src/bot/utils/message-thread.ts`
  - Add explicit helpers for forum main-thread detection and reply-keyboard action routing.
- Modify: `src/bot/handlers/inline-menu.ts`
  - Allow reply-keyboard-driven menus to force main-thread routing when needed.
- Modify: `src/bot/handlers/agent.ts`
  - Route menu open and confirmation replies correctly for main-thread reply-keyboard actions.
- Modify: `src/bot/handlers/model.ts`
  - Route menu open and confirmation replies correctly for main-thread reply-keyboard actions.
- Modify: `src/bot/handlers/variant.ts`
  - Route menu open and confirmation replies correctly for main-thread reply-keyboard actions.
- Modify: `src/bot/commands/start.ts`
  - Keep reply keyboard reattachment behavior aligned with the updated keyboard contract.
- Modify: `src/bot/commands/status.ts`
  - Keep reply keyboard reattachment behavior aligned with the updated keyboard contract.
- Modify: `CHANGELOG.md`
  - Document the user-visible reply keyboard and main-thread routing fix.
- Modify: `PRODUCT.md`
  - Update the current product scope / feature list if the new behavior should be reflected there.

- Test: `tests/bot/utils/keyboard.test.ts`
  - Verify keyboard options keep resize behavior but stop forcing persistence.
- Test: `tests/bot/utils/message-thread.test.ts`
  - Verify forum main-thread detection and forced main-thread reply behavior.
- Test: `tests/bot/handlers/inline-menu.test.ts`
  - Verify inline menu can be opened in forced main-thread mode.
- Test: `tests/bot/handlers/model.test.ts`
  - Verify main-thread reply-keyboard model flow opens and confirms in main thread.
- Create: `tests/bot/handlers/agent.test.ts`
  - Verify main-thread reply-keyboard agent flow opens and confirms in main thread.
- Create: `tests/bot/handlers/variant.test.ts`
  - Verify main-thread reply-keyboard variant flow opens and confirms in main thread.
- Modify: `tests/bot/commands/start.test.ts`
  - Verify start still reattaches the updated reply keyboard contract.
- Modify: `tests/bot/commands/status.test.ts`
  - Verify status still reattaches the updated reply keyboard contract through `sendBotText`.
- Modify: `tests/settings/manager.test.ts`
  - Preserve and prove topic-local `agent/model/variant` isolation remains unchanged.

## Task 1: Relax Reply Keyboard Persistence Without Breaking Layout

**Files:**
- Modify: `src/bot/utils/keyboard.ts:38-80`
- Test: `tests/bot/utils/keyboard.test.ts`

- [ ] **Step 1: Write the failing keyboard tests**

Update `tests/bot/utils/keyboard.test.ts` so the main keyboard and deprecated agent keyboard still assert `resize_keyboard === true`, but no longer assert `is_persistent === true`.

Use this exact expectation shape:

```ts
expect(keyboard.resize_keyboard).toBe(true);
expect(keyboard.is_persistent).toBeUndefined();
```

Keep the existing button text assertions intact.

- [ ] **Step 2: Run the keyboard test to verify it fails**

Run:

```bash
npm test -- tests/bot/utils/keyboard.test.ts
```

Expected: FAIL because `createMainKeyboard()` and `createAgentKeyboard()` still call `.persistent()` and therefore set `is_persistent`.

- [ ] **Step 3: Implement the minimal keyboard change**

Edit `src/bot/utils/keyboard.ts` so both keyboard builders return a resized keyboard without `.persistent()`.

Make these exact code changes:

```ts
return keyboard.resized();
```

for both:

- `createMainKeyboard()`
- `createAgentKeyboard()`

Do not change button rows, labels, or `removeKeyboard()`.

- [ ] **Step 4: Run the keyboard test to verify it passes**

Run:

```bash
npm test -- tests/bot/utils/keyboard.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/utils/keyboard.ts tests/bot/utils/keyboard.test.ts
git commit -m "fix: keep telegram reply keyboard manually hideable"
```

## Task 2: Add Explicit Main-Thread Reply-Keyboard Routing Helpers

**Files:**
- Modify: `src/bot/utils/message-thread.ts:1-116`
- Test: `tests/bot/utils/message-thread.test.ts`

- [ ] **Step 1: Write failing routing-helper tests**

Extend `tests/bot/utils/message-thread.test.ts` with tests for two new helpers:

- `isForumMainThreadContext(ctx)`
- `resolveReplyKeyboardActionThreadId(ctx)`

Add these exact test cases:

```ts
it("detects forum main-thread message contexts", () => {
  const ctx = {
    chat: { id: -100123, type: "supergroup", is_forum: true },
    message: { chat: { id: -100123, type: "supergroup", is_forum: true } },
  } as unknown as Context;

  expect(isForumMainThreadContext(ctx)).toBe(true);
  expect(resolveReplyKeyboardActionThreadId(ctx)).toBe(0);
});

it("keeps topic thread ids for topic contexts", () => {
  const ctx = {
    chat: { id: -100123, type: "supergroup", is_forum: true },
    message: { chat: { id: -100123, type: "supergroup", is_forum: true }, message_thread_id: 42 },
  } as unknown as Context;

  expect(isForumMainThreadContext(ctx)).toBe(false);
  expect(resolveReplyKeyboardActionThreadId(ctx)).toBe(42);
});
```

Keep the existing `withMessageThreadId()` and `extractThreadTargetFromContext()` tests unchanged.

- [ ] **Step 2: Run the message-thread test to verify it fails**

Run:

```bash
npm test -- tests/bot/utils/message-thread.test.ts
```

Expected: FAIL because the new helpers do not exist yet.

- [ ] **Step 3: Implement the helpers in the routing utility**

Add these exports to `src/bot/utils/message-thread.ts`:

```ts
export function isForumMainThreadContext(ctx: Context): boolean {
  return isForumChat(ctx) && extractMessageThreadIdFromContext(ctx) === undefined;
}

export function resolveReplyKeyboardActionThreadId(ctx: Context): number | undefined {
  return isForumMainThreadContext(ctx) ? 0 : extractMessageThreadIdFromContext(ctx);
}
```

Do not change the current meaning of:

- `extractMessageThreadIdFromContext()`
- `extractThreadTargetFromContext()`
- `withMessageThreadId()`

The new helper is for reply-keyboard-driven action routing only, not a global replacement.

- [ ] **Step 4: Run the message-thread test to verify it passes**

Run:

```bash
npm test -- tests/bot/utils/message-thread.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/utils/message-thread.ts tests/bot/utils/message-thread.test.ts
git commit -m "test: cover forum main-thread reply-keyboard routing"
```

## Task 3: Let Inline Menus Open in Forced Main-Thread Mode

**Files:**
- Modify: `src/bot/handlers/inline-menu.ts:25-131`
- Test: `tests/bot/handlers/inline-menu.test.ts`

- [ ] **Step 1: Write the failing forced-routing test**

Extend `tests/bot/handlers/inline-menu.test.ts` with a test that opens a menu from a forum main-thread context and forces `messageThreadId: 0`.

Add this test:

```ts
it("opens inline menu in forum main thread without sending message_thread_id", async () => {
  const ctx = {
    chat: { id: 100, type: "supergroup", is_forum: true },
    message: { chat: { id: 100, type: "supergroup", is_forum: true } },
    reply: vi.fn().mockResolvedValue({ message_id: 55 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;

  await replyWithInlineMenu(ctx, {
    menuKind: "model",
    text: "Select model",
    keyboard: new InlineKeyboard().text("Model A", "model:a"),
    messageThreadId: 0,
  });

  expect(ctx.reply).toHaveBeenCalledWith(
    "Select model",
    expect.not.objectContaining({ message_thread_id: expect.anything() }),
  );
});
```

- [ ] **Step 2: Run the inline-menu test to verify it fails**

Run:

```bash
npm test -- tests/bot/handlers/inline-menu.test.ts
```

Expected: FAIL if the current menu path ignores explicit routing intent or the matcher shows the helper path is not explicit enough.

- [ ] **Step 3: Make inline menu thread routing explicit**

In `src/bot/handlers/inline-menu.ts`, preserve the current fallback to `extractThreadTargetFromContext(ctx)`, but make the override path explicit and readable.

Refactor this line:

```ts
const messageThreadId = options.messageThreadId ?? threadTarget?.messageThreadId;
```

into this exact structure:

```ts
const messageThreadId =
  options.messageThreadId !== undefined ? options.messageThreadId : threadTarget?.messageThreadId;
```

Do not change the interaction registration or cancel behavior.

- [ ] **Step 4: Run the inline-menu test to verify it passes**

Run:

```bash
npm test -- tests/bot/handlers/inline-menu.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/inline-menu.ts tests/bot/handlers/inline-menu.test.ts
git commit -m "refactor: make inline menu thread overrides explicit"
```

## Task 4: Keep Model Reply-Keyboard Actions in Main Thread

**Files:**
- Modify: `src/bot/handlers/model.ts:1-409`
- Test: `tests/bot/handlers/model.test.ts`

- [ ] **Step 1: Write the failing model-routing tests**

Extend `tests/bot/handlers/model.test.ts` with two targeted assertions:

1. `showModelSelectionMenu()` from forum main thread opens the menu without `message_thread_id`
2. `handleModelSelect()` from forum main thread confirms without `message_thread_id`

Use the existing mocked `replyWithInlineMenuMock` and `ctx.reply` assertions. Add a main-thread callback context that has:

```ts
chat: { id: 111, type: "supergroup", is_forum: true }
```

and a callback message without `message_thread_id`.

Assert:

```ts
expect(mocked.replyWithInlineMenuMock).toHaveBeenCalledWith(
  ctx,
  expect.objectContaining({ messageThreadId: 0 }),
);

expect(ctx.reply).toHaveBeenCalledWith(
  t("model.changed_message", { name: "openai / gpt-4.11" }),
  expect.not.objectContaining({ message_thread_id: expect.anything() }),
);
```

- [ ] **Step 2: Run the model handler test to verify it fails**

Run:

```bash
npm test -- tests/bot/handlers/model.test.ts
```

Expected: FAIL because the handler still routes through `extractMessageThreadIdFromContext()` and does not explicitly force main-thread reply-keyboard behavior.

- [ ] **Step 3: Implement main-thread-aware routing in the model handler**

In `src/bot/handlers/model.ts`:

1. Import the new helper:

```ts
import {
  extractMessageThreadIdFromContext,
  resolveReplyKeyboardActionThreadId,
  withMessageThreadId,
} from "../utils/message-thread.js";
```

2. In `showModelSelectionMenu(ctx)`, compute:

```ts
const actionThreadId = resolveReplyKeyboardActionThreadId(ctx);
```

and pass it into `replyWithInlineMenu()`:

```ts
await replyWithInlineMenu(ctx, {
  menuKind: "model",
  text: buildProviderSelectionText(currentModel),
  keyboard,
  messageThreadId: actionThreadId,
});
```

3. In `handleModelSelect(ctx)`, replace the confirmation reply thread source with:

```ts
withMessageThreadId({ reply_markup: keyboard }, resolveReplyKeyboardActionThreadId(ctx))
```

Do not change model selection side effects or stale callback handling.

- [ ] **Step 4: Run the model handler test to verify it passes**

Run:

```bash
npm test -- tests/bot/handlers/model.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/model.ts tests/bot/handlers/model.test.ts
git commit -m "fix: keep model reply-keyboard actions in main thread"
```

## Task 5: Keep Agent Reply-Keyboard Actions in Main Thread

**Files:**
- Modify: `src/bot/handlers/agent.ts:1-156`
- Create: `tests/bot/handlers/agent.test.ts`

- [ ] **Step 1: Write the failing agent handler test file**

Create `tests/bot/handlers/agent.test.ts` following the mocking style used in `tests/bot/handlers/model.test.ts`.

Cover these cases:

1. `showAgentSelectionMenu()` passes `messageThreadId: 0` into `replyWithInlineMenu()` when called from forum main thread
2. `handleAgentSelect()` replies without `message_thread_id` when the callback came from forum main thread

Use this assertion pattern for the confirmation reply:

```ts
expect(ctx.reply).toHaveBeenCalledWith(
  t("agent.changed_message", { name: "🛠️ Build Mode" }),
  expect.not.objectContaining({ message_thread_id: expect.anything() }),
);
```

Adjust the localized display value if the exact message uses `getAgentDisplayName()` output without emoji duplication.

- [ ] **Step 2: Run the new agent handler test to verify it fails**

Run:

```bash
npm test -- tests/bot/handlers/agent.test.ts
```

Expected: FAIL because the test file is new and the handler does not yet use the main-thread routing helper.

- [ ] **Step 3: Implement main-thread-aware routing in the agent handler**

In `src/bot/handlers/agent.ts`:

1. Import `resolveReplyKeyboardActionThreadId`
2. In `showAgentSelectionMenu(ctx)`, pass `messageThreadId: resolveReplyKeyboardActionThreadId(ctx)` into `replyWithInlineMenu()`
3. In `handleAgentSelect(ctx)`, replace the confirmation reply routing source with `resolveReplyKeyboardActionThreadId(ctx)`

Keep all current selection, keyboard update, and inline-menu cleanup behavior unchanged.

- [ ] **Step 4: Run the agent handler test to verify it passes**

Run:

```bash
npm test -- tests/bot/handlers/agent.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/agent.ts tests/bot/handlers/agent.test.ts
git commit -m "test: cover main-thread agent reply-keyboard flow"
```

## Task 6: Keep Variant Reply-Keyboard Actions in Main Thread

**Files:**
- Modify: `src/bot/handlers/variant.ts:1-197`
- Create: `tests/bot/handlers/variant.test.ts`

- [ ] **Step 1: Write the failing variant handler test file**

Create `tests/bot/handlers/variant.test.ts` using the same mock layout as the model and agent handler tests.

Cover these cases:

1. `showVariantSelectionMenu()` passes `messageThreadId: 0` into `replyWithInlineMenu()` from forum main thread
2. `handleVariantSelect()` replies without `message_thread_id` from forum main thread

Use this confirmation assertion pattern:

```ts
expect(ctx.reply).toHaveBeenCalledWith(
  t("variant.changed_message", { name: "Fast" }),
  expect.not.objectContaining({ message_thread_id: expect.anything() }),
);
```

- [ ] **Step 2: Run the new variant handler test to verify it fails**

Run:

```bash
npm test -- tests/bot/handlers/variant.test.ts
```

Expected: FAIL because the file is new and the handler still uses `extractMessageThreadIdFromContext()`.

- [ ] **Step 3: Implement main-thread-aware routing in the variant handler**

In `src/bot/handlers/variant.ts`:

1. Import `resolveReplyKeyboardActionThreadId`
2. In `showVariantSelectionMenu(ctx)`, pass `messageThreadId: resolveReplyKeyboardActionThreadId(ctx)` into `replyWithInlineMenu()`
3. In `handleVariantSelect(ctx)`, route the confirmation reply through `resolveReplyKeyboardActionThreadId(ctx)`

Keep variant update side effects and menu cleanup unchanged.

- [ ] **Step 4: Run the variant handler test to verify it passes**

Run:

```bash
npm test -- tests/bot/handlers/variant.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/variant.ts tests/bot/handlers/variant.test.ts
git commit -m "test: cover main-thread variant reply-keyboard flow"
```

## Task 7: Preserve Existing Topic-Scoped Agent/Model Behavior While Documenting Main-Thread Defaults

**Files:**
- Modify: `tests/settings/manager.test.ts:139-181`

- [ ] **Step 1: Extend the settings test with a no-regression case**

Add a new test after `it("isolates agent, model, and reasoning mode by topic while keeping streaming per user", ...)` that proves topic-local agent/model state remains isolated even after other scopes have their own values.

Add this test:

```ts
it("keeps topic-local agent and model values isolated across forum scopes", () => {
  runWithTelegramConversationScope(scopeA, () => {
    setCurrentAgent("build");
    setCurrentModel({ providerID: "openai", modelID: "gpt-5", variant: "default" });
  });

  runWithTelegramConversationScope(scopeAOtherTopic, () => {
    setCurrentAgent("plan");
    setCurrentModel({ providerID: "anthropic", modelID: "claude", variant: "fast" });
  });

  expect(runWithTelegramConversationScope(scopeA, () => getCurrentAgent())).toBe("build");
  expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentAgent())).toBe("plan");
  expect(runWithTelegramConversationScope(scopeA, () => getCurrentModel())).toEqual({
    providerID: "openai",
    modelID: "gpt-5",
    variant: "default",
  });
  expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentModel())).toEqual({
    providerID: "anthropic",
    modelID: "claude",
    variant: "fast",
  });
});
```

This is mostly redundant with the existing test, but it gives the main-thread work a focused regression guard around topic isolation.

- [ ] **Step 2: Run the settings manager test to verify it passes**

Run:

```bash
npm test -- tests/settings/manager.test.ts
```

Expected: PASS.

- [ ] **Step 3: If the new test exposes coupling, stop and fix only the minimal issue**

If the test fails, fix only the regression directly related to topic-local `agent/model` isolation. Do not redesign the settings manager in this task.

- [ ] **Step 4: Re-run the settings manager test**

Run:

```bash
npm test -- tests/settings/manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/settings/manager.test.ts
git commit -m "test: lock topic-scoped model and agent isolation"
```

## Task 8: Verify Keyboard Reattachment Paths Still Behave Correctly

**Files:**
- Modify: `tests/bot/commands/start.test.ts`
- Modify: `tests/bot/commands/status.test.ts`

- [ ] **Step 1: Update the command tests to match the new keyboard contract**

In `tests/bot/commands/start.test.ts`, keep the existing assertion that `reply_markup` is attached, but do not assume persistence flags in the returned keyboard object.

In `tests/bot/commands/status.test.ts`, add an assertion that `sendBotText()` is still called with a `reply_markup` payload when keyboard state exists:

```ts
expect(mocked.sendBotTextMock).toHaveBeenCalledWith(
  expect.objectContaining({
    options: expect.objectContaining({ reply_markup: { inline_keyboard: [] } }),
  }),
);
```

- [ ] **Step 2: Run the start and status tests**

Run:

```bash
npm test -- tests/bot/commands/start.test.ts tests/bot/commands/status.test.ts
```

Expected: PASS.

- [ ] **Step 3: If needed, make the minimal production adjustment**

If either test fails because command paths make assumptions about the old keyboard persistence shape, fix only the specific assertion or payload construction issue. Do not change unrelated command behavior.

- [ ] **Step 4: Re-run the start and status tests**

Run:

```bash
npm test -- tests/bot/commands/start.test.ts tests/bot/commands/status.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add tests/bot/commands/start.test.ts tests/bot/commands/status.test.ts
git commit -m "test: keep reply keyboard attached on command replies"
```

## Task 9: Run Focused Verification Then Full Project Checks

**Files:**
- No code changes expected unless verification finds a regression

- [ ] **Step 1: Run the focused thread and handler tests**

Run:

```bash
npm test -- tests/bot/utils/keyboard.test.ts tests/bot/utils/message-thread.test.ts tests/bot/handlers/inline-menu.test.ts tests/bot/handlers/model.test.ts tests/bot/handlers/agent.test.ts tests/bot/handlers/variant.test.ts tests/settings/manager.test.ts tests/bot/commands/start.test.ts tests/bot/commands/status.test.ts
```

Expected: PASS.

- [ ] **Step 2: If anything fails, fix the smallest production code path necessary**

Allowed files for fixes in this step:

- `src/bot/utils/keyboard.ts`
- `src/bot/utils/message-thread.ts`
- `src/bot/handlers/inline-menu.ts`
- `src/bot/handlers/agent.ts`
- `src/bot/handlers/model.ts`
- `src/bot/handlers/variant.ts`
- `tests/...` files added in earlier tasks

Do not broaden scope beyond reply-keyboard display and main-thread action routing.

- [ ] **Step 3: Run lint**

Run:

```bash
npm run lint
```

Expected: PASS.

- [ ] **Step 4: Run build**

Run:

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 5: Run the full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bot/utils/keyboard.ts src/bot/utils/message-thread.ts src/bot/handlers/inline-menu.ts src/bot/handlers/agent.ts src/bot/handlers/model.ts src/bot/handlers/variant.ts tests/bot/utils/keyboard.test.ts tests/bot/utils/message-thread.test.ts tests/bot/handlers/inline-menu.test.ts tests/bot/handlers/model.test.ts tests/bot/handlers/agent.test.ts tests/bot/handlers/variant.test.ts tests/settings/manager.test.ts tests/bot/commands/start.test.ts tests/bot/commands/status.test.ts
git commit -m "fix: keep reply-keyboard actions in forum main thread"
```

## Task 10: Update Product Docs And Changelog

**Files:**
- Modify: `CHANGELOG.md`
- Modify: `PRODUCT.md`

- [ ] **Step 1: Update the changelog entry under `[Unreleased]`**

Add a `### Fixed` entry near the top of that section with this content adapted to repo style:

```md
- Fixed forum main-thread reply keyboard visibility and reply-keyboard action routing so the keyboard remains manually hideable, reappears on later bot replies, and `agent` / `model` / `variant` actions opened from main thread stay in main thread instead of creating a new topic.
  - Why: Telegram mobile clients could hide the keyboard toggle when the bot forced a persistent reply keyboard, and reply-keyboard-driven configuration actions in forum main thread should behave symmetrically with topics without spawning new threads.
  - Affects: `src/bot/utils/keyboard.ts`, `src/bot/utils/message-thread.ts`, `src/bot/handlers/inline-menu.ts`, `src/bot/handlers/agent.ts`, `src/bot/handlers/model.ts`, `src/bot/handlers/variant.ts`, `tests/bot/utils/*.test.ts`, `tests/bot/handlers/*.test.ts`, `tests/settings/manager.test.ts`
```

- [ ] **Step 2: Update `PRODUCT.md` if the current scope text should mention the corrected keyboard behavior**

Add a short clarification in the current scope area near the existing keyboard sentence at line 121 so it reads like this:

```md
Model, agent, variant, and context actions are available from the persistent bottom keyboard. In forum chats, reply-keyboard actions opened from the main thread stay in the main thread, while topic-local selections remain isolated per topic.
```

If the exact wording needs to stay closer to existing style, preserve the meaning and keep it to one sentence.

- [ ] **Step 3: Run targeted doc sanity checks**

Run:

```bash
npm run build
```

Expected: PASS. No dedicated markdown checker exists, so the build is the required post-doc sanity check in this repo workflow.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md PRODUCT.md
git commit -m "docs: record forum main-thread reply keyboard fix"
```

## Self-Review

- Spec coverage: covered keyboard visibility, native hide behavior, main-thread-only reply-keyboard action routing, topic-local preservation, regression verification, and docs updates.
- Placeholder scan: no `TODO`, `TBD`, or implicit “write tests” steps remain.
- Type consistency: all planned helpers use exact names introduced in earlier tasks:
  - `isForumMainThreadContext`
  - `resolveReplyKeyboardActionThreadId`

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-main-thread-reply-keyboard-and-scope.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
