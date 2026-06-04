# OpenCode Telegram Bot — Полный отчёт

**Дата:** 2026-06-03
**Версия:** 0.20.7
**Описание:** Telegram-клиент для OpenCode CLI — запуск и мониторинг AI-coding задач из Telegram.

---

## 1. Цель проекта

Telegram Bot для мобильного доступа к OpenCode — запускать, мониторить и управлять AI-coding задачами на локальной машине через Telegram.

**Целевой сценарий:**
1. Разработчик работает локально с OpenCode (Desktop/TUI)
2. Завершает сессию и уходит от компьютера
3. Удалённо подключается через Telegram-бот
4. Выбирает существующую сессию или создаёт новую
5. Отправляет задачи, получает прогресс и результаты
6. Отвечает на вопросы OpenCode, подтверждает разрешения

---

## 2. Архитектура

### Слои

```
┌──────────────────────────────────────────────────────┐
│  PRESENTATION (Telegram API)                         │
│  bot/ — grammY, middleware, handlers, команды         │
│  telegram/render/ — рендеринг MarkdownV2              │
│  keyboard/ — reply keyboard                           │
│  pinned/ — закреплённый статус                        │
├──────────────────────────────────────────────────────┤
│  APPLICATION LOGIC                                    │
│  interaction/ — машина состояний блокирующих потоков   │
│  question/ — ответы на вопросы OpenCode                │
│  permission/ — подтверждение разрешений                │
│  summary/ — агрегация событий SSE, форматирование      │
│  scheduled-task/ — планировщик задач по cron           │
│  thread/ — управление форум-топиками                   │
│  attach/ — привязка сессий к чатам                     │
│  background-session/ — фоновые сессии                  │
├──────────────────────────────────────────────────────┤
│  DOMAIN                                               │
│  session/ — CRUD сессий                               │
│  project/ — CRUD проектов                             │
│  model/ — каталог моделей, fallback                   │
│  agent/ — режимы Plan/Build                           │
│  settings/ — настройки, SQLite-хранилище               │
├──────────────────────────────────────────────────────┤
│  INFRASTRUCTURE                                       │
│  opencode/ — SDK враппер, SSE, авто-рестарт            │
│  media/ — обработка медиа (фото, видео, аудио)         │
│  stt/ — Speech-to-Text (Whisper)                      │
│  tts/ — Text-to-Speech (OpenAI / Google)              │
│  telegraph/ — публикация в Telegraph                   │
│  translate/ — перевод (LibreTranslate)                 │
│  git/ — git worktree                                  │
│  process/ — управление процессом opencode serve        │
│  runtime/ — режимы запуска, Docker                    │
├──────────────────────────────────────────────────────┤
│  CROSS-CUTTING                                        │
│  i18n/ — локализация (6 языков)                       │
│  utils/ — логгер, SSH, rate-limit retry               │
│  cli/ — парсинг CLI-аргументов                        │
│  config.ts — переменные окружения                      │
└──────────────────────────────────────────────────────┘
```

### Data Flow

```
User → Telegram → grammY → middleware (auth, guard, scope) → handler
  → session/manager → opencode/client → OpenCode Server
  → SSE events → opencode/events → summary/aggregator
  → delivery/orchestrator → Telegram → User
```

---

## 3. Основные модули

### 3.1 Входные точки
| Файл | Назначение |
|------|-----------|
| `src/index.ts` | Запуск из исходников |
| `src/cli.ts` | CLI entry point (installed mode) |
| `src/config.ts` | Загрузка env, типизированный конфиг |
| `src/app/start-bot-app.ts` | Инициализация бота: менеджеры → запуск |

### 3.2 Bot Layer (72+ файлов)
| Файл | Назначение |
|------|-----------|
| `bot/index.ts` | Мега-файл (~4174 строки): сборка бота, middleware, все хендлеры, SSE-колбеки |
| `bot/handlers/prompt.ts` | Отправка текстовых промптов в OpenCode |
| `bot/handlers/voice.ts` | Голосовые сообщения → STT → prompt |
| `bot/handlers/photo.ts` | Фото → сохранение → prompt |
| `bot/handlers/video.ts` | Видео → сжатие → сохранение → prompt |
| `bot/handlers/document.ts` | Документы/PDF → сохранение → prompt |
| `bot/handlers/question.ts` | Ответы на вопросы OpenCode |
| `bot/handlers/permission.ts` | Подтверждение разрешений |
| `bot/middleware/auth.ts` | Фильтр по whitelist user ID |
| `bot/middleware/interaction-guard.ts` | Блокировка ввода при активном interaction |
| `bot/middleware/unknown-command.ts` | Fallback для неизвестных команд |

