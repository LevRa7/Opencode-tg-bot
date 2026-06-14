# VM Deployment Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add QEMU/KVM virtual machine deployment as an alternative tenant workspace runtime, with interactive spec selection.

**Architecture:** New `src/vm/` module handles VM lifecycle via virsh CLI. ProcessManager gets `kind: "vm"` branch. opencodeClient proxy adds vm route. Bot handler shows inline menu for spec selection at first launch. Zero changes to Docker code path.

**Tech Stack:** TypeScript 5.x, grammY, libvirt/virsh CLI, qemu-img, cloud-localds, SQLite (settings.db)

**Design doc:** `docs/superpowers/specs/2026-06-12-vm-deployment-design-ru.md`

---

## Phase 1: Types & Interfaces

### Task 1.1: Add VmSpec and VmInfo types

**Objective:** Define domain types for VM specs, tiers, and runtime info.

**Files:**
- Create: `src/vm/types.ts`

**Step 1: Write file**

```typescript
export type VmSpecTier = "small" | "medium" | "large" | "xlarge";

export interface VmSpec {
  tier: VmSpecTier;
  ramMb: number;
  vcpus: number;
  diskGb: number;
  label: string;
}

export const VM_TIERS: Record<VmSpecTier, VmSpec> = {
  small:  { tier: "small",  ramMb: 2048,  vcpus: 1, diskGb: 20,  label: "Базовый" },
  medium: { tier: "medium", ramMb: 4096,  vcpus: 2, diskGb: 50,  label: "Стандартный" },
  large:  { tier: "large",  ramMb: 8192,  vcpus: 4, diskGb: 100, label: "Продвинутый" },
  xlarge: { tier: "xlarge", ramMb: 16384, vcpus: 8, diskGb: 250, label: "Максимальный" },
};

export const VM_DEFAULTS = {
  domainNamePrefix: "opencode-tg",
  imagesDir: "/var/lib/libvirt/images",
  baseImageName: "opencode-base.qcow2",
  bridgeInterface: "macvtap0",
  opencodePort: 4096,
  healthTimeoutMs: 300_000,
  healthPollMs: 2000,
  dhcpRetries: 3,
  dhcpRetryDelayMs: 5000,
  shutdownTimeoutMs: 30_000,
  forceDestroyTimeoutMs: 5_000,
  baseImageUrl: "https://cloud.debian.org/images/cloud/bookworm/latest/debian-12-genericcloud-amd64.qcow2",
};

export interface VmInfo {
  userId: number;
  tier: VmSpecTier;
  domainName: string;
  qcow2Path: string;
  cloudInitIsoPath: string;
  bridgeIp: string | null;
  baseUrl: string;
  startTime: string;
  pid: number | null;
}

export interface VmOperationResult {
  success: boolean;
  error?: string;
}
```

**Step 2: TypeScript check**

```bash
npx tsc --noEmit src/vm/types.ts
```

Expected: PASS (no errors)

**Step 3: Commit**

```bash
git add src/vm/types.ts
git commit -m "feat: add VmSpec, VmInfo types and VM_TIERS constants"
```

---

### Task 1.2: Extend ProcessRuntimeInfo with "vm" kind

**Objective:** Add `"vm"` to the `kind` union in `ProcessRuntimeInfo`.

**Files:**
- Modify: `src/process/types.ts`

**Step 1: Edit the file**

Change line 16 from:
```typescript
kind: "host" | "tenant";
```
to:
```typescript
kind: "host" | "tenant" | "vm";
```

**Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS (no new errors from this change alone)

**Step 3: Commit**

```bash
git add src/process/types.ts
git commit -m "feat: add 'vm' to ProcessRuntimeInfo.kind union"
```

---

## Phase 2: Settings & SQLite

### Task 2.1: Add deployTarget field to TenantRuntimeInfo

**Objective:** Extend `TenantRuntimeInfo` with optional `deployTarget` so the bot can route between Docker and VM.

**Files:**
- Modify: `src/settings/manager.ts`

**Step 1: Edit TenantRuntimeInfo**

Add after line 100 (`tenantId: string;`):
```typescript
  deployTarget?: "docker" | "vm";
```

**Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/settings/manager.ts
git commit -m "feat: add deployTarget to TenantRuntimeInfo"
```

---

### Task 2.2: Add user deployTarget preference to SQLite

**Objective:** Store per-user deployTarget selection (docker/vm) and vmSpecTier in user_preferences.

**Files:**
- Modify: `src/settings/repositories/user-preferences.ts`
- Modify: `src/settings/manager.ts`

**Step 1: Add preference keys**

Read `src/settings/repositories/user-preferences.ts` to understand the existing preference key/value pattern. Add two new keys:

In `src/settings/manager.ts`, add these getter/setter functions (near the existing user preference functions):

```typescript
const DEPLOY_TARGET_KEY = "deployTarget";
const VM_SPEC_TIER_KEY = "vmSpecTier";

