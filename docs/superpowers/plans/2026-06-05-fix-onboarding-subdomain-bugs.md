# Fix Onboarding & Subdomain Bugs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix two bugs: (1) infinite session creation loop when new user approves bot, (2) "Unknown subdomain" error when accessing web version.

**Architecture:** Bug 1 is a port-sync gap between ProcessManager (Node.js) and Docker launch script (bash). Bug 2 is a case-sensitivity mismatch between stored subdomain (preserves Telegram username case) and browser `Host` header (lowercased by RFC). Both need tests + targeted fixes.

**Tech Stack:** TypeScript, Vitest, better-sqlite3, Docker/bash

---

### Task 1: Write failing test for subdomain case sensitivity

**Files:**
- Modify: `tests/server/subdomain-manager.test.ts`
- Test direct: `npx vitest run tests/server/subdomain-manager.test.ts`

- [ ] **Step 1: Add case-sensitivity test for resolveSubdomain**

Add to `describe("resolveSubdomain")` in `tests/server/subdomain-manager.test.ts`:

```typescript
it("should resolve subdomain case-insensitively (stored as JohnDoe, queried as johndoe)", () => {
  const repo = mockRepo([{
    user_id: 456, username: "JohnDoe", subdomain: "JohnDoe",
    password_hash: "hash", kind: "tenant", created_at: "2026-01-01",
    ssh_connection_id: null, hostname: null,
  }]);
  const mgr = new SubdomainManager(repo);
  // Browser sends lowercase host header
  const result = mgr.resolveSubdomain("johndoe");
  expect(result).toBeDefined();
  expect(result!.userId).toBe(456);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/server/subdomain-manager.test.ts -t "case-insensitively"`
Expected: FAIL — returns `null` because SQLite comparison is case-sensitive and `"JohnDoe" !== "johndoe"`

- [ ] **Step 3: Add case-sensitivity test for ensureSubdomain**

Add to `tests/server/subdomain-manager.test.ts` in `describe("ensureSubdomain")`:

```typescript
it("should lowercase subdomain when creating with mixed-case username", () => {
  const repo = mockRepo();
  const mgr = new SubdomainManager(repo);
  const result = mgr.ensureSubdomain(456, "JohnDoe", "host");
  expect(result.subdomain).toBe("johndoe");
});
```

- [ ] **Step 4: Run test to verify it fails**

Run: `npx vitest run tests/server/subdomain-manager.test.ts -t "lowercase subdomain"`
Expected: FAIL — returns `"JohnDoe"` instead of `"johndoe"`

### Task 2: Fix subdomain case sensitivity

**Files:**
- Modify: `src/server/subdomain-manager.ts:37,42-44,67,74`
- Modify: `src/server/proxy.ts:24`
- Test: `npx vitest run tests/server/subdomain-manager.test.ts`

- [ ] **Step 1: Normalize subdomain to lowercase in ensureSubdomain**

In `src/server/subdomain-manager.ts`, change line 37:
```typescript
const effectiveUsername = username?.replace(/^@/, "") || `tg${userId}`;
```
to:
```typescript
const effectiveUsername = (username?.replace(/^@/, "") || `tg${userId}`).toLowerCase();
```

- [ ] **Step 2: Normalize subdomain to lowercase in ensureSshSubdomain**

In `src/server/subdomain-manager.ts`, change line 66:
```typescript
const effectiveUsername = username?.replace(/^@/, "") || `tg${userId}`;
```
to:
```typescript
const effectiveUsername = (username?.replace(/^@/, "") || `tg${userId}`).toLowerCase();
```

- [ ] **Step 3: Normalize lookup key in proxy.ts**

In `src/server/proxy.ts`, change line 24:
```typescript
subdomain = hostPart.slice(0, -(baseDomain.length + 1));
```
to:
```typescript
subdomain = hostPart.slice(0, -(baseDomain.length + 1)).toLowerCase();
```

- [ ] **Step 4: Run tests to verify fix**

Run: `npx vitest run tests/server/subdomain-manager.test.ts`
Expected: ALL PASS (including the new case-sensitivity tests)

### Task 3: Add test for proxy resolveProxyTarget case sensitivity

**Files:**
- Read: `tests/server/proxy.test.ts`
- Modify: `tests/server/proxy.test.ts`
- Test: `npx vitest run tests/server/proxy.test.ts`

