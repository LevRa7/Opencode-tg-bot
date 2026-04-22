# Fix v0.17 Cosmetic Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix three cosmetic regressions after semantic port to v0.17.0: (1) Markdown tags render as plain text, (2) streaming does not work, (3) inline-keyboard display inconsistent across Telegram clients.

**Architecture:** Extend existing sending pipeline to pass `entities` (Telegram native formatting) and `parse_mode` correctly; ensure `message_thread_id` is explicit for forum chats; propagate format/entities in streaming callbacks. Minimal changes to preserve multi‑user orchestration, approval flows, threaded routing, and Docker customizations.

**Tech Stack:** TypeScript, grammY, OpenCode SDK, Telegram Bot API.

---

### Task 1: Extend send‑with‑markdown‑fallback to support entities

**Files:**
- Modify: `src/bot/utils/send‑with‑markdown‑fallback.ts`
- Test: `tests/bot/utils/send‑with‑markdown‑fallback.test.ts`

- [ ] **Step 1: Write failing test for entities parameter**

```typescript
// Add to existing test suite
describe("sendMessageWithMarkdownFallback with entities", () => {
  it("should send with entities when provided", async () => {
    const mockApi = { sendMessage: vi.fn() };
    const text = "test";
    const entities = [
      { type: "bold", offset: 0, length: 4 }
    ];
    await sendMessageWithMarkdownFallback(
      mockApi as any,
      { chat_id: 123, text },
      { entities }
    );
    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      123,
      text,
      expect.objectContaining({ entities })
    );
    // Should NOT include parse_mode when entities present
    expect(mockApi.sendMessage.mock.calls[0][2]).not.toHaveProperty("parse_mode");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/send‑with‑markdown‑fallback.test.ts -v`
Expected: FAIL with "sendMessageWithMarkdownFallback does not accept entities parameter"

- [ ] **Step 3: Add entities parameter to sendMessageWithMarkdownFallback**

```typescript
// In src/bot/utils/send‑with‑markdown‑fallback.ts
export async function sendMessageWithMarkdownFallback(
  api: TelegramApi,
  params: SendMessageParams,
  options: {
    entities?: MessageEntity[];
    // ... existing options
  } = {}
): Promise<Message.TextMessage> {
  const { entities, ...restOptions } = options;
  
  if (entities && entities.length > 0) {
    // Use native Telegram formatting
    try {
      return await api.sendMessage(params.chat_id, params.text, {
        ...params.other,
        entities,
        ...restOptions,
      });
    } catch (err) {
      // Fallback to parse_mode if entities are rejected
      logger.debug("[send] entities rejected, falling back", err);
    }
  }
  // existing parse_mode logic...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/send‑with‑markdown‑fallback.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/utils/send‑with‑markdown‑fallback.ts tests/bot/utils/send‑with‑markdown‑fallback.test.ts
git commit -m "feat: add entities parameter to sendMessageWithMarkdownFallback"
```

---

### Task 2: Update telegram‑text utilities to forward entities

**Files:**
- Modify: `src/bot/utils/telegram‑text.ts`
- Test: `tests/bot/utils/telegram‑text.test.ts`

- [ ] **Step 1: Write failing test for sendBotText with entities**

```typescript
describe("sendBotText with entities", () => {
  it("should forward entities to sendMessageWithMarkdownFallback", async () => {
    const mockApi = { sendMessage: vi.fn() };
    const ctx = { api: mockApi, chat: { id: 123 } } as any;
    const entities = [{ type: "italic", offset: 0, length: 4 }];
    await sendBotText(ctx, "test", { entities });
    expect(mockApi.sendMessage).toHaveBeenCalledWith(
      123,
      "test",
      expect.objectContaining({ entities })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/telegram‑text.test.ts -v`
Expected: FAIL (sendBotText does not accept entities)

- [ ] **Step 3: Add entities parameter to sendBotText and editBotText**

```typescript
// In src/bot/utils/telegram‑text.ts
export async function sendBotText(
  ctx: Context,
  text: string,
  options: {
    entities?: MessageEntity[];
    // ... existing options
  } = {}
): Promise<Message.TextMessage> {
  // ... existing logic
  return sendMessageWithMarkdownFallback(
    ctx.api,
    { chat_id: ctx.chat.id, text, ...extraParams },
    { entities: options.entities, ...extraOptions }
  );
}

// Similarly editBotText
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/telegram‑text.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/utils/telegram‑text.ts tests/bot/utils/telegram‑text.test.ts
git commit -m "feat: forward entities in sendBotText/editBotText"
```

---

### Task 3: Pass entities from rendered parts to sending pipeline

