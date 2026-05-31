# Settings JSON to SQLite Refactoring — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `settings.json` file storage with SQLite (better-sqlite3), keeping public API unchanged for all ~45 callers.

**Architecture:** DDD — value objects (`ProjectInfo`, `SessionInfo`, `ModelInfo`) stored as JSON columns in bounded-context tables. Repositories encapsulate SQL. Manager.ts refactored to call repositories instead of reading/writing JSON.

**Tech Stack:** TypeScript 5.x, Node 20+, better-sqlite3 12.x, Vitest, ESM

**TDD:** Every phase is RED (write failing test) → GREEN (minimal impl) → REFACTOR → commit.

---

## File Structure

```
src/settings/
  db.ts                                    — NEW: open/close SQLite, WAL pragmas, DDL
  migrate.ts                               — NEW: one-time settings.json → SQLite migration
  repositories/
    types.ts                               — NEW: DB row interfaces, JSON helper types
    user-preferences.ts                    — NEW: UserPreferencesRepository
    conversation-bindings.ts               — NEW: ConversationBindingsRepository
    access-control.ts                      — NEW: AccessControlRepository
    scheduling.ts                          — NEW: SchedulingRepository
    runtime.ts                             — NEW: RuntimeRepository
    session-attachments.ts                 — NEW: SessionAttachmentsRepository
    context-bindings.ts                    — NEW: ContextBindingsRepository
  manager.ts                               — REFACTOR: ~1334 → ~400 lines

src/app/start-bot-app.ts                   — MODIFY: loadSettings → openDatabase + migrateIfNeeded
src/runtime/paths.ts                       — MODIFY: add dbFilePath

tests/settings/
  repositories/
    user-preferences.test.ts               — NEW
    conversation-bindings.test.ts          — NEW
    access-control.test.ts                 — NEW
    scheduling.test.ts                     — NEW
    runtime.test.ts                        — NEW
    session-attachments.test.ts            — NEW
    context-bindings.test.ts               — NEW
  migrate.test.ts                          — NEW
  db.test.ts                               — NEW
  manager.test.ts                          — REFACTOR: adapt to mock repositories
```

---

## Task 1: Install and verify better-sqlite3

**Files:**
- None to create or modify (already in package.json)

- [ ] **Step 1: Verify better-sqlite3 is installed and builds**

```bash
npm ls better-sqlite3
```

Expected: shows version ^12.6.2. If missing:
```bash
npm install
```

- [ ] **Step 2: Verify imports work**

```bash
node -e "const Database = require('better-sqlite3'); const db = new Database(':memory:'); console.log('OK'); db.close();"
```

Expected: `OK` printed, no errors.

- [ ] **Step 3: Commit** (skip — deps already present)

---

## Task 2: Create repository types

**Files:**
- Create: `src/settings/repositories/types.ts`

- [ ] **Step 1: Write the file**

```typescript
export interface UserPreferencesRow {
  user_id: number;
  tts_enabled: number;
  message_streaming_enabled: number;
  thinking_clear_mode: number;
  locale: string | null;
  hide_thinking_messages: number;
  hide_tool_call_messages: number;
  hide_tool_file_messages: number;
  telegraph_translate_enabled: number;
  subagent_topics_enabled: number;
  subagent_topic_auto_delete_minutes: number;
  default_project: string | null;
  default_agent: string | null;
  default_model: string | null;
}

export interface ConversationBindingsRow {
  scope_key: string;
  project: string | null;
  session: string | null;
  agent: string | null;
  model: string | null;
  pinned_message_id: number | null;
  reasoning_mode: number | null;
}

export interface ApprovedUserRow {
  user_id: number;
}

export interface AccessRequestRow {
  id: number;
  user_id: number;
  first_name: string | null;
  last_name: string | null;
  username: string | null;
  requested_at: string;
}

export interface ScheduledTaskRow {
  id: number;
  name: string;
  cron: string;
  prompt: string;
  enabled: number;
  topic_id: number | null;
  project: string | null;
}

export interface ScheduledTaskIgnoreRow {
  id: number;
  task_name: string;
  session_id: string;
  ignore_until: string;
}

export interface ServerProcessRow {
  key: string;
  data: string | null;
}

export interface TenantRuntimeRow {
  user_id: number;
  opencode_url: string | null;
  opencode_token: string | null;
  git_name: string | null;
  git_email: string | null;
  project_path: string | null;
  extra: string | null;
}

export interface AttachedSessionRow {
  scope_key: string;
  session: string | null;
}

export interface SessionDirectoryCacheRow {
  scope_key: string;
  directory: string;
}

export interface ThreadContextBindingRow {
  id: number;
  context_key: string;
  project: string | null;
  session: string | null;
  agent: string | null;
  model: string | null;
}

export interface LastRestartRequestRow {
  key: string;
  data: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings/repositories/types.ts
git commit -m "feat: add repository DB row types"
```

---

## Task 3: Implement db.ts (SQLite init, WAL, DDL)

**Files:**
- Create: `src/settings/db.ts`

- [ ] **Step 1: Write the DDL constant and open/close functions**

```typescript
import Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

const DDL = `
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                           INTEGER PRIMARY KEY,
    tts_enabled                       INTEGER NOT NULL DEFAULT 0,
    message_streaming_enabled         INTEGER NOT NULL DEFAULT 1,
    thinking_clear_mode               INTEGER NOT NULL DEFAULT 0,
    locale                            TEXT,
    hide_thinking_messages            INTEGER NOT NULL DEFAULT 0,
    hide_tool_call_messages           INTEGER NOT NULL DEFAULT 0,
    hide_tool_file_messages           INTEGER NOT NULL DEFAULT 0,
    telegraph_translate_enabled       INTEGER NOT NULL DEFAULT 0,
    subagent_topics_enabled           INTEGER NOT NULL DEFAULT 0,
    subagent_topic_auto_delete_minutes INTEGER NOT NULL DEFAULT 1,
    default_project                   TEXT,
    default_agent                     TEXT,
    default_model                     TEXT
);

CREATE TABLE IF NOT EXISTS conversation_bindings (
    scope_key          TEXT PRIMARY KEY,
    project            TEXT,
    session            TEXT,
    agent              TEXT,
    model              TEXT,
    pinned_message_id  INTEGER,
    reasoning_mode     INTEGER
);

CREATE TABLE IF NOT EXISTS approved_users (
    user_id INTEGER PRIMARY KEY
);

CREATE TABLE IF NOT EXISTS access_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    first_name   TEXT,
    last_name    TEXT,
    username     TEXT,
    requested_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_access_requests_user ON access_requests(user_id);

CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    cron     TEXT NOT NULL,
    prompt   TEXT NOT NULL,
    enabled  INTEGER NOT NULL DEFAULT 1,
    topic_id INTEGER,
    project  TEXT
);

CREATE TABLE IF NOT EXISTS scheduled_task_ignores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name    TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    ignore_until TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scheduled_task_ignores_task ON scheduled_task_ignores(task_name);

CREATE TABLE IF NOT EXISTS server_process (
    key  TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT
);

CREATE TABLE IF NOT EXISTS last_restart_request (
    key  TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tenant_runtimes (
    user_id        INTEGER PRIMARY KEY,
    opencode_url   TEXT,
    opencode_token TEXT,
    git_name       TEXT,
    git_email      TEXT,
    project_path   TEXT,
    extra          TEXT
);

CREATE TABLE IF NOT EXISTS attached_sessions (
    scope_key TEXT PRIMARY KEY,
    session   TEXT
);

CREATE TABLE IF NOT EXISTS session_directory_cache (
    scope_key TEXT PRIMARY KEY,
    directory TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS thread_context_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    context_key TEXT NOT NULL,
    project     TEXT,
    session     TEXT,
    agent       TEXT,
    model       TEXT
);
CREATE INDEX IF NOT EXISTS idx_thread_context_bindings_key ON thread_context_bindings(context_key);
`;

export function openDatabase(filePath: string): Database.Database {
  logger.info("[DB] Opening database", { path: filePath });
  const db = new Database(filePath);

  db.pragma("journal_mode = WAL");
  db.pragma("busy_timeout = 5000");
  db.pragma("foreign_keys = ON");

  db.exec(DDL);

  logger.info("[DB] Database opened and tables ensured");
  return db;
}

export function closeDatabase(db: Database.Database): void {
  logger.info("[DB] Closing database");
  db.close();
}
```

- [ ] **Step 2: Commit**

```bash
git add src/settings/db.ts
git commit -m "feat: add SQLite database initialization with DDL"
```

---

## Task 4: Implement repositories — UserPreferences

**Files:**
- Create: `src/settings/repositories/user-preferences.ts`
- Create: `tests/settings/repositories/user-preferences.test.ts`

### Phase 4A: RED — Write tests

- [ ] **Step 4A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createUserPreferencesRepository } from "../../../src/settings/repositories/user-preferences.js";

