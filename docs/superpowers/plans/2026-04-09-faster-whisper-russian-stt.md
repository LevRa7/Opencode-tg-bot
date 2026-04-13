# Faster-Whisper Russian STT Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Run a local Russian speech-to-text service on `Ryzen 9 5950X` with `faster-whisper`, expose it on port `1488`, secure it with a bearer token, start it automatically on boot, and point the bot at the new endpoint.

**Architecture:** Add a small Python STT service that implements the OpenAI-style `/v1/audio/transcriptions` contract the bot already uses. Keep the service CPU-only, bind it to `0.0.0.0` so it is reachable from any IP, and protect it with a single API token passed through `Authorization: Bearer ...`. The bot keeps using its existing STT client; only `.env` and documentation need to change on the bot side.

**Tech Stack:** Python 3.13, `fastapi`, `uvicorn`, `faster-whisper`, `systemd`, existing TypeScript bot config, `.env`

---

### Task 1: Add the local STT service code

**Files:**
- Create: `stt-server/pyproject.toml`
- Create: `stt-server/app/main.py`
- Create: `stt-server/app/auth.py`
- Create: `stt-server/app/schemas.py`
- Create: `stt-server/README.md`
- Create: `stt-server/tests/test_auth.py`

- [ ] **Step 1: Write the failing test**

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_requires_bearer_token():
    response = client.post("/v1/audio/transcriptions")
    assert response.status_code == 401
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest stt-server/tests/test_auth.py -q`

Expected: FAIL because the app and auth layer do not exist yet.

- [ ] **Step 3: Write minimal implementation**

```python
from fastapi import Depends, FastAPI, UploadFile, File, Form

app = FastAPI()

@app.post("/v1/audio/transcriptions")
async def transcriptions(file: UploadFile = File(...), model: str = Form(...), response_format: str = Form("json"), language: str | None = Form(None), _=Depends(require_bearer_token)):
    return {"text": ""}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest stt-server/tests/test_auth.py -q`

Expected: PASS with HTTP 401 for requests without `Authorization: Bearer ...`.

- [ ] **Step 5: Commit**

```bash
git add stt-server
git commit -m "feat: add local faster-whisper stt service"
```

### Task 2: Implement transcription and model loading

**Files:**
- Modify: `stt-server/app/main.py`
- Modify: `stt-server/app/schemas.py`
- Create: `stt-server/tests/test_transcription.py`

- [ ] **Step 1: Write the failing test**

```python
from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


def test_returns_json_text_field_for_upload():
    response = client.post(
        "/v1/audio/transcriptions",
        files={"file": ("sample.wav", b"fake-audio", "audio/wav")},
        data={"model": "medium", "response_format": "json", "language": "ru"},
        headers={"Authorization": "Bearer test-token"},
    )

    assert response.status_code == 200
    assert response.json()["text"] == "..."
```

- [ ] **Step 2: Run test to verify it fails**

Run: `python -m pytest stt-server/tests/test_transcription.py -q`

Expected: FAIL until the handler loads the model and returns a transcription response.

- [ ] **Step 3: Write minimal implementation**

```python
from faster_whisper import WhisperModel

