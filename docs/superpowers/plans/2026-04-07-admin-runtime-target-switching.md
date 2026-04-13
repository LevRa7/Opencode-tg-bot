# Admin Runtime Target Switching Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/opencode_start` and `/opencode_stop` manage the active runtime of the current user, and add an admin-only `/runtime host|isolated` command that switches the admin's active runtime target per conversation scope.

**Architecture:** Store the admin runtime preference in conversation-scoped settings, resolve the active runtime target through a single `runtime-target` module, and route `opencodeClient`, `processManager`, status, and lifecycle commands through that resolver. Keep non-admin users on the existing tenant behavior and keep host and tenant process persistence unchanged.

**Tech Stack:** TypeScript, Node.js, Vitest, grammY, OpenCode SDK, existing settings persistence and i18n

---

## File Structure Map

### New files

- Create: `/home/me/MyProjects/opencode-tg/src/runtime/runtime-target.ts` - central runtime-target resolver used by client, process manager, and commands
- Create: `/home/me/MyProjects/opencode-tg/src/bot/commands/runtime.ts` - admin-only `/runtime host|isolated` command
- Create: `/home/me/MyProjects/opencode-tg/tests/runtime/runtime-target.test.ts` - runtime-target resolver coverage
- Create: `/home/me/MyProjects/opencode-tg/tests/bot/commands/runtime.test.ts` - `/runtime` command coverage

### Files to modify

- Modify: `/home/me/MyProjects/opencode-tg/src/settings/manager.ts` - add `AdminRuntimeMode`, persistence helpers, clone/prune/load support
- Modify: `/home/me/MyProjects/opencode-tg/src/opencode/client.ts` - route through runtime-target resolver instead of `admin => host`
- Modify: `/home/me/MyProjects/opencode-tg/src/process/manager.ts` - route host vs tenant operations through runtime-target resolver
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/opencode-start.ts` - start active runtime target only
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/opencode-stop.ts` - stop active runtime target only
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/definitions.ts` - register `/runtime` as admin-only command
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts` - wire `runtimeCommand`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/en.ts` - add `/runtime` strings
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/ru.ts` - add `/runtime` strings
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/de.ts` - add `/runtime` strings
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/es.ts` - add `/runtime` strings
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/fr.ts` - add `/runtime` strings
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/zh.ts` - add `/runtime` strings
- Modify: `/home/me/MyProjects/opencode-tg/PRODUCT.md` - add `/runtime` to command list and feature scope if behavior ships

### Existing tests to extend

- Modify: `/home/me/MyProjects/opencode-tg/tests/settings/manager.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/opencode/client.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/process/manager.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/status.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/utils/command-sync.test.ts`

---

### Task 1: Add admin runtime mode to scoped settings

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/settings/manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/settings/manager.test.ts`

- [ ] **Step 1: Write the failing settings tests**

```ts
import {
  getAdminRuntimeMode,
  setAdminRuntimeMode,
} from "../../src/settings/manager.js";

it("defaults admin runtime mode to host when unset", () => {
  const adminScope = { userId: 777, chatId: 100, messageThreadId: 10 };

  expect(runWithTelegramConversationScope(adminScope, () => getAdminRuntimeMode())).toBe("host");
});

