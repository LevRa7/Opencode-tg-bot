# Multi-User Isolated Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build per-user isolated OpenCode and `tg-cli` execution keyed by Telegram sender ID, using rootless readonly containers and tenant-specific routing.

**Architecture:** The bot becomes a control plane that resolves a tenant from `ctx.from.id`, ensures a tenant runtime exists, and routes requests to that tenant-specific OpenCode endpoint. `tg-cli` bot-mode logic resolves profiles from the same `tg_id`/`bot_user_id`, returns a structured `needs_auth` state when unbound, and never falls back to the operator's global session.

**Tech Stack:** TypeScript, Vitest, Grammy, OpenCode SDK, Python, pytest, Telethon, rootless Docker or Podman

---

## File Structure Map

### `opencode-tg`

- Modify: `/home/me/MyProjects/opencode-tg/src/opencode/client.ts` — support tenant-specific OpenCode base URLs and client registry keys
- Modify: `/home/me/MyProjects/opencode-tg/src/process/manager.ts` — stop assuming one shared `opencode serve`; introduce runtime-manager abstraction boundary
- Modify: `/home/me/MyProjects/opencode-tg/src/process/types.ts` — add tenant runtime types
- Modify: `/home/me/MyProjects/opencode-tg/src/project/user-project.ts` — derive trusted tenant workspace paths and reuse tenant identity helpers
- Modify: `/home/me/MyProjects/opencode-tg/src/config.ts` — add tenant runtime root/container configuration
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/tenant-paths.ts` — resolve trusted host-side tenant directories
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/tenant-runtime-manager.ts` — lifecycle manager for per-user runtime metadata and readiness
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/tenant-runtime-types.ts` — tenant runtime DTOs and status unions
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/container-runner.ts` — spawn/inspect/stop rootless readonly containers
- Create: `/home/me/MyProjects/opencode-tg/src/tg-cli/client.ts` — typed bot-side daemon client for binding/auth state
- Create: `/home/me/MyProjects/opencode-tg/src/tg-cli/types.ts` — bot-side daemon response DTOs
- Create: `/home/me/MyProjects/opencode-tg/src/bot/auth/tenant-auth-gate.ts` — decide whether tenant can proceed or needs onboarding
- Create: `/home/me/MyProjects/opencode-tg/src/bot/auth/tenant-auth-messages.ts` — localized auth/onboarding messages
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/handlers/prompt.ts` — ensure tenant runtime and binding before project/session creation
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/start.ts` — show isolated-environment onboarding hints
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts` — initialize tenant runtime services and route event subscriptions through tenant endpoints
- Test: `/home/me/MyProjects/opencode-tg/tests/opencode/client.test.ts`
- Test: `/home/me/MyProjects/opencode-tg/tests/process/manager.test.ts`
- Test: `/home/me/MyProjects/opencode-tg/tests/config.test.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/runtime/tenant-paths.test.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/runtime/tenant-runtime-manager.test.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/tg-cli/client.test.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/bot/auth/tenant-auth-gate.test.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/bot/handlers/prompt.tenant-runtime.test.ts`

### `tg-cli`

- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/config.py` — add explicit bot-mode scope helpers and scoped session path resolution
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/client.py` — add `connect_for_bot_user()` and remove bot-mode global fallback
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/cli/_scope.py` — resolve bot user scope without depending only on the operator session
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/daemon/api_app.py` — expose an explicit bot-mode binding-status surface usable by the bot
- Create: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/application/use_cases/bot_mode.py` — return `bound` vs `needs_auth` tenant runtime state
- Create: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/application/dtos_bot_mode.py` — request/response DTOs for tenant runtime state
- Test: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_config.py`
- Test: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_client.py`
- Test: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_daemon_api.py`
- Create: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_bot_mode_use_cases.py`

### Infrastructure

- Create: `/home/me/MyProjects/opencode-tg/docker/opencode-tenant/Dockerfile` — readonly runtime image
- Create: `/home/me/MyProjects/opencode-tg/docker/opencode-tenant/entrypoint.sh` — start tenant-local OpenCode runtime and `tg-cli` daemon services
- Create: `/home/me/MyProjects/opencode-tg/docker/opencode-tenant/supervisord.conf` or equivalent process launcher config
- Create: `/home/me/MyProjects/opencode-tg/docs/container-runtime.md` — operational notes for rootless Docker or Podman

---

### Task 1: Add Trusted Tenant Path Resolution in `opencode-tg`

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/tenant-paths.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/project/user-project.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/config.ts`
- Test: `/home/me/MyProjects/opencode-tg/tests/runtime/tenant-paths.test.ts`
- Test: `/home/me/MyProjects/opencode-tg/tests/config.test.ts`