const DDL = `
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id                           INTEGER PRIMARY KEY,
    tts_enabled                       INTEGER NOT NULL DEFAULT 0,
    message_streaming_enabled         INTEGER NOT NULL DEFAULT 1,
    thinking_clear_mode               INTEGER NOT NULL DEFAULT 0,
    locale                            TEXT,
    hide_thinking_messages            INTEGER NOT NULL DEFAULT 0,
    hide_tool_call_messages           INTEGER NOT NULL DEFAULT 0,
    hide_tool_file_messages           INTEGER NOT NULL DEFAULT 0,
    telegraph_translate_enabled       INTEGER NOT NULL DEFAULT 0,
    subagent_topics_enabled           INTEGER NOT NULL DEFAULT 0,
    subagent_topic_auto_delete_minutes INTEGER NOT NULL DEFAULT 1,
    default_project                   TEXT,
    default_agent                     TEXT,
    default_model                     TEXT
);
`;

describe("UserPreferencesRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("returns undefined for non-existent user", () => {
    const repo = createUserPreferencesRepository(db);
    expect(repo.get(999)).toBeUndefined();
  });

  it("creates a row via upsert and retrieves it", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru", tts_enabled: 1 });
    const row = repo.get(1);
    expect(row).toBeDefined();
    expect(row!.locale).toBe("ru");
    expect(row!.tts_enabled).toBe(1);
  });

  it("updates an existing row via upsert", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "en" });
    repo.upsert(1, { locale: "ru", tts_enabled: 1 });
    const row = repo.get(1);
    expect(row!.locale).toBe("ru");
    expect(row!.tts_enabled).toBe(1);
  });

  it("preserves untouched fields on upsert", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru", tts_enabled: 1 });
    repo.upsert(1, { locale: "en" });
    const row = repo.get(1);
    expect(row!.locale).toBe("en");
    expect(row!.tts_enabled).toBe(1);
  });

  it("stores and retrieves JSON value-object (default_project)", () => {
    const repo = createUserPreferencesRepository(db);
    const project = { id: "proj-1", worktree: "/tmp/repo", name: "Test" };
    repo.upsert(1, { default_project: JSON.stringify(project) });
    const row = repo.get(1);
    expect(JSON.parse(row!.default_project!)).toEqual(project);
  });

  it("stores and retrieves JSON value-object (default_model)", () => {
    const repo = createUserPreferencesRepository(db);
    const model = { providerID: "openai", modelID: "gpt-5", variant: "high" };
    repo.upsert(1, { default_model: JSON.stringify(model) });
    const row = repo.get(1);
    expect(JSON.parse(row!.default_model!)).toEqual(model);
  });

  it("uses default values (0/1/empty) for new row fields not explicitly set", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(42, {});
    const row = repo.get(42);
    expect(row).toBeDefined();
    expect(row!.tts_enabled).toBe(0);
    expect(row!.message_streaming_enabled).toBe(1);
  });

  it("returns all users", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru" });
    repo.upsert(2, { locale: "en" });
    const all = repo.getAll();
    expect(all).toHaveLength(2);
  });

  it("deletes a user preferences row", () => {
    const repo = createUserPreferencesRepository(db);
    repo.upsert(1, { locale: "ru" });
    repo.delete(1);
    expect(repo.get(1)).toBeUndefined();
  });
});
```

- [ ] **Step 4A.2: Run tests — verify they FAIL**

```bash
npx vitest run tests/settings/repositories/user-preferences.test.ts
```

Expected: FAIL — `createUserPreferencesRepository` not found.

### Phase 4B: GREEN — Implement

- [ ] **Step 4B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { UserPreferencesRow } from "./types.js";

export interface UserPreferencesRepository {
  get(userId: number): UserPreferencesRow | undefined;
  getAll(): UserPreferencesRow[];
  upsert(userId: number, fields: Partial<UserPreferencesRow>): void;
  delete(userId: number): void;
}

export function createUserPreferencesRepository(
  db: Database.Database,
): UserPreferencesRepository {
  const getStmt = db.prepare("SELECT * FROM user_preferences WHERE user_id = ?");
  const getAllStmt = db.prepare("SELECT * FROM user_preferences");
  const deleteStmt = db.prepare("DELETE FROM user_preferences WHERE user_id = ?");

  return {
    get(userId: number): UserPreferencesRow | undefined {
      return getStmt.get(userId) as UserPreferencesRow | undefined;
    },

    getAll(): UserPreferencesRow[] {
      return getAllStmt.all() as UserPreferencesRow[];
    },

    upsert(userId: number, fields: Partial<UserPreferencesRow>): void {
      const existing = getStmt.get(userId) as UserPreferencesRow | undefined;
      if (existing) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(fields)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        values.push(userId);
        db.prepare(`UPDATE user_preferences SET ${setClauses.join(", ")} WHERE user_id = ?`).run(
          ...values,
        );
      } else {
        const columns = ["user_id", ...Object.keys(fields)];
        const placeholders = columns.map(() => "?").join(", ");
        const values = [userId, ...Object.values(fields)];
        db.prepare(`INSERT INTO user_preferences (${columns.join(", ")}) VALUES (${placeholders})`).run(
          ...values,
        );
      }
    },

    delete(userId: number): void {
      deleteStmt.run(userId);
    },
  };
}
```

- [ ] **Step 4B.2: Run tests — verify they PASS**

```bash
npx vitest run tests/settings/repositories/user-preferences.test.ts
```

Expected: all 8 tests PASS.

### Phase 4C: Commit

```bash
git add src/settings/repositories/user-preferences.ts tests/settings/repositories/user-preferences.test.ts
git commit -m "feat: add UserPreferencesRepository with tests"
```

---

## Task 5: Implement repositories — ConversationBindings

**Files:**
- Create: `src/settings/repositories/conversation-bindings.ts`
- Create: `tests/settings/repositories/conversation-bindings.test.ts`

### Phase 5A: RED — Write tests

- [ ] **Step 5A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createConversationBindingsRepository } from "../../../src/settings/repositories/conversation-bindings.js";

const DDL = `
CREATE TABLE IF NOT EXISTS conversation_bindings (
    scope_key          TEXT PRIMARY KEY,
    project            TEXT,
    session            TEXT,
    agent              TEXT,
    model              TEXT,
    pinned_message_id  INTEGER,
    reasoning_mode     INTEGER
);
`;

describe("ConversationBindingsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("returns undefined for non-existent scope key", () => {
    const repo = createConversationBindingsRepository(db);
    expect(repo.get("1:2:3")).toBeUndefined();
  });

  it("upserts and retrieves a binding", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { agent: "build", reasoning_mode: 2 });
    const row = repo.get("1:2:3");
    expect(row).toBeDefined();
    expect(row!.agent).toBe("build");
    expect(row!.reasoning_mode).toBe(2);
  });

  it("stores and retrieves JSON value-objects", () => {
    const repo = createConversationBindingsRepository(db);
    const project = JSON.stringify({ id: "p1", worktree: "/tmp" });
    const session = JSON.stringify({ id: "s1", title: "Test", directory: "/tmp" });
    const model = JSON.stringify({ providerID: "openai", modelID: "gpt-5", variant: "high" });
    repo.upsert("1:2:3", { project, session, model, agent: "plan" });
    const row = repo.get("1:2:3");
    expect(JSON.parse(row!.project!)).toEqual({ id: "p1", worktree: "/tmp" });
    expect(JSON.parse(row!.session!)).toEqual({ id: "s1", title: "Test", directory: "/tmp" });
    expect(JSON.parse(row!.model!)).toEqual({ providerID: "openai", modelID: "gpt-5", variant: "high" });
    expect(row!.agent).toBe("plan");
  });

  it("clears individual fields to null", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { agent: "build", project: JSON.stringify({ id: "p1", worktree: "/tmp" }) });
    repo.upsert("1:2:3", { agent: null });
    const row = repo.get("1:2:3");
    expect(row!.agent).toBeNull();
    expect(row!.project).not.toBeNull();
  });

  it("deletes a binding", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { agent: "build" });
    repo.delete("1:2:3");
    expect(repo.get("1:2:3")).toBeUndefined();
  });

  it("pinned_message_id and reasoning_mode accept null", () => {
    const repo = createConversationBindingsRepository(db);
    repo.upsert("1:2:3", { pinned_message_id: 42 });
    repo.upsert("1:2:3", { pinned_message_id: null });
    expect(repo.get("1:2:3")!.pinned_message_id).toBeNull();
  });
});
```

- [ ] **Step 5A.2: Run — verify FAIL**

```bash
npx vitest run tests/settings/repositories/conversation-bindings.test.ts
```

Expected: FAIL.

### Phase 5B: GREEN — Implement

- [ ] **Step 5B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { ConversationBindingsRow } from "./types.js";

export interface ConversationBindingsRepository {
  get(scopeKey: string): ConversationBindingsRow | undefined;
  upsert(scopeKey: string, fields: Partial<Omit<ConversationBindingsRow, "scope_key">>): void;
  delete(scopeKey: string): void;
}

export function createConversationBindingsRepository(
  db: Database.Database,
): ConversationBindingsRepository {
  const getStmt = db.prepare("SELECT * FROM conversation_bindings WHERE scope_key = ?");
  const deleteStmt = db.prepare("DELETE FROM conversation_bindings WHERE scope_key = ?");

  return {
    get(scopeKey: string): ConversationBindingsRow | undefined {
      return getStmt.get(scopeKey) as ConversationBindingsRow | undefined;
    },

    upsert(
      scopeKey: string,
      fields: Partial<Omit<ConversationBindingsRow, "scope_key">>,
    ): void {
      const existing = getStmt.get(scopeKey) as ConversationBindingsRow | undefined;
      if (existing) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(fields)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        values.push(scopeKey);
        db.prepare(
          `UPDATE conversation_bindings SET ${setClauses.join(", ")} WHERE scope_key = ?`,
        ).run(...values);
      } else {
        const allFields: Record<string, unknown> = { scope_key: scopeKey, ...fields };
        const columns = Object.keys(allFields).join(", ");
        const placeholders = Object.keys(allFields).map(() => "?").join(", ");
        db.prepare(
          `INSERT INTO conversation_bindings (${columns}) VALUES (${placeholders})`,
        ).run(...Object.values(allFields));
      }
    },

    delete(scopeKey: string): void {
      deleteStmt.run(scopeKey);
    },
  };
}
```