it("stores admin runtime mode per conversation scope", () => {
  const adminScopeA = { userId: 777, chatId: 100, messageThreadId: 10 };
  const adminScopeB = { userId: 777, chatId: 100, messageThreadId: 11 };

  runWithTelegramConversationScope(adminScopeA, () => {
    setAdminRuntimeMode("isolated");
  });

  expect(runWithTelegramConversationScope(adminScopeA, () => getAdminRuntimeMode())).toBe(
    "isolated",
  );
  expect(runWithTelegramConversationScope(adminScopeB, () => getAdminRuntimeMode())).toBe("host");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/settings/manager.test.ts`
Expected: FAIL because `getAdminRuntimeMode` and `setAdminRuntimeMode` do not exist yet.

- [ ] **Step 3: Add the minimal settings implementation**

```ts
// src/settings/manager.ts
export type AdminRuntimeMode = "host" | "isolated";

export interface ScopedConversationSettings {
  currentProject?: ProjectInfo;
  currentSession?: SessionInfo;
  currentAgent?: string;
  currentModel?: ModelInfo;
  pinnedMessageId?: number;
  reasoningMode?: ReasoningMode;
  adminRuntimeMode?: AdminRuntimeMode;
}

function cloneScopedConversationSettings(
  settings: ScopedConversationSettings | undefined,
): ScopedConversationSettings | undefined {
  if (!settings) {
    return undefined;
  }

  return {
    currentProject: cloneProjectInfo(settings.currentProject),
    currentSession: cloneSessionInfo(settings.currentSession),
    currentAgent: settings.currentAgent,
    currentModel: cloneModelInfo(settings.currentModel),
    pinnedMessageId: settings.pinnedMessageId,
    reasoningMode: settings.reasoningMode,
    adminRuntimeMode: settings.adminRuntimeMode,
  };
}

function isScopedConversationSettingsEmpty(settings: ScopedConversationSettings | undefined): boolean {
  return !settings ||
    (settings.currentProject === undefined &&
      settings.currentSession === undefined &&
      settings.currentAgent === undefined &&
      settings.currentModel === undefined &&
      settings.pinnedMessageId === undefined &&
      settings.reasoningMode === undefined &&
      settings.adminRuntimeMode === undefined);
}

export function getAdminRuntimeMode(): AdminRuntimeMode {
  return getConversationScopedSettings()?.adminRuntimeMode ?? "host";
}

export function setAdminRuntimeMode(mode: AdminRuntimeMode): void {
  const scopedSettings = getOrCreateConversationScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.adminRuntimeMode = mode;
  void writeSettingsFile(currentSettings);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/settings/manager.test.ts`
Expected: PASS with the new admin runtime mode tests green.

- [ ] **Step 5: Commit**

```bash
git add tests/settings/manager.test.ts src/settings/manager.ts
git commit -m "feat: persist admin runtime mode by conversation"
```

### Task 2: Introduce the runtime-target resolver

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/runtime-target.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/runtime/runtime-target.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/settings/manager.ts`

- [ ] **Step 1: Write the failing runtime-target tests**

```ts
import { describe, expect, it, vi } from "vitest";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";
import { __resetSettingsForTests, setAdminRuntimeMode, setTenantRuntimeInfo } from "../../src/settings/manager.js";
import { getCurrentRuntimeTarget } from "../../src/runtime/runtime-target.js";

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 777 },
    opencode: { apiUrl: "http://localhost:4096" },
  },
}));

describe("runtime/runtime-target", () => {
  it("defaults admin to host", () => {
    const scope = { userId: 777, chatId: 100, messageThreadId: 10 };

    const target = runWithTelegramConversationScope(scope, () => getCurrentRuntimeTarget());

    expect(target).toEqual({
      kind: "host",
      runtimeKey: "host",
      baseUrl: "http://localhost:4096",
    });
  });

  it("routes admin to isolated runtime after switching mode", async () => {
    const scope = { userId: 777, chatId: 100, messageThreadId: 10 };
    await setTenantRuntimeInfo(777, {
      userId: 777,
      chatId: 100,
      tenantId: "tg-777",
      baseUrl: "http://127.0.0.1:4107",
      port: 4107,
    });

    const target = runWithTelegramConversationScope(scope, () => {
      setAdminRuntimeMode("isolated");
      return getCurrentRuntimeTarget();
    });

    expect(target).toEqual(
      expect.objectContaining({
        kind: "tenant",
        userId: 777,
        tenantId: "tg-777",
        baseUrl: "http://127.0.0.1:4107",
      }),
    );
  });

  it("keeps non-admin users on tenant routing", () => {
    const scope = { userId: 5, chatId: 100, messageThreadId: 10 };

    const target = runWithTelegramConversationScope(scope, () => getCurrentRuntimeTarget());

    expect(target).toEqual(
      expect.objectContaining({
        kind: "tenant",
        userId: 5,
        tenantId: "tg-5",
      }),
    );
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/runtime/runtime-target.test.ts`
Expected: FAIL because `src/runtime/runtime-target.ts` does not exist yet.

- [ ] **Step 3: Add the minimal runtime-target resolver**

```ts
// src/runtime/runtime-target.ts
import { config } from "../config.js";
import { getAdminRuntimeMode, getTenantRuntimeInfo } from "../settings/manager.js";
import { getCurrentTelegramConversationScope } from "../telegram/scope.js";

export type RuntimeTarget =
  | {
      kind: "host";
      runtimeKey: "host";
      baseUrl: string;
    }
  | {
      kind: "tenant";
      runtimeKey: string;
      userId: number;
      chatId: number;
      tenantId: string;
      baseUrl: string;
      port?: number;
    };

export function getCurrentRuntimeTarget(): RuntimeTarget {
  const scope = getCurrentTelegramConversationScope();

  if (!scope) {
    return {
      kind: "host",
      runtimeKey: "host",
      baseUrl: config.opencode.apiUrl,
    };
  }

  const isAdmin = scope.userId === config.telegram.adminUserId;
  if (isAdmin && getAdminRuntimeMode() === "host") {
    return {
      kind: "host",
      runtimeKey: "host",
      baseUrl: config.opencode.apiUrl,
    };
  }

  const tenantRuntime = getTenantRuntimeInfo(scope.userId);
  const tenantId = tenantRuntime?.tenantId ?? `tg-${scope.userId}`;

  return {
    kind: "tenant",
    runtimeKey: tenantRuntime ? `tenant:${scope.userId}:${tenantId}` : `tenant-pending:${scope.userId}`,
    userId: scope.userId,
    chatId: scope.chatId,
    tenantId,
    baseUrl: tenantRuntime?.baseUrl ?? config.opencode.apiUrl,
    port: tenantRuntime?.port,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime/runtime-target.test.ts`
Expected: PASS with host/admin and tenant resolution covered.

- [ ] **Step 5: Commit**

```bash
git add tests/runtime/runtime-target.test.ts src/runtime/runtime-target.ts src/settings/manager.ts
git commit -m "feat: resolve runtime target from current scope"
```

### Task 3: Add the admin-only `/runtime` command

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/src/bot/commands/runtime.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/bot/commands/runtime.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/definitions.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/utils/command-sync.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/en.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/ru.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/de.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/es.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/fr.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/zh.ts`

- [ ] **Step 1: Write the failing `/runtime` command and command-list tests**

```ts
// tests/bot/commands/runtime.test.ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import { runtimeCommand } from "../../../src/bot/commands/runtime.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  getAdminRuntimeModeMock: vi.fn(() => "host"),
  setAdminRuntimeModeMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getAdminRuntimeMode: mocked.getAdminRuntimeModeMock,
  setAdminRuntimeMode: mocked.setAdminRuntimeModeMock,
}));

