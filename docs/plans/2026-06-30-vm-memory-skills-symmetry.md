# VM Memory & Skills Hermes-Symmetry Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Achieve Hermes-level memory/skills push-injection for VM users — bot auto-injects MEMORY.md, USER.md, and available skills into the system prompt BEFORE model sees it (zero chance of skip).

**Architecture:** Bot on host reads memory/skills from VM via SSH (scp cat), formats Hermes-style blocks, injects into prompt text before sending to opencode API. Fix golden image SSH first so password auth works.

**Tech Stack:** TypeScript, Node.js fs/child_process, opencode-tg bot, QEMU/KVM golden image, Debian 12 cloud-init.

---

### Task 1: Fix SSH Password Auth in Golden Image

**Objective:** Ensure cloud-init `ssh_pwauth: true` takes effect by removing conflicting `PasswordAuthentication no` from golden image's sshd_config.

**Files:**
- Modify: `src/vm/cloud-init.ts` — add runcmd step to sed-fix sshd_config on first boot

**Step 1: Add sed command in cloud-init runcmd**

In `generateContextIso()` (Phase 2, after line 127 `ssh_pwauth: true`), add a runcmd step that ensures `PasswordAuthentication yes`:

```yaml
runcmd:
  - sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config
  - sed -i 's/^#PasswordAuthentication yes/PasswordAuthentication yes/' /etc/ssh/sshd_config.d/*.conf 2>/dev/null || true
  - systemctl restart sshd
```

**Step 2: Write failing test**

Create `tests/vm/cloud-init-ssh.test.ts`:
```typescript
test("Phase 2 context ISO includes SSH password auth fix", () => {
  const ctx = { userId: 42, opencodePassword: "test", sudoPassword: "test" };
  const userData = buildContextUserData(ctx);
  expect(userData).toContain("sed -i 's/^PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config");
  expect(userData).toContain("systemctl restart sshd");
});
```

**Step 3: Run test to verify failure**  
`npx vitest run tests/vm/cloud-init-ssh.test.ts` → FAIL

**Step 4: Implement the fix**  
Add runcmd to `generateContextIso()` in `src/vm/cloud-init.ts`.

**Step 5: Run test → PASS, then full suite**  
`npx vitest run` → all pass

---

### Task 2: VM Memory Fetch Transport (SSH)

**Objective:** Create `fetchVmMemory(host, sudoPassword)` that SSHs into VM and reads MEMORY.md, USER.md, and skills list. Returns structured data for injector.

**Files:**
- Create: `src/memory/vm-fetch.ts` — `fetchVmMemory()`, `fetchVmSkills()`, `formatHermesMemoryBlock()`
- Create: `tests/memory/vm-fetch.test.ts`

**Step 1: Write failing tests**

```typescript
// fetchVmMemory reads MEMORY.md and USER.md via SSH
test("fetchVmMemory returns formatted memory blocks", async () => {
  const result = await fetchVmMemory(host, password);
  expect(result).toContain("MEMORY (your personal notes)");
  expect(result).toContain("USER PROFILE");
});

// fetchVmSkills reads SKILL.md files
test("fetchVmSkills returns formatted skill list", async () => {
  const result = await fetchVmSkills(host, password);
  expect(result).toContain("<available_skills>");
  expect(result).toContain("godmode");
});

// SSH failure returns empty string (best-effort)
test("fetchVmMemory returns empty on SSH failure", async () => {
  const result = await fetchVmMemory("no-such-host", "x");
  expect(result).toBe("");
});
```

**Step 2: Run tests → FAIL**

**Step 3: Implement** `src/memory/vm-fetch.ts`:
- `sshCat(host, password, remotePath)` — exec `sshpass -p PASSWORD ssh -o StrictHostKeyChecking=no -o ConnectTimeout=5 user@host "cat PATH"`
- `fetchVmMemory(host, password, workspace?)` → calls sshCat for MEMORY.md, USER.md → formats Hermes blocks
- `fetchVmSkills(host, password, skillsDir?)` → ssh `ls DIR/SKILL.md` pattern → parse YAML frontmatter → `<available_skills>` block

**Step 4: Tests → PASS**

---

### Task 3: Skills Infrastructure on VM

**Objective:** Skills on VM are auto-created/updated by the model via `write_file` to `/workspace/skills/`. Ensure the directory exists and cloud-init bootstraps it with existing skills. Add auto-sync: after model writes a skill on VM, bot should be able to read it for future prompts.

**Files:**
- Modify: `src/vm/cloud-init.ts` — ensure `/workspace/skills/` exists + symlink from `/home/opencode/.config/opencode/skills/`

**Step 1: Verify current state**

Already in cloud-init.ts line 52: `mkdir -p ... /state/skills /etc/opencode`  
Line 69: copies skills from `/opt/opencode-skills/` to `/home/opencode/.config/opencode/skills/`

**Step 2: Add symlink so skills written via `write_file` to `/workspace/skills/` are visible to opencode**

Add to cloud-init runcmd:
```bash
mkdir -p /workspace/skills
ln -sf /workspace/skills /home/opencode/.config/opencode/skills/user 2>/dev/null || true
```

**Step 3: Write test** in `tests/vm/cloud-init-skills.test.ts`

**Step 4: Implement → test PASS**

---

### Task 4: Integrate VM Memory + Skills into prompt.ts

**Objective:** `processUserPrompt` in `prompt.ts` detects VM users (via SSH active state), fetches memory/skills from VM before building prompt, injects Hermes-formatted blocks into the text part.

**Files:**
- Modify: `src/memory/inject.ts` — add `injectVmContext(userId, text)` that calls fetchVmMemory + fetchVmSkills
- Modify: `src/bot/handlers/prompt.ts` — call `injectVmContext` for VM users

**Step 1: Write failing test** in `tests/memory/inject-vm.test.ts`

**Step 2: Implement**:
```typescript
export async function injectVmContext(userId: number, text: string): Promise<string> {
  const sshActive = sshManager.isSshActive(userId);
  if (!sshActive) return text; // not a VM user
  
  const host = sshManager.getHost(userId);
  const credentials = await sshManager.loadCredentials(userId);
  if (!credentials) return text;
  
  const memoryBlock = await fetchVmMemory(host, credentials.password);
  const skillsBlock = await fetchVmSkills(host, credentials.password);
  
  return memoryBlock + skillsBlock + text;
}
```

**Step 3: Integrate in prompt.ts** — call `injectVmContext()` alongside existing `injectMemoryContext()`:

```typescript
// After existing kaeru memory injection (line 1051)
enrichedText = await injectVmContext(userId, enrichedText);
```

**Step 4: Tests → PASS, full suite**

---

### Task 5: Full Integration Test + Personal Verification

**Objective:** Build new golden image with SSH fix, deploy test VM, verify memory + skills auto-injection works end-to-end.

**Step 1:** Build golden image with updated cloud-init  
**Step 2:** Deploy test VM  
**Step 3:** SSH into VM, write MEMORY.md with test content  
**Step 4:** Send message via bot → verify injected memory block appears in model's context  
**Step 5:** Verify the bot response references memory content  
**Step 6:** Run full test suite