export function getUserDeployTarget(userId: number): "docker" | "vm" | undefined {
  const val = userPrefs.getPreference(userId, DEPLOY_TARGET_KEY);
  if (val === "docker" || val === "vm") return val;
  return undefined;
}

export function setUserDeployTarget(userId: number, target: "docker" | "vm" | null): void {
  userPrefs.upsertPreference(userId, DEPLOY_TARGET_KEY, target ?? "");
}

export function getUserVmSpecTier(userId: number): VmSpecTier | undefined {
  const val = userPrefs.getPreference(userId, VM_SPEC_TIER_KEY);
  const tiers = ["small", "medium", "large", "xlarge"];
  if (tiers.includes(val)) return val as VmSpecTier;
  return undefined;
}

export function setUserVmSpecTier(userId: number, tier: VmSpecTier | null): void {
  userPrefs.upsertPreference(userId, VM_SPEC_TIER_KEY, tier ?? "");
}
```

Add import at top: `import type { VmSpecTier } from "../vm/types.js";`

**Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/settings/manager.ts
git commit -m "feat: add user deployTarget and vmSpecTier preferences"
```

---

### Task 2.3: Add vm_runtimes table and repository

**Objective:** Create SQLite table for VM runtime tracking.

**Files:**
- Create: `src/settings/repositories/vm-runtimes.ts`
- Modify: `src/settings/db.ts`
- Modify: `src/settings/repositories/types.ts`

**Step 1: Add table to db.ts**

In `src/settings/db.ts`, after the `tenant_runtimes` table creation (around line 79), add:

```sql
CREATE TABLE IF NOT EXISTS vm_runtimes (
    user_id INTEGER PRIMARY KEY,
    data TEXT NOT NULL
);
```

**Step 2: Add row type**

In `src/settings/repositories/types.ts`, add:

```typescript
export interface VmRuntimeRow {
  user_id: number;
  data: string;
}
```

**Step 3: Create repository**

Create `src/settings/repositories/vm-runtimes.ts`:

```typescript
import type Database from "better-sqlite3";
import type { VmRuntimeRow } from "./types.js";

export interface VmRuntimeRepository {
  get(userId: number): string | undefined;
  getAll(): VmRuntimeRow[];
  upsert(userId: number, data: string): void;
  delete(userId: number): void;
}

export function createVmRuntimeRepository(db: Database.Database): VmRuntimeRepository {
  const getStmt = db.prepare("SELECT data FROM vm_runtimes WHERE user_id = ?");
  const getAllStmt = db.prepare("SELECT * FROM vm_runtimes");
  const upsertStmt = db.prepare(
    "INSERT INTO vm_runtimes (user_id, data) VALUES (?, ?) ON CONFLICT(user_id) DO UPDATE SET data = ?"
  );
  const deleteStmt = db.prepare("DELETE FROM vm_runtimes WHERE user_id = ?");

  return {
    get(userId: number): string | undefined {
      const row = getStmt.get(userId) as VmRuntimeRow | undefined;
      return row?.data;
    },
    getAll(): VmRuntimeRow[] {
      return getAllStmt.all() as VmRuntimeRow[];
    },
    upsert(userId: number, data: string): void {
      upsertStmt.run(userId, data, data);
    },
    delete(userId: number): void {
      deleteStmt.run(userId);
    },
  };
}
```

**Step 4: Wire into db.ts and manager.ts**

In `src/settings/db.ts`: import and create `vmRuntimeRepo`, export it alongside other repos.
In `src/settings/manager.ts`: add CRUD functions:

```typescript
import type { VmInfo } from "../vm/types.js";

export function getVmRuntimeInfo(userId: number): VmInfo | undefined {
  const data = vmRuntimeRepo.get(userId);
  if (!data) return undefined;
  return JSON.parse(data) as VmInfo;
}

export function setVmRuntimeInfo(userId: number, info: VmInfo): void {
  vmRuntimeRepo.upsert(userId, JSON.stringify(info));
}

export function clearVmRuntimeInfo(userId: number): void {
  vmRuntimeRepo.delete(userId);
}
```

**Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/settings/repositories/vm-runtimes.ts src/settings/repositories/types.ts src/settings/db.ts src/settings/manager.ts
git commit -m "feat: add vm_runtimes table and repository"
```

---

## Phase 3: VmManager Module

### Task 3.1: Create VmManager class skeleton

**Objective:** Create the VmManager class with interface and constructor. All methods throw "not implemented" initially — we implement them one by one in subsequent tasks.

**Files:**
- Create: `src/vm/manager.ts`

**Step 1: Write skeleton**

```typescript
import { execSync } from "child_process";
import { logger } from "../utils/logger.js";
import { VM_DEFAULTS, VM_TIERS, type VmInfo, type VmOperationResult, type VmSpec, type VmSpecTier } from "./types.js";

