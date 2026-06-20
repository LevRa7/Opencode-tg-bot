# VM Phase 1 — RLM-Style Architecture (Foundation)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Implement the first three RLM patterns from the migration plan: `VmStatePersistence` (typed SQLite state with versioning), `HealthProxy` (typed health checks with deterministic password), `VmEnvironment` interface + `LibvirtEnvironment` implementation.

**Architecture:** New files under `src/vm/` with clean interfaces. Existing `VmManager` is wrapped by `LibvirtEnvironment`. State is persisted via `better-sqlite3` (already a dependency) with version-based optimistic concurrency.

**Tech Stack:** TypeScript, better-sqlite3, vitest, node-fetch

---

### Task 1: VmStatePersistence

**Files:**
- Create: `src/vm/state-persistence.ts`
- Create: `tests/vm/state-persistence.test.ts`
- Modify: `src/vm/types.ts` — add `VmStateRecord`, `VmStateStatus`

**Interfaces:**

```typescript
export type VmStateStatus = "provisioning" | "healthy" | "unhealthy" | "destroyed";

export interface VmStateRecord {
  vmId: string;
  userId: number;
  environmentType: string;
  specTier: string;
  assignedIpv4: string;
  assignedMac: string;
  domainName: string;
  passwordHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: VmStateStatus;
}

export interface VmStatePersistence {
  save(record: VmStateRecord): void;
  getByUserId(userId: number): VmStateRecord | undefined;
  getByVmId(vmId: string): VmStateRecord | undefined;
  listActive(): VmStateRecord[];
  markDestroyed(vmId: string): boolean;
  updateIfCurrent(vmId: string, expectedVersion: number, patch: Partial<VmStateRecord>): boolean;
}
```

- [ ] **Step 1: Write the failing test**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createVmStatePersistence, type VmStateRecord } from "../../src/vm/state-persistence.js";

const DDL = `
CREATE TABLE IF NOT EXISTS vm_states (
  vm_id           TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  environment_type TEXT NOT NULL,
  spec_tier       TEXT NOT NULL DEFAULT 'small',
  assigned_ipv4   TEXT,
  assigned_mac    TEXT,
  domain_name     TEXT,
  password_hash   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'provisioning',
  UNIQUE(user_id)
);
`;

