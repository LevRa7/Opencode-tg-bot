# Changelog

This file tracks notable functional, architectural, and documentation changes in the project.

Documentation rule:

- record every relevant user-visible, functional, or architectural change
- describe not only what changed, but also why it changed and what flow it affects
- mention key modules, managers, or external APIs when they are part of the change

## [Unreleased]

### Added

- **Hermes-compatible persistent memory system — MCP server, bot middleware, and cloud-init support.** Full port of Hermes Agent's memory architecture: (1) `mcp-servers/memory/` — Python MCP stdio server exposing `memory_add`, `memory_search`, `memory_remove`, `memory_show` tools with Hermes-compatible §-delimited format and char limits (2,200 memory / 1,375 user); (2) `src/memory/` — TypeScript middleware: `inject.ts` (auto-injects kaeru context as `<memory-context>` before each prompt, Hermes-compatible fence format with system note), `sync.ts` (post-turn fire-and-forget sync to kaeru: episode + awake), `nudge.ts` (memory nudge every 10 user turns, skill nudge every 25), `background-review.ts` (daemon spawn of `opencode run` with limited toolset to auto-save to memory/skills); (3) `src/bot/handlers/prompt.ts` — wired into `processUserPrompt`: nudge injection → memory context injection → `promptAsync` → post-dispatch sync + background review; (4) `docker/AGENTS.md` — memory usage instructions for the model; (5) `src/vm/cloud-init.ts` — creates `/workspace/MEMORY.md`, `/workspace/USER.md`, and `/workspace/skills/` on VM/container creation. Install archive at `/home/me/opencode-memory-mcp.tar.gz`. Affects: `mcp-servers/memory/`, `src/memory/`, `src/bot/handlers/prompt.ts`, `docker/AGENTS.md`, `src/vm/cloud-init.ts`.

### Changed

- **Pinned status message is now edited in place at most once every 5 seconds (leading + trailing throttle) instead of on every event.** After a prompt the message is created and pinned once, then automatic updates (`onMessageComplete`, `onCostUpdate`, `onSessionDiff`, debounced `addFileChange`, token updates) no longer each trigger an immediate `editMessageText`. A new `PINNED_EDIT_THROTTLE_MS` (5000ms) throttle in `updatePinnedMessage` applies the leading edge immediately when ≥5s have elapsed since the last edit (or on the first update), and otherwise coalesces everything inside the window into a single trailing edit scheduled via a per-runtime `throttleTimer` — so the latest state is never lost and the bot edits at a steady cadence rather than hammering Telegram. Explicit refreshes (`refresh()` / `forceUpdate`) bypass the throttle and supersede any pending trailing flush so user-triggered updates stay immediate. The throttle logic was extracted into `scheduleThrottledFlush` and `flushPinnedUpdateTask`, and `throttleTimer` is cleared in `unpinOldMessage`, `clear`, and the test reset hook. Tests added in `tests/pinned/manager.test.ts` using fake timers (no edit within the 5s window then one trailing edit; immediate leading-edge edit after ≥5s; updates never send a new message; refresh bypasses the throttle). Affects: `src/pinned/manager.ts`, `tests/pinned/manager.test.ts`.

- **Read/write tool-call headers now show the file path as inline `<code>` and a `(N строк)` line count.** The collapsible `<summary>` for `read`/`write` tools is now built deterministically from structured input (`input.filePath` / `input.content`) instead of the free-form tool title: the path is wrapped in a `<code>` tag (inline monospace) and a line count is appended — `read` keeps its indexed-line count, `write` gets a new count from the written content's line count. To allow a real `<code>` tag in the header, `toolRichLabel` now returns HTML-safe `<summary>` content (escapes internally, escapes the path inside `<code>`) and its two callers (`formatToolOutputForRichMessage`, `formatToolRichInitial`) no longer re-escape it. Other tools and the title/command fallbacks keep their previous escaped plain-text headers. Tests added in `tests/bot/utils/rich-message.test.ts`. Affects: `src/bot/utils/rich-message.ts`.

- **Reasoning/thinking titles are capped at 100 characters (overflow → `…`).** The `<summary>` header for streamed and finalized reasoning blocks (`formatThinkingForRichFinal`, `formatThinkingForRichDraft`) previously emitted the title unbounded, so a long first line of reasoning produced an oversized collapsible header. A shared `truncateTitle(text, max = 100)` helper now caps the title (the same cap `toolRichLabel` already applied to tool labels, now deduplicated through the helper). Tests added in `tests/bot/utils/rich-message.test.ts`. Affects: `src/bot/utils/rich-message.ts`.

### Fixed

