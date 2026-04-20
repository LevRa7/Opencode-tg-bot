# Design: Fix Cosmetic Bugs After v0.17.0 Upgrade

**Date:** 2026‑04‑21  
**Author:** opencode  
**Status:** Proposed  
**Context:** Post‑upgrade from v0.14.1 to v0.17.0 semantic level, preserving local multi‑user, approval flows, threaded routing, and Docker customizations.

---

## 1. Overview

After successfully porting upstream v0.17.0 features (new renderer, `/skills`, `/worktree`, `/open` commands, runtime alignment) into the custom fork, three cosmetic but user‑visible regressions have been reported:

1. **Markdown tags render as plain text** – bold, italic, code, etc. appear as literal `**text**` instead of formatted text.
2. **Streaming does not work** – assistant responses arrive as a single message after a long pause, not as incremental updates.
3. **Inline‑keyboard display is inconsistent** – desktop and Android Telegram clients show inline menus differently in main thread vs. forum topics; menus sometimes disappear entirely.

All three issues are caused by missing or misapplied Telegram API parameters (`entities`, `parse_mode`, `message_thread_id`) in the new rendering and streaming pipeline. The fixes must preserve the existing routing, multi‑user orchestration, and permission boundaries.

## 2. Problems & Root Causes

### 2.1 Tags Render as Plain Text

**Observed behaviour:**  
Markdown syntax (`**bold**`, `_italic_`, `` `code` ``, links) is sent as plain text, not as formatted Telegram messages.

**Root cause:**  
The new `telegram/render/` pipeline correctly produces `TelegramRenderedPart` objects with `entities` arrays (Telegram’s native formatting), but the sending functions (`sendBotText` → `sendMessageWithMarkdownFallback`) ignore `entities` and rely only on `parse_mode`. When `config.bot.messageFormatMode === "markdown"`, `getAssistantParseMode()` returns `"MarkdownV2"`, but the text passed to `api.sendMessage` is the raw `part.text` (which still contains markdown characters), not a MarkdownV2‑escaped version. Telegram therefore treats the asterisks/backticks as literal characters.

**Affected code paths:**
- `src/bot/utils/assistant‑rendering.ts` – `renderAssistantFinalPartsSafe`, `prepareAssistantStreamingPayload`
- `src/bot/utils/finalize‑assistant‑response.ts` – `sendRenderedPart`
- `src/bot/utils/telegram‑text.ts` – `sendBotText`
- `src/bot/utils/send‑with‑markdown‑fallback.ts` – `sendMessageWithMarkdownFallback`

### 2.2 Streaming Does Not Work

**Observed behaviour:**  
Long assistant responses appear as one block after the entire generation finishes, not as a stream of partial updates.

**Root cause:**  
The `ResponseStreamer` uses `sendText`/`editText` callbacks that do not propagate `parse_mode` (or `entities`). If the `format` field of `StreamingMessagePayload` is `"markdown_v2"`, the callbacks must pass that `parse_mode` to Telegram; otherwise, Telegram will treat each update as identical text (because the raw text may be the same) and skip the edit. Additionally, the `prepareAssistantStreamingPayload` may return `null` when the assistant format is `"markdown_v2"` but the text cannot be safely chunked, causing the streamer to fall back to a single‑part payload that is never flushed.

**Affected code paths:**
- `src/bot/streaming/response‑streamer.ts` – `sendText`, `editText` callbacks
- `src/bot/index.ts` – `responseStreamer` instantiation (lines ~511‑530)
- `src/bot/utils/assistant‑rendering.ts` – `prepareAssistantStreamingPayload`
- `src/bot/utils/telegram‑text.ts` – `sendBotText` (must respect `format`)

### 2.3 Inline‑Keyboard Display Inconsistency

**Observed behaviour:**  
In forum chats, inline menus (model/agent/variant selection, project/session lists) appear in desktop clients only in main thread, not in topics; on Android they appear in topics but not in main thread. The behaviour differs across clients.

**Root cause:**  
The `extractThreadTargetFromContext` function returns `messageThreadId: undefined` for forum chats when the incoming message does not carry an explicit `message_thread_id`. Some Telegram clients interpret `undefined` as “show keyboard everywhere”, others as “show only in the thread where the command was issued”. The API expects an explicit `message_thread_id` (or `0` for the main thread) to decide where to attach the inline keyboard.

