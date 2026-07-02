# Golden Image In-Place Update Plan

> **For Hermes:** Use subagent-driven-development skill.

**Goal:** Reliable golden image update that pushes fixes to EXISTING user VMs without data loss. No full redeploy. No wipe.

**Architecture:** Leverage existing `createAndStart()` data-disk survival. Add `updateVmFromGolden()` that stops VM → recreates OS overlay from new golden → starts VM. Data disk (MEMORY.md, USER.md, opencode.db, /workspace) survives. Same MAC/IP preserved.

---

### Task 1: Add `rebuildOverlay()` to VmManager

**Objective:** Single-VM golden image update — recreate OS overlay only, keep data disk.

**Files:**
- Modify: `src/vm/manager.ts` — add `rebuildOverlay(userId, spec)` method
- Modify: `src/vm/types.ts` — add `VmRebuildResult` interface
- Create: `tests/vm/manager-update.test.ts`

**Behavior:**
1. Stop VM gracefully (`virsh destroy --graceful`)
2. Undefine VM (`virsh undefine`)
3. Delete OLD overlay qcow2 (clonePath)
4. Create NEW overlay from current golden (`qemu-img create -b opencode-golden.qcow2`)
5. Generate fresh cloud-init ISO
6. Define + start VM
7. Verify health (HTTP 200 on opencode server)
8. Data disk is NEVER touched

**Step 1: Write failing test** — mock qemu-img, virsh calls. Test that overlay is recreated, data disk path is NOT in any rm command.

**Step 2: Implement `rebuildOverlay()` in VmManager**

**Step 3: Tests → PASS, full suite → no regressions**

---

### Task 2: Add batch update CLI command

**Objective:** Operator can run `npx tsx src/vm/update-all.ts` to update ALL existing VMs.

**Files:**
- Create: `src/vm/update-all.ts` — CLI script
- Create: `tests/vm/update-all.test.ts`

**Behavior:**
1. List all VMs (`virsh list --all | grep opencode-tg`)
2. For each VM: extract userId, get spec from stored state
3. Call `rebuildOverlay(userId, spec)`
4. Report success/failure per VM
5. Skip VMs that are already on current golden (version check via metadata)

**Step 1: TDD → failing tests**

**Step 2: Implement**

---

### Task 3: Golden image versioning

**Objective:** Know which golden version each VM is on. Prevent unnecessary rebuilds.

**Files:**
- Modify: `src/vm/image-builder.ts` — embed version stamp in golden image
- Modify: `src/vm/manager.ts` — check version before rebuild
- Modify: `src/vm/types.ts` — `VM_DEFAULTS.goldenImageVersion`

**Implementation:**
1. `image-builder.ts` writes `/etc/opencode/golden-version` file with ISO timestamp
2. `rebuildOverlay()` checks if VM already on current version → skip
3. `update-all.ts` reports which VMs need update

---

### Task 4: Bot `/updatevm` command (optional, user-triggered)

**Objective:** VM user can self-trigger update without admin.

**Files:**
- Create: `src/bot/commands/updatevm.ts`
- Modify: bot command registry

---

### Task 5: Personal verification

1. Build new golden image with SSH fix + version stamp
2. Trigger `rebuildOverlay()` on test VM
3. Verify: SSH password auth works, MEMORY.md/USER.md survive
4. Verify: opencode.db intact, all skills present
