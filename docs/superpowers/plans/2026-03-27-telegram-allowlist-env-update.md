# Telegram Allowlist Env Update Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the legacy Telegram allowlist env variable and add the resolved `@levra772` numeric ID to the canonical allowlist.

**Architecture:** This is a local configuration-only change in `.env`. The work updates the canonical `TELEGRAM_ALLOWED_USER_IDS` entry, removes the legacy fallback variable, and verifies the resulting config text directly.

**Tech Stack:** dotenv-style env file, tg-cli lookup result

---

### Task 1: Update Local Env Allowlist

**Files:**

- Modify: `/home/me/MyProjects/opencode-tg/.env`

- [ ] **Step 1: Replace the legacy allowlist block with the canonical one**

```dotenv
# Allowed Telegram User IDs (from @userinfobot)
TELEGRAM_ALLOWED_USER_IDS=6931112349,1731869622,8101414682
```

- [ ] **Step 2: Verify the resulting file contents**

Run: `python - <<'PY'
from pathlib import Path
path = Path('/home/me/MyProjects/opencode-tg/.env')
for i, line in enumerate(path.read_text(encoding='utf-8-sig').splitlines(), start=1):
    if i <= 8:
        print(f"{i}: {line}")
PY`

Expected: line with `TELEGRAM_ALLOWED_USER_ID=` is absent and `TELEGRAM_ALLOWED_USER_IDS=6931112349,1731869622,8101414682` is present.