vi.mock("../../../src/config.js", () => ({
  config: { telegram: { adminUserId: 777 } },
}));

function createContext(text: string, userId: number = 777): CommandContext<Context> {
  return {
    from: { id: userId },
    match: text.split(/\s+/).slice(1).join(" "),
    message: { text },
    reply: vi.fn().mockResolvedValue({ message_id: 1 }),
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/runtime", () => {
  beforeEach(() => {
    mocked.getAdminRuntimeModeMock.mockReset();
    mocked.getAdminRuntimeModeMock.mockReturnValue("host");
    mocked.setAdminRuntimeModeMock.mockReset();
  });

  it("rejects non-admin users", async () => {
    const ctx = createContext("/runtime host", 100);

    await runtimeCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.admin_only"));
  });

  it("shows current mode and usage when called without argument", async () => {
    const ctx = createContext("/runtime");

    await runtimeCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.current_host") + "\n\n" + t("runtime.usage"));
  });

  it("stores isolated mode", async () => {
    const ctx = createContext("/runtime isolated");

    await runtimeCommand(ctx);

    expect(mocked.setAdminRuntimeModeMock).toHaveBeenCalledWith("isolated");
    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.updated_isolated"));
  });

  it("shows usage for invalid arguments", async () => {
    const ctx = createContext("/runtime nope");

    await runtimeCommand(ctx);

    expect(mocked.setAdminRuntimeModeMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("runtime.usage"));
  });
});
```

```ts
// tests/bot/utils/command-sync.test.ts
it("includes runtime for admin users only", () => {
  const adminCommands = getLocalizedBotCommands({ isAdmin: true });
  const userCommands = getLocalizedBotCommands({ isAdmin: false });

  expect(adminCommands.find((c) => c.command === "runtime")).toBeDefined();
  expect(userCommands.find((c) => c.command === "runtime")).toBeUndefined();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/bot/commands/runtime.test.ts tests/bot/utils/command-sync.test.ts`
Expected: FAIL because the `runtimeCommand`, i18n keys, and command definition do not exist yet.

- [ ] **Step 3: Add the minimal `/runtime` command, definitions, and strings**

```ts
// src/bot/commands/runtime.ts
import { CommandContext, Context } from "grammy";
import { config } from "../../config.js";
import { t } from "../../i18n/index.js";
import { getAdminRuntimeMode, setAdminRuntimeMode, type AdminRuntimeMode } from "../../settings/manager.js";

export async function runtimeCommand(ctx: CommandContext<Context>): Promise<void> {
  if (ctx.from?.id !== config.telegram.adminUserId) {
    await ctx.reply(t("runtime.admin_only"));
    return;
  }

  const arg = ctx.match?.trim().toLowerCase();
  if (!arg) {
    const currentMode = getAdminRuntimeMode();
    await ctx.reply(
      (currentMode === "isolated" ? t("runtime.current_isolated") : t("runtime.current_host")) +
        "\n\n" +
        t("runtime.usage"),
    );
    return;
  }

  if (arg !== "host" && arg !== "isolated") {
    await ctx.reply(t("runtime.usage"));
    return;
  }

  setAdminRuntimeMode(arg as AdminRuntimeMode);
  await ctx.reply(arg === "isolated" ? t("runtime.updated_isolated") : t("runtime.updated_host"));
}
```

```ts
// src/bot/commands/definitions.ts
{ command: "runtime", descriptionKey: "cmd.description.runtime", adminOnly: true },
```

```ts
// src/bot/index.ts
import { runtimeCommand } from "./commands/runtime.js";

bot.command("runtime", runtimeCommand);
```

```ts
// src/i18n/en.ts
"cmd.description.runtime": "Switch admin runtime target",
"runtime.admin_only": "This command is available only to the admin.",
"runtime.current_host": "Current runtime target: host",
"runtime.current_isolated": "Current runtime target: isolated",
"runtime.updated_host": "✅ Runtime target switched to host.",
"runtime.updated_isolated": "✅ Runtime target switched to isolated.",
"runtime.usage": "Use /runtime host or /runtime isolated.",
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bot/commands/runtime.test.ts tests/bot/utils/command-sync.test.ts`
Expected: PASS with admin-only behavior and command visibility verified.

- [ ] **Step 5: Commit**

```bash
git add tests/bot/commands/runtime.test.ts tests/bot/utils/command-sync.test.ts src/bot/commands/runtime.ts src/bot/commands/definitions.ts src/bot/index.ts src/i18n/en.ts src/i18n/ru.ts src/i18n/de.ts src/i18n/es.ts src/i18n/fr.ts src/i18n/zh.ts
git commit -m "feat: add admin runtime target command"
```

### Task 4: Route OpenCode client through the active runtime target

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/opencode/client.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/opencode/client.test.ts`

- [ ] **Step 1: Write the failing client routing tests**

```ts
it("routes admin scope to tenant base url after switching to isolated mode", async () => {
  const scope = { userId: 777, chatId: 100, messageThreadId: 10 };

  await setTenantRuntimeInfo(777, {
    userId: 777,
    chatId: 100,
    tenantId: "tg-777",
    baseUrl: "http://127.0.0.1:4107",
  });

  await runWithTelegramConversationScope(scope, async () => {
    setAdminRuntimeMode("isolated");
    await opencodeClient.global.health();
  });

  expect(mocked.createOpencodeClientMock).toHaveBeenCalledWith(
    expect.objectContaining({ baseUrl: "http://127.0.0.1:4107" }),
  );
});

it("does not bootstrap tenant runtime when admin stays on host", async () => {
  const scope = { userId: 777, chatId: 100, messageThreadId: 10 };

  await runWithTelegramConversationScope(scope, async () => {
    await opencodeClient.global.health();
  });

  expect(mocked.ensureRuntimeMock).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/opencode/client.test.ts`
Expected: FAIL because admin still routes to host and the readiness guard is still keyed by `adminUserId`.

- [ ] **Step 3: Refactor `src/opencode/client.ts` to use runtime-target resolver**

```ts
// src/opencode/client.ts
import { getCurrentRuntimeTarget } from "../runtime/runtime-target.js";

export async function ensureCurrentOpencodeRouteReady(): Promise<void> {
  const target = getCurrentRuntimeTarget();
  if (target.kind !== "tenant") {
    return;
  }

  const result = await processManager.ensureRuntime();
  if (!result.success) {
    throw new Error(result.error || `Failed to initialize tenant runtime for userId=${target.userId}`);
  }
}

export function getCurrentOpencodeRoute(): OpencodeRoute {
  const target = getCurrentRuntimeTarget();
  if (target.kind === "host") {
    return {
      runtimeKey: target.runtimeKey,
      baseUrl: target.baseUrl,
      kind: "host",
    };
  }

  return {
    runtimeKey: target.runtimeKey,
    baseUrl: target.baseUrl,
    kind: "tenant",
    userId: target.userId,
    chatId: target.chatId,
    tenantId: target.tenantId,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/opencode/client.test.ts`
Expected: PASS with admin host/isolated routing covered.

- [ ] **Step 5: Commit**

```bash
git add tests/opencode/client.test.ts src/opencode/client.ts
git commit -m "refactor: route opencode client by active runtime target"
```

### Task 5: Route process manager by active runtime target

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/process/manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/process/manager.test.ts`

- [ ] **Step 1: Write the failing process manager tests**

```ts
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

it("ensures tenant runtime when admin switched to isolated", async () => {
  const scope = { userId: 777, chatId: 100, messageThreadId: 10 };

  await runWithTelegramConversationScope(scope, async () => {
    setAdminRuntimeMode("isolated");
    const result = await processManager.ensureRuntime();
    expect(result).toEqual({ success: true });
  });

  expect(spawnMock).toHaveBeenCalledWith(
    "bash",
    expect.any(Array),
    expect.objectContaining({
      env: expect.objectContaining({ TG_ID: "777", TG_TENANT_ID: "tg-777" }),
    }),
  );
});

it("stops only tenant runtime for admin on isolated", async () => {
  const scope = { userId: 777, chatId: 100, messageThreadId: 10 };
  const killSpy = vi.spyOn(process, "kill").mockImplementation(() => true);

  await runWithTelegramConversationScope(scope, async () => {
    setAdminRuntimeMode("isolated");
    await processManager.ensureRuntime();
    await processManager.stop(100);
  });

  expect(execMock).not.toHaveBeenCalled();
  expect(killSpy).toHaveBeenCalledWith(expect.any(Number), "SIGTERM");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/process/manager.test.ts`
Expected: FAIL because `ensureRuntime()` and `stop()` still branch by `isAdminScope()`.

- [ ] **Step 3: Refactor process manager to use runtime-target branching**

```ts
// src/process/manager.ts
import { getCurrentRuntimeTarget } from "../runtime/runtime-target.js";

async ensureRuntime(): Promise<ProcessOperationResult> {
  const target = getCurrentRuntimeTarget();
  if (target.kind === "host") {
    if (this.isRunning()) {
      return { success: true };
    }

    return this.start();
  }

  return this.ensureTenantRuntime();
}

async stop(timeoutMs: number = 5000): Promise<ProcessOperationResult> {
  const target = getCurrentRuntimeTarget();
  if (target.kind === "tenant") {
    return await this.stopTenantRuntime(timeoutMs);
  }

  // keep existing host stop logic unchanged below this branch
}

getCurrentRuntimeInfo(): ProcessRuntimeInfo {
  const target = getCurrentRuntimeTarget();
  if (target.kind === "host") {
    return {
      kind: "host",
      baseUrl: target.baseUrl,
      managed: this.state.isRunning && this.isRunning(),
      pid: this.getPID(),
      uptimeMs: this.getUptime(),
    };
  }

  const runtime = getTenantRuntimeInfo(target.userId);
  return {
    kind: "tenant",
    userId: target.userId,
    chatId: target.chatId,
    tenantId: target.tenantId,
    baseUrl: target.baseUrl,
    port: runtime?.port,
    managed: Boolean(runtime?.pid && this.isProcessAlive(runtime.pid)),
    pid: runtime?.pid ?? null,
    uptimeMs: runtime?.startTime ? Date.now() - Date.parse(runtime.startTime) : null,
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/process/manager.test.ts`
Expected: PASS with admin host vs isolated behavior covered.

- [ ] **Step 5: Commit**

```bash
git add tests/process/manager.test.ts src/process/manager.ts
git commit -m "refactor: manage runtime lifecycle by active target"
```

### Task 6: Make lifecycle commands and status use the new target

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/opencode-start.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/opencode-stop.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/status.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/status.test.ts`
- Create or modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/opencode-start.test.ts`
- Create or modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/opencode-stop.test.ts`

- [ ] **Step 1: Write the failing lifecycle and status tests**

```ts
// tests/bot/commands/opencode-start.test.ts
it("starts tenant runtime for admin after /runtime isolated", async () => {
  mocked.getCurrentRuntimeInfoMock.mockReturnValue({
    kind: "tenant",
    baseUrl: "http://127.0.0.1:4107",
    managed: false,
    pid: null,
    uptimeMs: null,
    userId: 777,
    chatId: 100,
    tenantId: "tg-777",
    port: 4107,
  });

  mocked.healthMock.mockRejectedValueOnce(new Error("down"));
  mocked.ensureRuntimeMock.mockResolvedValue({ success: true });
  mocked.healthMock.mockResolvedValueOnce({ data: { healthy: true, version: "1.0.0" }, error: null });

  await opencodeStartCommand(ctx);

  expect(mocked.ensureRuntimeMock).toHaveBeenCalledTimes(1);
  expect(mocked.editBotTextMock).toHaveBeenCalledWith(
    expect.objectContaining({ text: expect.stringContaining("PID") }),
  );
});
```

```ts
// tests/bot/commands/opencode-stop.test.ts
it("does not report external host runtime when active target is tenant", async () => {
  mocked.isRunningMock.mockReturnValue(false);
  mocked.healthMock.mockRejectedValue(new Error("tenant down"));

  await opencodeStopCommand(ctx);

  expect(ctx.reply).toHaveBeenCalledWith(t("opencode_stop.not_running"));
});
```

```ts
// tests/bot/commands/status.test.ts
it("renders tenant runtime metadata", async () => {
  mocked.getCurrentRuntimeInfoMock.mockReturnValue({
    kind: "tenant",
    baseUrl: "http://127.0.0.1:4107",
    managed: true,
    pid: 321,
    uptimeMs: 5_000,
    tenantId: "tg-777",
    port: 4107,
  });

  const ctx = {
    chat: { id: 42, type: "private" },
    message: { text: "/status" },
    api: {},
    reply: vi.fn(),
  } as unknown as Context;

  await statusCommand(ctx as never);

  const message = mocked.sendBotTextMock.mock.calls[0]?.[0]?.text as string;
  expect(message).toContain(t("status.runtime.tenant"));
  expect(message).toContain("tg-777");
  expect(message).toContain("4107");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/bot/commands/opencode-start.test.ts tests/bot/commands/opencode-stop.test.ts tests/bot/commands/status.test.ts`
Expected: FAIL because start/stop command tests do not exist yet or because command routing still assumes host for admin behavior.

- [ ] **Step 3: Implement minimal lifecycle-command alignment**

```ts
// src/bot/commands/opencode-start.ts
async function waitForServerReady(maxWaitMs: number = 10000): Promise<boolean> {
  const startTime = Date.now();
  const pollInterval = 500;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const { data, error } = await opencodeClient.global.health();
      if (!error && data?.healthy) {
        return true;
      }
    } catch {
      // Server not ready yet.
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  return false;
}

// keep command structure, but rely only on processManager.getCurrentRuntimeInfo(), processManager.ensureRuntime(), and opencodeClient health for the active target
```

```ts
// src/bot/commands/opencode-stop.ts
// keep command structure, but rely only on processManager.isRunning(), processManager.getPID(), processManager.stop(), and opencodeClient health for the active target
```

```ts
// src/bot/commands/status.ts
// no branching redesign required beyond trusting processManager.getCurrentRuntimeInfo() output for tenant vs host rendering
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bot/commands/opencode-start.test.ts tests/bot/commands/opencode-stop.test.ts tests/bot/commands/status.test.ts`
Expected: PASS with lifecycle and status tied to active runtime target.

- [ ] **Step 5: Commit**

```bash
git add tests/bot/commands/opencode-start.test.ts tests/bot/commands/opencode-stop.test.ts tests/bot/commands/status.test.ts src/bot/commands/opencode-start.ts src/bot/commands/opencode-stop.ts src/bot/commands/status.ts
git commit -m "fix: target runtime lifecycle commands by active scope"
```

### Task 7: Update docs and run full verification

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/PRODUCT.md`

- [ ] **Step 1: Write the failing product-scope expectation test by inspection**

There is no automated test for `PRODUCT.md`. The failing condition is manual: the command list and implemented-features section do not yet describe `/runtime` and admin runtime target switching.

- [ ] **Step 2: Update `PRODUCT.md`**

```md
Current command set:

- `/runtime` - switch admin runtime target between host and isolated environment

### Main features already implemented

- [x] Admin runtime target switching between host and isolated environment
```

- [ ] **Step 3: Run targeted test suite**

Run: `npm test -- tests/settings/manager.test.ts tests/runtime/runtime-target.test.ts tests/bot/commands/runtime.test.ts tests/opencode/client.test.ts tests/process/manager.test.ts tests/bot/commands/opencode-start.test.ts tests/bot/commands/opencode-stop.test.ts tests/bot/commands/status.test.ts tests/bot/utils/command-sync.test.ts`
Expected: PASS for all targeted runtime-target and command behavior tests.

- [ ] **Step 4: Run repository verification**

Run: `npm test && npm run lint && npm run build`
Expected: all commands exit successfully without new errors.

- [ ] **Step 5: Commit**

```bash
git add PRODUCT.md
git commit -m "docs: describe admin runtime target switching"
```

---

## Plan Self-Review

- Spec coverage: covered persisted admin runtime mode, runtime-target resolver, `/runtime`, client routing, process manager routing, lifecycle command behavior, status output, command sync visibility, i18n, and product docs.
- Placeholder scan: no `TODO`, `TBD`, or "similar to previous task" placeholders remain.
- Type consistency: plan consistently uses `AdminRuntimeMode`, `RuntimeTarget`, `/runtime host|isolated`, and `adminRuntimeMode` in scoped conversation settings.
