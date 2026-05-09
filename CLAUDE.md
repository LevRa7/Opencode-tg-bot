# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

> **Важно:** Перед началом планирования любой разработки **обязательно прочитай [AGENTS.md](./AGENTS.md)**. Это агентский guideline проекта — он определяет роли, ограничения и поведенческие паттерны для агентов.

## Project Overview

OpenCode Telegram Bot — Telegram-клиент для OpenCode CLI. Бот запускает и мониторит AI-coding задачи из чата. Использует [grammy](https://grammy.dev/) для Telegram API и официальный OpenCode SDK для связи с локальным OpenCode-сервером.

## Development Commands

```bash
# Build (TypeScript → dist/)
npm run build

# Lint
npm run lint

# Format
npm run format

# Run tests
npm test

# Run tests with coverage
npm run test:coverage

# Run single test file
npx vitest run tests/config.test.ts

# Start bot from sources (build + start)
npm run dev

# Release prep
npm run release:prepare        # patch/minor/major
npm run release:rc              # release candidate
```

## Architecture

### Multi-Tenant Design

Проект поддерживает два режима работы:
- **Host mode** — основной режим для админа (одна конфигурация OpenCode)
- **Tenant mode** — изолированные окружения для дополнительных пользователей (каждый со своими sessions, settings)

Функция `ensureCurrentOpencodeRouteReady()` в `src/opencode/client.ts` инициализирует tenant runtime при необходимости. Tenant runtime пути хранятся в `src/runtime/paths.ts`.

### Bot Core (`src/bot/`)

- `index.ts` — точка сборки бота: все middleware, команды, хендлеры подключаются здесь
- `handlers/` — обработчики входящих событий: prompt, voice, photo, permission, question, agent, model, variant, context, document, video
- `commands/` — slash-команды (/status, /new, /sessions, /abort, etc.)
- `delivery/` — `SessionDeliveryOrchestrator` управляет доставкой сообщений в live и durable каналы
- `streaming/` — `ResponseStreamer` и `ToolCallStreamer` для стриминга ответов

### OpenCode Integration (`src/opencode/`)

- `client.ts` — враппер над `@opencode-ai/sdk/v2`, поддерживает host и tenant клиенты с кэшированием
- `events.ts` — подписка на SSE-события от OpenCode (thinking, tool_call, subagent, done)
- `process.ts` — управление процессами OpenCode
- `auto-restart.ts` — мониторинг health эндпоинта и авто-рестарт при падении

### Interaction System (`src/interaction/`)

Управляет "blocking flows" — состояния когда бот ожидает конкретный input и блокирует другие команды. Каждое взаимодействие имеет:
- `kind` — тип (question, permission, rename, task creation, etc.)
- `expectedInput` — какой input ожидается
- `allowedCommands` — какие команды разрешены во время этого состояния

### Pinned Status Messages (`src/pinned/`)

Бот показывает закреплённое сообщение в чате с текущим project, model, context usage и changed files. Обновляется в реальном времени через SSE events.

### Scheduled Tasks (`src/scheduled-task/`)

- `store.ts` — SQLite storage для scheduled tasks
- `executor.ts` — запуск task по cron (node-cron)
- `creation-manager.ts` — UI для `/task` и `/tasklist` команд

### i18n (`src/i18n/`)

Поддерживаемые локали: `en`, `de`, `es`, `fr`, `ru`, `zh`. Каждый файл — отдельный namespace. Инициализация через `BOT_LOCALE` env var.

### Settings Management (`src/settings/`)

Settings хранятся в `settings.json` и включают per-user и per-session конфигурацию. Загружаются через `loadSettings()` в app startup.

## Key Patterns

### Stream Processing

Assistant responses проходят через pipeline:
1. `ResponseStreamer` получает SSE от OpenCode
2. `ToolMessageBatcher` группирует tool calls для отображения
3. `thinking-block-stream.ts` управляет блоками "💭 Thinking..."
4. `SessionDeliveryOrchestrator` доставляет в Telegram с retry логикой

### File Handling

Files отправляются в OpenCode через multipart upload в `src/media/ingest.ts`. Максимальный размер для отправки как документа задаётся через `CODE_FILE_MAX_SIZE_KB`.

### TTS/STT

- STT: Whisper-compatible API (OpenAI или совместимый), настраивается через `STT_*` переменные
- TTS: OpenAI или Google Cloud TTS, включая streaming audio responses

## Testing

Тесты в `tests/` — структура повторяет `src/`. Каждый тестовый файл — модульные тесты на соответствующий модуль. Singleton state reset между тестами через `tests/helpers/reset-singleton-state.ts`.

## Commit Convention

Используются Conventional Commits: `feat(scope)`, `fix(scope)`, `docs(scope)`, `refactor(scope)`, `chore(scope)`, `test(scope)`, `ci(scope)`, `build(scope)`.

PR title = commit message = release note entry.

## Contributing Policy

Перед major changes — прочитать `CONCEPT.md`. Новые фичи: открыть issue с описанием проблемы и решения до реализации. Bug fixes и small improvements — можно сразу PR.

OS-sensitive changes (process management, paths, shell commands) должны работать на Linux, macOS, Windows. Указать в PR если какая-то платформа не протестирована.