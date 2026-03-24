# OpenCode Telegram Bot

Telegram bot client for OpenCode that lets you run and monitor coding tasks on your local machine from Telegram.

> Project concept and boundaries are documented in [`CONCEPT.md`](./CONCEPT.md).
> Proposed changes that alter the core interaction model should be discussed before implementation.

Related docs:

- Internal architecture and component interactions: [`docs/architecture.md`](./docs/architecture.md)
- Clean architecture migration plan for the vendored `tg-cli`: [`docs/tg-cli-clean-architecture-plan.md`](./docs/tg-cli-clean-architecture-plan.md)
- Iteration 1 execution plan for the vendored `tg-cli` refactor: [`docs/tg-cli-iteration-1-plan.md`](./docs/tg-cli-iteration-1-plan.md)
- Embedding and Ollama API notes for the local `qwen3-embedding:8b` setup: [`docs/qwen3-emb-api.md`](./docs/qwen3-emb-api.md)
- Planned hybrid retrieval and text analysis pipeline for Telegram exports: [`docs/Embedding-analyze-plan.md`](./docs/Embedding-analyze-plan.md)
- Textual change log: [`CHANGELOG.md`](./CHANGELOG.md)

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

### Session management

- Fetch last N sessions (name + date)
- Select and attach to an existing session
- Create a new session
- Use OpenCode-generated session title (based on conversation)

### Task handling

- Send text prompts to OpenCode
- Accept voice/audio messages, transcribe via Whisper-compatible STT API, and forward recognized text as prompts
- Interrupt current task (ESC equivalent)
- Handle OpenCode questions with inline options and custom text answers
- Send selected/custom answers back to OpenCode (`question.reply`)
- Handle permission requests interactively (`allow once` / `always` / `reject`)

### Result delivery

- Send each completed assistant response after completion signal from SSE
- Forward OpenCode reasoning text to Telegram when reasoning parts are available before the final assistant answer, streaming it immediately inside expandable HTML blockquotes with a visible `💭 Думаю...` preface
- Split long responses into multiple Telegram messages
- Send code updates as files (size-limited)

### Session status in chat

- Keep a pinned status message in the chat
- Show session title, project, model, context usage, and changed files
- Auto-update status from SSE and tool events
- Preserve pinned message ID across bot restarts

### Security

- Admin-managed Telegram allowlist (`TELEGRAM_ADMIN_USER_ID` + optional `TELEGRAM_ALLOWED_USER_IDS`)
- Ignore messages from non-authorized users

### Configuration

- Telegram bot token
- Admin Telegram user ID
- Optional additional allowed Telegram user IDs
- Default model provider and model ID
- Selected project persisted in `settings.json`
- Configurable sessions list size (default: 10)
- Configurable scheduled task limit (default: 10)
- Configurable bot locale
- Configurable visibility for service messages (thinking/tool calls)
- Configurable max code file size in KB (default: 100)
- Optional STT settings for voice transcription (`STT_API_URL`, `STT_API_KEY`, `STT_MODEL`, `STT_LANGUAGE`)

## Current Product Scope

### Bot commands

Current command set:

- `/start` - reset current foreground state and show welcome message
- `/status` - server, project, and session status
- `/new` - create a new session
- `/abort` - stop the current task
- `/sessions` - show and switch recent sessions
- `/projects` - show and switch projects
- `/task` - create a scheduled task
- `/tasklist` - browse and delete scheduled tasks
- `/rename` - rename current session
- `/commands` - browse and run custom commands (plus built-ins like `init` and `review`)
- `/stream` - enable, disable, or inspect draft streaming for assistant replies
- `/opencode_start` - start local OpenCode server
- `/opencode_stop` - stop local OpenCode server
- `/help` - show command help

Model, agent, variant, and context actions are available from the persistent bottom keyboard.

`/start` acts as a reset/welcome entrypoint: it clears the current foreground flow, resets topic bindings, rebuilds the keyboard, and sends the welcome message.

Text messages (non-commands) are treated as prompts for OpenCode only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured. Photos, PDFs, Telegram videos, and video messages are sent as media attachments; if the selected model does not support the needed media input, the bot automatically switches that prompt to `google/gemini-3-flash-preview`.

Supported attachments in the current flow:

- photos/screenshots with automatic fallback to `google/gemini-3-flash-preview` when needed
- videos and video messages up to 60 seconds with automatic fallback to `google/gemini-3-flash-preview` when needed
- PDF documents with automatic fallback to `google/gemini-3-flash-preview` when needed
- text-like documents that can be safely inlined into the prompt