- [ ] **Step 5B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/repositories/conversation-bindings.test.ts
```

### Phase 5C: Commit

```bash
git add src/settings/repositories/conversation-bindings.ts tests/settings/repositories/conversation-bindings.test.ts
git commit -m "feat: add ConversationBindingsRepository with tests"
```

---

## Task 6: Implement repositories — AccessControl

**Files:**
- Create: `src/settings/repositories/access-control.ts`
- Create: `tests/settings/repositories/access-control.test.ts`

### Phase 6A: RED — Write tests

- [ ] **Step 6A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccessControlRepository } from "../../../src/settings/repositories/access-control.js";

const DDL = `
CREATE TABLE IF NOT EXISTS approved_users (
    user_id INTEGER PRIMARY KEY
);
CREATE TABLE IF NOT EXISTS access_requests (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id      INTEGER NOT NULL,
    first_name   TEXT,
    last_name    TEXT,
    username     TEXT,
    requested_at TEXT NOT NULL
);
`;

describe("AccessControlRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  describe("approved_users", () => {
    it("adds approved user", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123);
      expect(repo.getApprovedUserIds()).toEqual([123]);
    });

    it("removes approved user", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123);
      repo.addApprovedUser(456);
      repo.removeApprovedUser(123);
      expect(repo.getApprovedUserIds()).toEqual([456]);
    });

    it("isApproved returns true for approved user", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123);
      expect(repo.isApproved(123)).toBe(true);
      expect(repo.isApproved(999)).toBe(false);
    });

    it("sets all approved users at once", () => {
      const repo = createAccessControlRepository(db);
      repo.setApprovedUserIds([111, 222, 333]);
      expect(repo.getApprovedUserIds()).toEqual([111, 222, 333]);
    });

    it("adding duplicate user does not cause error", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123);
      repo.addApprovedUser(123);
      expect(repo.getApprovedUserIds()).toEqual([123]);
    });
  });

  describe("access_requests", () => {
    it("adds and retrieves access requests", () => {
      const repo = createAccessControlRepository(db);
      repo.addAccessRequest({
        user_id: 123,
        first_name: "John",
        last_name: null,
        username: "johnny",
        requested_at: "2026-05-31T00:00:00Z",
      });
      const requests = repo.getAccessRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].user_id).toBe(123);
      expect(requests[0].first_name).toBe("John");
    });

    it("sets all access requests at once", () => {
      const repo = createAccessControlRepository(db);
      repo.setAccessRequests([
        {
          id: 1,
          user_id: 123,
          first_name: "A",
          last_name: null,
          username: null,
          requested_at: "2026-01-01T00:00:00Z",
        },
        {
          id: 2,
          user_id: 456,
          first_name: "B",
          last_name: null,
          username: null,
          requested_at: "2026-01-02T00:00:00Z",
        },
      ]);
      expect(repo.getAccessRequests()).toHaveLength(2);
    });

    it("deletes all access requests", () => {
      const repo = createAccessControlRepository(db);
      repo.addAccessRequest({
        user_id: 123,
        first_name: "X",
        last_name: null,
        username: null,
        requested_at: "2026-01-01T00:00:00Z",
      });
      repo.deleteAllAccessRequests();
      expect(repo.getAccessRequests()).toHaveLength(0);
    });
  });
});
```

- [ ] **Step 6A.2: Run — verify FAIL**

```bash
npx vitest run tests/settings/repositories/access-control.test.ts
```

### Phase 6B: GREEN — Implement

- [ ] **Step 6B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { ApprovedUserRow, AccessRequestRow } from "./types.js";

export interface AccessControlRepository {
  getApprovedUserIds(): number[];
  addApprovedUser(userId: number): void;
  removeApprovedUser(userId: number): void;
  isApproved(userId: number): boolean;
  setApprovedUserIds(userIds: number[]): void;
  getAccessRequests(): AccessRequestRow[];
  addAccessRequest(request: Omit<AccessRequestRow, "id">): void;
  setAccessRequests(requests: AccessRequestRow[]): void;
  deleteAllAccessRequests(): void;
}

export function createAccessControlRepository(db: Database.Database): AccessControlRepository {
  const getAllApprovedStmt = db.prepare("SELECT user_id FROM approved_users");
  const addApprovedStmt = db.prepare("INSERT OR IGNORE INTO approved_users (user_id) VALUES (?)");
  const removeApprovedStmt = db.prepare("DELETE FROM approved_users WHERE user_id = ?");
  const isApprovedStmt = db.prepare("SELECT 1 FROM approved_users WHERE user_id = ?");
  const deleteAllApprovedStmt = db.prepare("DELETE FROM approved_users");
  const getAllRequestsStmt = db.prepare("SELECT * FROM access_requests");
  const deleteAllRequestsStmt = db.prepare("DELETE FROM access_requests");

  return {
    getApprovedUserIds(): number[] {
      return (getAllApprovedStmt.all() as Pick<ApprovedUserRow, "user_id">[]).map((r) => r.user_id);
    },

    addApprovedUser(userId: number): void {
      addApprovedStmt.run(userId);
    },

    removeApprovedUser(userId: number): void {
      removeApprovedStmt.run(userId);
    },

    isApproved(userId: number): boolean {
      return isApprovedStmt.get(userId) !== undefined;
    },

    setApprovedUserIds(userIds: number[]): void {
      const runInTransaction = db.transaction((ids: number[]) => {
        deleteAllApprovedStmt.run();
        for (const id of ids) {
          addApprovedStmt.run(id);
        }
      });
      runInTransaction(userIds);
    },

    getAccessRequests(): AccessRequestRow[] {
      return getAllRequestsStmt.all() as AccessRequestRow[];
    },

    addAccessRequest(request: Omit<AccessRequestRow, "id">): void {
      db.prepare(
        "INSERT INTO access_requests (user_id, first_name, last_name, username, requested_at) VALUES (?, ?, ?, ?, ?)",
      ).run(request.user_id, request.first_name, request.last_name, request.username, request.requested_at);
    },

    setAccessRequests(requests: AccessRequestRow[]): void {
      const runInTransaction = db.transaction((reqs: AccessRequestRow[]) => {
        deleteAllRequestsStmt.run();
        const insertStmt = db.prepare(
          "INSERT INTO access_requests (id, user_id, first_name, last_name, username, requested_at) VALUES (?, ?, ?, ?, ?, ?)",
        );
        for (const r of reqs) {
          insertStmt.run(r.id, r.user_id, r.first_name, r.last_name, r.username, r.requested_at);
        }
      });
      runInTransaction(requests);
    },

    deleteAllAccessRequests(): void {
      deleteAllRequestsStmt.run();
    },
  };
}
```

- [ ] **Step 6B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/repositories/access-control.test.ts
```

### Phase 6C: Commit

