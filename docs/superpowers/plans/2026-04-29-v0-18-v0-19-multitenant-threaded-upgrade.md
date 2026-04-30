# v0.18-v0.19 Multitenant Threaded Upgrade Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Port the useful changes from upstream `grinev/opencode-telegram-bot` `v0.18.0` and `v0.19.0` into this customized `v0.17.0` fork without regressing multi-user isolation or Telegram forum-topic (`threaded_mode`) session routing.

**Architecture:** Treat upstream as feature reference, not as a patch to apply verbatim. Every new behavior must be scoped by `TelegramConversationScope` (`userId`, `chatId`, optional `messageThreadId`) and must route replies through the existing thread-aware managers instead of global single-user state. Keep global process management only for host-level bot runtime; user/session state, attached sessions, pending interactions, pinned messages, streaming, TTS settings, and external-input suppression must remain conversation/user scoped.

**Tech Stack:** TypeScript 5.x, Node.js 20+, grammY, OpenCode SDK, Vitest, existing settings persistence in `settings.json`, existing multi-user/thread managers under `src/thread`, `src/telegram`, and `src/settings`.

---

## Upstream Change Inventory

Bring in these upstream functional changes after adaptation:

- Attached/live session tracking from commits `3b7d42f` and `56d65b2`: automatic attachment to selected/new sessions, restore pending questions/permissions, detect external user input, busy/idle handling.
- `/mcps` command from commit `f82fab6`: list MCP servers, show details, connect/disconnect/toggle.
- Optional OpenCode server monitoring and auto-restart from commit `d10da74`.
- Google Cloud TTS provider and markdown stripping from commits `52fc925` and `b51dea4`.
- Custom MarkdownV2 formatter and removal of `telegram-markdown-v2` from commit `66403c0`.
- Subagent display fixes from commits `18909f5` and `fb8e44d`.
- Pinned startup fix from commit `36503c6`.

Do not spend implementation time on upstream-only release commits, README community-link docs, or lockfile-only security refresh except where package dependency changes are required by the functional work.

## Local Constraints To Preserve

- `src/telegram/scope.ts` is the source of conversation identity. New maps must use `buildTelegramConversationScopeKey()` or `resolveTelegramConversationScopeKey()` rather than raw session IDs where Telegram routing matters.
- `src/thread/manager.ts` binds projects, sessions, models, and agents to forum topics. Attach/follow features must extend this binding model instead of introducing a parallel single-user session target.
- `settings.json` already supports `scopedConversationSettings`, `scopedUserSettings`, `tenantRuntimes`, and `threadContextBindings`; new persistence must fit this shape or add explicit scoped records.
- Existing command definitions are centralized in `src/bot/commands/definitions.ts`; add `/mcps` there only.
- Existing `PRODUCT.md` lists `/mcps` and auto-restart as open; mark them complete only after implementation and tests pass.
- Do not create commits unless the user explicitly asks. The commit checklist items below are checkpoints for a future commit-enabled execution session.

## File Structure

Create:

- `src/attach/types.ts`: scoped attach state types and cloning helpers.
- `src/attach/manager.ts`: in-memory and persisted attached-session registry keyed by conversation scope.
- `src/attach/service.ts`: application service that attaches/detaches sessions and rehydrates active interactions for a scope.
- `src/external-input/suppression.ts`: scoped duplicate/external-input suppression window keyed by session and scope.
- `src/bot/utils/external-user-input.ts`: formatter and delivery helper for external OpenCode user input events.
- `src/bot/commands/mcps.ts`: `/mcps` command and callback handlers.
- `src/opencode/auto-restart.ts`: monitor abstraction for local/tenant OpenCode health checks.
- `src/summary/markdown-to-telegram-v2.ts`: local MarkdownV2 converter replacing `telegram-markdown-v2`.
- Tests matching the created modules under `tests/attach`, `tests/external-input`, `tests/bot/commands`, `tests/opencode`, and `tests/summary`.