- [ ] **Step 1: Write the failing path-resolution test**

```ts
import { describe, expect, it } from "vitest";
import {
  buildTenantWorkspaceRelativePath,
  getTenantHostPaths,
} from "../../src/runtime/tenant-paths.js";

describe("runtime/tenant-paths", () => {
  it("builds tenant workspace and storage paths from tg_id", () => {
    const paths = getTenantHostPaths(42, "/srv/opencode-tenants");

    expect(paths.tenantRoot).toBe("/srv/opencode-tenants/42");
    expect(paths.workspaceHostPath).toBe("/srv/opencode-tenants/42/workspace");
    expect(paths.tgCliHostPath).toBe("/srv/opencode-tenants/42/tg-cli");
    expect(paths.workspaceRelativePath).toBe("sessions/42");
  });

  it("uses sessions/<tg_id> as the canonical workspace identity", () => {
    expect(buildTenantWorkspaceRelativePath(6931112349)).toBe("sessions/6931112349");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime/tenant-paths.test.ts`
Expected: FAIL with module-not-found for `src/runtime/tenant-paths.ts`.

- [ ] **Step 3: Implement minimal trusted tenant path helpers and reuse them in project helpers**

```ts
// src/runtime/tenant-paths.ts
import path from "node:path";

export interface TenantHostPaths {
  tgId: number;
  tenantRoot: string;
  workspaceHostPath: string;
  tgCliHostPath: string;
  cacheHostPath: string;
  logsHostPath: string;
  runtimeHostPath: string;
  workspaceRelativePath: string;
}

export function buildTenantWorkspaceRelativePath(tgId: number): string {
  return path.join("sessions", String(tgId));
}

export function getTenantHostPaths(tgId: number, tenantsRoot: string): TenantHostPaths {
  const tenantRoot = path.join(tenantsRoot, String(tgId));
  return {
    tgId,
    tenantRoot,
    workspaceHostPath: path.join(tenantRoot, "workspace"),
    tgCliHostPath: path.join(tenantRoot, "tg-cli"),
    cacheHostPath: path.join(tenantRoot, "cache"),
    logsHostPath: path.join(tenantRoot, "logs"),
    runtimeHostPath: path.join(tenantRoot, "runtime"),
    workspaceRelativePath: buildTenantWorkspaceRelativePath(tgId),
  };
}
```

```ts
// src/project/user-project.ts
import { buildTenantWorkspaceRelativePath } from "../runtime/tenant-paths.js";

export function getUserSessionDirectory(tgId: number): string {
  return buildTenantWorkspaceRelativePath(tgId);
}
```

```ts
// src/config.ts (shape only for this task)
runtime: {
  tenantsRoot: getEnvVar("OPENCODE_TENANTS_ROOT", false) || "/srv/opencode-tenants",
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime/tenant-paths.test.ts tests/config.test.ts`
Expected: PASS with new runtime root config coverage and tenant path helper coverage.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/tenant-paths.ts src/project/user-project.ts src/config.ts tests/runtime/tenant-paths.test.ts tests/config.test.ts
git commit -m "feat(runtime): add tenant workspace path resolution"
```

### Task 2: Add Tenant-Aware OpenCode Client Routing

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/opencode/client.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/telegram/scope.ts`
- Test: `/home/me/MyProjects/opencode-tg/tests/opencode/client.test.ts`