```bash
git add src/settings/repositories/access-control.ts tests/settings/repositories/access-control.test.ts
git commit -m "feat: add AccessControlRepository with tests"
```

---

## Task 7: Implement repositories — Scheduling

**Files:**
- Create: `src/settings/repositories/scheduling.ts`
- Create: `tests/settings/repositories/scheduling.test.ts`

### Phase 7A: RED — Write tests

- [ ] **Step 7A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSchedulingRepository } from "../../../src/settings/repositories/scheduling.js";

const DDL = `
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id       INTEGER PRIMARY KEY AUTOINCREMENT,
    name     TEXT NOT NULL,
    cron     TEXT NOT NULL,
    prompt   TEXT NOT NULL,
    enabled  INTEGER NOT NULL DEFAULT 1,
    topic_id INTEGER,
    project  TEXT
);
CREATE TABLE IF NOT EXISTS scheduled_task_ignores (
    id           INTEGER PRIMARY KEY AUTOINCREMENT,
    task_name    TEXT NOT NULL,
    session_id   TEXT NOT NULL,
    ignore_until TEXT NOT NULL
);
`;

describe("SchedulingRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  describe("scheduled_tasks", () => {
    it("returns empty array when no tasks", () => {
      const repo = createSchedulingRepository(db);
      expect(repo.getScheduledTasks()).toEqual([]);
    });

    it("sets and retrieves tasks", () => {
      const repo = createSchedulingRepository(db);
      const tasks = [
        {
          id: 1,
          name: "daily-review",
          cron: "0 9 * * *",
          prompt: "Review PRs",
          enabled: 1,
          topic_id: null,
          project: null,
        },
        {
          id: 2,
          name: "weekly-report",
          cron: "0 10 * * 1",
          prompt: "Generate report",
          enabled: 1,
          topic_id: 100,
          project: JSON.stringify({ id: "p1", worktree: "/tmp" }),
        },
      ];
      repo.setScheduledTasks(tasks);
      const result = repo.getScheduledTasks();
      expect(result).toHaveLength(2);
      expect(result[0].name).toBe("daily-review");
      expect(result[1].topic_id).toBe(100);
    });

    it("replaces existing tasks on set", () => {
      const repo = createSchedulingRepository(db);
      repo.setScheduledTasks([
        { id: 1, name: "t1", cron: "* * * * *", prompt: "x", enabled: 1, topic_id: null, project: null },
      ]);
      repo.setScheduledTasks([
        { id: 2, name: "t2", cron: "* * * * *", prompt: "y", enabled: 1, topic_id: null, project: null },
      ]);
      expect(repo.getScheduledTasks()).toHaveLength(1);
    });
  });

  describe("scheduled_task_ignores", () => {
    it("returns empty array when no ignores", () => {
      const repo = createSchedulingRepository(db);
      expect(repo.getScheduledTaskSessionIgnores()).toEqual([]);
    });

    it("sets and retrieves ignores", () => {
      const repo = createSchedulingRepository(db);
      const ignores = [
        { id: 1, task_name: "daily-review", session_id: "s1", ignore_until: "2026-06-01T00:00:00Z" },
        { id: 2, task_name: "daily-review", session_id: "s2", ignore_until: "2026-06-02T00:00:00Z" },
      ];
      repo.setScheduledTaskSessionIgnores(ignores);
      const result = repo.getScheduledTaskSessionIgnores();
      expect(result).toHaveLength(2);
      expect(result[0].session_id).toBe("s1");
    });
  });
});
```

- [ ] **Step 7A.2: Run — verify FAIL**

```bash
npx vitest run tests/settings/repositories/scheduling.test.ts
```

### Phase 7B: GREEN — Implement

- [ ] **Step 7B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { ScheduledTaskRow, ScheduledTaskIgnoreRow } from "./types.js";

export interface SchedulingRepository {
  getScheduledTasks(): ScheduledTaskRow[];
  setScheduledTasks(tasks: ScheduledTaskRow[]): void;
  getScheduledTaskSessionIgnores(): ScheduledTaskIgnoreRow[];
  setScheduledTaskSessionIgnores(ignores: ScheduledTaskIgnoreRow[]): void;
}

export function createSchedulingRepository(db: Database.Database): SchedulingRepository {
  const getAllTasksStmt = db.prepare("SELECT * FROM scheduled_tasks");
  const deleteAllTasksStmt = db.prepare("DELETE FROM scheduled_tasks");
  const getAllIgnoresStmt = db.prepare("SELECT * FROM scheduled_task_ignores");
  const deleteAllIgnoresStmt = db.prepare("DELETE FROM scheduled_task_ignores");

  return {
    getScheduledTasks(): ScheduledTaskRow[] {
      return getAllTasksStmt.all() as ScheduledTaskRow[];
    },

    setScheduledTasks(tasks: ScheduledTaskRow[]): void {
      const runInTransaction = db.transaction((t: ScheduledTaskRow[]) => {
        deleteAllTasksStmt.run();
        const insertStmt = db.prepare(
          "INSERT INTO scheduled_tasks (id, name, cron, prompt, enabled, topic_id, project) VALUES (?, ?, ?, ?, ?, ?, ?)",
        );
        for (const task of t) {
          insertStmt.run(task.id, task.name, task.cron, task.prompt, task.enabled, task.topic_id, task.project);
        }
      });
      runInTransaction(tasks);
    },

    getScheduledTaskSessionIgnores(): ScheduledTaskIgnoreRow[] {
      return getAllIgnoresStmt.all() as ScheduledTaskIgnoreRow[];
    },

    setScheduledTaskSessionIgnores(ignores: ScheduledTaskIgnoreRow[]): void {
      const runInTransaction = db.transaction((i: ScheduledTaskIgnoreRow[]) => {
        deleteAllIgnoresStmt.run();
        const insertStmt = db.prepare(
          "INSERT INTO scheduled_task_ignores (id, task_name, session_id, ignore_until) VALUES (?, ?, ?, ?)",
        );
        for (const ignore of i) {
          insertStmt.run(ignore.id, ignore.task_name, ignore.session_id, ignore.ignore_until);
        }
      });
      runInTransaction(ignores);
    },
  };
}
```