### 3.3 OpenCode Integration
| Файл | Назначение |
|------|-----------|
| `opencode/client.ts` | SDK враппер (host + tenant) с кэшированием |
| `opencode/events.ts` | Подписка на SSE-события |
| `opencode/process.ts` | Управление процессом OpenCode |
| `opencode/auto-restart.ts` | Мониторинг health + авто-рестарт |

### 3.4 State Managers
| Файл | Назначение |
|------|-----------|
| `session/manager.ts` | CRUD сессий, выбор, контекст |
| `project/manager.ts` | CRUD проектов |
| `model/manager.ts` | Каталог моделей, fallback, capabilities |
| `agent/manager.ts` | Режимы Plan/Build |
| `settings/manager.ts` | SQLite хранилище: bindings, preferences, access control |
| `interaction/manager.ts` | Машина состояний блокирующих потоков |
| `thread/manager.ts` | Forum topic bindings |

### 3.5 Summary Pipeline
| Файл | Назначение |
|------|-----------|
| `summary/aggregator.ts` | Агрегация SSE-событий |
| `summary/formatter.ts` | Форматирование сводок |
| `summary/tool-message-batcher.ts` | Группировка tool call сообщений |
| `summary/technical-progress/` | Форматирование прогресса |

### 3.6 Media Processing
| Файл | Назначение |
|------|-----------|
| `media/ingest.ts` | Загрузка и обработка медиа |
| `media/storage.ts` | Локальное хранение |
| `media/transcriber.ts` | STT через Whisper |
| `media/video-preprocess.ts` | Сжатие видео |
| `media/prompt-composer.ts` | Сборка промпта из медиа |

### 3.7 Services
| Файл | Назначение |
|------|-----------|
| `stt/client.ts` | Whisper API клиент |
| `tts/client.ts` | OpenAI / Google Cloud TTS |
| `translate/manager.ts` | LibreTranslate интеграция |
| `process/manager.ts` | Процесс opencode serve |
| `service/manager.ts` | PM2 сервис |

### 3.8 Infra
| Файл | Назначение |
|------|-----------|
| `settings/db.ts` | SQLite setup |
| `settings/migrate.ts` | Миграции БД |
| `settings/repositories/` | 10 DAO-репозиториев |
| `runtime/mode.ts` | sources / installed mode |
| `runtime/paths.ts` | Пути рантайма |
| `runtime/bootstrap.ts` | Setup wizard |
| `runtime/docker.ts` | Docker runtime |
| `telegraph/` | Telegraph API (8 файлов) |
| `telegram/render/` | MarkdownV2 pipeline (9 файлов) |
| `git/worktree.ts` | Git worktree |
| `background-session/tracker.ts` | Фоновые сессии |
| `external-input/suppression.ts` | Дедупликация внешнего ввода |

---

## 4. Команды бота (43 команды)

| Команда | Файл | Назначение |
|---------|------|-----------|
| `/status` | `commands/status.ts` | Статус сервера, проекта, сессии |
| `/new` | `commands/new.ts` | Создать сессию |
| `/abort` | `commands/abort.ts` | Прервать задачу |
| `/sessions` | `commands/sessions.ts` | Список/выбор сессий |
| `/projects` | `commands/projects.ts` | Список/выбор проектов |
| `/models` | `commands/models.ts` | Список провайдеров/моделей |
| `/model` | `commands/model.ts` | Выбор модели |
| `/variant` | `commands/variant.ts` | Выбор варианта модели |
| `/settings` | `commands/settings.ts` | Настройки пользователя |
| `/tts` | `commands/tts.ts` | Включить/выключить аудио-ответы |
| `/task` | `commands/task.ts` | Создать задачу по расписанию |
| `/tasklist` | `commands/tasklist.ts` | Список задач по расписанию |
| `/rename` | `commands/rename.ts` | Переименовать сессию |
| `/commands` | `commands/commands.ts` | Кастомные команды |
| `/mcps` | `commands/mcps.ts` | MCP серверы |
| `/opencode_start` | `commands/opencode-start.ts` | Запустить OpenCode |
| `/opencode_stop` | `commands/opencode-stop.ts` | Остановить OpenCode |
| `/skills` | `commands/skills.ts` | Выполнить навык |
| `/worktree` | `commands/worktree.ts` | Переключить git worktree |
| `/open` | `commands/open.ts` | Просмотр файлов |
| `/help` | `commands/help.ts` | Справка |
| `/ssh` | `commands/ssh.ts` | SSH подключение |
| `/connect` | `commands/connect.ts` | Добавить AI-провайдера |
| `/detach` | `commands/detach.ts` | Открепить сессию |
| `/share` | `commands/share.ts` | Поделиться |
| `/restart` | `commands/restart.ts` | Перезапуск |
| `/stream` | `commands/stream.ts` | Переключить стриминг |
| `/compact` | `commands/compact.ts` | Сжать контекст |

