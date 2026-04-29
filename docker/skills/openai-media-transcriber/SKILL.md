---
name: openai-media-transcriber
description: Use the container-provided media transcription helper for local audio, video, photo, and document analysis without exposing upstream Gemini API credentials in the tenant workspace.
---

# openai-media-transcriber

Use `/usr/local/bin/opencode-gemini-media` for secure media processing in this Docker workspace.

## Commands

```bash
/usr/local/bin/opencode-gemini-media audio <filePath> [prompt]
/usr/local/bin/opencode-gemini-media video <filePath> [prompt]
/usr/local/bin/opencode-gemini-media photo <filePath> [prompt]
/usr/local/bin/opencode-gemini-media document <filePath> [prompt]
```

## Rules

- Always use `/usr/local/bin/opencode-gemini-media`, not ad-hoc HTTP requests.
- Do not store upstream API URLs or keys in project files.
- Do not read, create, or request `.env` files for this tool.
- The helper talks only to a localhost proxy; upstream credentials stay in a protected runtime config.
- The helper returns only the model output.
- Use absolute file paths when possible.

## Default prompts

- `audio`: faithful transcript of spoken audio
- `video`: describe visual content and transcribe spoken audio
- `photo`: describe the visible content and extract readable text
- `document`: extract readable text and preserve structure when possible