- [ ] **Step 7B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/repositories/scheduling.test.ts
```

### Phase 7C: Commit

```bash
git add src/settings/repositories/scheduling.ts tests/settings/repositories/scheduling.test.ts
git commit -m "feat: add SchedulingRepository with tests"
```

---

## Task 8: Implement repositories — Runtime

**Files:**
- Create: `src/settings/repositories/runtime.ts`
- Create: `tests/settings/repositories/runtime.test.ts`

### Phase 8A: RED — Write tests

- [ ] **Step 8A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createRuntimeRepository } from "../../../src/settings/repositories/runtime.js";

const DDL = `
CREATE TABLE IF NOT EXISTS server_process (
    key  TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT
);
CREATE TABLE IF NOT EXISTS last_restart_request (
    key  TEXT PRIMARY KEY DEFAULT 'current',
    data TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS tenant_runtimes (
    user_id        INTEGER PRIMARY KEY,
    opencode_url   TEXT,
    opencode_token TEXT,
    git_name       TEXT,
    git_email      TEXT,
    project_path   TEXT,
    extra          TEXT
);
`;

describe("RuntimeRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  describe("server_process", () => {
    it("returns null when no server process stored", () => {
      const repo = createRuntimeRepository(db);
      expect(repo.getServerProcess()).toBeNull();
    });

    it("sets and retrieves server process", () => {
      const repo = createRuntimeRepository(db);
      repo.setServerProcess(JSON.stringify({ pid: 12345, startTime: "2026-01-01T00:00:00Z" }));
      expect(repo.getServerProcess()).toBe(JSON.stringify({ pid: 12345, startTime: "2026-01-01T00:00:00Z" }));
    });

    it("clears server process", () => {
      const repo = createRuntimeRepository(db);
      repo.setServerProcess(JSON.stringify({ pid: 12345, startTime: "2026-01-01T00:00:00Z" }));
      repo.clearServerProcess();
      expect(repo.getServerProcess()).toBeNull();
    });
  });

  describe("last_restart_request", () => {
    it("returns null when no restart request stored", () => {
      const repo = createRuntimeRepository(db);
      expect(repo.getLastRestartRequest()).toBeNull();
    });

    it("sets and retrieves last restart request", () => {
      const repo = createRuntimeRepository(db);
      const request = JSON.stringify({ updateId: 1, requestedAt: "2026-01-01T00:00:00Z" });
      repo.setLastRestartRequest(request);
      expect(repo.getLastRestartRequest()).toBe(request);
    });
  });

  describe("tenant_runtimes", () => {
    it("returns undefined for non-existent tenant", () => {
      const repo = createRuntimeRepository(db);
      expect(repo.getTenantRuntime(999)).toBeUndefined();
    });

    it("upserts and retrieves tenant runtime", () => {
      const repo = createRuntimeRepository(db);
      repo.upsertTenantRuntime(1, {
        opencode_url: "http://localhost:4096",
        opencode_token: "secret",
        git_name: null,
        git_email: null,
        project_path: "/tmp",
        extra: null,
      });
      const runtime = repo.getTenantRuntime(1);
      expect(runtime).toBeDefined();
      expect(runtime!.opencode_url).toBe("http://localhost:4096");
    });

    it("returns all tenant runtimes", () => {
      const repo = createRuntimeRepository(db);
      repo.upsertTenantRuntime(1, {
        opencode_url: "http://a",
        opencode_token: null,
        git_name: null,
        git_email: null,
        project_path: null,
        extra: null,
      });
      repo.upsertTenantRuntime(2, {
        opencode_url: "http://b",
        opencode_token: null,
        git_name: null,
        git_email: null,
        project_path: null,
        extra: null,
      });
      expect(repo.getAllTenantRuntimes()).toHaveLength(2);
    });

    it("deletes tenant runtime", () => {
      const repo = createRuntimeRepository(db);
      repo.upsertTenantRuntime(1, {
        opencode_url: "http://a",
        opencode_token: null,
        git_name: null,
        git_email: null,
        project_path: null,
        extra: null,
      });
      repo.deleteTenantRuntime(1);
      expect(repo.getTenantRuntime(1)).toBeUndefined();
    });
  });
});
```

- [ ] **Step 8A.2: Run — verify FAIL**

### Phase 8B: GREEN — Implement

- [ ] **Step 8B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { TenantRuntimeRow } from "./types.js";

export interface RuntimeRepository {
  getServerProcess(): string | null;
  setServerProcess(data: string): void;
  clearServerProcess(): void;
  getLastRestartRequest(): string | null;
  setLastRestartRequest(data: string): void;
  getTenantRuntime(userId: number): TenantRuntimeRow | undefined;
  getAllTenantRuntimes(): TenantRuntimeRow[];
  upsertTenantRuntime(userId: number, fields: Partial<Omit<TenantRuntimeRow, "user_id">>): void;
  deleteTenantRuntime(userId: number): void;
}

export function createRuntimeRepository(db: Database.Database): RuntimeRepository {
  const getServerProcessStmt = db.prepare("SELECT data FROM server_process WHERE key = 'current'");
  const setServerProcessStmt = db.prepare(
    "INSERT INTO server_process (key, data) VALUES ('current', ?) ON CONFLICT(key) DO UPDATE SET data = ?",
  );
  const clearServerProcessStmt = db.prepare("DELETE FROM server_process WHERE key = 'current'");

  const getLastRestartStmt = db.prepare("SELECT data FROM last_restart_request WHERE key = 'current'");
  const setLastRestartStmt = db.prepare(
    "INSERT INTO last_restart_request (key, data) VALUES ('current', ?) ON CONFLICT(key) DO UPDATE SET data = ?",
  );

  const getTenantStmt = db.prepare("SELECT * FROM tenant_runtimes WHERE user_id = ?");
  const getAllTenantsStmt = db.prepare("SELECT * FROM tenant_runtimes");
  const deleteTenantStmt = db.prepare("DELETE FROM tenant_runtimes WHERE user_id = ?");

  return {
    getServerProcess(): string | null {
      const row = getServerProcessStmt.get() as { data: string | null } | undefined;
      return row?.data ?? null;
    },

    setServerProcess(data: string): void {
      setServerProcessStmt.run(data, data);
    },

    clearServerProcess(): void {
      clearServerProcessStmt.run();
    },

    getLastRestartRequest(): string | null {
      const row = getLastRestartStmt.get() as { data: string | null } | undefined;
      return row?.data ?? null;
    },

    setLastRestartRequest(data: string): void {
      setLastRestartStmt.run(data, data);
    },

    getTenantRuntime(userId: number): TenantRuntimeRow | undefined {
      return getTenantStmt.get(userId) as TenantRuntimeRow | undefined;
    },

    getAllTenantRuntimes(): TenantRuntimeRow[] {
      return getAllTenantsStmt.all() as TenantRuntimeRow[];
    },

    upsertTenantRuntime(
      userId: number,
      fields: Partial<Omit<TenantRuntimeRow, "user_id">>,
    ): void {
      const existing = getTenantStmt.get(userId) as TenantRuntimeRow | undefined;
      if (existing) {
        const setClauses: string[] = [];
        const values: unknown[] = [];
        for (const [key, value] of Object.entries(fields)) {
          setClauses.push(`${key} = ?`);
          values.push(value);
        }
        values.push(userId);
        db.prepare(
          `UPDATE tenant_runtimes SET ${setClauses.join(", ")} WHERE user_id = ?`,
        ).run(...values);
      } else {
        const allFields: Record<string, unknown> = { user_id: userId, ...fields };
        const columns = Object.keys(allFields).join(", ");
        const placeholders = Object.keys(allFields).map(() => "?").join(", ");
        db.prepare(
          `INSERT INTO tenant_runtimes (${columns}) VALUES (${placeholders})`,
        ).run(...Object.values(allFields));
      }
    },

    deleteTenantRuntime(userId: number): void {
      deleteTenantStmt.run(userId);
    },
  };
}
```

- [ ] **Step 8B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/repositories/runtime.test.ts
```

### Phase 8C: Commit

```bash
git add src/settings/repositories/runtime.ts tests/settings/repositories/runtime.test.ts
git commit -m "feat: add RuntimeRepository with tests"
```

---

## Task 9: Implement repositories — SessionAttachments

**Files:**
- Create: `src/settings/repositories/session-attachments.ts`
- Create: `tests/settings/repositories/session-attachments.test.ts`

### Phase 9A: RED — Write tests

- [ ] **Step 9A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionAttachmentsRepository } from "../../../src/settings/repositories/session-attachments.js";

const DDL = `
CREATE TABLE IF NOT EXISTS attached_sessions (
    scope_key TEXT PRIMARY KEY,
    session   TEXT
);
CREATE TABLE IF NOT EXISTS session_directory_cache (
    scope_key TEXT PRIMARY KEY,
    directory TEXT NOT NULL
);
`;

describe("SessionAttachmentsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  describe("attached_sessions", () => {
    it("returns empty object when no attached sessions", () => {
      const repo = createSessionAttachmentsRepository(db);
      expect(repo.getAttachedSessions()).toEqual({});
    });

    it("sets and retrieves all attached sessions", () => {
      const repo = createSessionAttachmentsRepository(db);
      const sessions = {
        "1:2:3": { scope_key: "1:2:3", session: JSON.stringify({ id: "s1", title: "T", directory: "/tmp" }) },
        "4:5:6": { scope_key: "4:5:6", session: JSON.stringify({ id: "s2", title: "U", directory: "/tmp" }) },
      };
      repo.setAttachedSessions(sessions);
      const result = repo.getAttachedSessions();
      expect(Object.keys(result)).toHaveLength(2);
      expect(JSON.parse(result["1:2:3"].session!)).toEqual({ id: "s1", title: "T", directory: "/tmp" });
    });

    it("replaces existing attached sessions on set", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setAttachedSessions({ "1:2:3": { scope_key: "1:2:3", session: "x" } });
      repo.setAttachedSessions({ "4:5:6": { scope_key: "4:5:6", session: "y" } });
      expect(Object.keys(repo.getAttachedSessions())).toEqual(["4:5:6"]);
    });
  });

  describe("session_directory_cache", () => {
    it("returns undefined for non-existent scope", () => {
      const repo = createSessionAttachmentsRepository(db);
      expect(repo.getSessionDirectoryCache("1:2:3")).toBeUndefined();
    });

    it("sets and retrieves directory cache", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setSessionDirectoryCache("1:2:3", "/tmp/sessions");
      expect(repo.getSessionDirectoryCache("1:2:3")).toBe("/tmp/sessions");
    });

    it("updates directory cache", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setSessionDirectoryCache("1:2:3", "/old");
      repo.setSessionDirectoryCache("1:2:3", "/new");
      expect(repo.getSessionDirectoryCache("1:2:3")).toBe("/new");
    });

    it("clears directory cache", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setSessionDirectoryCache("1:2:3", "/tmp/sessions");
      repo.clearSessionDirectoryCache("1:2:3");
      expect(repo.getSessionDirectoryCache("1:2:3")).toBeUndefined();
    });
  });
});
```

- [ ] **Step 9A.2: Run — verify FAIL**

### Phase 9B: GREEN — Implement

- [ ] **Step 9B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { AttachedSessionRow } from "./types.js";

export interface SessionAttachmentsRepository {
  getAttachedSessions(): Record<string, AttachedSessionRow>;
  setAttachedSessions(sessions: Record<string, AttachedSessionRow>): void;
  getSessionDirectoryCache(scopeKey: string): string | undefined;
  setSessionDirectoryCache(scopeKey: string, directory: string): void;
  clearSessionDirectoryCache(scopeKey: string): void;
}

export function createSessionAttachmentsRepository(
  db: Database.Database,
): SessionAttachmentsRepository {
  const getAllAttachedStmt = db.prepare("SELECT * FROM attached_sessions");
  const deleteAllAttachedStmt = db.prepare("DELETE FROM attached_sessions");

  const getCacheStmt = db.prepare("SELECT directory FROM session_directory_cache WHERE scope_key = ?");
  const upsertCacheStmt = db.prepare(
    "INSERT INTO session_directory_cache (scope_key, directory) VALUES (?, ?) ON CONFLICT(scope_key) DO UPDATE SET directory = ?",
  );
  const deleteCacheStmt = db.prepare("DELETE FROM session_directory_cache WHERE scope_key = ?");

  return {
    getAttachedSessions(): Record<string, AttachedSessionRow> {
      const rows = getAllAttachedStmt.all() as AttachedSessionRow[];
      const result: Record<string, AttachedSessionRow> = {};
      for (const row of rows) {
        result[row.scope_key] = row;
      }
      return result;
    },

    setAttachedSessions(sessions: Record<string, AttachedSessionRow>): void {
      const runInTransaction = db.transaction((s: Record<string, AttachedSessionRow>) => {
        deleteAllAttachedStmt.run();
        const insertStmt = db.prepare(
          "INSERT INTO attached_sessions (scope_key, session) VALUES (?, ?)",
        );
        for (const [key, row] of Object.entries(s)) {
          insertStmt.run(key, row.session);
        }
      });
      runInTransaction(sessions);
    },

    getSessionDirectoryCache(scopeKey: string): string | undefined {
      const row = getCacheStmt.get(scopeKey) as { directory: string } | undefined;
      return row?.directory;
    },

    setSessionDirectoryCache(scopeKey: string, directory: string): void {
      upsertCacheStmt.run(scopeKey, directory, directory);
    },

    clearSessionDirectoryCache(scopeKey: string): void {
      deleteCacheStmt.run(scopeKey);
    },
  };
}
```