---

## 5. API интеграции

### 5.1 OpenCode SDK (`@opencode-ai/sdk`)
- **Базовый URL:** `http://localhost:4096` (по умолчанию)
- **API вызовы:**
  - `client.global.health()` — проверка здоровья
  - `client.project.list()` / `client.project.current()` — проекты
  - `client.session.list()` / `client.session.create()` / `client.session.promptAsync()` / `client.session.abort()` — сессии
  - `client.event.subscribe()` — SSE-подписка
  - `client.session.status()` — статус сессии
- **Аутентификация:** Basic Auth (username/password) через Authorization header

### 5.2 Telegram Bot API (через grammY)
- **Библиотека:** `grammy` v1.39.2
- **Методы:** sendMessage, editMessageText, deleteMessage, sendDocument, sendPhoto, sendAudio, sendVideo, sendVoice, sendChatAction, createForumTopic, deleteForumTopic, pinChatMessage, setMyCommands, answerCallbackQuery
- **Форматирование:** HTML / MarkdownV2 с fallback

### 5.3 Speech-to-Text (Whisper-compatible)
- **API:** POST `/v1/audio/transcriptions` (OpenAI-compatible)
- **Поддержка:** `.ogg`, `.mp3`, `.mp4` (video notes), `.wav`
- **Параметры:** model, language

### 5.4 Text-to-Speech
- **OpenAI TTS:** POST `/v1/audio/speech`
- **Google Cloud TTS:** gRPC API
- **Поддержка:** streamed audio replies

### 5.5 Telegraph API
- **Базовый URL:** `https://api.telegra.ph`
- **Методы:** createAccount, getAccountInfo, createPage, editPage
- **Назначение:** публикация длинного technical progress, thinking-блоков

### 5.6 LibreTranslate
- **API:** POST `/translate`
- **Назначение:** перевод thinking-блоков на язык пользователя

---

## 6. Переменные окружения

| Переменная | Обязательная | По умолчанию | Описание |
|-----------|-------------|-------------|----------|
| `TELEGRAM_BOT_TOKEN` | **Да** | — | Токен бота от @BotFather |
| `TELEGRAM_ADMIN_USER_ID` | **Да** | — | Admin user ID |
| `TELEGRAM_ALLOWED_USER_IDS` | Нет | — | Доп. разрешённые user ID |
| `TELEGRAM_PROXY_URL` | Нет | — | Прокси (socks5/http) |
| `TELEGRAM_FORCE_IPV4` | Нет | false | Принудительный IPv4 |
| `OPENCODE_API_URL` | Нет | `http://localhost:4096` | URL OpenCode сервера |
| `OPENCODE_SERVER_USERNAME` | Нет | opencode | Username для OpenCode |
| `OPENCODE_SERVER_PASSWORD` | Нет | — | Пароль для OpenCode |
| `OPENCODE_AUTO_RESTART_ENABLED` | Нет | false | Авто-рестарт сервера |
| `OPENCODE_MONITOR_INTERVAL_SEC` | Нет | 300 | Интервал проверки здоровья |
| `OPENCODE_MODEL_PROVIDER` | **Да** | — | Провайдер модели по умолчанию |
| `OPENCODE_MODEL_ID` | **Да** | — | Модель по умолчанию |
| `OPENCODE_FALLBACK_MODEL_PROVIDER` | Нет | opencode | Fallback провайдер |
| `OPENCODE_FALLBACK_MODEL_ID` | Нет | big-pickle | Fallback модель |
| `LOG_LEVEL` | Нет | info | debug/info/warn/error |
| `LOG_RETENTION` | Нет | 10 | Число хранимых лог-файлов |
| `SESSIONS_LIST_LIMIT` | Нет | 10 | Лимит списка сессий |
| `PROJECTS_LIST_LIMIT` | Нет | 10 | Лимит списка проектов |
| `RESPONSE_STREAMING` | Нет | true | Стриминг ответов |
| `STT_API_URL` | Нет | — | URL Whisper API |
| `STT_API_KEY` | Нет | — | API ключ STT |
| `STT_MODEL` | Нет | medium | Модель STT |
| `STT_LANGUAGE` | Нет | ru | Язык STT |
| `TTS_PROVIDER` | Нет | — | openai/google_cloud |
| `TTS_API_URL` | Нет | — | URL TTS API |
| `GOOGLE_APPLICATION_CREDENTIALS` | Нет | — | Google Cloud JSON ключ |
| `TELEGRAPH_ENABLED` | Нет | false | Включить Telegraph |
| `TELEGRAPH_ACCESS_TOKEN` | Нет | — | Telegraph токен |
| `WORKSPACES_ROOT` | Нет | /home/me/Workspaces | Tenant рабочая директория |