describe("VmStatePersistence", () => {
  let db: Database.Database;
  let persistence: ReturnType<typeof createVmStatePersistence>;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
    persistence = createVmStatePersistence(db);
  });

  it("returns undefined for non-existent user", () => {
    const result = persistence.getByUserId(999);
    expect(result).toBeUndefined();
  });

  it("saves and retrieves a state record", () => {
    const record: VmStateRecord = {
      vmId: "vm-1",
      userId: 42,
      environmentType: "libvirt",
      specTier: "medium",
      assignedIpv4: "10.100.0.50",
      assignedMac: "52:54:00:ab:cd:ef",
      domainName: "opencode-tg-42",
      passwordHash: "abc123",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "healthy",
    };
    persistence.save(record);
    const loaded = persistence.getByUserId(42);
    expect(loaded).toBeDefined();
    expect(loaded!.vmId).toBe("vm-1");
    expect(loaded!.userId).toBe(42);
    expect(loaded!.status).toBe("healthy");
    expect(loaded!.version).toBe(1);
  });

  it("increments version on re-save", () => {
    const record: VmStateRecord = {
      vmId: "vm-1", userId: 42, environmentType: "libvirt", specTier: "medium",
      assignedIpv4: "10.100.0.50", assignedMac: "52:54:00:ab:cd:ef",
      domainName: "opencode-tg-42", passwordHash: "abc123",
      version: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01", status: "provisioning",
    };
    persistence.save(record);
    const loaded = persistence.getByUserId(42);
    expect(loaded!.version).toBe(2);
  });

  it("updateIfCurrent succeeds when version matches", () => {
    const record: VmStateRecord = {
      vmId: "vm-1", userId: 42, environmentType: "libvirt", specTier: "medium",
      assignedIpv4: "10.100.0.50", assignedMac: "52:54:00:ab:cd:ef",
      domainName: "opencode-tg-42", passwordHash: "abc123",
      version: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01", status: "provisioning",
    };
    persistence.save(record);
    const result = persistence.updateIfCurrent("vm-1", 2, { status: "healthy" });
    expect(result).toBe(true);
    const updated = persistence.getByUserId(42);
    expect(updated!.status).toBe("healthy");
    expect(updated!.version).toBe(3);
  });

  it("updateIfCurrent fails when version does not match", () => {
    const record: VmStateRecord = {
      vmId: "vm-1", userId: 42, environmentType: "libvirt", specTier: "medium",
      assignedIpv4: "10.100.0.50", assignedMac: "52:54:00:ab:cd:ef",
      domainName: "opencode-tg-42", passwordHash: "abc123",
      version: 1, createdAt: "2025-01-01", updatedAt: "2025-01-01", status: "provisioning",
    };
    persistence.save(record);
    const result = persistence.updateIfCurrent("vm-1", 1, { status: "healthy" });
    expect(result).toBe(false);
  });

  it("listActive returns only non-destroyed records", () => {
    persistence.save({ vmId: "vm-1", userId: 1, environmentType: "libvirt", specTier: "small", assignedIpv4: "", assignedMac: "", domainName: "", passwordHash: "", version: 1, createdAt: "", updatedAt: "", status: "healthy" });
    persistence.save({ vmId: "vm-2", userId: 2, environmentType: "libvirt", specTier: "small", assignedIpv4: "", assignedMac: "", domainName: "", passwordHash: "", version: 1, createdAt: "", updatedAt: "", status: "destroyed" });
    persistence.save({ vmId: "vm-3", userId: 3, environmentType: "libvirt", specTier: "small", assignedIpv4: "", assignedMac: "", domainName: "", passwordHash: "", version: 1, createdAt: "", updatedAt: "", status: "provisioning" });

    const active = persistence.listActive();
    expect(active).toHaveLength(2);
    expect(active.map(r => r.vmId).sort()).toEqual(["vm-1", "vm-3"]);
  });

  it("markDestroyed updates status and increments version", () => {
    persistence.save({ vmId: "vm-1", userId: 1, environmentType: "libvirt", specTier: "small", assignedIpv4: "", assignedMac: "", domainName: "", passwordHash: "", version: 1, createdAt: "", updatedAt: "", status: "healthy" });
    const result = persistence.markDestroyed("vm-1");
    expect(result).toBe(true);
    const loaded = persistence.getByUserId(1);
    expect(loaded!.status).toBe("destroyed");
    expect(loaded!.version).toBe(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm/state-persistence.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
import type Database from "better-sqlite3";
import { randomUUID } from "crypto";

export type VmStateStatus = "provisioning" | "healthy" | "unhealthy" | "destroyed";

export interface VmStateRecord {
  vmId: string;
  userId: number;
  environmentType: string;
  specTier: string;
  assignedIpv4: string;
  assignedMac: string;
  domainName: string;
  passwordHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: VmStateStatus;
}

export interface VmStatePersistence {
  save(record: VmStateRecord): void;
  getByUserId(userId: number): VmStateRecord | undefined;
  getByVmId(vmId: string): VmStateRecord | undefined;
  listActive(): VmStateRecord[];
  markDestroyed(vmId: string): boolean;
  updateIfCurrent(vmId: string, expectedVersion: number, patch: Partial<VmStateRecord>): boolean;
}

function toRecord(row: VmStateDbRow): VmStateRecord {
  return {
    vmId: row.vm_id,
    userId: row.user_id,
    environmentType: row.environment_type,
    specTier: row.spec_tier,
    assignedIpv4: row.assigned_ipv4 ?? "",
    assignedMac: row.assigned_mac ?? "",
    domainName: row.domain_name ?? "",
    passwordHash: row.password_hash ?? "",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as VmStateStatus,
  };
}

interface VmStateDbRow {
  vm_id: string;
  user_id: number;
  environment_type: string;
  spec_tier: string;
  assigned_ipv4: string | null;
  assigned_mac: string | null;
  domain_name: string | null;
  password_hash: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  status: string;
}

export function createVmStatePersistence(db: Database.Database): VmStatePersistence {
  const getByUserIdStmt = db.prepare("SELECT * FROM vm_states WHERE user_id = ?");
  const getByVmIdStmt = db.prepare("SELECT * FROM vm_states WHERE vm_id = ?");
  const listActiveStmt = db.prepare("SELECT * FROM vm_states WHERE status != 'destroyed'");
  const upsertStmt = db.prepare(`
    INSERT INTO vm_states (vm_id, user_id, environment_type, spec_tier, assigned_ipv4, assigned_mac, domain_name, password_hash, version, created_at, updated_at, status)
    VALUES (@vmId, @userId, @environmentType, @specTier, @assignedIpv4, @assignedMac, @domainName, @passwordHash, @version, @createdAt, @updatedAt, @status)
    ON CONFLICT(vm_id) DO UPDATE SET
      user_id = @userId,
      environment_type = @environmentType,
      spec_tier = @specTier,
      assigned_ipv4 = @assignedIpv4,
      assigned_mac = @assignedMac,
      domain_name = @domainName,
      password_hash = @passwordHash,
      version = version + 1,
      updated_at = @updatedAt,
      status = @status
  `);
  const updateFieldsStmt = db.prepare(`
    UPDATE vm_states SET
      status = COALESCE(@status, status),
      version = version + 1,
      updated_at = @updatedAt,
      assigned_ipv4 = COALESCE(@assignedIpv4, assigned_ipv4),
      assigned_mac = COALESCE(@assignedMac, assigned_mac),
      password_hash = COALESCE(@passwordHash, password_hash)
    WHERE vm_id = @vmId AND version = @expectedVersion
  `);
  const markDestroyedStmt = db.prepare(`
    UPDATE vm_states SET status = 'destroyed', version = version + 1, updated_at = @updatedAt
    WHERE vm_id = @vmId
  `);

  return {
    save(record: VmStateRecord): void {
      upsertStmt.run({
        vmId: record.vmId,
        userId: record.userId,
        environmentType: record.environmentType,
        specTier: record.specTier,
        assignedIpv4: record.assignedIpv4,
        assignedMac: record.assignedMac,
        domainName: record.domainName,
        passwordHash: record.passwordHash,
        version: record.version,
        createdAt: record.createdAt,
        updatedAt: new Date().toISOString(),
        status: record.status,
      });
    },

    getByUserId(userId: number): VmStateRecord | undefined {
      const row = getByUserIdStmt.get(userId) as VmStateDbRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    getByVmId(vmId: string): VmStateRecord | undefined {
      const row = getByVmIdStmt.get(vmId) as VmStateDbRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    listActive(): VmStateRecord[] {
      return (listActiveStmt.all() as VmStateDbRow[]).map(toRecord);
    },

    markDestroyed(vmId: string): boolean {
      const result = markDestroyedStmt.run({ vmId, updatedAt: new Date().toISOString() });
      return result.changes > 0;
    },

    updateIfCurrent(vmId: string, expectedVersion: number, patch: Partial<VmStateRecord>): boolean {
      const result = updateFieldsStmt.run({
        vmId,
        expectedVersion,
        updatedAt: new Date().toISOString(),
        status: patch.status ?? null,
        assignedIpv4: patch.assignedIpv4 ?? null,
        assignedMac: patch.assignedMac ?? null,
        passwordHash: patch.passwordHash ?? null,
      });
      return result.changes > 0;
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/vm/state-persistence.test.ts --reporter=verbose`
Expected: PASS (6 tests)

---

### Task 2: HealthProxy

**Files:**
- Create: `src/vm/health-proxy.ts`
- Create: `tests/vm/health-proxy.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, vi, beforeEach } from "vitest";
import type { VmHandle } from "../../src/vm/types.js";
import { createLibvirtHealthProxy } from "../../src/vm/health-proxy.js";

describe("createLibvirtHealthProxy", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("returns unhealthy when fetch fails", async () => {
    vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("network error"));
    const proxy = createLibvirtHealthProxy();
    const result = await proxy.check({
      vmId: "vm-1", userId: 42, ipv4: "10.100.0.50", baseUrl: "http://10.100.0.50:4096",
      domainName: "", password: "", mac: "", specTier: "small",
    });
    expect(result.healthy).toBe(false);
    expect(result.services.opencode).toBe(false);
  });

  it("returns healthy when fetch returns 200", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 200 }));
    const proxy = createLibvirtHealthProxy();
    const result = await proxy.check({
      vmId: "vm-1", userId: 42, ipv4: "10.100.0.50", baseUrl: "http://10.100.0.50:4096",
      domainName: "", password: "testpw", mac: "", specTier: "small",
    });
    expect(result.healthy).toBe(true);
  });

  it("uses Basic auth with derived password", async () => {
    let usedAuth = "";
    vi.spyOn(globalThis, "fetch").mockImplementation(async (url, opts) => {
      if (typeof url === "string" && url.includes("/api/health")) {
        usedAuth = (opts?.headers as Record<string, string>)?.Authorization ?? "";
      }
      return new Response(null, { status: 200 });
    });
    const proxy = createLibvirtHealthProxy({ password: "secret" });
    await proxy.check({
      vmId: "vm-1", userId: 42, ipv4: "10.100.0.50", baseUrl: "http://10.100.0.50:4096",
      domainName: "", password: "secret", mac: "", specTier: "small",
    });
    expect(usedAuth).toContain("Basic");
    expect(atob(usedAuth.split(" ")[1])).toBe("opencode:secret");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/vm/health-proxy.test.ts --reporter=verbose`
Expected: FAIL — module not found

- [ ] **Step 3: Write implementation**

```typescript
import { logger } from "../utils/logger.js";
import type { VmHandle } from "./types.js";

export interface HealthStatus {
  healthy: boolean;
  services: {
    opencode: boolean;
    network: boolean;
  };
  error?: string;
}

export interface HealthProxy {
  check(handle: VmHandle, options?: { timeoutMs?: number; pollMs?: number }): Promise<HealthStatus>;
}

export interface HealthProxyOptions {
  password?: string;
  pollMs?: number;
  timeoutMs?: number;
}

export function createLibvirtHealthProxy(options?: HealthProxyOptions): HealthProxy {
  const pollMs = options?.pollMs ?? 2000;
  const timeoutMs = options?.timeoutMs ?? 900_000;

  async function check(handle: VmHandle, opts?: { timeoutMs?: number; pollMs?: number }): Promise<HealthStatus> {
    const pw = options?.password ?? handle.password;
    const timeout = opts?.timeoutMs ?? timeoutMs;
    const poll = opts?.pollMs ?? pollMs;
    const healthUrl = `${handle.baseUrl}/api/health`;
    const auth = `Basic ${Buffer.from(`opencode:${pw}`).toString("base64")}`;
    const deadline = Date.now() + timeout;

    while (Date.now() < deadline) {
      try {
        const res = await fetch(healthUrl, {
          headers: { Authorization: auth },
          signal: AbortSignal.timeout(5000),
        });
        if (res.ok) {
          return { healthy: true, services: { opencode: true, network: true } };
        }
      } catch (err) {
        logger.debug(`[HealthProxy] Check failed for ${handle.vmId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      await new Promise(r => setTimeout(r, poll));
    }

    return {
      healthy: false,
      services: { opencode: false, network: false },
      error: `Health check timed out after ${timeout}ms`,
    };
  }

  return { check };
}
```

- [ ] **Step 4: Add VmHandle to types.ts**

Add to `src/vm/types.ts`:
```typescript
export interface VmHandle {
  vmId: string;
  userId: number;
  domainName: string;
  ipv4: string;
  mac: string;
  baseUrl: string;
  password: string;
  specTier: string;
}

export interface VmEnvironment {
  provision(userId: number, spec: VmSpec): Promise<VmHandle>;
  attach(userId: number): Promise<VmHandle | null>;
  healthCheck(handle: VmHandle): Promise<HealthStatus>;
  destroy(handle: VmHandle): Promise<VmOperationResult>;
}
```

And import:
```typescript
import type { HealthStatus } from "./health-proxy.js";
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run tests/vm/health-proxy.test.ts --reporter=verbose`
Expected: PASS (3 tests)

---

### Task 3: Refactor VmManager → LibvirtEnvironment

**Files:**
- Modify: `src/vm/manager.ts` — extract interface, keep VmManager as concrete
- Modify: `src/vm/types.ts` — add VmEnvironment
- No new tests (VmManager tests already exist, just verify compilation)

- [ ] **Step 1: Update types.ts with VmHandle and VmEnvironment**

Add to `src/vm/types.ts`:

```typescript
import type { HealthStatus } from "./health-proxy.js";

export interface VmHandle {
  vmId: string;
  userId: number;
  domainName: string;
  ipv4: string;
  mac: string;
  baseUrl: string;
  password: string;
  specTier: string;
}

export interface VmEnvironment {
  provision(userId: number, spec: VmSpec): Promise<VmHandle>;
  attach(userId: number): Promise<VmHandle | null>;
  healthCheck(handle: VmHandle): Promise<HealthStatus>;
  destroy(handle: VmHandle): Promise<VmOperationResult>;
}
```

- [ ] **Step 2: Add toVmHandle and provision methods to VmManager**

In `src/vm/manager.ts`, add:

```typescript
import { randomUUID } from "crypto";
import { createVmStatePersistence } from "./state-persistence.js";
import { createLibvirtHealthProxy } from "./health-proxy.js";

// After existing VmManager class methods, add:
  async provision(userId: number, spec: VmSpec, persistence: VmStatePersistence): Promise<VmHandle> {
    const info = await this.createAndStart(userId, spec);
    const record: VmStateRecord = {
      vmId: randomUUID(),
      userId,
      environmentType: "libvirt",
      specTier: spec.tier,
      assignedIpv4: info.bridgeIp ?? "",
      assignedMac: generateMacForUser(userId),
      domainName: info.domainName,
      passwordHash: info.sudoPassword ?? "",
      version: 1,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      status: "provisioning",
    };
    persistence.save(record);
    return this.toVmHandle(record, info);
  }

  async attach(userId: number, persistence: VmStatePersistence): Promise<VmHandle | null> {
    const record = persistence.getByUserId(userId);
    if (!record) return null;
    // VM is already defined in libvirt, just verify it's running
    const running = await this.isRunning(userId);
    if (!running) return null;
    // Try to get current IP from state
    return {
      vmId: record.vmId,
      userId: record.userId,
      domainName: record.domainName,
      ipv4: record.assignedIpv4,
      mac: record.assignedMac,
      baseUrl: `http://${record.assignedIpv4}:${VM_DEFAULTS.opencodePort}`,
      password: record.passwordHash,
      specTier: record.specTier,
    };
  }

  private toVmHandle(record: VmStateRecord, info: VmInfo): VmHandle {
    return {
      vmId: record.vmId,
      userId: record.userId,
      domainName: info.domainName,
      ipv4: info.bridgeIp ?? "",
      mac: generateMacForUser(info.userId),
      baseUrl: info.baseUrl,
      password: info.sudoPassword ?? "",
      specTier: info.tier,
    };
  }
```

Then at the bottom add the health check wrapper:

```typescript
  async healthCheck(handle: VmHandle): Promise<HealthStatus> {
    const proxy = createLibvirtHealthProxy({ password: handle.password });
    return proxy.check(handle);
  }
```

And update `destroy` to also call persistence:

```typescript
  async destroyWithPersistence(handle: VmHandle, persistence: VmStatePersistence): Promise<VmOperationResult> {
    const result = await this.destroy(handle.userId);
    if (result.success) {
      persistence.markDestroyed(handle.vmId);
    }
    return result;
  }
```

- [ ] **Step 3: Run build to verify compilation**

Run: `npx tsc --noEmit`
Expected: No type errors

---

### Task 4: Add DB migration for vm_states table

**Files:**
- Modify: `src/settings/manager.ts` — add migration for vm_states table
- Or create: `scripts/migrate-vm-states.ts`

- [ ] **Step 1: Write tests verifying migration runs**

Look at existing schema_version mechanism in settings manager.

- [ ] **Step 2: Add migration**

The vm_states table DDL:
```sql
CREATE TABLE IF NOT EXISTS vm_states (
  vm_id           TEXT PRIMARY KEY,
  user_id         INTEGER NOT NULL,
  environment_type TEXT NOT NULL DEFAULT 'libvirt',
  spec_tier       TEXT NOT NULL DEFAULT 'small',
  assigned_ipv4   TEXT,
  assigned_mac    TEXT,
  domain_name     TEXT,
  password_hash   TEXT,
  version         INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL,
  updated_at      TEXT NOT NULL,
  status          TEXT NOT NULL DEFAULT 'provisioning',
  UNIQUE(user_id)
);
```