Modify:

- `src/settings/manager.ts`: persist scoped attached-session state if needed.
- `src/thread/manager.ts`: expose safe scope/session lookup helpers needed by attach/event routing.
- `src/bot/index.ts`: wire event routing, `/mcps`, attach updates, external input notifications, auto-restart lifecycle, and subagent/pinned fixes.
- `src/bot/handlers/prompt.ts`: ensure prompt sends attach the active session for the active topic scope and suppress self-origin external input.
- `src/bot/commands/new.ts`, `src/bot/commands/sessions.ts`, `src/bot/commands/commands.ts`, `src/bot/commands/start.ts`: attach selected/created sessions by default using active scope.
- `src/bot/commands/definitions.ts`: add `/mcps` command definition only.
- `src/bot/utils/busy-guard.ts` and `src/interaction/guard.ts`: account for scoped attached-session busy state.
- `src/pinned/manager.ts` and `src/pinned/types.ts`: apply startup pin fix without breaking scoped pinned message IDs.
- `src/summary/aggregator.ts` and `src/summary/subagent-formatter.ts`: apply subagent duplicate/tool-call fixes.
- `src/summary/formatter.ts` and `src/telegram/render/inline-renderer.ts`: use local MarkdownV2 formatter and preserve safe link behavior.
- `src/tts/client.ts` and `src/config.ts`: add `TTS_PROVIDER`, Google provider config, and markdown stripping.
- `src/app/start-bot-app.ts`: start/stop auto-restart monitor with scoped/tenant-aware process manager behavior.
- `.env.example`, `README.md`, `PRODUCT.md`, `CHANGELOG.md`, `package.json`, `package-lock.json`: document and record user-visible changes.

---

### Task 1: Capture Upstream Behavior As Local Failing Tests

**Files:**
- Create: `tests/attach/manager.test.ts`
- Create: `tests/attach/service.test.ts`
- Create: `tests/external-input/suppression.test.ts`
- Create: `tests/bot/commands/mcps.test.ts`
- Create: `tests/opencode/auto-restart.test.ts`
- Modify: `tests/tts/client.test.ts`
- Modify: `tests/summary/aggregator.test.ts`
- Modify: `tests/summary/subagent-formatter.test.ts`

- [ ] **Step 1: Add failing attach manager tests**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { attachManager } from "../../src/attach/manager.js";

describe("attachManager", () => {
  beforeEach(() => {
    attachManager.__resetForTests();
  });

  it("stores attached sessions independently per Telegram forum topic", () => {
    attachManager.attach(
      { userId: 10, chatId: -100, messageThreadId: 1 },
      { id: "session-a", title: "A", directory: "/repo/a" },
    );
    attachManager.attach(
      { userId: 10, chatId: -100, messageThreadId: 2 },
      { id: "session-b", title: "B", directory: "/repo/b" },
    );

    expect(attachManager.getAttachedSession({ userId: 10, chatId: -100, messageThreadId: 1 })?.id).toBe(
      "session-a",
    );
    expect(attachManager.getAttachedSession({ userId: 10, chatId: -100, messageThreadId: 2 })?.id).toBe(
      "session-b",
    );
  });

  it("finds the Telegram target for an attached OpenCode session", () => {
    attachManager.attach(
      { userId: 11, chatId: -200, messageThreadId: 77 },
      { id: "session-c", title: "C", directory: "/repo/c" },
    );

    expect(attachManager.getTargetForSession("session-c")).toEqual({
      chatId: -200,
      messageThreadId: 77,
    });
  });
});
```

- [ ] **Step 2: Add failing external input suppression tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { ExternalInputSuppression } from "../../src/external-input/suppression.js";

describe("ExternalInputSuppression", () => {
  it("suppresses only matching self-origin input in the same scoped session", () => {
    vi.useFakeTimers();
    const suppression = new ExternalInputSuppression({ ttlMs: 1_000 });
    const scope = { userId: 1, chatId: -100, messageThreadId: 5 };

    suppression.rememberSelfInput("session-1", scope, "run tests");

    expect(suppression.shouldSuppress("session-1", scope, "run tests")).toBe(true);
    expect(
      suppression.shouldSuppress("session-1", { userId: 1, chatId: -100, messageThreadId: 6 }, "run tests"),
    ).toBe(false);
    expect(suppression.shouldSuppress("session-1", scope, "different input")).toBe(false);

    vi.advanceTimersByTime(1_001);
    expect(suppression.shouldSuppress("session-1", scope, "run tests")).toBe(false);
    vi.useRealTimers();
  });
});
```

