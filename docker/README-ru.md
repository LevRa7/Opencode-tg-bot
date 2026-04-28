# OpenCode + tg-cli Docker Server

В этой папке находится Docker-конфигурация для запуска OpenCode server с изолированным Telegram CLI.

Что дает эта сборка:

- OpenSSH client tools внутри контейнера для доступа из tenant workspace
- OpenCode server в Docker
- `tg-cli`, установленный в том же контейнере
- отдельная рабочая область для каждого tenant
- отдельная база OpenCode для каждой рабочей области
- отдельная директория Telegram config/session для каждой рабочей области
- автоматический переход на следующий свободный опубликованный порт, если предпочитаемый порт уже занят другим server container
- общие глобальные Telegram app credentials
- доступ из контейнера к хостовому `cliproxyapi`
- минимальный tenant-specific OpenCode config вместо наследования полной host-конфигурации
- только явно скопированные skills `tg-cli` и `embedding-strategies` внутри изолированной сессии
- публикация только на `127.0.0.1`
- локально завендоренные build inputs, чтобы пересборка не требовала Docker Hub

## Важное разделение директорий

Эта директория относится к проекту телеграм-бота:

```text
/home/me/MyProjects/opencode-tg
```

Это **не** исходники OpenCode.

Теперь эта сборка использует:

- локально кешированный OpenCode base image, уже присутствующий в Docker
- локальное завендоренное дерево исходников `tg-cli` из этой директории

Поэтому в дальнейшем пересборка не требует Docker Hub, пока base image остается в локальном кеше.

## Файлы

- `run-opencode-serve.sh` — запускает контейнер с сервером
- `build-opencode-tg-image.sh` — внедряет локальное tg-cli source и затем собирает image
- `Dockerfile` — собирает кастомный image из локального кешированного OpenCode base image плюс vendored tg-cli
- `bin/tg-cli-wrapper.sh` — wrapper, который принудительно использует изолированный tg-cli config для текущей workspace
- `skills/tg-cli/SKILL.md` — project skill, объясняющий OpenCode как использовать Telegram CLI
- `tg-cli/` — локальные исходники tg-cli из `https://github.com/miolamio/tg-cli`
- `vendor/python-tg-cli/` — vendored tg-cli source, используемый во время Docker build
- `README.md` — инструкция на английском
- `README-ru.md` — инструкция на русском

## Что изолировано, а что общее

### Общее для всех портов

Эти значения общие:

- Telegram app `api_id`
- Telegram app `api_hash`
- основной OpenCode auth из `~/.local/share/opencode/auth.json`
- host `cliproxyapi` endpoint и каталог cliproxyapi models, копируемый в tenant config

Полная host-конфигурация OpenCode в tenant state больше не переносится.

### Отдельно для каждого порта

Если сервер запущен на `49601`, он использует:

- workspace: `/home/me/Workspaces/49601`
- OpenCode DB: `/home/me/Workspaces/49601/.opencode-data`
- Telegram config/session: `/home/me/Workspaces/49601/.tg-cli`

Если сервер запущен на `49602`, он получит свои отдельные:

- `/home/me/Workspaces/49602/.opencode-data`
- `/home/me/Workspaces/49602/.tg-cli`

То есть Telegram session-файлы между портами не шарятся.

## Доступ к cliproxyapi из Docker

Ваш хостовый OpenCode config использует:

```text
http://127.0.0.1:8317/v1
```

Внутри Docker `127.0.0.1` указывает на сам контейнер, а не на хост. В вашей среде хостовый LAN-адрес `192.168.2.166:8317` напрямую доступен из контейнера, поэтому launcher использует его по умолчанию:

```text
http://192.168.2.166:8317/v1
```

При необходимости можно переопределить вручную:

```bash
CLIPROXYAPI_BASE_URL='http://192.168.2.166:8317/v1'
```

## Требования

Перед использованием убедитесь, что на хосте есть:

- Docker
- пользовательский доступ к Docker без `sudo` (rootless Docker или эквивалентный доступ к Docker daemon)
- `/home/me/Workspaces`
- `~/.config/opencode`
- `~/.local/share/opencode/auth.json`
- хостовый `cliproxyapi`, слушающий `127.0.0.1:8317`
- локально кешированный Docker image:
  - `ghcr.io/anomalyco/opencode:latest`
- локальное дерево `docker/tg-cli`, которое будет внедрено в образ

## Сборка Docker image из локальных артефактов

Перед первым запуском соберите кастомный image через helper script:

```bash
/home/me/MyProjects/opencode-tg/docker/build-opencode-tg-image.sh
```

### Что делает эта команда

- проверяет, что локальный base image существует:
  - `ghcr.io/anomalyco/opencode:latest`
- внедряет локальное дерево tg-cli в:
  - `/home/me/MyProjects/opencode-tg/docker/vendor/python-tg-cli`
- запускает `docker build -t opencode-tg:local ...`
- собирает image, содержащий:
  - кешированный локальный OpenCode base image
  - команду tg-cli (`tg` и `telegram-cli`)
  - wrapper `/usr/local/bin/opencode-tg-cli`

### Необязательные переопределения

По умолчанию скрипт использует `docker/tg-cli` как дерево исходников tg-cli.

Использовать другой путь к исходникам tg-cli:

```bash
TG_CLI_SOURCE_DIR='/path/to/tg-cli' /home/me/MyProjects/opencode-tg/docker/build-opencode-tg-image.sh
```

Использовать другой тег кешированного base image:

```bash
OPENCODE_BASE_IMAGE='ghcr.io/anomalyco/opencode:latest' /home/me/MyProjects/opencode-tg/docker/build-opencode-tg-image.sh
```

## Путь к скрипту

```bash
/home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh
```

## Базовый запуск

```bash
OPENCODE_SERVER_PASSWORD='your-password' /home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh
```

Эти helper scripts рассчитаны на запуск без `sudo`. При возможности они используют пользовательский Docker socket `${XDG_RUNTIME_DIR}/docker.sock` и хранят Docker client state в `docker/.docker-config`.

Root filesystem контейнера теперь записываемый. Tenant-specific OpenCode, tg-cli и skill state по-прежнему живут в `/state`.

## Как работает tenant SSH

Контейнер запускает tenant-команды с:

```text
HOME=/workspace
```

Это значит, что стандартная tenant SSH-директория внутри контейнера:

```text
/workspace/.ssh
```

Практические последствия:

- SSH-ключи, созданные внутри контейнера через `ssh-keygen` и другие OpenSSH tools, остаются в workspace этого tenant
- существующие tenant SSH-файлы можно положить в `/workspace/.ssh`
- при необходимости можно явно указать другой путь к ключу через `-i /path/to/key`

Так как `/workspace` смонтирован как tenant bind mount, SSH-материалы, созданные там, сохраняются вместе с workspace этого tenant между перезапусками контейнера.

## Запуск на конкретном порту

```bash
HOST_PORT=49602 OPENCODE_SERVER_PASSWORD='your-password' /home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh
```

Если этот порт уже опубликован другим `opencode-serve-*` container, launcher возьмет следующий свободный порт и выведет выбранное значение.

## Глобальные Telegram app credentials

Launcher по умолчанию задает:

```text
TG_API_ID=29814416
TG_API_HASH=58768c18060fee87a1ce635fefd959ab
```

Эти значения глобальные и одинаковые для всех портов.

## Как работает изоляция Telegram session

Wrapper внутри контейнера:

```text
/usr/local/bin/opencode-tg-cli
```

Он всегда использует state-backed каталоги внутри `/state/tg-cli`:

```text
/state/tg-cli/workspaces/<TG_ID>/.tg-cli
/state/tg-cli/data/messages.db
```

У каждого tenant свой каталог Telegram auth/session и своя база/кэш.

Типичное расположение session-файла:

```text
/state/tg-cli/workspaces/<TG_ID>/.tg-cli/<TG_ID>.session.string
```

