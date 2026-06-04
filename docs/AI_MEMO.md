# OpenCode Telegram Bot — Памятка для AI-моделей

**Цель:** Краткий справочник по функциям, API, плагинам и архитектуре бота, чтобы AI-модели могли эффективно работать с кодом.

---

## 1. Ключевые факты

| Поле | Значение |
|------|----------|
| **Язык** | TypeScript 5.x |
| **Runtime** | Node.js 20+ |
| **Бот-фреймворк** | grammY 1.39.x |
| **OpenCode SDK** | `@opencode-ai/sdk` v2 |
| **База данных** | SQLite (better-sqlite3) |
| **Тесты** | Vitest, ~1600 тестов |
| **Режимы запуска** | sources (tsc) / installed (dist/) |

---

## 2. Основные сущности

### ConversationScope
```typescript
interface TelegramConversationScope {
  userId: number;
  chatId: number;
  messageThreadId?: number; // для форум-топиков
}
```
Хранится в AsyncLocalStorage. Каждый хендлер получает scope через middleware.

### SessionInfo
```typescript
interface SessionInfo {
  id: string;
  title: string;
  directory: string;
}
```

### ProjectInfo
```typescript
interface ProjectInfo {
  id: string;
  name: string;
  worktree: string;
}
```

### ModelInfo
```typescript
interface ModelInfo {
  providerID: string;
  modelID: string;
  variant?: string;
}
```

### Interaction (блокирующий поток)
```typescript
interface ActiveInteraction {
  kind: "question" | "permission" | "rename" | "task_creation" | "inline" | "commands" | "ssh_setup";
  expectedInput: "text" | "option" | "callback_query";
  allowedCommands?: string[];
  metadata?: Record<string, unknown>;
}
```

---

## 3. Порядок middleware (bot/index.ts)

```
0. API-прокси (rate-limit retry, логгирование getUpdates)
1. authMiddleware — проверка whitelist user ID
2. ensureCommandsInitialized — синхронизация команд
3. scopeMiddleware — установка AsyncLocalStorage scope + threadContextManager.activateFromContext()
4. interactionGuardMiddleware — блокировка при активном interaction
5. Хендлер команд
6. Хендлер callback_query
7. Хендлер текстовых сообщений (processUserPrompt)
8. Хендлер медиа
9. bot.catch — глобальный обработчик ошибок
```

---

## 4. Важные методы

### session/manager.ts
```typescript
getCurrentSession(): SessionInfo | null
setCurrentSession(session: SessionInfo): void
clearSession(): void
```

### thread/manager.ts
```typescript
activateFromContext(ctx): TelegramThreadTarget | null
bindSessionToActiveContext(session: SessionInfo): void
getActiveScope(): TelegramConversationScope | null
canAutoAssignSessionForActiveContext(): boolean
```

### opencode/client.ts
```typescript
ensureCurrentOpencodeRouteReady(): Promise<void>
getOpencodeClient(): OpencodeClient
```

### opencode/events.ts
```typescript
subscribeToEvents(directory: string): Promise<void>
stopEventListening(): void
```

### interaction/manager.ts
```typescript
getSnapshot(): ActiveInteraction | null
setActive(kind, expectedInput, allowedCommands, ttl): void
transition(params): void
clear(reason): void
```

### settings/manager.ts
```typescript
getCurrentProject(): ProjectInfo | undefined
setConversationCurrentProject(project): void
getCurrentSession(): SessionInfo | undefined
setCurrentSession(session): void
getThreadContextBindings(): ThreadContextBinding[]
```

### summary/aggregator.ts
```typescript
processEvent(event): void
setSession(sessionId): void
setBotAndChatId(bot, chatId, messageThreadId): void
```

---

## 5. Ключевые правила

### 5.1 Сквозной поток
Всегда следить за `runWithTelegramConversationScope()` — это AsyncLocalStorage, который передаётся через `next()`.

### 5.2 Блокирующие потоки (interaction system)
- Только один активный interaction единовременно на scope
- Пока interaction активен, `interactionGuardMiddleware` блокирует любой другой ввод
- Разрешённые команды: `/help`, `/status`, `/abort`
- Interaction НЕ истекает автоматически (ждёт явного завершения)

