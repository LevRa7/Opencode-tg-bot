# Architecture

This document describes the real module structure of the bot, how runtime state is coordinated, and how Telegram, OpenCode, and optional STT APIs interact during execution.

Related docs:

- Product and user-facing functionality: [`../PRODUCT.md`](../PRODUCT.md)
- Vendored `tg-cli` clean architecture migration plan: [`./tg-cli-clean-architecture-plan.md`](./tg-cli-clean-architecture-plan.md)
- Project concept and boundaries: [`../CONCEPT.md`](../CONCEPT.md)
- Change history and documentation log: [`../CHANGELOG.md`](../CHANGELOG.md)

## System Purpose

`opencode-telegram-bot` is a Telegram client for a locally running OpenCode server. The bot receives commands and prompts from Telegram, resolves the current project and session context, forwards work to OpenCode, listens to SSE events, and returns Telegram-friendly updates back to the same chat or forum topic.

## Runtime Entry Points

Main startup files:

- `src/index.ts` - source entrypoint that selects runtime mode and starts the app
- `src/cli.ts` - CLI entrypoint for packaged usage
- `src/cli/args.ts` - CLI argument parsing
- `src/app/start-bot-app.ts` - main orchestration: load settings, initialize process state, reconcile model selection, warm session cache, start bot, start scheduled task runtime
- `src/config.ts` - typed configuration loaded from `.env`
- `src/runtime/bootstrap.ts` - first-run setup/bootstrap flow
- `src/runtime/mode.ts` and `src/runtime/paths.ts` - runtime mode detection and config path resolution

Startup sequence:

```text
src/index.ts / src/cli.ts
  -> src/app/start-bot-app.ts
  -> load settings.json and runtime config
  -> initialize process manager
  -> reconcile stored model selection
  -> warm session directory cache
  -> create Telegram bot
  -> initialize scheduled task runtime
  -> start long polling
```

## Main Module Map

### Telegram Bot Layer

Core files:

- `src/bot/index.ts` - central grammY assembly, middleware registration, command handlers, callback handlers, prompt routing, topic-aware delivery, SSE-to-Telegram wiring
- `src/bot/commands/definitions.ts` - centralized public command list used by Telegram `setMyCommands`, private-chat menu-button sync, and in-app help generation
- `src/bot/commands/*.ts` - individual command implementations
- `src/bot/handlers/*.ts` - prompt, question, permission, model, agent, variant, context, voice, document, and inline-menu handlers
- `src/bot/middleware/auth.ts` - admin/allowlist guard for Telegram users
- `src/bot/middleware/interaction-guard.ts` - blocks unrelated input during active interactive flows
- `src/bot/middleware/unknown-command.ts` - fallback for unsupported slash commands
- `src/bot/utils/message-thread.ts` - attaches `message_thread_id` for forum-topic-safe delivery
- `src/bot/utils/file-download.ts` - Telegram file download helpers and MIME checks
- `src/bot/utils/telegram-text.ts` - Telegram-safe text sending helpers
- `src/bot/utils/keyboard.ts` - bottom reply-keyboard builder for agent/model/context controls without forcing a persistent keyboard over the command menu

Main responsibility:

- translate Telegram updates into internal actions and send all resulting output back to the correct chat or topic

### State and Persistence Layer

Persistent state:

- `src/settings/manager.ts` - main `settings.json` storage for selected project, session, model, pinned message ids, thread bindings, streaming mode, and scheduled task state

Runtime state managers:

- `src/session/manager.ts` - current foreground session selection
- `src/session/cache-manager.ts` - session-to-directory and session-to-project cache for recovery and routing
- `src/project/manager.ts` - project discovery, selection, and current project lookup
- `src/project/user-project.ts` - user-specific project resolution helpers
- `src/model/manager.ts` - selected model state and reconciliation with available models
- `src/model/capabilities.ts` - checks for image and PDF input support
- `src/agent/manager.ts` - current agent mode
- `src/variant/manager.ts` - current reasoning/model variant
- `src/keyboard/manager.ts` - persistent bottom keyboard state
- `src/pinned/manager.ts` - pinned session status message lifecycle and restoration after restart
- `src/question/manager.ts` - current OpenCode question state
- `src/permission/manager.ts` - current permission request state
- `src/rename/manager.ts` - rename flow state
- `src/interaction/manager.ts`, `src/interaction/guard.ts`, `src/interaction/cleanup.ts` - generic interaction lock/cleanup system
- `src/thread/manager.ts` - chat/topic to session/project routing for Telegram forum topics
- `src/telegram/scope.ts` - `AsyncLocalStorage` scope for user/chat/thread aware execution

Main responsibility:

- keep durable and in-memory state outside Telegram handlers so message routing, sessions, questions, permissions, and scheduled operations stay consistent across long-running tasks and restarts

### OpenCode Integration Layer

Core files:

- `src/opencode/client.ts` - singleton `@opencode-ai/sdk` client with optional server auth
- `src/opencode/events.ts` - SSE subscription and reconnect logic per active OpenCode directory

Main OpenCode APIs used:

- `global.health()` - server health checks
- `project.list()` and `project.current()` - project state
- `session.list()`, `session.create()`, `session.prompt()`, `session.abort()` - session lifecycle and execution
- `event.subscribe()` - live task and interaction event stream
- `question.reply()` and `permission.reply()` - continuation of interactive task flows

### Summary and Delivery Layer

Core files:

- `src/summary/aggregator.ts` - reduces SSE events into assistant output, tool activity, file changes, token usage, question and permission prompts, retry info, and session errors
- `src/summary/formatter.ts` - Telegram-friendly formatting for final replies and service messages
- `src/summary/tool-message-batcher.ts` - batches tool/service updates to reduce chat noise

Main responsibility:

- turn low-level OpenCode events into readable Telegram updates, respecting Telegram size limits and document delivery rules

### Scheduled Tasks and Background Runtime

Core files:

- `src/bot/commands/task.ts` - interactive scheduled-task creation flow in chat
- `src/bot/commands/tasklist.ts` - scheduled-task listing and deletion flow
- `src/scheduled-task/runtime.ts` - startup recovery, timers, deferred delivery queue, foreground-session coordination
- `src/scheduled-task/executor.ts` - executes tasks in temporary OpenCode sessions using the `build` agent
- `src/scheduled-task/store.ts` - persistence helpers for scheduled tasks via `settings.json`, including owner scoping per Telegram user
- `src/scheduled-task/schedule-parser.ts` - natural-language schedule parsing
- `src/scheduled-task/next-run.ts` - next-run calculation
- `src/scheduled-task/display.ts` - Telegram formatting for scheduled task info
- `src/scheduled-task/foreground-state.ts` - prevents scheduled delivery from colliding with active foreground chat work

Main responsibility:

- let the user define deferred prompts, recover them after restart, execute them later, and deliver results safely without breaking the active chat flow
- scheduled-task ownership is stored with each task so deferred results return to the correct private chat or forum topic

### Process and External Service Layer

Core files:

- `src/process/manager.ts` - local `opencode serve` status, start, stop, and recovery
- `src/stt/client.ts` - Whisper-compatible STT client used for Telegram voice/audio messages
- `src/utils/logger.ts` - structured logging with `debug`, `info`, `warn`, `error`

## Official Bot Commands

The centralized public command list lives in `src/bot/commands/definitions.ts`.

`src/bot/index.ts` applies that list per chat for authorized users, while `src/bot/middleware/auth.ts` clears private-chat command visibility for unauthorized users. The same sync path also restores the private-chat menu button to `commands`, because Telegram persists `setChatMenuButton` state separately from the command list. The bottom reply keyboard is intentionally non-persistent so Telegram clients can still expose the command picker and `/` suggestions normally.

Current commands:

- `/start` - reset current foreground state and rebuild the welcome UI
- `/status` - report server, project, session, and model state
- `/new` - create a new foreground session
- `/abort` - stop the current foreground operation
- `/sessions` - browse and switch sessions
- `/projects` - browse and switch projects
- `/task` - create a scheduled task
- `/tasklist` - browse and delete scheduled tasks
- `/rename` - rename the current session
- `/commands` - browse and run OpenCode commands
- `/stream` - enable, disable, or inspect Telegram draft streaming for assistant replies
- `/opencode_start` - start local OpenCode server
- `/opencode_stop` - stop local OpenCode server
- `/restart` - restart the bot process with the current runtime arguments
- `/help` - show command help

`src/bot/commands/start.ts` implements the welcome/reset flow that clears foreground session state, resets thread bindings, rebuilds the keyboard, and sends the welcome message.

`src/bot/commands/restart.ts` uses `src/runtime/restart.ts` to relaunch the current Node.js process with the same entrypoint and arguments, then exits the old bot instance after a short delay so long polling reconnects without manual shell access.

## Core Interaction Flows

### Text Prompt Flow

Primary files:

- `src/bot/index.ts`
- `src/bot/handlers/prompt.ts`
- `src/opencode/events.ts`
- `src/summary/aggregator.ts`
- `src/summary/formatter.ts`

Flow:

```text
Telegram text message
  -> bot router checks auth and interaction guard
  -> prompt handler resolves topic scope, project, and session
  -> OpenCode session.prompt()
  -> SSE subscription receives task events
  -> summary aggregator collects output and tool metadata
  -> assistant text deltas stream through Telegram sendMessageDraft
  -> thinking/tool notifications use separate draft ids before final sends
  -> formatter builds Telegram response
  -> reply is sent back to the same chat/topic
```

### Question and Permission Flow

Primary files:

- `src/summary/aggregator.ts`
- `src/bot/handlers/question.ts`
- `src/bot/handlers/permission.ts`
- `src/question/manager.ts`
- `src/permission/manager.ts`
- `src/interaction/manager.ts`

Flow:

```text
OpenCode emits question.asked or permission.asked
  -> aggregator stores request state in the relevant manager
  -> bot renders inline buttons or waits for custom text answer
  -> user selects answer or sends text
  -> opencodeClient.question.reply() / permission.reply()
  -> manager clears interaction state
  -> task execution continues
```

### Voice and Audio Flow

Primary files:

- `src/bot/handlers/voice.ts`
- `src/stt/client.ts`
- `src/bot/handlers/prompt.ts`

Flow:

```text
Telegram voice or audio message
  -> bot downloads media from Telegram
  -> STT client sends media to /audio/transcriptions
  -> recognized text is shown in Telegram
  -> recognized text is forwarded into the normal prompt flow
```

### Video Flow

Primary files:

- `src/bot/handlers/video.ts`
- `src/bot/utils/file-download.ts`
- `src/bot/handlers/prompt.ts`
- `src/model/media-fallback.ts`

Flow:

```text
Telegram video or video note
  -> bot validates duration <= 60 seconds
  -> bot downloads media from Telegram
  -> video is converted to a data URI file part
  -> prompt resolver keeps the selected model or switches to google/gemini-3-flash-preview
  -> video attachment is forwarded into the normal prompt flow
```

### Attachment Flow

Primary files:

- `src/bot/index.ts` - photo handling
- `src/bot/handlers/document.ts` - document handling
- `src/bot/handlers/prompt.ts` - attachment prompt assembly and model resolution
- `src/model/media-fallback.ts` - Gemini fallback selection for unsupported media inputs

Current supported inputs:

- Telegram photos/screenshots - converted to file parts, with Gemini fallback when the selected model lacks image input
- Telegram videos/video notes up to 60 seconds - converted to file parts, with Gemini fallback when the selected model lacks video input
- PDF documents - converted to file parts, with Gemini fallback when the selected model lacks PDF input
- text-like documents - downloaded and inlined into the prompt body as UTF-8 text