model = WhisperModel("medium", device="cpu", compute_type="int8")
```

- [ ] **Step 4: Run test to verify it passes**

Run: `python -m pytest stt-server/tests/test_transcription.py -q`

Expected: PASS once the endpoint accepts uploads, transcribes with `faster-whisper`, and returns `{"text": ...}`.

- [ ] **Step 5: Commit**

```bash
git add stt-server
git commit -m "feat: transcribe russian speech with faster-whisper"
```

### Task 3: Add deployment and auto-start

**Files:**
- Create: `stt-server/systemd/faster-whisper-stt.service`
- Create: `stt-server/scripts/install-service.sh`
- Create: `stt-server/scripts/uninstall-service.sh`

- [ ] **Step 1: Write the failing test**

```bash
test -f stt-server/systemd/faster-whisper-stt.service
test -f stt-server/scripts/install-service.sh
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash -lc 'test -f stt-server/systemd/faster-whisper-stt.service && test -f stt-server/scripts/install-service.sh'`

Expected: FAIL until the unit and helper scripts exist.

- [ ] **Step 3: Write minimal implementation**

```ini
[Service]
Environment=STT_HOST=0.0.0.0
Environment=STT_PORT=1488
ExecStart=/usr/bin/python3 -m uvicorn app.main:app --host 0.0.0.0 --port 1488
Restart=always
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash -lc 'test -f stt-server/systemd/faster-whisper-stt.service && test -f stt-server/scripts/install-service.sh'`

Expected: PASS once the unit and installer are present.

- [ ] **Step 5: Commit**

```bash
git add stt-server
git commit -m "feat: add systemd startup for stt service"
```

### Task 4: Update bot configuration and docs

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/.env`
- Modify: `/home/me/MyProjects/opencode-tg/.env.example`
- Modify: `/home/me/MyProjects/opencode-tg/README.md`
- Modify: `/home/me/MyProjects/opencode-tg/PRODUCT.md`
- Modify: `/home/me/MyProjects/opencode-tg/CHANGELOG.md`

- [ ] **Step 1: Write the failing test**

```bash
grep -n "STT_API_URL=http://127.0.0.1:1488/v1" /home/me/MyProjects/opencode-tg/.env
```

- [ ] **Step 2: Run test to verify it fails**

Run: `bash -lc 'grep -n "STT_API_URL=http://127.0.0.1:1488/v1" /home/me/MyProjects/opencode-tg/.env'`

Expected: FAIL until the bot config points at the local service and uses the generated token.

- [ ] **Step 3: Write minimal implementation**

```env
STT_API_URL=http://127.0.0.1:1488/v1
STT_API_KEY=<generated-token>
STT_MODEL=medium
STT_LANGUAGE=ru
```

- [ ] **Step 4: Run test to verify it passes**

Run: `bash -lc 'grep -n "STT_API_URL=http://127.0.0.1:1488/v1" /home/me/MyProjects/opencode-tg/.env'`

Expected: PASS once the config references the new STT endpoint and model.

- [ ] **Step 5: Commit**

```bash
git add /home/me/MyProjects/opencode-tg/.env.example /home/me/MyProjects/opencode-tg/README.md /home/me/MyProjects/opencode-tg/PRODUCT.md /home/me/MyProjects/opencode-tg/CHANGELOG.md
git commit -m "docs: point bot stt config at local faster-whisper"
```

Note: `/home/me/MyProjects/opencode-tg/.env` is updated locally for this server, but it is not committed because it contains secrets.

### Task 5: Verify end-to-end behavior

**Files:**
- Test: `stt-server/tests/test_transcription.py`
- Test: `/home/me/MyProjects/opencode-tg/tests/...` if bot config parsing changes become necessary

- [ ] **Step 1: Run service checks**

Run:
```bash
python -m pytest stt-server/tests -q
```

Expected: all local STT tests pass.

- [ ] **Step 2: Run bot checks**

Run:
```bash
cd /home/me/MyProjects/opencode-tg
npm run build
npm run lint
npm test
```

Expected: all bot checks pass without STT-related regressions.

- [ ] **Step 3: Manually validate the live endpoint**

Run:
```bash
curl -sS http://127.0.0.1:1488/v1/audio/transcriptions \
  -H "Authorization: Bearer <generated-token>" \
  -F "file=@sample.wav" \
  -F "model=medium" \
  -F "response_format=json" \
  -F "language=ru"
```

Expected: JSON response with a `text` field.

- [ ] **Step 4: Validate Telegram voice flow**

Expected: a Russian voice message is transcribed, then forwarded to OpenCode as a normal prompt.

- [ ] **Step 5: Finalize**

Expected deliverable: local STT service running on port `1488`, boot-enabled via `systemd`, with the bot configured to use it.
