# Multi-Key Telegraph Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace single-token Telegraph client with a per-user pool of 5 auto-registered tokens, with round-robin for new pages and key-pinned editing.

**Architecture:** A `MultiKeyClient` wraps a `TelegraphKeyPool` and tracks article→key bindings in a new `telegraph_article_bindings` table. Consumers (`TelegraphPublishQueue`, `ThinkingTelegraphAccumulator`, `SubagentTelegraphLogger`) remain unchanged — they receive a `MultiKeyClient` as a drop-in replacement for `TelegraphClient`.

**Tech Stack:** TypeScript, better-sqlite3, Telegra.ph API, Node.js crypto (AES-256-GCM)

---

### Task 1: Encryption utility

**Files:**
- Create: `src/telegraph/token-encryption.ts`
- Test: `tests/telegraph/token-encryption.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telegraph/token-encryption.test.ts
import { describe, it, expect } from "vitest";
import { encryptToken, decryptToken } from "../../src/telegraph/token-encryption.js";

describe("token-encryption", () => {
  it("should encrypt and decrypt a token", () => {
    const key = Buffer.from("0123456789abcdef0123456789abcdef", "hex"); // 32 bytes
    const token = "my-secret-telegraph-token-12345";
    const encrypted = encryptToken(token, key);
    expect(encrypted).not.toBe(token);
    const decrypted = decryptToken(encrypted, key);
    expect(decrypted).toBe(token);
  });

  it("should produce different ciphertexts for the same token (unique IV)", () => {
    const key = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const token = "same-token";
    const a = encryptToken(token, key);
    const b = encryptToken(token, key);
    expect(a).not.toBe(b);
  });

  it("should fail with wrong key", () => {
    const keyA = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const keyB = Buffer.from("fedcba9876543210fedcba9876543210", "hex");
    const encrypted = encryptToken("my-token", keyA);
    expect(() => decryptToken(encrypted, keyB)).toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/telegraph/token-encryption.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/telegraph/token-encryption.ts
import { randomBytes, createCipheriv, createDecipheriv } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

function deriveKey(raw: Buffer): Buffer {
  if (raw.length === 32) return raw;
  if (raw.length < 32) {
    return Buffer.concat([raw, Buffer.alloc(32 - raw.length, 0)]);
  }
  return raw.subarray(0, 32);
}

export function encryptToken(token: string, key: Buffer): string {
  const derived = deriveKey(key);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, derived, iv);
  let encrypted = cipher.update(token, "utf8", "hex");
  encrypted += cipher.final("hex");
  const tag = cipher.getAuthTag();
  return `${iv.toString("hex")}:${tag.toString("hex")}:${encrypted}`;
}

export function decryptToken(encoded: string, key: Buffer): string {
  const derived = deriveKey(key);
  const parts = encoded.split(":");
  if (parts.length !== 3) throw new Error("Invalid encrypted token format");
  const iv = Buffer.from(parts[0]!, "hex");
  const tag = Buffer.from(parts[1]!, "hex");
  const encrypted = parts[2]!;
  const decipher = createDecipheriv(ALGORITHM, derived, iv);
  decipher.setAuthTag(tag);
  let decrypted = decipher.update(encrypted, "hex", "utf8");
  decrypted += decipher.final("utf8");
  return decrypted;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/telegraph/token-encryption.test.ts`
Expected: PASS (3 tests)

---

### Task 2: Article bindings repository

**Files:**
- Create: `src/settings/repositories/article-bindings.ts`
- Test: `tests/settings/repositories/article-bindings.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/settings/repositories/article-bindings.test.ts
import { describe, it, expect, beforeEach } from "vitest";
import Database from "better-sqlite3";
import { createArticleBindingsRepository } from "../../src/settings/repositories/article-bindings.js";

const DDL = `
CREATE TABLE IF NOT EXISTS telegraph_article_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    path        TEXT UNIQUE NOT NULL,
    key_id      INTEGER NOT NULL,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tg_article_bind_path ON telegraph_article_bindings(path);