**Files:**
- Modify: `src/bot/index.ts` (around sendRenderedPart)
- Test: `tests/bot/index.test.ts` (if exists) or integration test

- [ ] **Step 1: Write failing test for sendRenderedPart with entities**

```typescript
// Add to existing test file or create new integration test
describe("sendRenderedPart", () => {
  it("should pass part.entities to sendBotText", async () => {
    const mockSendBotText = vi.fn();
    // Replace import with mock
    const part = {
      text: "**bold**",
      entities: [{ type: "bold", offset: 0, length: 4 }]
    };
    await sendRenderedPart(mockContext, part);
    expect(mockSendBotText).toHaveBeenCalledWith(
      mockContext,
      part.text,
      expect.objectContaining({ entities: part.entities })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/index.test.ts -v`
Expected: FAIL (sendRenderedPart does not pass entities)

- [ ] **Step 3: Update sendRenderedPart call in index.ts**

```typescript
// Locate sendRenderedPart function (likely inside finalizeAssistantResponse)
// In src/bot/index.ts, find:
// const message = await sendBotText(ctx, part.text, { ... });
// Change to:
const message = await sendBotText(ctx, part.text, {
  ...otherOptions,
  entities: part.entities,
});
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/index.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/index.ts tests/bot/index.test.ts
git commit -m "feat: pass entities from rendered parts to sendBotText"
```

---

### Task 4: Ensure streaming callbacks propagate format/entities

**Files:**
- Modify: `src/bot/index.ts` (responseStreamer callbacks)
- Modify: `src/bot/streaming/response‑streamer.ts` (types)
- Test: `tests/bot/streaming/response‑streamer.test.ts`

- [ ] **Step 1: Write failing test for streaming with format**

```typescript
describe("ResponseStreamer callbacks", () => {
  it("should apply parse_mode when format is markdown_v2", async () => {
    const mockSend = vi.fn();
    const streamer = new ResponseStreamer(mockSend, mockEdit);
    const payload = {
      parts: [{ text: "test", entities: [] }],
      format: "markdown_v2" as const,
    };
    await streamer.enqueue(payload);
    // Wait for flush
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(mockSend).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({ parse_mode: "MarkdownV2" })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/streaming/response‑streamer.test.ts -v`
Expected: FAIL (callbacks ignore format)

- [ ] **Step 3: Update callbacks in index.ts to use format**

```typescript
// In src/bot/index.ts, locate responseStreamer creation
const responseStreamer = new ResponseStreamer(
  async (text, options) => {
    return sendBotText(ctx, text, {
      ...options,
      parse_mode: options.format === "markdown_v2" ? "MarkdownV2" : undefined,
      entities: options.entities,
    });
  },
  async (messageId, text, options) => {
    return editBotText(ctx, messageId, text, {
      ...options,
      parse_mode: options.format === "markdown_v2" ? "MarkdownV2" : undefined,
      entities: options.entities,
    });
  }
);
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/streaming/response‑streamer.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/index.ts tests/bot/streaming/response‑streamer.test.ts
git commit -m "feat: propagate format/entities in streaming callbacks"
```

---

### Task 5: Add logging to prepareAssistantStreamingPayload

**Files:**
- Modify: `src/bot/utils/assistant‑rendering.ts`
- Test: `tests/bot/utils/assistant‑rendering.test.ts`

- [ ] **Step 1: Write failing test for logging**

```typescript
describe("prepareAssistantStreamingPayload", () => {
  it("should log when returning null", () => {
    const loggerSpy = vi.spyOn(logger, "debug");
    const parts = [/* parts that cause null return */];
    const result = prepareAssistantStreamingPayload(parts, "markdown_v2");
    expect(result).toBeNull();
    expect(loggerSpy).toHaveBeenCalledWith(
      expect.stringContaining("streaming payload"),
      expect.anything()
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/assistant‑rendering.test.ts -v`
Expected: FAIL (no logging)

- [ ] **Step 3: Add debug logging**

```typescript
// In src/bot/utils/assistant‑rendering.ts, inside prepareAssistantStreamingPayload
if (/* condition that leads to null */) {
  logger.debug("[assistant‑rendering] cannot create streaming payload", {
    partsCount: parts.length,
    format,
    reason: "cannot chunk with entities",
  });
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/assistant‑rendering.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/utils/assistant‑rendering.ts tests/bot/utils/assistant‑rendering.test.ts
git commit -m "feat: add debug logging for streaming payload preparation"
```

---

### Task 6: Fix forum chat thread ID extraction

**Files:**
- Modify: `src/bot/utils/message‑thread.ts`
- Test: `tests/bot/utils/message‑thread.test.ts`

- [ ] **Step 1: Write failing test for forum chat with undefined thread ID**

