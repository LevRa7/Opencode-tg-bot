# Tenant Runtime Routing Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Finish the remaining multi-tenant runtime gap so each Telegram user gets a stable tenant registry record, a stable pair of tenant-local localhost routes, and fully isolated routing for both `opencode serve` and the `tg-cli` daemon.

**Architecture:** Keep the Telegram bot as the control plane and the per-tenant rootless container as the execution plane. Add a JSON-backed tenant registry that maps `tg_id` to a stable internal `userNumber`, compute tenant ports from that number, expand the runtime descriptor to carry both tenant-local endpoints, and make the runtime manager start, probe, and return a tenant runtime only when both services are healthy.

**Tech Stack:** TypeScript, Node.js, Vitest, grammY, OpenCode SDK, rootless Docker or Podman, JSON-backed persistence

---

## File Structure Map

### Plan target workspace

- Use the active implementation worktree for code changes: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime`

### New files

- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-registry-types.ts` - tenant registry file and record types
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-registry.ts` - JSON-backed registry service with atomic writes
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-port-allocation.ts` - internal tenant number to host port mapping
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/tenant-registry.test.ts` - registry behavior coverage
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/tenant-port-allocation.test.ts` - port mapping and range validation coverage

### Files to modify

- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/config.ts` - tenant registry path, `tg-cli` internal port, and tenant port base config
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-runtime-types.ts` - add `tenantNumber` and `tgCliDaemonUrl`, remove `needs_auth` from runtime status
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/container-runner.ts` - publish two localhost ports and env wiring
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-runtime-manager.ts` - orchestrate tenant registration, launch, readiness, and activity updates
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/tg-cli/client.ts` - keep per-endpoint client creation clean for tenant-local routing
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/bot/auth/tenant-auth-gate.ts` - keep auth state separate from runtime state while preserving fail-closed behavior
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/bot/handlers/prompt.ts` - rely on a fully resolved tenant runtime descriptor with both endpoints
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/bot/index.ts` - replace placeholder tenant runtime routing and global daemon URL wiring
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/docs/container-runtime.md` - finalize chosen two-port topology and remove unresolved routing note

### Existing tests to extend

- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/config.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/container-runner.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/tenant-runtime-manager.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/tg-cli/client.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/bot/auth/tenant-auth-gate.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/bot/handlers/prompt.tenant-runtime.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/bot/commands/runtime-lifecycle.test.ts`

---

### Task 1: Add tenant registry types and runtime config

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-registry-types.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/config.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/config.test.ts`

- [ ] **Step 1: Write the failing config and type-shape tests**

```ts
import { describe, expect, it, vi } from "vitest";

describe("runtime tenant registry config", () => {
  it("uses default tenant registry and port settings", async () => {
    vi.stubEnv("OPENCODE_TENANT_REGISTRY_PATH", "");
    vi.stubEnv("OPENCODE_TENANT_TGCLI_CONTAINER_PORT", "");
    vi.stubEnv("OPENCODE_TENANT_OPENCODE_PORT_BASE", "");
    vi.stubEnv("OPENCODE_TENANT_TGCLI_PORT_BASE", "");

    const { config } = await import("../../src/config.js");

    expect(config.runtime.tenantRegistryPath).toContain("data/tenants.json");
    expect(config.runtime.tenantTgCliContainerPort).toBe(8081);
    expect(config.runtime.tenantOpencodePortBase).toBe(20000);
    expect(config.runtime.tenantTgCliPortBase).toBe(30000);
  });
});
```

```ts
import { describe, expect, it } from "vitest";
import type { TenantRegistryFile } from "../../src/runtime/tenant-registry-types.js";

