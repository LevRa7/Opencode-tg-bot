# OpenCode Telegram Bot

Telegram bot client for OpenCode that lets you run and monitor coding tasks on your local machine from Telegram.

> Project concept and boundaries are documented in [`CONCEPT.md`](./CONCEPT.md).
> Proposed changes that alter the core interaction model should be discussed before implementation.

## Concept

The app works as a bridge between Telegram and a locally running OpenCode server:

- You send prompts from Telegram
- The bot forwards them to OpenCode
- The app listens to OpenCode SSE events
- Results are aggregated and sent back in Telegram-friendly format

No public inbound ports are required for normal usage.

## Target Usage Scenario

1. The user works on a project locally with OpenCode (Desktop/TUI).
2. They finish the local session and leave the computer.
3. Later, while away, they run this bridge service and connect via Telegram.
4. They choose an existing session or create a new one.
5. They send coding tasks and receive periodic progress updates.
6. They receive completed assistant responses in chat and continue the workflow asynchronously.

## Functional Requirements

### OpenCode server management

- Check OpenCode server status (running / not running)
- Start OpenCode server from the app (`opencode serve`)
- Stop OpenCode server from the app

### Project management

- Fetch available projects from OpenCode API (name + path)
- Select and switch projects
- Persist selected project between restarts (`settings.json`)
- Reuse the user's `/projects` selection as the default project in that user's new chats or forum topics without leaking it to other users

### Session management

- Fetch last N sessions (name + date)
- Select and attach to an existing session
- Create a new session
- Use OpenCode-generated session title (based on conversation)
- When a session is selected inside a Telegram forum topic, sync the topic name with the selected session title
- Keep attached-session routing isolated per private chat or forum topic so follow-up updates, external input, and restored interactive controls return to the correct scope
- Route forum child sessions into dedicated per-user subagent topics when topic routing is enabled, keep child final answers silent in those topics, and auto-delete the topic only after the final child answer is delivered and the configured timeout expires

### Task handling

- Send text prompts to OpenCode
- Accept voice/audio messages, transcribe via Whisper-compatible STT API, and forward recognized text as prompts
- Interrupt current task (ESC equivalent)
- Handle OpenCode questions with inline options and custom text answers
- Send selected/custom answers back to OpenCode (`question.reply`)
- Handle permission requests interactively (`allow once` / `always` / `reject`)

### Result delivery

- Send each completed assistant response after completion signal from SSE
- Keep thinking output in a dedicated `Думаю...` message and stream the expandable reasoning trace there instead of repeating it in the final answer; each reasoning block is rendered as a Telegram draft while active, then published as a normal chat message when the block completes, and the next reasoning block starts a fresh draft lifecycle
- Keep live thinking updates responsive while durable assistant/tool/subagent/footer publications follow OpenCode event ordering per session
- Split long responses into multiple Telegram messages
- Split long HTML assistant replies into multiple Telegram messages without overwriting already delivered chunks
- Chunk long Telegram HTML safely so tag structure survives splitting and active thinking drafts stay within Telegram limits
- Preserve readable numbered lists in Telegram replies instead of collapsing ordered items into repeated `1.` lines
- Keep assistant-output delivery resilient to Telegram `429 retry_after` and other per-message send failures without crashing the bot process
- Show localized one-line technical progress for tool calls, todo updates, and reasoning/thinking, with optional Telegraph links for detailed output when configured
- Send code updates as files (size-limited)
- Send assistant-mentioned local files as follow-up attachments only from the admin host runtime or from tenant-visible `/workspace/...` and `/state/...` paths that map to the current Docker user's Workspaces directory

### Session status in chat

- Keep a pinned status message in the chat
- Show session title, project, model, context usage, and changed files
- Auto-update status from SSE and tool events
- Preserve pinned message ID across bot restarts

### Security

- Whitelist by Telegram admin user ID plus optional allowed user IDs
- Ignore messages from non-authorized users
- Prevent non-admin Docker tenant users from receiving arbitrary host files through automatic local-file follow-ups