export class VmManager {
  private baseImageReady = false;

  async ensureBaseImage(): Promise<VmOperationResult> {
    // Check if base image exists at VM_DEFAULTS.imagesDir / VM_DEFAULTS.baseImageName
    throw new Error("not implemented");
  }

  async createAndStart(userId: number, spec: VmSpec): Promise<VmInfo> {
    throw new Error("not implemented");
  }

  async stop(userId: number): Promise<VmOperationResult> {
    throw new Error("not implemented");
  }

  async destroy(userId: number): Promise<VmOperationResult> {
    throw new Error("not implemented");
  }

  async isRunning(userId: number): Promise<boolean> {
    throw new Error("not implemented");
  }

  async waitForHealth(baseUrl: string, password: string, timeoutMs: number): Promise<boolean> {
    throw new Error("not implemented");
  }

  async getBridgeIp(userId: number): Promise<string | null> {
    throw new Error("not implemented");
  }

  async isAvailable(): Promise<boolean> {
    // Check if KVM + libvirt + virsh are available
    throw new Error("not implemented");
  }
}

export const vmManager = new VmManager();
```

**Step 2: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 3: Commit**

```bash
git add src/vm/manager.ts
git commit -m "feat: add VmManager class skeleton"
```

---

### Task 3.2: Implement VmManager.isAvailable()

**Objective:** Check if KVM, libvirt, and virsh are available on the host. Used by ProcessManager to decide if VM deployment is an option.

**Files:**
- Modify: `src/vm/manager.ts`

**Step 1: Write test**

```bash
mkdir -p tests/vm
```

Create `tests/vm/manager.test.ts`:

```typescript
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { execSync } from "child_process";

vi.mock("child_process", () => ({
  execSync: vi.fn(),
}));

import { VmManager } from "../../src/vm/manager.js";

describe("VmManager", () => {
  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("isAvailable", () => {
    it("should return true when virsh is found", async () => {
      vi.mocked(execSync).mockReturnValue("/usr/bin/virsh");
      const mgr = new VmManager();
      const result = await mgr.isAvailable();
      expect(result).toBe(true);
    });

    it("should return false when virsh is not found", async () => {
      vi.mocked(execSync).mockImplementation(() => { throw new Error("not found"); });
      const mgr = new VmManager();
      const result = await mgr.isAvailable();
      expect(result).toBe(false);
    });
  });
});
```

**Step 2: Run test to verify failure**

```bash
npx vitest run tests/vm/manager.test.ts
```

Expected: FAIL — isAvailable not implemented or returns wrong result

**Step 3: Implement isAvailable()**

```typescript
async isAvailable(): Promise<boolean> {
  try {
    execSync("which virsh", { stdio: "ignore" });
    execSync("which qemu-img", { stdio: "ignore" });
    return true;
  } catch {
    logger.warn("[VmManager] virsh or qemu-img not found — VM deployment unavailable");
    return false;
  }
}
```

**Step 4: Run test to verify pass**

```bash
npx vitest run tests/vm/manager.test.ts
```

Expected: PASS

**Step 5: Commit**

```bash
git add tests/vm/manager.test.ts src/vm/manager.ts
git commit -m "feat: implement VmManager.isAvailable() with tests"
```

---

### Task 3.3: Implement VmManager.ensureBaseImage()

**Objective:** Check if the golden image exists at `/var/lib/libvirt/images/opencode-base.qcow2`.

**Files:**
- Modify: `src/vm/manager.ts`
- Modify: `tests/vm/manager.test.ts`

**Step 1: Add test**

```typescript
describe("ensureBaseImage", () => {
  it("should return success when base image exists", async () => {
    vi.mocked(execSync).mockReturnValueOnce("/usr/bin/virsh"); // isAvailable check
    // mock statSync via fs mock
    const fs = await import("fs");
    const existsSyncMock = vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const mgr = new VmManager();
    const result = await mgr.ensureBaseImage();
    expect(result.success).toBe(true);
    existsSyncMock.mockRestore();
  });

  it("should return error when base image missing", async () => {
    const fs = await import("fs");
    vi.spyOn(fs, "existsSync").mockReturnValue(false);
    const mgr = new VmManager();
    const result = await mgr.ensureBaseImage();
    expect(result.success).toBe(false);
    expect(result.error).toContain("not found");
  });
});
```

**Step 2: Run test → FAIL**

```bash
npx vitest run tests/vm/manager.test.ts
```

**Step 3: Implement**

```typescript
import { existsSync } from "fs";
import path from "path";