## Как OpenCode видит tg-cli

Launcher материализует tenant-visible skills в:

```text
/state/skills/tg-cli/SKILL.md
/state/skills/embedding-strategies/SKILL.md
```

Сгенерированный tenant config в `/state/config/opencode.json` указывает `skills.paths` только на:

```text
/state/skills
```

Также контейнер запускается с `OPENCODE_DISABLE_EXTERNAL_SKILLS=true`, поэтому посторонние project `.claude/skills` и `.agents/skills` не подгружаются в изолированную сессию автоматически.

Этот skill говорит OpenCode использовать:

```text
/usr/local/bin/opencode-tg-cli
```

для Telegram-задач вместо прямой работы с session-файлами.

## Первый Telegram login для нового порта

Типовой сценарий первой авторизации:

1. запустить сервер на нужном порту
2. проверить статус авторизации
3. либо запустить QR-авторизацию или login по коду, либо импортировать готовую session
4. далее тот же порт будет переиспользовать сохраненную session

### Проверить статус авторизации внутри контейнера

```bash
/usr/local/bin/opencode-tg-cli status --yaml
/usr/local/bin/opencode-tg-cli whoami --yaml
```

### Запустить QR login

```bash
/usr/local/bin/opencode-tg-cli login-qr --json
```

С `--json` команда стримит JSONL-события во время ожидания:
- `qr_ready`
- `qr_rotated`
- `password_required`
- `authenticated`

Для `qr_ready` и `qr_rotated` используйте `png_path`, если он есть, либо рендерьте QR из `qr_url`.
Если Telegram ротировал токен, отправьте обновленный QR повторно, не перезапуская авторизацию.

### Запустить login по коду

```bash
/usr/local/bin/opencode-tg-cli login-start +15551234567 --yaml
```

Ответ содержит `phone_code_hash`. Нужно сохранить именно это значение для текущей попытки логина.
Дальше передать код из чата:

```bash
/usr/local/bin/opencode-tg-cli login-complete +15551234567 12345 --phone-code-hash <hash> --yaml
```

Не вызывайте `status`, `whoami`, `chats` или `login-start` повторно между `login-start` и `login-complete`, иначе Telegram может выдать новый код и сделать предыдущий недействительным.

Если Telegram запросит 2FA-пароль:

```bash
/usr/local/bin/opencode-tg-cli login-password --password 'your-password' --yaml
```

### Импортировать готовую session string

```bash
printf '%s' "$TG_SESSION" | /usr/local/bin/opencode-tg-cli session import
```

### Необязательный интерактивный fallback внутри контейнера

Если нужен именно terminal-driven login, можно по-прежнему открыть shell и выполнить старую интерактивную команду:

```bash
docker exec -it opencode-serve-49601 sh
/usr/local/bin/opencode-tg-cli auth login
```

## Подключение из клиента OpenCode

```bash
opencode attach http://127.0.0.1:49602
```

## Решение проблем

### Не найден required local base image

Нужно один раз загрузить или получить его локально, после чего дальнейшие пересборки останутся локальными.

### Docker по-прежнему требует sudo или недоступен

Эти скрипты рассчитаны на доступ к Docker от текущего пользователя. Если они сообщают, что Docker daemon недоступен, нужно либо запустить пользовательский Docker daemon, либо дать этому пользователю доступ к Docker без `sudo`.

### cliproxyapi не работает из контейнера

Убедитесь, что хостовый сервис доступен из контейнера по `192.168.2.166:8317`.
Launcher по умолчанию использует `http://192.168.2.166:8317/v1`.

### На новом порту нет Telegram auth

Это нормально.
У каждого порта своя Telegram session directory, поэтому для новой workspace нужно один раз выполнить login или import session.

### Ошибка после логина с `wal_checkpoint`

Скрипт избегает этой проблемы, потому что хранит OpenCode DB отдельно в:

```text
/home/me/Workspaces/<PORT>/.opencode-data
```
