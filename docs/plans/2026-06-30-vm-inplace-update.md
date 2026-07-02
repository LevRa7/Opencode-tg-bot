# VM In-Place Update — Guestfish + SSH Injection

> **For Hermes:** Use subagent-driven-development skill.

**Goal:** Push golden image fixes (SSH config, skills symlink, etc.) to EXISTING VMs without data loss, without overlay recreation. All user-installed software survives.

**Core principle:** Guestfish for offline injection, SSH for online. Never recreate overlay.

---

### Architecture

```
updateVm(userId)
  │
  ├─ VM running?
  │   ├─ YES → try SSH inject → ✅ done
  │   └─ SSH fail → virsh shutdown → guestfish inject → virsh start
  │
  └─ VM shut off?
      └─ guestfish inject → ✅ done

Guestfish inject:
  virt-customize -a /path/vm.qcow2 \
    --run-command "sed -i 's/^PasswordAuth.../PasswordAuth yes/' /etc/ssh/sshd_config" \
    --run-command "systemctl restart sshd" \
    --run-command "mkdir -p /workspace/skills && rm -rf ... && ln -sfT ..."

SSH inject:
  sshpass -p PWD ssh user@host "sed -i ... && systemctl restart sshd"
```

---

### Task 1: `injectViaGuestfish()` — offline disk injection

**Files:**
- Create: `src/vm/guestfish-inject.ts`
- Create: `tests/vm/guestfish-inject.test.ts`

**Function:**
```typescript
export async function injectViaGuestfish(
  qcow2Path: string,
  commands: string[],
): Promise<{ success: boolean; error?: string }>
```

Calls `virt-customize -a ${qcow2Path}` with `--run-command` for each command.
Commands are shell scripts that run INSIDE the VM's filesystem (VM is NOT running — virt-customize mounts the disk).

Default commands (the current golden image fixes):
```typescript
const DEFAULT_FIXES = [
  `sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config`,
  `mkdir -p /workspace/skills && rm -rf /home/opencode/.config/opencode/skills/user && ln -sfT /workspace/skills /home/opencode/.config/opencode/skills/user`,
];
```

**Pitfalls:**
- VM MUST be shut off (virt-customize locks the disk)
- `virt-customize` modifies the TOP qcow2 layer — NEVER the backing image
- Returns error if qcow2Path doesn't exist
- Timeout: 120s (large disks may take longer)

---

### Task 2: `injectViaSsh()` — online SSH injection

**Files:**
- Create: `src/vm/ssh-inject.ts`
- Create: `tests/vm/ssh-inject.test.ts`

**Function:**
```typescript
export async function injectViaSsh(
  host: string,
  password: string,
  commands: string[],
): Promise<{ success: boolean; error?: string }>
```

Uses existing `sshExec` from `src/memory/vm-fetch.ts` (or same sshpass pattern).
Executes each command sequentially, stops on first failure.

---

### Task 3: `updateVm()` — update orchestrator in VmManager

**Files:**
- Modify: `src/vm/manager.ts` — add `updateVm(userId)` method
- Create: `tests/vm/manager-update.test.ts`

**Function:**
```typescript
async updateVm(userId: number): Promise<VmOperationResult & { method: "ssh" | "guestfish" | "skipped" }>
```

Flow:
1. Get domainName + qcow2Path for userId
2. Check golden version: read `/etc/opencode/golden-version` from disk via guestfish (skip if current)
3. Check if VM is running (`virsh list`)
4. Running → try SSH via sshManager connection → if fail → virsh shutdown → guestfish → virsh start
5. Not running → guestfish directly
6. Return { success, method }

---

### Task 4: `/update` + `/update-all` bot commands

**Files:**
- Create: `src/bot/commands/update.ts` — user command
- Create: `src/bot/commands/update-all.ts` — admin command
- Modify: bot command registry

**`/update`** — any user can call. Calls `manager.updateVm(userId)`.

**`/update-all`** — admin only (check `userId === ADMIN_ID`).
Lists all VMs, calls `updateVm()` for each, reports summary.

---

### Task 5: Golden version stamp

**Files:**
- Modify: `src/vm/image-builder.ts` — write version file during build
- Modify: `src/vm/manager.ts` — check version in `updateVm()`

Image builder writes: `echo "2026-06-30T14:00:00Z" > /etc/opencode/golden-version`

Version format: ISO 8601 timestamp of golden image build.

`updateVm()` reads this file via guestfish (`virt-customize --run-command "cat /etc/opencode/golden-version"`) and compares with current.

---

### Task 6: `update-all.ts` CLI (for admin, not bot)

**Files:**
- Create: `scripts/update-all.ts`

CLI script: `npx tsx scripts/update-all.ts [--dry-run]`

Same logic as `/update-all` but runs from terminal.