---

## 7. Исправленные баги

### Баг: Сессия не создаётся при первом сообщении в новый топик

**Корневая причина:** В `thread/manager.ts:activateFromContext()` при входе в новый форум-топик без биндингов, существующая глобальная сессия (`_lastSetSession`) автоматически привязывалась к новому топику. Из-за этого `processUserPrompt` не создавал новую сессию, а переиспользовал старую.

**Исправление:** В `activateFromContext()` добавлена проверка — если сессия уже привязана к другому контексту (`findSessionContextKey()`), она не переиспользуется для нового топика. Вместо этого вызывается `clearSession()`, и `processUserPrompt` создаёт новую сессию.

**Файл:** `src/thread/manager.ts:305-314`
**Лог нового поведения:** `[ThreadContext] Session {id} is bound to a different context {oldKey}, not reusing for new topic {newKey}`

---

## 8. Информация о тестах

- **Всего тестов:** 1610 (примерно)
- **Тестовых файлов:** ~125
- **Покрытие:** ~76% исходных файлов имеют тесты
- **Не имеют тестов:** ~55 файлов (~24%)
- **Framework:** Vitest
- **Критические пробелы:** `bot/handlers/prompt.ts` (1157 строк) — 0 прямых тестов

---

## 9. Аудит безопасности (сводка)

### CRITICAL
1. **SSH ключ шифрования хранится рядом с ciphertext** — `ssh-manager.ts:301-398`
2. **Пароль OpenCode сервера виден в process list** — `ssh-manager.ts:917,1016`
3. **iptables манипуляции от root** — `ssh-manager.ts:288-293`

### HIGH
1. **Access approval теряет данные при рестарте** — `settings/manager.ts:831-855`
2. **SSH пароли в interaction manager** — `commands/ssh.ts:284-321`
3. **9+ unbounded Maps/Sets — утечка памяти** — multiple files

### MEDIUM
1. **Docker tar в предсказуемом /tmp пути** — `ssh-manager.ts:801-837`
2. **JSON.parse без try/catch в БД** — `settings/manager.ts:258-795`
3. **Graceful shutdown отсутствует** — `process/manager.ts:751-757`
4. **TOCTOU race на SSH connections файле**
5. **Нет circuit breaker для OpenCode API**

---

## 10. Скрипты и плагины

### npm scripts
| Команда | Описание |
|---------|----------|
| `npm run build` | TypeScript → dist/ |
| `npm run start` | Запуск из dist/ |
| `npm run dev` | build + start |
| `npm test` | Vitest |
| `npm run test:coverage` | Vitest с покрытием |
| `npm run lint` | ESLint |
| `npm run format` | Prettier |

### Пользовательские скрипты
| Файл | Назначение |
|------|-----------|
| `scripts/apply-custom-patch.mjs` | Применение custom-патчей |
| `scripts/release-prepare.mjs` | Подготовка релиза |
| `scripts/release-notes-preview.mjs` | Превью заметок релиза |
| `scripts/file-server.ts` | Файловый сервер |
| `scripts/tg-chat-lookup.ts` | Поиск чата по ID |
| `scripts/tg-upload.ts` | Загрузка файла в Telegram |

### Docker
| Файл | Назначение |
|------|-----------|
| `docker/AGENTS.md` | Глобальные инструкции агента в контейнере |
| `docker/` | Dockerfile, entrypoint, merge-agents |

---

## 11. Структура базы данных (SQLite)

### Таблицы
| Таблица | Назначение |
|---------|-----------|
| `conversation_bindings` | Привязка project/session/model/agent к scope |
| `context_bindings` | Thread context bindings |
| `user_preferences` | Дефолты пользователя (project, model, locale) |
| `access_requests` | Запросы на доступ |
| `session_attachments` | Прикреплённые сессии |
| `scheduled_tasks` | Задачи по расписанию |
| `access_control` | Control доступа |
| `runtime` | Информация о runtime tenant |
| `file_diff_log` | Лог diff'ов файлов |
| `telegraph_keys` | Ключи Telegraph |
| `topic_registry` | Реестр форум-топиков |
