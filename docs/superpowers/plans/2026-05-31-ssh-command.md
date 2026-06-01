# SSH Command Integration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement the `/ssh` command for remote server connection, setup (Docker or Host OpenCode server), SFTP skill copy, dynamic SDK routing, and secure auto-reconnect on bot startup with user-scoped isolation.

**Architecture:** Add `ssh2` dependency. Create `ssh-encryption` utility using `aes-256-gcm`. Integrate custom commands in `src/bot/commands/ssh.ts` utilizing `grammy` interaction states. Modify `src/opencode/client.ts` to swap URLs on active session, and add background recovery during `ProcessManager.initialize()`.

**Tech Stack:** TypeScript, Grammy (Telegram bot framework), ssh2, Node.js Crypto, Vitest.

---

### Task 1: Package Dependencies and Command Registration

**Files:**
- Modify: `package.json:55-70`
- Modify: `src/bot/commands/definitions.ts:15-42`
- Modify: `src/i18n/en.ts:10-50`

- [ ] **Step 1: Write a failing test for command definitions**

Create a test file `tests/bot/commands/definitions.test.ts` to verify `/ssh` command registration exists:
```typescript
import { expect, test } from "vitest";
import { getLocalizedBotCommands } from "../../../src/bot/commands/definitions.js";

test("ssh command registration exists", () => {
  const commands = getLocalizedBotCommands({ isAdmin: true });
  const sshCmd = commands.find(c => c.command === "ssh");
  expect(sshCmd).toBeDefined();
  expect(sshCmd?.command).toBe("ssh");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/definitions.test.ts`
Expected: FAIL (command 'ssh' not found in COMMAND_DEFINITIONS)

- [ ] **Step 3: Implement dependencies and definition registration**

Add `"ssh2": "^1.16.0"` to dependencies in `package.json` and add `ssh` to definitions:

In `src/bot/commands/definitions.ts`:
```typescript
// Insert in COMMAND_DEFINITIONS array:
{ command: "ssh", descriptionKey: "cmd.description.ssh" },
```

Add translation key in `src/i18n/en.ts` (and standard fallbacks):
```typescript
"cmd.description.ssh": "Manage remote SSH servers",
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/definitions.test.ts`
Expected: PASS

- [ ] **Step 5: Install dependencies and commit**

Run: `npm install`
Run:
```bash
git add package.json package-lock.json src/bot/commands/definitions.ts src/i18n/en.ts tests/bot/commands/definitions.test.ts
git commit -m "feat(ssh): register dependency and command definitions"
```

---

### Task 2: Secure AES-256 GCM Credentials Encryption

**Files:**
- Create: `src/utils/ssh-encryption.ts`
- Create: `tests/utils/ssh-encryption.test.ts`

- [ ] **Step 1: Write a failing test for encryption/decryption**

In `tests/utils/ssh-encryption.test.ts`:
```typescript
import { expect, test } from "vitest";
import { encryptData, decryptData } from "../../src/utils/ssh-encryption.js";

test("encrypts and decrypts data correctly", () => {
  const key = Buffer.alloc(32, "a");
  const secret = "my-ssh-password";
  const encrypted = encryptData(secret, key);
  const decrypted = decryptData(encrypted, key);
  expect(decrypted).toBe(secret);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/utils/ssh-encryption.test.ts`
Expected: FAIL (functions not defined)

- [ ] **Step 3: Implement AES-256 GCM utilities**

In `src/utils/ssh-encryption.ts`:
```typescript
import crypto from "node:crypto";

export function encryptData(text: string, key: Buffer): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  let encrypted = cipher.update(text, "utf8", "hex");
  encrypted += cipher.final("hex");
  const authTag = cipher.getAuthTag().toString("hex");
  return `${iv.toString("hex")}:${authTag}:${encrypted}`;
}

export function decryptData(encryptedText: string, key: Buffer): string {
  const [ivHex, authTagHex, encrypted] = encryptedText.split(":");
  const iv = Buffer.from(ivHex, "hex");
  const authTag = Buffer.from(authTagHex, "hex");
  const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(authTag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/utils/ssh-encryption.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/utils/ssh-encryption.ts tests/utils/ssh-encryption.test.ts
git commit -m "feat(ssh): implement secure aes-256-gcm user-specific encryption"
```

---

### Task 3: SSH Connection Handler and Host Setup

**Files:**
- Create: `src/bot/commands/ssh.ts`
- Modify: `src/bot/commands/index.ts` (import and link new handler)

- [ ] **Step 1: Write a failing test for SSH Connection Handler**