- [ ] **Step 3: Add failing MCP command tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { buildMcpServerListText, buildMcpServerDetailText } from "../../../src/bot/commands/mcps.js";

describe("/mcps command", () => {
  it("renders MCP servers with connection state", () => {
    expect(
      buildMcpServerListText([
        { id: "github", name: "GitHub", enabled: true, connected: true },
        { id: "db", name: "Database", enabled: false, connected: false },
      ]),
    ).toContain("GitHub");
    expect(buildMcpServerListText([{ id: "github", name: "GitHub", enabled: true, connected: true }])).toContain(
      "connected",
    );
  });

  it("renders MCP server details without leaking raw SDK payloads", () => {
    const text = buildMcpServerDetailText({
      id: "github",
      name: "GitHub",
      enabled: true,
      connected: false,
      command: "npx github-mcp",
    });

    expect(text).toContain("GitHub");
    expect(text).toContain("npx github-mcp");
  });
});
```

- [ ] **Step 4: Add failing auto-restart monitor tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { createOpenCodeAutoRestartMonitor } from "../../src/opencode/auto-restart.js";

describe("createOpenCodeAutoRestartMonitor", () => {
  it("starts the runtime when health check fails and auto-restart is enabled", async () => {
    const ensureRuntime = vi.fn().mockResolvedValue({ success: false, error: "down" });
    const start = vi.fn().mockResolvedValue({ success: true });
    const monitor = createOpenCodeAutoRestartMonitor({
      enabled: true,
      intervalMs: 1000,
      ensureRuntime,
      start,
    });

    await monitor.checkNow();

    expect(ensureRuntime).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 5: Run the new targeted tests and verify they fail**

Run: `npm test -- tests/attach/manager.test.ts tests/external-input/suppression.test.ts tests/bot/commands/mcps.test.ts tests/opencode/auto-restart.test.ts`

Expected: FAIL because new modules/functions do not exist yet.

### Task 2: Add Scoped Attach State

**Files:**
- Create: `src/attach/types.ts`
- Create: `src/attach/manager.ts`
- Modify: `src/settings/manager.ts`
- Test: `tests/attach/manager.test.ts`

- [ ] **Step 1: Add attach types**

```ts
import type { TelegramConversationScope } from "../telegram/scope.js";
import type { SessionInfo } from "../settings/manager.js";

export interface AttachedSessionState {
  scope: TelegramConversationScope;
  session: SessionInfo;
  attachedAt: string;
  busy: boolean;
  lastEventId?: string;
}
```

- [ ] **Step 2: Implement `attachManager` keyed by conversation scope**

Implementation rules:

- Use `buildTelegramConversationScopeKey(scope)` for the primary key.
- Maintain a secondary `sessionId -> scopeKey` index for SSE event routing.
- Do not use one global current attached session.
- Add `__resetForTests()` for test isolation.

- [ ] **Step 3: Persist attached state in settings only after the in-memory tests pass**

Add to `src/settings/manager.ts`:

```ts
export interface AttachedSessionSettings {
  scope: TelegramConversationScope;
  session: SessionInfo;
  attachedAt: string;
  busy?: boolean;
  lastEventId?: string;
}
```

Add `attachedSessions?: Record<string, AttachedSessionSettings>` to `Settings`, clone it in `cloneSettings`, and expose `getAttachedSessions()` / `setAttachedSessions()` helpers following the style of `getThreadContextBindings()` / `setThreadContextBindings()`.

- [ ] **Step 4: Run attach manager tests**

Run: `npm test -- tests/attach/manager.test.ts`

Expected: PASS.

### Task 3: Attach Selected And New Sessions By Default

**Files:**
- Create: `src/attach/service.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Modify: `src/bot/commands/new.ts`
- Modify: `src/bot/commands/sessions.ts`
- Modify: `src/bot/commands/commands.ts`
- Modify: `src/bot/commands/start.ts`
- Modify: `src/thread/manager.ts`
- Test: `tests/attach/service.test.ts`
- Test: `tests/bot/commands/new.test.ts`
- Test: `tests/bot/commands/sessions.test.ts`

