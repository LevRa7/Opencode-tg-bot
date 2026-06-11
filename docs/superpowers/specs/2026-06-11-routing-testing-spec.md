# Спецификация тестирования подсистемы роутинга

> Статус: **spec** | Версия: 1.1 | Дата: 2026-06-11

---

## 1. Введение

### 1.1 Что такое роутинг

Подсистема роутинга — это набор функций, отвечающих за **доставку сообщений от OpenCode-сервера в правильный Telegram-чат и топик**. Она определяет, куда отправить ответ ассистента, уведомление об ошибке, результат выполнения тула, файл или сообщение дочернего subagent'а.

Роутинг — **единственная точка**, где принимается решение о направлении сообщения. Если роутинг ошибается, ответы уходят не тому пользователю или не в тот топик.

### 1.2 Почему роутинг критичен

| Сценарий | Последствие ошибки роутинга |
|----------|---------------------------|
| Ответ уходит не в тот чат | Пользователь не видит результат |
| Ответ уходит не в тот топик форума | Ответ теряется среди других топиков |
| Ответ уходит другому пользователю | **Утечка данных** — ответ содержит чужие файлы/логи |
| Ответ не доставляется вообще | Сессия выглядит зависшей |
| Fallback на `activeBotInstance` | Сообщение может уйти в main thread bot'а |

### 1.3 Известные инциденты

1. **Сообщения из веб-сессии уходили другому пользователю в main thread.** Причина: `getSessionRoutingApi` при отсутствии routing-контекста возвращал глобальный `activeBotInstance.api`, который не привязан к конкретному чату/пользователю. (Исправлено, нужна регрессия.)

2. **Сообщения начинали возвращаться не в тот топик.** Причина: `isSessionCurrent` для `targetSource="prompt"` всегда возвращает `true` без проверки актуальности привязки. После detach/reattach сессия продолжает слать сообщения в старый топик.

3. **Веб-сессии молчаливо теряют все сообщения.** Сессия, созданная через веб-интерфейс (без Telegram-промпта), не имеет ни `PromptRoutingContext`, ни attached target. `syncSessionRoutingContext` возвращает `null`, `isSessionCurrent` возвращает `false`, и все SSE-события дропаются без создания топика и доставки. Причина: отсутствует автосоздание форум-топика для корневых (не-subagent) сессий.

---

## 2. Архитектура роутинга

### 2.1 Две регистратуры

Роутинг не является классом. Это две `Map<string, Context>` — регистратуры, наполняемые на разных этапах жизни сессии:

| Регистратура | Тип | Где создаётся | Когда очищается |
|-------------|-----|---------------|-----------------|
| `promptRoutingBySessionId` | `Map<string, PromptRoutingContext>` | `prompt.ts:822` — при вызове `processUserPrompt()` | `prompt.ts:279` — через `clearPromptRouting()` |
| `routingBySessionId` | `Map<string, SessionRoutingContext>` | `index.ts:562` — при вызове `syncSessionRoutingContext()` | `index.ts:608` — через `clearSessionRoutingContext()` |

### 2.2 Поток данных

```
Telegram Message (пользователь)
    │
    ▼
processUserPrompt() [prompt.ts]
    ├── Создаёт PromptRoutingContext {bot, target, scope, isForumChat}
    ├── setPromptRoutingContext(sessionId, ctx)  → promptRoutingBySessionId
    └── opencodeClient.session.promptAsync()     → OpenCode Server

SSE Events от OpenCode Server
    │
    ▼
summaryAggregator callbacks [index.ts]
    ├── syncSessionRoutingContext(sessionId)
    │     ├── getPromptRoutingContext(sessionId)      → promptRouting
    │     ├── attachManager.getScopeForSession(id)    → attachedScope
    │     ├── attachManager.getTargetForSession(id)   → attachedTarget
    │     └── SessionRoutingContext {
    │           target: attachedTarget ?? promptRouting.target,
    │           deliveryTarget: attachedTarget ?? promptRouting.target,
    │           targetSource: attachedTarget ? "attached" : "prompt"
    │         }
    │
    ├── isSessionCurrent(sessionId) — гейт перед доставкой
    │
    ├── getSessionRoutingApi(sessionId)      → bot.api
    │
    ├── getSessionRoutingTarget(sessionId)   → {chatId, messageThreadId?}
    │     └── resolveAttachedSessionTarget()
    │           ├── attachManager.getTargetForSession()
    │           └── threadContextManager.getSessionTarget()
    │
    └── Доставка: bot.api.sendMessage/editMessage/sendDocument
          с нужным chatId + messageThreadId
```

### 2.3 Поток данных для веб-сессий (требуемое поведение)

```
Пользователь создаёт сессию через веб-интерфейс
    │
    ▼
OpenCode Server эмитит SSE session.created
    │
    ▼
summaryAggregator.setSession(sessionId)  [index.ts]
    │  Регистрирует сессию как tracked root session
    │
    ├── Есть ли threadContextManager.findForumChatIdForUser(userId)?
    │     └── Да: создать форум-топик через createForumTopic({chatId, name})
    │           ├── Привязать топик: threadContextManager.bindSessionToContext(sessionId, topicTarget)
    │           ├── Привязать attach: attachManager.attach({userId, chatId, messageThreadId}, session)
    │           └── Установить routing: setSessionRoutingContext с targetSource="attached"
    │
    └── Последующие SSE-события (message.part, tool, question)
          доставляются в созданный топик как обычно
```

### 2.4 Двусторонняя синхронизация топик ↔ сессия

| Направление | Что синхронизируется | Триггер | Механизм |
|------------|---------------------|--------|----------|
| Сессия → Топик | Название сессии → название топика | `session.updated` / `session.title.changed` | `editForumTopic({name})` через bot.api |
| Сессия → Топик | Статус сессии (running/done/error) → статус в pinned-сообщении топика | `session.status.changed` | `pinnedMessageManager.updateStatus()` |
| Сессия → Топик | Токены, модель, агент → pinned-сообщение топика | `session.tokens.updated`, `session.model.switched` | `pinnedMessageManager.updateInfo()` |
| Топик → Сессия | Сообщение пользователя → prompt в сессию | Пользователь пишет в топик | `processUserPrompt()` — уже реализовано |
| Топик → Сессия | Закрытие топика → detach/abort сессии | Админ удаляет топик | `topic_deleted` handler → `detach` + `abort` |
| Топик → Сессия | /abort в топике → остановка сессии | Пользователь /abort | `opencodeClient.session.abort()` — уже реализовано |

### 2.5 Приоритет target resolution (по коду)

1. `attachManager.getTargetForSession(sessionId)` — attached target (живая привязка)
2. `threadContextManager.getSessionTarget(sessionId)` — тред-контекст
3. `getSessionRoutingContext(sessionId)?.target` — session routing target (prompt-based)
4. `activeBotInstance?.api` — глобальный fallback (для `getSessionRoutingApi`)

