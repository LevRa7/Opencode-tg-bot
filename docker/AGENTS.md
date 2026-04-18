# Global AGENTS.md

These instructions apply to ALL containers built from this image.
They are maintained by the project owner and synchronized across tenants.

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