- **Reasoning/thinking blocks no longer silently fall back to the legacy plain format — the finalized block is now a reliable rich `<details>`.** The reasoning body was sent as `rich_message.markdown`, but arbitrary reasoning prose contains URLs/links (`<file:///…>`, `https://…`, `[text](url)`) and nested `<details>`/`<summary>` markup that Telegram rejects with `400 rich_message_url_invalid` / `rich_message_depth_invalid`; `tryRichFinalizeThinking` then returned null and the stream fell back to the old format (confirmed in the running bot log at 01:50:47Z / 01:53:18Z). Root cause is the body content, not the title-length cap (`truncateTitle` is pure and cannot produce those errors; the cap simply coincided in time). Fixed by wrapping the reasoning body in a code fence inside the collapsible block (`formatThinkingForRichFinal`), making it inert against URL/tag/depth parsing while keeping the short `<summary>` title and the full text in the expanded area; `neutralizeDetailsMarkup` stays as defense-in-depth (4-backtick fence when the body already contains ```). Trade-off: the reasoning body now renders monospace instead of Markdown, in exchange for reliable rich rendering. Test added in `tests/bot/utils/rich-message.test.ts`. Affects: `src/bot/utils/rich-message.ts`.

- **Pinned status message: fixed the root cause of the `400 message can't be edited` storm — `editMessageText` no longer receives `message_thread_id`.** Every pinned status update failed with `400 Bad Request: message can't be edited`, even on a message created seconds earlier (so the ~48h edit window was NOT the cause). Root cause: `PinnedManager` passed `message_thread_id` to `editMessageText` via `getEditMessageThreadOptions`, but Telegram's `editMessageText` has no such parameter (the code forced it in with an `as Parameters<…>` cast). In topic-scoped chats (private Direct-Messages topics / forums) Telegram rejected every edit. Proof: `KeyboardManager` edits the *same* pinned message via `editMessageReplyMarkup` *without* a thread id and succeeds, while `PinnedManager`'s `editMessageText` *with* the thread id failed — all 327 `can't be edited` errors in the log came only from `PinnedManager`. Fix: `editMessageText` is now called as `(chat_id, message_id, text)` with no thread option (a message is identified by chat+id alone), and `getEditMessageThreadOptions` was removed; `sendMessage` in `createPinnedMessage` still applies `message_thread_id` so the message is created in the correct topic. The bot now edits the existing pinned message in place instead of failing. This also reverts an intermediate, wrong symptom-fix from this session that reacted to the same 400 by recreating the message (`isUneditableMessageError` + structured `GrammyError` detection + `recreatePinnedMessage` on uneditable): it had turned the log-spam into real chat-message spam (a new pinned message on every update — 27349→27352→27354→…). The `message to edit not found` branch keeps its legitimate recreate (the message was truly deleted, so it replaces rather than duplicates). Tests updated in `tests/pinned/manager.test.ts`: `editMessageText` is asserted to be called WITHOUT `message_thread_id`, while `sendMessage` keeps it. Affects: `src/pinned/manager.ts`, `tests/pinned/manager.test.ts`.

- **Collapsed rich-message blocks (`<details>`) no longer render as raw tags when the body contains literal `<details>`/`<summary>` markup.** The body of a rich collapsible message is sent in Telegram Markdown mode, where `<details>`/`<summary>` are real structural tags. Only the *closing* `</details>` in the body was neutralized; a literal *opening* `<details>` or a `<summary>`/`</summary>` (extremely common in `reasoning`/`todowrite`/thinking text — e.g. when the assistant discusses this very feature) was passed through verbatim, nesting inside or unbalancing the outer wrapper so Telegram's client renderer fell back to showing the entire block as raw tags. The send itself never failed (bot log shows `Sent rich message (unchecked)` with no `can't parse`), confirming a client-side structural breakage rather than an API error. Fixed by extending `neutralizeDetailsClose` → `neutralizeDetailsMarkup`, which zero-width-space-neutralizes all four structural tokens (`<details`, `</details`, `<summary`, `</summary`, case-insensitive) in every tool/thinking body before it is wrapped, including inside code fences as defense-in-depth. The `<summary>` label stays HTML-escaped as before. Regression tests added in `tests/bot/utils/rich-message.test.ts` (opening `<details>` and `<summary>`/`</summary>` in `reasoning`, fenced `bash`, and `formatThinkingForRichFinal` bodies leave exactly one un-neutralized occurrence — the wrapper's own tag). Affects: `src/bot/utils/rich-message.ts`, `tests/bot/utils/rich-message.test.ts`.

- **Collapsed rich-message bodies (tool output, reasoning, todowrite, thinking) no longer show raw HTML tags/entities — they now render as Markdown.** The collapsible `<details>` bodies were HTML-entity-escaped (`escapeContent`, and an escaped `$ command` header for `bash`) while the rich message is sent in Markdown mode (`rich_message.markdown`), so `&lt;`/`&gt;`/`&amp;` and tags appeared literally and constructs like the `todowrite` checklist did not render. Fixed by emitting the Markdown body without HTML entity-escaping — `reasoning`/`todowrite`/thinking bodies as raw Markdown and the `bash` command literally inside the code fence — while keeping the `<summary>` label escaped (the summary is a real HTML tag even in Markdown rich messages). A literal `</details>` inside a raw body is neutralized with a zero-width space so it cannot prematurely close the outer block. Affects: `src/bot/utils/rich-message.ts`.

- **Fixed the final assistant answer being duplicated in Telegram (one full message plus a leftover streaming draft).** Busy-state reconciliation (`reconcileBusyStateNow`, triggered on every `server.heartbeat`) cleared `assistantRunState` as soon as the OpenCode server reported the session `idle`, even though the bot's completion/finalization pipeline (completion queue, durable delivery, thinking finalize, translate) runs asynchronously for several more seconds. Clearing the run mid-finalization turned `markFinalResponsePublished` into a no-op, so `isFinalResponsePublished` stayed `false` and the partial-stream guard in `setOnPartial` (`src/bot/index.ts`) no longer suppressed trailing `message.part.delta` events — a late delta re-created a streaming draft next to the already-sent final message. Added `assistantRunState.isFinalizationInFlight()` (completion recorded but final not yet published) and made `reconcileBusyStateNow` skip clearing such sessions; the next reconcile pass clears them once the final is published (or the run is cleared on finalize failure). Root cause confirmed from the running bot log (session `ses_0fef1083…`): `Cleared run … status_reconcile_idle` landed between `markResponseCompleted` and `FinalizeResponse`, followed by `markVisibleFinalResponse no run` / `markFinalResponsePublished no run` (~6% of finalizations). Tests added in `tests/bot/assistant-run-state.test.ts` and `tests/bot/utils/busy-reconciliation.test.ts`. Affects: `src/bot/assistant-run-state.ts`, `src/bot/utils/busy-reconciliation.ts`.

- **Topic isolation lost in private chats with Direct Messages topics:** After creating a new session in a new topic, messages typed in older topics were routed to the newest session, and a session busy in one topic blocked commands (e.g. `/sessions`) in every other topic. Root cause: `extractTelegramConversationScopeFromContext` (`src/telegram/scope.ts`) stripped `messageThreadId` to `undefined` for **every** non-forum chat. The bot runs in a private chat with topics enabled (`has_topics_enabled`, `chatId === userId`), where `is_forum` is false, so every topic collapsed into the single conversation scope key `userId:chatId:0`. With one shared key, `getCurrentSession()` resolved all topics to the last-created session (its global `_lastSetSession` binding) and `foregroundSessionState` marked all topics busy together (runtime logs confirmed every busy mark used `…:…:0`). Fix: preserve the real per-topic `message_thread_id` for `private` chats while still stripping stray thread ids for non-forum groups/channels; delivery targeting stays sanitized separately via `extractThreadTargetFromContext`. This restores per-topic session binding and per-topic busy state. Regression tests added in `tests/telegram/scope.test.ts` (private-chat topic keeps its thread id; two topics produce distinct scopes). Affects: `src/telegram/scope.ts`, `tests/telegram/scope.test.ts`.

- **Deferred-batch flush on session idle ran without a conversation scope (secondary topic-isolation hole):** `handleSessionIdle` (`src/bot/index.ts`) runs from an SSE callback with no ambient `AsyncLocalStorage` scope, yet it drained buffered message windows via `deferredBatch.flushExpiredWindowsForScope(...)`. The resulting `processUserPrompt` then called `getCurrentSession()` with a null ambient scope and fell back to the global `_lastSetSession` (the newest session). So a message typed in an already-busy topic could be dispatched to a session created later in another topic once the busy session went idle. Fix: wrap the idle flush in `runWithTelegramConversationScope(getSessionRoutingScope(sessionId), () => deferredBatch.flushExpiredWindowsForScope(idleScopeKey))`, mirroring the scope-wrapping pattern already used for the file's other SSE-driven routing. The scope is resolved once, and if it can no longer be resolved (e.g. a racing `session.error` cleared the routing context) the flush is skipped rather than run scope-less, so a buffered window is never dispatched via the global fallback. New test `tests/bot/incoming-media-batch-scope.test.ts` proves `IncomingMediaBatch` inherits the caller's ambient scope (scope-less flush dispatches with `null`; wrapped flush dispatches inside the given scope), documenting why the caller must wrap. Affects: `src/bot/index.ts`, `tests/bot/incoming-media-batch-scope.test.ts`.

- **Restored `tsc` compilation of the `feat/terminal-agent` worktree (WIP build was red):** the branch no longer compiled, blocking deployment of the VM fix below. Resolved 25 TypeScript errors without changing intended behavior: removed duplicate `vm.progress.*` keys in `src/i18n/en.ts`; added the missing `vm.*` keys to `ru/de/es/fr/zh` so every locale satisfies `I18nDictionary`; cast the dynamic `vm.tier.<key>` lookup to `I18nKey` in `onboarding-flow.ts`; imported `getCurrentProject` in `ssh.ts`; defined the missing `TelegraphConfig`/`TelegraphKeysRepo`/`TelegraphResponse` types in `telegraph/auto-register.ts`; guarded the session-rename forum-topic sync on a numeric `messageThreadId` (no `kind` field exists on `TelegramDeliveryTarget`) in `bot/index.ts`; and in `bot/commands/terminal.ts` replaced the non-existent `getActiveTenantContainerId` with the project-wide `opencode-serve-tg-<userId>` container convention, removed the unreachable `ssh` deploy-target branch (the enum is `docker|vm`), and switched the Puppeteer `waitForFunction` calls to string form so `document` is evaluated in page context. Affects: `src/i18n/*.ts`, `src/bot/handlers/onboarding-flow.ts`, `src/bot/commands/ssh.ts`, `src/bot/commands/terminal.ts`, `src/bot/index.ts`, `src/telegraph/auto-register.ts`.

- **Tenant VM deployment failed on every redeploy (`UNIQUE constraint failed: vm_states.user_id`):** After a user's first VM was provisioned, any later deploy aborted at the state-persistence layer. Root cause: `vm_states` enforces `UNIQUE(user_id)`, but `acquire()` always inserts a fresh `randomUUID()` `vm_id` (`src/vm/lifecycle-manager.ts`) and `save()` only resolves `ON CONFLICT(vm_id)` (`src/vm/state-persistence.ts`). Leftover rows (left as `status='destroyed'` by `release()` / health-timeout rollback, which never delete the row) then collided on `user_id`, so the INSERT threw and `ProcessManager` reported `VM lifecycle acquire failed`, putting the user into a 30s cooldown. Fix: `acquire()` now calls `persistence.deleteByUserId(userId)` immediately before `save(record)`, clearing any stale row before re-provisioning (idempotent, keeps `record.vmId` authoritative for the subsequent `updateIfCurrent()` calls). Added regression test `acquire re-provisions over a leftover destroyed row without UNIQUE(user_id) collision`. Affects: `src/vm/lifecycle-manager.ts`, `tests/vm/lifecycle-manager.test.ts`.

- **`/worktree` command no longer hides the current project's own worktree when it's not registered as an OpenCode project.** `loadCurrentWorktreeContext` filtered worktrees returned by `git worktree list` against `getProjects` (OpenCode server project list). If the current worktree hadn't been opened as an OpenCode project yet, it was excluded from the menu — including the active worktree itself. Fixed by always adding `currentProject.worktree` to the `knownPaths` set before filtering, so the currently selected worktree stays visible regardless of OpenCode project registration. Affects: `src/bot/commands/worktree.ts`.

### Added

- **Edit, apply_patch and write tool outputs now render as inline rich messages (collapsible diff/content) instead of a separate diff file; oversized payloads are truncated with a localized marker.** Previously every edit/apply_patch/write tool invocation produced a separate document upload (diff file) in the chat, cluttering the conversation. Now tool outputs are rendered as collapsible inline rich messages directly in the assistant response stream. When a payload exceeds the Telegram message size limit, the body is truncated and a localized truncation marker is appended.

- **Terminal PTY agent (telminal approach):** Interactive terminal on VM via SSH pipe. `src/vm/terminal-agent.ts` spawns `node-pty` bash session, communicates via stdin/stdout over SSH. `VMPtyBridge` (`src/bot/commands/terminal-bridge.ts`) manages SSH child processes with `spawnSession()`. `handleTerminalTextInput` (`src/bot/commands/terminal-text-handler.ts`) routes terminal topic messages to PTY or falls back to stateless `executeTerminalCommand`. PTY bridge manager (`ensureVMPtyBridge`, `getPtySession`, `setPtySession`, `killPtySession`, `disconnectVMBridge`) added to `terminal.ts`. Cloud-init installs `node-pty` on VM. 76 new tests across 4 test suites. Affects: `src/vm/terminal-agent.ts`, `src/bot/commands/terminal-bridge.ts`, `src/bot/commands/terminal-text-handler.ts`, `src/bot/commands/terminal.ts`, `src/bot/index.ts`, `src/vm/cloud-init.ts`.

### Added

- **VM deployment for tenant workspaces:** New deployment target — QEMU/KVM virtual machines as an alternative to Docker containers. New `src/vm/` module with `VmManager` class (lifecycle via virsh CLI), `cloud-init.ts` (ISO generation with random sudo password per user), and 4 VM spec tiers (2GB/1vCPU/20GB through 16GB/8vCPU/250GB). Thin provisioning via qcow2 backing files + virtio-mem for dynamic memory. ProcessManager gets `kind: "vm"` branch with `ensureVmRuntime()`. opencodeClient proxy adds vm route resolution. Bot handler `onboarding-flow.ts` shows inline menu for language selection → deploy target selection at first launch. AGENTS.md updated with tg-uploader, tg-cli, VPN, gui-automation rules. New skills added: tg-uploader (v3), install-vpn, gui-automation. scripts/tg-upload.ts upgraded to v3 with bot HTTP endpoint target resolution.

- **VM file browsing (`/ls`) and file open (`/open`):** VM users now browse and open files on their tenant VM via SSH instead of the local filesystem. New helpers `executeVmCommand()`, `scanDirectoryVm()`, `getFileDetailsVm()` in `ls.ts` and `file-tree.ts` route through SSH to the VM bridge IP. `open.ts` separates SSH/VM paths in `openCommand`. Fixes `sessionDirectories` cache returning stale host path for VM users. Affects: `src/bot/commands/ls.ts`, `src/bot/commands/open.ts`, `src/bot/commands/file-tree.ts`.

- **Terminal command routing:** `executeTerminalCommand` in `terminal.ts` now accepts `userId` parameter and routes: VM users → SSH to bridge IP (`cd /workspace && <cmd>` with `2>/dev/null`), SSH-remote users → `sshManager`, local users → `spawn()`. VM priority over SSH. Affects: `src/bot/commands/terminal.ts`, `src/bot/index.ts`.

- **Session rename topic sync:** `/rename` command now calls `ctx.api.editForumTopic()` after `session.update()` to keep the forum topic name in sync with the session title. SSE `session.updated` handler also renames root session topics (not just child). Affects: `src/bot/commands/rename.ts`, `src/bot/index.ts`.

- **Skills on VM:** 143+ skills copied from container `/root/.config/opencode/skills/` to VM golden image. `kabi-tg-cli v0.6.0` installed via pip3. `build-golden.sh` updated with v1 opencode install, skills copy, tg-cli install. Affects: `build-golden.sh`, `src/vm/cloud-init.ts`.

- **i18n onboarding:** VM tier labels and onboarding texts moved to `en.ts`/`ru.ts` (`vm.tier.*`, `vm.onboarding.*`, `vm.progress.*`). `showDeployTargetSelection()` and `handleOnboardingCallback()` use `t()` for localization. Affects: `src/bot/commands/onboarding-flow.ts`, `src/i18n/en.ts`, `src/i18n/ru.ts`.

- **Admin VM menu with Host option:** Admin user (6931112349) sees "Host" button in tier selection. `onboarding:host` → `setUserDeployTarget("docker")` → routes to host. Affects: `src/bot/commands/onboarding-flow.ts`.

- **Route-resolver VM path:** `/server-web` (MiniApp) route-resolver added VM check (`getUserDeployTarget(userId) === "vm"`) with `kind: "vm"`. Affects: `src/server/route-resolver.ts`.

### Fixed

- **V1 opencode auth (lildax v2 bug):** V2 lildax (1.17.4) has broken Basic auth middleware. Fix: install `opencode-ai@1.15.13` (v1) alongside `@opencode-ai/cli`, cloud-init writes systemd service with `ExecStart=/usr/local/bin/opencode serve`, deletes old lildax DB. Affects: `src/vm/cloud-init.ts`, `build-golden.sh`.

- **VM creation cleanup:** Old qcow2 and ISO files not cleaned before new VM creation → `createAndStart` deletes stale files (destroy + undefine + rm -f qcow2 + rm -f ISO) before cloning. Affects: `src/vm/manager.ts`.

- **AsyncLocalStorage scope loss:** After `execSync` in `doEnsureVmRuntime`, Telegram scope lost → `getCurrentOpencodeRoute()` returned `null` scope → fell back to `localhost:4096` (host). Fix: `getCurrentOpencodeRoute(preCapturedScope)` accepts optional scope, proxy captures scope before `ensureRuntime()`. Affects: `src/opencode/client.ts`.

- **SSH `$HOME` expansion bug:** Double-quotes in SSH commands caused local shell `$HOME` expansion (resolved to host `/home/me`). Fix: single-quotes in `executeVmCommand`. Affects: `src/bot/commands/terminal.ts`, `src/bot/commands/ls.ts`.

### Tests

- Added 32 VM tests, 11 terminal tests, 12 client-vm tests, 9 route-resolver tests, 16 onboarding tests (80 total). Files: `tests/bot/commands/terminal.test.ts`, `tests/opencode/client-vm.test.ts`, `tests/server/route-resolver.test.ts`, `tests/bot/handlers/onboarding-flow.test.ts`.

- **Active session tracker for tg-upload topic resolution:** New `src/active-session/tracker.ts` writes `/tmp/tg-active-sessions.json` mapping directory → `{sessionId, chatId, messageThreadId, timestamp}` whenever the bot calls `setCurrentSession()`. `tg-chat-lookup.ts --auto` now reads this file first and prefers the most recently active session (within 5 min TTL) over the default "most recently created" sorting. This fixes file delivery landing in the wrong forum topic when multiple sessions share the same directory. 9 unit tests + 7 integration tests (multi-topic switching, stale entry fallback, corrupted file resilience).

- **Active session tracking in `setCurrentSession()`:** `src/settings/manager.ts:setCurrentSession()` now calls `recordActiveSession()` from the tracker, passing the session's directory, chatId, and messageThreadId from the current Telegram conversation scope.

- **Routing subsystem test infrastructure:** Exported 23 private routing functions via `src/bot/index.ts:__routingTest` for unit test access, including getter/setter for `activeBotInstance`. Added `tryAutoCreateSessionTopic()` for auto-creating forum topics for web-created sessions with no Telegram prompt routing. New test directory `tests/bot/routing/` with mock factories (`fake-bot.ts`, `test-utils.ts`), unit tests for `syncSessionRoutingContext`, `isSessionCurrent`, `getSessionRoutingApi`, `getSessionRoutingTarget`, `resolveAttachedSessionTarget`, `cloneRoutingContextForChildSession`, `seedChildRoutingFromSubagent`, `buildThinkingRoutingIdentity` (47 tests) and `AttachManager` (15 tests), plus integration tests for auto-topic creation and bidirectional session rebinding (7 tests). All 69 tests pass. Testing specification at `docs/superpowers/specs/2026-06-11-routing-testing-spec.md` covers 12 invariants, 7 vulnerabilities, and 3 test levels.

- **Message journal for TG ↔ OpenCode message tracking:** New SQLite table `message_journal` tracks each Telegram message against its OpenCode counterpart (`tg_chat_id`, `tg_topic_id`, `tg_message_id` → `oc_server`, `oc_project`, `oc_session_id`, `oc_message_id`). Assistant response messages are automatically recorded when delivered to Telegram via `finalizeAssistantResponse`. New repository `src/settings/repositories/message-journal.ts` with full CRUD (insert, find by TG/OC IDs, delete by session/topic). 11 tests.

- **`/fork` command:** Creates a new forum topic with a forked copy of the current session via `opencodeClient.session.fork()`. The forked session is attached to the new topic via `attachSessionForScope`. New file `src/bot/commands/fork.ts`, registered in `definitions.ts` and wired in `bot/index.ts`.

- **Share URL persistence (`/share` fix):** New SQLite table `session_shares` caches share URLs per session. Repeated `/share` calls return the cached URL without re-requesting from the server. `/unshare` clears the cache. Modified `src/bot/commands/share.ts`. New repository `src/settings/repositories/session-shares.ts`. 4 tests.

- **Message reaction monitoring:** New SQLite table `message_reactions` stores user reactions (`tg_chat_id`, `tg_topic_id`, `tg_message_id`, `user_id`, `emoji`). `bot.on("message_reaction")` handler in `src/bot/index.ts` logs all reactions. New repository `src/settings/repositories/message-reactions.ts`. 2 tests.

- **SSE sync for OpenCode → TG deletion:** `SummaryAggregator` now handles `message.removed` and `session.deleted` SSE events via new callbacks (`setOnMessageRemoved`, `setOnSessionDeleted`). When a message is removed in OpenCode, the corresponding TG message is deleted via Bot API and the journal entry is removed. When a session is deleted, all associated TG messages are deleted; if a topic contains only that session's messages, the entire forum topic is deleted. Wired in `src/bot/index.ts` and `src/summary/aggregator.ts`.

- **Edited message fork/revert flow:** When a user edits a message tracked in the journal, the bot presents an inline keyboard with "Fork in new topic" and "Revert to this message" options. Fork creates a new session at the edited message point via `session.fork({ messageID })`. Revert calls `session.revert({ messageID })`. Callback handlers `handleMessageJournalFork` and `handleMessageJournalRevert` in `src/bot/index.ts`.

- **Forum topic deletion → session cleanup:** `bot.on("message:forum_topic_edited")` handler detects topic deletions, queries the journal for associated sessions, and calls `opencodeClient.session.delete()` for each. Journal entries are removed after deletion.

- **New i18n keys:** Added `cmd.description.fork`, `fork.success`, `fork.no_session`, `fork.error`, `share.already_shared`, `edit.fork_or_revert`, `edit.fork_button`, `edit.revert_button`, `edit.no_session`, `edit.not_found` to all 6 locales (en, ru, de, es, fr, zh).

### Changed

- **`finalizeAssistantResponse` return type:** Changed from `Promise<boolean>` to `Promise<{ streamed: boolean; telegramMessageIds: number[] }>` to expose delivered TG message IDs for journal recording. Affected `src/bot/utils/finalize-assistant-response.ts` and call site in `src/bot/index.ts`.

- **`AttachSessionReason` extended:** Added `"fork"` to the union type in `src/attach/service.ts` to support fork-triggered session attachment.

### Fixed

- **Avoid unnecessary forum topic rename on every response:** Added `childTopicLastSetName` map in `src/bot/index.ts` to track the last topic name set via `editForumTopic` in `handleSessionIdle`. Before renaming, the code now compares the current session title with the cached name — if unchanged, the Bot API call is skipped. This prevents redundant topic rename notifications in Telegram despite the session name not actually changing.

- **Permission requests now use delivery target and full routing resolution:** `setOnPermission` in `src/bot/index.ts:2610` was using `routing?.target ?? getSessionRoutingTarget()` and omitting `deliveryTarget`, unlike the question handler. This caused permission requests sent by subagent sessions to bypass the attach manager and delivery target chain, potentially routing to the wrong topic. Fixed by aligning the permission handler with `showCurrentQuestion`: now uses `getSessionRoutingTarget()` directly and passes `deliveryTarget` via `getSessionDeliveryTarget()` to `showPermissionRequest`. All 74 related tests pass.

- **STT default model changed to `medium`:** The default STT model name was `whisper-large-v3-turbo`, which is a Groq-specific name not recognized by most self-hosted Whisper APIs. Changed to `medium` in `src/config.ts:299` to match the model naming convention used by self-hosted Whisper servers (whisper.cpp, faster-whisper, etc.). The batch-transcribe scripts already defaulted to `medium`, so the bot now matches the same expected model namespace. Users with `STT_MODEL` explicitly set are unaffected.

- **STT client now handles non-JSON and non-standard API responses:** The `transcribeAudio` function in `src/stt/client.ts` now reads the raw response body first and falls back to treating it as plain text when JSON parsing fails or when the response JSON lacks a `text` field. This makes the bot compatible with lightweight Whisper API implementations that return only the transcribed text without JSON wrapping. Previously, such responses would silently fail (JSON parse error), causing the STT path to be abandoned and the fallback transcriber to be used instead.

- **Tool detail fallback now shows inline body when Telegraph publishing fails:** When `formatTechnicalProgressWithDetails` cannot create a Telegraph article (publisher returns `null` — circuit breaker open, flood wait, key exhaustion, etc.), the function now returns `format: "html"` with the detail body included inline instead of silently keeping the one-line sync message. For `todowrite` the todo list is shown as plain text below the header. For all other tools (`bash`, `reasoning`, `edit`, etc.) the detail body is wrapped in `<blockquote expandable>` below the header. Previously the fallback returned plain text without `format: "html"`, which was blocked by the `format !== "html"` guard in `src/bot/index.ts:2448`, and non-todowrite tools omitted the body entirely. Affected: `src/summary/technical-progress/formatter.ts`. 8 new tests (27 total).

### Added

- **Sync topic name with session name after agent completes:** Removed the prompt-time topic rename in `processUserPrompt` (`src/bot/handlers/prompt.ts:691`) that renamed the forum topic to the user's message text on every prompt. Terminal topics retain their command-based rename via `isTerminalTopic` guard in `src/bot/index.ts:4316`. After a root (non-child) agent session completes, `handleSessionIdle` in `src/bot/index.ts` now reads the session title from the `childSessionTitle` cache and updates the forum topic name via `editForumTopic` if a `messageThreadId` is available. Child/subagent sessions are excluded via `managedChildSessionIds` check.

- **Multi-key Telegraph publishing system:** Replaced single `TelegraphClient` with `MultiKeyClient` that auto-registers up to 5 user keys via `createAccount` API and manages them with round-robin selection for new articles and key-pinned editing for existing articles. Includes token encryption (AES-256-GCM), article-key binding repository, flood-aware key pool, and auto-registration on startup. New files: `src/telegraph/token-encryption.ts`, `src/telegraph/auto-register.ts`, `src/telegraph/multi-key-client.ts`, `src/telegraph/key-pool.ts`, `src/settings/repositories/article-bindings.ts`. Changed: `src/telegraph/types.ts`, `src/config.ts`, `src/bot/index.ts`, `src/settings/db.ts`, `src/settings/migrate.ts`, `src/settings/manager.ts`. Environment variables: `TELEGRAPH_MAX_KEYS_PER_USER` (default 5), `TELEGRAPH_TOKEN_ENCRYPTION_KEY` (optional, hex-encoded 32 bytes). All 42 related tests pass.

- **Skills package baked into Docker image:** Integrated `opencode-skills-pkg` (24+ skills) into the container image. Skills are installed from the package at `/usr/local/lib/opencode-skills-pkg/` to each tenant's `/state/skills/` directory during `run-opencode-serve.sh`. Covers creative (concept-diagrams, blender-mcp), research (osint-investigation, bioinformatics, parallel-cli), devops (docker-management, pinggy-tunnel, watchers, inference-sh-cli), security (web-pentest, sherlock), visual (screen-manager, visual-browser, screenshot), mlops (chroma, whisper, torchtitan, clip), and utility (tg-upload, one-three-one-rule) domains. SSH deployment (`ssh-manager.ts`) dynamically uploads all package skills to remote hosts. MAP.md updated with skill index. Affected: `docker/Dockerfile`, `docker/run-opencode-serve.sh`, `docker/bin/install-opencode-skills.sh` (new), `src/bot/commands/ssh.ts`, `src/utils/ssh-manager.ts`, `docker/tests/run-opencode-serve.test.sh`.

- **Skill dependencies pre-installed in Docker image:** All non-GPU dependencies for the 24+ skill package are pre-installed in the container image. APT: nmap, whatweb, xvfb, xdotool, wmctrl, scrot, imagemagick, ffmpeg, samtools, bcftools, chromium, gcc, g++, make, python3-dev. PIP: openai-whisper, chromadb, pyfiglet, pygount, sherlock-project, debugpy, pymupdf, python-pptx, biopython, pysam, comfy-cli, huggingface-hub, wandb, google-api-python-client, pillow, dspy, parallel-web-tools[cli]. NPM global: better-sqlite3, dotenv, express, qrcode, tsx, playwright. Affected: `docker/Dockerfile`.
  - Why: every skill should work out of the box without the tenant needing to install dependencies manually. GPU packages (torch, vllm, torchtitan, transformers, audiocraft, lm-eval, segment-anything) are excluded since the container does not guarantee GPU access.

- **Skills auto-installed at container entrypoint:** `docker-entrypoint.sh` now runs `install-opencode-skills` before starting `opencode serve`, copying skills from the baked-in package (`/usr/local/lib/opencode-skills-pkg`) to `/state/skills` on every container start. This ensures new tenants always have the full skill set regardless of whether the host filesystem has the package directory. Existing skills are preserved (not overwritten). Affected: `docker/bin/docker-entrypoint.sh`.
  - Why: previously skills were only copied from the host filesystem at tenant creation time. If the host didn't have the package directory (old checkout, npm install, etc.), the skills would be missing. The entrypoint path guarantees they're present in any container built from the updated image.
  - Why: tenants need a broad set of ready-to-use skills without manual installation. Baked package ensures every container has the same skill set.

### Fixed

- **Password desync between DB and container:** `SubdomainManager.ensureSubdomain()` and `ensureSshSubdomain()` always generated a new random password and overwrote `user_preferences.server_password` via `setServerPassword()`, but the running Docker container was started with the previous password. On the next API call the bot sent the new password → HTTP 401 → "OpenCode Server недоступен". Fixed by reusing the existing server password if one exists (via `getServerPassword()`), only generating a new one for brand-new users with no password yet. The regenerate-password flow (`server-web.ts`) already restarts the runtime after setting the new password. Affected: `src/server/subdomain-manager.ts`.
  - Why: every SSH setup call and web auth call would silently rotate the password without restarting the container, breaking all future API calls until the container was manually restarted.

- **Subdomain case sensitivity:** Normalize subdomain to lowercase on creation (`ensureSubdomain`, `ensureSshSubdomain`) and on lookup (`resolveSubdomain`) to fix "Unknown subdomain" error for users with uppercase usernames. Added `LOWER()` in SQL query as defense-in-depth. Lowercase the extracted subdomain in proxy Host header parsing (`proxy.ts`). Affected: `src/server/subdomain-manager.ts`, `src/server/proxy.ts`, `src/settings/repositories/subdomains.ts`.
  - Why: browsers lowercase the `Host` header (RFC 7230), but SQLite's `=` comparison is case-sensitive, so `"JohnDoe" !== "johndoe"` caused the subdomain lookup to return `null`.

- **Tenant port divergence:** After `startTenantRuntime()` spawns the Docker container, query `docker port <container>` to detect the actual host port and update `baseUrl` before health-check polling. The Docker script's `select_free_host_port` can choose a different port than Node.js expected, causing `waitForTenantHealth` to poll the wrong port and time out. Added `getActualContainerPort()` helper and divergence detection in both `doEnsureTenantRuntime` and `restartTenantRuntimes`. Affected: `src/process/manager.ts`.
  - Why: every user message would retry tenant startup → infinite failure loop because the health check always timed out on the wrong port.

### Changed

- **Settings persistence migrated from JSON file to SQLite.** `settings.json` replaced with `settings.db` (SQLite, WAL mode, better-sqlite3). All ~45 callers unchanged — only `src/settings/manager.ts` internals refactored. One-time auto-migration on first start. Marker file `.migrated-to-sqlite` prevents repeated migration. DDD: value objects (`ProjectInfo`, `SessionInfo`, `ModelInfo`) stored as JSON columns in bounded-context tables. See `docs/superpowers/specs/2026-05-31-settings-db-refactor-design.md`.

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Made `extractTranslationText` resilient to model responses with non-text parts (e.g. `tool_call`/`tool_result`). Previously the function filtered only `type === "text"` parts, causing intermittent translation failures when the `big-pickle` model returned tool-call parts instead of plain text.
  - Why: translation results were silently dropped for ~50% of entries, leaving English text on Telegraph pages despite successful model responses.
  - Affects: `src/translate/manager.ts`

### Added

- Ported upstream v0.20.5–v0.20.6 features: multiple file attachments (Telegram media group / album support), image document recognition (image/* MIME in document messages), user abort error suppression for cleaner UX, and permission request forwarding from subagent sessions.
  - Why: align with upstream feature set while preserving multi-user runtime isolation and topic-aware scope routing.
  - Affects: `src/bot/handlers/media-group.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/prompt.ts`, `src/bot/utils/abort-error-suppression.ts`, `src/bot/commands/abort.ts`, `src/bot/middleware/interaction-guard.ts`, `src/bot/utils/busy-guard.ts`, `src/summary/aggregator.ts`, `src/bot/index.ts`, `src/i18n/*.ts`, `tests/*`

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Ported upstream v0.20.5 fixes: stale busy state after abort with proper release function (`releaseAbortBusyState`), health check timeout (3s) to prevent bot polling blocks during OpenCode server start, SSE stream idle timeout (30s) with automatic reconnect, abort error suppression window (90s) to filter false "aborted" messages.
  - Why: adopt upstream bugfixes and resilience improvements while adapting to multi-user architecture with scope-aware state management.
  - Affects: `src/bot/commands/abort.ts`, `src/bot/commands/opencode-start.ts`, `src/opencode/events.ts`, `src/bot/utils/abort-error-suppression.ts`, `src/bot/utils/busy-reconciliation.ts`, `src/bot/middleware/interaction-guard.ts`, `src/bot/utils/busy-guard.ts`, `src/bot/index.ts`
- Ported upstream v0.20.6 scheduled task fix: race condition where empty completed assistant response falsely reports without checking finish reason and tool-call turns; added `getAssistantFinishReason()` and `awaitingToolCalls` detection in `extractAssistantResult()`.
  - Why: scheduled tasks that complete with tool-call turns should keep polling for the final assistant response rather than reporting empty prematurely.
  - Affects: `src/scheduled-task/executor.ts`
- Added user-facing error message for unsupported document MIME types; image/* documents now processed via shared media preparation pipeline.
  - Why: improve clarity when users send unsupported file types and enable image-document attachments.
  - Affects: `src/bot/handlers/document.ts`, `src/i18n/*.ts`
- Permission requests now route to the correct forum topic instead of falling into the main/General thread; button callbacks work correctly after fix.
  - Why: after the scope-based permission refactor (`a3ca508`), `deliveryTarget` from `getSessionDeliveryTarget()` could have a stale `messageThreadId` (via `threadContextManager` fallback in `getSessionRoutingTarget`) that disagreed with the routing scope. The message landed in the wrong thread, and the stored scope key didn't match the callback scope key, making buttons unresponsive. Fix uses `routing.target` directly (consistent with `routing.scope`) and removes the `deliveryTarget` override for permissions.
  - Affects: `src/bot/index.ts`

- Ported upstream v0.20.4 features: `/ls` command, `/detach` command, background session notification with inline "open session" button, full question options details with entity rendering, `TELEGRAM_API_ROOT` + `TELEGRAM_PROXY_SECRET` for reverse-proxy setups.
  - Why: align with upstream feature set while preserving multi-user runtime isolation.
  - Affects: `src/bot/commands/ls.ts`, `src/bot/commands/detach.ts`, `src/bot/commands/sessions.ts`, `src/bot/handlers/question.ts`, `src/background-session/tracker.ts`, `src/scheduled-task/session-ignore.ts`, `src/bot/utils/send-downloaded-file.ts`, `src/bot/utils/telegram-file-url.ts`, `src/opencode/ready-lifecycle.ts`, `src/opencode/ready-refresh.ts`, `src/utils/opencode-error.ts`, `src/bot/utils/external-user-input.ts`, `src/config.ts`, `src/i18n/*.ts`, `tests/*`

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Ported upstream v0.20.4 fixes: link to localhost/broken URL error handling, cache refresh after OpenCode server start, session restore after server readiness, external user input truncation, reply keyboard context after detach, TypeError Invalid URL when `TELEGRAM_API_ROOT` unset, health check timeout to prevent bot polling blocks, OpenCode 1.14 global event stream compatibility, IPv4 forcing for Telegram API, stuck busy state after reconnect, duplicate event listener stop during detach, Windows path handling in `/ls`.
  - Why: adopt upstream bugfixes and error-handling improvements while adapting to multi-user architecture.
  - Affects: `src/bot/utils/send-with-markdown-fallback.ts`, `src/telegram/render/validator.ts`, `src/telegram/render/inline-renderer.ts`, `src/model/manager.ts`, `src/model/context-limit.ts`, `src/opencode/*.ts`, `src/bot/utils/external-user-input.ts`, `src/pinned/manager.ts`, `src/utils/opencode-error.ts`, `src/bot/utils/busy-reconciliation.ts`, `src/scheduled-task/foreground-state.ts`, `src/bot/telegram-client-options.ts`, `src/bot/commands/ls.ts`, `src/bot/commands/detach.ts`

### Added

- Added localized one-line technical progress messages with concise reasoning/thinking output, todo status icons with collapse-friendly summaries, and optional Telegraph detail links for verbose tool/reasoning details.
  - Why: Telegram users need readable live progress in their selected language without flooding chats, while still having access to full technical output when configured.
  - Affects: `src/summary/technical-progress/*`, `src/telegraph/*`, `src/bot/utils/thinking-message.ts`, `src/bot/utils/thinking-block-stream.ts`, `src/bot/index.ts`, `src/i18n/*.ts`, `README.md`, `.env.example`, `PRODUCT.md`
- Added Telegraph configuration via `TELEGRAPH_ENABLED`, `TELEGRAPH_ACCESS_TOKEN`, `TELEGRAPH_AUTHOR_NAME`, `TELEGRAPH_TIMEOUT_MS`, and `TELEGRAPH_MAX_CHARS` for publishing optional technical detail pages.
  - Why: long command output, reasoning, and todo details should be available by link without forcing every progress update into Telegram message bodies.
  - Affects: `src/config.ts`, `src/telegraph/*`, `README.md`, `.env.example`, `PRODUCT.md`
- Hardened technical detail redaction before Telegraph publishing to cover private-key blocks, cookie headers, and common standalone token formats.
  - Why: tool output and diffs can contain credentials that are not expressed as simple `KEY=value` assignments.
  - Affects: `src/summary/technical-progress/redact.ts`, `tests/summary/technical-progress/redact.test.ts`
- Added `/model`, `/variant`, and `/settings` commands for user-scoped defaults, direct model/variant updates, language selection, and message visibility preferences.
- Added topic-scoped session attach/follow behavior for multi-user and forum-thread workflows, keeping attached-session restores, follow-up routing, and startup pinned status isolated per private chat or Telegram topic.
  - Why: one shared global route caused attached-session events and pinned state to bleed across users or topics, which made concurrent remote work hard to trust.
  - Affects: `src/attach/*`, `src/thread/*`, `src/pinned/manager.ts`, `src/bot/index.ts`, `tests/attach/*.test.ts`, `tests/pinned/manager.test.ts`
- Added `/mcps` for browsing configured MCP servers, their connection state, enabled/disabled status, command/url details, and connection errors from Telegram.
  - Why: users need a lightweight way to verify MCP availability remotely without opening the local OpenCode UI.
  - Affects: `src/bot/commands/mcps.ts`, `src/bot/commands/definitions.ts`, `src/i18n/*.ts`, `tests/bot/commands/mcps.test.ts`, `README.md`, `PRODUCT.md`
- Added optional OpenCode server monitoring with automatic restart controlled by `OPENCODE_AUTO_RESTART_ENABLED` and `OPENCODE_MONITOR_INTERVAL_SEC`.
  - Why: remote users need the managed local OpenCode server to recover from stop/crash events without manual access to the host machine.
  - Affects: `src/opencode/auto-restart.ts`, `src/app/start-bot-app.ts`, `src/config.ts`, `tests/opencode/auto-restart.test.ts`, `tests/runtime/start-bot-app.test.ts`, `.env.example`, `README.md`, `PRODUCT.md`
- Added Google Cloud TTS as an alternative `/tts` provider via `TTS_PROVIDER=google` and `GOOGLE_APPLICATION_CREDENTIALS`, alongside provider-specific default voices.
  - Why: some deployments need local service-account based speech synthesis instead of OpenAI-compatible API credentials.
  - Affects: `src/config.ts`, `src/tts/client.ts`, `tests/config.test.ts`, `tests/tts/client.test.ts`, `.env.example`, `README.md`, `PRODUCT.md`

- Added an automated Docker OpenCode refresh workflow through `docker/update-opencode.sh`, including upstream fetch, local tenant/image rebuilds, version reporting, and Docker test reruns.
  - Why: updating the Dockerized OpenCode runtime should be reproducible from one documented entrypoint instead of requiring manual rebuild sequencing.
  - Affects: `docker/update-opencode.sh`, `docker/README.md`, `docker/README-ru.md`
- Added a real architecture map in `docs/architecture.md` with concrete runtime entrypoints, managers, handlers, scheduled-task modules, and API integration paths.
  - Why: the project now requires not just feature lists, but also explicit documentation of how modules, managers, and external APIs interact.
  - Affects: `docs/architecture.md`, `src/app/start-bot-app.ts`, `src/bot/index.ts`, `src/opencode/events.ts`, `src/summary/aggregator.ts`, `src/scheduled-task/runtime.ts`
- Added a local `openai-media-transcriber` project skill that targets the Gemini CLI OpenAI-compatible server on `http://localhost:8124` and reads its auth token from `~/.gemini/.env` when no explicit override is provided.
  - Why: this workspace already runs a local Gemini CLI media API, so `opencode` should reuse the same secure media upload and transcription path without duplicating secrets into the project.
  - Affects: `skills/openai-media-transcriber/SKILL.md`, `skills/openai-media-transcriber/scripts/*`, `tests/skills/openai-media-transcriber/media-client.test.mjs`
- Added a Docker-bundled `openai-media-transcriber` skill that is materialized into each tenant's `/state/skills` and routed through a root-owned local proxy instead of exposing the upstream Gemini media endpoint or API key to tenant-visible config.
  - Why: Docker tenants need immediate media transcription support, but the Gemini CLI API credentials at `192.168.2.166:8124/v1` must stay outside the tenant-visible workspace and OpenCode config.
  - Affects: `docker/skills/openai-media-transcriber/SKILL.md`, `docker/bin/opencode-gemini-media`, `docker/bin/gemini-media-proxy.mjs`, `docker/bin/docker-entrypoint.sh`, `docker/Dockerfile`, `docker/run-opencode-serve.sh`, `docker/tests/*.sh`
- Added Docker tenant OpenSSH client support with workspace-backed SSH home behavior under `/workspace/.ssh`.
  - Why: tenant sessions need standard `ssh` tooling and persistent per-workspace key storage so in-container clones, fetches, and remote access flows can reuse generated keys without exposing host-level SSH state.
  - Affects: `docker/Dockerfile`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tenant-entrypoint-permissions.test.sh`, `docker/tests/tg-cli-image.test.sh`, `docker/README.md`, `docker/README-ru.md`
- Added a tenant-local Python bootstrap flow for Docker runtimes that creates and repairs `/workspace/.venvs/default`, routes tenant `python`/`pip` commands there, and keeps installed packages persistent in the tenant workspace across container restarts.
  - Why: Docker tenants were hitting blocked system `pip` flows and missing `python3-venv`, which made ad-hoc Python package installation unreliable and often impossible to repair remotely.
  - Affects: `docker/Dockerfile`, `docker/bin/ensure-tenant-python-env.sh`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tg-cli-image.test.sh`, `docker/tests/tenant-python-env.test.sh`, `docker/update-opencode.sh`, `docker/README.md`, `docker/README-ru.md`

### Added

- Added scope-keyed path reference storage with `clearScopeOpenPathIndex`, `encodeScopedPathReference`, `decodeScopedPathReference` in `src/bot/runtime/scope-open-state.ts` for topic-isolated file browser state.
  - Why: a shared module-level path index caused one topic's open-file-browser callback data to invalidate another topic's callbacks.
  - Affects: `src/bot/runtime/scope-open-state.ts`, `tests/bot/runtime/scope-open-state.test.ts`
- Added user-visible change for /open command: each topic's file browser now uses its own scope-keyed path index so clearing or navigating in one topic does not break another topic's pending callback buttons.
  - Why: concurrent file browser sessions in different forum topics need independent state.
  - Affects: `src/bot/commands/open.ts`, `tests/bot/commands/open.test.ts`

### Changed

- Removed raw JSON diagnostic tool messages in subagent forum topics in favor of the localized `formatTechnicalProgressSync`/`WithDetails` pipeline already used for the main chat.
  - Why: subagent topics showed duplicate raw JSON like `⚙️ grep {"include":"*.ts",...}` alongside formatted messages. The aggregator already formats and delivers tool progress through `setOnTool`, so the raw diagnostic path was redundant.
  - Affects: `src/bot/index.ts` (removed lines 2651-2696), `tests/bot/index.local-file-follow-up.test.ts`
  - Why: live Telegram rejects repeated `sendMessageDraft` ids with `RANDOM_ID_INVALID`, which could drop the final linked thinking summary.
  - Affects: `src/bot/utils/thinking-block-stream.ts`, `tests/bot/utils/thinking-block-stream.test.ts`
- Changed directory-read progress detection to inspect OpenCode's top-level tool `output` as well as structured metadata.
  - Why: live `read` directory events place `<type>directory</type>` in `output`, so Telegram could label directory reads as file reads.
  - Affects: `src/summary/technical-progress/formatter.ts`, `tests/summary/technical-progress/formatter.test.ts`
- Fixed Telegraph detail pages for `read` tool events showing only the file path instead of actual file/directory content.
  - Why: OpenCode places `read` output at the top-level tool `state.output`, but `buildTechnicalDetails` only checked `metadata.output`. Now inspects `state.output` as well and strips the XML wrapper from read tool output before publishing.
  - Affects: `src/summary/technical-progress/details.ts`, `tests/summary/technical-progress/details.test.ts`
- Hardened Telegraph publishing: added per-request diagnostic logging of Telegraph API error codes and filtering of empty/whitespace-only lines from content nodes to reduce API rejections.
  - Why: silent API failures (e.g. large empty-lines content, title limits) were undiagnosable and could waste createPage calls.
  - Affects: `src/telegraph/telegraph-client.ts`, `tests/telegraph/telegraph-client.test.ts`
- Changed session/project switch cleanup from global `summaryAggregator.clear()` to scope-scoped `clearScopedSessionRuntime()` so switching sessions or projects in one topic does not reset summary state for another topic.
  - Why: `summaryAggregator.clear()` was global and could discard summary data for active sessions in other topics.
  - Affects: `src/bot/utils/switch-project.ts`, `src/bot/commands/sessions.ts`, `src/bot/commands/new.ts`, `src/bot/commands/projects.ts`, `tests/bot/utils/switch-project.test.ts`, `tests/bot/commands/sessions.test.ts`, `tests/bot/commands/new.test.ts`, `tests/bot/commands/projects.handle-project-select.test.ts`
- Changed forum subagent delivery to route each child session through a dedicated per-user topic when available, keep child-session final answers silent in that topic, delete the topic only after the final child answer is actually delivered and the configured timeout elapses, and preserve `/projects` selections as user defaults across new topics.
  - Why: forum subagents need isolated child-session output that does not leak across users or topics, topic cleanup must not race ahead of the final answer, and project selection should follow the same user-default model as other scoped preferences.
  - Affects: `src/bot/index.ts`, `src/bot/subagent-topics/service.ts`, `src/settings/manager.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/bot/subagent-topics/service.test.ts`, `tests/settings/manager.test.ts`, `PRODUCT.md`
- Changed assistant reply delivery to use a local Telegram MarkdownV2 formatter for user-visible `MESSAGE_FORMAT_MODE=markdown` rendering.
  - Why: Telegram MarkdownV2 is stricter than generic markdown, so a local formatter reduces broken escaping and makes streamed/final replies more predictable.
  - Affects: `src/telegram/render/*`, `src/bot/utils/assistant-rendering.ts`, `tests/telegram/render/*.test.ts`, `README.md`
- Changed TTS synthesis to strip Markdown before generating speech output.
  - Why: links, headings, and markdown markers should not be read out literally in spoken replies.
  - Affects: `src/tts/client.ts`, `tests/tts/client.test.ts`, `README.md`, `PRODUCT.md`

- Added local `ffmpeg`-based preprocessing for oversized Telegram videos and video notes up to 61 seconds, compressing them to a derivative under 19.5MB before the existing video attachment/transcription flow continues.
  - Why: Telegram videos can exceed the downloader ceiling well before they exceed the duration ceiling, so the bot needs a deterministic way to accept longer high-bitrate clips without breaking the downstream 20MB media path.
  - Affects: `src/media/video-preprocess.ts`, `src/bot/handlers/video.ts`, `src/bot/utils/file-download.ts`, `src/i18n/*.ts`, `tests/media/video-preprocess.test.ts`, `tests/bot/handlers/video.test.ts`, `PRODUCT.md`
- Persisted all incoming Telegram media under runtime-aware per-user storage and switched unsupported photo/PDF/video inputs plus unavailable audio STT flows to the local `openai-media-transcriber` scripts, forwarding extracted text together with the runtime-visible saved file path into OpenCode.
  - Why: Telegram attachments should survive beyond the immediate request, tenant containers need paths that are valid both on the host bind mount and inside `/state`, and coding-oriented text models should still be able to work from media context without manual model switching or a hard STT dependency.
  - Affects: `src/media/*`, `src/bot/handlers/photo.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/voice.ts`, `src/bot/index.ts`, `src/i18n/*.ts`, `tests/media/*.test.ts`, `tests/bot/handlers/*.test.ts`, `PRODUCT.md`, `package.json`
- Changed `/models` to render the active runtime's provider-first catalog instead of querying providers directly, while keeping the existing empty and error replies for unavailable catalogs and safely splitting oversized catalogs across multiple Telegram replies.
  - Why: the command output should match the new runtime-aware model picker so Telegram users see the same provider/model set as the current OpenCode runtime without hitting Telegram's 4096-character message limit.
  - Affects: `src/bot/commands/models.ts`, `tests/bot/commands/models.test.ts`, `PRODUCT.md`
- Upgraded branch to v0.17.0 semantic level, porting rendering pipeline, new commands (`/skills`, `/worktree`, `/open`), and runtime alignment while preserving local multi-user orchestration, threaded routing, and Docker customizations.
  - Why: align with upstream v0.17.0 features while keeping local modifications that support multi-user, approval flows, forum threading, and container lifecycle.
  - Affects: `src/telegram/render/`, `src/bot/utils/assistant-rendering.ts`, `src/bot/commands/skills.ts`, `src/bot/commands/worktree.ts`, `src/bot/commands/open.ts`, `src/opencode/process.ts`, `src/service/`, `src/bot/index.ts`, `src/i18n/*.ts`, `tests/`
- Added a Docker-only bundled `local/gemma4` model entry to the generated tenant OpenCode config.
  - Why: Docker users need the local Gemma 4 endpoint to appear in the model picker without changing the non-Docker runtime configuration.
  - Affects: `docker/run-opencode-serve.sh`, `docker/tests/run-opencode-serve.test.sh`
- Selectively aligned runtime management with upstream v0.17.0, preserving local multi-user orchestration and Docker stop/restart logic.
  - Why: upgrade to v0.17.0 semantic level requires adopting upstream runtime helpers (`opencode/process`, `service/*`) while keeping local process manager for tenant isolation and container lifecycle.
  - Affects: `src/opencode/process.ts`, `src/service/manager.ts`, `src/service/runtime.ts`, `src/service/types.ts`, `src/bot/commands/opencode-start.ts`, `src/bot/commands/opencode-stop.ts`, `src/bot/commands/status.ts`, `src/cli.ts`, `src/i18n/*.ts`, `tests/opencode/process.test.ts`, `tests/service/manager.test.ts`, `tests/bot/commands/opencode-start.test.ts`, `tests/bot/commands/opencode-stop.test.ts`, `tests/bot/commands/status.test.ts`
- Replaced the old Telegram login QR follow-up path with automatic local-file follow-ups from assistant replies, sending supported images/audio/video in their native Telegram media format and other files as documents when the referenced local file exists and is 20 MB or smaller.
  - Why: QR-specific auth delivery should be removed, while assistant replies that point to local artifacts should deliver those files asynchronously without blocking the next response.
  - Affects: `src/bot/index.ts`, `src/bot/utils/finalize-assistant-response.ts`, `src/bot/utils/telegram-local-file-follow-up.ts`, `tests/bot/utils/finalize-assistant-response.test.ts`, `tests/bot/utils/telegram-local-file-follow-up.test.ts`
- Expanded product and README documentation to reflect the real command set and current input flows, including `/stream`, `/start` reset behavior, and the current attachment support boundaries.
  - Why: the user-facing docs should match the actual runtime behavior instead of only a partial feature list.
  - Affects: `PRODUCT.md`, `README.md`, `src/bot/commands/definitions.ts`, `src/bot/commands/start.ts`, `src/bot/commands/stream.ts`, `src/bot/handlers/document.ts`
- Centralized `/start` in the shared command definitions and command registration path so Telegram commands, help text, and runtime registration all derive from the same source.
  - Why: `/start` should follow the same single-source-of-truth rule as the rest of the bot command set.
  - Affects: `src/bot/commands/definitions.ts`, `src/bot/index.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/ru.ts`, `src/i18n/zh.ts`
- Replaced the single-user Telegram auth setting with admin + allowlist parsing, while keeping legacy `TELEGRAM_ALLOWED_USER_ID` as a compatibility fallback.
  - Why: Phase 2 of the multi-user plan needs controlled onboarding for multiple bot users without breaking existing installations.
  - Affects: `src/config.ts`, `src/runtime/bootstrap.ts`, `src/bot/middleware/auth.ts`, `src/bot/index.ts`, `.env.example`, `README.md`
- Switched the Docker tg-cli build helper to default to the in-repo `docker/tg-cli` tree instead of the old external checkout path.
  - Why: tg-cli now lives alongside the bot project, so the image build should vendor the relocated source without extra environment overrides.
  - Affects: `docker/build-opencode-tg-image.sh`, `docker/README.md`, `docker/README-ru.md`
- Changed the Docker entrypoint to start OpenCode as an unprivileged uid/gid `1000` tenant process after bootstrapping root-only runtime helpers.
  - Why: tenant-visible skills now depend on a root-owned local proxy for secure Gemini media access, so the OpenCode process must not retain read access to the proxy config file that contains upstream credentials.
  - Affects: `docker/bin/docker-entrypoint.sh`, `docker/Dockerfile`, `docker/tests/gemini-media-image.test.sh`
- Extended `/restart` so the admin restart cascades through all saved isolated tenant runtimes before the main bot process restarts.
  - Why: admin restarts should refresh every tenant container as part of the same control action, instead of leaving isolated runtimes stale.
  - Affects: `src/bot/commands/restart.ts`, `src/process/manager.ts`, `src/process/types.ts`, `tests/bot/commands/restart.test.ts`, `tests/process/manager.test.ts`
- Fixed the tg-cli Docker wrapper to use the actual tg-cli env/config model instead of passing an unsupported `--config` flag.
  - Why: the tenant containers had tg-cli installed, but the wrapper invoked it with a flag that this build does not accept, so auth commands failed immediately.
  - Affects: `docker/bin/tg-cli-wrapper.sh`, `docker/skills/tg-cli/SKILL.md`, `docker/tests/tg-cli-path.test.sh`, `docker/README.md`, `docker/README-ru.md`
- Scoped scheduled-task visibility and deferred delivery by task owner so background results return to the correct Telegram user or forum topic.
  - Why: scheduled tasks were still shared globally, which would leak task lists and background notifications across users.
  - Affects: `src/bot/commands/task.ts`, `src/scheduled-task/store.ts`, `src/scheduled-task/runtime.ts`, `src/scheduled-task/types.ts`, `tests/scheduled-task/*.test.ts`
- Added Telegram `video` and `video_note` prompt handling for clips up to 60 seconds, forwarding them as video attachments when the selected model supports video input.
  - Why: photo attachments already worked, and short Telegram videos should follow the same direct multimodal prompt flow instead of being ignored.
  - Affects: `src/bot/index.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/prompt.ts`, `src/model/capabilities.ts`, `src/i18n/*.ts`, `tests/bot/handlers/video.test.ts`, `README.md`, `PRODUCT.md`, `docs/architecture.md`
- Added automatic media-model fallback to `google/gemini-3-flash-preview` for image, video, and PDF prompts when the currently selected model lacks the required multimodal input support.
  - Why: media attachments should keep working without forcing the user to manually switch away from a coding-focused text model before every photo, video, or PDF prompt.
  - Affects: `src/bot/index.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/prompt.ts`, `src/model/media-fallback.ts`, `src/i18n/*.ts`, `tests/model/media-fallback.test.ts`, `tests/bot/handlers/document.test.ts`, `tests/bot/handlers/video.test.ts`, `README.md`, `PRODUCT.md`, `docs/architecture.md`
- Integrated v0.17.0 assistant renderer (`prepareAssistantStreamingPayload`, `prepareAssistantFinalStreamingPayload`, `renderAssistantFinalPartsSafe`) into local bot delivery paths while preserving all existing local routing semantics and invariants.
  - Why: upgrade to v0.17.0 semantic level requires adopting the new assistant rendering pipeline for consistent markdown formatting and streaming payload preparation across both streaming and final delivery paths.
  - Affects: `src/bot/index.ts`, `src/bot/utils/assistant-rendering.ts`, `tests/bot/index.local-file-follow-up.test.ts`

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Stabilized subagent topic delivery so child runs now use centralized topic lifecycle tracking, send the run footer only after terminal completion, auto-delete only after confirmed final delivery, and fall back through one safer Telegram text-rendering pipeline.
  - Why: child-topic replies had accumulated routing, cleanup-timing, and parse-mode regressions that made final delivery and topic cleanup unreliable.
  - Affects: `src/bot/index.ts`, `src/bot/subagent-topics/child-delivery.ts`, `src/bot/subagent-topics/service.ts`, `src/bot/utils/telegram-text.ts`, `src/bot/utils/send-with-markdown-fallback.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/bot/subagent-topics/service.test.ts`, `tests/bot/utils/send-with-markdown-fallback.test.ts`, `tests/bot/streaming/response-streamer.test.ts`
- Fixed question and permission replies to use the runtime context captured with the original request instead of whichever session or project is currently active when the user answers.
  - Why: delayed replies could target the wrong OpenCode runtime after the user switched sessions or projects before responding in Telegram.
  - Affects: `src/bot/handlers/question.ts`, `src/bot/handlers/permission.ts`, `src/question/manager.ts`, `src/permission/manager.ts`, `tests/bot/handlers/question.test.ts`, `tests/bot/handlers/permission.test.ts`

- Fixed Telegram assistant delivery ordering and resilience so durable assistant outputs now follow OpenCode event timing, active thinking and final reasoning survive Telegram `429 retry_after` without crashing the bot, long thinking HTML is chunked safely, and ordered lists stay readable instead of collapsing into repeated `1.` items.
  - Why: assistant replies, tool/subagent publications, and session footers could race each other, long/active thinking updates could break on Telegram limits or parse edges, ordered lists could render incorrectly in Telegram, and unhandled Telegram delivery failures could terminate the bot process.
  - Affects: `src/bot/index.ts`, `src/bot/delivery/*`, `src/bot/utils/thinking-block-stream.ts`, `src/bot/utils/thinking-draft-lifecycle.ts`, `src/bot/utils/telegram-html-chunker.ts`, `src/bot/utils/reasoning-format.ts`, `src/summary/aggregator.ts`, `src/bot/assistant-run-state.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/bot/delivery/*.test.ts`, `tests/bot/utils/*.test.ts`, `tests/summary/aggregator.test.ts`
- Fixed user-scoped defaults from `/model`, `/variant`, and `/settings` so selected agent/model/variant and message visibility preferences override `.env` defaults for new sessions in the same user's new topics.
  - Why: only locale was effectively user-scoped; model/variant still fell back to `OPENCODE_MODEL_PROVIDER`/`OPENCODE_MODEL_ID`, and global hide-message env flags could not be turned off per user.
  - Affects: `src/settings/manager.ts`, `src/bot/index.ts`, `tests/settings/manager.test.ts`
- Fixed automatic local-file follow-ups for Docker tenant users so assistant-mentioned host paths are ignored before filesystem checks, while container-visible `/workspace/...` and `/state/...` paths still resolve to the user's own Workspaces tenant directory.
  - Why: a non-admin user could ask the assistant to mention an arbitrary host absolute path and the bot could send that file if it existed and was under the size limit.
  - Affects: `src/bot/index.ts`, `src/bot/utils/telegram-local-file-follow-up.ts`, `tests/bot/index.local-file-follow-up.test.ts`
- Fixed incoming media prompts so saved file paths are always included in OpenCode context for photos, PDFs, videos, text documents, voice/audio, attachment mode, text fallback mode, and post-save transcription failures.
  - Why: Telegram-uploaded files must remain addressable by path inside the active OpenCode session even when transcription succeeds, returns empty text, or fails after the file has been saved.
  - Affects: `src/media/ingest.ts`, `src/bot/handlers/voice.ts`, `tests/media/ingest.test.ts`, `tests/bot/handlers/voice.test.ts`
- Fixed interactive Telegram prompt dispatch to use OpenCode's async prompt endpoint instead of waiting on the synchronous prompt response behind a local 60-second timeout.
  - Why: long-running coding tasks could be accepted by OpenCode but still be reported as failed by the bot after the local timeout expired.
  - Affects: `src/bot/handlers/prompt.ts`, `src/bot/index.ts`, `tests/bot/handlers/prompt-deferred-follow-up.test.ts`
- Fixed `/opencode_start` and `/opencode_stop` access control so they are available to all users while `/restart` remains admin-only.
  - Why: the OpenCode runtime commands manage the per-user server and should not be blocked by the bot admin gate; only the host restart action should stay restricted.
  - Affects: `src/bot/commands/definitions.ts`, `src/bot/commands/opencode-start.ts`, `src/bot/commands/opencode-stop.ts`, `tests/bot/commands/opencode-start.test.ts`, `tests/bot/commands/opencode-stop.test.ts`, `tests/bot/utils/command-sync.test.ts`
- Fixed forum main-thread reply-keyboard behavior so the bottom keyboard stays manually hideable, is reattached consistently on later bot replies, keeps reply-keyboard-triggered actions in the forum main thread instead of opening a new topic, and preserves topic-local `agent`/`model`/`variant` isolation.
  - Why: the earlier flow mixed a persistent keyboard with incomplete forum main-thread routing, which made Telegram's native hide control unreliable and could route main-thread menu actions into a new topic instead of the current scope.
  - Affects: `src/bot/utils/keyboard.ts`, `src/bot/utils/message-thread.ts`, `src/bot/handlers/inline-menu.ts`, `src/bot/commands/start.ts`, `src/bot/commands/status.ts`, `tests/bot/utils/keyboard.test.ts`, `tests/bot/utils/message-thread.test.ts`, `tests/bot/handlers/inline-menu.test.ts`, `tests/bot/handlers/agent.test.ts`, `tests/bot/handlers/model.test.ts`, `tests/bot/handlers/variant.test.ts`, `tests/settings/manager.test.ts`
- Fixed duplicate or misleading subagent/tool-call presentation so repeated completion updates and overlapping tool-call streams do not spam Telegram with stale or duplicate progress summaries.
  - Why: concurrent subagent and tool activity could produce repeated completion lines or visually overlapping tool-call updates, making live progress harder to follow.
  - Affects: `src/summary/aggregator.ts`, `src/bot/streaming/tool-call-streamer.ts`, `tests/summary/aggregator.test.ts`, `tests/bot/streaming/tool-call-streamer.test.ts`
- Fixed scoped external-input and busy-state routing so attached-session input suppression and foreground busy tracking stay isolated to the same chat/topic scope.
  - Why: concurrent users or forum topics must not inherit each other's external-input notices or "bot is busy" protection state.
  - Affects: `src/bot/index.ts`, `src/scheduled-task/foreground-state.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/scheduled-task/foreground-state.test.ts`
- Fixed Docker tenant `opencode serve` project/session API failures after the upstream OpenCode refresh by preparing `.gitignore` in the host-side mounted config directory before launching the container.
  - Why: the refreshed OpenCode bootstrap now ensures `OPENCODE_CONFIG_DIR/.gitignore` exists, but the tenant launcher mounts that directory into the container as read-only, causing 500 `UnknownError` responses from `/project` and `/session` when the file was missing.
  - Affects: `docker/run-opencode-serve.sh`, `docker/tests/run-opencode-serve.test.sh`
- Unified deferred Telegram batching across text, forwarded messages, and media preprocessing, so large bursts now stay in a single OpenCode follow-up chunk while media is still downloading/transcribing.
  - Why: large forwarded batches with photos, videos, voice notes, and documents could split into multiple OpenCode prompts because media handlers finished after the silence timer expired, and deferred chunk items did not all carry stable sender/forward metadata.
  - Affects: `src/bot/incoming-media-batch.ts`, `src/bot/index.ts`, `src/bot/handlers/photo.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/voice.ts`, `src/media/batch-types.ts`, `src/media/prompt-composer.ts`, `tests/bot/incoming-media-batch.test.ts`, `tests/media/prompt-composer.test.ts`
- Fixed video attachment mode to transcribe audio before sending the video to OpenCode, so the user's spoken question is included in the prompt when the selected model supports video input and attachments.
  - Why: when the model supports video input, the bot previously sent the video file without transcribing its audio track, losing the user's spoken content.
  - Affects: `src/media/ingest.ts`, `tests/media/ingest.test.ts`
- Fixed rootless Docker tenant startup after recreating a user's workspace/state directory by changing the container entrypoint to keep bind-mounted `/workspace` and `/state` writable, while dropping runtime capabilities and moving the Gemini media proxy onto its own unreadable service uid.
  - Why: after deleting a tenant directory and letting the bot bootstrap it again, `opencode serve` could fail on first start with `EACCES` under `/state/cache/opencode` because rootless Docker mapped host-owned bind mounts in a way that broke writes from the previous unprivileged uid/gid 1000 runtime, and the initial runtime fix still needed a stronger process boundary around the proxy secret.
  - Affects: `docker/Dockerfile`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tenant-entrypoint-permissions.test.sh`, `docker/tests/gemini-media-image.test.sh`
- Restored the blue Telegram slash-command button for already approved non-admin users after bot restarts by re-syncing their private-chat command scopes on startup and immediately after admin approval.
  - Why: the bot clears global command scopes on startup, but approved users only got chat-scoped commands back after sending a new update, so the `/status`-style command button disappeared until they wrote to the bot again.
  - Affects: `src/bot/index.ts`, `src/bot/middleware/auth.ts`, `tests/bot/index.callback-routing.test.ts`, `tests/bot/middleware/auth.test.ts`
- Reworked Telegram reasoning delivery so the active thinking block lives in a draft lifecycle, each completed reasoning block is published as its own normal chat message, and route-loss cleanup now deletes stale drafts only through the route that originally owned them.
  - Why: reasoning should stream as one active draft per block without overwriting completed blocks, and route switches during cleanup must not delete unrelated messages in another chat or thread.
  - Affects: `src/bot/index.ts`, `src/bot/utils/thinking-block-stream.ts`, `src/bot/utils/thinking-draft-lifecycle.ts`, `tests/bot/utils/thinking-block-stream.test.ts`, `tests/bot/utils/thinking-draft-lifecycle.test.ts`, `tests/bot/index.local-file-follow-up.test.ts`
- Restored Telegram `<blockquote expandable>` formatting for reasoning and thinking traces, and kept long reasoning/draft/stream splits wrapped in valid expandable blockquotes across multi-message delivery.
  - Why: recent local changes downgraded collapsible reasoning quotes to plain blockquotes, and long-message paths could drop or break the expandable wrapper while chunking HTML for Telegram.
  - Affects: `src/bot/utils/reasoning-format.ts`, `src/bot/utils/send-message-draft-effect.ts`, `src/bot/streaming/tool-call-streamer.ts`, `tests/bot/utils/reasoning-format.test.ts`, `tests/bot/utils/send-message-draft-effect.test.ts`, `tests/bot/streaming/tool-call-streamer.test.ts`, `CHANGELOG.md`
- Synced Telegram forum topic names with the selected OpenCode session title when switching sessions via `/sessions`, and kept long-running forum threads aligned with the active session context.
  - Why: in forum workflows the thread title could drift away from the bound OpenCode session, which made session switching harder to follow from Telegram alone.
  - Affects: `src/bot/commands/sessions.ts`, `tests/bot/commands/sessions.test.ts`
- Stopped streamed assistant drafts, reasoning updates, and oversized final HTML replies from overwriting previously delivered text when the content changed shape or crossed Telegram's 4096-character limit.
  - Why: the draft stream edited the last Telegram message too aggressively, so new reasoning blocks and long continuations could replace earlier text instead of continuing in a new message.
  - Affects: `src/bot/utils/message-draft-stream.ts`, `src/bot/utils/finalize-assistant-response.ts`, `tests/bot/utils/message-draft-stream.test.ts`, `tests/bot/utils/finalize-assistant-response.test.ts`
- Moved streamed reasoning details into the dedicated `bot.thinking` message and removed the duplicate reasoning quote from the final assistant reply.
  - Why: Telegram users should see `Думаю...` as the explicit thinking marker, with the expandable reasoning trace attached there instead of being repeated at the end of the final answer.
  - Affects: `src/bot/index.ts`, `src/bot/utils/thinking-message.ts`, `tests/bot/utils/thinking-message.test.ts`
- Stopped final assistant delivery from waiting on QR-specific follow-up sending by preparing local-file follow-ups during finalization and dispatching them in the background after the text reply is sent.
  - Why: follow-up media must not block the main assistant response or queue later replies behind attachment delivery.
  - Affects: `src/bot/index.ts`, `src/bot/utils/finalize-assistant-response.ts`, `tests/bot/utils/finalize-assistant-response.test.ts`
- Kept thinking messages visible by default instead of deleting them on assistant completion, so the explicit clear-thinking command now controls whether they are removed.
  - Why: thinking output should remain available unless the user explicitly enables clearing it.
  - Affects: `src/settings/manager.ts`, `src/bot/index.ts`, `src/bot/commands/clear-mode.ts`, `src/bot/utils/thinking-message-lifecycle.ts`, `tests/bot/utils/thinking-message-lifecycle.test.ts`, `tests/bot/commands/clear-mode.test.ts`, `tests/settings/manager.test.ts`
- Kept final assistant replies locked to the thread where the prompt started, instead of falling back to the currently active chat when the session finishes later.
  - Why: late SSE completion could reuse the active main-chat context and send the final answer outside the originating topic thread.
  - Affects: `src/bot/index.ts`, `src/thread/manager.ts`, `tests/thread/manager.test.ts`
- Streamed reasoning previews inside the expandable quote immediately instead of showing the quote only after the reasoning stream finished.
  - Why: Telegram users should see the thinking text appear inside the final quote structure from the start, not watch it move into the quote only after completion.
  - Affects: `src/bot/index.ts`, `src/bot/utils/message-draft-stream.ts`, `tests/bot/utils/message-draft-stream.test.ts`, `PRODUCT.md`, `docs/architecture.md`
- Fixed private-chat command sync so the bot now restores Telegram's command menu button together with `setMyCommands`.
  - Why: Telegram persists `setChatMenuButton` separately, so commands could still exist on the API side while the chat menu button and `/` suggestions stayed hidden in the client.
  - Affects: `src/bot/index.ts`, `src/bot/middleware/auth.ts`, `src/bot/utils/command-sync.ts`, `tests/bot/middleware/auth.test.ts`, `tests/bot/utils/command-sync.test.ts`, `README.md`, `docs/architecture.md`
- Stopped forcing the bottom reply keyboard to be persistent in private chats.
  - Why: Telegram clients can replace the command-menu affordance with the persistent keyboard toggle, which makes the menu button appear briefly after sync and then disappear again after `/start` or other keyboard updates.
  - Affects: `src/bot/utils/keyboard.ts`, `tests/bot/utils/keyboard.test.ts`, `README.md`, `docs/architecture.md`
- Stopped batched and technical service messages such as `bot.thinking`, question/permission prompts, keyboard refreshes, pinned status creation, and background error notifications from using the short `sendMessageDraft` effect.
  - Why: those draft previews could visually take over the same in-chat draft area as the live assistant stream, leaving the user with only `Думаю...` instead of the streamed reply text.
  - Affects: `src/bot/index.ts`, `src/bot/commands/commands.ts`, `src/bot/handlers/permission.ts`, `src/bot/handlers/prompt.ts`, `src/bot/handlers/question.ts`, `src/bot/utils/send-message-draft-effect-context.ts`, `src/keyboard/manager.ts`, `src/pinned/manager.ts`, `tests/bot/utils/send-message-draft-effect-context.test.ts`, `docs/architecture.md`
- Fixed `sendMessageDraft` id collisions between assistant stream updates and the short draft effect used for normal bot messages such as the localized thinking indicator.
  - Why: both managers allocated draft ids independently, so a service message like `bot.thinking` could reuse the active assistant draft id and visually replace the streamed text in Telegram.
  - Affects: `src/bot/index.ts`, `src/bot/utils/message-draft-id.ts`, `src/bot/utils/message-draft-stream.ts`, `src/bot/utils/send-message-draft-effect.ts`, `tests/bot/utils/send-message-draft-effect.test.ts`
- Improved assistant draft streaming so large text snapshots are revealed progressively instead of being pushed to Telegram as one full fragment per SSE update.
  - Why: upstream stream updates can be chunked coarsely, and sending each snapshot wholesale looked like pseudo-streaming rather than a live draft.
  - Affects: `src/bot/index.ts`, `src/bot/utils/message-draft-stream.ts`, `tests/bot/utils/message-draft-stream.test.ts`, `docs/architecture.md`
- Fixed assistant final answer ordering in reasoning mode: final answer is now sent last after reasoning updates, ensuring the final response appears as the last message.
  - Why: upstream bug caused final answer to be delivered before reasoning updates completed, making the final answer appear earlier in the chat history.
  - Affects: `src/bot/index.ts`, `src/bot/handlers/prompt.ts`, `src/bot/utils/assistant-run-state.ts`, `src/bot/utils/finalize-assistant-response.ts`, `src/bot/utils/assistant-run-footer.ts`, `tests/bot/index.local-file-follow-up.test.ts`

### Documentation

- Updated `.env.example`, `README.md`, and `PRODUCT.md` for `/mcps`, optional OpenCode auto-restart, Google TTS configuration, topic-scoped attach/follow behavior, and current formatting behavior.
  - Why: the user-facing docs and product state should reflect the multi-user v0.17.0-based feature set that is already implemented in this branch.
  - Affects: `.env.example`, `README.md`, `PRODUCT.md`, `CHANGELOG.md`

- Added `docs/architecture.md` to keep a textual description of the full bot flow, internal layers, component interactions, and external API usage.
- Strengthened `AGENTS.md` documentation requirements so functional and architectural changes must update the textual docs.
- Linked product, architecture, and change-tracking documentation more explicitly for future updates.
- Updated the architecture notes for prompt streaming so the assistant draft flow and thinking-indicator draft effect explicitly document their shared draft-id contract.
- Added `docs/qwen3-emb-api.md` with official-source notes for the local Ollama `qwen3-embedding:8b` setup, including embedding endpoints, request fields, and Qwen-specific retrieval guidance.
  - Why: the planned `tg-cli` retrieval layer needs a stable local embedding reference before implementing FTS5, semantic indexing, and RAG over Telegram exports.
  - Affects: `docs/qwen3-emb-api.md`, local Ollama integration planning, future `tg-cli` embedding client work
- Added `docs/Embedding-analyze-plan.md` and expanded `PRODUCT.md` with a development plan for Telegram export classification, selective media export, text cleanup, chunking, FTS5, and hybrid RAG.
  - Why: the `tg-cli` roadmap now includes a much broader export and retrieval data plane that needs a documented implementation sequence and scope before code changes start.
  - Affects: `docs/Embedding-analyze-plan.md`, `PRODUCT.md`, future `tg-cli` export/indexing/RAG modules
- Added `docs/tg-cli-clean-architecture-plan.md` and linked it from the main documentation set and roadmap.
  - Why: `tg-cli` currently centers too much orchestration in CLI, Telegram, and SQLite modules, so the export/indexing/RAG roadmap needs explicit clean-architecture boundaries before implementation expands the codebase.
  - Affects: `docs/tg-cli-clean-architecture-plan.md`, `docs/architecture.md`, `PRODUCT.md`, future `tg-cli` refactoring and module layout
- Added `docs/tg-cli-iteration-1-plan.md` with concrete first-slice tasks, DTO sketches, port sketches, and migration order for the initial `tg-cli` clean-architecture refactor.
  - Why: the architecture plan needed an execution-ready first iteration so sync/search/export behavior can be moved behind use cases before new export and retrieval features are added.
  - Affects: `docs/tg-cli-iteration-1-plan.md`, `docs/tg-cli-clean-architecture-plan.md`, `PRODUCT.md`, future `tg-cli` application/adapter split
- Started the first `tg-cli` clean-architecture refactor by adding application DTOs, ports, and use cases plus Telethon/SQLite/export adapters, then routing core `chats`, `info`, `history`, `sync`, `sync-all`, `refresh`, `search`, `recent`, and `export` flows through those seams.
  - Why: export, indexing, and RAG features need stable application and adapter boundaries before the current CLI and storage modules accumulate more orchestration logic.
  - Affects: `tg-cli/src/tg_cli/application/*`, `tg-cli/src/tg_cli/adapters/*`, `tg-cli/src/tg_cli/cli/tg.py`, `tg-cli/src/tg_cli/cli/query.py`, `tg-cli/src/tg_cli/cli/data.py`, `tg-cli/src/tg_cli/cli/_sync.py`, `docs/tg-cli-clean-architecture-plan.md`
- Replaced the localized `bot.thinking` placeholder with raw reasoning text from OpenCode when `message.part.updated` reasoning events include text.
  - Why: the CLI already exposes reasoning text, but Telegram users only saw the placeholder message, so the bot now forwards the actual reasoning content instead of discarding it in the summary pipeline.
  - Affects: `src/summary/aggregator.ts`, `src/bot/index.ts`, `tests/summary/aggregator.test.ts`, `PRODUCT.md`, `docs/architecture.md`, `README.md`
- Formatted reasoning service messages as HTML with a visible `💭 Думаю...` prefix and an expandable Telegram blockquote, while keeping raw and HTML service messages separated inside the batcher.
  - Why: reasoning text should stay visually distinct and collapsible in Telegram without being merged into plain-text service message batches.
  - Affects: `src/bot/utils/reasoning-format.ts`, `src/bot/utils/telegram-text.ts`, `src/summary/tool-message-batcher.ts`, `src/bot/index.ts`, `tests/bot/utils/reasoning-format.test.ts`, `tests/bot/utils/telegram-text.test.ts`, `tests/summary/tool-message-batcher.test.ts`, `PRODUCT.md`, `docs/architecture.md`, `README.md`
- Switched reasoning formatting to a line-by-line parser so repeated headings are preserved as HTML headings and HTML reasoning drafts stream as progressively parsed blockquote frames.
  - Why: multi-heading reasoning blocks were only formatting the first heading correctly, and reasoning drafts should appear parsed from the start instead of flashing plain-text placeholders first.
  - Affects: `src/bot/utils/reasoning-format.ts`, `src/bot/utils/send-message-draft-effect.ts`, `src/bot/index.ts`, `tests/bot/utils/reasoning-format.test.ts`, `tests/bot/utils/send-message-draft-effect.test.ts`

## [0.19.1] — Port from upstream v0.19.0→v0.19.1

### Added

- Added `task.run.error.interactive_question` and `task.run.error.interactive_permission` i18n keys to all 6 locales (en, ru, de, es, fr, zh) for localized scheduled-task interactive-failure messages.
  - Why: scheduled tasks that hit interactive questions/permissions need user-facing localization so recipients see a meaningful reason instead of a generic error.
  - Affects: `src/i18n/*.ts`
- Added `executeScheduledTask` interactive request detection and rejection for unattended scheduled tasks: the polling loop now checks for pending questions/permissions each cycle via `opencodeClient.question.list` and `opencodeClient.permission.list`, rejects them, aborts the session, and reports a localized failure with the same error-handling path as other task failures.
  - Why: an unattended scheduled task that pauses for user input will stall indefinitely; the executor should detect this, clean up, and report a clear error.
  - Affects: `src/scheduled-task/executor.ts`, `tests/scheduled-task/executor.test.ts`
- Added empty completed assistant response re-reading with diagnostics and session retention: the executor now re-reads a completed but empty assistant reply up to 3 times (500ms apart) before giving up, logs diagnostic details (task/session/directory, part structure), and keeps the temporary session for manual inspection.
  - Why: OpenCode may update the session asynchronously after the first `completed` marker, so the executor should tolerate a brief propagation delay and preserve evidence when the result genuinely does not arrive.
  - Affects: `src/scheduled-task/executor.ts`, `tests/scheduled-task/executor.test.ts`
- Added summary-message filtering in `findLatestAssistantMessage` so technical assistant messages with `.info.summary` are ignored when looking for the scheduled task's final reply.
  - Why: OpenCode may emit summary assistant messages alongside the real result; treating a summary as the final answer would produce an empty response.
  - Affects: `src/scheduled-task/executor.ts`, `tests/scheduled-task/executor.test.ts`
- Added `SCHEDULED_TASK_AGENT` as a named export from `executor.ts` for reuse in the runtime layer.
  - Why: the runtime delivery path needs the same agent constant to build the assistant run footer.
  - Affects: `src/scheduled-task/executor.ts`, `tests/scheduled-task/runtime.test.ts`
- Added `footerText` to `QueuedScheduledTaskDelivery` and wired `formatAssistantRunFooter` into `buildSuccessDelivery` with elapsed-time calculation, so each successful scheduled task delivery includes a footer showing the agent, model, and duration. The footer is sent as a separate silent message, and the main delivery is sent with `disable_notification: true` to avoid duplicate Telegram notifications.
  - Why: users need to see which model handled the task and how long it took, but the notification noise should be minimised by keeping the footer silent.
  - Affects: `src/scheduled-task/types.ts`, `src/scheduled-task/runtime.ts`, `tests/scheduled-task/runtime.test.ts`
- Added stale directory pruning to `runSync` during forced cache synchronisation: when `options.force` is true or `lastSyncedUpdatedAt` is zero, the sync now removes directory entries from the cache that are no longer present in the server's session list (unless the response was truncated at `INITIAL_WARMUP_LIMIT`). Adds `seenDirectories` tracking and a prune-count log entry.
  - Why: after project deletion or reorganisation, stale directories could persist in the cache indefinitely and show deleted projects in the project picker.
  - Affects: `src/session/cache-manager.ts`, `tests/session/cache-manager.test.ts`
- Added file-based logging with installed-mode date rotation: `getLogFilePathForMode`, `rotateInstalledLogIfNeeded`, `cleanupOldLogsInBackground` and background cleanup promise. The logger now persists to dated log files in `{appHome}/logs/` when runtime mode is `installed`, rotates at UTC midnight, and prunes files older than `LOG_RETENTION` days (default 10).
  - Why: installed deployments need persistent logs that survive process restarts, with automatic rotation and retention so disk usage does not grow unbounded.
  - Affects: `src/utils/logger.ts`, `tests/utils/logger.test.ts`

### Changed

- Changed `handleProjectSelect` to check whether the callback data is a project selection or page navigation **before** the `isForegroundBusy()` guard, so unrelated callbacks (permission, question) return `false` early instead of being consumed as "busy".
  - Why: permission and question inline callbacks could be silently dropped when a project menu was open and the foreground session was busy, leaving the user's choice unprocessed.
  - Affects: `src/bot/commands/projects.ts`, `tests/bot/commands/projects.handle-project-select.test.ts`
- Changed `formatTaskDetails` in the tasklist command to include the task's model info (`providerID/modelID (variant)`) on a separate line after the project path.
  - Why: task details should show which model the task will run on, matching the information available at creation time.
  - Affects: `src/bot/commands/tasklist.ts`, `tests/bot/commands/tasklist.test.ts`
- Changed `executeScheduledTask` from `session.prompt()` to `session.promptAsync()` to align with the upstream v0.19.1 API and avoid blocking on the synchronous prompt response.
  - Why: the synchronous prompt endpoint could outlive the executor's timeout; `promptAsync` starts the run and returns immediately, letting the poll loop and timeout work correctly.
  - Affects: `src/scheduled-task/executor.ts`
- Changed the temporary-session cleanup in `executeScheduledTask` to keep the session when a `ScheduledTaskEmptyAssistantResponseError` is caught, so engineers can inspect it manually.
  - Why: losing the session after an empty response makes post-mortem debugging impossible.
  - Affects: `src/scheduled-task/executor.ts`

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Fixed `buildListParams` to use `getScopeCacheData()` after accepting an optional `options` parameter, preserving scope isolation for the cache.
  - Why: the previous refactor lost the `cacheData` reference needed for the watermark check.
  - Affects: `src/session/cache-manager.ts`

- Added `/model`, `/variant`, and `/settings` commands for user-scoped defaults, direct model/variant updates, language selection, and message visibility preferences.
- Added topic-scoped session attach/follow behavior for multi-user and forum-thread workflows, keeping attached-session restores, follow-up routing, and startup pinned status isolated per private chat or Telegram topic.
  - Why: one shared global route caused attached-session events and pinned state to bleed across users or topics, which made concurrent remote work hard to trust.
  - Affects: `src/attach/*`, `src/thread/*`, `src/pinned/manager.ts`, `src/bot/index.ts`, `tests/attach/*.test.ts`, `tests/pinned/manager.test.ts`
- Added `/mcps` for browsing configured MCP servers, their connection state, enabled/disabled status, command/url details, and connection errors from Telegram.
  - Why: users need a lightweight way to verify MCP availability remotely without opening the local OpenCode UI.
  - Affects: `src/bot/commands/mcps.ts`, `src/bot/commands/definitions.ts`, `src/i18n/*.ts`, `tests/bot/commands/mcps.test.ts`, `README.md`, `PRODUCT.md`
- Added optional OpenCode server monitoring with automatic restart controlled by `OPENCODE_AUTO_RESTART_ENABLED` and `OPENCODE_MONITOR_INTERVAL_SEC`.
  - Why: remote users need the managed local OpenCode server to recover from stop/crash events without manual access to the host machine.
  - Affects: `src/opencode/auto-restart.ts`, `src/app/start-bot-app.ts`, `src/config.ts`, `tests/opencode/auto-restart.test.ts`, `tests/runtime/start-bot-app.test.ts`, `.env.example`, `README.md`, `PRODUCT.md`
- Added Google Cloud TTS as an alternative `/tts` provider via `TTS_PROVIDER=google` and `GOOGLE_APPLICATION_CREDENTIALS`, alongside provider-specific default voices.
  - Why: some deployments need local service-account based speech synthesis instead of OpenAI-compatible API credentials.
  - Affects: `src/config.ts`, `src/tts/client.ts`, `tests/config.test.ts`, `tests/tts/client.test.ts`, `.env.example`, `README.md`, `PRODUCT.md`

- Added an automated Docker OpenCode refresh workflow through `docker/update-opencode.sh`, including upstream fetch, local tenant/image rebuilds, version reporting, and Docker test reruns.
  - Why: updating the Dockerized OpenCode runtime should be reproducible from one documented entrypoint instead of requiring manual rebuild sequencing.
  - Affects: `docker/update-opencode.sh`, `docker/README.md`, `docker/README-ru.md`
- Added a real architecture map in `docs/architecture.md` with concrete runtime entrypoints, managers, handlers, scheduled-task modules, and API integration paths.
  - Why: the project now requires not just feature lists, but also explicit documentation of how modules, managers, and external APIs interact.
  - Affects: `docs/architecture.md`, `src/app/start-bot-app.ts`, `src/bot/index.ts`, `src/opencode/events.ts`, `src/summary/aggregator.ts`, `src/scheduled-task/runtime.ts`
- Added a local `openai-media-transcriber` project skill that targets the Gemini CLI OpenAI-compatible server on `http://localhost:8124` and reads its auth token from `~/.gemini/.env` when no explicit override is provided.
  - Why: this workspace already runs a local Gemini CLI media API, so `opencode` should reuse the same secure media upload and transcription path without duplicating secrets into the project.
  - Affects: `skills/openai-media-transcriber/SKILL.md`, `skills/openai-media-transcriber/scripts/*`, `tests/skills/openai-media-transcriber/media-client.test.mjs`
- Added a Docker-bundled `openai-media-transcriber` skill that is materialized into each tenant's `/state/skills` and routed through a root-owned local proxy instead of exposing the upstream Gemini media endpoint or API key to tenant-visible config.
  - Why: Docker tenants need immediate media transcription support, but the Gemini CLI API credentials at `192.168.2.166:8124/v1` must stay outside the tenant-visible workspace and OpenCode config.
  - Affects: `docker/skills/openai-media-transcriber/SKILL.md`, `docker/bin/opencode-gemini-media`, `docker/bin/gemini-media-proxy.mjs`, `docker/bin/docker-entrypoint.sh`, `docker/Dockerfile`, `docker/run-opencode-serve.sh`, `docker/tests/*.sh`
- Added Docker tenant OpenSSH client support with workspace-backed SSH home behavior under `/workspace/.ssh`.
  - Why: tenant sessions need standard `ssh` tooling and persistent per-workspace key storage so in-container clones, fetches, and remote access flows can reuse generated keys without exposing host-level SSH state.
  - Affects: `docker/Dockerfile`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tenant-entrypoint-permissions.test.sh`, `docker/tests/tg-cli-image.test.sh`, `docker/README.md`, `docker/README-ru.md`
- Added a tenant-local Python bootstrap flow for Docker runtimes that creates and repairs `/workspace/.venvs/default`, routes tenant `python`/`pip` commands there, and keeps installed packages persistent in the tenant workspace across container restarts.
  - Why: Docker tenants were hitting blocked system `pip` flows and missing `python3-venv`, which made ad-hoc Python package installation unreliable and often impossible to repair remotely.
  - Affects: `docker/Dockerfile`, `docker/bin/ensure-tenant-python-env.sh`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tg-cli-image.test.sh`, `docker/tests/tenant-python-env.test.sh`, `docker/update-opencode.sh`, `docker/README.md`, `docker/README-ru.md`

### Added

- Added scope-keyed path reference storage with `clearScopeOpenPathIndex`, `encodeScopedPathReference`, `decodeScopedPathReference` in `src/bot/runtime/scope-open-state.ts` for topic-isolated file browser state.
  - Why: a shared module-level path index caused one topic's open-file-browser callback data to invalidate another topic's callbacks.
  - Affects: `src/bot/runtime/scope-open-state.ts`, `tests/bot/runtime/scope-open-state.test.ts`
- Added user-visible change for /open command: each topic's file browser now uses its own scope-keyed path index so clearing or navigating in one topic does not break another topic's pending callback buttons.
  - Why: concurrent file browser sessions in different forum topics need independent state.
  - Affects: `src/bot/commands/open.ts`, `tests/bot/commands/open.test.ts`

### Changed

- Changed session/project switch cleanup from global `summaryAggregator.clear()` to scope-scoped `clearScopedSessionRuntime()` so switching sessions or projects in one topic does not reset summary state for another topic.
  - Why: `summaryAggregator.clear()` was global and could discard summary data for active sessions in other topics.
  - Affects: `src/bot/utils/switch-project.ts`, `src/bot/commands/sessions.ts`, `src/bot/commands/new.ts`, `src/bot/commands/projects.ts`, `tests/bot/utils/switch-project.test.ts`, `tests/bot/commands/sessions.test.ts`, `tests/bot/commands/new.test.ts`, `tests/bot/commands/projects.handle-project-select.test.ts`
- Changed forum subagent delivery to route each child session through a dedicated per-user topic when available, keep child-session final answers silent in that topic, delete the topic only after the final child answer is actually delivered and the configured timeout elapses, and preserve `/projects` selections as user defaults across new topics.
  - Why: forum subagents need isolated child-session output that does not leak across users or topics, topic cleanup must not race ahead of the final answer, and project selection should follow the same user-default model as other scoped preferences.
  - Affects: `src/bot/index.ts`, `src/bot/subagent-topics/service.ts`, `src/settings/manager.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/bot/subagent-topics/service.test.ts`, `tests/settings/manager.test.ts`, `PRODUCT.md`
- Changed assistant reply delivery to use a local Telegram MarkdownV2 formatter for user-visible `MESSAGE_FORMAT_MODE=markdown` rendering.
  - Why: Telegram MarkdownV2 is stricter than generic markdown, so a local formatter reduces broken escaping and makes streamed/final replies more predictable.
  - Affects: `src/telegram/render/*`, `src/bot/utils/assistant-rendering.ts`, `tests/telegram/render/*.test.ts`, `README.md`
- Changed TTS synthesis to strip Markdown before generating speech output.
  - Why: links, headings, and markdown markers should not be read out literally in spoken replies.
  - Affects: `src/tts/client.ts`, `tests/tts/client.test.ts`, `README.md`, `PRODUCT.md`

- Added local `ffmpeg`-based preprocessing for oversized Telegram videos and video notes up to 61 seconds, compressing them to a derivative under 19.5MB before the existing video attachment/transcription flow continues.
  - Why: Telegram videos can exceed the downloader ceiling well before they exceed the duration ceiling, so the bot needs a deterministic way to accept longer high-bitrate clips without breaking the downstream 20MB media path.
  - Affects: `src/media/video-preprocess.ts`, `src/bot/handlers/video.ts`, `src/bot/utils/file-download.ts`, `src/i18n/*.ts`, `tests/media/video-preprocess.test.ts`, `tests/bot/handlers/video.test.ts`, `PRODUCT.md`
- Persisted all incoming Telegram media under runtime-aware per-user storage and switched unsupported photo/PDF/video inputs plus unavailable audio STT flows to the local `openai-media-transcriber` scripts, forwarding extracted text together with the runtime-visible saved file path into OpenCode.
  - Why: Telegram attachments should survive beyond the immediate request, tenant containers need paths that are valid both on the host bind mount and inside `/state`, and coding-oriented text models should still be able to work from media context without manual model switching or a hard STT dependency.
  - Affects: `src/media/*`, `src/bot/handlers/photo.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/voice.ts`, `src/bot/index.ts`, `src/i18n/*.ts`, `tests/media/*.test.ts`, `tests/bot/handlers/*.test.ts`, `PRODUCT.md`, `package.json`
- Changed `/models` to render the active runtime's provider-first catalog instead of querying providers directly, while keeping the existing empty and error replies for unavailable catalogs and safely splitting oversized catalogs across multiple Telegram replies.
  - Why: the command output should match the new runtime-aware model picker so Telegram users see the same provider/model set as the current OpenCode runtime without hitting Telegram's 4096-character message limit.
  - Affects: `src/bot/commands/models.ts`, `tests/bot/commands/models.test.ts`, `PRODUCT.md`
- Upgraded branch to v0.17.0 semantic level, porting rendering pipeline, new commands (`/skills`, `/worktree`, `/open`), and runtime alignment while preserving local multi-user orchestration, threaded routing, and Docker customizations.
  - Why: align with upstream v0.17.0 features while keeping local modifications that support multi-user, approval flows, forum threading, and container lifecycle.
  - Affects: `src/telegram/render/`, `src/bot/utils/assistant-rendering.ts`, `src/bot/commands/skills.ts`, `src/bot/commands/worktree.ts`, `src/bot/commands/open.ts`, `src/opencode/process.ts`, `src/service/`, `src/bot/index.ts`, `src/i18n/*.ts`, `tests/`
- Added a Docker-only bundled `local/gemma4` model entry to the generated tenant OpenCode config.
  - Why: Docker users need the local Gemma 4 endpoint to appear in the model picker without changing the non-Docker runtime configuration.
  - Affects: `docker/run-opencode-serve.sh`, `docker/tests/run-opencode-serve.test.sh`
- Selectively aligned runtime management with upstream v0.17.0, preserving local multi-user orchestration and Docker stop/restart logic.
  - Why: upgrade to v0.17.0 semantic level requires adopting upstream runtime helpers (`opencode/process`, `service/*`) while keeping local process manager for tenant isolation and container lifecycle.
  - Affects: `src/opencode/process.ts`, `src/service/manager.ts`, `src/service/runtime.ts`, `src/service/types.ts`, `src/bot/commands/opencode-start.ts`, `src/bot/commands/opencode-stop.ts`, `src/bot/commands/status.ts`, `src/cli.ts`, `src/i18n/*.ts`, `tests/opencode/process.test.ts`, `tests/service/manager.test.ts`, `tests/bot/commands/opencode-start.test.ts`, `tests/bot/commands/opencode-stop.test.ts`, `tests/bot/commands/status.test.ts`
- Replaced the old Telegram login QR follow-up path with automatic local-file follow-ups from assistant replies, sending supported images/audio/video in their native Telegram media format and other files as documents when the referenced local file exists and is 20 MB or smaller.
  - Why: QR-specific auth delivery should be removed, while assistant replies that point to local artifacts should deliver those files asynchronously without blocking the next response.
  - Affects: `src/bot/index.ts`, `src/bot/utils/finalize-assistant-response.ts`, `src/bot/utils/telegram-local-file-follow-up.ts`, `tests/bot/utils/finalize-assistant-response.test.ts`, `tests/bot/utils/telegram-local-file-follow-up.test.ts`
- Expanded product and README documentation to reflect the real command set and current input flows, including `/stream`, `/start` reset behavior, and the current attachment support boundaries.
  - Why: the user-facing docs should match the actual runtime behavior instead of only a partial feature list.
  - Affects: `PRODUCT.md`, `README.md`, `src/bot/commands/definitions.ts`, `src/bot/commands/start.ts`, `src/bot/commands/stream.ts`, `src/bot/handlers/document.ts`
- Centralized `/start` in the shared command definitions and command registration path so Telegram commands, help text, and runtime registration all derive from the same source.
  - Why: `/start` should follow the same single-source-of-truth rule as the rest of the bot command set.
  - Affects: `src/bot/commands/definitions.ts`, `src/bot/index.ts`, `src/i18n/en.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/ru.ts`, `src/i18n/zh.ts`
- Replaced the single-user Telegram auth setting with admin + allowlist parsing, while keeping legacy `TELEGRAM_ALLOWED_USER_ID` as a compatibility fallback.
  - Why: Phase 2 of the multi-user plan needs controlled onboarding for multiple bot users without breaking existing installations.
  - Affects: `src/config.ts`, `src/runtime/bootstrap.ts`, `src/bot/middleware/auth.ts`, `src/bot/index.ts`, `.env.example`, `README.md`
- Switched the Docker tg-cli build helper to default to the in-repo `docker/tg-cli` tree instead of the old external checkout path.
  - Why: tg-cli now lives alongside the bot project, so the image build should vendor the relocated source without extra environment overrides.
  - Affects: `docker/build-opencode-tg-image.sh`, `docker/README.md`, `docker/README-ru.md`
- Changed the Docker entrypoint to start OpenCode as an unprivileged uid/gid `1000` tenant process after bootstrapping root-only runtime helpers.
  - Why: tenant-visible skills now depend on a root-owned local proxy for secure Gemini media access, so the OpenCode process must not retain read access to the proxy config file that contains upstream credentials.
  - Affects: `docker/bin/docker-entrypoint.sh`, `docker/Dockerfile`, `docker/tests/gemini-media-image.test.sh`
- Extended `/restart` so the admin restart cascades through all saved isolated tenant runtimes before the main bot process restarts.
  - Why: admin restarts should refresh every tenant container as part of the same control action, instead of leaving isolated runtimes stale.
  - Affects: `src/bot/commands/restart.ts`, `src/process/manager.ts`, `src/process/types.ts`, `tests/bot/commands/restart.test.ts`, `tests/process/manager.test.ts`
- Fixed the tg-cli Docker wrapper to use the actual tg-cli env/config model instead of passing an unsupported `--config` flag.
  - Why: the tenant containers had tg-cli installed, but the wrapper invoked it with a flag that this build does not accept, so auth commands failed immediately.
  - Affects: `docker/bin/tg-cli-wrapper.sh`, `docker/skills/tg-cli/SKILL.md`, `docker/tests/tg-cli-path.test.sh`, `docker/README.md`, `docker/README-ru.md`
- Scoped scheduled-task visibility and deferred delivery by task owner so background results return to the correct Telegram user or forum topic.
  - Why: scheduled tasks were still shared globally, which would leak task lists and background notifications across users.
  - Affects: `src/bot/commands/task.ts`, `src/scheduled-task/store.ts`, `src/scheduled-task/runtime.ts`, `src/scheduled-task/types.ts`, `tests/scheduled-task/*.test.ts`
- Added Telegram `video` and `video_note` prompt handling for clips up to 60 seconds, forwarding them as video attachments when the selected model supports video input.
  - Why: photo attachments already worked, and short Telegram videos should follow the same direct multimodal prompt flow instead of being ignored.
  - Affects: `src/bot/index.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/prompt.ts`, `src/model/capabilities.ts`, `src/i18n/*.ts`, `tests/bot/handlers/video.test.ts`, `README.md`, `PRODUCT.md`, `docs/architecture.md`
- Added automatic media-model fallback to `google/gemini-3-flash-preview` for image, video, and PDF prompts when the currently selected model lacks the required multimodal input support.
  - Why: media attachments should keep working without forcing the user to manually switch away from a coding-focused text model before every photo, video, or PDF prompt.
  - Affects: `src/bot/index.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/prompt.ts`, `src/model/media-fallback.ts`, `src/i18n/*.ts`, `tests/model/media-fallback.test.ts`, `tests/bot/handlers/document.test.ts`, `tests/bot/handlers/video.test.ts`, `README.md`, `PRODUCT.md`, `docs/architecture.md`
- Integrated v0.17.0 assistant renderer (`prepareAssistantStreamingPayload`, `prepareAssistantFinalStreamingPayload`, `renderAssistantFinalPartsSafe`) into local bot delivery paths while preserving all existing local routing semantics and invariants.
  - Why: upgrade to v0.17.0 semantic level requires adopting the new assistant rendering pipeline for consistent markdown formatting and streaming payload preparation across both streaming and final delivery paths.
  - Affects: `src/bot/index.ts`, `src/bot/utils/assistant-rendering.ts`, `tests/bot/index.local-file-follow-up.test.ts`

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Fixed Telegram assistant delivery ordering and resilience so durable assistant outputs now follow OpenCode event timing, active thinking and final reasoning survive Telegram `429 retry_after` without crashing the bot, long thinking HTML is chunked safely, and ordered lists stay readable instead of collapsing into repeated `1.` items.
  - Why: assistant replies, tool/subagent publications, and session footers could race each other, long/active thinking updates could break on Telegram limits or parse edges, ordered lists could render incorrectly in Telegram, and unhandled Telegram delivery failures could terminate the bot process.
  - Affects: `src/bot/index.ts`, `src/bot/delivery/*`, `src/bot/utils/thinking-block-stream.ts`, `src/bot/utils/thinking-draft-lifecycle.ts`, `src/bot/utils/telegram-html-chunker.ts`, `src/bot/utils/reasoning-format.ts`, `src/summary/aggregator.ts`, `src/bot/assistant-run-state.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/bot/delivery/*.test.ts`, `tests/bot/utils/*.test.ts`, `tests/summary/aggregator.test.ts`
- Fixed user-scoped defaults from `/model`, `/variant`, and `/settings` so selected agent/model/variant and message visibility preferences override `.env` defaults for new sessions in the same user's new topics.
  - Why: only locale was effectively user-scoped; model/variant still fell back to `OPENCODE_MODEL_PROVIDER`/`OPENCODE_MODEL_ID`, and global hide-message env flags could not be turned off per user.
  - Affects: `src/settings/manager.ts`, `src/bot/index.ts`, `tests/settings/manager.test.ts`
- Fixed automatic local-file follow-ups for Docker tenant users so assistant-mentioned host paths are ignored before filesystem checks, while container-visible `/workspace/...` and `/state/...` paths still resolve to the user's own Workspaces tenant directory.
  - Why: a non-admin user could ask the assistant to mention an arbitrary host absolute path and the bot could send that file if it existed and was under the size limit.
  - Affects: `src/bot/index.ts`, `src/bot/utils/telegram-local-file-follow-up.ts`, `tests/bot/index.local-file-follow-up.test.ts`
- Fixed incoming media prompts so saved file paths are always included in OpenCode context for photos, PDFs, videos, text documents, voice/audio, attachment mode, text fallback mode, and post-save transcription failures.
  - Why: Telegram-uploaded files must remain addressable by path inside the active OpenCode session even when transcription succeeds, returns empty text, or fails after the file has been saved.
  - Affects: `src/media/ingest.ts`, `src/bot/handlers/voice.ts`, `tests/media/ingest.test.ts`, `tests/bot/handlers/voice.test.ts`
- Fixed interactive Telegram prompt dispatch to use OpenCode's async prompt endpoint instead of waiting on the synchronous prompt response behind a local 60-second timeout.
  - Why: long-running coding tasks could be accepted by OpenCode but still be reported as failed by the bot after the local timeout expired.
  - Affects: `src/bot/handlers/prompt.ts`, `src/bot/index.ts`, `tests/bot/handlers/prompt-deferred-follow-up.test.ts`
- Fixed `/opencode_start` and `/opencode_stop` access control so they are available to all users while `/restart` remains admin-only.
  - Why: the OpenCode runtime commands manage the per-user server and should not be blocked by the bot admin gate; only the host restart action should stay restricted.
  - Affects: `src/bot/commands/definitions.ts`, `src/bot/commands/opencode-start.ts`, `src/bot/commands/opencode-stop.ts`, `tests/bot/commands/opencode-start.test.ts`, `tests/bot/commands/opencode-stop.test.ts`, `tests/bot/utils/command-sync.test.ts`
- Fixed forum main-thread reply-keyboard behavior so the bottom keyboard stays manually hideable, is reattached consistently on later bot replies, keeps reply-keyboard-triggered actions in the forum main thread instead of opening a new topic, and preserves topic-local `agent`/`model`/`variant` isolation.
  - Why: the earlier flow mixed a persistent keyboard with incomplete forum main-thread routing, which made Telegram's native hide control unreliable and could route main-thread menu actions into a new topic instead of the current scope.
  - Affects: `src/bot/utils/keyboard.ts`, `src/bot/utils/message-thread.ts`, `src/bot/handlers/inline-menu.ts`, `src/bot/commands/start.ts`, `src/bot/commands/status.ts`, `tests/bot/utils/keyboard.test.ts`, `tests/bot/utils/message-thread.test.ts`, `tests/bot/handlers/inline-menu.test.ts`, `tests/bot/handlers/agent.test.ts`, `tests/bot/handlers/model.test.ts`, `tests/bot/handlers/variant.test.ts`, `tests/settings/manager.test.ts`
- Fixed duplicate or misleading subagent/tool-call presentation so repeated completion updates and overlapping tool-call streams do not spam Telegram with stale or duplicate progress summaries.
  - Why: concurrent subagent and tool activity could produce repeated completion lines or visually overlapping tool-call updates, making live progress harder to follow.
  - Affects: `src/summary/aggregator.ts`, `src/bot/streaming/tool-call-streamer.ts`, `tests/summary/aggregator.test.ts`, `tests/bot/streaming/tool-call-streamer.test.ts`
- Fixed scoped external-input and busy-state routing so attached-session input suppression and foreground busy tracking stay isolated to the same chat/topic scope.
  - Why: concurrent users or forum topics must not inherit each other's external-input notices or "bot is busy" protection state.
  - Affects: `src/bot/index.ts`, `src/scheduled-task/foreground-state.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/scheduled-task/foreground-state.test.ts`
- Fixed Docker tenant `opencode serve` project/session API failures after the upstream OpenCode refresh by preparing `.gitignore` in the host-side mounted config directory before launching the container.
  - Why: the refreshed OpenCode bootstrap now ensures `OPENCODE_CONFIG_DIR/.gitignore` exists, but the tenant launcher mounts that directory into the container as read-only, causing 500 `UnknownError` responses from `/project` and `/session` when the file was missing.
  - Affects: `docker/run-opencode-serve.sh`, `docker/tests/run-opencode-serve.test.sh`
- Unified deferred Telegram batching across text, forwarded messages, and media preprocessing, so large bursts now stay in a single OpenCode follow-up chunk while media is still downloading/transcribing.
  - Why: large forwarded batches with photos, videos, voice notes, and documents could split into multiple OpenCode prompts because media handlers finished after the silence timer expired, and deferred chunk items did not all carry stable sender/forward metadata.
  - Affects: `src/bot/incoming-media-batch.ts`, `src/bot/index.ts`, `src/bot/handlers/photo.ts`, `src/bot/handlers/document.ts`, `src/bot/handlers/video.ts`, `src/bot/handlers/voice.ts`, `src/media/batch-types.ts`, `src/media/prompt-composer.ts`, `tests/bot/incoming-media-batch.test.ts`, `tests/media/prompt-composer.test.ts`
- Fixed video attachment mode to transcribe audio before sending the video to OpenCode, so the user's spoken question is included in the prompt when the selected model supports video input and attachments.
  - Why: when the model supports video input, the bot previously sent the video file without transcribing its audio track, losing the user's spoken content.
  - Affects: `src/media/ingest.ts`, `tests/media/ingest.test.ts`
- Fixed rootless Docker tenant startup after recreating a user's workspace/state directory by changing the container entrypoint to keep bind-mounted `/workspace` and `/state` writable, while dropping runtime capabilities and moving the Gemini media proxy onto its own unreadable service uid.
  - Why: after deleting a tenant directory and letting the bot bootstrap it again, `opencode serve` could fail on first start with `EACCES` under `/state/cache/opencode` because rootless Docker mapped host-owned bind mounts in a way that broke writes from the previous unprivileged uid/gid 1000 runtime, and the initial runtime fix still needed a stronger process boundary around the proxy secret.
  - Affects: `docker/Dockerfile`, `docker/bin/docker-entrypoint.sh`, `docker/tests/tenant-entrypoint-permissions.test.sh`, `docker/tests/gemini-media-image.test.sh`
- Restored the blue Telegram slash-command button for already approved non-admin users after bot restarts by re-syncing their private-chat command scopes on startup and immediately after admin approval.
  - Why: the bot clears global command scopes on startup, but approved users only got chat-scoped commands back after sending a new update, so the `/status`-style command button disappeared until they wrote to the bot again.
  - Affects: `src/bot/index.ts`, `src/bot/middleware/auth.ts`, `tests/bot/index.callback-routing.test.ts`, `tests/bot/middleware/auth.test.ts`
- Reworked Telegram reasoning delivery so the active thinking block lives in a draft lifecycle, each completed reasoning block is published as its own normal chat message, and route-loss cleanup now deletes stale drafts only through the route that originally owned them.
  - Why: reasoning should stream as one active draft per block without overwriting completed blocks, and route switches during cleanup must not delete unrelated messages in another chat or thread.
  - Affects: `src/bot/index.ts`, `src/bot/utils/thinking-block-stream.ts`, `src/bot/utils/thinking-draft-lifecycle.ts`, `tests/bot/utils/thinking-block-stream.test.ts`, `tests/bot/utils/thinking-draft-lifecycle.test.ts`, `tests/bot/index.local-file-follow-up.test.ts`
- Restored Telegram `<blockquote expandable>` formatting for reasoning and thinking traces, and kept long reasoning/draft/stream splits wrapped in valid expandable blockquotes across multi-message delivery.
  - Why: recent local changes downgraded collapsible reasoning quotes to plain blockquotes, and long-message paths could drop or break the expandable wrapper while chunking HTML for Telegram.
  - Affects: `src/bot/utils/reasoning-format.ts`, `src/bot/utils/send-message-draft-effect.ts`, `src/bot/streaming/tool-call-streamer.ts`, `tests/bot/utils/reasoning-format.test.ts`, `tests/bot/utils/send-message-draft-effect.test.ts`, `tests/bot/streaming/tool-call-streamer.test.ts`, `CHANGELOG.md`
- Synced Telegram forum topic names with the selected OpenCode session title when switching sessions via `/sessions`, and kept long-running forum threads aligned with the active session context.
  - Why: in forum workflows the thread title could drift away from the bound OpenCode session, which made session switching harder to follow from Telegram alone.
  - Affects: `src/bot/commands/sessions.ts`, `tests/bot/commands/sessions.test.ts`
- Stopped streamed assistant drafts, reasoning updates, and oversized final HTML replies from overwriting previously delivered text when the content changed shape or crossed Telegram's 4096-character limit.
  - Why: the draft stream edited the last Telegram message too aggressively, so new reasoning blocks and long continuations could replace earlier text instead of continuing in a new message.
  - Affects: `src/bot/utils/message-draft-stream.ts`, `src/bot/utils/finalize-assistant-response.ts`, `tests/bot/utils/message-draft-stream.test.ts`, `tests/bot/utils/finalize-assistant-response.test.ts`
- Moved streamed reasoning details into the dedicated `bot.thinking` message and removed the duplicate reasoning quote from the final assistant reply.
  - Why: Telegram users should see `Думаю...` as the explicit thinking marker, with the expandable reasoning trace attached there instead of being repeated at the end of the final answer.
  - Affects: `src/bot/index.ts`, `src/bot/utils/thinking-message.ts`, `tests/bot/utils/thinking-message.test.ts`
- Stopped final assistant delivery from waiting on QR-specific follow-up sending by preparing local-file follow-ups during finalization and dispatching them in the background after the text reply is sent.
  - Why: follow-up media must not block the main assistant response or queue later replies behind attachment delivery.
  - Affects: `src/bot/index.ts`, `src/bot/utils/finalize-assistant-response.ts`, `tests/bot/utils/finalize-assistant-response.test.ts`
- Kept thinking messages visible by default instead of deleting them on assistant completion, so the explicit clear-thinking command now controls whether they are removed.
  - Why: thinking output should remain available unless the user explicitly enables clearing it.
  - Affects: `src/settings/manager.ts`, `src/bot/index.ts`, `src/bot/commands/clear-mode.ts`, `src/bot/utils/thinking-message-lifecycle.ts`, `tests/bot/utils/thinking-message-lifecycle.test.ts`, `tests/bot/commands/clear-mode.test.ts`, `tests/settings/manager.test.ts`
- Kept final assistant replies locked to the thread where the prompt started, instead of falling back to the currently active chat when the session finishes later.
  - Why: late SSE completion could reuse the active main-chat context and send the final answer outside the originating topic thread.
  - Affects: `src/bot/index.ts`, `src/thread/manager.ts`, `tests/thread/manager.test.ts`
- Streamed reasoning previews inside the expandable quote immediately instead of showing the quote only after the reasoning stream finished.
  - Why: Telegram users should see the thinking text appear inside the final quote structure from the start, not watch it move into the quote only after completion.
  - Affects: `src/bot/index.ts`, `src/bot/utils/message-draft-stream.ts`, `tests/bot/utils/message-draft-stream.test.ts`, `PRODUCT.md`, `docs/architecture.md`
- Fixed private-chat command sync so the bot now restores Telegram's command menu button together with `setMyCommands`.
  - Why: Telegram persists `setChatMenuButton` separately, so commands could still exist on the API side while the chat menu button and `/` suggestions stayed hidden in the client.
  - Affects: `src/bot/index.ts`, `src/bot/middleware/auth.ts`, `src/bot/utils/command-sync.ts`, `tests/bot/middleware/auth.test.ts`, `tests/bot/utils/command-sync.test.ts`, `README.md`, `docs/architecture.md`
- Stopped forcing the bottom reply keyboard to be persistent in private chats.
  - Why: Telegram clients can replace the command-menu affordance with the persistent keyboard toggle, which makes the menu button appear briefly after sync and then disappear again after `/start` or other keyboard updates.
  - Affects: `src/bot/utils/keyboard.ts`, `tests/bot/utils/keyboard.test.ts`, `README.md`, `docs/architecture.md`
- Stopped batched and technical service messages such as `bot.thinking`, question/permission prompts, keyboard refreshes, pinned status creation, and background error notifications from using the short `sendMessageDraft` effect.
  - Why: those draft previews could visually take over the same in-chat draft area as the live assistant stream, leaving the user with only `Думаю...` instead of the streamed reply text.
  - Affects: `src/bot/index.ts`, `src/bot/commands/commands.ts`, `src/bot/handlers/permission.ts`, `src/bot/handlers/prompt.ts`, `src/bot/handlers/question.ts`, `src/bot/utils/send-message-draft-effect-context.ts`, `src/keyboard/manager.ts`, `src/pinned/manager.ts`, `tests/bot/utils/send-message-draft-effect-context.test.ts`, `docs/architecture.md`
- Fixed `sendMessageDraft` id collisions between assistant stream updates and the short draft effect used for normal bot messages such as the localized thinking indicator.
  - Why: both managers allocated draft ids independently, so a service message like `bot.thinking` could reuse the active assistant draft id and visually replace the streamed text in Telegram.
  - Affects: `src/bot/index.ts`, `src/bot/utils/message-draft-id.ts`, `src/bot/utils/message-draft-stream.ts`, `src/bot/utils/send-message-draft-effect.ts`, `tests/bot/utils/send-message-draft-effect.test.ts`
- Improved assistant draft streaming so large text snapshots are revealed progressively instead of being pushed to Telegram as one full fragment per SSE update.
  - Why: upstream stream updates can be chunked coarsely, and sending each snapshot wholesale looked like pseudo-streaming rather than a live draft.
  - Affects: `src/bot/index.ts`, `src/bot/utils/message-draft-stream.ts`, `tests/bot/utils/message-draft-stream.test.ts`, `docs/architecture.md`
- Fixed assistant final answer ordering in reasoning mode: final answer is now sent last after reasoning updates, ensuring the final response appears as the last message.
  - Why: upstream bug caused final answer to be delivered before reasoning updates completed, making the final answer appear earlier in the chat history.
  - Affects: `src/bot/index.ts`, `src/bot/handlers/prompt.ts`, `src/bot/utils/assistant-run-state.ts`, `src/bot/utils/finalize-assistant-response.ts`, `src/bot/utils/assistant-run-footer.ts`, `tests/bot/index.local-file-follow-up.test.ts`

### Documentation

- Updated `.env.example`, `README.md`, and `PRODUCT.md` for `/mcps`, optional OpenCode auto-restart, Google TTS configuration, topic-scoped attach/follow behavior, and current formatting behavior.
  - Why: the user-facing docs and product state should reflect the multi-user v0.17.0-based feature set that is already implemented in this branch.
  - Affects: `.env.example`, `README.md`, `PRODUCT.md`, `CHANGELOG.md`

- Added `docs/architecture.md` to keep a textual description of the full bot flow, internal layers, component interactions, and external API usage.
- Strengthened `AGENTS.md` documentation requirements so functional and architectural changes must update the textual docs.
- Linked product, architecture, and change-tracking documentation more explicitly for future updates.
- Updated the architecture notes for prompt streaming so the assistant draft flow and thinking-indicator draft effect explicitly document their shared draft-id contract.
- Added `docs/qwen3-emb-api.md` with official-source notes for the local Ollama `qwen3-embedding:8b` setup, including embedding endpoints, request fields, and Qwen-specific retrieval guidance.
  - Why: the planned `tg-cli` retrieval layer needs a stable local embedding reference before implementing FTS5, semantic indexing, and RAG over Telegram exports.
  - Affects: `docs/qwen3-emb-api.md`, local Ollama integration planning, future `tg-cli` embedding client work
- Added `docs/Embedding-analyze-plan.md` and expanded `PRODUCT.md` with a development plan for Telegram export classification, selective media export, text cleanup, chunking, FTS5, and hybrid RAG.
  - Why: the `tg-cli` roadmap now includes a much broader export and retrieval data plane that needs a documented implementation sequence and scope before code changes start.
  - Affects: `docs/Embedding-analyze-plan.md`, `PRODUCT.md`, future `tg-cli` export/indexing/RAG modules
- Added `docs/tg-cli-clean-architecture-plan.md` and linked it from the main documentation set and roadmap.
  - Why: `tg-cli` currently centers too much orchestration in CLI, Telegram, and SQLite modules, so the export/indexing/RAG roadmap needs explicit clean-architecture boundaries before implementation expands the codebase.
  - Affects: `docs/tg-cli-clean-architecture-plan.md`, `docs/architecture.md`, `PRODUCT.md`, future `tg-cli` refactoring and module layout
- Added `docs/tg-cli-iteration-1-plan.md` with concrete first-slice tasks, DTO sketches, port sketches, and migration order for the initial `tg-cli` clean-architecture refactor.
  - Why: the architecture plan needed an execution-ready first iteration so sync/search/export behavior can be moved behind use cases before new export and retrieval features are added.
  - Affects: `docs/tg-cli-iteration-1-plan.md`, `docs/tg-cli-clean-architecture-plan.md`, `PRODUCT.md`, future `tg-cli` application/adapter split
- Started the first `tg-cli` clean-architecture refactor by adding application DTOs, ports, and use cases plus Telethon/SQLite/export adapters, then routing core `chats`, `info`, `history`, `sync`, `sync-all`, `refresh`, `search`, `recent`, and `export` flows through those seams.
  - Why: export, indexing, and RAG features need stable application and adapter boundaries before the current CLI and storage modules accumulate more orchestration logic.
  - Affects: `tg-cli/src/tg_cli/application/*`, `tg-cli/src/tg_cli/adapters/*`, `tg-cli/src/tg_cli/cli/tg.py`, `tg-cli/src/tg_cli/cli/query.py`, `tg-cli/src/tg_cli/cli/data.py`, `tg-cli/src/tg_cli/cli/_sync.py`, `docs/tg-cli-clean-architecture-plan.md`
- Replaced the localized `bot.thinking` placeholder with raw reasoning text from OpenCode when `message.part.updated` reasoning events include text.
  - Why: the CLI already exposes reasoning text, but Telegram users only saw the placeholder message, so the bot now forwards the actual reasoning content instead of discarding it in the summary pipeline.
  - Affects: `src/summary/aggregator.ts`, `src/bot/index.ts`, `tests/summary/aggregator.test.ts`, `PRODUCT.md`, `docs/architecture.md`, `README.md`
- Formatted reasoning service messages as HTML with a visible `💭 Думаю...` prefix and an expandable Telegram blockquote, while keeping raw and HTML service messages separated inside the batcher.
  - Why: reasoning text should stay visually distinct and collapsible in Telegram without being merged into plain-text service message batches.
  - Affects: `src/bot/utils/reasoning-format.ts`, `src/bot/utils/telegram-text.ts`, `src/summary/tool-message-batcher.ts`, `src/bot/index.ts`, `tests/bot/utils/reasoning-format.test.ts`, `tests/bot/utils/telegram-text.test.ts`, `tests/summary/tool-message-batcher.test.ts`, `PRODUCT.md`, `docs/architecture.md`, `README.md`
- Switched reasoning formatting to a line-by-line parser so repeated headings are preserved as HTML headings and HTML reasoning drafts stream as progressively parsed blockquote frames.
  - Why: multi-heading reasoning blocks were only formatting the first heading correctly, and reasoning drafts should appear parsed from the start instead of flashing plain-text placeholders first.
  - Affects: `src/bot/utils/reasoning-format.ts`, `src/bot/utils/send-message-draft-effect.ts`, `src/bot/index.ts`, `tests/bot/utils/reasoning-format.test.ts`, `tests/bot/utils/send-message-draft-effect.test.ts`

## Entry Template

Use entries in this style for future changes:

```markdown
## [YYYY-MM-DD] or [Version]

### Added

- Added `<feature>` to `<user flow>`.
  - Why: `<reason>`
  - Affects: `<modules/managers/apis>`

### Changed

- Changed `<existing behavior>`.
  - Why: `<reason>`
  - Affects: `<modules/managers/apis>`

### Fixed

- **Fixed tool call notifications being dropped after the first assistant message.** When OpenCode produces multiple assistant messages in response to a single prompt (each with tool calls), only the first message's tool notifications were displayed. The `isFinalResponsePublished` guard in `setOnTool` (`src/bot/index.ts:2167`) blocked all subsequent tool callbacks because `markFinalResponsePublished` was called on every message completion, not just the final one. Removed the guard — `isSessionCurrent` already prevents stale notifications after session cleanup.
  - Why: users could only see the first `bash`/`read`/etc. command executed by the agent; all subsequent tool activity was invisible.


- Fixed `<bug or edge case>`.
  - Why: `<reason/root cause>`
  - Affects: `<modules/managers/apis>`

### Documentation

- Updated `<doc>`.
  - Why: `<reason>`
  - Affects: `<documented flow/components/apis>`
```