describe("runtime/tenant-registry-types", () => {
  it("supports a versioned tenant registry file shape", () => {
    const registry: TenantRegistryFile = {
      version: 1,
      nextUserNumber: 2,
      tenants: [],
    };

    expect(registry.version).toBe(1);
    expect(registry.nextUserNumber).toBe(2);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/config.test.ts`
Expected: FAIL because tenant registry config fields and registry types do not exist yet.

- [ ] **Step 3: Add runtime config and registry file types**

```ts
// src/runtime/tenant-registry-types.ts
export interface TenantRegistryRecord {
  userNumber: number;
  tgId: number;
  workspaceRelativePath: string;
  tenantRoot: string;
  containerName: string;
  opencodePort: number;
  tgCliPort: number;
  createdAt: string;
  lastSeenAt: string;
}

export interface TenantRegistryFile {
  version: 1;
  nextUserNumber: number;
  tenants: TenantRegistryRecord[];
}
```

```ts
// src/config.ts (runtime shape excerpt)
runtime: {
  enableTenantRuntimes: getOptionalBooleanEnvVar("OPENCODE_ENABLE_TENANT_RUNTIMES", false),
  tenantsRoot: getEnvVar("OPENCODE_TENANTS_ROOT", false) || "/srv/opencode-tenants",
  tenantRegistryPath:
    getEnvVar("OPENCODE_TENANT_REGISTRY_PATH", false) || "data/tenants.json",
  tenantContainerRuntimeBinary:
    getEnvVar("OPENCODE_TENANT_CONTAINER_RUNTIME_BINARY", false) || "docker",
  tenantContainerImage:
    getEnvVar("OPENCODE_TENANT_CONTAINER_IMAGE", false) || "opencode-tenant:latest",
  tenantOpencodeContainerPort: getOptionalPositiveIntEnvVar(
    "OPENCODE_TENANT_OPENCODE_CONTAINER_PORT",
    4096,
  ),
  tenantTgCliContainerPort: getOptionalPositiveIntEnvVar(
    "OPENCODE_TENANT_TGCLI_CONTAINER_PORT",
    8081,
  ),
  tenantOpencodePortBase: getOptionalPositiveIntEnvVar(
    "OPENCODE_TENANT_OPENCODE_PORT_BASE",
    20000,
  ),
  tenantTgCliPortBase: getOptionalPositiveIntEnvVar(
    "OPENCODE_TENANT_TGCLI_PORT_BASE",
    30000,
  ),
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/config.test.ts`
Expected: PASS with tenant registry and port config coverage.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/tenant-registry-types.ts src/config.ts tests/config.test.ts
git commit -m "feat(runtime): add tenant registry config"
```

### Task 2: Add JSON-backed tenant registry service

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-registry.ts`
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/tenant-registry.test.ts`

- [ ] **Step 1: Write the failing tenant registry tests**

```ts
import { describe, expect, it } from "vitest";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createTenantRegistry } from "../../src/runtime/tenant-registry.js";

describe("runtime/tenant-registry", () => {
  it("creates a new tenant record with the next internal user number", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "tenant-registry-"));
    const registry = createTenantRegistry({
      registryPath: path.join(tempDir, "tenants.json"),
      tenantsRoot: "/srv/opencode-tenants",
      buildWorkspaceRelativePath: (tgId) => `sessions/${tgId}`,
      buildContainerName: (tgId) => `opencode-tenant-${tgId}`,
      allocatePorts: (userNumber) => ({
        opencodePort: 20000 + userNumber,
        tgCliPort: 30000 + userNumber,
      }),
    });

    const record = await registry.getOrCreateTenant(42);

    expect(record.userNumber).toBe(1);
    expect(record.opencodePort).toBe(20001);
    expect(record.tgCliPort).toBe(30001);

    const persisted = JSON.parse(await readFile(path.join(tempDir, "tenants.json"), "utf8"));
    expect(persisted.nextUserNumber).toBe(2);
    expect(persisted.tenants).toHaveLength(1);
  });

  it("reuses the same record when the same tgId is resolved twice", async () => {
    const tempDir = await mkdtemp(path.join(os.tmpdir(), "tenant-registry-"));
    const registry = createTenantRegistry({
      registryPath: path.join(tempDir, "tenants.json"),
      tenantsRoot: "/srv/opencode-tenants",
      buildWorkspaceRelativePath: (tgId) => `sessions/${tgId}`,
      buildContainerName: (tgId) => `opencode-tenant-${tgId}`,
      allocatePorts: (userNumber) => ({
        opencodePort: 20000 + userNumber,
        tgCliPort: 30000 + userNumber,
      }),
    });

    const first = await registry.getOrCreateTenant(42);
    const second = await registry.getOrCreateTenant(42);

    expect(second.userNumber).toBe(first.userNumber);
    expect(second.opencodePort).toBe(first.opencodePort);
    expect(second.tgCliPort).toBe(first.tgCliPort);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime/tenant-registry.test.ts`
Expected: FAIL with module-not-found for `src/runtime/tenant-registry.ts`.

- [ ] **Step 3: Implement the registry service with atomic writes**

```ts
// src/runtime/tenant-registry.ts
import { mkdir, readFile, writeFile, rename } from "node:fs/promises";
import path from "node:path";
import type { TenantRegistryFile, TenantRegistryRecord } from "./tenant-registry-types.js";

export interface TenantRegistry {
  getOrCreateTenant(tgId: number): Promise<TenantRegistryRecord>;
  touchTenant(tgId: number): Promise<void>;
}

function createEmptyRegistry(): TenantRegistryFile {
  return { version: 1, nextUserNumber: 1, tenants: [] };
}

export function createTenantRegistry(options: {
  registryPath: string;
  tenantsRoot: string;
  buildWorkspaceRelativePath: (tgId: number) => string;
  buildContainerName: (tgId: number) => string;
  allocatePorts: (userNumber: number) => { opencodePort: number; tgCliPort: number };
}): TenantRegistry {
  async function loadRegistry(): Promise<TenantRegistryFile> {
    try {
      const text = await readFile(options.registryPath, "utf8");
      return JSON.parse(text) as TenantRegistryFile;
    } catch {
      return createEmptyRegistry();
    }
  }

  async function saveRegistry(registry: TenantRegistryFile): Promise<void> {
    await mkdir(path.dirname(options.registryPath), { recursive: true });
    const tempPath = `${options.registryPath}.tmp`;
    await writeFile(tempPath, JSON.stringify(registry, null, 2));
    await rename(tempPath, options.registryPath);
  }

  return {
    async getOrCreateTenant(tgId: number): Promise<TenantRegistryRecord> {
      const registry = await loadRegistry();
      const existing = registry.tenants.find((tenant) => tenant.tgId === tgId);
      if (existing) {
        return existing;
      }

      const userNumber = registry.nextUserNumber;
      const ports = options.allocatePorts(userNumber);
      const now = new Date().toISOString();
      const record: TenantRegistryRecord = {
        userNumber,
        tgId,
        workspaceRelativePath: options.buildWorkspaceRelativePath(tgId),
        tenantRoot: path.join(options.tenantsRoot, String(tgId)),
        containerName: options.buildContainerName(tgId),
        opencodePort: ports.opencodePort,
        tgCliPort: ports.tgCliPort,
        createdAt: now,
        lastSeenAt: now,
      };

      registry.tenants.push(record);
      registry.nextUserNumber = userNumber + 1;
      await saveRegistry(registry);
      return record;
    },
    async touchTenant(tgId: number): Promise<void> {
      const registry = await loadRegistry();
      const record = registry.tenants.find((tenant) => tenant.tgId === tgId);
      if (!record) {
        return;
      }

      record.lastSeenAt = new Date().toISOString();
      await saveRegistry(registry);
    },
  };
}
```

- [ ] **Step 4: Add uniqueness validation before saving**

```ts
function validateRegistry(registry: TenantRegistryFile): void {
  const tgIds = new Set<number>();
  const userNumbers = new Set<number>();
  const opencodePorts = new Set<number>();
  const tgCliPorts = new Set<number>();

  for (const tenant of registry.tenants) {
    if (tgIds.has(tenant.tgId) || userNumbers.has(tenant.userNumber)) {
      throw new Error("Tenant registry contains duplicate tenant identity");
    }
    if (opencodePorts.has(tenant.opencodePort) || tgCliPorts.has(tenant.tgCliPort)) {
      throw new Error("Tenant registry contains duplicate port allocation");
    }

    tgIds.add(tenant.tgId);
    userNumbers.add(tenant.userNumber);
    opencodePorts.add(tenant.opencodePort);
    tgCliPorts.add(tenant.tgCliPort);
  }
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/runtime/tenant-registry.test.ts`
Expected: PASS with tenant creation, reuse, and persistence coverage.

- [ ] **Step 6: Commit**

```bash
git add src/runtime/tenant-registry.ts tests/runtime/tenant-registry.test.ts
git commit -m "feat(runtime): add json tenant registry"
```

### Task 3: Add tenant port allocation and expand the container runner to two ports

**Files:**
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-port-allocation.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/container-runner.ts`
- Create: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/tenant-port-allocation.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/container-runner.test.ts`

- [ ] **Step 1: Write the failing port-allocation and two-port container tests**

```ts
import { describe, expect, it } from "vitest";
import { allocateTenantPorts } from "../../src/runtime/tenant-port-allocation.js";

describe("runtime/tenant-port-allocation", () => {
  it("allocates stable OpenCode and tg-cli ports from tenant user number", () => {
    expect(
      allocateTenantPorts({ userNumber: 7, opencodePortBase: 20000, tgCliPortBase: 30000 }),
    ).toEqual({
      opencodePort: 20007,
      tgCliPort: 30007,
    });
  });

  it("rejects allocations that exceed the TCP port range", () => {
    expect(() =>
      allocateTenantPorts({ userNumber: 40000, opencodePortBase: 30000, tgCliPortBase: 40000 }),
    ).toThrow(/valid TCP range/);
  });
});
```

```ts
it("builds argv for a rootless tenant container with both OpenCode and tg-cli localhost bindings", () => {
  const command = buildRootlessTenantContainerRunCommand({
    rootlessRuntimeBinary: "docker",
    image: "opencode-tenant:latest",
    containerName: "opencode-tenant-42",
    workspaceMount: {
      hostPath: "/srv/opencode-tenants/42/workspace",
      containerPath: "/workspace",
      accessMode: "rw",
    },
    tgCliMount: {
      hostPath: "/srv/opencode-tenants/42/tg-cli",
      containerPath: "/var/lib/tg-cli",
      accessMode: "rw",
    },
    opencodePortBinding: {
      hostAddress: "127.0.0.1",
      hostPort: 20001,
      containerPort: 4096,
    },
    tgCliPortBinding: {
      hostAddress: "127.0.0.1",
      hostPort: 30001,
      containerPort: 8081,
    },
  });

  expect(command.argv).toContain("127.0.0.1:20001:4096");
  expect(command.argv).toContain("127.0.0.1:30001:8081");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/runtime/tenant-port-allocation.test.ts tests/runtime/container-runner.test.ts`
Expected: FAIL because tenant port allocation and second port binding do not exist yet.

- [ ] **Step 3: Implement port allocation and two-port container binding**

```ts
// src/runtime/tenant-port-allocation.ts
export interface TenantPortAllocationInput {
  userNumber: number;
  opencodePortBase: number;
  tgCliPortBase: number;
}

export function allocateTenantPorts(input: TenantPortAllocationInput): {
  opencodePort: number;
  tgCliPort: number;
} {
  const opencodePort = input.opencodePortBase + input.userNumber;
  const tgCliPort = input.tgCliPortBase + input.userNumber;

  if (opencodePort > 65535 || tgCliPort > 65535) {
    throw new Error("Tenant port allocation exceeds the valid TCP range");
  }

  return { opencodePort, tgCliPort };
}
```

```ts
// src/runtime/container-runner.ts (shape excerpt)
export interface RootlessTenantRuntimeLaunchSpec {
  rootlessRuntimeBinary: string;
  image: string;
  containerName: TenantRuntimeContainerName;
  workspaceMount: TenantWorkspaceMount;
  tgCliMount: TenantWorkspaceMount;
  opencodePortBinding: TenantRuntimePortBinding;
  tgCliPortBinding: TenantRuntimePortBinding;
}

export function buildRootlessTenantContainerRunCommand(
  spec: RootlessTenantRuntimeLaunchSpec,
): RootlessTenantContainerRunCommand {
  return {
    runtimeMode: "rootless",
    argv: [
      spec.rootlessRuntimeBinary,
      "run",
      "--read-only",
      "--rm",
      "--name",
      spec.containerName,
      "-p",
      formatTenantRuntimePortBinding(spec.opencodePortBinding),
      "-p",
      formatTenantRuntimePortBinding(spec.tgCliPortBinding),
      "-v",
      formatTenantWorkspaceMount(spec.workspaceMount),
      "-v",
      formatTenantWorkspaceMount(spec.tgCliMount),
      spec.image,
    ],
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime/tenant-port-allocation.test.ts tests/runtime/container-runner.test.ts tests/config.test.ts`
Expected: PASS with both runtime port bindings and config-backed defaults covered.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/tenant-port-allocation.ts src/runtime/container-runner.ts tests/runtime/tenant-port-allocation.test.ts tests/runtime/container-runner.test.ts tests/config.test.ts
git commit -m "feat(runtime): add stable tenant port allocation"
```

### Task 4: Turn the tenant runtime manager into a real lifecycle orchestrator

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-runtime-types.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/runtime/tenant-runtime-manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/runtime/tenant-runtime-manager.test.ts`

- [ ] **Step 1: Write the failing runtime-manager tests for registry-backed dual-service readiness**

```ts
import { describe, expect, it, vi } from "vitest";
import { createTenantRuntimeManager } from "../../src/runtime/tenant-runtime-manager.js";

describe("runtime/tenant-runtime-manager", () => {
  it("returns a ready tenant runtime only after both OpenCode and tg-cli are healthy", async () => {
    const manager = createTenantRuntimeManager({
      getOrCreateTenant: vi.fn(async () => ({
        userNumber: 1,
        tgId: 42,
        workspaceRelativePath: "sessions/42",
        tenantRoot: "/srv/opencode-tenants/42",
        containerName: "opencode-tenant-42",
        opencodePort: 20001,
        tgCliPort: 30001,
        createdAt: "2026-03-28T12:00:00.000Z",
        lastSeenAt: "2026-03-28T12:00:00.000Z",
      })),
      ensureTenantDirectories: vi.fn(async () => undefined),
      ensureContainerRunning: vi.fn(async () => undefined),
      waitForOpenCodeReady: vi.fn(async () => undefined),
      waitForTgCliReady: vi.fn(async () => undefined),
      touchTenant: vi.fn(async () => undefined),
    });

    await expect(manager.ensureReady(42)).resolves.toMatchObject({
      tenantId: 42,
      tenantNumber: 1,
      status: "ready",
      opencodeBaseUrl: "http://127.0.0.1:20001",
      tgCliDaemonUrl: "http://127.0.0.1:30001",
    });
  });

  it("fails when tg-cli readiness does not succeed", async () => {
    const manager = createTenantRuntimeManager({
      getOrCreateTenant: vi.fn(async () => ({
        userNumber: 1,
        tgId: 42,
        workspaceRelativePath: "sessions/42",
        tenantRoot: "/srv/opencode-tenants/42",
        containerName: "opencode-tenant-42",
        opencodePort: 20001,
        tgCliPort: 30001,
        createdAt: "2026-03-28T12:00:00.000Z",
        lastSeenAt: "2026-03-28T12:00:00.000Z",
      })),
      ensureTenantDirectories: vi.fn(async () => undefined),
      ensureContainerRunning: vi.fn(async () => undefined),
      waitForOpenCodeReady: vi.fn(async () => undefined),
      waitForTgCliReady: vi.fn(async () => {
        throw new Error("tg-cli readiness failed");
      }),
      touchTenant: vi.fn(async () => undefined),
    });

    await expect(manager.ensureReady(42)).rejects.toThrow("tg-cli readiness failed");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/runtime/tenant-runtime-manager.test.ts`
Expected: FAIL because the manager does not yet coordinate tenant registration, dual readiness, or `tgCliDaemonUrl`.

- [ ] **Step 3: Expand runtime types and implement orchestration flow**

```ts
// src/runtime/tenant-runtime-types.ts
export type TenantRuntimeStatus = "starting" | "ready" | "stopped" | "error";

export interface TenantRuntimeDescriptor {
  tenantId: number;
  tenantNumber: number;
  status: TenantRuntimeStatus;
  workspaceRelativePath: string;
  containerName: string;
  opencodeBaseUrl: string;
  tgCliDaemonUrl: string;
  message?: string;
}

export interface ReadyTenantRuntimeDescriptor extends TenantRuntimeDescriptor {
  status: "ready";
}
```

```ts
// src/runtime/tenant-runtime-manager.ts
export function createTenantRuntimeManager(options: {
  getOrCreateTenant: (tgId: number) => Promise<TenantRegistryRecord>;
  ensureTenantDirectories: (tenant: TenantRegistryRecord) => Promise<void>;
  ensureContainerRunning: (tenant: TenantRegistryRecord) => Promise<void>;
  waitForOpenCodeReady: (baseUrl: string) => Promise<void>;
  waitForTgCliReady: (daemonUrl: string) => Promise<void>;
  touchTenant: (tgId: number) => Promise<void>;
}): TenantRuntimeManager {
  return {
    async ensureReady(tgId: number): Promise<ReadyTenantRuntimeDescriptor> {
      const tenant = await options.getOrCreateTenant(tgId);
      await options.ensureTenantDirectories(tenant);
      await options.ensureContainerRunning(tenant);

      const opencodeBaseUrl = `http://127.0.0.1:${tenant.opencodePort}`;
      const tgCliDaemonUrl = `http://127.0.0.1:${tenant.tgCliPort}`;

      await options.waitForOpenCodeReady(opencodeBaseUrl);
      await options.waitForTgCliReady(tgCliDaemonUrl);
      await options.touchTenant(tgId);

      return {
        tenantId: tgId,
        tenantNumber: tenant.userNumber,
        status: "ready",
        workspaceRelativePath: tenant.workspaceRelativePath,
        containerName: tenant.containerName,
        opencodeBaseUrl,
        tgCliDaemonUrl,
      };
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/runtime/tenant-runtime-manager.test.ts`
Expected: PASS with dual-service readiness and stable endpoint construction covered.

- [ ] **Step 5: Commit**

```bash
git add src/runtime/tenant-runtime-types.ts src/runtime/tenant-runtime-manager.ts tests/runtime/tenant-runtime-manager.test.ts
git commit -m "feat(runtime): orchestrate dual-service tenant readiness"
```

### Task 5: Route bot auth and prompt flow through tenant-local `tg-cli` endpoints

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/bot/index.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/tg-cli/client.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/bot/auth/tenant-auth-gate.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/bot/handlers/prompt.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/tg-cli/client.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/bot/auth/tenant-auth-gate.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/bot/handlers/prompt.tenant-runtime.test.ts`

- [ ] **Step 1: Write the failing bot-routing tests**

```ts
it("creates the tg-cli bot client from the tenant runtime daemon URL", async () => {
  const runtime = {
    tenantId: 42,
    tenantNumber: 1,
    status: "ready" as const,
    workspaceRelativePath: "sessions/42",
    containerName: "opencode-tenant-42",
    opencodeBaseUrl: "http://127.0.0.1:20001",
    tgCliDaemonUrl: "http://127.0.0.1:30001",
  };

  const createTgCliBotClientMock = vi.fn(() => ({
    getBotRuntimeState: vi.fn(async () => ({ botUserId: "42", status: "bound" as const })),
  }));

  // assert createTgCliBotClient receives runtime.tgCliDaemonUrl
});
```

```ts
it("blocks prompt execution when the tenant runtime is ready but tenant auth still needs onboarding", async () => {
  const ensureTenantRuntime = vi.fn(async () => ({
    tenantId: 42,
    tenantNumber: 1,
    status: "ready" as const,
    workspaceRelativePath: "sessions/42",
    containerName: "opencode-tenant-42",
    opencodeBaseUrl: "http://127.0.0.1:20001",
    tgCliDaemonUrl: "http://127.0.0.1:30001",
  }));

  const ensureTenantAuth = vi.fn(async () => {
    throw new TenantAuthRequiredError(42, "needs_auth");
  });

  // assert processUserPrompt() returns false and sends onboarding guidance
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm test -- tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts tests/bot/handlers/prompt.tenant-runtime.test.ts`
Expected: FAIL because bot wiring still builds `tg-cli` from a global daemon URL.

- [ ] **Step 3: Replace global daemon routing with runtime-derived daemon routing**

```ts
// src/bot/index.ts (shape excerpt)
function createPromptDeps(bot: Bot<Context>) {
  const tenantRuntimeManager = createTenantRuntimeManager({
    // inject registry-backed lifecycle dependencies here
  });

  return {
    bot,
    ensureEventSubscription,
    ensureTenantRuntime: (tenantId: number) => tenantRuntimeManager.ensureReady(tenantId),
    ensureTenantAuth: async (tenantId: number, runtime: ReadyTenantRuntimeDescriptor) => {
      const tgCliBotClient = createTgCliBotClient({
        daemonUrl: runtime.tgCliDaemonUrl,
      });

      const tenantAuthGate = createTenantAuthGate({
        getBotRuntimeState: (requestedTenantId) => tgCliBotClient.getBotRuntimeState(requestedTenantId),
      });

      await tenantAuthGate.ensureAuthorized(tenantId);
    },
  };
}
```

```ts
// src/bot/handlers/prompt.ts (contract excerpt)
export interface ProcessPromptDeps {
  bot: Bot<Context>;
  ensureEventSubscription: (directory: string, tenantRuntimeBaseUrl?: string) => Promise<void>;
  ensureTenantRuntime?: (tenantId: number) => Promise<ReadyTenantRuntimeDescriptor>;
  ensureTenantAuth?: (
    tenantId: number,
    tenantRuntimeDescriptor: ReadyTenantRuntimeDescriptor,
  ) => Promise<void>;
}
```

`prompt.ts` already has the right call shape; keep it and make the injected implementation truly tenant-local.

- [ ] **Step 4: Keep auth and runtime semantics separate**

```ts
// src/bot/auth/tenant-auth-gate.ts
export class TenantAuthRequiredError extends Error {
  public constructor(
    public readonly tgId: number,
    public readonly status: TgCliBotRuntimeState["status"] = "needs_auth",
  ) {
    super(`Tenant ${tgId} ${status}`);
    this.name = "TenantAuthRequiredError";
  }
}

// Keep gate logic the same: runtime must already be ready;
// this gate only decides bound vs needs_auth/replacing.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts tests/bot/handlers/prompt.tenant-runtime.test.ts`
Expected: PASS with tenant-local daemon routing and auth gating covered.

- [ ] **Step 6: Commit**

```bash
git add src/bot/index.ts src/tg-cli/client.ts src/bot/auth/tenant-auth-gate.ts src/bot/handlers/prompt.ts tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts tests/bot/handlers/prompt.tenant-runtime.test.ts
git commit -m "feat(bot): route tenant auth through tenant-local daemon"
```

### Task 6: Finalize docs, status surfaces, and verification

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/docs/container-runtime.md`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/src/process/manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/.worktrees/multi-user-runtime/tests/bot/commands/runtime-lifecycle.test.ts`

- [ ] **Step 1: Write the failing status/doc expectation test**

```ts
it("describes tenant runtime mode without unresolved daemon routing wording", async () => {
  const message = await renderRuntimeStatusMessage(/* tenant runtime mode */);
  expect(message).toContain("tenant runtimes");
  expect(message).not.toContain("not yet composed");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- tests/bot/commands/runtime-lifecycle.test.ts`
Expected: FAIL because placeholder lifecycle messaging still assumes unresolved runtime composition.

- [ ] **Step 3: Update runtime-mode docs and status wording**

```md
<!-- docs/container-runtime.md -->
## Readiness And Routing

Chosen topology:

- one tenant-local OpenCode HTTP route published on `127.0.0.1:<opencodePort>`
- one tenant-local `tg-cli` daemon HTTP route published on `127.0.0.1:<tgCliPort>`
- both routes are derived from the tenant registry's internal `userNumber`

Runtime is considered ready only when both endpoints are healthy.
```

```ts
// src/process/manager.ts (status behavior only)
// Keep shared-server commands disabled in tenant-runtime mode,
// but update status text assumptions to reflect that tenant lifecycle is now the real runtime path.
```

- [ ] **Step 4: Run targeted verification**

Run: `npm test -- tests/runtime/tenant-registry.test.ts tests/runtime/tenant-port-allocation.test.ts tests/runtime/container-runner.test.ts tests/runtime/tenant-runtime-manager.test.ts tests/tg-cli/client.test.ts tests/bot/auth/tenant-auth-gate.test.ts tests/bot/handlers/prompt.tenant-runtime.test.ts tests/bot/commands/runtime-lifecycle.test.ts`
Expected: PASS for all tenant runtime routing follow-up tests.

- [ ] **Step 5: Run build verification**

Run: `npm run build`
Expected: PASS with no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add docs/container-runtime.md src/process/manager.ts tests/bot/commands/runtime-lifecycle.test.ts
git commit -m "docs(runtime): finalize tenant routing topology"
```

## Self-Review Checklist

- Spec coverage: this plan covers tenant registry, internal tenant numbering, stable two-port allocation, runtime/auth state separation, lifecycle orchestration, tenant-local bot routing, and documentation closure.
- Placeholder scan: no task depends on an undefined topology decision; the two-port localhost model is fully specified.
- Type consistency: `tenantNumber`, `opencodeBaseUrl`, and `tgCliDaemonUrl` are used consistently across runtime, bot, and tests.