- [ ] **Step 1: Write the failing routing test for tenant-specific base URLs**

```ts
it("creates separate clients when the same chat scope routes to different tenant endpoints", () => {
  const scope = { userId: 42, chatId: 100, messageThreadId: 0 };

  const clientA = runWithTelegramConversationScope(scope, () =>
    getOpencodeClient({ baseUrl: "http://127.0.0.1:44042" }),
  );
  const clientB = runWithTelegramConversationScope(scope, () =>
    getOpencodeClient({ baseUrl: "http://127.0.0.1:44043" }),
  );

  expect(clientA).not.toBe(clientB);
  expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(2);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/opencode/client.test.ts`
Expected: FAIL because `getOpencodeClient()` does not accept runtime routing options.

- [ ] **Step 3: Implement runtime-aware client registry keys**

```ts
// src/opencode/client.ts
export interface OpencodeClientRuntimeOptions {
  baseUrl?: string;
}

function createClient(baseUrl: string): OpencodeClient {
  return createOpencodeClient({
    baseUrl,
    headers: config.opencode.password ? { Authorization: getAuth() } : undefined,
  });
}

function buildClientRegistryKey(scopeKey: string, baseUrl: string): string {
  return `${scopeKey}::${baseUrl}`;
}

export function getOpencodeClient(options: OpencodeClientRuntimeOptions = {}): OpencodeClient {
  const scopeKey = resolveTelegramConversationScopeKey();
  const baseUrl = options.baseUrl || config.opencode.apiUrl;
  const registryKey = buildClientRegistryKey(scopeKey, baseUrl);
  const existingClient = clientRegistry.get(registryKey);
  if (existingClient) {
    return existingClient;
  }

  const client = createClient(baseUrl);
  clientRegistry.set(registryKey, client);
  return client;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/opencode/client.test.ts`
Expected: PASS with both scope-based and tenant-endpoint-based client reuse rules validated.

- [ ] **Step 5: Commit**

```bash
git add src/opencode/client.ts tests/opencode/client.test.ts
git commit -m "feat(opencode): support tenant-aware client routing"
```

### Task 3: Introduce Tenant Runtime Types and Manager in `opencode-tg`

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/tenant-runtime-types.ts`
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/tenant-runtime-manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/process/types.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/runtime/tenant-runtime-manager.test.ts`

- [ ] **Step 1: Write the failing tenant runtime manager test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createTenantRuntimeManager } from "../../src/runtime/tenant-runtime-manager.js";