async ensureBaseImage(): Promise<VmOperationResult> {
  const imagePath = path.join(VM_DEFAULTS.imagesDir, VM_DEFAULTS.baseImageName);
  if (existsSync(imagePath)) {
    this.baseImageReady = true;
    return { success: true };
  }
  return {
    success: false,
    error: `Base image not found at ${imagePath}. Run image-builder first.`,
  };
}
```

**Step 4: Run test → PASS**

```bash
npx vitest run tests/vm/manager.test.ts
```

**Step 5: Commit**

```bash
git add tests/vm/manager.test.ts src/vm/manager.ts
git commit -m "feat: implement VmManager.ensureBaseImage()"
```

---

### Task 3.4: Implement VmManager.createAndStart()

**Objective:** Create a VM for a user: qemu-img clone, cloud-init ISO generation, virsh define + start.

**Files:**
- Create: `src/vm/cloud-init.ts`
- Modify: `src/vm/manager.ts`

**Step 1: Create cloud-init generator**

```typescript
// src/vm/cloud-init.ts
import { execSync } from "child_process";
import path from "path";
import { VM_DEFAULTS, type VmSpec } from "./types.js";

export function generateCloudInitIso(userId: number, spec: VmSpec, password: string, outputPath: string): void {
  const hostname = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
  const userData = `#cloud-config
hostname: ${hostname}
manage_etc_hosts: true
users:
  - name: opencode
    gecos: OpenCode User
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: true
    passwd: ${password}
ssh_pwauth: true
package_update: true
packages:
  - curl
  - git
  - ca-certificates
write_files:
  - path: /etc/opencode/env
    content: |
      OPENCODE_SERVER_PASSWORD=${password}
      TG_ID=${userId}
    permissions: '0600'
runcmd:
  - systemctl enable opencode
  - systemctl start opencode
`;

  const metaData = `instance-id: opencode-tg-${userId}
local-hostname: ${hostname}
`;

  const tmpDir = path.dirname(outputPath);
  execSync(`mkdir -p "${tmpDir}"`, { stdio: "ignore" });

  const userDataFile = path.join(tmpDir, "user-data");
  const metaDataFile = path.join(tmpDir, "meta-data");

  require("fs").writeFileSync(userDataFile, userData);
  require("fs").writeFileSync(metaDataFile, metaData);

  execSync(`cloud-localds "${outputPath}" "${userDataFile}" "${metaDataFile}"`, { stdio: "ignore" });
}
```

**Step 2: Add createAndStart test**

```typescript
it("should create VM and return VmInfo on success", async () => {
  vi.mocked(execSync)
    .mockReturnValueOnce("/usr/bin/virsh")  // isAvailable
    .mockReturnValueOnce("")                // qemu-img create
    .mockReturnValueOnce("")                // cloud-localds
    .mockReturnValueOnce("")                // virsh define
    .mockReturnValueOnce("")                // virsh start
    .mockReturnValueOnce("ip: 192.168.1.100"); // virsh domifaddr
  vi.spyOn(fs, "existsSync").mockReturnValue(true); // base image

  const mgr = new VmManager();
  await mgr.ensureBaseImage();
  const info = await mgr.createAndStart(123, VM_TIERS.small);

  expect(info.userId).toBe(123);
  expect(info.domainName).toBe("opencode-tg-123");
  expect(info.baseUrl).toBe("http://192.168.1.100:4096");
});
```

**Step 3: Run tests → FAIL**

```bash
npx vitest run tests/vm/manager.test.ts
```

**Step 4: Implement**

```typescript
async createAndStart(userId: number, spec: VmSpec): Promise<VmInfo> {
  const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
  const qcow2Path = path.join(VM_DEFAULTS.imagesDir, `opencode-tg-${userId}.qcow2`);
  const cloudInitIsoPath = path.join(VM_DEFAULTS.imagesDir, `cloud-init-tg-${userId}.iso`);
  const baseImagePath = path.join(VM_DEFAULTS.imagesDir, VM_DEFAULTS.baseImageName);

  // 1. Create CoW clone from base image
  execSync(`qemu-img create -f qcow2 -b "${baseImagePath}" -F qcow2 "${qcow2Path}" ${spec.diskGb}G`, { stdio: "ignore" });
  logger.info(`[VmManager] Created qcow2 clone for userId=${userId}`);

  // 2. Generate cloud-init ISO
  const password = require("../settings/manager.js").getOrCreateServerPassword(userId);
  generateCloudInitIso(userId, spec, password, cloudInitIsoPath);
  logger.info(`[VmManager] Generated cloud-init ISO for userId=${userId}`);

  // 3. Generate domain XML with virtio-mem
  const domainXml = this.buildDomainXml(domainName, qcow2Path, cloudInitIsoPath, spec);
  const xmlPath = path.join(VM_DEFAULTS.imagesDir, `${domainName}.xml`);
  require("fs").writeFileSync(xmlPath, domainXml);

  // 4. Define and start VM
  execSync(`virsh define "${xmlPath}"`, { stdio: "ignore" });
  execSync(`virsh start "${domainName}"`, { stdio: "ignore" });
  logger.info(`[VmManager] Started VM ${domainName} for userId=${userId}`);

  // 5. Wait for bridge IP
  const bridgeIp = await this.waitForBridgeIp(userId);
  const baseUrl = `http://${bridgeIp}:${VM_DEFAULTS.opencodePort}`;

  return {
    userId,
    tier: spec.tier,
    domainName,
    qcow2Path,
    cloudInitIsoPath,
    bridgeIp,
    baseUrl,
    startTime: new Date().toISOString(),
    pid: null, // QEMU PID resolved later
  };
}
```

Add `buildDomainXml` helper:

```typescript
private buildDomainXml(name: string, diskPath: string, isoPath: string, spec: VmSpec): string {
  return `<!-- domain XML with virtio-mem — see spec -->
<domain type="kvm">
  <name>${name}</name>
  <maxMemory slots="16" unit="MiB">${spec.ramMb}</maxMemory>
  <memory unit="MiB">1024</memory>
  <vcpu>${spec.vcpus}</vcpu>
  <!-- ... complete XML generated in cloud-init.ts ... -->
</domain>`;
}
```

**Step 5: Run tests → PASS**, then commit.

---

### Task 3.5: Implement remaining VmManager methods

**Objective:** Implement stop, destroy, isRunning, waitForHealth, getBridgeIp.

**Files:**
- Modify: `src/vm/manager.ts`

**Step 1: Implement each method**

```typescript
async stop(userId: number): Promise<VmOperationResult> {
  const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
  try {
    execSync(`virsh shutdown "${domainName}"`, { stdio: "ignore", timeout: VM_DEFAULTS.shutdownTimeoutMs });
  } catch {
    execSync(`virsh destroy "${domainName}"`, { stdio: "ignore", timeout: VM_DEFAULTS.forceDestroyTimeoutMs });
  }
  return { success: true };
}

