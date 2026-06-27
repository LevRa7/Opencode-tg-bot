## Goal

Реализовать human-in-the-loop (HITL): когда сервер занят, новые сообщения отправляются через `session.promptAsync` без блокировки, и ответ SSE доставляется пользователю.

## Constraints & Preferences

- Пользователь — Лев, русскоязычный
- Ветка `feat/terminal-agent`, worktree `.worktrees/terminal-agent`
- Файлы доставляются через `scripts/tg-upload.ts --auto`
- OpenCode Server v2 SDK поддерживает concurrent promptAsync
- Бот под systemd, unit: `/etc/systemd/system/opencode-bot.service`

## Progress

### Done
- **Модель/агент в HITL**: `fireHumanInTheLoopPrompt` передаёт `agent`, `model`, `variant` в `session.promptAsync`, исключая server-side model-switch который вызывал `session_message.seq`
- **session.error — чистый текст**: `handleSessionError` берёт только первую строку (`rawMessage.split("\n")[0]`), стектрейс пользователю не показывается
- **systemd обновлён**: `ExecStart=/usr/bin/node dist/index.js`, WorkingDirectory уже был `.worktrees/terminal-agent`, `run-bot.ts` (сломанная симлинка) заменён, бот запущен (PID 3172416, active/running)
- **Все тесты проходят**: 43 теста prompt + 26 HITL + 14 deferred-follow-up + 2 session-busy = 85 prompt-тестов, все зелёные (3 pre-existing aggregator failures, unrelated)
- **HITL delivery routing фикс**: `ensureHiltRoutingContext()` добавлена, ставит routing context + run state перед dispatch, когда сервер busy и локальный run не активен
- **`__resetPromptStateForTests()`** экспортирована, вызывается в `beforeEach` в prompt-hitl.test.ts для очистки module-level Map между тестами
- **`npx tsc`** эмитит файлы даже с pre-existing ошибками (7 pre-existing TS errors: 4 i18n, 1 onboarding-flow, 2 index.ts — все не из prompt.ts/aggregator.ts)

### In Progress
- (none)

### Blocked
- (none)

## Key Decisions

- **HITL routing контекст ставится по необходимости** — `ensureHiltRoutingContext()` проверяет `isRunActive` и `getPromptRoutingContext`, и ставит только если ничего нет. Не перезаписывает существующий.
- **`__resetPromptStateForTests()`** экспортирована для очистки module-level Map (sessionClaimMap, promptRoutingBySessionId, promptResponseModes, sshActiveByScope) между тестами
- **model/agent в HITL промпт** — через getStoredAgent/getStoredModel внутри fireHumanInTheLoopPrompt, чтобы не дублировать код на трёх call sites

## Relevant Files

- `src/bot/handlers/prompt.ts`: HITL dispatch + fireHumanInTheLoopPrompt + ensureHiltRoutingContext + __resetPromptStateForTests
- `src/summary/aggregator.ts`: handleSessionError — первая строка ошибки без стектрейса
- `tests/bot/handlers/prompt-hitl.test.ts`: тесты HITL (импортируют и вызывают __resetPromptStateForTests в beforeEach)
- `/etc/systemd/system/opencode-bot.service`: systemd unit (node dist/index.js)
