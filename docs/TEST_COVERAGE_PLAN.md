# Test Coverage Plan — OpenCode Telegram Bot

**Дата:** 2026-06-03
**Текущее покрытие:** ~76% файлов (1610 тестов, 125 тестовых файлов)
**Цель:** 85%+

---

## Критические пробелы (HIGH PRIORITY)

### 1. `bot/handlers/prompt.ts` (1157 строк)
**Текущие тесты:** 3 косвенных (compaction, deferred-follow-up, retry) — 0 прямых
**Что тестировать:**
- `processUserPrompt()` — session creation flow (5+ сценариев)
- SSH recovery branch
- Tenant restart retry
- Model fallback auto-switch
- Session/project mismatch detection
- Deferred batch window behavior
- Session claim (race condition coverage)
- SSH state change detection
- `retryPromptWithSshRecovery()`
- `retryPromptWithTenantRestart()`

**Предлагаемый подход:** Интеграционные тесты с mocked opencodeClient, mocked settings managers.

### 2. `utils/ssh-manager.ts` (1270 строк)
**Текущие тесты:** 0
**Что тестировать:**
- SSH connect/disconnect lifecycle
- AES-256-GCM encryption/decryption
- Docker image save/upload to remote
- Remote server bootstrap
- Connection store persistence (CRUD)
- Auto-reconnect logic
- Firewall manipulation
- Health check & tunnel verification

**Предлагаемый подход:** Unit-тесты с mocked SSH2 и child_process, интеграционные тесты с реальным SSH.

### 3. `handlers/file-attachment.ts`
**Текущие тесты:** 0
**Что тестировать:**
- File download from Telegram
- Multipart upload to OpenCode
- Error handling (invalid file, network error)
- Tenant path resolution

---

## Средний приоритет (MEDIUM PRIORITY)

### 4. `bot/ontology/*` (4 файла)
**Текущие тесты:** 0
**Файлы:** `bridge.ts`, `render.ts`, `service.ts`, `types.ts`
**Что тестировать:** Skill ontology bridge, rendering.

### 5. `telegraph/*` (6 untested из 10)
**Файлы:** `details-publisher.ts`, `diff-logger.ts`, `key-pool.ts`, `noop-details-publisher.ts`, `subagent-logger.ts`, `thinking-accumulator.ts`
**Что тестировать:** Telegraph API call formatting, queue logic, key pool management.

### 6. `bot/commands/{compact,detach,ontology,server,share}.ts`
**Что тестировать:** Command handlers, edge cases.

### 7. `bot/handlers/{prompt-context,context,media-group}.ts`
**Что тестировать:** Retry context, compaction confirm, album batching.

---

## Низкий приоритет (LOW PRIORITY)

### 8. `utils/{internal-sessions,opencode-error,safe-background-task,ssh-encryption}.ts`
### 9. `settings/repositories/{file-diff-log,telegraph-keys,topic-registry}.ts`
### 10. `scheduled-task/{creation-manager,session-ignore}.ts`
### 11. `permission/manager.ts`
### 12. `model/context-limit.ts`
### 13. `opencode/{ready-lifecycle,ready-refresh}.ts`

---

## План по фазам

### Фаза 1: Критический путь (2-3 дня разработчика)
| Модуль | Оценка | Файлов | Приоритет |
|--------|--------|--------|-----------|
| `bot/handlers/prompt.ts` | 8ч | 1 | CRITICAL |
| `utils/ssh-manager.ts` | 8ч | 1 | CRITICAL |
| `handlers/file-attachment.ts` | 2ч | 1 | HIGH |
| **Итого Фаза 1** | **18ч** | **3** | |

### Фаза 2: Средний приоритет (2-3 дня)
| Модуль | Оценка | Файлов | Приоритет |
|--------|--------|--------|-----------|
| `bot/ontology/*` | 3ч | 4 | MEDIUM |
| `telegraph/*` (6 untested) | 4ч | 6 | MEDIUM |
| `bot/commands/*` (5 untested) | 3ч | 5 | MEDIUM |
| `bot/handlers/*` (3 untested) | 3ч | 3 | MEDIUM |
| **Итого Фаза 2** | **13ч** | **18** | |

### Фаза 3: Низкий приоритет (1-2 дня)
| Модуль | Оценка | Файлов | Приоритет |
|--------|--------|--------|-----------|
| Utils | 3ч | 4 | LOW |
| Repositories | 2ч | 3 | LOW |
| Scheduled-task | 2ч | 2 | LOW |
| Permission | 2ч | 1 | LOW |
| Model | 1ч | 1 | LOW |
| Opencode ready-* | 2ч | 2 | LOW |
| **Итого Фаза 3** | **12ч** | **13** | |

### Общий итог: ~43ч на 34 untested файла

---

## Прирост покрытия (оценка)

| Фаза | Файлов | Прирост | Суммарно |
|------|--------|---------|----------|
| Текущее | - | ~76% | ~76% |
| Фаза 1 | 3 | +5% | ~81% |
| Фаза 2 | 18 | +10% | ~91% |
| Фаза 3 | 13 | +5% | ~96% |