CREATE INDEX IF NOT EXISTS idx_tg_article_bind_user ON telegraph_article_bindings(user_id);
`;

describe("ArticleBindingsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("should insert and retrieve by path", () => {
    const repo = createArticleBindingsRepository(db);
    repo.insert({ userId: 1, path: "my-article-123", keyId: 3 });
    const found = repo.getByPath("my-article-123");
    expect(found).toBeDefined();
    expect(found!.keyId).toBe(3);
    expect(found!.userId).toBe(1);
  });

  it("should return undefined for unknown path", () => {
    const repo = createArticleBindingsRepository(db);
    expect(repo.getByPath("nonexistent")).toBeUndefined();
  });

  it("should get all bindings for a user", () => {
    const repo = createArticleBindingsRepository(db);
    repo.insert({ userId: 1, path: "a", keyId: 1 });
    repo.insert({ userId: 1, path: "b", keyId: 2 });
    repo.insert({ userId: 2, path: "c", keyId: 1 });
    const user1 = repo.getByUser(1);
    expect(user1).toHaveLength(2);
  });

  it("should delete by path", () => {
    const repo = createArticleBindingsRepository(db);
    repo.insert({ userId: 1, path: "my-article", keyId: 1 });
    repo.deleteByPath("my-article");
    expect(repo.getByPath("my-article")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/settings/repositories/article-bindings.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/settings/repositories/article-bindings.ts
import type Database from "better-sqlite3";

export interface ArticleBindingRow {
  id: number;
  user_id: number;
  path: string;
  key_id: number;
  created_at: number;
}

export function createArticleBindingsRepository(db: Database.Database) {
  const insertStmt = db.prepare(
    "INSERT INTO telegraph_article_bindings (user_id, path, key_id, created_at) VALUES (?, ?, ?, ?)"
  );
  const getStmt = db.prepare(
    "SELECT * FROM telegraph_article_bindings WHERE path = ?"
  );
  const getUserStmt = db.prepare(
    "SELECT * FROM telegraph_article_bindings WHERE user_id = ? ORDER BY created_at"
  );
  const deleteStmt = db.prepare(
    "DELETE FROM telegraph_article_bindings WHERE path = ?"
  );

  return {
    insert(params: { userId: number; path: string; keyId: number }): void {
      insertStmt.run(params.userId, params.path, params.keyId, Date.now());
    },
    getByPath(path: string): ArticleBindingRow | undefined {
      return getStmt.get(path) as ArticleBindingRow | undefined;
    },
    getByUser(userId: number): ArticleBindingRow[] {
      return getUserStmt.all(userId) as ArticleBindingRow[];
    },
    deleteByPath(path: string): void {
      deleteStmt.run(path);
    },
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/settings/repositories/article-bindings.test.ts`
Expected: PASS (4 tests)

---

### Task 3: DB migration — add telegraph_article_bindings table

**Files:**
- Modify: `src/settings/db.ts` (add table to DDL)
- Modify: `src/settings/migrate.ts` (add to migrateV2)
- Modify: `src/settings/manager.ts` (expose dbInstance and create bindings repo)

- [ ] **Step 1: Add table to DDL in `src/settings/db.ts`**

Insert after the `telegraph_keys` table creation (after line 128):

```typescript
// In src/settings/db.ts, append to DDL before topic_registry
const DDL = \`
...
CREATE TABLE IF NOT EXISTS telegraph_article_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id     INTEGER NOT NULL,
    path        TEXT UNIQUE NOT NULL,
    key_id      INTEGER NOT NULL REFERENCES telegraph_keys(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_tg_article_bind_path ON telegraph_article_bindings(path);
CREATE INDEX IF NOT EXISTS idx_tg_article_bind_user ON telegraph_article_bindings(user_id);
...
\`;
```

- [ ] **Step 2: Add bindings repo creation in `src/settings/manager.ts`**

Import:
```typescript
import { createArticleBindingsRepository } from "./repositories/article-bindings.js";
```

Add module-level variable after line 199 (`let telegraphKeysRepo = ...`):
```typescript
let articleBindingsRepo = createArticleBindingsRepository(_defaultDb);
```