- [ ] **Step 9B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/repositories/session-attachments.test.ts
```

### Phase 9C: Commit

```bash
git add src/settings/repositories/session-attachments.ts tests/settings/repositories/session-attachments.test.ts
git commit -m "feat: add SessionAttachmentsRepository with tests"
```

---

## Task 10: Implement repositories — ContextBindings

**Files:**
- Create: `src/settings/repositories/context-bindings.ts`
- Create: `tests/settings/repositories/context-bindings.test.ts`

### Phase 10A: RED — Write tests

- [ ] **Step 10A.1: Write the test file**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createContextBindingsRepository } from "../../../src/settings/repositories/context-bindings.js";

const DDL = `
CREATE TABLE IF NOT EXISTS thread_context_bindings (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    context_key TEXT NOT NULL,
    project     TEXT,
    session     TEXT,
    agent       TEXT,
    model       TEXT
);
CREATE INDEX IF NOT EXISTS idx_thread_context_bindings_key ON thread_context_bindings(context_key);
`;

describe("ContextBindingsRepository", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  it("returns empty array when no bindings", () => {
    const repo = createContextBindingsRepository(db);
    expect(repo.getAll()).toEqual([]);
  });

  it("sets and retrieves bindings", () => {
    const repo = createContextBindingsRepository(db);
    const bindings = [
      {
        id: 1,
        context_key: "1:100:10",
        project: JSON.stringify({ id: "p1", worktree: "/tmp" }),
        session: null,
        agent: "build",
        model: null,
      },
      {
        id: 2,
        context_key: "2:200:20",
        project: null,
        session: null,
        agent: "plan",
        model: JSON.stringify({ providerID: "openai", modelID: "gpt-5", variant: "high" }),
      },
      {
        id: undefined as unknown as number,
        context_key: "3:300:30",
        project: null,
        session: null,
        agent: "review",
        model: null,
      },
    ];
    repo.setBindings(bindings);
    const result = repo.getAll();
    expect(result).toHaveLength(3);
    expect(result[0].agent).toBe("build");
    expect(result[2].context_key).toBe("3:300:30");
  });
});
```

### Phase 10B: GREEN — Implement

- [ ] **Step 10B.1: Write the repository**

```typescript
import type Database from "better-sqlite3";
import type { ThreadContextBindingRow } from "./types.js";

export interface ContextBindingsRepository {
  getAll(): ThreadContextBindingRow[];
  setBindings(bindings: Omit<ThreadContextBindingRow, "id">[]): void;
}

export function createContextBindingsRepository(
  db: Database.Database,
): ContextBindingsRepository {
  const getAllStmt = db.prepare("SELECT * FROM thread_context_bindings");
  const deleteAllStmt = db.prepare("DELETE FROM thread_context_bindings");

  return {
    getAll(): ThreadContextBindingRow[] {
      return getAllStmt.all() as ThreadContextBindingRow[];
    },

    setBindings(bindings: Omit<ThreadContextBindingRow, "id">[]): void {
      const runInTransaction = db.transaction((b: Omit<ThreadContextBindingRow, "id">[]) => {
        deleteAllStmt.run();
        const insertStmt = db.prepare(
          "INSERT INTO thread_context_bindings (context_key, project, session, agent, model) VALUES (?, ?, ?, ?, ?)",
        );
        for (const binding of b) {
          insertStmt.run(
            binding.context_key,
            binding.project,
            binding.session,
            binding.agent,
            binding.model,
          );
        }
      });
      runInTransaction(bindings);
    },
  };
}
```

- [ ] **Step 10B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/repositories/context-bindings.test.ts
```

### Phase 10C: Commit

```bash
git add src/settings/repositories/context-bindings.ts tests/settings/repositories/context-bindings.test.ts
git commit -m "feat: add ContextBindingsRepository with tests"
```

---

## Task 11: Implement migration (settings.json → SQLite)

**Files:**
- Create: `src/settings/migrate.ts`
- Create: `tests/settings/migrate.test.ts`

### Phase 11A: RED — Write tests

- [ ] **Step 11A.1: Write `tests/settings/migrate.test.ts`**

```typescript
import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { migrateSettings, migrateIfNeeded } from "../../../src/settings/migrate.js";
import type { Settings } from "../../../src/settings/manager.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("migrateSettings", () => {
  let db: Database.Database;

  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(`
CREATE TABLE IF NOT EXISTS user_preferences (
    user_id INTEGER PRIMARY KEY, tts_enabled INTEGER NOT NULL DEFAULT 0,
    message_streaming_enabled INTEGER NOT NULL DEFAULT 1, thinking_clear_mode INTEGER NOT NULL DEFAULT 0,
    locale TEXT, hide_thinking_messages INTEGER NOT NULL DEFAULT 0,
    hide_tool_call_messages INTEGER NOT NULL DEFAULT 0, hide_tool_file_messages INTEGER NOT NULL DEFAULT 0,
    telegraph_translate_enabled INTEGER NOT NULL DEFAULT 0, subagent_topics_enabled INTEGER NOT NULL DEFAULT 0,
    subagent_topic_auto_delete_minutes INTEGER NOT NULL DEFAULT 1,
    default_project TEXT, default_agent TEXT, default_model TEXT
);
CREATE TABLE IF NOT EXISTS conversation_bindings (
    scope_key TEXT PRIMARY KEY, project TEXT, session TEXT, agent TEXT, model TEXT,
    pinned_message_id INTEGER, reasoning_mode INTEGER
);
CREATE TABLE IF NOT EXISTS approved_users (user_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    first_name TEXT, last_name TEXT, username TEXT, requested_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled_tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, cron TEXT NOT NULL,
    prompt TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, topic_id INTEGER, project TEXT
);
CREATE TABLE IF NOT EXISTS scheduled_task_ignores (
    id INTEGER PRIMARY KEY AUTOINCREMENT, task_name TEXT NOT NULL,
    session_id TEXT NOT NULL, ignore_until TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS server_process (key TEXT PRIMARY KEY DEFAULT 'current', data TEXT);
CREATE TABLE IF NOT EXISTS last_restart_request (key TEXT PRIMARY KEY DEFAULT 'current', data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS tenant_runtimes (
    user_id INTEGER PRIMARY KEY, opencode_url TEXT, opencode_token TEXT,
    git_name TEXT, git_email TEXT, project_path TEXT, extra TEXT
);
CREATE TABLE IF NOT EXISTS attached_sessions (scope_key TEXT PRIMARY KEY, session TEXT);
CREATE TABLE IF NOT EXISTS session_directory_cache (scope_key TEXT PRIMARY KEY, directory TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS thread_context_bindings (
    id INTEGER PRIMARY KEY AUTOINCREMENT, context_key TEXT NOT NULL,
    project TEXT, session TEXT, agent TEXT, model TEXT
);
    `);
  });

  it("migrates scopedUserSettings to user_preferences", () => {
    const settings: Settings = {
      scopedUserSettings: { "123": { locale: "ru", ttsEnabled: true } },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT * FROM user_preferences WHERE user_id = 123").get() as any;
    expect(row.locale).toBe("ru");
    expect(row.tts_enabled).toBe(1);
  });

  it("migrates scopedConversationSettings to conversation_bindings", () => {
    const settings: Settings = {
      scopedConversationSettings: {
        "1:100:10": { currentAgent: "build", reasoningMode: 2 },
      },
    };
    migrateSettings(db, settings);
    const row = db.prepare("SELECT * FROM conversation_bindings").get() as any;
    expect(row.agent).toBe("build");
    expect(row.reasoning_mode).toBe(2);
  });

  it("migrates approvedTelegramUserIds to approved_users", () => {
    const settings: Settings = { approvedTelegramUserIds: [111, 222] };
    migrateSettings(db, settings);
    const rows = db.prepare("SELECT user_id FROM approved_users").all() as any[];
    expect(rows.map((r: any) => r.user_id)).toEqual([111, 222]);
  });

  it("skips legacy global fields", () => {
    const settings: Settings = {
      currentProject: { id: "x", worktree: "/x" },
      currentAgent: "old",
      scopedUserSettings: { "1": { locale: "ru" } },
    };
    migrateSettings(db, settings);
    const users = db.prepare("SELECT * FROM user_preferences").all();
    expect(users).toHaveLength(1);
    const convs = db.prepare("SELECT * FROM conversation_bindings").all();
    expect(convs).toHaveLength(0);
  });

  it("handles empty settings", () => {
    expect(() => migrateSettings(db, {})).not.toThrow();
  });
});