**Affected code paths:**
- `src/bot/utils/message‑thread.ts` – `extractThreadTargetFromContext`, `withMessageThreadId`
- `src/bot/handlers/inline‑menu.ts` – `replyWithInlineMenu`
- All inline‑menu handlers (`model.ts`, `agent.ts`, `variant.ts`, `question.ts`, etc.)

## 3. Proposed Solutions

### 3.1 Tags: Pass Entities to Telegram API

**Approach:**  
Extend the sending pipeline to accept `entities` and use them when available, falling back to `parse_mode` only when `entities` are absent.

**Changes:**

1. **`sendMessageWithMarkdownFallback`** – add optional `entities?: MessageEntity[]` parameter. If `entities` is provided, call `api.sendMessage` with `{ entities }` and **no** `parse_mode`. If `entities` is missing, keep the existing `parse_mode` logic.
2. **`sendBotText`** – add `entities?: MessageEntity[]` parameter, forward it to `sendMessageWithMarkdownFallback`.
3. **`sendRenderedPart`** (in `index.ts`) – pass `part.entities` to `sendBotText`.
4. **`ResponseStreamer` callbacks** – when `format === "markdown_v2"` and we have `entities`, send them; otherwise fall back to `parse_mode: "MarkdownV2"`.

**Advantages:**  
- Uses Telegram’s native formatting, which is more reliable than MarkdownV2 escaping.
- Preserves the existing fallback chain (escape → raw) for malformed entities.
- Aligns with upstream’s rendering philosophy.

**Risks:**  
- Need to ensure entity validation (`validateTelegramEntities`) is called before sending.
- Potential edge cases with nested/invalid offsets.

### 3.2 Streaming: Ensure Format Propagation

**Approach:**  
Guarantee that `parse_mode` (or `entities`) is always passed to Telegram when the streamer updates a message, and add diagnostic logging to catch silent failures.

**Changes:**

1. **`sendText`/`editText` callbacks** (`index.ts`) – ensure they receive and apply the `format` parameter. If `format === "markdown_v2"`, set `parse_mode: "MarkdownV2"`; if `format === "raw"`, omit `parse_mode`.
2. **`prepareAssistantStreamingPayload`** – add debug logging to see when it returns `null`. If it returns `null` because the text cannot be chunked with entities, fall back to a single‑part payload with `format: "raw"` (or `"markdown_v2"` if the original format was markdown).
3. **`ResponseStreamer.enqueue`** – log the payload shape (`parts.length`, `format`, presence of `entities`).
4. **Config check** – verify `RESPONSE_STREAMING=true` and `RESPONSE_STREAM_THROTTLE_MS=500` (default).

**Advantages:**  
- Stream updates become visible to Telegram, triggering actual message edits.
- Maintains backward compatibility with raw‑text mode.
- Logs will help diagnose future streaming issues.

**Risks:**  
- Increased log volume; need to keep debug logs only in development or under a flag.

### 3.3 Inline Keyboards: Explicit Thread ID for Forums

**Approach:**  
For forum chats, always provide an explicit `message_thread_id` – `0` for the main thread, the actual thread ID for topics. Never leave it `undefined`.

**Changes:**

1. **`extractThreadTargetFromContext`** – if `isForumChat(ctx)` and `messageThreadId` is `undefined`, return `messageThreadId: 0` (main thread). This ensures a deterministic value.
2. **`withMessageThreadId`** – keep existing behaviour (skip if `undefined`), but now the caller will always have a defined value for forums.
3. **`replyWithInlineMenu`** – pass the resolved `messageThreadId` (which may be `0`) to `ctx.reply`.
4. **Telegram API** – `message_thread_id: 0` is valid and denotes the main thread of a forum.

**Advantages:**  
- Uniform behaviour across all Telegram clients.
- No breaking changes to existing routing logic.
- Simple, one‑line fix in the extraction function.

**Risks:**  
- If a forum chat uses a non‑zero thread ID for the “main” thread (unlikely), `0` might be wrong. The Telegram API documentation states that `0` is the main thread.

## 4. Implementation Plan