Add inside the `open()` function after line 230 (`telegraphKeysRepo = ...`):
```typescript
articleBindingsRepo = createArticleBindingsRepository(dbInstance);
```

Export getter:
```typescript
export function getArticleBindingsRepo() {
  return articleBindingsRepo;
}
```

Also add to `__resetSettingsForTests` after line 916 similarly:
```typescript
articleBindingsRepo = createArticleBindingsRepository(dbInstance);
```

- [ ] **Step 3: Add to `migrateV2` in `src/settings/migrate.ts`**

After the conversation_bindings ALTER TABLE block (after line 193), add:
```typescript
const hasBindings = db.prepare(
  "SELECT name FROM sqlite_master WHERE type='table' AND name='telegraph_article_bindings'"
).get();
if (!hasBindings) {
  db.exec(
    `CREATE TABLE IF NOT EXISTS telegraph_article_bindings (
       id          INTEGER PRIMARY KEY AUTOINCREMENT,
       user_id     INTEGER NOT NULL,
       path        TEXT UNIQUE NOT NULL,
       key_id      INTEGER NOT NULL REFERENCES telegraph_keys(id) ON DELETE CASCADE,
       created_at  INTEGER NOT NULL
     );
     CREATE INDEX IF NOT EXISTS idx_tg_article_bind_path ON telegraph_article_bindings(path);
     CREATE INDEX IF NOT EXISTS idx_tg_article_bind_user ON telegraph_article_bindings(user_id);`
  );
  logger.info("Created telegraph_article_bindings table");
}
```

---

### Task 4: Enhance KeyPool with getClient and flood skip

**Files:**
- Modify: `src/telegraph/key-pool.ts`
- Test: `tests/telegraph/key-pool.test.ts` (if exists, extend; else create)

- [ ] **Step 1: Add `getClient(keyId)` to `src/telegraph/key-pool.ts`**

Add method after `selectKey()`:

```typescript
getClient(keyId: number): TelegraphClient | null {
  const entry = this.keys.find(k => k.keyId === keyId);
  return entry?.client ?? null;
}
```

- [ ] **Step 2: Write tests for getClient**

```typescript
// tests/telegraph/key-pool.test.ts
import { describe, it, expect } from "vitest";
import { TelegraphKeyPool } from "../../src/telegraph/key-pool.js";
import { TelegraphClient } from "../../src/telegraph/telegraph-client.js";
import type { TelegraphConfig } from "../../src/telegraph/types.js";

describe("TelegraphKeyPool", () => {
  it("should return null for unknown keyId", () => {
    const pool = new TelegraphKeyPool();
    expect(pool.getClient(999)).toBeNull();
  });

  it("should return the correct client by keyId", () => {
    const pool = new TelegraphKeyPool();
    const config = { enabled: true, accessToken: "tok1", authorName: "test", timeoutMs: 3000, maxChars: 25000, translateEnabled: false };
    const client1 = new TelegraphClient(config as TelegraphConfig);
    const client2 = new TelegraphClient(config as TelegraphConfig);
    pool.addKey(client1, 10);
    pool.addKey(client2, 20);
    expect(pool.getClient(10)).toBe(client1);
    expect(pool.getClient(20)).toBe(client2);
  });
});
```

- [ ] **Step 3: Run tests**

Run: `npx vitest tests/telegraph/key-pool.test.ts`
Expected: PASS

---

### Task 5: Auto-register Telegraph accounts