- [ ] **Step 1: Add service tests for default attach**

Test expected behavior:

- Creating a session in topic A attaches session A only to topic A.
- Selecting a session in topic B attaches session B only to topic B.
- Sending a prompt to an existing selected session refreshes attachment for the active topic.

- [ ] **Step 2: Implement `attachSessionForScope()` in `src/attach/service.ts`**

Required signature:

```ts
export async function attachSessionForScope(options: {
  scope: TelegramConversationScope;
  session: SessionInfo;
  reason: "new_session" | "selected_session" | "prompt" | "startup_restore";
}): Promise<void>;
```

Behavior:

- Store the session in `attachManager`.
- Bind the session to `threadContextManager` when the scope is active.
- Log `reason`, `session.id`, and scope key at `info` level.
- Do not send Telegram messages directly from this service.

- [ ] **Step 3: Wire session creation/selection**

In each command/handler, after `setCurrentSession()` and `threadContextManager.bindSessionToActiveContext()`, call `attachSessionForScope()` with `threadContextManager.getActiveScope()`.

- [ ] **Step 4: Run targeted command tests**

Run: `npm test -- tests/attach/service.test.ts tests/bot/commands/new.test.ts tests/bot/commands/sessions.test.ts tests/bot/handlers/prompt-retry.test.ts`

Expected: PASS.

### Task 4: Route SSE Session Events To The Correct Topic

**Files:**
- Modify: `src/bot/index.ts`
- Modify: `src/thread/manager.ts`
- Modify: `src/bot/utils/telegram-local-file-follow-up.ts` if event finalization uses session target lookup
- Test: `tests/bot/index.callback-routing.test.ts`
- Test: `tests/bot/index.deferred-correlation.test.ts`

- [ ] **Step 1: Add routing tests**

Extend existing bot event tests to assert that an event for `session-a` is sent with `message_thread_id: 1` and an event for `session-b` is sent with `message_thread_id: 2` when both sessions are attached in the same chat.

- [ ] **Step 2: Add event target resolver**

Required behavior in `src/bot/index.ts`:

```ts
function resolveAttachedSessionTarget(sessionId: string): TelegramThreadTarget | null {
  return attachManager.getTargetForSession(sessionId) ?? threadContextManager.getSessionTarget(sessionId);
}
```

Use the resolver anywhere upstream attach code would send to a single stored chat ID.

- [ ] **Step 3: Run routing tests**

Run: `npm test -- tests/bot/index.callback-routing.test.ts tests/bot/index.deferred-correlation.test.ts`

Expected: PASS.

### Task 5: Restore Pending Questions And Permissions For Attached Sessions

**Files:**
- Modify: `src/attach/service.ts`
- Modify: `src/question/manager.ts`
- Modify: `src/permission/manager.ts`
- Modify: `src/bot/handlers/question.ts`
- Modify: `src/bot/handlers/permission.ts`
- Test: `tests/attach/service.test.ts`
- Test: `tests/question/manager.test.ts`
- Test: `tests/bot/handlers/permission.test.ts`

- [ ] **Step 1: Add tests for scoped pending interaction restore**

Expected behavior:

- A pending question for `session-a` is restored only in the topic attached to `session-a`.
- A pending permission for `session-b` is restored only in the topic attached to `session-b`.
- Restoring one user's pending interaction never marks another user's interaction manager busy.

- [ ] **Step 2: Add session lookup APIs if missing**

Add manager methods with explicit session ID parameters rather than relying only on current global active state.

- [ ] **Step 3: Call restore from `attachSessionForScope()`**

When attaching, ask question/permission managers whether there is pending state for that `session.id`; if yes, send or refresh scoped Telegram controls through the target from the provided scope.

- [ ] **Step 4: Run interaction tests**

Run: `npm test -- tests/attach/service.test.ts tests/question/manager.test.ts tests/bot/handlers/permission.test.ts tests/interaction/guard.test.ts`

Expected: PASS.

### Task 6: External User Input Notifications Without Self-Echo

**Files:**
- Create: `src/external-input/suppression.ts`
- Create: `src/bot/utils/external-user-input.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Modify: `src/bot/index.ts`
- Test: `tests/external-input/suppression.test.ts`
- Test: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Implement suppression window**

Use the test from Task 1. Store normalized text per `sessionId + scopeKey` with TTL. Normalize by trimming and collapsing whitespace only; do not lowercase user prompts.

- [ ] **Step 2: Remember self-origin prompt text**

In `src/bot/handlers/prompt.ts`, immediately before or after `client.session.prompt`, call:

```ts
externalInputSuppression.rememberSelfInput(currentSession.id, activeScope, promptText);
```

Only call it when `activeScope` is available.

- [ ] **Step 3: Notify only true external input**

When SSE reports user input for an attached session, resolve target by session ID. If not suppressed, send a localized service message to that target.

- [ ] **Step 4: Run tests**

Run: `npm test -- tests/external-input/suppression.test.ts tests/bot/index.local-file-follow-up.test.ts tests/bot/handlers/prompt-retry.test.ts`

Expected: PASS.

### Task 7: Scoped Busy State For Attached Sessions

**Files:**
- Modify: `src/attach/manager.ts`
- Modify: `src/bot/utils/busy-guard.ts`
- Modify: `src/interaction/guard.ts`
- Modify: `src/summary/aggregator.ts`
- Test: `tests/interaction/guard.test.ts`
- Test: `tests/bot/utils/busy-guard.test.ts` if present, otherwise add it

- [ ] **Step 1: Add tests for topic-local busy blocking**

Expected behavior:

- Topic A attached session busy blocks new prompts in topic A.
- Topic B remains usable while topic A is busy.
- Same session attached to a topic is marked idle on assistant completion/error/abort.

- [ ] **Step 2: Implement busy marker APIs**

Required methods:

```ts
markBusy(sessionId: string): void;
markIdle(sessionId: string): void;
isBusyForScope(scope: TelegramConversationScope): boolean;
```

- [ ] **Step 3: Wire SSE lifecycle events**

Set busy on assistant/task start events and idle on completion/error/abort events for the event `sessionId`.

- [ ] **Step 4: Run busy/interaction tests**

Run: `npm test -- tests/interaction/guard.test.ts tests/bot/middleware/interaction-guard.test.ts`

Expected: PASS.

### Task 8: Add `/mcps` With Thread-Aware Project Context

**Files:**
- Create: `src/bot/commands/mcps.ts`
- Modify: `src/bot/commands/definitions.ts`
- Modify: `src/bot/index.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/de.ts`
- Modify: `src/i18n/fr.ts`
- Modify: `src/i18n/zh.ts`
- Test: `tests/bot/commands/mcps.test.ts`

- [ ] **Step 1: Implement pure MCP render helpers first**

Export `buildMcpServerListText()` and `buildMcpServerDetailText()` so tests can verify formatting without Telegram API mocks.

- [ ] **Step 2: Implement command handler**

Rules:

- Resolve current project after `threadContextManager.activateFromContext(ctx)` has run in middleware.
- If no project is bound for this topic, respond with the existing localized "select project first" pattern.
- Use `opencodeClient.mcp` methods from the SDK. If the SDK shape differs locally, wrap it in a tiny adapter inside `mcps.ts` rather than leaking SDK payloads across the command.
- All callback data must include the MCP server ID and action, not Telegram chat/thread IDs.

- [ ] **Step 3: Add command definition**

Add this entry in `src/bot/commands/definitions.ts` near other project/session commands:

```ts
{ command: "mcps", descriptionKey: "cmd.description.mcps" },
```

- [ ] **Step 4: Register command and callbacks**

In `src/bot/index.ts`, import `mcpsCommand` and any callback handler from `src/bot/commands/mcps.ts`, register `bot.command("mcps", mcpsCommand)`, and route callback data through the existing callback-routing pattern.

- [ ] **Step 5: Run MCP tests**

Run: `npm test -- tests/bot/commands/mcps.test.ts tests/bot/utils/command-sync.test.ts tests/bot/commands/help.test.ts`

Expected: PASS.

### Task 9: Add Optional Auto-Restart Without Breaking Tenant Runtime Isolation

**Files:**
- Create: `src/opencode/auto-restart.ts`
- Modify: `src/config.ts`
- Modify: `src/app/start-bot-app.ts`
- Modify: `src/process/manager.ts`
- Modify: `src/opencode/process.ts`
- Test: `tests/opencode/auto-restart.test.ts`
- Test: `tests/runtime/start-bot-app.test.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Add config parsing tests**

