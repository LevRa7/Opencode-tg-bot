# TG Export Full — Полная выгрузка и анализ диалогов

Выгружает личные диалоги и каналы собеседников: текст, медиа, расшифровка, RLM-анализ.

## Pipeline

```
export-dialogs.py     → чаты (JSON) + медиа (voice/photo/video_note)
       ↓
compress-media.sh     → сжатие голоса (8kbps), видео (5fps, 240p), фото (512px)
       ↓
transcribe-chunks.py  → расшифровка через Gemini 3 Flash с контекстом 30 сообщений
       ↓
rlm-process.py        → RLM-анализ: чанки → рекурсивная суммаризация → отчёт
```

## Prerequisites

```bash
# tg-cli (авторизация)
uv tool install kabi-tg-cli
tg status  # залогиниться

# ffmpeg
sudo apt install ffmpeg

# Gemini proxy (должен быть запущен)
# http://127.0.0.1:18124
```

## Usage

### 1. Выгрузка диалогов и медиа

```bash
cd /home/me/MyProjects/opencode-tg/.worktrees/terminal-agent

# Все диалоги с >20 сообщениями + их каналы
EXPORT_MIN_MESSAGES=20 \
/home/me/.local/share/uv/tools/kabi-tg-cli/bin/python \
  docker/opencode-skills-pkg/skills/utility/tg-export-full/export-dialogs.py

# Env vars:
#   EXPORT_DIR        — куда сохранять (default: /home/me/opencode-tg/exports)
#   EXPORT_MIN_MESSAGES — минимум сообщений для выгрузки (default: 20)
#   EXPORT_MEDIA_DAYS — за сколько дней качать медиа (default: 365)
#   EXPORT_MSG_LIMIT  — лимит сообщений на чат (default: 5000)
```

### 2. Сжатие медиа

```bash
bash docker/opencode-skills-pkg/skills/utility/tg-export-full/compress-media.sh \
  /home/me/opencode-tg/exports/media \
  /home/me/opencode-tg/exports/media-compressed
```

Параметры сжатия:
- **Голос:** 8kbps opus mono, 8kHz — качество рации
- **Видео:** 240p, 5fps, 50kbps — минимальный размер
- **Фото:** 512px по большей стороне, JPEG q15

### 3. Расшифровка медиа

```bash
TRANSCRIBE_MEDIA_DIR=/home/me/opencode-tg/exports/media-compressed \
TRANSCRIBE_CHATS_DIR=/home/me/opencode-tg/exports/chats \
TRANSCRIBE_CONTEXT=30 \
python3 docker/opencode-skills-pkg/skills/utility/tg-export-full/transcribe-chunks.py
```

Каждый медиа-файл расшифровывается с контекстом 30 предшествующих сообщений.
Требуется Gemini-прокси на `http://127.0.0.1:18124`.

### 4. RLM-анализ

```bash
RLM_TRANSCRIPTS_DIR=/home/me/opencode-tg/exports/transcripts \
RLM_CHATS_DIR=/home/me/opencode-tg/exports/chats \
python3 docker/opencode-skills-pkg/skills/utility/tg-export-full/rlm-process.py
```

Метод RLM (Recursive Language Models):
1. Данные разбиваются на чанки по 100 строк
2. Каждый чанк суммаризируется через Gemini
3. Суммаризации рекурсивно объединяются
4. Финальный структурированный отчёт в Markdown

## Output Structure

```
exports/
├── chats/                    # JSON с сообщениями
│   ├── Миша_Брат.json
│   ├── Миша_Брат_channel_Просто_мои_фоточки.json
│   └── ...
├── media/                    # Исходные медиа
│   └── Миша_Брат/
│       ├── voice/
│       ├── photo/
│       └── video_note/
├── media-compressed/         # Сжатые медиа
├── transcripts/              # Расшифровки (.txt)
│   └── Миша_Брат/
│       ├── voice/
│       ├── photo/
│       └── video_note/
└── rlm-output/               # RLM-отчёты (Markdown)
    └── Миша_Брат_analysis.md
```

## One-liner (весь пайплайн)

```bash
# 1. Выгрузка
/home/me/.local/share/uv/tools/kabi-tg-cli/bin/python \
  docker/opencode-skills-pkg/skills/utility/tg-export-full/export-dialogs.py

# 2. Сжатие
bash docker/opencode-skills-pkg/skills/utility/tg-export-full/compress-media.sh

# 3. Расшифровка (требует Gemini proxy)
python3 docker/opencode-skills-pkg/skills/utility/tg-export-full/transcribe-chunks.py

# 4. RLM-анализ (требует Gemini proxy)
python3 docker/opencode-skills-pkg/skills/utility/tg-export-full/rlm-process.py
```

## Notes

- Gemini proxy (`opencode-gemini-media`) должен быть запущен для шагов 3 и 4
- Для шага 1 требуется авторизация в tg-cli
- Медиа скачиваются только за последний год (настраивается)
- RLM использует итеративный подход для обхода ограничений контекстного окна