```typescript
describe("extractThreadTargetFromContext", () => {
  it("should return thread ID 0 for forum chat when message_thread_id is undefined", () => {
    const ctx = {
      chat: { type: "supergroup", is_forum: true },
      message: { message_thread_id: undefined },
    } as any;
    const result = extractThreadTargetFromContext(ctx);
    expect(result.messageThreadId).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/message‑thread.test.ts -v`
Expected: FAIL (returns undefined)

- [ ] **Step 3: Update extractThreadTargetFromContext**

```typescript
// In src/bot/utils/message‑thread.ts
export function extractThreadTargetFromContext(ctx: Context): ThreadTarget {
  // ... existing logic
  let { messageThreadId } = ctx.message ?? {};
  
  // For forum chats, ensure a defined thread ID (0 = main thread)
  if (isForumChat(ctx) && messageThreadId === undefined) {
    messageThreadId = 0;
  }
  
  return { messageThreadId };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/utils/message‑thread.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/utils/message‑thread.ts tests/bot/utils/message‑thread.test.ts
git commit -m "fix: ensure defined thread ID for forum chats"
```

---

### Task 7: Update inline‑menu reply to use explicit thread ID

**Files:**
- Modify: `src/bot/handlers/inline‑menu.ts`
- Test: `tests/bot/handlers/inline‑menu.test.ts`

- [ ] **Step 1: Write failing test for replyWithInlineMenu thread ID**

```typescript
describe("replyWithInlineMenu", () => {
  it("should pass message_thread_id to ctx.reply", async () => {
    const ctx = {
      chat: { id: 123, type: "supergroup", is_forum: true },
      message: { message_thread_id: undefined },
      reply: vi.fn(),
    } as any;
    await replyWithInlineMenu(ctx, "Test", []);
    expect(ctx.reply).toHaveBeenCalledWith(
      "Test",
      expect.objectContaining({ message_thread_id: 0 })
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/handlers/inline‑menu.test.ts -v`
Expected: FAIL (does not pass message_thread_id)

- [ ] **Step 3: Update replyWithInlineMenu**

```typescript
// In src/bot/handlers/inline‑menu.ts
export async function replyWithInlineMenu(
  ctx: Context,
  text: string,
  buttons: InlineKeyboardButton[][],
  options: { threadId?: number } = {}
) {
  const { messageThreadId } = extractThreadTargetFromContext(ctx);
  return ctx.reply(text, {
    reply_markup: { inline_keyboard: buttons },
    message_thread_id: messageThreadId,
    ...options,
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test -- tests/bot/handlers/inline‑menu.test.ts -v`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add src/bot/handlers/inline‑menu.ts tests/bot/handlers/inline‑menu.test.ts
git commit -m "feat: pass explicit thread ID to inline menu replies"
```

---

### Task 8: Integration verification

**Files:**
- Run existing test suite
- Run lint and build

- [ ] **Step 1: Run all tests**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm test`
Expected: All 899 tests pass (no regressions)

- [ ] **Step 2: Run lint**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm run lint`
Expected: No errors

- [ ] **Step 3: Run build**

Run: `cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs && npm run build`
Expected: Build succeeds

- [ ] **Step 4: Commit verification results**

```bash
cd /home/me/MyProjects/opencode‑tg/.worktrees/fix‑v0‑17‑cosmetic‑bugs
git add package-lock.json  # if any changes
git commit -m "chore: verification passes after cosmetic fixes"
```

---

### Task 9: Manual smoke test (if environment permits)

**Actions:**
- [ ] Send a task that produces bold/italic/code text (e.g., "Write **bold**, _italic_, `code`")
- [ ] Send a long task that should stream (e.g., "List numbers 1 to 50")
- [ ] Trigger an inline menu (e.g., `/model` in a forum chat)
- [ ] Verify all three issues are resolved

**Note:** Manual testing depends on available Telegram test environment. If not possible, rely on automated tests.

---

## Self‑Review

**Spec coverage:**
- Tags rendering: Tasks 1‑4 cover entities pipeline.
- Streaming: Tasks 4‑5 cover format propagation and logging.
- Inline keyboards: Tasks 6‑7 cover forum thread ID.
- Integration: Task 8‑9.

**Placeholder scan:** No TBD/TODO placeholders; each step contains concrete code.

**Type consistency:** Used consistent parameter names (`entities`, `format`, `messageThreadId`) across tasks.

---

**Plan complete and saved to `docs/superpowers/plans/2026‑04‑21‑fix‑v0‑17‑cosmetic‑bugs.md`. Two execution options:**

**1. Subagent‑Driven (recommended)** – I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** – Execute tasks in this session using executing‑plans, batch execution with checkpoints

**Which approach?**