### 2.4 Ключевые функции

| Функция | Файл:строка | Назначение |
|---------|------------|------------|
| `syncSessionRoutingContext` | `index.ts:565` | Синхронизация prompt + attached → routingBySessionId |
| `getSessionRoutingTarget` | `index.ts:630` | Разрешение target с приоритетом attached |
| `getSessionRoutingApi` | `index.ts:644` | Получение bot.api с fallback на activeBotInstance |
| `isSessionCurrent` | `index.ts:1061` | Проверка живости сессии перед доставкой |
| `resolveAttachedSessionTarget` | `index.ts:620` | Поиск attached target (attach → thread) |
| `hasLiveSessionTarget` | `index.ts:626` | Проверка наличия живого attached target |
| `isSessionRoutingLiveAttached` | `index.ts:1000` | Проверка targetSource === "attached" |
| `clearSessionRoutingContext` | `index.ts:603` | Очистка routing + prompt + permission sendFn |
| `cloneRoutingContextForChild` | `index.ts:676` | Клонирование routing для дочерней сессии |
| `seedChildRoutingFromSubagent` | `index.ts:702` | Создание routing для subagent |
| `buildThinkingRoutingIdentity` | `index.ts:919` | Identity-ключ для thinking delivery |
| `runWithSessionRoutingScope` | `index.ts:1004` | Запуск fn в AsyncLocalStorage scope |
| `getSessionDeliveryTarget` | `index.ts:634` | Получение delivery-таргета с учётом disableNotification |

### 2.5 Attach Manager (отдельный класс)

`AttachManager` (`src/attach/manager.ts`) — хранит привязку session ↔ Telegram scope.

| Метод | Строка | Описание |
|-------|--------|----------|
| `attach(scope, session)` | 50 | Привязывает сессию к Telegram-scope |
| `detach(scope)` | 84 | Отвязывает сессию от scope |
| `getTargetForSession(id)` | 106 | Возвращает Telegram target для сессии |
| `getScopeForSession(id)` | 117 | Возвращает Telegram scope для сессии |
| `canReplaceSessionRoute(id, scope)` | 40 | Проверяет, можно ли перепривязать сессию |
| `restoreNewestRouteForSession(id)` | 151 | Восстанавливает новейший route после detach |

---

## 3. Модель угроз

### 3.1 Инварианты безопасности

| # | Инвариант | Что нарушает |
|---|----------|-------------|
| I1 | `userId` в scope всегда совпадает с владельцем сессии | Утечка между пользователями |
| I2 | `chatId` + `messageThreadId` в target уникален для каждой активной доставки | Кросс-топик доставка |
| I3 | После `clearSessionRoutingContext` — никакая доставка невозможна | Stale доставка после завершения |
| I4 | `getSessionRoutingApi` не возвращает `activeBotInstance.api` для сессий с активным attach | Fallback на глобального бота |
| I5 | `isSessionCurrent` возвращает `false` для сессий, чей attached target стал невалидным | Доставка в неактивный топик |
| I6 | Child-сессия не может доставлять сообщения в target, отличный от target родителя | Subagent-утечка |
| I7 | `targetSource` имеет значение `"attached"` только при наличии живого attached scope | Несогласованность source |
| I8 | `restoreNewestRouteForSession` восстанавливает корректный scope после detach | Неверная перепривязка |
| I9 | Веб-сессия без Telegram-промпта должна получить автосозданный форум-топик и routing при первом SSE-событии | Сообщения веб-сессии молчаливо теряются |
| I10 | Топик всегда привязан ровно к одной сессии; смена сессии в топике обновляет binding | Кросс-сессионная путаница |
| I11 | Название форум-топика синхронизируется с `session.title` при изменении | Расхождение названий топик ↔ сессия |
| I12 | Удаление форум-топика должно приводить к detach + abort сессии | Орфанные сессии после удаления топика |

### 3.2 Уязвимые точки (из анализа кода)

| # | Уязвимость | Файл:строка | Тип |
|---|-----------|------------|-----|
| V1 | `getSessionRoutingApi` → `activeBotInstance?.api` — глобальный fallback без проверки пользователя | `index.ts:650` | Утечка между пользователями |
| V2 | `isSessionCurrent` для `targetSource="prompt"` всегда `true` | `index.ts:1072` | Stale доставка |
| V3 | `syncSessionRoutingContext` молча выбирает `attachedTarget ?? promptRouting.target` без валидации согласованности | `index.ts:576` | Непредсказуемый target |
| V4 | `restoreNewestRouteForSession` итерирует все scope-ы — нет гарантии корректности "новейшего" | `attach/manager.ts:154` | Неверная перепривязка |
| V5 | `cloneRoutingContextForChildSession` копирует `targetSource` родителя без проверки | `index.ts:693` | Каскадная ошибка |
| V6 | `canReplaceSessionRoute` защищает только от смены userId, но не от гонки scope-ов одного юзера | `attach/manager.ts:47` | Гонка топиков |
| V7 | `syncSessionRoutingContext` возвращает `null` для сессии без prompt routing и без attached target — SSE-события молчаливо дропаются | `index.ts:567-568` | Полная потеря сообщений веб-сессии |

### 3.3 Сценарии гонок (race conditions)

1. **Attach во время доставки:** SSE-событие приходит, пока `attachManager.attach()` меняет scope
2. **Detach во время доставки:** `clearSessionRoutingContext` вызывается, пока `syncSessionRoutingContext` ещё формирует контекст
3. **Одновременный prompt из двух топиков:** Два `processUserPrompt` для одной сессии с разными target
4. **Subagent spawn при detach родителя:** `seedChildRoutingFromSubagent` выполняется после `clearSessionRoutingContext` родителя
5. **Два SSE-события для новой веб-сессии приходят одновременно:** Оба пытаются создать форум-топик → дубликат топика
6. **Пользователь пишет в топик одновременно с SSE-событием автосоздания топика:** Гонка между `processUserPrompt` и `syncSessionRoutingContext` за установку routing

---

## 4. Стратегия тестирования

### 4.1 Три уровня

```
┌─────────────────────────────────────────────┐
│  E2E (8 spec)                               │
│  Полный пайплайн: сообщение → доставка      │
│  Использует FakeBot + FakeOpenCodeClient    │
├─────────────────────────────────────────────┤
│  Integration (11 spec)                      │
│  Связка routing ↔ SSE callback'и,           │
│  AttachManager ↔ syncSessionRoutingContext  │
├─────────────────────────────────────────────┤
│  Unit (15+ spec)                            │
│  Изолированные функции роутинга             │
│  с инжектированными зависимостями           │
└─────────────────────────────────────────────┘
```

### 4.2 Принципы

