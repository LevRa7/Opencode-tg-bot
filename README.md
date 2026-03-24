# OpenCode Telegram Bot

[![npm version](https://img.shields.io/npm/v/@grinev/opencode-telegram-bot)](https://www.npmjs.com/package/@grinev/opencode-telegram-bot)
[![CI](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml/badge.svg)](https://github.com/grinev/opencode-telegram-bot/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-%3E%3D20-brightgreen)](https://nodejs.org)

OpenCode Telegram Bot is a secure Telegram client for [OpenCode](https://opencode.ai) CLI that runs on your local machine.

Run AI coding tasks, monitor progress, switch models, and manage sessions from your phone.

No open ports, no exposed APIs. The bot communicates with your local OpenCode server and the Telegram Bot API only.

Scheduled tasks support. Turns the bot into a lightweight OpenClaw alternative for OpenCode users.

Platforms: macOS, Windows, Linux

Languages: English (`en`), Deutsch (`de`), Español (`es`), Français (`fr`), Русский (`ru`), 简体中文 (`zh`)

<p align="center">
  <img src="assets/screencast.gif" width="45%" alt="OpenCode Telegram Bot screencast" />
</p>

## Features

- **Remote coding** — send prompts to OpenCode from anywhere, receive complete results with code sent as files
- **Session management** — create new sessions or continue existing ones, just like in the TUI
- **Live status** — pinned message with current project, model, context usage, and changed files list, updated in real time
- **Model switching** — pick models from OpenCode favorites and recent history directly in the chat (favorites are shown first)
- **Agent modes** — switch between Plan and Build modes on the fly
- **Custom Commands** — run OpenCode custom commands (and built-ins like `init`/`review`) from an inline menu with confirmation
- **Interactive Q&A** — answer agent questions and approve permissions via inline buttons
- **Voice prompts** — send voice/audio messages, transcribe them via a Whisper-compatible API, then forward recognized text to OpenCode
- **File attachments** — send images, PDF documents, and any text-based files to OpenCode (code, logs, configs etc.)
- **Forum topic threading** — in Telegram forum chats, each topic gets its own session context and bot replies stay in the same topic
- **Scheduled tasks** — schedule prompts to run later or on a recurring interval; see [Scheduled Tasks](#scheduled-tasks)
- **Context control** — compact context when it gets too large, right from the chat
- **Input flow control** — when an interactive flow is active, the bot accepts only relevant input to keep context consistent and avoid accidental actions
- **Security** — admin-managed Telegram allowlist; unauthorized users are ignored even if they find the bot
- **Localization** — UI localization is supported for multiple languages (`BOT_LOCALE`)

Planned features currently in development are listed in [Current Task List](PRODUCT.md#current-task-list).

Additional project docs:

- Product scope and full bot functionality: [`PRODUCT.md`](PRODUCT.md)
- Internal architecture and component interactions: [`docs/architecture.md`](docs/architecture.md)
- Change history and documentation log: [`CHANGELOG.md`](CHANGELOG.md)

## Prerequisites

- **Node.js 20+** — [download](https://nodejs.org)
- **OpenCode** — install from [opencode.ai](https://opencode.ai) or [GitHub](https://github.com/sst/opencode)
- **Telegram Bot** — you'll create one during setup (takes 1 minute)

## Quick Start

### 1. Create a Telegram Bot

1. Open [@BotFather](https://t.me/BotFather) in Telegram and send `/newbot`
2. Follow the prompts to choose a name and username
3. Copy the **bot token** you receive (e.g. `123456:ABC-DEF1234...`)

You'll also need your **Telegram User ID** — send any message to [@userinfobot](https://t.me/userinfobot) and it will reply with your numeric ID. The setup wizard uses it as the initial admin user and seeds the allowlist with that same ID.

### 2. Start OpenCode Server

Start the OpenCode server:

```bash
opencode serve
```

> The bot connects to the OpenCode API at `http://localhost:4096` by default.

### 3. Install & Run

The fastest way — run directly with `npx`:

```bash
npx @grinev/opencode-telegram-bot
```

> Quick start is for npm usage. You do not need to clone this repository. If you run this command from the source directory (repository root), it may fail with `opencode-telegram: not found`. To run from sources, use the [Development](#development) section.

On first launch, an interactive wizard will guide you through the configuration — it asks for interface language first, then your bot token, admin user ID, OpenCode API URL, and optional OpenCode server credentials (username/password). After that, you're ready to go. Open your bot in Telegram and start sending tasks.

#### Alternative: Global Install

```bash
npm install -g @grinev/opencode-telegram-bot
opencode-telegram start
```

To reconfigure at any time:

```bash
opencode-telegram config
```

## Supported Platforms

| Platform | Status                                       |
| -------- | -------------------------------------------- |
| macOS    | Fully supported                              |
| Windows  | Fully supported                              |
| Linux    | Fully supported (tested on Ubuntu 24.04 LTS) |

## Bot Commands

| Command           | Description                                             |
| ----------------- | ------------------------------------------------------- |
| `/start`          | Reset current state and show welcome message            |
| `/status`         | Server health, current project, session, and model info |
| `/new`            | Create a new session                                    |
| `/abort`          | Abort the current task                                  |
| `/sessions`       | Browse and switch between recent sessions               |
| `/projects`       | Switch between OpenCode projects                        |
| `/rename`         | Rename the current session                              |
| `/commands`       | Browse and run custom commands                          |
| `/stream`         | Toggle or inspect assistant draft streaming             |
| `/task`           | Create a scheduled task                                 |
| `/tasklist`       | Browse and delete scheduled tasks                       |
| `/opencode_start` | Start the OpenCode server remotely                      |
| `/opencode_stop`  | Stop the OpenCode server remotely                       |
| `/restart`        | Restart the bot process                                 |
| `/help`           | Show available commands                                 |

Any regular text message is sent as a prompt to the coding agent only when no blocking interaction is active. Voice/audio messages are transcribed and then sent as prompts when STT is configured. Photos, PDFs, Telegram videos, and video notes are forwarded as media attachments; when the selected model does not support the required media input, the bot automatically uses `google/gemini-3-flash-preview` for that prompt.

The bot also re-syncs the per-chat Telegram command list for allowed users, restores the private-chat menu button to the command picker when Telegram keeps older menu-button state, and keeps the bottom reply keyboard non-persistent so the command menu stays accessible.

`/start` is the welcome/reset entrypoint: it clears the active foreground state, resets topic bindings, rebuilds the bottom keyboard, and sends the welcome message.

Supported attachment flow currently covers:

- photos/screenshots with automatic fallback to `google/gemini-3-flash-preview` when needed
- videos and video notes up to 60 seconds, with automatic fallback to `google/gemini-3-flash-preview` when needed
- PDF documents with automatic fallback to `google/gemini-3-flash-preview` when needed
- text-like files that can be inlined into the prompt

### Telegram Forum Topics (Threaded Mode)

When the bot is used in a Telegram forum supergroup, it follows Telegram Bot API topic routing using `message_thread_id`:

- prompts in a new topic automatically create a new OpenCode session for that topic
- prompts in an existing topic continue that topic's session
- async bot replies (assistant output, question/permission prompts, errors) are sent back to the same topic

> `/opencode_start` and `/opencode_stop` are intended as emergency commands — for example, if you need to restart a stuck server while away from your computer. Under normal usage, start `opencode serve` yourself before launching the bot.

`/restart` relaunches the current bot process with the same Node.js arguments after a short delay, then exits the old instance so Telegram polling can reconnect cleanly.

## Scheduled Tasks

Scheduled tasks let you prepare prompts in advance and run them automatically later or on a recurring schedule. This is useful for periodic checks, routine code maintenance, or tasks you want OpenCode to execute while you are away from your computer. Use `/task` to create a scheduled task and `/tasklist` to review or delete existing ones.

- Each task is created from the currently selected OpenCode project and model
- Scheduled executions currently always run with the `build` agent
- Tasks run outside your active chat session, so they do not interrupt or affect the current session flow
- The minimum recurring interval is 5 minutes
- Up to 10 scheduled tasks can exist at once by default; change this with `TASK_LIMIT` in your `.env`

## Configuration

### Localization

- Supported locales: `en`, `de`, `es`, `fr`, `ru`, `zh`
- The setup wizard asks for language first
- You can change locale later with `BOT_LOCALE`

### Environment Variables

When installed via npm, the configuration wizard handles the initial setup. The `.env` file is stored in your platform's app data directory:

- **macOS:** `~/Library/Application Support/opencode-telegram-bot/.env`
- **Windows:** `%APPDATA%\opencode-telegram-bot\.env`
- **Linux:** `~/.config/opencode-telegram-bot/.env`

| Variable                        | Description                                                                                                  | Required | Default                  |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------ | :------: | ------------------------ |
| `TELEGRAM_BOT_TOKEN`            | Bot token from @BotFather                                                                                    |   Yes    | —                        |
| `TELEGRAM_ADMIN_USER_ID`        | Numeric Telegram user ID for the bot admin                                                                   |   Yes    | —                        |
| `TELEGRAM_ALLOWED_USER_IDS`     | Additional allowed Telegram user IDs (comma- or space-separated); admin is always allowed                    |    No    | admin only               |
| `TELEGRAM_PROXY_URL`            | Proxy URL for Telegram API (SOCKS5/HTTP)                                                                     |    No    | —                        |
| `OPENCODE_API_URL`              | OpenCode server URL                                                                                          |    No    | `http://localhost:4096`  |
| `OPENCODE_SERVER_USERNAME`      | Server auth username                                                                                         |    No    | `opencode`               |
| `OPENCODE_SERVER_PASSWORD`      | Server auth password                                                                                         |    No    | —                        |
| `OPENCODE_MODEL_PROVIDER`       | Default model provider                                                                                       |   Yes    | `opencode`               |
| `OPENCODE_MODEL_ID`             | Default model ID                                                                                             |   Yes    | `big-pickle`             |
| `BOT_LOCALE`                    | Bot UI language (supported locale code, e.g. `en`, `de`, `es`, `fr`, `ru`, `zh`)                             |    No    | `ru`                     |
| `SESSIONS_LIST_LIMIT`           | Sessions per page in `/sessions`                                                                             |    No    | `10`                     |
| `PROJECTS_LIST_LIMIT`           | Projects per page in `/projects`                                                                             |    No    | `10`                     |
| `TASK_LIMIT`                    | Maximum number of scheduled tasks that can exist at once                                                     |    No    | `10`                     |
| `SERVICE_MESSAGES_INTERVAL_SEC` | Service messages interval (thinking + tool calls); keep `>=2` to avoid Telegram rate limits, `0` = immediate |    No    | `5`                      |
| `HIDE_THINKING_MESSAGES`        | Hide reasoning service messages produced from OpenCode reasoning parts and rendered as expandable quotes     |    No    | `false`                  |
| `HIDE_TOOL_CALL_MESSAGES`       | Hide tool-call service messages (`💻 bash ...`, `📖 read ...`, etc.)                                         |    No    | `false`                  |
| `MESSAGE_FORMAT_MODE`           | Assistant reply formatting mode: `markdown` (Telegram MarkdownV2) or `raw`                                   |    No    | `markdown`               |
| `CODE_FILE_MAX_SIZE_KB`         | Max file size (KB) to send as document                                                                       |    No    | `100`                    |
| `STT_API_URL`                   | Whisper-compatible API base URL (enables voice/audio transcription)                                          |    No    | —                        |
| `STT_API_KEY`                   | API key for your STT provider                                                                                |    No    | —                        |
| `STT_MODEL`                     | STT model name passed to `/audio/transcriptions`                                                             |    No    | `whisper-large-v3-turbo` |
| `STT_LANGUAGE`                  | Optional language hint (empty = provider auto-detect)                                                        |    No    | —                        |
| `LOG_LEVEL`                     | Log level (`debug`, `info`, `warn`, `error`)                                                                 |    No    | `info`                   |

> **Keep your `.env` file private.** It contains your bot token. Never commit it to version control.

### Voice and Audio Transcription (Optional)

If `STT_API_URL` and `STT_API_KEY` are set, the bot will:

1. Accept `voice` and `audio` Telegram messages
2. Transcribe them via `POST {STT_API_URL}/audio/transcriptions`
3. Show recognized text in chat
4. Send the recognized text to OpenCode as a normal prompt

Supported provider examples (Whisper-compatible):

- **OpenAI**
  - `STT_API_URL=https://api.openai.com/v1`
  - `STT_MODEL=whisper-1`
- **Groq**
  - `STT_API_URL=https://api.groq.com/openai/v1`
  - `STT_MODEL=whisper-large-v3-turbo`
- **Together**
  - `STT_API_URL=https://api.together.xyz/v1`
  - `STT_MODEL=openai/whisper-large-v3`

If STT variables are not set, voice/audio transcription is disabled and the bot will ask you to configure STT.

### Model Configuration

The model picker uses OpenCode local model state (`favorite` + `recent`):

- Favorites are shown first, then recent
- Models already in favorites are not duplicated in recent
- Current model is marked with `✅`
- Default model from `OPENCODE_MODEL_PROVIDER` + `OPENCODE_MODEL_ID` is always included in favorites

To add a model to favorites, open OpenCode TUI (`opencode`), go to model selection, and press **Cmd+F/Ctrl+F** on the model.

## Security

The bot enforces an admin-managed **Telegram allowlist**. The admin user from `TELEGRAM_ADMIN_USER_ID` is always authorized, and you can optionally add more users via `TELEGRAM_ALLOWED_USER_IDS`. Messages from everyone else are silently ignored and logged as unauthorized access attempts.

The setup wizard initializes a safe single-user default by writing the same ID to the admin slot and the initial allowlist. To onboard more people later, edit `.env` and add their Telegram numeric IDs to `TELEGRAM_ALLOWED_USER_IDS`.

Since the bot runs locally on your machine and connects to your local OpenCode server, there is no external attack surface beyond the Telegram Bot API itself.

## Development

### Running from Source

```bash
git clone https://github.com/grinev/opencode-telegram-bot.git
cd opencode-telegram-bot
npm install
cp .env.example .env
# Edit .env with your bot token, admin/allowed user IDs, and model settings
```

Build and run:

```bash
npm run dev
```

### Available Scripts

| Script                          | Description                          |
| ------------------------------- | ------------------------------------ |
| `npm run dev`                   | Build and start (development)        |
| `npm run build`                 | Compile TypeScript                   |
| `npm start`                     | Run compiled code                    |
| `npm run release:notes:preview` | Preview auto-generated release notes |
| `npm run lint`                  | ESLint check (zero warnings policy)  |
| `npm run format`                | Format code with Prettier            |
| `npm test`                      | Run tests (Vitest)                   |
| `npm run test:coverage`         | Tests with coverage report           |

> **Note:** No file watcher or auto-restart is used. The bot maintains persistent SSE and long-polling connections — automatic restarts would break them mid-task. After making changes, restart manually with `npm run dev`.

## Troubleshooting

**Bot doesn't respond to messages**

- Make sure your Telegram numeric ID is configured in `TELEGRAM_ADMIN_USER_ID` or included in `TELEGRAM_ALLOWED_USER_IDS` (check with [@userinfobot](https://t.me/userinfobot))
- Verify the bot token is correct

**"OpenCode server is not available"**

- Ensure `opencode serve` is running in your project directory
- Check that `OPENCODE_API_URL` points to the correct address (default: `http://localhost:4096`)

**No models in model picker**

- Add models to your OpenCode favorites: open OpenCode TUI, go to model selection, press **Ctrl+F** on desired models
- Verify `OPENCODE_MODEL_PROVIDER` and `OPENCODE_MODEL_ID` point to an available model in your setup

**Linux: permission denied errors**

- Make sure the CLI binary has execute permission: `chmod +x $(which opencode-telegram)`
- Check that the config directory is writable: `~/.config/opencode-telegram-bot/`

## Contributing

Please follow commit and release note conventions in [CONTRIBUTING.md](CONTRIBUTING.md).

## Community

Have questions, want to share your experience using the bot, or have an idea for a feature? Join the conversation in [GitHub Discussions](https://github.com/grinev/opencode-telegram-bot/discussions).

## License

[MIT](LICENSE) © Ruslan Grinev
