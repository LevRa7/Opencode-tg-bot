# Session NotFoundError After VM Reboot — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Eliminate `NotFoundError: Session not found` for VM users after bot restart/VM recreation, and prevent VM destruction on bot restart.

**Architecture:** Two changes: (1) Session verification in `prompt.ts` before `session.promptAsync` for VM users, mirroring the existing SSH session check. (2) VM state preservation in `lifecycle-manager.ts` — when `vm.attach()` fails during recovery, try `virsh start` before destroying and recreating.

**Tech Stack:** TypeScript, OpenCode SDK, libvirt (virsh), SQLite

---

## Fix 1: Session verification for VM users before prompt

### Task 1: Write failing test — session not found triggers recreation

**Objective:** When `getCurrentSession()` returns a session that no longer exists on the VM's opencode server, the bot should clear it and create a new one.

**Files:**
- Create: `tests/bot/handlers/prompt-session-verify.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock the opencode client
vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      get: vi.fn(),
      create: vi.fn(),
      promptAsync: vi.fn(),
      status: vi.fn(),
    },
  },
}));

import { opencodeClient } from "../../../src/opencode/client.js";

describe("processUserPrompt — VM session verification", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("clears session and creates new one when VM session not found", async () => {
    // Simulate: getCurrentSession returns a cached session
    // getUserDeployTarget returns "vm"
    // session.get() returns error (session not found on VM)
    // Expected: clearSession() is called, then session.create() is called
    // The new session should be used for promptAsync

    const mockGet = vi.mocked(opencodeClient.session.get);
    const mockCreate = vi.mocked(opencodeClient.session.create);

    // Session exists in cache but NOT on the VM
    mockGet.mockResolvedValueOnce({
      data: null,
      error: { name: "NotFoundError", message: "Session not found: ses_test123" },
    });

    // New session created successfully
    mockCreate.mockResolvedValueOnce({
      data: { id: "ses_new456", title: "New session", directory: "/" },
      error: null,
    });

    // The verification should happen BEFORE promptAsync
    // If get() returns error → clear + create
    expect(mockGet).toHaveBeenCalled();
    expect(mockCreate).toHaveBeenCalled();
  });

  it("uses existing session when VM session is found", async () => {
    const mockGet = vi.mocked(opencodeClient.session.get);
    const mockCreate = vi.mocked(opencodeClient.session.create);

    // Session exists both in cache AND on the VM
    mockGet.mockResolvedValueOnce({
      data: { id: "ses_test123", title: "Existing", directory: "/" },
      error: null,
    });

    // session.create should NOT be called
    expect(mockGet).toHaveBeenCalled();
    expect(mockCreate).not.toHaveBeenCalled();
  });
});
```

**Step 2: Run test to verify failure**

```bash
cd /home/me/opencode-tg/.worktrees/terminal-agent
npx vitest run tests/bot/handlers/prompt-session-verify.test.ts
```

Expected: FAIL — the current code only verifies SSH sessions, not VM sessions.

---

### Task 2: Run test, verify RED

```bash
npx vitest run tests/bot/handlers/prompt-session-verify.test.ts
```

---

### Task 3: Implement VM session verification in prompt.ts

**Files:**
- Modify: `src/bot/handlers/prompt.ts` (after line 776)

**Objective:** After the SSH session verification block (lines 754-776), add a VM session verification block that checks `getUserDeployTarget(userId) === "vm"` and verifies the session exists on the VM's opencode server.

**Implementation:**

Add after line 776 (after the SSH verification `}`), but before line 778:

```typescript
  // When deploy target is VM, the cached session may reference an opencode
  // server instance that was destroyed during VM recreation.  Verify it still
  // exists; if not, discard it so a fresh session is created transparently.
  if (currentSession && scope) {
    const deployTarget = getUserDeployTarget(scope.userId);
    if (deployTarget === "vm") {
      const sessionIdToVerify = currentSession.id;
      const sessionDirToVerify = currentSession.directory;
      try {
        const { data: sessionData, error: sessionErr } = await opencodeClient.session.get({
          directory: sessionDirToVerify,
          sessionID: sessionIdToVerify,
        });
        if (sessionErr || !sessionData) {
          logger.info(
            `[Bot] Session ${sessionIdToVerify} not found on VM server (likely VM recreated), discarding`,
          );
          clearSession();
          currentSession = null;
        }
      } catch {
        logger.warn(
          `[Bot] Failed to verify session ${sessionIdToVerify} on VM server, discarding`,
        );
        clearSession();
        currentSession = null;
      }
    }
  }
```

The import for `getUserDeployTarget` is already at line 7.

---

### Task 4: Run tests, verify GREEN

```bash
npx vitest run tests/bot/handlers/prompt-session-verify.test.ts
npx vitest run  # full suite
```

---

### Task 5: Build and deploy

```bash
cd /home/me/opencode-tg/.worktrees/terminal-agent
npx tsc
systemctl --user kill opencode-telegram-bot -s KILL 2>/dev/null
sleep 2
systemctl --user start opencode-telegram-bot
```

---

## Fix 2: VM preservation on bot restart (virsh start before destroy)

### Task 6: Write failing test — VM recovery preserves running VM

**Objective:** When `vm.attach()` fails during `acquire()` (VM exists but not running), the lifecycle manager should first try `virsh start` instead of immediately destroying and recreating the VM.

**Files:**
- Create: `tests/vm/lifecycle-recover-preserve.test.ts`

---

### Task 7: Run test, verify RED

---

### Task 8: Implement VM start-before-destroy in lifecycle-manager.ts

**Files:**
- Modify: `src/vm/lifecycle-manager.ts` (line 46-79 in `acquire()`)
- Modify: `src/vm/manager.ts` (add `startDomain` method if not exists)

**Implementation:**

In `acquire()`, when `vm.attach(existing)` returns null (line 76-79), instead of immediately deleting and recreating:

```typescript
      } else {
        // VM record exists but domain is not running.
        // Try to start it before destroying — preserves user sessions.
        try {
          const started = await vm.startDomain(existing.domainName);
          if (started) {
            const handle = await vm.attach(existing);
            if (handle) {
              const healthy = await hp.check(handle, {
                timeoutMs: options?.timeoutMs ?? 60_000,
                pollMs: options?.pollMs ?? 2000,
                signal,
              });
              if (healthy.healthy) {
                persistence.updateIfCurrent(existing.vmId, existing.version, { status: "healthy" });
                persistence.resetFailureCount(existing.vmId);
                setVmRuntimeInfo(userId, { /* existing info */ });
                return handle;
              }
              await vm.destroyHandle(handle);
            }
          }
        } catch (startErr) {
          logger.warn("[Lifecycle] Failed to start existing VM %s, will recreate: %s", userId, startErr);
        }
        persistence.incrementFailureCount(existing.vmId);
        logger.warn("[Lifecycle] VM %s exists but not running, re-provisioning", userId);
      }
```

---

### Task 9: Run tests, verify GREEN

---

### Task 10: Full test suite and build

```bash
npx vitest run
npx tsc
```

---

### Task 11: Deploy

```bash
systemctl --user kill opencode-telegram-bot -s KILL 2>/dev/null
sleep 2
systemctl --user start opencode-telegram-bot
```

---

### Task 12: Verify in logs

```bash
# After a user sends a message post VM recreation:
journalctl --user -u opencode-telegram-bot --since "1 minute ago" --no-pager | grep -E "(Session.*not found|VM.*discarding|Creating new session)"
# Expected: "Session ses_xxx not found on VM server, discarding" → "Created new session"
```
