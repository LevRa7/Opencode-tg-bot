# Docker Bind And Telegram Quote Formatting Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish secret-file delivery for media/image proxies, expose OpenCode serve on `0.0.0.0`, and adjust Telegram quote formatting for active agents and thinking messages.

**Architecture:** Keep Docker secret delivery host-only via read-only mounted env files under `/run/opencode-secrets`, with entrypoint-owned proxy configs under `/run`. Keep Telegram formatting logic isolated to the bot rendering path so transport and UI changes do not couple.

**Tech Stack:** Bash launcher/entrypoint, Node proxy helpers, TypeScript Telegram bot code, Vitest, shell tests.

---

## File Structure

- Modify `docker/run-opencode-serve.sh`: stop passing upstream secrets as container env, mount host-only secret files, bind host port on `0.0.0.0`.
- Modify `docker/bin/docker-entrypoint.sh`: read mounted secret files and generate root-only runtime proxy config.
- Modify Docker tests under `docker/tests/`: assert secret-file mounts and `0.0.0.0` host bind.
- Modify Telegram bot rendering code in `src/bot/...`: use open quote for agent activity, plain text for `bot.thinking`, keep reasoning in expandable quote.
- Modify affected bot tests under `tests/bot/...`.

### Task 1: Secret File Mounts And Host Bind

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/docker/run-opencode-serve.sh`
- Modify: `/home/me/MyProjects/opencode-tg/docker/bin/docker-entrypoint.sh`
- Modify: `/home/me/MyProjects/opencode-tg/docker/tests/run-opencode-serve.test.sh`

- [ ] **Step 1: Verify failing expectations around launcher output**

Run: `bash tests/run-opencode-serve.test.sh`

Expected before fix: a failure if secrets are still passed as `-e` env vars or if bind remains `127.0.0.1`.

- [ ] **Step 2: Stop passing GPT/media upstream secrets as container env**

Update launcher to mount:

```text
${CONFIG_DIR}/gemini-media.env -> /run/opencode-secrets/gemini-media.env:ro
${CONFIG_DIR}/gpt-image.env -> /run/opencode-secrets/gpt-image.env:ro
```

and remove `GEMINI_MEDIA_UPSTREAM_*` / `GPT_IMAGE_UPSTREAM_*` from `docker run -e`.

- [ ] **Step 3: Change host publish address to `0.0.0.0`**

Update the launcher log line and `docker run -p` mapping so the host bind becomes:

```text
0.0.0.0:${HOST_PORT}:${CONTAINER_PORT}
```

- [ ] **Step 4: Make entrypoint read mounted secret files**

Read `/run/opencode-secrets/gemini-media.env` and `/run/opencode-secrets/gpt-image.env` inside `docker-entrypoint.sh`, then write runtime JSON configs under `/run/opencode-gemini-media/config.json` and `/run/opencode-gpt-image/config.json` with mode `0600`.

- [ ] **Step 5: Re-run launcher regression test**

Run: `bash tests/run-opencode-serve.test.sh`

Expected: PASS and output contains `ok`.

### Task 2: Telegram Quote Formatting

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/utils/thinking-message.js` or the actual thinking formatter module discovered in the codebase
- Modify tests under `/home/me/MyProjects/opencode-tg/tests/bot/` that assert quote formatting for subagents/thinking

- [ ] **Step 1: Identify failing tests for current formatting**

Run the smallest existing relevant test file once the exact files are known.

Expected before fix: assertions still expect the old quote style.

- [ ] **Step 2: Render active agent block as open quote**

Update the agent activity rendering path so the “running agents” block uses a non-expandable/open quote.

- [ ] **Step 3: Render `bot.thinking` without quote**

Keep the visible “Thinking...” placeholder as plain text, not inside any quote wrapper.

- [ ] **Step 4: Keep actual reasoning in expandable quote**

Do not change the reasoning/thought body behavior beyond preserving expandable quote formatting.

- [ ] **Step 5: Re-run targeted bot tests**

Run the affected bot test files.

Expected: PASS.

### Task 3: Full Verification And Image Rebuild

**Files:**
- No new source changes unless verification reveals issues.

- [ ] **Step 1: Run Docker helper/isolation suite**

Run:

```bash
bash tests/gemini-media-image.test.sh
bash tests/gpt-image-skill.test.sh
bash tests/tenant-entrypoint-permissions.test.sh
```

Expected: all PASS.

- [ ] **Step 2: Rebuild the Docker image**

Run: `./build-opencode-tg-image.sh`

Expected: image `opencode-tg:local` rebuilds successfully.

- [ ] **Step 3: Verify rebuilt image helpers exist**

Run a container command confirming both helpers and both proxies exist.

- [ ] **Step 4: Verify no upstream secrets are exposed in tenant env/config**

Check that runtime config files exist under `/run/...` with `0600`, while tenant-readable config/output do not contain upstream endpoints/keys.

## Self-Review

- Spec coverage: secret-file delivery, public host bind, and Telegram quote formatting are all covered with implementation and verification steps.
- Placeholder scan: no placeholders remain.
- Type consistency: uses the same paths, helper names, and bind host throughout the plan.
