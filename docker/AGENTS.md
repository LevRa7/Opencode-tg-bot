# Global AGENTS.md

These instructions apply to ALL runtimes built from this image (Docker containers, VMs).
They are maintained by the project owner and synchronized across tenants.

---

## Telegram File Delivery (`tg-uploader`)

### Mandatory delivery rule

**After ANY file write (source code, text, markdown, config, log — any format), you MUST deliver the file to the user via Telegram.** This is not optional. The sequence is:

1. `write` or `edit` tool → file saved to disk
2. `npx tsx scripts/current-chat.ts` → get (chatId, messageThreadId)
3. `npx tsx scripts/tg-upload.ts --auto --file <path> --chat-id <chatId> --thread-id <messageThreadId>` → send file

Never skip step 3. Never just print "file saved to /path/to/file". If multiple files are written in sequence, batch them into one upload call or send each. Violating this rule is a critical failure.

### Target resolution priority (highest first)

1. **`TG_CHAT_ID` + `TG_MESSAGE_THREAD_ID` env vars** — set by the bot when spawning the agent (container/VM mode)
2. **Bot HTTP endpoint** `GET http://127.0.0.1:8080/api/session/:id/target` — authoritative in-memory state, always correct
3. **`/tmp/tg-current-chat.json` cache** — written by the bot on each active session binding; TTL 1 hour
4. **`settings.db` SQLite fallback** — `tg-chat-lookup.ts --auto` queries database for most recent session

### Delivery methods

| Method | When | Max size |
|--------|------|----------|
| `scripts/tg-upload.ts --auto --file <path>` | Standalone file delivery | 50 MB |
| `scripts/tg-upload.ts --auto --file <path> --response-text "..."` | File + agent response in one message | caption 1024 |
| `scripts/tg-upload.ts --auto --file <path> --response-file <path>` | File + response from file in caption | caption 1024 |
| `sendDownloadedFile(ctx, path)` | Inside bot handler with grammY Context | 50 MB |
| Telegraph article + link in chat | Long reports (>4096 chars) or files >50 MB | 64 KB body |
| `prepareLocalFileFollowUps(text)` | Auto-detect file paths in agent replies | 20 MB/file |
| ZIP archive | Multiple files, combined <50 MB | 50 MB |

### Rules

- **Use bot account, not tg-cli.** Send files via `tg-upload.ts` (Bot API). `tg-cli` is only for searching chats/contacts or forwarding to Saved Messages — never for replying in the current chat.
- Include `messageThreadId` so replies land in the correct forum topic.
- Bot API token is read automatically from `.env`.
- For Telegraph: requires `TELEGRAPH_ACCESS_TOKEN` in `.env`.
- Auto-detect current chat: `npx tsx scripts/current-chat.ts`

---

## tg-cli Usage Policy

**tg-cli is a SUPPLEMENTARY tool, not a primary delivery mechanism.**

### When to use tg-cli

| Use case | Command |
|----------|---------|
| Search chats and messages | `tg search "query" --yaml -n 20` |
| Get chat/user details (username, phone, ID) | `tg info "ChatName" --yaml` |
| List all chats | `tg chats` |
| Forward files to user's contacts or Saved Messages | `tg send ...` |
| Export chat history | `tg export ...` |
| Contact lookup by name | `tg search "Name" --yaml` |

### When NOT to use tg-cli

- **NEVER use tg-cli to reply in the current chat.** Use `tg-upload.ts` (Bot API) instead.
- **NEVER use tg-cli to deliver generated files back to the user.** Use `tg-upload.ts`.
- **NEVER use tg-cli tokens for bot operations.** Bot API and tg-cli have separate auth.

### Priority for contact lookup

When the user asks for a person's contact, use **tg-cli first** — search Telegram chats and messages before consulting any other source. Telegram is the primary contact directory.

---

## VPN Setup (`install-vpn`)

When the user requests VPN setup, DPI bypass, or network access tools, use the `install-vpn` skill. Three methods are available:

| Method | Complexity | Obfuscation | Best for |
|--------|-----------|-------------|----------|
| **Tailscale** | Low | None (WireGuard) | Quick setup, personal use |
| **AmneziaWG** | Medium | Junk packets + header obfuscation | Moderate DPI, port 443 masking |
| **3x-ui + VLESS + XHTTP + REALITY** | High | Full (REALITY + XHTTP) | Strong DPI, professional use |

### Rules

- Ask the user about their needs before selecting a method.
- Never expose VPN keys, private keys, or API tokens in logs or code.
- Use absolute paths for all config files.
- Verify connectivity after setup: check `2ip.ru` shows the server IP.

---

## Media Transcription (`openai-media-transcriber`)

Use `/usr/local/bin/opencode-gemini-media` for media processing — do not make ad-hoc HTTP requests.

```bash
/usr/local/bin/opencode-gemini-media photo <filePath> [prompt]
/usr/local/bin/opencode-gemini-media audio <filePath> [prompt]
/usr/local/bin/opencode-gemini-media video <filePath> [prompt]
/usr/local/bin/opencode-gemini-media document <filePath> [prompt]
```

- Do not store upstream API URLs or keys in project files.
- The helper talks only to a localhost proxy; upstream credentials stay protected.

---

## Docker container utilities

### Whisper STT batch transcription

The container includes scripts for batch-transcribing voice messages (`.ogg`) and video circles (`.mp4`) using the Whisper STT API.

**Environment variables** (set in container or via `docker exec -e`):

| Variable | Default | Description |
|----------|---------|-------------|
| `STT_API_URL` | `http://192.168.2.166:1488/v1` | Whisper API endpoint |
| `STT_API_KEY` | _(required)_ | API authentication key |
| `STT_MODEL` | `medium` | Whisper model name |
| `STT_LANGUAGE` | `ru` | Target language code |
| `BATCH_SIZE` | `10` | Parallel transcription jobs |

**Usage:**

```bash
# Bash version (recommended, uses curl + parallel jobs)
docker exec -it <container> batch-transcribe /path/to/audio/dir

# Node.js version (Promise.all batching)
docker exec -it <container> batch-transcribe-node /path/to/audio/dir

# With custom batch size
docker exec -it -e BATCH_SIZE=5 <container> batch-transcribe /path/to/audio/dir
```

**Behavior:**
- Recursively scans the target directory for `.ogg` and `.mp4` files
- Skips files that already have a `.transcribed.txt` result
- Writes transcription output to `<filename>.transcribed.txt` next to the source
- Processes files in parallel batches (default: 10 concurrent jobs)
- Exits with code 1 if any transcriptions failed

---

## GUI Automation (`gui-automation`)

When automating GUI interactions in X11 environments, use the `gui-automation` skill. It provides:

- Natural mouse movement with Bezier curves
- Click by coordinates or template image matching (OpenCV)
- Human-like keyboard input with variable speed and optional typos
- CAPTCHA solving (OCR + click-based)
- Anti-detection patterns (jitter, overshoot, variable speed)

### Companion skills

| Skill | Purpose |
|-------|---------|
| `screen-manager` | Xvfb virtual display, xdotool/wmctrl window control |
| `visual-browser` | Chromium via CDP + Playwright: navigate, click, type |
| `screenshot` | Screenshot via CDP, Playwright, scrot, ImageMagick |

Workflow: start `screen-manager` (Xvfb) → launch `visual-browser` (Chromium) → use `gui-automation` for mouse/keyboard → capture results with `screenshot`.