### Configuration

- Telegram bot token
- Admin Telegram user ID and optional allowed user IDs
- Default model provider and model ID
- User-scoped defaults for selected model, variant, locale, and service message visibility
- Selected project persisted in `settings.json`
- Configurable sessions list size (default: 10)
- Configurable commands list size (default: 10)
- Configurable scheduled task limit (default: 10)
- Configurable bot locale
- Configurable visibility for service messages (thinking/tool calls)
- Configurable max code file size in KB (default: 100)
- Optional STT settings for voice transcription (`STT_API_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE`)
- Optional TTS settings for global audio replies (`TTS_PROVIDER`, `TTS_API_URL`, `TTS_API_KEY`, `TTS_MODEL`, `TTS_VOICE`, `GOOGLE_APPLICATION_CREDENTIALS`)
- Optional OpenCode server monitoring with automatic restart (`OPENCODE_AUTO_RESTART_ENABLED`, `OPENCODE_MONITOR_INTERVAL_SEC`)
- Optional fallback model for automatic model-unavailable recovery (`OPENCODE_FALLBACK_MODEL_PROVIDER`, `OPENCODE_FALLBACK_MODEL_ID`)
- Optional Telegraph detail publishing for long technical progress output (`TELEGRAPH_ENABLED`, `TELEGRAPH_ACCESS_TOKEN`, `TELEGRAPH_AUTHOR_NAME`, `TELEGRAPH_TIMEOUT_MS`, `TELEGRAPH_MAX_CHARS`)

## Current Product Scope

### Bot commands

Current command set:

- `/status` - server, project, and session status
- `/new` - create a new session
- `/abort` - stop the current task
- `/sessions` - show and switch recent sessions
- `/projects` - show and switch projects
- `/models` - list available runtime-aware providers and models
- `/model` - choose or update the current user's default model directly
- `/variant` - choose or update the current user's default model variant directly
- `/settings` - manage user-scoped defaults, language, and message visibility preferences
- `/tts` - toggle global audio replies
- `/task` - create a scheduled task
- `/tasklist` - browse and delete scheduled tasks
- `/rename` - rename current session
- `/commands` - browse and run custom commands (plus built-ins like `init` and `review`)
- `/mcps` - browse available MCP servers and their status
- `/opencode_start` - start local OpenCode server
- `/opencode_stop` - stop local OpenCode server
- `/skills` - browse and execute available skills
- `/worktree` - switch between git worktrees
- `/open` - browse project files and open them
- `/help` - show command help

Model, agent, variant, and context actions are available from the bottom reply keyboard, while `/model`, `/variant`, and `/settings` provide direct command access to user-scoped defaults, language selection, and message visibility preferences. Users can hide the keyboard manually and the bot reattaches it on later replies; in forum chats, main-thread reply-keyboard actions stay in the main thread while topic-local `agent`/`model`/`variant` behavior remains isolated.

Text messages (non-commands) are treated as prompts for OpenCode only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured. Photos, PDFs, text documents, videos, video notes, and voice/audio files are persisted in per-user media storage, and the saved runtime-visible file path is included in the OpenCode prompt even when transcription succeeds, returns no text, or fails after saving. When `/tts` is enabled globally, completed assistant replies also include a generated audio file if TTS is configured.

Interaction routing rules:

- Only one interactive flow can be active at a time (inline menu, permission, question, rename, commands)
- While an interaction is active, unrelated input is blocked with a contextual hint
- Allowed utility commands during active interactions: `/help`, `/status`, `/abort`
- Unknown slash commands return an explicit fallback message
- Interaction flows do not expire automatically and wait for explicit completion (`answer`, `cancel`, `/abort`, reset/cleanup)

Model picker behavior:

- Uses a runtime-aware catalog loaded for the currently active OpenCode runtime
- Starts with a provider-first menu, then opens the selected provider's model list
- Paginates provider model lists at 10 models per page
- Includes back navigation from provider model pages to the provider list
- Keeps the configured default model (`OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID`) in the picker favorites flow