Current non-goals in this path:

- arbitrary binary documents are not forwarded unless they are covered by a dedicated handler path

### Scheduled Task Flow

Primary files:

- `src/bot/commands/task.ts`
- `src/scheduled-task/runtime.ts`
- `src/scheduled-task/executor.ts`
- `src/scheduled-task/store.ts`

Flow:

```text
User creates task from Telegram
  -> creation flow parses schedule and prompt
  -> task is stored in settings.json
  -> runtime restores timers on startup
  -> executor creates temporary OpenCode session and runs prompt
  -> result is queued or delivered immediately
  -> foreground session state decides whether delivery must wait
```

### Pinned Status Flow

Primary files:

- `src/pinned/manager.ts`
- `src/summary/aggregator.ts`
- `src/session/manager.ts`

Tracked data includes:

- session title
- selected project
- selected model and variant context
- token usage / context limit
- changed files and diff-related state

### Forum Topic Routing Flow

Primary files:

- `src/thread/manager.ts`
- `src/telegram/scope.ts`
- `src/bot/utils/message-thread.ts`
- `src/bot/index.ts`

Behavior:

- each Telegram forum topic is treated as a separate interaction scope
- incoming prompts activate the topic scope before processing
- outgoing replies, questions, permissions, and errors are sent back with the same `message_thread_id`
- session and project bindings are persisted so the same topic can continue the same OpenCode context later

## Cross-Cutting Contracts

### Interaction Guarding

- only one interactive flow may be active inside the same user/topic scope at a time
- unrelated input is blocked while rename, question, permission, commands, or scheduled-task creation flows are active
- utility commands such as `/help`, `/status`, and `/abort` remain available during active flows

### Formatting and Delivery Rules

- user-facing text is localized through the i18n layer
- `message.part.updated` reasoning events are forwarded to Telegram as HTML-formatted service messages with `💭 Думаю...` plus an expandable blockquote that preserves the reasoning text
- when message streaming is enabled, the reasoning preview is drafted immediately in that HTML blockquote shape before the final service message is sent
- reasoning service messages must not overwrite the assistant draft stream because all `sendMessageDraft` callers share one draft-id allocator
- assistant draft streaming is progressive: when SSE text arrives in coarse snapshots, the bot reveals each new snapshot over several draft updates instead of jumping directly to the whole fragment
- batched and technical service messages such as reasoning text, question/permission prompts, keyboard refreshes, and background error notifications are sent without the short `sendMessageDraft` effect so they do not steal the visible draft slot from the active assistant reply stream
- large outputs are split across messages
- code or long textual artifacts may be sent as documents
- streaming mode can be toggled with `/stream on`, `/stream off`, and `/stream status`

### Persistence Rules

- durable state is stored in `settings.json`
- current foreground execution state is kept in dedicated managers
- scheduled tasks are recovered on startup
- pinned status and thread bindings are restored after restart when possible

## External APIs and Integrations

### Telegram Bot API

Used for:

- receiving updates via long polling
- sending messages, documents, and inline keyboards
- editing status and STT progress messages
- routing bot output inside forum topics
- maintaining pinned status messages

### OpenCode API

Used for:

- server health checks
- project and session management
- prompt execution and task abortion
- question and permission replies
- SSE event subscription for live execution state

### Whisper-Compatible STT API

Used only when configured.

Used for:

- transcribing Telegram voice and audio messages
- returning text that is then re-used by the normal OpenCode prompt pipeline

## Documentation Rules For Future Changes

When behavior changes, update documentation in these places as needed:

- `PRODUCT.md` for user-visible functionality and scope
- `docs/architecture.md` for file-level structure, component interactions, and API flows
- `CHANGELOG.md` for a textual record of what changed, why it changed, and what it affects

Each relevant change should document:

- what changed
- why it changed
- which modules, managers, or APIs are involved
- whether the user-facing flow changed