### Phase 1: Tags & Formatting
1. Modify `send‑with‑markdown‑fallback.ts`:
   - Add `entities` parameter to `sendMessageWithMarkdownFallback`, `editMessageWithMarkdownFallback`, `sendMessageDraftWithMarkdownFallback`.
   - If `entities` present, call API with `{ entities }` and no `parse_mode`.
   - Keep existing fallback logic for parse errors.
2. Update `telegram‑text.ts`:
   - Add `entities` to `sendBotText` and `editBotText`.
   - Forward `entities` to the fallback helpers.
3. Update `finalize‑assistant‑response` usage in `index.ts`:
   - Pass `part.entities` from `sendRenderedPart`.
4. Update `response‑streamer` callbacks in `index.ts`:
   - Pass `entities` when available (requires storing them in `StreamingMessagePayload` or converting to `parse_mode`).

### Phase 2: Streaming
1. Add logging to `prepareAssistantStreamingPayload` and `renderAssistantFinalPartsSafe`.
2. Ensure `sendText`/`editText` callbacks apply `parse_mode` according to `format`.
3. Verify `RESPONSE_STREAMING` config value and add a warning log if it’s `false`.
4. Test with a long response (e.g., “Repeat ‘test’ 100 times”) to confirm incremental updates appear.

### Phase 3: Inline Keyboards
1. Modify `message‑thread.ts`:
   - In `extractThreadTargetFromContext`, after detecting a forum chat, set `messageThreadId = messageThreadId ?? 0`.
2. Update `inline‑menu.ts`:
   - Add a debug log showing the `messageThreadId` used.
3. Test in a forum chat (if available) or simulate with a mock.

### Phase 4: Integration & Verification
1. Run full test suite (`npm test`).
2. Run lint (`npm run lint`).
3. Build (`npm run build`).
4. Manual smoke test:
   - Send a task that produces bold/italic/code text.
   - Send a long task that should stream.
   - Trigger an inline menu (e.g., `/model`).

## 5. Testing

### Automated Tests
- **Unit tests** for `send‑with‑markdown‑fallback` with `entities` parameter.
- **Unit tests** for `extractThreadTargetFromContext` with forum‑chat simulation.
- **Integration tests** for `responseStreamer` with `format` propagation (mock Telegram API).
- Existing 899 tests must remain green.

### Manual Verification Checklist
- [ ] Bold/italic/code snippets appear formatted, not as plain `**text**`.
- [ ] Long responses appear incrementally (several updates during generation).
- [ ] Inline menus appear in both main thread and topics on desktop and Android.
- [ ] No regression in multi‑user routing, permission checks, or Docker lifecycle.

## 6. Risks & Mitigations

| Risk | Mitigation |
|------|------------|
| Entities validation fails, causing Telegram API errors | Use existing `validateTelegramEntities`; if invalid, fall back to `parse_mode` with escaped text. |
| Streaming logs become too noisy | Gate debug logs with a configurable flag (`LOG_STREAMING_DETAILS`). |
| Forum‑chat detection wrong for some chat types | Rely on Telegram’s `is_forum` flag; if missing, keep current behaviour (no thread ID). |
| `message_thread_id: 0` not accepted by older API | Check Telegram Bot API version (should be ≥ 6.3, which we already depend on). |
| Changes break upstream compatibility | Keep changes minimal and scoped to the sending layer; avoid modifying core rendering logic. |

## 7. Success Criteria

1. **Visual formatting** – Markdown tags render as formatted text in Telegram.
2. **Streaming works** – long responses are visibly updated multiple times during generation.
3. **Consistent inline menus** – same keyboard appears in all clients, in main thread and topics.
4. **No regressions** – all existing tests pass, multi‑user/Docker/approval flows unchanged.

## 8. References

- Telegram Bot API: [MessageEntity](https://core.telegram.org/bots/api#messageentity), [sendMessage](https://core.telegram.org/bots/api#sendmessage)
- Upstream v0.17.0 renderer: `src/telegram/render/`
- Project AGENTS.md (coding conventions, TDD guidance)
- Existing tests in `tests/` for formatting and streaming

---

**Approval:**  
User has reviewed and agreed to this design. Proceed to implementation plan via `writing‑plans` skill.