- [ ] **Step 1: Read current proxy test structure**

Read `tests/server/proxy.test.ts` to understand existing mock setup.

- [ ] **Step 2: Add case-insensitive Host header test**

Add test to `tests/server/proxy.test.ts`:

```typescript
it("should resolve subdomain with case-insensitive Host header", () => {
  // Host: "JohnDoe.smart-server.online" should resolve same as "johndoe.smart-server.online"
  const result = resolveProxyTarget("JohnDoe.smart-server.online");
  // If subdomain "johndoe" exists in DB, should resolve
  // (test setup depends on existing mock structure)
});
```

Note: This test depends on the mock setup in proxy.test.ts. If `resolveProxyTarget` uses a singleton `SubdomainManager` that's hard to mock, we verify the normalization in subdomain-manager and proxy.ts unit tests instead, and add an integration-style check.

- [ ] **Step 3: Run tests to verify**

Run: `npx vitest run tests/server/proxy.test.ts`
Expected: PASS

### Task 4: Fix Docker port divergence between ProcessManager and run-opencode-serve.sh

**Files:**
- Create: `scripts/fix-port-divergence-plan.md` (analysis only)
- Modify: `src/process/manager.ts`
- Modify: `docker/run-opencode-serve.sh`
- Test: `npx vitest run tests/process/manager.test.ts` (if exists) or manual verification

- [ ] **Step 1: Read current ProcessManager test file(s)**

Check if tests exist at `tests/process/manager.test.ts`. If not, read `src/process/manager.ts` fully to understand how to test.

- [ ] **Step 2: Make Docker script output the actual HOST_PORT used**

In `docker/run-opencode-serve.sh`, add after line 415 (`HOST_PORT="$SELECTED_HOST_PORT"`):

```bash
# Signal the actual selected port to the parent process on a dedicated fd
echo "ACTUAL_PORT=${SELECTED_HOST_PORT}" >&3
```

This requires the Node.js side to open fd 3 before spawning. Alternatively (simpler): have the script print the port to stdout on a well-known prefix, and have Node.js capture stdout.

Better approach: Have the script print to stdout with a prefix that Node.js can parse:

```bash
echo "[TENANT_PORT]${SELECTED_HOST_PORT}[/TENANT_PORT]"
```

Node.js listens on stdout for this marker:

```typescript
const actualPort = await new Promise<number>((resolve, reject) => {
  const timeout = setTimeout(() => reject(new Error("Port sync timeout")), 10000);
  childProcess.stdout?.on("data", (data: Buffer) => {
    const text = data.toString();
    const match = text.match(/\[TENANT_PORT\](\d+)\[\/TENANT_PORT\]/);
    if (match) {
      clearTimeout(timeout);
      resolve(parseInt(match[1], 10));
    }
  });
});
```

Then update `baseUrl` and `port` in stored runtime info after capture.

- [ ] **Step 3: Remove select_free_host_port from Docker script (or make it never deviate)**

Alternative simpler fix: In `startTenantRuntime`, after spawning the script, check `docker port <container>` to get actual port mapping:

```typescript
async function getActualContainerPort(containerName: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`docker port ${containerName} 4096/tcp`);
    const match = stdout.trim().match(/:(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  } catch { return null; }
}
```

Then after `startTenantRuntime` completes, query docker port:

```typescript
const containerName = `opencode-serve-${runtime.tenantId.replace(/[^a-zA-Z0-9._-]/g, '-')}`;
const actualPort = await getActualContainerPort(containerName);
if (actualPort && actualPort !== runtime.port) {
  const actualBaseUrl = `http://127.0.0.1:${actualPort}`;
  await setTenantRuntimeInfo(userId, { ...runtime, port: actualPort, baseUrl: actualBaseUrl });
  // Wait for health on actual port
  const ready = await this.waitForTenantHealth(actualBaseUrl, userId);
  ...
}
```

This is more robust because it reads the actual Docker port mapping, regardless of how the script selects the port.

- [ ] **Step 4: Implement the fix in ProcessManager**

In `src/process/manager.ts`, modify `doEnsureTenantRuntime()` after `startTenantRuntime()` succeeds:

```typescript
const startResult = await this.startTenantRuntime({ ... });
if (!startResult.success) return startResult;