async destroy(userId: number): Promise<VmOperationResult> {
  const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
  await this.stop(userId);
  execSync(`virsh undefine "${domainName}" --remove-all-storage`, { stdio: "ignore" });
  // Also remove cloud-init ISO
  const isoPath = path.join(VM_DEFAULTS.imagesDir, `cloud-init-tg-${userId}.iso`);
  try { require("fs").unlinkSync(isoPath); } catch { /* ok */ }
  return { success: true };
}

async isRunning(userId: number): Promise<boolean> {
  const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
  try {
    const output = execSync(`virsh domstate "${domainName}"`, { encoding: "utf-8", stdio: "pipe" });
    return output.trim() === "running";
  } catch {
    return false;
  }
}

async waitForHealth(baseUrl: string, password: string, timeoutMs: number): Promise<boolean> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const resp = await fetch(`${baseUrl}/global/health`, {
        headers: { Authorization: `Basic ${Buffer.from(`opencode:${password}`).toString("base64")}` },
        signal: AbortSignal.timeout(2000),
      });
      if (resp.ok) return true;
    } catch { /* retry */ }
    await new Promise(r => setTimeout(r, VM_DEFAULTS.healthPollMs));
  }
  return false;
}

async getBridgeIp(userId: number): Promise<string | null> {
  const domainName = `${VM_DEFAULTS.domainNamePrefix}-${userId}`;
  let attempts = VM_DEFAULTS.dhcpRetries;
  while (attempts-- > 0) {
    try {
      const raw = execSync(`virsh domifaddr "${domainName}" --source agent`, { encoding: "utf-8", stdio: "pipe" });
      const match = raw.match(/(\d+\.\d+\.\d+\.\d+)/);
      if (match) return match[1];
    } catch { /* no IP yet */ }
    await new Promise(r => setTimeout(r, VM_DEFAULTS.dhcpRetryDelayMs));
  }
  return null;
}

