# Control API

Bot Control API — REST-интерфейс для программного управления ботом OpenCode Telegram. Позволяет отправлять сообщения, управлять inline-клавиатурами, запрашивать состояние, переключать сессии/модели/агенты и симулировать callback'и без участия пользователя в Telegram.

**Назначение:** тестирование, автоматизация, внешние интеграции.

## Аутентификация

Все запросы требуют заголовок `X-API-Key` со значением API-ключа.

Ключ берётся из переменной окружения `BOT_CONTROL_API_KEY`. Если переменная не задана, сервер генерирует случайный 32-символьный hex-ключ при старте и выводит его в лог:

```
[HTTP] Control API key: <сгенерированный_ключ>
```

Без валидного ключа сервер возвращает `401 Unauthorized`.

## Базовый URL

По умолчанию сервер слушает порт `8080` (настраивается через `HTTP_PORT`):

```
http://localhost:8080
```

## Общий формат ответов

Все ответы — JSON с полем `ok`:

```json
{ "ok": true, "result": { ... } }
{ "ok": false, "error": "описание ошибки" }
```

## Справочник эндпоинтов

| # | Метод | Путь | Назначение |
|---|-------|------|-----------|
| 1 | `GET` | `/api/control/health` | Проверка здоровья |
| 2 | `GET` | `/api/control/state` | Получить состояние бота |
| 3 | `POST` | `/api/control/state` | Установить состояние |
| 4 | `GET` | `/api/control/sessions` | Список сессий |
| 5 | `POST` | `/api/control/message` | Отправить сообщение |
| 6 | `POST` | `/api/control/edit` | Редактировать сообщение |
| 7 | `DELETE` | `/api/control/message` | Удалить сообщение |
| 8 | `POST` | `/api/control/photo` | Отправить фото |
| 9 | `POST` | `/api/control/document` | Отправить документ |
| 10 | `POST` | `/api/control/keyboard` | Сообщение с клавиатурой |
| 11 | `POST` | `/api/control/poll` | Отправить опрос |
| 12 | `POST` | `/api/control/action` | Действие чата (typing...) |
| 13 | `POST` | `/api/control/pin` | Закрепить сообщение |
| 14 | `POST` | `/api/control/unpin` | Открепить сообщение |
| 15 | `POST` | `/api/control/callback` | Симулировать callback |
| 16 | `POST` | `/api/control/forward` | Переслать сообщение |
| 17 | `POST` | `/api/control/copy` | Копировать сообщение |

## Примеры использования

### Health check
```bash
curl -s http://localhost:8080/api/control/health -H "X-API-Key: $API_KEY"
```

### Получить состояние
```bash
curl -s http://localhost:8080/api/control/state -H "X-API-Key: $API_KEY" | python3 -m json.tool
```

### Отправить сообщение
```bash
curl -s -X POST http://localhost:8080/api/control/message \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"chat_id":123456789,"text":"Привет от Control API!","parse_mode":"MarkdownV2"}'
```

### Отправить клавиатуру
```bash
curl -s -X POST http://localhost:8080/api/control/keyboard \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"chat_id":123456789,"text":"Выберите:","keyboard":[[{"text":"Да","callback_data":"yes"},{"text":"Нет","callback_data":"no"}]]}'
```

### Отправить опрос
```bash
curl -s -X POST http://localhost:8080/api/control/poll \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"chat_id":123456789,"question":"Работает?","options":["Да","Нет"],"is_anonymous":false}'
```

### Переключить модель
```bash
curl -s -X POST http://localhost:8080/api/control/state \
  -H "Content-Type: application/json" -H "X-API-Key: $API_KEY" \
  -d '{"model_id":"godmode/DeepSeek-v4-Pro@thinking"}'
```

## Коды ошибок

| Код | Причина |
|-----|---------|
| `400` | Невалидный запрос (отсутствуют обязательные поля) |
| `401` | Неверный `X-API-Key` |
| `404` | Неизвестный route |
| `500` | Ошибка Telegram API или внутренняя ошибка |

## Ограничения

- Нет rate limiting на уровне API. Telegram Bot API имеет свои лимиты (~30 msg/s).
- Callback-симуляция неполная — только `answerCallbackQuery`, без вызова middleware.
- API включается автоматически при старте HTTP-сервера.

## Безопасность

- API-ключ через `X-API-Key` заголовок
- Рекомендуется задать `BOT_CONTROL_API_KEY` в `.env`
- Для production: обратный прокси (nginx) + TLS + IP-ограничение