Model fallback behavior:

- When the SSE stream returns a model-unavailable error, the bot switches the current per-scope model to the configured fallback model (`OPENCODE_FALLBACK_MODEL_PROVIDER` / `OPENCODE_FALLBACK_MODEL_ID`, default `opencode/big-pickle`)
- The fallback happens only once per scope — if the fallback model itself is unavailable, the error is reported as-is without further retries
- After a successful fallback switch, all subsequent prompts in that scope use the fallback model until the user manually selects a different one
- Model switch is reflected in the reply keyboard (model name and context) and a notification is sent to the chat
- The fallback is per-scope (per user in a given chat/topic), not global; different scopes can use different models independently

### Main features already implemented

- [x] Access control by admin Telegram user ID plus optional allowed user IDs
- [x] OpenCode server control from Telegram (`/status`, `/opencode_start`, `/opencode_stop`)
- [x] Project and session management from Telegram (`/projects`, `/sessions`, `/new`)
- [x] Remote task execution and interruption support (`/abort`)
- [x] Telegram-friendly result delivery, including sending generated code/files when needed
- [x] Interactive question and permission handling directly in chat (buttons + custom answers)
- [x] Live pinned session status in chat (project, model, context usage, changed files)
- [x] In-chat controls for model, agent, variant, context, and user-scoped settings
- [x] Built-in and custom command catalog access (`/commands`)
- [x] Scheduled task creation flow (`/task`)
- [x] Scheduled task runtime execution with deferred Telegram delivery
- [x] Scheduled task list and deletion flow (`/tasklist`)
- [x] Persistent settings between restarts (`settings.json`)
- [x] UI localization support via i18n files
- [x] Service message visibility controls (thinking/tool updates)
- [x] Localized technical progress summaries with optional Telegraph detail links
- [x] Sending code blocks as text files when needed
- [x] Image attachments support (persist original photo files, including multiple files in one Telegram album, and fall back to local text extraction when the selected model lacks image input)
- [x] PDF attachments support (persist original PDF files and fall back to local text extraction when the selected model lacks PDF input)
- [x] Text file attachments support (include the saved local file path in the generated prompt for code/config/log files)
- [x] Voice/audio transcription via Whisper-compatible APIs with automatic local media fallback when STT is unavailable or fails
- [x] Optional global audio replies with `/tts` via OpenAI-compatible and Google Cloud TTS providers, including Markdown stripping before speech synthesis
- [x] Short Telegram video and video-note attachments support (persist saved copies, use automatic local analysis fallback when the selected model lacks video input, and locally compress oversized videos up to 61 seconds before analysis)
- [x] Topic-scoped session attach/follow routing, pinned status isolation, and external-input/busy-state isolation for multi-user and forum workflows
- [x] Per-user forum subagent topic routing with silent child-session delivery, timed topic deletion after final delivery, and `/projects` user-default persistence across new topics

## Current Task List

Open tasks for upcoming iterations:

- [ ] `/messages` command: browse session messages with fork/revert actions
- [x] `/skills` command: browse skills and choose one for usage
- [x] `/worktree` command: switch between git worktrees
- [x] `/open` command: browse project files and open them (VM + SSH support)
- [x] `/mcps` command: browse available MCP servers
- [x] Model fallback auto-switch on model-unavailable errors with per-scope persistence and keyboard update
- [ ] Git tree support
- [x] Docker runtime support and deployment guide
- [x] OpenCode server monitoring with automatic restart on stop/crash
- [x] VM-based tenant workspace deployment (QEMU/KVM alternative to Docker)

## Possible Improvements

Optional or longer-term enhancements:

- [ ] Create new OpenCode projects directly from Telegram
- [x] Add project file browsing helpers (for example, `ls` and `open` flows) (VM + SSH routing)
- [x] Add a bot settings command with in-chat UI
- [x] Terminal PTY agent with interactive shell on VM (`/terminal` with real bash via SSH pipe + node-pty)
