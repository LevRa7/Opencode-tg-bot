# Changelog

This file tracks notable functional, architectural, and documentation changes in the project.

Documentation rule:

- record every relevant user-visible, functional, or architectural change
- describe not only what changed, but also why it changed and what flow it affects
- mention key modules, managers, or external APIs when they are part of the change

## [Unreleased]

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

- Fixed `<bug or edge case>`.
  - Why: `<reason/root cause>`
  - Affects: `<modules/managers/apis>`

### Documentation

- Updated `<doc>`.
  - Why: `<reason>`
  - Affects: `<documented flow/components/apis>`
```
