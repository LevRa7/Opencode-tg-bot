# Changelog

This file tracks notable functional, architectural, and documentation changes in the project.

Documentation rule:

- record every relevant user-visible, functional, or architectural change
- describe not only what changed, but also why it changed and what flow it affects
- mention key modules, managers, or external APIs when they are part of the change

## [Unreleased]

### Added

- Added a real architecture map in `docs/architecture.md` with concrete runtime entrypoints, managers, handlers, scheduled-task modules, and API integration paths.
  - Why: the project now requires not just feature lists, but also explicit documentation of how modules, managers, and external APIs interact.
  - Affects: `docs/architecture.md`, `src/app/start-bot-app.ts`, `src/bot/index.ts`, `src/opencode/events.ts`, `src/summary/aggregator.ts`, `src/scheduled-task/runtime.ts`
- Added a local `openai-media-transcriber` project skill that targets the Gemini CLI OpenAI-compatible server on `http://localhost:8124` and reads its auth token from `~/.gemini/.env` when no explicit override is provided.
  - Why: this workspace already runs a local Gemini CLI media API, so `opencode` should reuse the same secure media upload and transcription path without duplicating secrets into the project.
  - Affects: `skills/openai-media-transcriber/SKILL.md`, `skills/openai-media-transcriber/scripts/*`, `tests/skills/openai-media-transcriber/media-client.test.mjs`
- Added a Docker-bundled `openai-media-transcriber` skill that is materialized into each tenant's `/state/skills` and routed through a root-owned local proxy instead of exposing the upstream Gemini media endpoint or API key to tenant-visible config.
  - Why: Docker tenants need immediate media transcription support, but the Gemini CLI API credentials at `192.168.2.166:8124/v1` must stay outside the tenant-visible workspace and OpenCode config.
  - Affects: `docker/skills/openai-media-transcriber/SKILL.md`, `docker/bin/opencode-gemini-media`, `docker/bin/gemini-media-proxy.mjs`, `docker/bin/docker-entrypoint.sh`, `docker/Dockerfile`, `docker/run-opencode-serve.sh`, `docker/tests/*.sh`

### Changed

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

- Fixed `<bug or edge case>`.
  - Why: `<reason/root cause>`
  - Affects: `<modules/managers/apis>`

### Documentation

- Updated `<doc>`.
  - Why: `<reason>`
  - Affects: `<documented flow/components/apis>`
```