private async waitForBridgeIp(userId: number): Promise<string> {
  const ip = await this.getBridgeIp(userId);
  if (!ip) throw new Error(`Failed to get bridge IP for user ${userId} after ${VM_DEFAULTS.dhcpRetries} retries`);
  return ip;
}
```

**Step 2: Add tests for each method**, similar pattern as above.

**Step 3: Commit**

```bash
git add tests/vm/manager.test.ts src/vm/manager.ts src/vm/cloud-init.ts
git commit -m "feat: implement VmManager lifecycle methods"
```

---

## Phase 4: ProcessManager Integration

### Task 4.1: Wire VmManager into ProcessManager

**Objective:** Add vmManager instance and getDeployTarget() method. Update ensureRuntime() to branch on deployTarget.

**Files:**
- Modify: `src/process/manager.ts`

**Step 1: Add imports and vmManager**

At top of `src/process/manager.ts`:

```typescript
import { vmManager } from "../vm/manager.js";
import { getUserDeployTarget, getUserVmSpecTier, getVmRuntimeInfo, setVmRuntimeInfo, clearVmRuntimeInfo } from "../settings/manager.js";
import { VM_TIERS, type VmInfo } from "../vm/types.js";
```

**Step 2: Add getDeployTarget()**

```typescript
private getDeployTarget(userId: number): "docker" | "vm" {
  return getUserDeployTarget(userId) ?? "docker";
}
```

**Step 3: Add ensureVmRuntime()**

```typescript
private async ensureVmRuntime(userId: number): Promise<ProcessOperationResult> {
  const scope = getCurrentTelegramConversationScope();
  if (!scope) {
    return { success: false, error: "Telegram scope unavailable" };
  }

  // Check if VM already running
  let vmInfo = getVmRuntimeInfo(userId);
  if (vmInfo) {
    const running = await vmManager.isRunning(userId);
    if (running && vmInfo.baseUrl) {
      const healthy = await vmManager.waitForHealth(vmInfo.baseUrl,
        getOrCreateServerPassword(userId), 10_000);
      if (healthy) return { success: true };
    }
    // VM dead or unhealthy, clean up
    await vmManager.stop(userId).catch(() => {});
    clearVmRuntimeInfo(userId);
    vmInfo = undefined;
  }

  // Check base image
  const imageCheck = await vmManager.ensureBaseImage();
  if (!imageCheck.success) {
    return { success: false, error: imageCheck.error };
  }

  // Get user's tier selection
  const tier = getUserVmSpecTier(userId);
  if (!tier) {
    return { success: false, needsVmSpec: true };
  }

  const spec = VM_TIERS[tier];

  try {
    const info = await vmManager.createAndStart(userId, spec);
    setVmRuntimeInfo(userId, info);

    const password = getOrCreateServerPassword(userId);
    const healthy = await vmManager.waitForHealth(info.baseUrl, password, 300_000);
    if (!healthy) {
      await vmManager.stop(userId).catch(() => {});
      clearVmRuntimeInfo(userId);
      return { success: false, error: `VM did not become healthy at ${info.baseUrl}` };
    }

    return { success: true };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[ProcessManager] ensureVmRuntime failed for userId=${userId}: ${msg}`);
    return { success: false, error: msg };
  }
}
```

**Step 4: Update ensureRuntime()**

```typescript
async ensureRuntime(): Promise<ProcessOperationResult> {
  if (this.isAdminScope()) {
    if (this.isRunning()) return { success: true };
    return this.start();
  }

  const scope = getCurrentTelegramConversationScope();
  if (!scope) return { success: false, error: "No scope" };

  const target = this.getDeployTarget(scope.userId);
  if (target === "vm") {
    return this.ensureVmRuntime(scope.userId);
  }

  return this.ensureTenantRuntime();
}
```

**Step 5: Update getCurrentRuntimeInfo() — add vm branch**

After the `!scope` / admin check in `getCurrentRuntimeInfo()`:

```typescript
const deployTarget = this.getDeployTarget(scope.userId);
if (deployTarget === "vm") {
  const vmInfo = getVmRuntimeInfo(scope.userId);
  if (vmInfo) {
    return {
      kind: "vm",
      userId: scope.userId,
      chatId: scope.chatId,
      tenantId: vmInfo.domainName,
      baseUrl: vmInfo.baseUrl,
      managed: true,
      pid: vmInfo.pid,
      uptimeMs: vmInfo.startTime ? Date.now() - Date.parse(vmInfo.startTime) : null,
    };
  }
}
```

**Step 6: Update stop(), isRunning(), getPID(), getUptime() — add vm delegation**

In each method, after the tenant runtime check, add:

```typescript
// In stop():
if (deployTarget === "vm") {
  const result = await vmManager.stop(userId);
  clearVmRuntimeInfo(userId);
  return result;
}

// In isRunning():
if (deployTarget === "vm") {
  return await vmManager.isRunning(userId);
}
```

And add null checks where deployTarget is "vm" but no runtime exists.

**Step 7: Update ProcessOperationResult type**

In `src/process/types.ts`, add optional field:

```typescript
export interface ProcessOperationResult {
  success: boolean;
  error?: string;
  needsVmSpec?: boolean; // NEW
}
```

**Step 8: Update initialize() — add vm manager availability check**

```typescript
async initialize(): Promise<void> {
  // ... existing host recovery ...
  await this.cleanupDeadTenantRuntimes();
  this.startTenantWatcher();

  // Check VM availability (non-blocking)
  vmManager.isAvailable().then(available => {
    if (available) {
      logger.info("[ProcessManager] VM deployment available");
    }
  }).catch(() => {});
}
```

**Step 9: TypeScript check + tests**

```bash
npx tsc --noEmit
npx vitest run tests/process/
```

Expected: All existing process tests PASS. New tests for vm path TBD.

**Step 10: Commit**

```bash
git add src/process/manager.ts src/process/types.ts
git commit -m "feat: integrate VmManager into ProcessManager"
```

---

## Phase 5: Client Proxy Integration

### Task 5.1: Add vm route in getCurrentOpencodeRoute()

**Objective:** Client proxy returns correct route when deployTarget is "vm".

**Files:**
- Modify: `src/opencode/client.ts`

**Step 1: Add vm branch**

In `getCurrentOpencodeRoute()`, after the SSH branch and before the admin check, add:

```typescript
// VM tenant — bridge IP based route
if (scope) {
  const deployTarget = getUserDeployTarget(scope.userId);
  if (deployTarget === "vm") {
    const vmInfo = getVmRuntimeInfo(scope.userId);
    const vmPassword = getOrCreateServerPassword(scope.userId);
    if (!vmInfo) {
      return {
        runtimeKey: `vm-pending:${scope.userId}`,
        baseUrl: config.opencode.apiUrl,
        kind: "vm",
        userId: scope.userId,
        chatId: scope.chatId,
        tenantId: `vm-${scope.userId}`,
        password: vmPassword,
      };
    }
    return {
      runtimeKey: `vm:${scope.userId}:${vmInfo.domainName}`,
      baseUrl: vmInfo.baseUrl,
      kind: "vm",
      userId: vmInfo.userId,
      chatId: scope.chatId,
      tenantId: vmInfo.domainName,
      password: vmPassword,
    };
  }
}
```

Add imports:
```typescript
import { getUserDeployTarget, getVmRuntimeInfo } from "../settings/manager.js";
```

**Step 2: Update OpencodeRoute.kind type**

```typescript
kind: "host" | "tenant" | "vm";
```

**Step 3: Update ensureCurrentOpencodeRouteReady()**

Add VM path between SSH and admin check:

```typescript
// VM path: ensure VM runtime is ready
if (scope) {
  const deployTarget = getUserDeployTarget(scope.userId);
  if (deployTarget === "vm") {
    const result = await processManager.ensureRuntime();
    if (!result.success) {
      if (result.needsVmSpec) {
        throw new NeedsDeployTargetError("vm_spec_required", scope.userId);
      }
      throw new Error(result.error || `Failed to initialize VM runtime for userId=${scope.userId}`);
    }
    return;
  }
}
```

**Step 4: Define NeedsDeployTargetError**

Add at bottom of client.ts:

```typescript
export class NeedsDeployTargetError extends Error {
  constructor(
    public code: string,
    public userId: number,
  ) {
    super(code);
    this.name = "NeedsDeployTargetError";
  }
}
```

**Step 5: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 6: Commit**

```bash
git add src/opencode/client.ts
git commit -m "feat: add vm route resolution in opencodeClient proxy"
```

---

## Phase 6: Bot Handler — VM Spec Selection

### Task 6.1: Create VM spec selection inline menu handler

**Objective:** When a new user without deployTarget sends their first message, show an inline menu to select Docker or a VM tier.

**Files:**
- Create: `src/bot/handlers/vm-spec-selection.ts`
- Modify: `src/bot/handlers/prompt.ts`

**Step 1: Create the handler**

```typescript
// src/bot/handlers/vm-spec-selection.ts
import type { Context } from "grammy";
import { setUserDeployTarget, setUserVmSpecTier } from "../../settings/manager.js";
import { VM_TIERS, type VmSpecTier } from "../../vm/types.js";
import { processManager } from "../../process/manager.js";
import { t } from "../../i18n/index.js";

export async function showVmSpecSelectionMenu(ctx: Context, userId: number): Promise<void> {
  const tiers = Object.entries(VM_TIERS);

  const keyboard = tiers.map(([key, spec]) => [{
    text: `${spec.label}: ${spec.ramMb / 1024}GB RAM / ${spec.vcpus} vCPU / ${spec.diskGb}GB SSD`,
    callback_data: `vm:select:${key}`,
  }]);

  // Add Docker option
  keyboard.push([{
    text: "🐳 Docker (текущий)",
    callback_data: "vm:select:docker",
  }]);

  await ctx.reply("Выберите конфигурацию сервера:", {
    reply_markup: { inline_keyboard: keyboard },
  });
}

export async function handleVmSpecCallback(ctx: Context, data: string): Promise<boolean> {
  const match = data.match(/^vm:select:(.+)$/);
  if (!match) return false;

  const userId = ctx.from?.id;
  if (!userId) return false;

  const choice = match[1];

  if (choice === "docker") {
    setUserDeployTarget(userId, "docker");
    await ctx.reply("✅ Выбран Docker. Создаю контейнер...");
  } else {
    const tier = choice as VmSpecTier;
    const spec = VM_TIERS[tier];
    if (!spec) return false;

    setUserDeployTarget(userId, "vm");
    setUserVmSpecTier(userId, tier);

    await ctx.reply(`✅ Выбран тариф «${spec.label}» (${spec.ramMb / 1024}GB / ${spec.vcpus} vCPU / ${spec.diskGb}GB). Создаю виртуальный сервер...`);

    const result = await processManager.ensureRuntime();
    if (!result.success) {
      await ctx.reply(`❌ Ошибка: ${result.error || "неизвестная ошибка"}`);
    } else {
      await ctx.reply("✅ Сервер готов! Можете отправлять запросы.");
    }
  }

  await ctx.answerCallbackQuery();
  return true;
}
```

**Step 2: Wire into prompt.ts**

In `src/bot/handlers/prompt.ts`, in the section where `ensureCurrentOpencodeRouteReady()` is called (around line 841 in the safeBackgroundTask wrapper), catch `NeedsDeployTargetError`:

```typescript
import { NeedsDeployTargetError } from "../../opencode/client.js";
import { showVmSpecSelectionMenu } from "./vm-spec-selection.js";

// Inside the onError handler of safeBackgroundTask, add:
if (error instanceof NeedsDeployTargetError) {
  await showVmSpecSelectionMenu(ctx, error.userId);
  return;
}
```

Also add a callback query handler in the bot setup to route `vm:select:*` callbacks.

**Step 3: Wire callback handler**

In the bot command/callback setup (likely `src/bot/commands/` or the main bot file), add:

```typescript
bot.on("callback_query:data", async (ctx) => {
  const data = ctx.callbackQuery.data;
  if (data.startsWith("vm:select:")) {
    return handleVmSpecCallback(ctx, data);
  }
  // ... existing callback handlers
});
```

**Step 4: TypeScript check**

```bash
npx tsc --noEmit
```

Expected: PASS

**Step 5: Commit**

```bash
git add src/bot/handlers/vm-spec-selection.ts src/bot/handlers/prompt.ts
git commit -m "feat: add VM spec selection inline menu handler"
```

---

## Phase 7: Cleanup & Verification

### Task 7.1: Run full build and lint

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Expected: All PASS.

### Task 7.2: Run full test suite

```bash
npm test
```

Expected: All existing tests PASS. New VM tests PASS.

### Task 7.3: Add vm tests for ProcessManager integration

Create `tests/process/manager-vm.test.ts`:

```typescript
// Test ensureVmRuntime flow:
// 1. deployTarget="vm", no tier selected → returns needsVmSpec: true
// 2. deployTarget="vm", tier selected, base image missing → returns error
// 3. deployTarget="vm", tier selected, VM created → returns success
// 4. deployTarget="vm", VM already running → returns success immediately
// 5. deployTarget="vm", VM dead → cleans up and recreates
```

Use the same mock patterns as existing `manager.test.ts`.

Expected: All new tests PASS.

### Task 7.4: Update CHANGELOG.md

Add entry:

```markdown
## [Unreleased]
### Added
- VM deployment for tenant workspaces (QEMU/KVM + libvirt)
- Interactive VM spec selection via Telegram inline menu (4 tiers)
- virtio-mem for dynamic memory allocation
- qcow2 backing files for thin disk provisioning
```

### Task 7.5: Update PRODUCT.md

Add to "Possible Improvements" or "Current Product Scope":

```markdown
- [x] VM-based tenant workspace deployment (QEMU/KVM alternative to Docker)
```

---

## Summary: Files Created/Modified

| File | Action |
|------|--------|
| `src/vm/types.ts` | Create |
| `src/vm/manager.ts` | Create |
| `src/vm/cloud-init.ts` | Create |
| `src/process/types.ts` | Modify (+"vm" kind) |
| `src/process/manager.ts` | Modify (+vm branch) |
| `src/settings/manager.ts` | Modify (+deployTarget, +vm CRUD) |
| `src/settings/repositories/vm-runtimes.ts` | Create |
| `src/settings/repositories/types.ts` | Modify (+VmRuntimeRow) |
| `src/settings/db.ts` | Modify (+vm_runtimes table) |
| `src/opencode/client.ts` | Modify (+vm route, +NeedsDeployTargetError) |
| `src/bot/handlers/vm-spec-selection.ts` | Create |
| `src/bot/handlers/prompt.ts` | Modify (+error catch) |
| `tests/vm/manager.test.ts` | Create |
| `tests/process/manager-vm.test.ts` | Create |
| `PRODUCT.md` | Modify |
| `CHANGELOG.md` | Modify |
