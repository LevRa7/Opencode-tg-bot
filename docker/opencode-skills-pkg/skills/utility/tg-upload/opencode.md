# TG Upload — Telegram File Delivery

Send files, text, and Telegraph articles to Telegram chats.

## Prerequisites

```bash
npm install better-sqlite3 dotenv express qrcode tsx
```

## Required env

```
TELEGRAM_BOT_TOKEN=<bot-token>
```

## Commands

```bash
npx tsx tg-upload.ts --session-id <id> --file <path>
npx tsx tg-upload.ts --session-id <id> --photo <path>
npx tsx tg-upload.ts --auto --file <path>
npx tsx tg-upload.ts --session-id <id> --text "message"
npx tsx tg-upload.ts --session-id <id> --telegraph --title "X" --body "..."
npx tsx tg-upload.ts --session-id <id> --qr "https://..."
```

## chat-lookup

```bash
npx tsx tg-chat-lookup.ts <session-id>
```