Expected defaults:

```ts
expect(config.opencode.autoRestart.enabled).toBe(false);
expect(config.opencode.autoRestart.monitorIntervalSec).toBe(300);
```

- [ ] **Step 2: Add config keys**

In `src/config.ts`, add:

```ts
autoRestart: {
  enabled: getOptionalBooleanEnvVar("OPENCODE_AUTO_RESTART_ENABLED", false),
  monitorIntervalSec: getOptionalPositiveIntEnvVar("OPENCODE_MONITOR_INTERVAL_SEC", 300),
},
```

inside `config.opencode`.

- [ ] **Step 3: Implement monitor as dependency-injected utility**

Required factory signature:

```ts
export function createOpenCodeAutoRestartMonitor(options: {
  enabled: boolean;
  intervalMs: number;
  ensureRuntime: () => Promise<{ success: boolean; error?: string }>;
  start: () => Promise<{ success: boolean; error?: string }>;
}): {
  start(): void;
  stop(): void;
  checkNow(): Promise<void>;
};
```

- [ ] **Step 4: Use process manager abstraction, not raw single-user process state**

Wire the monitor to `processManager.ensureRuntime()` and `processManager.start()` so Docker/tenant runtime behavior remains behind the existing manager.

- [ ] **Step 5: Start and stop monitor in app lifecycle**

In `src/app/start-bot-app.ts`, create the monitor after `processManager.initialize()` and stop it in `finally` before `processManager.dispose()`.

- [ ] **Step 6: Run auto-restart tests**

Run: `npm test -- tests/opencode/auto-restart.test.ts tests/runtime/start-bot-app.test.ts tests/config.test.ts`

Expected: PASS.

### Task 10: Add Google Cloud TTS Provider And Speech Markdown Stripping

**Files:**
- Modify: `src/tts/client.ts`
- Modify: `src/config.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/tts/client.test.ts`
- Test: `tests/config.test.ts`

- [ ] **Step 1: Add tests for markdown stripping**

```ts
import { describe, expect, it } from "vitest";
import { stripMarkdownForSpeech } from "../../src/tts/client.js";

describe("stripMarkdownForSpeech", () => {
  it("removes markdown syntax while preserving readable text", () => {
    expect(stripMarkdownForSpeech("# Title\n\nUse `npm test` and **check** [docs](https://example.com)."))
      .toBe("Title\n\nUse npm test and check docs.");
  });
});
```