describe("migrateIfNeeded", () => {
  let tmpDir: string;
  let settingsPath: string;
  let markerPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "migrate-if-"));
    settingsPath = path.join(tmpDir, "settings.json");
    markerPath = path.join(tmpDir, "settings.migrated-to-sqlite");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("creates marker and migrates data when no marker exists", async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({
      scopedUserSettings: { "1": { locale: "en" } },
    }));
    const db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER PRIMARY KEY, locale TEXT);");

    await migrateIfNeeded(db, settingsPath, markerPath);

    expect(fs.existsSync(markerPath)).toBe(true);
    const row = db.prepare("SELECT * FROM user_preferences").get() as any;
    expect(row.locale).toBe("en");
  });

  it("skips migration when marker exists", async () => {
    fs.writeFileSync(settingsPath, JSON.stringify({ scopedUserSettings: { "1": { locale: "en" } } }));
    fs.writeFileSync(markerPath, "");
    const db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS user_preferences (user_id INTEGER PRIMARY KEY, locale TEXT);");

    await migrateIfNeeded(db, settingsPath, markerPath);

    const row = db.prepare("SELECT * FROM user_preferences").get();
    expect(row).toBeUndefined();
  });

  it("creates empty marker when no settings.json exists", async () => {
    const db = new Database(":memory:");
    await migrateIfNeeded(db, settingsPath, markerPath);
    expect(fs.existsSync(markerPath)).toBe(true);
  });
});
```

- [ ] **Step 11A.2: Run — verify FAIL**

```bash
npx vitest run tests/settings/migrate.test.ts
```

### Phase 11B: GREEN — Implement migrate.ts

- [ ] **Step 11B.1: Write `src/settings/migrate.ts`**

```typescript
import type Database from "better-sqlite3";
import type { Settings } from "../settings/manager.js";
import { logger } from "../utils/logger.js";