- **Behaviour, not implementation:** тесты проверяют контракт (какой target возвращается), не внутреннее устройство Map'ов
- **Mock injected, не global:** зависимости inject'ятся через параметры функций или `vi.mock()`
- **Один инвариант на тест:** каждый `it()` проверяет ровно один инвариант из модели угроз
- **Детерминированность:** никаких `setTimeout`/`Date.now()` без моков

---

## 5. Unit-тесты

### 5.1 Файл: `tests/bot/routing.session-routing-context.test.ts`

#### 5.1.1 `syncSessionRoutingContext`

```typescript
describe("syncSessionRoutingContext", () => {
  // Инварианты: I3 (attached предпочтительнее prompt), I7 (targetSource согласован)

  it("должен использовать attached target, когда есть и attached, и prompt")
  // Given: promptRouting с target={chatId:1, threadId:10}
  //        attachManager возвращает target={chatId:1, threadId:20}
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  target = {chatId:1, threadId:20}, targetSource = "attached"

  it("должен использовать prompt target, когда attached отсутствует")
  // Given: promptRouting с target={chatId:1, threadId:10}
  //        attachManager возвращает null
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  target = {chatId:1, threadId:10}, targetSource = "prompt"

  it("должен вернуть существующий routing, когда promptRouting отсутствует")
  // Given: routingBySessionId уже содержит routing для сессии
  //        promptRoutingBySessionId пуст
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  возвращает существующий routing без изменений

  it("должен вернуть null, когда нет ни prompt, ни существующего routing")
  // Given: обе регистратуры пусты
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  возвращает null

  it("должен установить deliveryTarget равным attached target при его наличии")
  // Given: attachedTarget={chatId:1, threadId:30}
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  routing.deliveryTarget.threadId === 30

  it("должен сохранить sourceMessageId из promptRouting")
  // Given: promptRouting.sourceMessageId = 42
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  routing.sourceMessageId === 42
});
```

#### 5.1.2 `getSessionRoutingTarget`

```typescript
describe("getSessionRoutingTarget", () => {
  // Инварианты: I2 (уникальность target), priority attached > thread > session

  it("должен вернуть attached target в приоритете над session routing target")
  // Given: attachManager.getTargetForSession → {chatId:1, threadId:10}
  //        sessionRouting.target → {chatId:1, threadId:20}
  // When:  getSessionRoutingTarget(sessionId)
  // Then:  {chatId:1, threadId:10}

  it("должен вернуть threadContextManager target, если attachManager возвращает null")
  // Given: attachManager.getTargetForSession → null
  //        threadContextManager.getSessionTarget → {chatId:1, threadId:30}
  // When:  getSessionRoutingTarget(sessionId)
  // Then:  {chatId:1, threadId:30}

  it("должен вернуть session routing target, если и attach, и thread возвращают null")
  // Given: attachManager и threadContextManager → null
  //        sessionRouting.target → {chatId:2, threadId:40}
  // When:  getSessionRoutingTarget(sessionId)
  // Then:  {chatId:2, threadId:40}

  it("должен вернуть undefined, когда все источники пусты")
  // Given: все источники → null/undefined
  // When:  getSessionRoutingTarget(sessionId)
  // Then:  undefined
});
```

#### 5.1.3 `getSessionRoutingApi`

```typescript
describe("getSessionRoutingApi", () => {
  // Инварианты: I4 (защита от fallback на activeBotInstance)

  it("должен вернуть routing.bot.api при наличии routing context")
  // Given: routingBySessionId содержит routing с bot.api = mockApiA
  // When:  getSessionRoutingApi(sessionId)
  // Then:  mockApiA

  it("НЕ должен возвращать activeBotInstance.api, если routing context существует")
  // Given: routingBySessionId содержит routing с bot.api = mockApiA
  //        activeBotInstance.api = mockApiB (другой)
  // When:  getSessionRoutingApi(sessionId)
  // Then:  mockApiA (НЕ mockApiB) — V1 regression

  it("должен вернуть activeBotInstance.api при отсутствии routing context")
  // Given: routingBySessionId пуст; activeBotInstance.api = mockApiB
  // When:  getSessionRoutingApi(sessionId)
  // Then:  mockApiB

  it("должен вернуть null, когда нет ни routing, ни activeBotInstance")
  // Given: routingBySessionId пуст; activeBotInstance = null
  // When:  getSessionRoutingApi(sessionId)
  // Then:  null
});
```

#### 5.1.4 `isSessionCurrent`

```typescript
describe("isSessionCurrent", () => {
  // Инварианты: I5 (stale доставка блокируется), V2 (prompt targetSource не гарантирует живость)

  it("должен вернуть false, когда api недоступен")
  // Given: getSessionRoutingApi → null
  // When:  isSessionCurrent(sessionId)
  // Then:  false

  it("должен вернуть true для targetSource='prompt' даже без attached target (текущее поведение)")
  // Given: routing.targetSource = "prompt", hasLiveSessionTarget → false
  // When:  isSessionCurrent(sessionId) — ТЕКУЩЕЕ поведение
  // Then:  true — (V2: потенциальная уязвимость, тест фиксирует контракт)

  it("должен вернуть true для targetSource='attached' при наличии живого attached target")
  // Given: routing.targetSource = "attached", hasLiveSessionTarget → true
  // When:  isSessionCurrent(sessionId)
  // Then:  true

  it("должен вернуть false для targetSource='attached' при отсутствии живого attached target")
  // Given: routing.targetSource = "attached", hasLiveSessionTarget → false
  //        deliveryTarget.disableNotification НЕ установлен
  // When:  isSessionCurrent(sessionId)
  // Then:  false

  it("должен вернуть true при deliveryTarget.disableNotification, даже если attached target мёртв")
  // Given: routing.targetSource = "attached", hasLiveSessionTarget → false
  //        deliveryTarget.disableNotification = true
  // When:  isSessionCurrent(sessionId)
  // Then:  true

  it("должен вернуть результат hasLiveSessionTarget, когда routing отсутствует, но api есть")
  // Given: getSessionRoutingContext → null, getSessionRoutingApi → mockApi
  //        hasLiveSessionTarget → true
  // When:  isSessionCurrent(sessionId)
  // Then:  true
});
```

#### 5.1.5 `resolveAttachedSessionTarget`

```typescript
describe("resolveAttachedSessionTarget", () => {
  it("должен вернуть attachManager target в приоритете над threadContextManager")
  // Given: attachManager.getTargetForSession → {chatId:1, threadId:10}
  //        threadContextManager.getSessionTarget → {chatId:1, threadId:20}
  // When:  resolveAttachedSessionTarget(sessionId)
  // Then:  {chatId:1, threadId:10}

  it("должен вернуть threadContextManager target, если attachManager возвращает null")
  // Given: attachManager.getTargetForSession → null
  //        threadContextManager.getSessionTarget → {chatId:2, threadId:30}
  // When:  resolveAttachedSessionTarget(sessionId)
  // Then:  {chatId:2, threadId:30}

  it("должен вернуть null/undefined, когда оба менеджера возвращают null")
  // Given: оба менеджера → null
  // When:  resolveAttachedSessionTarget(sessionId)
  // Then:  null (или undefined)
});
```