Create `tests/bot/commands/ssh.test.ts` to verify parsing of connection strings:
```typescript
import { expect, test } from "vitest";
import { parseConnectionString } from "../../src/bot/commands/ssh.js";

test("correctly parses SSH connection strings", () => {
  const result = parseConnectionString("root@192.168.1.100:2222");
  expect(result).toEqual({ username: "root", host: "192.168.1.100", port: 2222 });

  const resultDefaultPort = parseConnectionString("admin@example.com");
  expect(resultDefaultPort).toEqual({ username: "admin", host: "example.com", port: 22 });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/ssh.test.ts`
Expected: FAIL (parseConnectionString not defined)

- [ ] **Step 3: Implement SSH connection string parser and handler shell**

In `src/bot/commands/ssh.ts`:
```typescript
export interface SshDetails {
  username: string;
  host: string;
  port: number;
}

export function parseConnectionString(connStr: string): SshDetails | null {
  const match = connStr.trim().match(/^([^@]+)@([^:]+)(?::(\d+))?$/);
  if (!match) return null;
  return {
    username: match[1],
    host: match[2],
    port: match[3] ? parseInt(match[3], 10) : 22
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/ssh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/bot/commands/ssh.ts tests/bot/commands/ssh.test.ts
git commit -m "feat(ssh): add connection parser and ssh command stub"
```

---

### Task 4: SFTP Skill Mirroring Implementation

**Files:**
- Modify: `src/bot/commands/ssh.ts`

- [ ] **Step 1: Write a mock SFTP upload test**

In `tests/bot/commands/ssh.test.ts` add a test for SFTP paths generation:
```typescript
import { expect, test } from "vitest";
import { getSkillsToUpload } from "../../src/bot/commands/ssh.js";

test("returns only 4 base skills from local docker directory", () => {
  const skills = getSkillsToUpload();
  expect(skills.length).toBe(4);
  expect(skills).toContain("tg-cli");
  expect(skills).toContain("openai-media-transcriber");
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/bot/commands/ssh.test.ts`
Expected: FAIL (getSkillsToUpload not defined)

- [ ] **Step 3: Implement skills list parser and SFTP upload routine**

In `src/bot/commands/ssh.ts`:
```typescript
export function getSkillsToUpload(): string[] {
  return ["tg-cli", "embedding-strategies", "openai-media-transcriber", "gpt-image-api"];
}
```

Implement the actual file upload logic via `ssh2`'s SFTP stream inside `src/bot/commands/ssh.ts` to upload only these directories to `~/.config/opencode/skills/` on the remote server.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/bot/commands/ssh.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/bot/commands/ssh.ts tests/bot/commands/ssh.test.ts
git commit -m "feat(ssh): implement list and sftp upload of the 4 native skills"
```

---

### Task 5: Dynamic Routing Integration

**Files:**
- Modify: `src/opencode/client.ts:63-94`

- [ ] **Step 1: Write a failing test for dynamic router**

Create `tests/opencode/client.test.ts` to test route switching when SSH connection is active:
```typescript
import { expect, test, vi } from "vitest";
import { getCurrentOpencodeRoute } from "../../src/opencode/client.js";

test("hijacks route if active SSH session exists for user", () => {
  // Mock scope and ssh session state
  const route = getCurrentOpencodeRoute();
  // Expect it to route to the remote server instead of host/tenant
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/opencode/client.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement router hijacking**

Modify `getCurrentOpencodeRoute` in `src/opencode/client.ts` to check if a valid active SSH connection exists for the current user's Telegram scope (`userId`). If active, return `OpencodeRoute` with the remote server's URL.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/opencode/client.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/opencode/client.ts tests/opencode/client.test.ts
git commit -m "feat(ssh): implement dynamic opencode proxy routing to remote server"
```

---

### Task 6: SSH Background Recovery and Startup Service

**Files:**
- Modify: `src/process/manager.ts:45-78`

- [ ] **Step 1: Write a mock initialization test for recovery service**

Create `tests/process/ssh-recovery.test.ts` to test scanning for user files on startup:
```typescript
import { expect, test } from "vitest";

test("scans active state files for auto-reconnect", () => {
  // Verify scanning logic
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/process/ssh-recovery.test.ts`
Expected: FAIL

- [ ] **Step 3: Implement background connection recovery**

Add a background runner inside `ProcessManager.initialize` in `src/process/manager.ts` that:
1. Scans `/home/me/Workspaces/tg-*/state/ssh_credentials.json`.
2. For each found session, decrypts using `/state/config/ssh_key`.
3. Auto-reconnects using SSH2 in the background to ensure routing persistence.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/process/ssh-recovery.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

Run:
```bash
git add src/process/manager.ts tests/process/ssh-recovery.test.ts
git commit -m "feat(ssh): implement background auto-reconnect startup service"
```