export function migrateSettings(db: Database.Database, settings: Settings): void {
  logger.info("[Migration] Starting settings.json → SQLite migration");

  const runMigration = db.transaction(() => {
    if (settings.scopedUserSettings) {
      const stmt = db.prepare(
        `INSERT INTO user_preferences (user_id, tts_enabled, message_streaming_enabled,
         thinking_clear_mode, locale, hide_thinking_messages, hide_tool_call_messages,
         hide_tool_file_messages, telegraph_translate_enabled, subagent_topics_enabled,
         subagent_topic_auto_delete_minutes, default_project, default_agent, default_model)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      );
      for (const [userIdStr, us] of Object.entries(settings.scopedUserSettings)) {
        stmt.run(
          Number(userIdStr),
          us.ttsEnabled === true ? 1 : 0,
          us.messageStreamingEnabled === false ? 0 : 1,
          us.thinkingClearMode === true ? 1 : 0,
          us.locale ?? null,
          us.hideThinkingMessages === true ? 1 : 0,
          us.hideToolCallMessages === true ? 1 : 0,
          us.hideToolFileMessages === true ? 1 : 0,
          us.telegraphTranslateEnabled === true ? 1 : 0,
          us.subagentTopicsEnabled === true ? 1 : 0,
          typeof us.subagentTopicAutoDeleteMinutes === "number" ? us.subagentTopicAutoDeleteMinutes : 1,
          us.defaultProject ? JSON.stringify(us.defaultProject) : null,
          us.defaultAgent ?? null,
          us.defaultModel ? JSON.stringify(us.defaultModel) : null,
        );
      }
    }

    if (settings.scopedConversationSettings) {
      const stmt = db.prepare(
        `INSERT INTO conversation_bindings (scope_key, project, session, agent, model, pinned_message_id, reasoning_mode)
         VALUES (?,?,?,?,?,?,?)`,
      );
      for (const [scopeKey, cs] of Object.entries(settings.scopedConversationSettings)) {
        stmt.run(
          scopeKey,
          cs.currentProject ? JSON.stringify(cs.currentProject) : null,
          cs.currentSession ? JSON.stringify(cs.currentSession) : null,
          cs.currentAgent ?? null,
          cs.currentModel ? JSON.stringify(cs.currentModel) : null,
          cs.pinnedMessageId ?? null,
          cs.reasoningMode ?? null,
        );
      }
    }

    if (settings.approvedTelegramUserIds?.length) {
      const stmt = db.prepare("INSERT INTO approved_users (user_id) VALUES (?)");
      for (const userId of settings.approvedTelegramUserIds) stmt.run(userId);
    }

    if (settings.pendingAccessRequests?.length) {
      const stmt = db.prepare(
        "INSERT INTO access_requests (user_id, first_name, last_name, username, requested_at) VALUES (?,?,?,?,?)",
      );
      for (const req of settings.pendingAccessRequests) {
        stmt.run(req.userId, req.firstName ?? null, req.lastName ?? null, req.username ?? null, req.requestedAt);
      }
    }

    if (settings.scheduledTasks?.length) {
      const stmt = db.prepare(
        "INSERT INTO scheduled_tasks (id, name, cron, prompt, enabled, topic_id, project) VALUES (?,?,?,?,?,?,?)",
      );
      for (const t of settings.scheduledTasks) {
        stmt.run(t.id, t.name, t.cron, t.prompt, t.enabled ? 1 : 0, (t as any).topicId ?? null, (t as any).project ? JSON.stringify((t as any).project) : null);
      }
    }

    if (settings.scheduledTaskSessionIgnores?.length) {
      const stmt = db.prepare("INSERT INTO scheduled_task_ignores (task_name, session_id, ignore_until) VALUES (?,?,?)");
      for (const ig of settings.scheduledTaskSessionIgnores) stmt.run("", ig.sessionId, ig.createdAt);
    }

    if (settings.serverProcess) {
      db.prepare("INSERT INTO server_process (key, data) VALUES ('current', ?)").run(JSON.stringify(settings.serverProcess));
    }

    if (settings.lastRestartRequest) {
      db.prepare("INSERT INTO last_restart_request (key, data) VALUES ('current', ?)").run(JSON.stringify(settings.lastRestartRequest));
    }

    if (settings.tenantRuntimes) {
      const stmt = db.prepare("INSERT INTO tenant_runtimes (user_id, opencode_url, opencode_token, git_name, git_email, project_path, extra) VALUES (?,?,?,?,?,?,?)");
      for (const [userIdStr, rt] of Object.entries(settings.tenantRuntimes)) {
        stmt.run(Number(userIdStr), rt.baseUrl ?? null, null, null, null, null, null);
      }
    }

    if (settings.attachedSessions) {
      const stmt = db.prepare("INSERT INTO attached_sessions (scope_key, session) VALUES (?,?)");
      for (const [key, att] of Object.entries(settings.attachedSessions)) {
        stmt.run(key, att.session ? JSON.stringify(att.session) : null);
      }
    }

    if (settings.scopedSessionDirectoryCache) {
      const stmt = db.prepare("INSERT INTO session_directory_cache (scope_key, directory) VALUES (?,?)");
      for (const [userKey, cache] of Object.entries(settings.scopedSessionDirectoryCache)) {
        if (cache.directories.length > 0) stmt.run(userKey, cache.directories[0].worktree);
      }
    }

    if (settings.threadContextBindings?.length) {
      const stmt = db.prepare("INSERT INTO thread_context_bindings (context_key, project, session, agent, model) VALUES (?,?,?,?,?)");
      for (const b of settings.threadContextBindings) {
        stmt.run(
          b.contextKey,
          b.project ? JSON.stringify(b.project) : null,
          b.session ? JSON.stringify(b.session) : null,
          b.agent ?? null,
          b.model ? JSON.stringify(b.model) : null,
        );
      }
    }
  });

  runMigration();
  logger.info("[Migration] settings.json → SQLite migration completed");
}

export async function migrateIfNeeded(
  db: Database.Database,
  settingsFilePath: string,
  markerFilePath: string,
): Promise<void> {
  const fs = await import("node:fs/promises");

  try {
    await fs.access(markerFilePath);
    logger.info("[Migration] Marker exists, skipping");
    return;
  } catch {}

  let settingsJson: string;
  try {
    settingsJson = await fs.readFile(settingsFilePath, "utf-8");
  } catch {
    logger.info("[Migration] No settings.json, fresh start");
    await fs.writeFile(markerFilePath, "");
    return;
  }

  const settings: Settings = JSON.parse(settingsJson);
  migrateSettings(db, settings);
  await fs.writeFile(markerFilePath, "");
  logger.info("[Migration] Done, marker created");
}
```

- [ ] **Step 11B.2: Run — verify PASS**

```bash
npx vitest run tests/settings/migrate.test.ts
```

### Phase 11C: Commit

```bash
git add src/settings/migrate.ts tests/settings/migrate.test.ts
git commit -m "feat: add settings.json to SQLite migration with tests"
```

---

## Task 12: Write db.test.ts

**Files:**
- Create: `tests/settings/db.test.ts`

- [ ] **Step 12.1: Write the test**

```typescript
import { describe, expect, it } from "vitest";
import { openDatabase, closeDatabase } from "../../src/settings/db.js";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

describe("openDatabase", () => {
  it("creates all tables", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-db-"));
    const dbPath = path.join(tmpDir, "test.db");

    const db = openDatabase(dbPath);
    const tables = (db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all() as any[])
      .map((t: any) => t.name);

    const expected = [
      "access_requests", "approved_users", "attached_sessions",
      "conversation_bindings", "last_restart_request", "scheduled_task_ignores",
      "scheduled_tasks", "server_process", "session_directory_cache",
      "tenant_runtimes", "thread_context_bindings", "user_preferences",
    ];
    for (const name of expected) expect(tables).toContain(name);

    closeDatabase(db);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("is idempotent (CREATE IF NOT EXISTS)", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "opencode-db2-"));
    const dbPath = path.join(tmpDir, "test.db");

    const db1 = openDatabase(dbPath);
    const before = (db1.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table'").get() as any).cnt;
    closeDatabase(db1);

    const db2 = openDatabase(dbPath);
    const after = (db2.prepare("SELECT count(*) as cnt FROM sqlite_master WHERE type='table'").get() as any).cnt;
    closeDatabase(db2);

    expect(after).toBe(before);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });
});
```

- [ ] **Step 12.2: Run — verify PASS**

```bash
npx vitest run tests/settings/db.test.ts
```

- [ ] **Step 12.3: Commit**

```bash
git add tests/settings/db.test.ts
git commit -m "test: add database initialization tests"
```

---

## Task 13: Refactor manager.ts to use repositories

**Files:**
- Modify: `src/settings/manager.ts` (~1334 → ~400 lines)
- Modify: `src/settings/db.ts` (export DDL)
- Modify: `tests/settings/manager.test.ts` (adapt for DB-backed manager)

### Phase 13A: Export DDL from db.ts

- [ ] **Step 13A.1: Add export to db.ts**

At the top of db.ts, before `export function openDatabase`, add:

```typescript
export const SETTINGS_DDL = DDL;
```

### Phase 13B: RED — Adapt manager tests for repository mocking

Since manager.ts tests are complex (19 test cases) and we want the API to remain unchanged, the simplest approach is:

1. Keep `__resetSettingsForTests()` — it now creates an in-memory DB and initializes repositories
2. All existing test cases continue to work because the public API is unchanged
3. No need to mock individual repositories — we use real in-memory SQLite

- [ ] **Step 13B.1: Update `__resetSettingsForTests()` call pattern**

The test file `tests/settings/manager.test.ts` calls `__resetSettingsForTests()` synchronously. Since the new version needs `await import("better-sqlite3")`, it becomes async. Change `beforeEach` in the test:

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";

// ... mock config and paths ...

beforeEach(async () => {
  await __resetSettingsForTests();
});
```

### Phase 13C: GREEN — Refactor manager.ts

- [ ] **Step 13C.1: Write the refactored manager.ts**

The complete refactored file replaces all `currentSettings` mutations with repository calls. Key points:
- All exported function signatures unchanged
- All type exports unchanged
- Fallback chain logic preserved (scope → user default → undefined)
- `loadSettings()` now calls `openDatabase` + `migrateIfNeeded`
- `disposeDatabase()` for cleanup
- `__resetSettingsForTests()` uses in-memory DB

Due to the length (~400 lines), the full file is in the plan appendix. Create the file `src/settings/manager.ts` by:
1. Keeping all type exports (lines 1-118 from current file)
2. Replacing all implementation (lines 119-1334) with repository-based code
3. Removing all `clone*` functions, `readSettingsFile`, `writeSettingsFile`, write queue

### Phase 13D: Commit

```bash
git add src/settings/manager.ts src/settings/db.ts tests/settings/manager.test.ts
git commit -m "feat: refactor manager.ts to use SQLite repositories"
```

---

## Task 14: Update start-bot-app.ts

**Files:**
- Modify: `src/app/start-bot-app.ts`

- [ ] **Step 14.1: Add disposeDatabase call**

```typescript
import { getLastRestartRequest, loadSettings, setLastRestartRequest, disposeDatabase } from "../settings/manager.js";
```

In the `finally` block after `await releaseStartupLock()`:

```typescript
disposeDatabase();
```

- [ ] **Step 14.2: Commit**

```bash
git add src/app/start-bot-app.ts
git commit -m "feat: add database cleanup on app shutdown"
```

---

## Task 15: Update runtime/paths.ts

**Files:**
- Modify: `src/runtime/paths.ts`

- [ ] **Step 15.1: Add dbFilePath to RuntimePaths interface and return**

```typescript
export interface RuntimePaths {
  // ... existing fields ...
  dbFilePath: string;
}
```

```typescript
return {
  // ... existing fields ...
  dbFilePath: path.join(appHome, "settings.db"),
};
```

- [ ] **Step 15.2: Commit**

```bash
git add src/runtime/paths.ts
git commit -m "feat: add dbFilePath to runtime paths"
```

---

## Task 16: Run full test suite and verify

- [ ] **Step 16.1: Run all tests**

```bash
npm test
```

Expected: all new + adapted tests pass. Fix any failures before proceeding.

- [ ] **Step 16.2: Run build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 16.3: Run lint**

```bash
npm run lint
```

Expected: no warnings. Prettier auto-fix if needed: `npm run format`.

- [ ] **Step 16.4: Commit fixes if any**

---

## Task 17: Update CHANGELOG.md

**Files:**
- Modify: `CHANGELOG.md`

- [ ] **Step 17.1: Add entry**

```bash
git add CHANGELOG.md
git commit -m "docs: update changelog for settings SQLite migration"
```

---

## Verification Checklist

- [ ] `npm test` passes
- [ ] `npm run build` passes
- [ ] `npm run lint` passes
- [ ] Old `settings.json` → `settings.db` migration works
- [ ] `.migrated-to-sqlite` marker created
- [ ] Second start skips migration
- [ ] Fresh install creates empty DB
- [ ] All ~45 callers unchanged (verified by build)
<｜end▁of▁thinking｜>

<｜｜DSML｜｜tool_calls>
<｜｜DSML｜｜invoke name="edit">
<｜｜DSML｜｜parameter name="filePath" string="true">/home/me/MyProjects/opencode-tg/docs/superpowers/plans/2026-05-31-settings-db-refactor.md