#### 5.1.6 `cloneRoutingContextForChildSession` и `seedChildRoutingFromSubagent`

```typescript
describe("child session routing", () => {
  // Инварианты: I6 (child не может менять target), V5 (targetSource копируется)

  describe("cloneRoutingContextForChildSession", () => {
    it("должен создать routing для child с указанным target")
    // Given: родительская сессия с target={chatId:1, threadId:10}
    // When:  cloneRoutingContextForChildSession({parentSessionId, childSessionId, target: {chatId:1, threadId:20}})
    // Then:  child routing.target = {chatId:1, threadId:20}

    it("должен скопировать targetSource с родителя")
    // Given: parent routing.targetSource = "attached"
    // When:  cloneRoutingContextForChildSession(...)
    // Then:  child routing.targetSource === "attached"

    it("должен добавить childSessionId в managedChildSessionIds")
    // When:  cloneRoutingContextForChildSession(...)
    // Then:  managedChildSessionIds содержит childSessionId

    it("должен вернуть false, если родительский routing отсутствует")
    // Given: getSessionRoutingContext(parentId) → null
    // When:  cloneRoutingContextForChildSession(...)
    // Then:  возвращает false, child routing не создан
  });

  describe("seedChildRoutingFromSubagent", () => {
    it("должен вернуть true, если child уже имеет topic-scope в subagentTopicService")
    // Given: subagentTopicService.getScopeForSession(childId).kind === "topic"
    // When:  seedChildRoutingFromSubagent(...)
    // Then:  true

    it("должен создать routing для child с parent target при отсутствии готового topic-scope")
    // Given: parent target = {chatId:1, threadId:10}
    //        subagentTopicService.getScopeForSession(childId) → null
    // When:  seedChildRoutingFromSubagent({parentSessionId, childSessionId, topicName: "test"})
    // Then:  child routing.target = {chatId:1, messageThreadId:10}

    it("должен вернуть false, если parent target отсутствует")
    // Given: getSessionRoutingTarget(parentId) → null
    // When:  seedChildRoutingFromSubagent(...)
    // Then:  возвращает false
  });
});
```

#### 5.1.7 `buildThinkingRoutingIdentity`

```typescript
describe("buildThinkingRoutingIdentity", () => {
  it("должен вернуть 'chatId:threadId' при наличии messageThreadId")
  // Given: {chatId: 123, messageThreadId: 456}
  // When:  buildThinkingRoutingIdentity(target)
  // Then:  "123:456"

  it("должен вернуть 'chatId:main' при отсутствии messageThreadId")
  // Given: {chatId: 789}
  // When:  buildThinkingRoutingIdentity(target)
  // Then:  "789:main"
});
```

#### 5.1.8 `clearSessionRoutingContext`

```typescript
describe("clearSessionRoutingContext", () => {
  // Инвариант: I3 (после clear — никакой доставки)

  it("должен удалить routing из routingBySessionId")
  // Given: routingBySessionId содержит запись
  // When:  clearSessionRoutingContext(sessionId)
  // Then:  routingBySessionId.get(sessionId) === undefined

  it("должен удалить prompt routing через clearPromptRouting")
  // Given: promptRoutingBySessionId содержит запись
  // When:  clearSessionRoutingContext(sessionId)
  // Then:  getPromptRoutingContext(sessionId) === null

  it("должен вызвать unregisterPermissionSendFn для scope-ключа")
  // Given: scopeKey → "1:2:3" для сессии
  // When:  clearSessionRoutingContext(sessionId)
  // Then:  permission sendFn незарегистрирован для этого scopeKey

  it("не должен падать, если сессия не существует")
  // When:  clearSessionRoutingContext("nonexistent")
  // Then:  не выбрасывает исключение, состояние не меняется
});
```

#### 5.1.9 `runWithSessionRoutingScope`

```typescript
describe("runWithSessionRoutingScope", () => {
  it("должен выполнить fn в AsyncLocalStorage scope сессии")
  // Given: session routing.scope = {userId:1, chatId:2}
  // When:  runWithSessionRoutingScope(sessionId, () => getCurrentTelegramConversationScope())
  // Then:  возвращает {userId:1, chatId:2}

  it("должен передать возвращаемое значение fn")
  // Given: fn возвращает "result"
  // When:  await runWithSessionRoutingScope(sessionId, fn)
  // Then:  "result"
});
```

#### 5.1.10 `isSessionRoutingLiveAttached`

```typescript
describe("isSessionRoutingLiveAttached", () => {
  it("должен вернуть true при targetSource='attached'")
  it("должен вернуть false при targetSource='prompt'")
  it("должен вернуть false при отсутствии routing context")
});
```

---

### 5.2 Файл: `tests/bot/routing.attach-manager.test.ts`

```typescript
describe("AttachManager", () => {
  // Инварианты: I1 (изоляция пользователей), V4 (restoreNewestRoute), V6 (гонка scope-ов)

  describe("attach", () => {
    it("должен привязать сессию к scope")
    it("должен обновить scopeKeyBySessionId")
    it("не должен позволить другому пользователю перехватить сессию (userId mismatch)")
    // Given: session1 привязана к scope(userId=100)
    // When:  attach(scope(userId=200), session1)
    // Then:  scopeKeyBySessionId.get(session1.id) всё ещё указывает на scope(userId=100) — V6, I1

    it("должен позволить тому же пользователю перепривязать сессию к другому scope")
    // Given: session1 привязана к scope(userId=100, threadId=10)
    // When:  attach(scope(userId=100, threadId=20), session1)
    // Then:  scopeKeyBySessionId.get(session1.id) → scope(userId=100, threadId=20)
  });

  describe("detach", () => {
    it("должен удалить state из statesByScopeKey")
    it("должен вызвать restoreNewestRouteForSession, если detach-нутый scope был активным")
  });

  describe("getTargetForSession", () => {
    it("должен вернуть target на основе scope (с messageThreadId)")
    it("должен вернуть target без messageThreadId для main-thread scope")
    it("должен вернуть null, если scope отсутствует")
  });

  describe("getScopeForSession", () => {
    it("должен вернуть клон scope (не оригинал — защита от мутации)")
    it("должен вернуть null, если scopeKeyBySessionId не содержит сессию")
    it("должен вернуть null, если state был удалён из statesByScopeKey")
  });

  describe("restoreNewestRouteForSession", () => {
    it("должен восстановить новейший scope при нескольких привязках одной сессии")
    // V4: проверяем алгоритм выбора "новейшего"
    // Given: два state для session1 с sequence=1 и sequence=2
    // When:  restoreNewestRouteForSession(session1.id)
    // Then:  scopeKeyBySessionId.get(session1.id) указывает на scope с sequence=2

    it("должен удалить запись из scopeKeyBySessionId, если state-ов не осталось")
  });
});
```

