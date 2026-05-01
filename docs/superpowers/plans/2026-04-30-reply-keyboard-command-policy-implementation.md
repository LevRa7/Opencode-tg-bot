# Reply Keyboard Command Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Auto-expand the reply keyboard only after `/start`, `/help`, and `/new`, while leaving it collapsed after other bot replies.

**Architecture:** Centralize the allowlist policy in a small helper and apply it anywhere reply keyboard markup is automatically attached to bot replies. Keep inline keyboards and explicit menu flows unchanged.

**Tech Stack:** TypeScript, grammY, Vitest.

---

## File Structure

- Modify `/home/me/MyProjects/opencode-tg/src/bot/utils/finalize-assistant-response.ts`: gate keyboard attachment by command policy.
- Modify command/handler files that currently auto-attach reply keyboards on replies outside `/start`, `/help`, `/new`.
- Modify tests under `/home/me/MyProjects/opencode-tg/tests/bot/`: verify allowlist and default-collapsed behavior.

### Task 1: Add Policy Tests

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/utils/finalize-assistant-response.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/help.test.ts`
- Modify: other small command test files only if needed for direct command coverage.

- [ ] **Step 1: Add failing allowlist tests**

Cover `/start`, `/help`, and `/new` paths so reply keyboard is attached there.

- [ ] **Step 2: Add failing default-collapsed test**

Cover a normal final assistant response so `reply_markup` is omitted.

- [ ] **Step 3: Run targeted tests to confirm RED**

Run the focused Vitest files.

Expected: at least one failure caused by current unconditional keyboard attachment in disallowed paths.

### Task 2: Implement Policy Helper

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/utils/finalize-assistant-response.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/help.ts`
- Modify: any other command/handler file discovered to auto-attach reply keyboards where the new policy says not to.

- [ ] **Step 1: Add `shouldAutoExpandReplyKeyboard(commandName)`**

Allow only `/start`, `/help`, and `/new`.

- [ ] **Step 2: Use the helper in final assistant delivery**

If the command is not allowlisted, omit `reply_markup` from the final assistant response.

- [ ] **Step 3: Align direct command replies**

Ensure `/help` explicitly attaches the keyboard. Leave `/start` and `/new` attaching it. Remove reply keyboard auto-attachment from non-allowlisted confirmation/status paths if they currently force expansion.

- [ ] **Step 4: Leave inline keyboards alone**

Do not change inline menu keyboards, question keyboards, permission keyboards, or any other non-reply-keyboard markup.

### Task 3: Verification

**Files:**
- No new source changes unless verification reveals issues.

- [ ] **Step 1: Run targeted keyboard policy tests**

Run the focused Vitest files changed in Task 1.

Expected: PASS.

- [ ] **Step 2: Run adjacent bot keyboard/response smoke tests**

Run any additional small bot test files needed to confirm no regression in response finalization and command replies.

Expected: PASS.

## Self-Review

- Spec coverage: allowlisted commands expand, ordinary replies stay collapsed, inline keyboards remain unchanged.
- Placeholder scan: no placeholders remain.
- Type consistency: command allowlist is centralized and applied only to reply keyboard attachment paths.