**Files:**
- Create: `src/telegraph/auto-register.ts`
- Test: `tests/telegraph/auto-register.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telegraph/auto-register.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { ensureUserKeys } from "../../src/telegraph/auto-register.js";
import { encryptToken } from "../../src/telegraph/token-encryption.js";

const mockDb = {
  prepare: () => ({ get: () => undefined, run: () => ({}) }),
  exec: () => {},
};

describe("ensureUserKeys", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("should create accounts when fewer than 5 keys exist", async () => {
    const repo = {
      countByUser: vi.fn().mockReturnValue(0),
      insert: vi.fn(),
      getAllByUser: vi.fn().mockReturnValue([]),
    };
    const encryptionKey = Buffer.from("0123456789abcdef0123456789abcdef", "hex");
    const mockResponse = { ok: true, result: { access_token: "new-token-xxx" } };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    });

    await ensureUserKeys(repo as any, 1, { authorName: "opencode-tg", timeoutMs: 3000 }, encryptionKey, 5);

    expect(repo.countByUser).toHaveBeenCalledWith(1);
    expect(global.fetch).toHaveBeenCalledTimes(5);
    expect(repo.insert).toHaveBeenCalledTimes(5);
  });

  it("should skip creation when 5 keys already exist", async () => {
    const repo = {
      countByUser: vi.fn().mockReturnValue(5),
      insert: vi.fn(),
      getAllByUser: vi.fn().mockReturnValue([]),
    };
    global.fetch = vi.fn();

    await ensureUserKeys(repo as any, 1, { authorName: "opencode-tg", timeoutMs: 3000 }, Buffer.alloc(32), 5);

    expect(global.fetch).not.toHaveBeenCalled();
    expect(repo.insert).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/telegraph/auto-register.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/telegraph/auto-register.ts
import { logger } from "../utils/logger.js";
import { encryptToken } from "./token-encryption.js";

const CREATE_ACCOUNT_URL = "https://api.telegra.ph/createAccount";

export async function ensureUserKeys(
  keysRepo: {
    countByUser(userId: number): number;
    insert(params: { user_id: number; token_encrypted: string; author_name?: string; created_at: number }): number;
    getAllByUser(userId: number): Array<{ id: number; token_encrypted: string; is_active: number }>;
  },
  userId: number,
  config: { authorName: string; timeoutMs: number },
  encryptionKey: Buffer,
  maxKeysPerUser: number,
): Promise<void> {
  const existingCount = keysRepo.countByUser(userId);
  const needed = maxKeysPerUser - existingCount;
  if (needed <= 0) return;

  logger.info(`[AutoRegister] Creating ${needed} Telegraph accounts for user ${userId}`);

  for (let i = 0; i < needed; i++) {
    const index = existingCount + i + 1;
    const shortName = `opencode_tg_${userId}_${index}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      const params = new URLSearchParams();
      params.set("short_name", shortName);
      params.set("author_name", config.authorName);

      const response = await fetch(CREATE_ACCOUNT_URL, {
        method: "POST",
        body: params,
        signal: controller.signal,
      });
      clearTimeout(timer);

      if (!response.ok) {
        logger.warn(`[AutoRegister] createAccount failed for ${shortName}: HTTP ${response.status}`);
        continue;
      }

      const data = await response.json() as { ok: boolean; result?: { access_token: string } };
      if (!data.ok || !data.result?.access_token) {
        logger.warn(`[AutoRegister] createAccount API error for ${shortName}`);
        continue;
      }

      const encrypted = encryptToken(data.result.access_token, encryptionKey);
      keysRepo.insert({
        user_id: userId,
        token_encrypted: encrypted,
        author_name: config.authorName,
        created_at: Date.now(),
      });

      logger.info(`[AutoRegister] Created Telegraph account ${shortName}`);
    } catch (error) {
      logger.warn(`[AutoRegister] Failed to create account ${shortName}`, { error });
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/telegraph/auto-register.test.ts`
Expected: PASS (2 tests)

---

### Task 6: MultiKeyClient

**Files:**
- Create: `src/telegraph/multi-key-client.ts`
- Test: `tests/telegraph/multi-key-client.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// tests/telegraph/multi-key-client.test.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { MultiKeyClient } from "../../src/telegraph/multi-key-client.js";
import { TelegraphKeyPool } from "../../src/telegraph/key-pool.js";
import { TelegraphClient } from "../../src/telegraph/telegraph-client.js";

function createMockClient(returnUrl: string | null, failWithFlood = false) {
  const client = {
    createPage: vi.fn().mockImplementation(async (title: string, body: string) => {
      if (failWithFlood) throw new (class extends Error { constructor() { super("FLOOD_WAIT_30"); this.name = "FloodWaitError"; } })();
      if (returnUrl === null) return null;
      return { url: returnUrl, path: returnUrl.replace("https://telegra.ph/", "") };
    }),
    editPage: vi.fn().mockResolvedValue(true),
    publish: vi.fn().mockResolvedValue(returnUrl),
    flush: vi.fn(),
    reset: vi.fn(),
  } as unknown as TelegraphClient;
  return client;
}

describe("MultiKeyClient", () => {
  it("should create a page using the available key", async () => {
    const pool = new TelegraphKeyPool();
    const client1 = createMockClient("https://telegra.ph/test-1");
    pool.addKey(client1, 1);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
      getByUser: vi.fn().mockReturnValue([]),
      deleteByPath: vi.fn(),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, {} as any, { authorName: "test", timeoutMs: 3000, maxChars: 25000 });
    const result = await mkc.publish({ title: "Test", body: "Hello" });
    expect(result).toBe("https://telegra.ph/test-1");
    expect(bindingsRepo.insert).toHaveBeenCalledWith({ userId: undefined, path: "test-1", keyId: 1 });
  });

  it("should skip flooded keys and try next", async () => {
    const pool = new TelegraphKeyPool();
    const floodClient = createMockClient(null, true);
    const goodClient = createMockClient("https://telegra.ph/test-2");
    pool.addKey(floodClient, 1);
    pool.addKey(goodClient, 2);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
      getByUser: vi.fn().mockReturnValue([]),
      deleteByPath: vi.fn(),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, {} as any, { authorName: "test", timeoutMs: 3000, maxChars: 25000 });
    const result = await mkc.publish({ title: "Test", body: "Hello" });
    expect(result).toBe("https://telegra.ph/test-2");
    // Should have bound to key #2
    expect(bindingsRepo.insert).toHaveBeenCalledWith(expect.objectContaining({ keyId: 2 }));
  });

  it("should return null when all keys are flooded", async () => {
    const pool = new TelegraphKeyPool();
    const flood1 = createMockClient(null, true);
    const flood2 = createMockClient(null, true);
    pool.addKey(flood1, 1);
    pool.addKey(flood2, 2);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue(undefined),
      getByUser: vi.fn().mockReturnValue([]),
      deleteByPath: vi.fn(),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, {} as any, { authorName: "test", timeoutMs: 3000, maxChars: 25000 });
    const result = await mkc.publish({ title: "Test", body: "Hello" });
    expect(result).toBeNull();
  });

  it("should edit a page using the same key that created it", async () => {
    const pool = new TelegraphKeyPool();
    const client1 = createMockClient("https://telegra.ph/test-1");
    const client2 = createMockClient("https://telegra.ph/test-2");
    pool.addKey(client1, 1);
    pool.addKey(client2, 2);

    const bindingsRepo = {
      insert: vi.fn(),
      getByPath: vi.fn().mockReturnValue({ keyId: 1, userId: 1 }),
      getByUser: vi.fn().mockReturnValue([]),
      deleteByPath: vi.fn(),
    };

    const mkc = new MultiKeyClient(pool, bindingsRepo as any, {} as any, { authorName: "test", timeoutMs: 3000, maxChars: 25000 });
    const result = await mkc.editPage("test-1", "Updated", "New body");
    expect(result).toBe(true);
    expect(client1.editPage).toHaveBeenCalledWith("test-1", "Updated", "New body");
    expect(client2.editPage).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest tests/telegraph/multi-key-client.test.ts`
Expected: FAIL (module not found)

- [ ] **Step 3: Write minimal implementation**

```typescript
// src/telegraph/multi-key-client.ts
import { logger } from "../utils/logger.js";
import { TelegraphKeyPool } from "./key-pool.js";
import { TelegraphClient, FloodWaitError, type CreatePageResult } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

export class MultiKeyClient implements TechnicalDetailsPublisher {
  constructor(
    private pool: TelegraphKeyPool,
    private bindingsRepo: {
      insert(params: { userId: number; path: string; keyId: number }): void;
      getByPath(path: string): { keyId: number; userId: number } | undefined;
    },
    private keysRepo: {
      getAllByUser(userId: number): Array<{ id: number; token_encrypted: string }>;
    },
    private config: { authorName: string; timeoutMs: number; maxChars: number },
    private userId = 0,
  ) {}

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    const safeTitle = request.title.length > 256 ? `${request.title.slice(0, 253)}...` : request.title;
    const result = await this.createPage(safeTitle, request.body);
    return result?.url ?? null;
  }

  async createPage(title: string, body: string): Promise<CreatePageResult | null> {
    const tryCount = this.pool.size || 1;

    for (let attempt = 0; attempt < tryCount; attempt++) {
      const entry = this.pool.selectKey();
      if (!entry) {
        logger.warn("[MultiKey] No available key in pool");
        return null;
      }

      try {
        const result = await entry.client.createPage(title, body);
        if (result) {
          this.bindingsRepo.insert({
            userId: this.userId,
            path: result.path,
            keyId: entry.keyId,
          });
          this.pool.markSuccess(entry.keyId);
          return result;
        }

        this.pool.markFailure(entry.keyId);
      } catch (error) {
        if (error instanceof FloodWaitError) {
          logger.warn(`[MultiKey] FloodWait on key ${entry.keyId}, trying next`);
          this.pool.markFloodWait(entry.keyId, error.waitMs);
          continue;
        }
        this.pool.markFailure(entry.keyId);
        logger.warn("[MultiKey] createPage error", { error });
      }
    }

    return null;
  }

  async editPage(path: string, title: string, body: string): Promise<boolean> {
    const binding = this.bindingsRepo.getByPath(path);
    if (!binding) {
      logger.warn(`[MultiKey] No binding for path ${path}, creating new page`);
      const result = await this.createPage(title, body);
      return result !== null;
    }

    const client = this.pool.getClient(binding.keyId);
    if (!client) {
      logger.warn(`[MultiKey] Key ${binding.keyId} not in pool for path ${path}, creating new page`);
      const result = await this.createPage(title, body);
      return result !== null;
    }

    try {
      const success = await client.editPage(path, title, body);
      if (success) {
        this.pool.markSuccess(binding.keyId);
      }
      return success;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        logger.warn(`[MultiKey] FloodWait on edit for key ${binding.keyId}, retrying once`);
        this.pool.markFloodWait(binding.keyId, error.waitMs);
        await new Promise(resolve => setTimeout(resolve, error.waitMs));
        try {
          const success = await client.editPage(path, title, body);
          if (success) this.pool.markSuccess(binding.keyId);
          return success;
        } catch (retryError) {
          logger.warn("[MultiKey] editPage retry failed", { error: retryError });
          return false;
        }
      }
      this.pool.markFailure(binding.keyId);
      logger.warn("[MultiKey] editPage error", { error });
      return false;
    }
  }

  async flush(): Promise<void> {}
  reset(): void {}
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest tests/telegraph/multi-key-client.test.ts`
Expected: PASS (4 tests)

---

### Task 7: Config and wiring

**Files:**
- Modify: `src/telegraph/types.ts`
- Modify: `src/config.ts`
- Modify: `src/bot/index.ts`
- Modify: `.env.example`

- [ ] **Step 1: Update `src/telegraph/types.ts`**

Add `maxKeysPerUser` to `TelegraphConfig`:
```typescript
export interface TelegraphConfig {
  enabled: boolean;
  accessToken: string;
  authorName: string;
  timeoutMs: number;
  maxChars: number;
  translateEnabled: boolean;
  translateApiUrl?: string;
  maxKeysPerUser: number;            // NEW
  tokenEncryptionKey?: string;       // NEW
}
```

- [ ] **Step 2: Add env vars to `src/config.ts`**

Add inside the `telegraph` config block (after line 262):
```typescript
maxKeysPerUser: getOptionalPositiveIntEnvVar("TELEGRAPH_MAX_KEYS_PER_USER", 5),
tokenEncryptionKey: getEnvVar("TELEGRAPH_TOKEN_ENCRYPTION_KEY", false),
```

- [ ] **Step 3: Wire up in `src/bot/index.ts`**

Change the module-level telegraph client creation.

Current (lines 1435-1446):
```typescript
const telegraphClient = config.telegraph?.enabled
  ? new TelegraphClient(config.telegraph)
  : null;
const technicalDetailsPublisher = telegraphClient
  ? new TelegraphPublishQueue(telegraphClient)
  : new NoopDetailsPublisher();
const thinkingDetailsPublisher = telegraphClient
  ? new ThinkingTelegraphAccumulator(telegraphClient)
  : new NoopDetailsPublisher();
const subagentTelegraphLogger = telegraphClient
  ? new SubagentTelegraphLogger(telegraphClient)
  : null;
```

New — add imports:
```typescript
import { getTelegraphKeysRepo, getArticleBindingsRepo } from "../settings/manager.js";
import { MultiKeyClient } from "../telegraph/multi-key-client.js";
import { ensureUserKeys } from "../telegraph/auto-register.js";
import { decryptToken } from "../telegraph/token-encryption.js";
import { TelegraphKeyPool } from "../telegraph/key-pool.js";
```

Replace the telegraph client creation block with:
```typescript
const telegraphClient: MultiKeyClient | null = (() => {
  if (!config.telegraph?.enabled) return null;

  const keysRepo = getTelegraphKeysRepo();
  const bindingsRepo = getArticleBindingsRepo();
  const userId = config.telegram.adminUserId;
  const encryptionKeySource = config.telegraph.tokenEncryptionKey
    ? Buffer.from(config.telegraph.tokenEncryptionKey, "hex")
    : Buffer.from(config.telegram.adminUserId.toString(16).padStart(64, "0").slice(0, 32), "utf8");

  // Auto-register keys if needed
  void ensureUserKeys(keysRepo, userId, config.telegraph, encryptionKeySource, config.telegraph.maxKeysPerUser);

  const pool = new TelegraphKeyPool();
  const keys = keysRepo.getAllByUser(userId);
  for (const key of keys) {
    try {
      const token = decryptToken(key.token_encrypted, encryptionKeySource);
      const client = new TelegraphClient({
        enabled: true,
        accessToken: token,
        authorName: config.telegraph.authorName,
        timeoutMs: config.telegraph.timeoutMs,
        maxChars: config.telegraph.maxChars,
        translateEnabled: config.telegraph.translateEnabled,
        translateApiUrl: config.telegraph.translateApiUrl,
        maxKeysPerUser: config.telegraph.maxKeysPerUser,
      });
      pool.addKey(client, key.id);
    } catch (error) {
      logger.warn("[Bot] Failed to decrypt Telegraph key, skipping", { keyId: key.id, error });
    }
  }

  if (pool.size === 0) {
    // Fallback: use single token from .env if available
    if (config.telegraph.accessToken) {
      const fallbackClient = new TelegraphClient(config.telegraph as any);
      pool.addKey(fallbackClient, 0);
    } else {
      logger.warn("[Bot] No Telegraph keys available");
      return null;
    }
  }

  return new MultiKeyClient(pool, bindingsRepo, keysRepo, config.telegraph, userId);
})();
```

Keep the rest (`technicalDetailsPublisher`, `thinkingDetailsPublisher`, `subagentTelegraphLogger`) unchanged — they already use `telegraphClient`.

- [ ] **Step 4: Update `.env.example`**

Add:
```env
# Telegraph Multi-Key Configuration
# Auto-registers up to N Telegraph accounts per user for round-robin publishing
# TELEGRAPH_MAX_KEYS_PER_USER=5
# TELEGRAPH_TOKEN_ENCRYPTION_KEY=<32-byte hex key, auto-generated if omitted>
```

---

### Task 8: Verify existing tests still pass

- [ ] **Step 1: Run full test suite**

Run: `npm test`
Expected: All existing tests pass (no regressions)

- [ ] **Step 2: Run build**

Run: `npm run build`
Expected: No TypeScript errors