- [ ] **Step 2: Add provider config**

Add type:

```ts
export type TtsProvider = "openai" | "google";
```

Add parser that accepts only `openai` or `google`, defaulting to `openai`.

- [ ] **Step 3: Add Google provider dependency**

Run: `npm install @google-cloud/text-to-speech`

Expected: `package.json` and `package-lock.json` update.

- [ ] **Step 4: Implement provider switch**

Rules:

- OpenAI-compatible provider keeps existing behavior.
- Google provider uses `GOOGLE_APPLICATION_CREDENTIALS` from the environment; do not log the credential path as a secret value in error messages.
- Always pass stripped text to the provider, not raw Markdown.

- [ ] **Step 5: Run TTS tests**

Run: `npm test -- tests/tts/client.test.ts tests/config.test.ts tests/bot/utils/send-tts-response.test.ts`

Expected: PASS.

### Task 11: Replace `telegram-markdown-v2` With Local MarkdownV2 Formatter

**Files:**
- Create: `src/summary/markdown-to-telegram-v2.ts`
- Modify: `src/summary/formatter.ts`
- Modify: `src/telegram/render/inline-renderer.ts`
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `tests/summary/formatter.test.ts`
- Test: `tests/bot/utils/send-with-markdown-fallback.test.ts`
- Test: `tests/telegram/render/inline-renderer.test.ts` if present, otherwise add focused coverage under `tests/telegram/render`

- [ ] **Step 1: Add converter tests**

Expected behavior:

- Escape Telegram MarkdownV2 special characters in plain text.
- Preserve code blocks and inline code.
- Convert Markdown links to safe text or safe MarkdownV2 links according to current renderer constraints.
- Never throw for malformed Markdown; return escaped plain text fallback.

- [ ] **Step 2: Implement converter**

Keep the converter local and deterministic. Do not introduce another markdown-to-telegram dependency.

- [ ] **Step 3: Remove dependency**

Run: `npm uninstall telegram-markdown-v2`

Expected: package files no longer include `telegram-markdown-v2`.

- [ ] **Step 4: Run markdown tests**

Run: `npm test -- tests/summary/formatter.test.ts tests/bot/utils/send-with-markdown-fallback.test.ts tests/bot/utils/assistant-rendering.test.ts`

Expected: PASS.

### Task 12: Apply Subagent Display Fixes

**Files:**
- Modify: `src/summary/aggregator.ts`
- Modify: `src/summary/subagent-formatter.ts`
- Test: `tests/summary/aggregator.test.ts`
- Test: `tests/summary/subagent-formatter.test.ts`

- [ ] **Step 1: Add duplicate completion regression test**

Expected: once a subagent has completed and the rendered card was emitted, repeated unchanged events do not emit a duplicate completion message.

- [ ] **Step 2: Add tool-call display regression test**

Expected: subagent tool calls show useful input details instead of internal/generated tool titles.

- [ ] **Step 3: Implement smallest upstream-equivalent fix**

Prefer a per-subagent render fingerprint in the aggregator over broad state rewrites.

- [ ] **Step 4: Run subagent tests**

Run: `npm test -- tests/summary/aggregator.test.ts tests/summary/subagent-formatter.test.ts`

Expected: PASS.

### Task 13: Apply Pinned Startup Fix In Scoped Pinned Manager

**Files:**
- Modify: `src/pinned/manager.ts`
- Modify: `src/pinned/types.ts`
- Test: `tests/pinned/manager.test.ts`

- [ ] **Step 1: Add regression test**

Expected: when a scoped pinned message ID already exists in settings at startup, `refresh()` updates or reuses it but does not call Telegram `pinChatMessage()` again.

- [ ] **Step 2: Implement fix**

Track whether the current pinned message was created in this process. Only pin newly created status messages, not restored existing status messages.

- [ ] **Step 3: Run pinned tests**

Run: `npm test -- tests/pinned/manager.test.ts`

Expected: PASS.