describe("runtime/tenant-runtime-manager", () => {
  it("starts a tenant runtime on demand and returns a ready endpoint", async () => {
    const manager = createTenantRuntimeManager({
      ensureRuntime: vi.fn(async (tgId: number) => ({
        tgId,
        status: "ready",
        opencodeBaseUrl: `http://127.0.0.1:${44000 + tgId}`,
        workspaceRelativePath: `sessions/${tgId}`,
      })),
    });

    const runtime = await manager.ensureReady(42);
    expect(runtime.status).toBe("ready");
    expect(runtime.opencodeBaseUrl).toBe("http://127.0.0.1:44042");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime/tenant-runtime-manager.test.ts`
Expected: FAIL with module-not-found for the new runtime manager.

- [ ] **Step 3: Implement minimal tenant runtime manager interfaces**

```ts
// src/runtime/tenant-runtime-types.ts
export type TenantRuntimeStatus = "starting" | "ready" | "stopped" | "needs_auth" | "error";

export interface TenantRuntimeInfo {
  tgId: number;
  status: TenantRuntimeStatus;
  opencodeBaseUrl: string;
  workspaceRelativePath: string;
  containerName?: string;
  message?: string;
}

export interface TenantRuntimeManager {
  ensureReady(tgId: number): Promise<TenantRuntimeInfo>;
}
```

```ts
// src/runtime/tenant-runtime-manager.ts
import type { TenantRuntimeInfo, TenantRuntimeManager } from "./tenant-runtime-types.js";

interface CreateTenantRuntimeManagerOptions {
  ensureRuntime: (tgId: number) => Promise<TenantRuntimeInfo>;
}

export function createTenantRuntimeManager(
  options: CreateTenantRuntimeManagerOptions,
): TenantRuntimeManager {
  return {
    async ensureReady(tgId: number): Promise<TenantRuntimeInfo> {
      return options.ensureRuntime(tgId);
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime/tenant-runtime-manager.test.ts`
Expected: PASS with `ready` runtime state creation.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/tenant-runtime-types.ts src/runtime/tenant-runtime-manager.ts src/process/types.ts tests/runtime/tenant-runtime-manager.test.ts
git commit -m "feat(runtime): add tenant runtime manager abstraction"
```

### Task 4: Add Rootless Container Runner Abstraction

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/src/runtime/container-runner.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/config.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/runtime/container-runner.test.ts`

- [ ] **Step 1: Write the failing container runner command-construction test**

```ts
import { describe, expect, it } from "vitest";
import { buildTenantContainerRunCommand } from "../../src/runtime/container-runner.js";

describe("runtime/container-runner", () => {
  it("builds a readonly rootless container command with tenant mounts", () => {
    const command = buildTenantContainerRunCommand({
      runtimeBinary: "docker",
      image: "opencode-tenant:latest",
      containerName: "opencode-tenant-42",
      workspaceHostPath: "/srv/opencode-tenants/42/workspace",
      tgCliHostPath: "/srv/opencode-tenants/42/tg-cli",
      opencodePort: 44042,
    });

    expect(command).toContain("docker run");
    expect(command).toContain("--read-only");
    expect(command).toContain("--name opencode-tenant-42");
    expect(command).toContain("-v /srv/opencode-tenants/42/workspace:/workspace:rw");
    expect(command).toContain("-v /srv/opencode-tenants/42/tg-cli:/var/lib/tg-cli:rw");
    expect(command).toContain("-p 127.0.0.1:44042:4096");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime/container-runner.test.ts`
Expected: FAIL with module-not-found for `container-runner.ts`.

- [ ] **Step 3: Implement minimal container command builder**

```ts
// src/runtime/container-runner.ts
export interface TenantContainerRunOptions {
  runtimeBinary: string;
  image: string;
  containerName: string;
  workspaceHostPath: string;
  tgCliHostPath: string;
  opencodePort: number;
}

export function buildTenantContainerRunCommand(options: TenantContainerRunOptions): string {
  return [
    options.runtimeBinary,
    "run",
    "--read-only",
    "--rm",
    `--name ${options.containerName}`,
    `-p 127.0.0.1:${options.opencodePort}:4096`,
    `-v ${options.workspaceHostPath}:/workspace:rw`,
    `-v ${options.tgCliHostPath}:/var/lib/tg-cli:rw`,
    options.image,
  ].join(" ");
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime/container-runner.test.ts`
Expected: PASS with readonly/container-mount command construction validated.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/container-runner.ts src/config.ts tests/runtime/container-runner.test.ts
git commit -m "feat(runtime): add tenant container runner abstraction"
```

### Task 5: Teach `tg-cli` to Resolve Scoped Sessions for Bot Mode

**Files:**
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/config.py`
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/client.py`
- Test: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_config.py`
- Test: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_client.py`

- [ ] **Step 1: Write the failing config test for scoped session paths**

```python
def test_get_session_path_for_bot_user(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("TG_SESSIONS_ROOT", str(tmp_path / "sessions-root"))

    from tg_cli.config import get_session_path_for_bot_user

    path = get_session_path_for_bot_user("42")

    assert str(path).endswith("sessions-root/42/tg/session/main")
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_config.py -k session_path_for_bot_user`
Expected: FAIL because `get_session_path_for_bot_user` does not exist.

- [ ] **Step 3: Implement explicit scoped session-path and bot-user connection helpers**

```python
# src/tg_cli/config.py
def get_session_path_for_bot_user(bot_user_id: str | int) -> Path:
    storage_root = get_account_storage_root(bot_user_id)
    return storage_root.session_file_base
```

```python
# src/tg_cli/client.py
from .config import get_session_path_for_bot_user

@asynccontextmanager
async def connect_for_bot_user(bot_user_id: str | int) -> AsyncGenerator[TelegramClient, None]:
    global _default_api_warned
    api_id = get_api_id()
    api_hash = get_api_hash()
    if not _default_api_warned and is_default_api_id():
        _default_api_warned = True
        console.print("[yellow]⚠ Using default Telegram Desktop API credentials...[/yellow]")

    c = TelegramClient(
        str(get_session_path_for_bot_user(bot_user_id)),
        api_id,
        api_hash,
        device_model=_DEVICE_MODEL,
        system_version=_SYSTEM_VERSION,
        app_version=_APP_VERSION,
        lang_code=_LANG_CODE,
        system_lang_code=_SYSTEM_LANG_CODE,
    )
    await c.start()
    try:
        yield c
    finally:
        await c.disconnect()
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_config.py tests/test_client.py -k "session_path_for_bot_user or default_credentials"`
Expected: PASS with scoped session path helper coverage.

- [ ] **Step 5: Commit**

```bash
git add src/tg_cli/config.py src/tg_cli/client.py tests/test_config.py tests/test_client.py
git commit -m "feat(tg-cli): add bot-user scoped session resolution"
```

### Task 6: Add Explicit Bot-Mode Binding State in `tg-cli`

**Files:**
- Create: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/application/dtos_bot_mode.py`
- Create: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/application/use_cases/bot_mode.py`
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/src/tg_cli/daemon/api_app.py`
- Create: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_bot_mode_use_cases.py`
- Modify: `/home/me/MyProjects/opencode-telegram-bot/tg-cli/tests/test_daemon_api.py`

- [ ] **Step 1: Write the failing bot-mode use case test**

```python
from tg_cli.application.use_cases.bot_mode import GetBotModeRuntimeStateUseCase

def test_returns_needs_auth_when_binding_missing():
    class EmptyBindingRepository:
        def get_by_user(self, bot_user_id):
            return None

    response = GetBotModeRuntimeStateUseCase(EmptyBindingRepository()).execute("42")

    assert response.bot_user_id == "42"
    assert response.status == "needs_auth"
```

- [ ] **Step 2: Run test to verify it fails**

Run: `uv run pytest tests/test_bot_mode_use_cases.py`
Expected: FAIL with module-not-found for `bot_mode.py`.

- [ ] **Step 3: Implement the minimal bot-mode runtime state use case and daemon operation**

```python
# src/tg_cli/application/dtos_bot_mode.py
from dataclasses import dataclass

@dataclass(slots=True)
class BotModeRuntimeStateResponse:
    bot_user_id: str
    status: str
    binding_id: str | None = None
```

```python
# src/tg_cli/application/use_cases/bot_mode.py
from ..dtos_bot_mode import BotModeRuntimeStateResponse

class GetBotModeRuntimeStateUseCase:
    def __init__(self, binding_repository):
        self._binding_repository = binding_repository

    def execute(self, bot_user_id: str | int) -> BotModeRuntimeStateResponse:
        binding = self._binding_repository.get_by_user(bot_user_id)
        if binding is None:
            return BotModeRuntimeStateResponse(bot_user_id=str(bot_user_id), status="needs_auth")

        return BotModeRuntimeStateResponse(
            bot_user_id=str(bot_user_id),
            status="bound",
            binding_id=binding.binding_id,
        )
```

```python
# src/tg_cli/daemon/api_app.py (new branch in _dispatch)
if request.operation == "bot.getRuntimeState":
    return self._get_binding_status_use_case.execute(
        GetBindingStatusRequest(bot_user_id=request.bot_user_id)
    )
```

Note: in the actual implementation, adapt this branch to use the new `GetBotModeRuntimeStateUseCase` instead of reusing `GetBindingStatusUseCase` directly.

- [ ] **Step 4: Run tests to verify they pass**

Run: `uv run pytest tests/test_bot_mode_use_cases.py tests/test_daemon_api.py -k "bot or binding_get"`
Expected: PASS with a structured bot-mode unbound state available to the bot.

- [ ] **Step 5: Commit**

```bash
git add src/tg_cli/application/dtos_bot_mode.py src/tg_cli/application/use_cases/bot_mode.py src/tg_cli/daemon/api_app.py tests/test_bot_mode_use_cases.py tests/test_daemon_api.py
git commit -m "feat(tg-cli): expose bot-mode runtime binding state"
```

### Task 7: Add Bot-Side `tg-cli` Daemon Client and Auth Gate

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/src/tg-cli/types.ts`
- Create: `/home/me/MyProjects/opencode-tg/src/tg-cli/client.ts`
- Create: `/home/me/MyProjects/opencode-tg/src/bot/auth/tenant-auth-gate.ts`
- Create: `/home/me/MyProjects/opencode-tg/src/bot/auth/tenant-auth-messages.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/tg-cli/client.test.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/bot/auth/tenant-auth-gate.test.ts`

- [ ] **Step 1: Write the failing auth-gate test**

```ts
import { describe, expect, it, vi } from "vitest";
import { createTenantAuthGate } from "../../../src/bot/auth/tenant-auth-gate.js";

describe("bot/auth/tenant-auth-gate", () => {
  it("blocks prompt execution when tenant tg-cli runtime needs auth", async () => {
    const gate = createTenantAuthGate({
      getRuntimeState: vi.fn(async () => ({ botUserId: "42", status: "needs_auth" })),
    });

    await expect(gate.ensureAuthorized(42)).rejects.toThrow("needs_auth");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/auth/tenant-auth-gate.test.ts`
Expected: FAIL because the auth gate module does not exist.

- [ ] **Step 3: Implement minimal daemon client and tenant auth gate**

```ts
// src/tg-cli/types.ts
export interface TgCliRuntimeState {
  botUserId: string;
  status: "bound" | "needs_auth" | "replacing";
  bindingId?: string;
}
```

```ts
// src/tg-cli/client.ts
export interface TgCliBotClient {
  getRuntimeState(tgId: number): Promise<TgCliRuntimeState>;
}
```

```ts
// src/bot/auth/tenant-auth-gate.ts
export class TenantAuthRequiredError extends Error {
  constructor(public readonly tgId: number) {
    super(`Tenant ${tgId} needs_auth`);
  }
}

export function createTenantAuthGate(deps: {
  getRuntimeState: (tgId: number) => Promise<{ botUserId: string; status: string }>;
}) {
  return {
    async ensureAuthorized(tgId: number): Promise<void> {
      const state = await deps.getRuntimeState(tgId);
      if (state.status === "needs_auth") {
        throw new TenantAuthRequiredError(tgId);
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts`
Expected: PASS with a bot-side integration seam for tenant auth state.

- [ ] **Step 5: Commit**

```bash
git add src/tg-cli/types.ts src/tg-cli/client.ts src/bot/auth/tenant-auth-gate.ts src/bot/auth/tenant-auth-messages.ts tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts
git commit -m "feat(bot): add tenant tg-cli auth gate"
```

### Task 8: Gate Prompt Processing on Tenant Runtime and Auth State

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/handlers/prompt.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts`
- Create: `/home/me/MyProjects/opencode-tg/tests/bot/handlers/prompt.tenant-runtime.test.ts`

- [ ] **Step 1: Write the failing prompt-handler test**

```ts
it("replies with onboarding instead of creating a session when tenant tg-cli auth is missing", async () => {
  const ctx = createMockContext({ from: { id: 42 }, chat: { id: 100 } });
  const reply = vi.spyOn(ctx, "reply").mockResolvedValue(undefined as never);

  const result = await processUserPrompt(ctx, "hello", {
    bot: {} as never,
    ensureEventSubscription: vi.fn(),
    ensureTenantRuntime: vi.fn(async () => ({ status: "ready", opencodeBaseUrl: "http://127.0.0.1:44042" })),
    ensureTenantAuth: vi.fn(async () => {
      throw new TenantAuthRequiredError(42);
    }),
  });

  expect(result).toBe(false);
  expect(reply).toHaveBeenCalledWith(expect.stringContaining("авториза"));
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/handlers/prompt.tenant-runtime.test.ts`
Expected: FAIL because `processUserPrompt()` does not accept tenant runtime/auth dependencies.

- [ ] **Step 3: Extend prompt processing to ensure runtime and auth before session creation**

```ts
// processUserPrompt deps shape extension
export interface ProcessPromptDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string, baseUrl?: string) => Promise<void>;
  ensureTenantRuntime: (tgId: number) => Promise<{ status: string; opencodeBaseUrl: string }>;
  ensureTenantAuth: (tgId: number) => Promise<void>;
}
```

```ts
// inside processUserPrompt before project/session work
const tgId = ctx.from?.id;
if (!tgId) {
  await ctx.reply(t("bot.project_not_selected"));
  return false;
}

const runtime = await deps.ensureTenantRuntime(tgId);
await deps.ensureTenantAuth(tgId);
```

```ts
// auth failure branch
if (err instanceof TenantAuthRequiredError) {
  await ctx.reply(buildTenantAuthRequiredMessage(tgId));
  return false;
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/bot/handlers/prompt.tenant-runtime.test.ts tests/opencode/client.test.ts`
Expected: PASS with runtime/auth gating before session creation.

- [ ] **Step 5: Commit**

```bash
git add src/bot/handlers/prompt.ts src/bot/index.ts tests/bot/handlers/prompt.tenant-runtime.test.ts
git commit -m "feat(bot): gate prompts on tenant runtime readiness"
```

### Task 9: Replace Shared Process Assumptions With Tenant Runtime Lifecycle Hooks

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/process/manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/opencode-start.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/opencode-stop.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/status.ts`
- Test: `/home/me/MyProjects/opencode-tg/tests/process/manager.test.ts`

- [ ] **Step 1: Write the failing process-manager test for tenant lifecycle delegation**

```ts
it("can report that shared host process mode is disabled when tenant runtime mode is active", async () => {
  const result = await processManager.start();
  expect(result).toEqual({
    success: false,
    error: "Shared OpenCode server mode is disabled when tenant runtimes are enabled",
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/process/manager.test.ts`
Expected: FAIL because the process manager always attempts to spawn one shared server.

- [ ] **Step 3: Add explicit shared-mode guard to the existing manager**

```ts
// src/process/manager.ts
if (config.runtime.enableTenantRuntimes) {
  return {
    success: false,
    error: "Shared OpenCode server mode is disabled when tenant runtimes are enabled",
  };
}
```

Note: keep the existing shared process implementation behind this guard for backward compatibility until the full migration is complete.

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/process/manager.test.ts tests/config.test.ts`
Expected: PASS with tenant-mode guard coverage added.

- [ ] **Step 5: Commit**

```bash
git add src/process/manager.ts src/bot/commands/opencode-start.ts src/bot/commands/opencode-stop.ts src/bot/commands/status.ts tests/process/manager.test.ts src/config.ts
git commit -m "feat(process): guard shared server mode under tenant runtimes"
```

### Task 10: Add Tenant Runtime Container Image Assets

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/docker/opencode-tenant/Dockerfile`
- Create: `/home/me/MyProjects/opencode-tg/docker/opencode-tenant/entrypoint.sh`
- Create: `/home/me/MyProjects/opencode-tg/docker/opencode-tenant/supervisord.conf`
- Create: `/home/me/MyProjects/opencode-tg/docs/container-runtime.md`

- [ ] **Step 1: Write the runtime image definition**

```dockerfile
FROM node:20-bookworm-slim

RUN apt-get update && apt-get install -y python3 python3-venv supervisor && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

ENV TG_CLI_HOME=/var/lib/tg-cli
ENV OPENCODE_TELEGRAM_HOME=/workspace

ENTRYPOINT ["/app/docker/opencode-tenant/entrypoint.sh"]
```
```

- [ ] **Step 2: Write the entrypoint script**

```sh
#!/bin/sh
set -eu

mkdir -p /workspace /var/lib/tg-cli /var/cache/opencode /var/log/opencode
exec supervisord -c /app/docker/opencode-tenant/supervisord.conf
```

- [ ] **Step 3: Write the supervisor config**

```ini
[supervisord]
nodaemon=true

[program:opencode]
command=opencode serve --hostname 0.0.0.0 --port 4096
directory=/workspace
autorestart=true

[program:tgcli-daemon]
command=/bin/sh -lc "cd /app/../opencode-telegram-bot/tg-cli && uv run python -m tg_cli.daemon.http_server"
autorestart=true
```

- [ ] **Step 4: Document the operational workflow**

Add `docs/container-runtime.md` describing:

```md
- build the readonly tenant image
- run it rootless with only tenant-specific mounts
- expose OpenCode on 127.0.0.1:<tenant-port>
- stop idle containers after timeout
- never mount host home, docker.sock, or other tenant directories
```

- [ ] **Step 5: Verify the assets are internally consistent**

Run: `grep -n "opencode serve\|supervisord\|tg_cli.daemon.http_server" docker/opencode-tenant/Dockerfile docker/opencode-tenant/entrypoint.sh docker/opencode-tenant/supervisord.conf docs/container-runtime.md`
Expected: matching references to the same entrypoints and runtime roles.

- [ ] **Step 6: Commit**

```bash
git add docker/opencode-tenant/Dockerfile docker/opencode-tenant/entrypoint.sh docker/opencode-tenant/supervisord.conf docs/container-runtime.md
git commit -m "feat(runtime): add tenant container image assets"
```

### Task 11: Run End-to-End Verification for the First Increment

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/docs/superpowers/plans/2026-03-27-multi-user-isolated-runtime.md`

- [x] **Step 1: Run focused `opencode-tg` tests**

Run: `npm test -- tests/runtime/tenant-paths.test.ts tests/runtime/tenant-runtime-manager.test.ts tests/runtime/container-runner.test.ts tests/opencode/client.test.ts tests/process/manager.test.ts tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts tests/bot/handlers/prompt.tenant-runtime.test.ts tests/config.test.ts`
Expected: PASS.

Observed on 2026-03-28: PASS (`9` files, `55` tests).

- [x] **Step 2: Run focused `tg-cli` tests**

Run: `uv run pytest tests/test_config.py tests/test_client.py tests/test_daemon_api.py tests/test_binding_use_cases.py tests/test_bot_mode_use_cases.py`
Expected: PASS.

Observed on 2026-03-28: PASS (`40` tests).

- [x] **Step 3: Run `opencode-tg` build**

Run: `npm run build`
Expected: TypeScript build completes with exit code 0.

Observed on 2026-03-28: PASS (`tsc` exited 0).

- [x] **Step 4: Record any gaps discovered during verification**

```md
If any command fails, update this plan before continuing so the next engineer sees the exact missing work.
```

Verification note on 2026-03-28: the focused `opencode-tg` test suite, focused `tg-cli` test suite, and `opencode-tg` TypeScript build all passed. Non-blocking observation: the focused `opencode-tg` Vitest run emitted repeated Node `[DEP0040]` `punycode` deprecation warnings from runtime dependencies, but this verification run did not expose any failing tests or build errors.

- [ ] **Step 5: Commit**

```bash
git add docs/superpowers/plans/2026-03-27-multi-user-isolated-runtime.md
git commit -m "docs(plan): record multi-user isolated runtime verification"
```
