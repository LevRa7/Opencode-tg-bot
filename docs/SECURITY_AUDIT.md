# Security & Reliability Audit — OpenCode Telegram Bot

**Дата:** 2026-06-03
**Аудитор:** AI Security Agent

---

## CRITICAL

### 1. SSH ключ шифрования хранится рядом с ciphertext
- **Файл:** `src/utils/ssh-manager.ts:301-398`
- **Описание:** Пароли SSH шифруются AES-256-GCM, но ключ хранится в той же директории (`tg-{userId}/state/config/ssh_key`), что и зашифрованные данные (`ssh_credentials.json`). Любой с доступом к файловой системе может расшифровать credentials.
- **Фикс:** Выводить ключ из bot token через HKDF/PBKDF2 вместо хранения на диске.

### 2. Пароль OpenCode сервера виден в process list
- **Файл:** `src/utils/ssh-manager.ts:917,1016`
- **Описание:** Пароль передаётся inline в `docker run -e OPENCODE_SERVER_PASSWORD=${pw}` и `nohup opencode serve`. Виден через `ps aux` и `docker inspect`.
- **Фикс:** Писать пароль в временный env-файл с chmod 600, ссылаться на файл.

### 3. iptables манипуляции от root
- **Файл:** `src/utils/ssh-manager.ts:288-293,1247-1268`
- **Описание:** Бот выполняет iptables команды (port forwarding). Нужен root. При компрометации — полный контроль firewall.
- **Фикс:** Изолировать iptables за минимальной привилегией.

---

## HIGH

### 4. Access approval теряет данные при рестарте
- **Файл:** `src/settings/manager.ts:831-855`
- **Описание:** `getPendingAccessRequests()` маппит поля из БД, но `chatId` и `adminMessageId` не сохраняются.
- **Фикс:** Добавить поля в схему БД и репозиторий.

### 5. SSH пароли в interaction manager
- **Файл:** `src/bot/commands/ssh.ts:284-321`
- **Описание:** Пароли хранятся в `interactionManager.metadata.auth` как plain object. Могут быть залогированы.
- **Фикс:** Очищать `metadata.auth` после подключения.

### 6. 9+ unbounded Maps/Sets — утечка памяти
- **Файлы:** `prompt.ts:55,220,238,242`, `settings/manager.ts:376`, `external-input/suppression.ts:20`, `opencode/client.ts:21`, `permission/manager.ts:56`, `internal-sessions.ts:1`
- **Описание:** Модульные Maps растут без ограничений. На долгоживущем боте приведут к исчерпанию памяти.
- **Фикс:** Добавить LRU-эвакуацию или TTL-очистку.

### 7. TOCTOU race в session claim
- **Файл:** `src/bot/handlers/prompt.ts:245-258`
- **Описание:** `tryClaimSession()` отпускает claim ДО проверки `isSessionBusy()`. Два конкурентных промпта могут пройти.
- **Фикс:** Держать claim до завершения проверки busy.

### 8. sshActiveByScope никогда не очищается
- **Файл:** `src/bot/handlers/prompt.ts:55`
- **Описание:** Маппинг SSH состояния по scope никогда не удаляется. Утечка.
- **Фикс:** Очищать при SSH disconnect.

### 9. Нет circuit breaker для OpenCode API
- **Файл:** `src/opencode/client.ts:51-80`
- **Описание:** Каждый вызов пытается restart runtime, даже при постоянных ошибках.
- **Фикс:** Добавить circuit breaker с порогом 3 ошибок и reset в 60s.

### 10. SSE нет reconnection backoff
- **Файл:** `src/bot/commands/ssh.ts:159`
- **Описание:** При разрыве SSE нет exponential backoff. Потеря событий навсегда.
- **Фикс:** Добавить retry с backoff до 30s.

---

## MEDIUM

### 11. Docker tar в предсказуемом /tmp пути
- **Файл:** `src/utils/ssh-manager.ts:801-837`
- **Фикс:** Использовать `mkdtemp` с chmod 700.

### 12. JSON.parse без try/catch
- **Файлы:** `src/settings/manager.ts:258,284,299,336,586,658,676,683,708,727,738,751,766,769,795`
- **Фикс:** safeJsonParse() helper.

### 13. Graceful shutdown отсутствует
- **Файл:** `src/process/manager.ts:751-757`
- **Фикс:** process.on("SIGTERM", gracefulShutdown).

### 14. TOCTOU race на SSH connections файле
- **Файл:** `src/utils/ssh-manager.ts` (load + persist pattern)
- **Фикс:** Per-user mutex.

### 15. Thundering herd на recoverAll
- **Файл:** `src/utils/ssh-manager.ts:1203-1243`
- **Фикс:** Stagger recovery с интервалом 2s.

### 16. Tenant startup lock может утечь
- **Файл:** `src/process/manager.ts:386-391`
- **Фикс:** .catch + .finally на промис.

### 17. Permission scope isolation gap
- **Файл:** `src/permission/manager.ts:58-68`
- **Фикс:** Reject undefined scopes.

---

## LOW

### 18. Bot token может быть залогирован
- **Файл:** `src/config.ts:227`
- **Фикс:** Добавить toJSON() с маскировкой.

### 19. waitForRemoteServerReady бросает пустой Error
- **Файл:** `src/utils/ssh-manager.ts:1108-1109`
- **Фикс:** Добавить сообщение об ошибке.