---

### 5.3 Файл: `tests/bot/routing.prompt-routing-context.test.ts`

```typescript
describe("PromptRoutingContext", () => {
  describe("setPromptRoutingContext / getPromptRoutingContext", () => {
    it("должен сохранить и вернуть routing context")
    it("должен вернуть null для неизвестной сессии")
    it("должен перезаписать существующий context при повторном set")
  });

  describe("clearPromptRoutingContext / clearPromptRouting", () => {
    it("должен удалить запись из promptRoutingBySessionId")
    it("не должен падать при вызове на несуществующей сессии")
  });

  describe("tryClaimSession / releaseSessionClaim", () => {
    it("должен разрешить claim, если сессия не занята")
    it("должен отклонить claim, если сессия уже занята (возвращает false)")
    it("должен освободить claim через releaseSessionClaim с правильным runId")
    it("не должен освободить claim с неправильным runId")
  });
});
```

---

## 6. Интеграционные тесты

### 6.1 Файл: `tests/bot/routing.integration.test.ts`

#### 6.1.1 Связка syncSessionRoutingContext ↔ AttachManager

```typescript
describe("syncSessionRoutingContext ↔ AttachManager", () => {
  it("должен синхронизироваться с attachedTarget после attachManager.attach()")
  // Given: promptRouting с target={chatId:1, threadId:10}
  // When:  attachManager.attach(scope={userId:1, chatId:1, threadId:20}, session)
  //        затем syncSessionRoutingContext(sessionId)
  // Then:  routing.targetSource === "attached"
  //        routing.target.messageThreadId === 20

  it("должен вернуться к prompt target после detach")
  // Given: attached target существует
  // When:  attachManager.detach(scope)
  //        затем syncSessionRoutingContext(sessionId)
  // Then:  routing.targetSource === "prompt"
  //        routing.target === promptRouting.target
});
```

#### 6.1.2 Target resolution chain

```typescript
describe("Target resolution chain", () => {
  it("должен пройти всю цепочку: attach → thread → session routing, не упав на null на любом уровне")
  // Тест: последовательно обнуляем attach, thread, проверяем что всегда возвращается валидный target

  it("должен корректно обработать undefined messageThreadId в target")
  // Given: target без messageThreadId (main thread)
  // When:  getSessionRoutingTarget(sessionId)
  // Then:  target.messageThreadId === undefined (не null, не "none")
});
```

#### 6.1.3 Гонка: attach во время доставки

```typescript
describe("Race: attach during delivery", () => {
  it("должен доставить сообщение в target, актуальный на момент вызова getSessionRoutingTarget")
  // Given: session routing target = {chatId:1, threadId:10}
  // When:  параллельно: attachManager.attach(scope(threadId=20)) + getSessionRoutingTarget()
  // Then:  target либо threadId=10, либо threadId=20 — но не null и не undefined
  //        (проверяем что нет race-condition с невалидным состоянием)
});
```

#### 6.1.4 Очистка после завершения сессии

```typescript
describe("Cleanup after session end", () => {
  // Инвариант I3

  it("должен блокировать доставку после clearSessionRoutingContext")
  // Given: активная сессия с routing
  // When:  clearSessionRoutingContext(sessionId)
  // Then:  getSessionRoutingTarget → undefined/null
  //        getSessionRoutingApi → activeBotInstance.api (глобальный fallback)
  //        isSessionCurrent → false

  it("должен очистить prompt routing при очистке session routing")
  // Given: активны оба routing
  // When:  clearSessionRoutingContext(sessionId)
  // Then:  getPromptRoutingContext(sessionId) → null
});
```

#### 6.1.5 Child-сессия: полный цикл

```typescript
describe("Child session routing lifecycle", () => {
  it("должен пройти путь: parent prompt → seedChild → deliver → cleanup")
  // Given: parent session с target={chatId:1, threadId:10}
  // When:  seedChildRoutingFromSubagent({parentSessionId, childSessionId, topicName: "test"})
  //        → child topic создан → доставка → child session завершена
  // Then:  доставка идёт в child target на всём протяжении
  //        после cleanup — child routing удалён

  it("не должен доставлять child-сообщения в parent target после завершения child")
  // Given: child session завершена
  // When:  SSE-событие для child session
  // Then:  isSessionCurrent(childId) === false
});
```

#### 6.1.6 Cross-user изоляция

```typescript
describe("Cross-user isolation", () => {
  // Инвариант I1

  it("не должен доставлять сообщения сессии userA в чат userB")
  // Given: session1 привязана к userA (userId=100, chatId=100)
  // When:  syncSessionRoutingContext — attachManager НЕ содержит scope для userB
  // Then:  routing.target.chatId === chatId userA или prompt scope

  it("AttachManager.attach НЕ должен перепривязать сессию userA к scope userB")
});
```

#### 6.1.7 Forum topic routing

```typescript
describe("Forum topic routing", () => {
  it("должен различать main thread и forum topic по messageThreadId")
  // Given: два вызова processUserPrompt — один в main, другой в topic=50
  // When:  syncSessionRoutingContext для каждой сессии
  // Then:  у сессий разные messageThreadId

  it("должен корректно переключать топик при reattach в другой топик того же форума")
  // Given: session1 в topic=10
  // When:  attachManager.attach(scope(threadId=20), session1)
  // Then:  getSessionRoutingTarget → threadId=20
});
```

#### 6.1.8 Автосоздание топика для веб-сессии

```typescript
describe("Auto-topic creation for web sessions", () => {
  // Инварианты: I9 (веб-сессия получает топик), V7 (не дропаем сообщения)

  it("должен создать форум-топик при первом SSE-событии для веб-сессии без prompt routing")
  // Given: sessionId = "ses_web_001", создана через веб-интерфейс
  //        promptRoutingBySessionId НЕ содержит запись
  //        attachManager.getScopeForSession → null
  //        threadContextManager.findForumChatIdForUser → chatId=-100
  // When:  syncSessionRoutingContext(sessionId) — при первом SSE-событии
  // Then:  createForumTopic вызван с {chatId: -100, name: "Session ..."}
  //        Возвращённый messageThreadId сохранён в threadContextManager
  //        attachManager.attach вызван с scope({chatId:-100, messageThreadId: newThreadId})
  //        routingBySessionId содержит routing с targetSource="attached"

  it("должен доставить сообщение в созданный топик после автосоздания")
  // Given: топик создан (предыдущий тест)
  // When:  SSE message.part — вызов onPartial callback
  // Then:  bot.api.sendMessage вызван с messageThreadId=нового топика

  it("не должен создавать дубликат топика при повторном syncSessionRoutingContext")
  // Given: топик уже создан для сессии
  // When:  syncSessionRoutingContext(sessionId) вызывается повторно (next SSE event)
  // Then:  createForumTopic НЕ вызывается повторно
  //        routing.target.messageThreadId тот же

  it("должен использовать существующий топик, если сессия уже привязана через threadContextManager")
  // Given: threadContextManager.getSessionTarget → {chatId:-100, threadId:55}
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  routing.target.messageThreadId === 55
  //        createForumTopic НЕ вызывается

  it("не должен создавать топик, если чат не является форумом (нет findForumChatIdForUser)")
  // Given: threadContextManager.findForumChatIdForUser → null
  // When:  syncSessionRoutingContext(sessionId)
  // Then:  createForumTopic не вызывается
  //        Доставка происходит в main thread (messageThreadId отсутствует)
});
```