### Task 14: Docs, Product State, Changelog, And Env Examples

**Files:**
- Modify: `.env.example`
- Modify: `README.md`
- Modify: `PRODUCT.md`
- Modify: `CHANGELOG.md`
- Modify: `package.json`

- [ ] **Step 1: Update environment documentation**

Document:

```dotenv
OPENCODE_AUTO_RESTART_ENABLED=false
OPENCODE_MONITOR_INTERVAL_SEC=300
TTS_PROVIDER=openai
GOOGLE_APPLICATION_CREDENTIALS=/absolute/path/to/google-service-account.json
```

- [ ] **Step 2: Update product checklist**

In `PRODUCT.md`, mark complete only after tests pass:

```md
- [x] `/mcps` command: browse available MCP servers
- [x] OpenCode server monitoring with automatic restart on stop/crash
```

Add attach/default-follow behavior to session management, explicitly noting multi-user topic scope.

- [ ] **Step 3: Update changelog**

Add an unreleased entry covering:

- Ported v0.18/v0.19 attach/default-follow behavior with multi-user topic scoping.
- Added `/mcps`.
- Added optional auto-restart.
- Added Google TTS provider and speech markdown stripping.
- Replaced MarkdownV2 dependency with local formatter.
- Fixed subagent duplicate/tool-call display and pinned startup repinning.

- [ ] **Step 4: Update version only if this branch is intended as v0.19 parity**

If the release target is parity with upstream, set `package.json` version to `0.19.0` or a fork-specific prerelease such as `0.19.0-multitenant.0`. If not, leave version unchanged and document the feature parity in `CHANGELOG.md`.

### Task 15: Full Verification And Review

**Files:**
- No production file changes expected unless verification finds issues.

- [ ] **Step 1: Run targeted test groups**

Run: `npm test -- tests/attach tests/external-input tests/bot/commands/mcps.test.ts tests/opencode/auto-restart.test.ts tests/tts/client.test.ts tests/summary/aggregator.test.ts tests/summary/subagent-formatter.test.ts tests/pinned/manager.test.ts`

Expected: PASS.

- [ ] **Step 2: Run full quality checks**

Run: `npm run build`

Expected: PASS.

Run: `npm run lint`

Expected: PASS.

Run: `npm test`

Expected: PASS.

- [ ] **Step 3: Run post-implementation review agents**

Use two parallel reviews after all checks pass:

- Security review: authn/authz, cross-user leakage, thread routing, MCP actions, auto-restart process control, TTS credential handling.
- Architecture review: scoped state boundaries, DDD language, dependency direction, coupling to Telegram/OpenCode SDK payloads, maintainability.

- [ ] **Step 4: Apply only necessary review fixes**

For each finding, add/adjust a focused test first, make the smallest code change, then rerun the relevant targeted tests and full checks.

---

## Execution Order Recommendation

Implement in this order to keep risk low:

1. Attach state and topic-scoped routing: Tasks 1-7.
2. Independent user-facing commands/features: Tasks 8-10.
3. Rendering/fix parity: Tasks 11-13.
4. Docs and verification: Tasks 14-15.

The `/mcps`, TTS, MarkdownV2, subagent, and pinned fixes can be implemented in parallel after attach routing is stable. Auto-restart can be implemented independently, but verify it through `processManager` so tenant runtime behavior is preserved.

## Self-Review

- Spec coverage: every upstream functional commit from `v0.17.0...v0.19.0` is represented, except docs-only/release/lockfile-only commits.
- Multi-user coverage: attach, external input, busy state, event routing, pinned messages, and pending interactions are explicitly scoped by Telegram conversation scope.
- Threaded mode coverage: tests require separate `messageThreadId` routing for sessions in the same chat.
- Placeholder scan: no task uses TBD/fill-later language; where exact SDK method names may differ, the plan requires a local adapter and tests before implementation.
- Commit policy: no automatic commits; checkpoint commits are intentionally omitted because this repository instruction says commits require explicit user request.