Interaction routing rules:

- Only one interactive flow can be active at a time within the same topic scope (inline menu, permission, question, rename, commands)
- Different topics already keep separate interaction/question/permission state foundations, which is the first step toward parallel multi-topic execution
- Current project and session state are now restored from durable topic bindings, while agent/model/message-streaming preferences remain per-user scoped
- Automatic project/session initialization is allowed only for topics that do not have a saved binding yet; after that, switching remains explicit through topic actions such as `/projects`, `/sessions`, or `/new`
- Pinned message state, pinned message persistence, and keyboard context state are now isolated per topic scope
- Foreground OpenCode requests are now limited to 5 active topic-scoped runs per user, while different users remain isolated from each other's counters
- While an interaction is active, unrelated input inside the same scope is blocked with a contextual hint
- Allowed utility commands during active interactions: `/help`, `/status`, `/abort`
- Unknown slash commands return an explicit fallback message
- Interaction flows do not expire automatically and wait for explicit completion (`answer`, `cancel`, `/abort`, reset/cleanup)

Model picker behavior:

- Uses OpenCode local model state (`favorite` + `recent`)
- Favorites are shown first, recent models are shown after favorites
- Models already present in favorites are not duplicated in recent
- Default configured model (`OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID`) is treated as favorite

### Main features already implemented

- [x] Admin-managed Telegram access control with allowlisted users
- [x] OpenCode server control from Telegram (`/status`, `/opencode_start`, `/opencode_stop`)
- [x] Project and session management from Telegram (`/projects`, `/sessions`, `/new`)
- [x] Remote task execution and interruption support (`/abort`)
- [x] Telegram-friendly result delivery, including sending generated code/files when needed
- [x] Interactive question and permission handling directly in chat (buttons + custom answers)
- [x] Live pinned session status in chat (project, model, context usage, changed files)
- [x] In-chat controls for model, agent, variant, and context
- [x] Built-in and custom command catalog access (`/commands`)
- [x] Assistant reply streaming toggle and status command (`/stream`)
- [x] Scheduled task creation flow (`/task`)
- [x] Scheduled task runtime execution with deferred Telegram delivery
- [x] Scheduled task list and deletion flow (`/tasklist`)
- [x] Persistent settings between restarts (`settings.json`)
- [x] UI localization support via i18n files
- [x] Service message visibility controls (thinking/tool updates)
- [x] Sending code blocks as text files when needed
- [x] Image attachments support (send photos/screenshots from Telegram to OpenCode)
- [x] PDF attachments support (send documents from Telegram to OpenCode)
- [x] Text file attachments support (send code/config/log files from Telegram to OpenCode)
- [x] Voice/audio transcription via Whisper-compatible APIs (OpenAI/Groq/Together and compatible providers)

## Current Task List

Open tasks for upcoming iterations:

- [ ] Complete multi-user runtime refactor (per-user state, auth, and delivery routing)
- [ ] Complete per-topic parallel execution for up to 5 concurrent foreground requests per user
- [ ] Move OpenCode execution to per-user Docker sandboxes with approved skills/MCP only
- [ ] Integrate multi-account `tg-cli` daemon with bot-driven login and QR authorization
- [ ] Refactor the vendored `tg-cli` around clean architecture boundaries before expanding export, indexing, and RAG flows
- [ ] Extend `tg-cli` export flows with Telegram dialog classification, time-window filters, and selective media export for photos, voice messages, video notes, and allowed document types (`pdf`, `txt`, `doc`, `docx`)
- [ ] Add `tg-cli` FTS5 indexing, text normalization, noise cleanup, and chunk storage for exported Telegram content
- [ ] Add hybrid RAG retrieval on top of `tg-cli` local exports using Ollama `qwen3-embedding:8b`, including stable query instructions and agent-assisted semantic paragraphization for long or noisy texts
- [ ] `/messages` command: browse session messages with fork/revert actions
- [ ] `/skills` command: browse skills and choose one for usage
- [ ] `/mcps` command: browse available MCP servers
- [ ] Dynamic subagent activity display during task execution
- [ ] Git tree support
- [ ] Docker runtime support and deployment guide
- [ ] OpenCode server monitoring with automatic restart on stop/crash

## Possible Improvements

Optional or longer-term enhancements:

- [ ] Create new OpenCode projects directly from Telegram
- [ ] Add project file browsing helpers (for example, `ls` and `open` flows)
- [ ] Add a bot settings command with in-chat UI