#### 6.1.9 Двусторонняя синхронизация топик ↔ сессия

```typescript
describe("Bidirectional topic ↔ session sync", () => {
  // Инварианты: I10 (один топик = одна сессия), I11 (название синхронизируется), I12 (удаление топика → abort)

  describe("Session → Topic (название)", () => {
    it("должен обновить название форум-топика при изменении session.title")
    // Given: сессия привязана к топику 42 с названием "Old Title"
    // When:  SSE session.updated с title="New Title"
    // Then:  bot.api.editForumTopic вызван с {chatId, messageThreadId:42, name:"New Title"}

    it("не должен обновлять название топика, если оно не изменилось")
    // Given: текущее название топика = "Same Title"
    // When:  SSE session.updated с title="Same Title"
    // Then:  bot.api.editForumTopic НЕ вызывается

    it("должен обрезать название до лимита Telegram (128 символов)")
    // Given: session.title = "A".repeat(150)
    // When:  синхронизация названия
    // Then:  editForumTopic вызван с name длиной ≤ 128
  });

  describe("Session → Topic (статус)", () => {
    it("должен обновить pinned-сообщение при изменении статуса сессии на 'done'")
    // Given: сессия в статусе "running"
    // When:  SSE session.status.changed → "done"
    // Then:  pinnedMessageManager.updateStatus вызван с status="done"

    it("должен обновить pinned-сообщение при ошибке сессии")
    // Given: сессия в статусе "running"
    // When:  SSE session.error
    // Then:  pinned-сообщение обновлено с информацией об ошибке
  });

  describe("Session → Topic (токены/модель)", () => {
    it("должен обновить pinned-сообщение при изменении модели")
    // Given: сессия использует model="gpt-4"
    // When:  SSE session.model.switched → "claude-3"
    // Then:  pinnedMessageManager.updateInfo вызван с model="claude-3"

    it("должен обновить pinned-сообщение с информацией о токенах")
    // Given: сессия активна
    // When:  SSE session.tokens с {input: 1000, output: 500}
    // Then:  pinned-сообщение содержит обновлённую информацию о токенах
  });

  describe("Topic → Session (сообщение пользователя)", () => {
    it("должен отправить сообщение из топика как prompt в привязанную сессию")
    // Given: топик 42 привязан к sessionId="ses_abc"
    // When:  пользователь пишет "продолжи" в топике 42
    // Then:  processUserPrompt вызван с text="продолжи", sessionId="ses_abc"

    it("должен создать НОВУЮ сессию, если топик не привязан (новый топик)")
    // Given: топик 99 не привязан ни к какой сессии
    // When:  пользователь пишет "создай проект" в топике 99
    // Then:  создаётся новая сессия, топик 99 привязывается к ней
    //        threadContextManager.bindSessionToContext вызван
  });

  describe("Topic → Session (удаление топика)", () => {
    it("должен detach-нуть сессию при удалении форум-топика")
    // Given: топик 42 привязан к sessionId="ses_abc"
    // When:  администратор удаляет топик 42
    // Then:  attachManager.detach вызван с scope топика 42
    //        threadContextManager.removeSessionContext("ses_abc")

    it("должен отправить abort в OpenCode при удалении топика активной сессии")
    // Given: сессия "ses_abc" в статусе "running"
    // When:  срабатывает topic_deleted handler
    // Then:  opencodeClient.session.abort("ses_abc") вызван

    it("не должен abort-ить уже завершённую сессию при удалении топика")
    // Given: сессия "ses_abc" в статусе "done"
    // When:  срабатывает topic_deleted handler
    // Then:  opencodeClient.session.abort НЕ вызывается
  });

  describe("Topic → Session (перепривязка)", () => {
    it("должен отвязать старую сессию при привязке новой к тому же топику")
    // Given: топик 42 привязан к сессии "ses_old"
    // When:  attachManager.attach(scope(threadId=42), session="ses_new")
    // Then:  threadContextManager.getSessionTarget("ses_old") → null
    //        threadContextManager.getSessionTarget("ses_new") → threadId=42

    it("должен создать новый топик для старой сессии после перепривязки")
    // Given: "ses_old" активна, её топик 42 перепривязан к "ses_new"
    // When:  следующее SSE-событие для "ses_old"
    // Then:  для "ses_old" создаётся новый топик (автосоздание, см. 6.1.8)
  });
});
```

#### 6.1.10 Гонка: два SSE-события для новой веб-сессии

```typescript
describe("Race: concurrent SSE events for new web session", () => {
  it("не должен создать дубликат топика при параллельных syncSessionRoutingContext")
  // Given: новая веб-сессия без routing
  // When:  два потока одновременно вызывают syncSessionRoutingContext(sessionId)
  // Then:  createForumTopic вызван ровно 1 раз
  //        routing.target.messageThreadId корректен в обоих вызовах

  it("не должен создать дубликат топика при гонке prompt + web-SSE")
  // Given: пользователь печатает /new → создаётся prompt routing
  //        одновременно приходит SSE session.created для веб-сессии
  // When:  syncSessionRoutingContext запущен из обоих источников
  // Then:  только один routing-контекст устанавливается
  //        messageThreadId соответствует топику пользователя (prompt routing приоритетнее)
});
```

---

## 7. E2E тесты

Используют `FakeBot`, `FakeOpenCodeClient`, полный цикл.