// Query Docker for the actual host port (script may have selected different port)
const safeTenantId = runtime.tenantId.replace(/[^a-zA-Z0-9._-]/g, '-');
const containerName = `opencode-serve-${safeTenantId}`;
const actualPort = await getActualContainerPort(containerName);
const effectiveBaseUrl = actualPort ? `http://127.0.0.1:${actualPort}` : baseUrl;

if (actualPort && actualPort !== tenantPort) {
  logger.info(`[ProcessManager] Port diverged: Node.js selected ${tenantPort}, Docker uses ${actualPort}`);
  await setTenantRuntimeInfo(userId, { port: actualPort, baseUrl: effectiveBaseUrl });
}

const ready = await this.waitForTenantHealth(effectiveBaseUrl, userId);
```

Add helper:
```typescript
private async getActualContainerPort(containerName: string): Promise<number | null> {
  try {
    const { stdout } = await execAsync(`docker port ${containerName} 4096/tcp`);
    const match = stdout.trim().match(/:(\d+)$/);
    return match ? parseInt(match[1], 10) : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 5: Write tests for port divergence fix**

Create or modify `tests/process/manager.test.ts`:

```typescript
import { describe, it, expect, vi } from "vitest";

describe("ProcessManager port divergence", () => {
  it("should detect port divergence via docker port command", async () => {
    // Mock execAsync to return a different port than requested
    // Verify that baseUrl is updated to the actual port
  });

  it("should wait for health on the actual Docker port, not the requested one", async () => {
    // Mock docker port returning port 49601 while requested was 49600
    // Verify waitForTenantHealth is called with port 49601 baseUrl
  });
});
```

- [ ] **Step 6: Run tests**

Run: `npx vitest run tests/process/manager.test.ts`
Expected: PASS

### Task 5: Run full test suite and verify

- [ ] **Step 1: Run all server tests**

Run: `npx vitest run tests/server/`
Expected: ALL PASS

- [ ] **Step 2: Run full test suite**

Run: `npx vitest run`
Expected: ALL PASS (or at least no regressions)

- [ ] **Step 3: Build check**

Run: `npx tsc --noEmit`
Expected: No type errors

- [ ] **Step 4: Lint check**

Run: `npx eslint src/ --max-warnings 0` (or existing lint command)
Expected: No warnings/errors

- [ ] **Step 5: Update CHANGELOG.md**

Add entries:
```markdown
### Fixed

- **Subdomain case sensitivity:** Normalize subdomain to lowercase on creation and lookup to fix "Unknown subdomain" error for users with uppercase usernames
- **Tenant port divergence:** Query `docker port` after container start to detect if Docker selected a different host port than Node.js expected, preventing infinite tenant restart loop
```

- [ ] **Step 6: Update PRODUCT.md checkboxes if applicable**

Check if any open task in PRODUCT.md relates to these fixes.

---

## Summary of Root Causes

### Bug 1: Infinite session creation loop

**Root cause:** `ProcessManager.findFreeTenantPort()` checks port availability via HTTP GET `/health` (returns `false` = port busy). Docker script's `select_free_host_port()` checks via `docker ps` port matching. These checks can disagree. When the Docker script selects a different port than what Node.js stored in `tenantRuntime.baseUrl`, the subsequent `waitForTenantHealth()` polls the wrong port → times out → failure. Each user message retries via `ensureCurrentOpencodeRouteReady()` → infinite failure loop.

**Fix:** After `startTenantRuntime()` spawns the container, query `docker port <container>` to get the actual host port mapping. If it differs from the stored port, update `baseUrl` and `port` in tenant runtime info before waiting for health.

### Bug 2: Unknown subdomain error

**Root cause:** `SubdomainManager.ensureSubdomain()` stores the Telegram username as-is (e.g., `"JohnDoe"`). Browsers send lowercase `Host` headers per RFC 7230 (e.g., `"johndoe.smart-server.online"`). SQLite's `=` comparison is case-sensitive → `"JohnDoe" <> "johndoe"` → `resolveSubdomain()` returns `null` → proxy responds with 404 "Unknown subdomain".

**Fix:** Normalize subdomain to lowercase at storage time (in `ensureSubdomain()`, `ensureSshSubdomain()`) and at extraction time (in `proxy.ts` where Host header is parsed).