### 5.3 Session lifecycle
- Сессия привязывается к ConversationScope через `attachSessionForScope()`
- Привязка хранится ОДНОВРЕМЕННО в `settings/manager.ts` (convBindings + _lastSetSession) и `thread/manager.ts` (sessionByContext)
- При входе в новый топик без биндингов — создаётся НОВАЯ сессия (исправлено 2026-06-03)

### 5.4 SSE Event Processing
- `opencode/events.ts` подписывается на SSE-события
- События обрабатываются в `ensureEventSubscription(directory)`
- Типы событий: `text`, `reasoning`, `tool_call`, `subagent`, `file`, `question`, `permission`, `done`, `error`, `session.created`, `session.updated`, `completion`
- Доставка сообщений упорядоченная через `SessionDeliveryOrchestrator`

### 5.5 Tenant-система
- Admin пользователь: host runtime (прямой доступ к OpenCode)
- Tenant пользователи: изолированные Docker-контейнеры
- Переключение происходит через `ensureCurrentOpencodeRouteReady()`

### 5.6 SSH
- Пароли/ключи шифруются AES-256-GCM
- Ключ выводится из masterSecret (НЕ хранится на диске — рекомендуется)
- SSH туннель через `socks-proxy-agent` или `https-proxy-agent`
- При разрыве SSH — автоматическое переподключение

---

## 6. Известные проблемы

| Проблема | Файл | Статус |
|----------|------|--------|
| SSH ключ рядом с ciphertext | `ssh-manager.ts:301-398` | Не исправлено |
| Пароль в process list | `ssh-manager.ts:917,1016` | Не исправлено |
| Access approval потеря данных | `settings/manager.ts:831-855` | Не исправлено |
| Unbounded Maps | Multiple files | Не исправлено |
| Нет graceful shutdown | `process/manager.ts:751-757` | Не исправлено |
| **Сессия в новом топике** | **`thread/manager.ts:305-314`** | **Исправлено 2026-06-03** |

---

## 7. Покрытие тестами (пробелы)

| Приоритет | Модуль | Файл(ы) | Что нужно тестировать |
|-----------|--------|---------|----------------------|
| HIGH | Prompt handler | `bot/handlers/prompt.ts` (1157 строк) | session creation, SSH recovery, model fallback, tenant restart, deferred batch |
| HIGH | SSH Manager | `utils/ssh-manager.ts` (1270 строк) | подключение, шифрование, Docker deploy, reconnect |
| HIGH | File Attachment | `handlers/file-attachment.ts` | загрузка, multipart, fallback |
| MEDIUM | Prompt Context | `handlers/prompt-context.ts` | retry context |
| MEDIUM | Context Handler | `handlers/context.ts` | compaction confirm |
| MEDIUM | Media Group | `handlers/media-group.ts` | album batching |
| MEDIUM | Ontology (all) | `bot/ontology/` | bridge, render, service, types |
| MEDIUM | Telegraph | `telegraph/` | 6 untested files |
| MEDIUM | Commands | `commands/compact.ts, detach.ts, ontology.ts, server.ts, share.ts` | |
| LOW | Utils | `internal-sessions.ts, opencode-error.ts, safe-background-task.ts, ssh-manager.ts` | |
| LOW | Repositories | `file-diff-log.ts, telegraph-keys.ts, topic-registry.ts` | |
| LOW | Scheduled Task | `creation-manager.ts, session-ignore.ts` | |
| LOW | Permission | `permission/manager.ts` | |

---

## 8. План покрытия тестами

### Фаза 1: Критический путь (2-3 дня)
- `bot/handlers/prompt.ts` — session creation, retry, fallback
- `utils/ssh-manager.ts` — SSH lifecycle, encryption, Docker deploy
- `bot/handlers/file-attachment.ts` — file upload flow

### Фаза 2: Средний приоритет (2-3 дня)
- `bot/ontology/*` — все 4 файла
- `telegraph/*` — 6 untested файлов
- `bot/commands/{compact,detach,ontology,server,share}.ts`
- `bot/handlers/{prompt-context,context,media-group}.ts`

### Фаза 3: Низкий приоритет (1-2 дня)
- `utils/{internal-sessions,opencode-error,safe-background-task,ssh-manager}.ts`
- `settings/repositories/{file-diff-log,telegraph-keys,topic-registry}.ts`
- `scheduled-task/{creation-manager,session-ignore}.ts`
- `permission/manager.ts`
- `model/context-limit.ts`
- `opencode/{ready-lifecycle,ready-refresh}.ts`

### Цель: 85%+ покрытие