```typescript
describe("E2E: полный пайплайн доставки", () => {
  it("должен доставить ответ ассистента в правильный чат/топик после команды /new")
  // Given: пользователь отправляет "/new test" в топике 42 чата -100
  // When:  processUserPrompt → OpenCode Server → SSE assistant message
  // Then:  bot.api.sendMessage вызван с chatId=-100, messageThreadId=42
  //        текст сообщения содержит ответ ассистента

  it("должен доставить ошибку в тот же топик при падении сессии")
  // Given: активная сессия в топике 42
  // When:  SSE session.error event
  // Then:  bot.api.sendMessage вызван с chatId=-100, messageThreadId=42
  //        сообщение содержит информацию об ошибке

  it("должен доставить файл (tool output) в правильный топик")
  // Given: активная сессия в топике 42
  // When:  SSE tool.file event
  // Then:  bot.api.sendDocument вызван с chatId=-100, messageThreadId=42

  it("должен доставить subagent-сообщения в дочерний топик")
  // Given: родительская сессия в топике 42
  // When:  SSE subagent event → создаётся дочерний топик 43
  // Then:  дочерние сообщения идут в топик 43, родительские продолжают в 42

  it("не должен доставлять сообщения после abort сессии")
  // Given: активная сессия, пользователь вызывает /abort
  // When:  SSE-события приходят после abort
  // Then:  isSessionCurrent → false, доставка заблокирована
});

describe("E2E: автосоздание топика для веб-сессии", () => {
  it("должен создать топик и доставить ответ при первой веб-сессии")
  // Given: сессия создана через веб-интерфейс (нет Telegram-промпта)
  //        bot настроен на форум-чат
  // When:  OpenCode Server → SSE session.created → SSE message.part
  // Then:  1) createForumTopic вызван, создан топик 43
  //        2) bot.api.sendMessage вызван с messageThreadId=43
  //        3) pinned-сообщение создано в топике 43

  it("должен доставить ответ в существующий топик при повторном веб-запросе")
  // Given: веб-сессия уже имеет топик 43 (создан ранее)
  // When:  пользователь продолжает диалог через веб → новые SSE-события
  // Then:  bot.api.sendMessage вызван с messageThreadId=43 (тот же топик)
  //        createForumTopic НЕ вызывается повторно
});

describe("E2E: двусторонняя синхронизация", () => {
  it("должен отправить сообщение из Telegram в веб-сессию и получить ответ обратно")
  // Given: веб-сессия привязана к топику 43
  // When:  пользователь пишет "продолжи" в топике 43
  // Then:  1) processUserPrompt вызван для сессии, привязанной к топику 43
  //        2) SSE-ответ доставлен обратно в топик 43 (а не в другой)

  it("должен синхронизировать название топика при переименовании сессии через веб")
  // Given: веб-сессия с title="Мой проект" в топике 43
  // When:  пользователь переименовывает сессию в "Новый проект" через веб
  // Then:  название топика 43 изменено на "Новый проект"

  it("должен закрыть сессию при удалении топика администратором")
  // Given: активная сессия в топике 43
  // When:  администратор удаляет топик 43
  // Then:  сессия detach-нута, abort отправлен в OpenCode
  //        последующие SSE-события не доставляются
});
```

---

## 8. Mock-фабрики и тестовые хелперы

### 8.1 FakeBot

```typescript
// tests/bot/routing/_mocks/fake-bot.ts

import type { Bot, Context } from "grammy";

interface FakeBotApi {
  sendMessage: ReturnType<typeof vi.fn>;
  editMessageText: ReturnType<typeof vi.fn>;
  sendDocument: ReturnType<typeof vi.fn>;
  sendPhoto: ReturnType<typeof vi.fn>;
  sendAudio: ReturnType<typeof vi.fn>;
  sendVideo: ReturnType<typeof vi.fn>;
  deleteMessage: ReturnType<typeof vi.fn>;
  sendChatAction: ReturnType<typeof vi.fn>;
  sendMessageDraft: ReturnType<typeof vi.fn>;
  setMyCommands: ReturnType<typeof vi.fn>;
}

interface FakeBotConfig {
  api?: Partial<FakeBotApi>;
}

function createFakeBotApi(overrides?: Partial<FakeBotApi>): FakeBotApi {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    sendDocument: vi.fn().mockResolvedValue({ message_id: 2 }),
    sendPhoto: vi.fn().mockResolvedValue({ message_id: 3 }),
    sendAudio: vi.fn().mockResolvedValue({ message_id: 4 }),
    sendVideo: vi.fn().mockResolvedValue({ message_id: 5 }),
    deleteMessage: vi.fn().mockResolvedValue(true),
    sendChatAction: vi.fn().mockResolvedValue(true),
    sendMessageDraft: vi.fn().mockResolvedValue(true),
    setMyCommands: vi.fn().mockResolvedValue(true),
    ...overrides,
  };
}

function createFakeBot(config: FakeBotConfig = {}): Bot<Context> {
  const api = createFakeBotApi(config.api);
  // Возвращаем объект, удовлетворяющий интерфейсу Bot, который использует роутинг
  return {
    api,
    // ... минимально необходимые поля
  } as unknown as Bot<Context>;
}
```

### 8.2 FakeAttachManager

```typescript
// tests/bot/routing/_mocks/fake-attach-manager.ts

interface FakeAttachManagerConfig {
  targets?: Map<string, { chatId: number; messageThreadId?: number }>;
  scopes?: Map<string, { userId: number; chatId: number; messageThreadId?: number }>;
}

function createFakeAttachManager(config: FakeAttachManagerConfig = {}) {
  const targets = config.targets ?? new Map();
  const scopes = config.scopes ?? new Map();

  return {
    getTargetForSession: vi.fn(
      (sessionId: string) => targets.get(sessionId) ?? null,
    ),
    getScopeForSession: vi.fn(
      (sessionId: string) => scopes.get(sessionId) ?? null,
    ),
    attach: vi.fn(),
    detach: vi.fn(),
    setBusy: vi.fn(),
    __resetForTests: vi.fn(),

    // Хелперы для тестов
    __setTarget(sessionId: string, target: { chatId: number; messageThreadId?: number }) {
      targets.set(sessionId, target);
    },
    __setScope(sessionId: string, scope: { userId: number; chatId: number; messageThreadId?: number }) {
      scopes.set(sessionId, scope);
    },
    __clear() {
      targets.clear();
      scopes.clear();
    },
  };
}
```

### 8.3 FakeThreadManager

```typescript
// tests/bot/routing/_mocks/fake-thread-manager.ts

function createFakeThreadManager(config: {
  targets?: Map<string, { chatId: number; messageThreadId?: number }>;
  scopes?: Map<string, { userId: number; chatId: number; messageThreadId?: number }>;
} = {}) {
  const targets = config.targets ?? new Map();
  const scopes = config.scopes ?? new Map();

  return {
    getSessionTarget: vi.fn((sessionId: string) => targets.get(sessionId) ?? null),
    getSessionScope: vi.fn((sessionId: string) => scopes.get(sessionId) ?? null),
    getActiveScope: vi.fn(() => null),
    findForumChatIdForUser: vi.fn(() => null),
    updateModelBinding: vi.fn(),
    getSessionDirectory: vi.fn(() => "/test/dir"),
  };
}
```

### 8.4 FakePromptRoutingContext factory

