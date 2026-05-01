# Reply Keyboard Auto-Expand Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Keep the reply keyboard collapsed after most bot responses, and auto-expand it only after `/start`, `/help`, and `/new`.

**Architecture:** Centralize the policy in the final assistant delivery path that currently auto-attaches `reply_markup`. The policy should inspect the triggering command and decide whether to include the reply keyboard, leaving command-specific inline keyboards unchanged.

**Tech Stack:** TypeScript, grammY, Vitest.

---

## File Structure

- Modify `/home/me/MyProjects/opencode-tg/src/bot/index.ts`: add centralized reply-keyboard auto-expand policy.
- Modify relevant tests under `/home/me/MyProjects/opencode-tg/tests/bot/`: verify `/start`, `/help`, `/new` expand and ordinary prompts do not.

### Task 1: Add Policy Tests

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/index.local-file-follow-up.test.ts`
- Modify: any additional targeted bot test file if a simpler coverage point exists after inspection.

- [ ] **Step 1: Write failing tests for the allowed commands**

Cover `/start`, `/help`, and `/new` responses so final bot replies still include `reply_markup` when those commands are the trigger.

- [ ] **Step 2: Write failing test for ordinary responses**

Cover a normal prompt/assistant response so final bot replies do not include `reply_markup` when the keyboard should remain collapsed.

- [ ] **Step 3: Verify tests fail for the expected reason**

Run the targeted Vitest files.

Expected: at least one failure caused by the current unconditional keyboard attachment behavior.

### Task 2: Implement Central Policy

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts`

- [ ] **Step 1: Add a helper that decides whether reply keyboard should auto-expand**

The helper should return `true` only for `/start`, `/help`, and `/new`.

- [ ] **Step 2: Apply that helper in the final assistant delivery path**

If the policy says `false`, drop `reply_markup` from the final response options. If `true`, keep the keyboard attachment behavior as before.

- [ ] **Step 3: Avoid changing unrelated paths**

Do not alter inline keyboards, explicit menu responses, or command handlers that intentionally attach other reply markup.

### Task 3: Verify Behavior

**Files:**
- No new source changes unless verification reveals issues.

- [ ] **Step 1: Run the targeted bot tests**

Run the focused Vitest files used in Task 1.

Expected: PASS.

- [ ] **Step 2: Run a broader keyboard-related smoke check if needed**

Run any adjacent bot test file that covers final assistant delivery and reply keyboard handling.

Expected: PASS with no regressions.

## Self-Review

- Spec coverage: tests and implementation cover `/start`, `/help`, `/new` expansion and collapsed-by-default behavior for other responses.
- Placeholder scan: no placeholders remain.
- Type consistency: policy is centralized in one helper and applied only in the final assistant response path.