```typescript
// tests/bot/routing/_mocks/fake-prompt-routing.ts

function createFakePromptRoutingContext(overrides: Partial<PromptRoutingContext> = {}): PromptRoutingContext {
  return {
    bot: overrides.bot ?? ({} as Bot<Context>),
    target: overrides.target ?? { chatId: 1 },
    scope: overrides.scope ?? { userId: 1, chatId: 1 },
    isForumChat: overrides.isForumChat ?? false,
    sourceMessageId: overrides.sourceMessageId ?? 123,
    suppressSendErrorMessage: overrides.suppressSendErrorMessage ?? false,
  };
}

// Тестовый хелпер: наполнить promptRoutingBySessionId
function seedPromptRouting(sessionId: string, routing: PromptRoutingContext): void {
  // Используем экспортированный getPromptRoutingContext и setPromptRoutingContext
  // или прямой доступ к promptRoutingBySessionId через vi.mock()
}
```

### 8.5 Тестовые утилиты

```typescript
// tests/bot/routing/_mocks/test-utils.ts

/**
 * Создаёт уникальный sessionId для изоляции тестов.
 */
function uniqueSessionId(prefix = "ses_test"): string {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/**
 * Проверяет, что bot.api.sendMessage был вызван с указанными chatId и messageThreadId.
 */
function expectSentTo(
  sendMessageMock: ReturnType<typeof vi.fn>,
  expectedChatId: number,
  expectedThreadId?: number,
): void {
  const lastCall = sendMessageMock.mock.calls.at(-1)?.[1];
  expect(lastCall?.chat_id).toBe(expectedChatId);
  if (expectedThreadId !== undefined) {
    expect(lastCall?.message_thread_id).toBe(expectedThreadId);
  }
}

/**
 * Сбрасывает все routing-состояния между тестами.
 */
function resetAllRoutingState(): void {
  // Очистка routingBySessionId, promptRoutingBySessionId, managedChildSessionIds, etc.
}
```

---

## 9. Порядок реализации

| Приоритет | Этап | Файлы | Ожидаемое время |
|----------|------|-------|----------------|
| **P0** | Unit: `isSessionCurrent`, `getSessionRoutingApi`, `getSessionRoutingTarget` | `tests/bot/routing.session-routing-context.test.ts` | 2ч |
| **P0** | Unit: `AttachManager.attach/detach/getTargetForSession` | `tests/bot/routing.attach-manager.test.ts` | 1.5ч |
| **P0** | Unit: `syncSessionRoutingContext`, `clearSessionRoutingContext` | `tests/bot/routing.session-routing-context.test.ts` | 1.5ч |
| **P1** | Unit: child session routing (`clone`, `seedChild`) | тот же файл | 1.5ч |
| **P1** | Unit: `PromptRoutingContext` claim/clear | `tests/bot/routing.prompt-routing-context.test.ts` | 1ч |
| **P1** | Unit: `buildThinkingRoutingIdentity`, `runWithSessionRoutingScope` | `tests/bot/routing.session-routing-context.test.ts` | 0.5ч |
| **P1** | Integration: автосоздание топика для веб-сессии (6.1.8) | `tests/bot/routing.integration.test.ts` | 1.5ч |
| **P1** | Integration: двусторонняя синхронизация (6.1.9) | тот же файл | 2ч |
| **P1** | Integration: гонка автосоздания топика (6.1.10) | тот же файл | 1ч |
| **P2** | Integration: routing ↔ AttachManager | `tests/bot/routing.integration.test.ts` | 2ч |
| **P2** | Integration: child session lifecycle | тот же файл | 1.5ч |
| **P2** | Integration: cross-user isolation | тот же файл | 1ч |
| **P2** | Integration: race conditions | тот же файл | 2ч |
| **P3** | E2E: полный пайплайн | `tests/bot/routing.e2e.test.ts` | 3ч |
| **P3** | E2E: автосоздание топика + двусторонняя синхронизация | тот же файл | 2ч |
| **P3** | E2E: subagent delivery | тот же файл | 1.5ч |
| **P3** | E2E: abort и cleanup | тот же файл | 1ч |

---

## 10. Критерии приёмки

- [ ] Все unit-тесты проходят изолированно (без network, без файловой системы)
- [ ] Все integration-тесты проходят с FakeAttachManager + FakeThreadManager
- [ ] Все E2E-тесты проходят с FakeBot + FakeOpenCodeClient
- [ ] Каждый тест проверяет ровно один инвариант из модели угроз (раздел 3.1)
- [ ] `getSessionRoutingApi` **никогда** не возвращает `activeBotInstance.api` для сессии с существующим routing context (регрессия V1)
- [ ] `isSessionCurrent` возвращает `false` после detach attached target (регрессия V2)
- [ ] Cross-user изоляция: сообщения сессии userA не доставляются в чат userB
- [ ] Child-сессия не может сменить target относительно родителя
- [ ] После `clearSessionRoutingContext` — `getSessionRoutingTarget` возвращает `null/undefined`
- [ ] Race-condition тесты стабильны (не flaky) при 100+ прогонах
- [ ] Веб-сессия без Telegram-промпта получает автосозданный топик и routing при первом SSE-событии (регрессия V7)
- [ ] Название форум-топика синхронизируется с `session.title` при изменении (I11)
- [ ] Удаление форум-топика приводит к detach + abort активной сессии (I12)
- [ ] Дубликат топика не создаётся при гонке параллельных syncSessionRoutingContext
- [ ] Сообщение из Telegram в привязанный топик доставляется как prompt в правильную сессию (I10)

---

## 11. Cover letter

Настоящая спецификация описывает полную стратегию тестирования подсистемы роутинга Telegram-бота opencode-telegram-bot. Роутинг является критическим компонентом, отвечающим за доставку ответов ассистента, файлов, ошибок и subagent-сообщений в правильный чат и топик Telegram. Анализ кодовой базы выявил 7 уязвимых точек (V1-V7), включая потенциальную утечку сообщений между пользователями через глобальный fallback на `activeBotInstance.api`, возможность stale-доставки через `isSessionCurrent` с `targetSource="prompt"`, и полную потерю сообщений веб-сессий из-за отсутствия автосоздания форум-топика (V7). Анализ логов подтвердил, что routing-ошибки являются молчаливыми (silent failures) — они не оставляют WARN/ERROR в логах, что делает тестирование единственным способом их обнаружения.

Спецификация охватывает три уровня тестирования: 15+ unit-тестов на изолированные функции, 11 интеграционных тестов на связки компонентов (включая автосоздание топика для веб-сессий и двустороннюю синхронизацию топик ↔ сессия) и 8 E2E-тестов на полный пайплайн доставки. Для каждого уровня предоставлены готовые mock-фабрики (FakeBot, FakeAttachManager, FakeThreadManager) и примеры тестовых сценариев. Тесты упорядочены по приоритету: P0 — критические уязвимости безопасности, P1 — child-сессии + автосоздание топиков, P2-P3 — интеграция и E2E.
