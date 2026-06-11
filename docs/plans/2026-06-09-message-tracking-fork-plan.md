# Message Journal, Fork, Share Persistence, and Edit Handling — Implementation Plan

> **For Hermes:** Use TDD — write failing test first, then minimal code to pass.

**Goal:** Add message tracking (TG ↔ OpenCode ID mapping), session fork via `/fork`, share URL persistence, edit handling with fork/revert options, message removal SSE sync, topic deletion sync, and reaction monitoring.

**Architecture:** New SQLite tables (`message_journal`, `session_shares`, `message_reactions`), new repositories following existing pattern, new SSE event handlers in aggregator, new bot handlers (`edited_message`, `message_reaction`, `forum_topic_deleted`), new `/fork` command, modified `/share` with DB persistence.

**Key limitation:** Telegram Bot API does NOT send `deleted_message` updates. For TG → OpenCode deletion, we use: (a) reaction emoji on messages as deletion trigger, (b) `forum_topic_deleted` service message for topic deletion detection.

**Tech Stack:** TypeScript, grammy, better-sqlite3, @opencode-ai/sdk

---

### Task 1: Create `message_journal` table in DDL

**Objective:** Add the message journal table to the SQLite schema.

**Files:**
- Modify: `src/settings/db.ts`

**Step 1: Add DDL**

In `src/settings/db.ts`, append before the closing `';` of the DDL string (before line 183):

```sql
CREATE TABLE IF NOT EXISTS message_journal (
    tg_chat_id      INTEGER NOT NULL,
    tg_topic_id     INTEGER,
    tg_message_id   INTEGER NOT NULL,
    oc_server       TEXT NOT NULL DEFAULT '',
    oc_project      TEXT NOT NULL DEFAULT '',
    oc_session_id   TEXT NOT NULL,
    oc_message_id   TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (tg_chat_id, tg_topic_id, tg_message_id)
);
CREATE INDEX IF NOT EXISTS idx_mj_oc_session ON message_journal(oc_session_id);
CREATE INDEX IF NOT EXISTS idx_mj_oc_message ON message_journal(oc_message_id);
```

**Step 2: Verify**

Run: `npm run build` — should compile without errors.

---

### Task 2: Create `session_shares` table in DDL

**Objective:** Add the session shares cache table.

**Files:**
- Modify: `src/settings/db.ts`

**Step 1: Add DDL**

Append after the `message_journal` DDL block:

```sql
CREATE TABLE IF NOT EXISTS session_shares (
    oc_server       TEXT NOT NULL DEFAULT '',
    oc_session_id   TEXT NOT NULL,
    share_url       TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (oc_server, oc_session_id)
);
```

**Step 2: Verify**

Run: `npm run build`

---

### Task 3: Create `message_reactions` table in DDL

**Objective:** Add the reactions logging table.

**Files:**
- Modify: `src/settings/db.ts`

**Step 1: Add DDL**

```sql
CREATE TABLE IF NOT EXISTS message_reactions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    tg_chat_id      INTEGER NOT NULL,
    tg_topic_id     INTEGER,
    tg_message_id   INTEGER NOT NULL,
    user_id         INTEGER NOT NULL,
    emoji           TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_mr_message ON message_reactions(tg_chat_id, tg_topic_id, tg_message_id);
```

**Step 2: Verify**

Run: `npm run build`

---

### Task 4: Create `message-journal.ts` repository (TDD)

**Objective:** Repository for message journal CRUD operations.

**Files:**
- Create: `src/settings/repositories/message-journal.ts`
- Create: `tests/settings/repositories/message-journal.test.ts`

**Step 1: Write failing test**

Create `tests/settings/repositories/message-journal.test.ts`:

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createMessageJournalRepository } from "../../../src/settings/repositories/message-journal.js";
import { SETTINGS_DDL } from "../../../src/settings/db.js";

describe("MessageJournalRepository", () => {
  let db: Database.Database;

  beforeAll(() => {
    db = new Database(":memory:");
    db.exec(SETTINGS_DDL);
  });

  afterAll(() => db.close());

  const row = {
    tg_chat_id: -100123,
    tg_topic_id: 5,
    tg_message_id: 42,
    oc_server: "local",
    oc_project: "/test",
    oc_session_id: "sess-abc",
    oc_message_id: "msg-xyz",
  };

  describe("insert", () => {
    it("should insert a row and allow lookup by TG message", () => {
      const repo = createMessageJournalRepository(db);
      repo.insert(row);

      const found = repo.findByTgMessage(42, -100123, 5);
      expect(found).not.toBeNull();
      expect(found!.oc_session_id).toBe("sess-abc");
      expect(found!.oc_message_id).toBe("msg-xyz");
    });
  });

  describe("findByOcMessage", () => {
    it("should find rows by OpenCode message ID", () => {
      const repo = createMessageJournalRepository(db);
      const results = repo.findByOcMessage("sess-abc", "msg-xyz");
      expect(results).toHaveLength(1);
      expect(results[0].tg_message_id).toBe(42);
    });
  });

  describe("findByOcSession", () => {
    beforeEach(() => {
      const repo = createMessageJournalRepository(db);
      repo.deleteByTgMessage(42, -100123, 5);
      repo.insert({ ...row, tg_message_id: 42, oc_message_id: "msg-1" });
      repo.insert({ ...row, tg_message_id: 43, oc_message_id: "msg-2" });
    });

    it("should return all messages for a session", () => {
      const repo = createMessageJournalRepository(db);
      const results = repo.findByOcSession("sess-abc");
      expect(results.length).toBeGreaterThanOrEqual(2);
    });
  });

  describe("deleteByTgMessage", () => {
    it("should remove the entry", () => {
      const repo = createMessageJournalRepository(db);
      repo.deleteByTgMessage(42, -100123, 5);
      const found = repo.findByTgMessage(42, -100123, 5);
      expect(found).toBeNull();
    });
  });

  describe("deleteByOcSession", () => {
    it("should remove all entries for a session", () => {
      const repo = createMessageJournalRepository(db);
      repo.deleteByOcSession("sess-abc");
      const results = repo.findByOcSession("sess-abc");
      expect(results).toHaveLength(0);
    });
  });
});
```

**Step 2: Run test to verify failure**

Run: `npx vitest run tests/settings/repositories/message-journal.test.ts`
Expected: FAIL — module not found

**Step 3: Write minimal implementation**

Create `src/settings/repositories/message-journal.ts`:

```typescript
import type Database from "better-sqlite3";

export interface MessageJournalRow {
  tg_chat_id: number;
  tg_topic_id: number | null;
  tg_message_id: number;
  oc_server: string;
  oc_project: string;
  oc_session_id: string;
  oc_message_id: string;
  created_at: string;
}

export function createMessageJournalRepository(db: Database.Database) {
  const insertStmt = db.prepare(
    `INSERT OR REPLACE INTO message_journal
     (tg_chat_id, tg_topic_id, tg_message_id, oc_server, oc_project, oc_session_id, oc_message_id)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  );

  const findByTgMsgStmt = db.prepare(
    "SELECT * FROM message_journal WHERE tg_message_id = ? AND tg_chat_id = ? AND tg_topic_id IS ?",
  );

  const findByOcMsgStmt = db.prepare(
    "SELECT * FROM message_journal WHERE oc_session_id = ? AND oc_message_id = ?",
  );

  const findByOcSessionStmt = db.prepare(
    "SELECT * FROM message_journal WHERE oc_session_id = ? ORDER BY tg_message_id",
  );

  const findByTgTopicStmt = db.prepare(
    "SELECT * FROM message_journal WHERE tg_chat_id = ? AND tg_topic_id IS ?",
  );

  const deleteByTgMsgStmt = db.prepare(
    "DELETE FROM message_journal WHERE tg_message_id = ? AND tg_chat_id = ? AND tg_topic_id IS ?",
  );

  const deleteByOcSessionStmt = db.prepare(
    "DELETE FROM message_journal WHERE oc_session_id = ?",
  );

  const deleteByTgTopicStmt = db.prepare(
    "DELETE FROM message_journal WHERE tg_chat_id = ? AND tg_topic_id IS ?",
  );

  return {
    insert(
      params: Omit<MessageJournalRow, "created_at">,
    ): void {
      insertStmt.run(
        params.tg_chat_id,
        params.tg_topic_id ?? null,
        params.tg_message_id,
        params.oc_server,
        params.oc_project,
        params.oc_session_id,
        params.oc_message_id,
      );
    },

    findByTgMessage(
      tgMessageId: number,
      tgChatId: number,
      tgTopicId: number | null,
    ): MessageJournalRow | null {
      const row = findByTgMsgStmt.get(
        tgMessageId,
        tgChatId,
        tgTopicId ?? null,
      ) as MessageJournalRow | undefined;
      return row ?? null;
    },

    findByOcMessage(
      ocSessionId: string,
      ocMessageId: string,
    ): MessageJournalRow[] {
      return findByOcMsgStmt.all(ocSessionId, ocMessageId) as MessageJournalRow[];
    },

    findByOcSession(ocSessionId: string): MessageJournalRow[] {
      return findByOcSessionStmt.all(ocSessionId) as MessageJournalRow[];
    },

    findByTgTopic(
      tgChatId: number,
      tgTopicId: number | null,
    ): MessageJournalRow[] {
      return findByTgTopicStmt.all(tgChatId, tgTopicId ?? null) as MessageJournalRow[];
    },

    deleteByTgMessage(
      tgMessageId: number,
      tgChatId: number,
      tgTopicId: number | null,
    ): void {
      deleteByTgMsgStmt.run(tgMessageId, tgChatId, tgTopicId ?? null);
    },

    deleteByOcSession(ocSessionId: string): void {
      deleteByOcSessionStmt.run(ocSessionId);
    },

    deleteByTgTopic(
      tgChatId: number,
      tgTopicId: number | null,
    ): void {
      deleteByTgTopicStmt.run(tgChatId, tgTopicId ?? null);
    },
  };
}
```

**Step 4: Run test to verify pass**

Run: `npx vitest run tests/settings/repositories/message-journal.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add src/settings/db.ts src/settings/repositories/message-journal.ts tests/settings/repositories/message-journal.test.ts
git commit -m "feat: add message_journal table and repository"
```

---

### Task 5: Create `session-shares.ts` repository (TDD)

**Objective:** Repository for session share URL caching.

**Files:**
- Create: `src/settings/repositories/session-shares.ts`
- Create: `tests/settings/repositories/session-shares.test.ts`

**Step 1: Write failing test**

```typescript
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSessionSharesRepository } from "../../../src/settings/repositories/session-shares.js";
import { SETTINGS_DDL } from "../../../src/settings/db.js";

describe("SessionSharesRepository", () => {
  let db: Database.Database;
  beforeAll(() => { db = new Database(":memory:"); db.exec(SETTINGS_DDL); });
  afterAll(() => db.close());

  it("should upsert and find a share URL", () => {
    const repo = createSessionSharesRepository(db);
    repo.upsert("local", "sess-1", "https://share.example.com/sess-1");
    const found = repo.find("local", "sess-1");
    expect(found?.share_url).toBe("https://share.example.com/sess-1");
  });

  it("should update existing share URL on upsert", () => {
    const repo = createSessionSharesRepository(db);
    repo.upsert("local", "sess-1", "https://new.example.com");
    const found = repo.find("local", "sess-1");
    expect(found?.share_url).toBe("https://new.example.com");
  });

  it("should delete a share entry", () => {
    const repo = createSessionSharesRepository(db);
    repo.delete("local", "sess-1");
    expect(repo.find("local", "sess-1")).toBeNull();
  });

  it("should return null for non-existent entry", () => {
    const repo = createSessionSharesRepository(db);
    expect(repo.find("local", "nonexistent")).toBeNull();
  });
});
```

**Step 2:** Run → FAIL

**Step 3:** Implement `session-shares.ts` following `article-bindings.ts` pattern.

**Step 4:** Run → PASS

**Step 5:** Commit.

---

### Task 6: Create `message-reactions.ts` repository (TDD)

**Objective:** Repository for reaction logging.

**Files:**
- Create: `src/settings/repositories/message-reactions.ts`
- Create: `tests/settings/repositories/message-reactions.test.ts`

**Step 1: Write failing test** — verify insert + findByMessage.

**Step 2:** Run → FAIL

**Step 3:** Implement.

**Step 4:** Run → PASS

**Step 5:** Commit.

---

### Task 7: Register new repositories in `settings/manager.ts`

**Objective:** Initialize and export the new repositories.

**Files:**
- Modify: `src/settings/manager.ts`

**Step 1: Add imports**

After line 52 (`import { createGoalsRepository }`):

```typescript
import { createMessageJournalRepository, type MessageJournalRow } from "./repositories/message-journal.js";
import { createSessionSharesRepository } from "./repositories/session-shares.js";
import { createMessageReactionsRepository } from "./repositories/message-reactions.js";
```

**Step 2: Add repository instances** (after line 204, before `let dbInstance`):

```typescript
let messageJournalRepo = createMessageJournalRepository(_defaultDb);
let sessionSharesRepo = createSessionSharesRepository(_defaultDb);
let messageReactionsRepo = createMessageReactionsRepository(_defaultDb);
```

**Step 3: Add re-registration in `loadSettings()`** (after line 235, before `}`):

```typescript
messageJournalRepo = createMessageJournalRepository(dbInstance);
sessionSharesRepo = createSessionSharesRepository(dbInstance);
messageReactionsRepo = createMessageReactionsRepository(dbInstance);
```

**Step 4: Add accessor functions** (append at end of file):

```typescript
export function getMessageJournalRepo() {
  return messageJournalRepo;
}

export function getSessionSharesRepo() {
  return sessionSharesRepo;
}

export function getMessageReactionsRepo() {
  return messageReactionsRepo;
}
```

**Step 5: Add export for `MessageJournalRow` type** (with type exports at line 51-52):

```typescript
export type { MessageJournalRow };
```

**Step 6:** Run `npm run build` — should compile.

---

### Task 8: Add i18n keys for fork, share cached, message journal, and edit flows

**Objective:** Add new localized strings.

**Files:**
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ru.ts`

**Step 1: Add English keys**

In `en.ts`, add before the closing `} as const;`:

```typescript
"cmd.description.fork": "Fork current session into new topic",
"fork.success": "Session forked: {title}. Opening in new topic...",
"fork.no_session": "No active session to fork.",
"fork.error": "Failed to fork session.",
"share.already_shared": "Session already shared: {url}",
"edit.fork_or_revert": "Message edited. Choose action:",
"edit.fork_button": "Fork in new topic",
"edit.revert_button": "Revert to this message",
"edit.forked": "Forked session at edited message. Sending prompt...",
"edit.reverted": "Session reverted to edited message. Sending prompt...",
"edit.no_session": "Cannot process edited message: no active session.",
"edit.not_found": "Edited message not tracked in journal.",
"delete_via_reaction": "To delete a message and its OpenCode counterpart, react with ❌",
```

**Step 2: Add Russian keys** (same keys with Russian translations).

**Step 3:** Run `npm run build` — typecheck should pass.

---

### Task 9: Add `/fork` command definition

**Objective:** Register fork command in the command list.

**Files:**
- Modify: `src/bot/commands/definitions.ts`

**Step 1:** Add entry before `help` command:

```typescript
{ command: "fork", descriptionKey: "cmd.description.fork" },
```

---

### Task 10: Implement `/fork` command handler (TDD)

**Objective:** Fork current session via SDK, create new TG topic.

**Files:**
- Create: `src/bot/commands/fork.ts`
- Create: `tests/bot/commands/fork.test.ts`

**Step 1: Write failing test**

Mock `opencodeClient.session.fork`, `getCurrentSession`, `attachSessionForScope`, and `ctx.api.createForumTopic`.

**Step 2:** Run → FAIL

**Step 3: Implement fork command**

```typescript
import { Context } from "grammy";
import { opencodeClient } from "../../opencode/client.js";
import { getCurrentSession } from "../../session/manager.js";
import { attachSessionForScope } from "../../attach/service.js";
import { threadContextManager } from "../../thread/manager.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { withMessageThreadId, extractMessageThreadIdFromContext } from "../utils/message-thread.js";

export async function forkCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("fork.no_session"));
    return;
  }

  try {
    const { data, error } = await opencodeClient.session.fork({
      sessionID: session.id,
      directory: session.directory,
    });

    if (error || !data) {
      logger.error("[Fork] Failed to fork session:", error);
      await ctx.reply(t("fork.error"));
      return;
    }

    const forkedSession = data as { id: string; title: string };
    logger.info(`[Fork] Forked session=${session.id} → ${forkedSession.id}`);

    // Create new forum topic
    const chatId = ctx.chat!.id;
    const newTopic = await ctx.api.createForumTopic(chatId, forkedSession.title);

    // Attach forked session to new topic
    const activeScope = threadContextManager.getActiveScope();
    if (activeScope) {
      await attachSessionForScope({
        scope: { ...activeScope, messageThreadId: newTopic.message_thread_id },
        session: { id: forkedSession.id, title: forkedSession.title, directory: session.directory },
        reason: "fork",
      });
    }

    await ctx.reply(
      t("fork.success", { title: forkedSession.title }),
      withMessageThreadId(undefined, extractMessageThreadIdFromContext(ctx)),
    );
  } catch (err) {
    logger.error("[Fork] Error:", err);
    await ctx.reply(t("fork.error"));
  }
}
```

**Step 4:** Run → PASS

**Step 5:** Commit.

---

### Task 11: Wire `/fork` command in `bot/index.ts`

**Objective:** Register the fork command and its handler.

**Files:**
- Modify: `src/bot/index.ts`

**Step 1: Add import**

```typescript
import { forkCommand } from "./commands/fork.js";
```

**Step 2: Register command** — add after the share command registration (around line 3865):

```typescript
bot.command("fork", forkCommand);
```

**Step 3:** Run `npm run build` — should compile.

---

### Task 12: Fix `/share` with DB persistence (TDD)

**Objective:** Persist share URLs so repeated `/share` returns cached URL.

**Files:**
- Modify: `src/bot/commands/share.ts`
- Create: `tests/bot/commands/share.test.ts`

**Step 1: Write failing test**

Test that:
1. First call to `shareCommand` calls SDK `share()` and stores result
2. Second call returns cached URL without calling SDK
3. After `unshare`, cache is cleared

**Step 2:** Run → FAIL

**Step 3: Implement persistence**

Modify `shareCommand`:
```typescript
export async function shareCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("share.no_session"));
    return;
  }

  try {
    // Check cache first
    const { getSessionSharesRepo, getCurrentOpencodeServer } = await import("../../settings/manager.js");
    const server = getCurrentOpencodeServer?.() ?? "";
    const cached = getSessionSharesRepo().find(server, session.id);
    if (cached) {
      await ctx.reply(t("share.already_shared", { url: cached.share_url }));
      return;
    }

    const { data, error } = await opencodeClient.session.share({
      sessionID: session.id,
      directory: session.directory,
    });

    if (error) {
      logger.error("[Share] Failed to share session:", error);
      await ctx.reply(t("share.error"));
      return;
    }

    const shareUrl = (data as any)?.share?.url;
    if (shareUrl) {
      getSessionSharesRepo().upsert(server, session.id, shareUrl);
      await ctx.reply(t("share.success", { url: shareUrl }));
    } else {
      await ctx.reply(t("share.success", { url: "Session is now shared" }));
    }
  } catch (err) {
    logger.error("[Share] Error:", err);
    await ctx.reply(t("share.error"));
  }
}

export async function unshareCommand(ctx: Context): Promise<void> {
  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("share.no_session"));
    return;
  }

  try {
    const { error } = await opencodeClient.session.unshare({
      sessionID: session.id,
      directory: session.directory,
    });

    if (error) {
      await ctx.reply(t("share.unshare_error"));
      return;
    }

    // Remove from cache
    const { getSessionSharesRepo, getCurrentOpencodeServer } = await import("../../settings/manager.js");
    const server = getCurrentOpencodeServer?.() ?? "";
    getSessionSharesRepo().delete(server, session.id);

    await ctx.reply(t("share.unshared"));
  } catch (err) {
    await ctx.reply(t("share.unshare_error"));
  }
}
```

Note: Need to check if `getCurrentOpencodeServer` exists in settings manager. If not, use `""` as default or derive from the current environment.

**Step 4:** Run → PASS

**Step 5:** Commit.

---

### Task 13: Record assistant messages to `message_journal` in `bot/index.ts`

**Objective:** After assistant response is delivered to Telegram, record the TG ←→ OC message mapping.

**Files:**
- Modify: `src/bot/index.ts`

**Step 1: Add import**

```typescript
import { getMessageJournalRepo } from "../settings/manager.js";
```

**Step 2: Inject recording after `responseStreamer.complete()`**

In the `setOnComplete` callback (around line 2056, after `await finalizeAssistantDelivery`), add:

```typescript
// Record message journal entries for delivered messages
const result = responseStreamer.getLastCompleteResult?.(sessionId, `${messageId}:assistant`);
if (result?.telegramMessageIds?.length) {
  const repo = getMessageJournalRepo();
  const chatId = target.chatId;
  const topicId = target.messageThreadId ?? null;
  const server = ""; // derive from current route
  const project = getCurrentProject()?.worktree ?? "";

  for (const tgMsgId of result.telegramMessageIds) {
    repo.insert({
      tg_chat_id: chatId,
      tg_topic_id: topicId,
      tg_message_id: tgMsgId,
      oc_server: server,
      oc_project: project,
      oc_session_id: sessionId,
      oc_message_id: messageId,
    });
  }
}
```

Note: Need to check `responseStreamer.complete()` return value — it returns `StreamCompleteResult` with `telegramMessageIds`. After calling `complete()`, we have the result object (`result.telegramMessageIds`). Store this in the `onComplete` closure for journal recording.

**Step 3:** Run `npm run build` — should compile.

---

### Task 14: Handle `message.removed` and `session.deleted` SSE events in aggregator

**Objective:** When OpenCode deletes messages/sessions, sync deletions to Telegram.

**Files:**
- Modify: `src/summary/aggregator.ts`
- Modify: `src/bot/index.ts` (wire up callbacks)

**Step 1: Add callbacks to aggregator**

In `aggregator.ts`:

Add new callback types (around line 158):
```typescript
type MessageRemovedCallback = (sessionId: string, messageId: string) => void;
type SessionDeletedCallback = (sessionId: string) => void;
```

Add private fields (around line 207):
```typescript
private onMessageRemovedCallback: MessageRemovedCallback | null = null;
private onSessionDeletedCallback: SessionDeletedCallback | null = null;
```

Add setters (around line 308):
```typescript
setOnMessageRemoved(callback: MessageRemovedCallback): void {
  this.onMessageRemovedCallback = callback;
}
setOnSessionDeleted(callback: SessionDeletedCallback): void {
  this.onSessionDeletedCallback = callback;
}
```

**Step 2: Add cases to `processEvent` switch** (before `default:`):

```typescript
case "message.removed":
  if (this.onMessageRemovedCallback) {
    const props = event.properties as { sessionID: string; messageID: string };
    this.onMessageRemovedCallback(props.sessionID, props.messageID);
  }
  break;
case "session.deleted":
  if (this.onSessionDeletedCallback) {
    const props = event.properties as { info?: { id: string }; id?: string };
    const sessionId = props.info?.id ?? props.id ?? "";
    if (sessionId) {
      this.onSessionDeletedCallback(sessionId);
    }
  }
  break;
```

**Step 3: Wire callbacks in `bot/index.ts`**

In the `ensureEventSubscription` function, add:

```typescript
summaryAggregator.setOnMessageRemoved(async (sessionId, messageId) => {
  const repo = getMessageJournalRepo();
  const rows = repo.findByOcMessage(sessionId, messageId);
  for (const row of rows) {
    try {
      await botApi.deleteMessage(row.tg_chat_id, row.tg_message_id);
      repo.deleteByTgMessage(row.tg_message_id, row.tg_chat_id, row.tg_topic_id);
    } catch (err) {
      logger.warn(`[MessageJournal] Failed to delete TG message:`, err);
    }
  }
});

summaryAggregator.setOnSessionDeleted(async (sessionId) => {
  const repo = getMessageJournalRepo();
  const rows = repo.findByOcSession(sessionId);
  // Group by topic
  const topicMessages = new Map<string, { chatId: number; topicId: number | null; messageIds: number[] }>();
  for (const row of rows) {
    const key = `${row.tg_chat_id}:${row.tg_topic_id}`;
    if (!topicMessages.has(key)) {
      topicMessages.set(key, {
        chatId: row.tg_chat_id,
        topicId: row.tg_topic_id,
        messageIds: [],
      });
    }
    topicMessages.get(key)!.messageIds.push(row.tg_message_id);
  }
  for (const [, group] of topicMessages) {
    // If ALL messages in topic belong to this session → delete topic
    const allTopicMessages = repo.findByTgTopic(group.chatId, group.topicId);
    const onlyThisSession = allTopicMessages.every(r => r.oc_session_id === sessionId);
    if (onlyThisSession && group.topicId) {
      try {
        await botApi.deleteForumTopic(group.chatId, group.topicId);
      } catch (err) {
        logger.warn(`[MessageJournal] Failed to delete forum topic:`, err);
        for (const msgId of group.messageIds) {
          await botApi.deleteMessage(group.chatId, msgId).catch(() => {});
        }
      }
    } else {
      for (const msgId of group.messageIds) {
        await botApi.deleteMessage(group.chatId, msgId).catch(() => {});
      }
    }
  }
  repo.deleteByOcSession(sessionId);
});
```

**Step 4:** Run `npm run build` — should compile.

---

### Task 15: Handle `edited_message` — fork/revert flow (TDD)

**Objective:** When a user edits a message, offer fork or revert options.

**Files:**
- Modify: `src/bot/index.ts`
- Create: `src/bot/handlers/edited-message.ts`
- Create: `tests/bot/handlers/edited-message.test.ts`

**Step 1: Write failing test**

Test that:
1. `edited_message` handler queries `message_journal` for the message
2. If found, sends inline keyboard with Fork/Revert options
3. If not found, logs and does nothing

**Step 2:** Run → FAIL

**Step 3: Implement edited message handler**

Create `src/bot/handlers/edited-message.ts`:

```typescript
import { Context, InlineKeyboard } from "grammy";
import { getMessageJournalRepo } from "../../settings/manager.js";
import { getCurrentSession } from "../../session/manager.js";
import { opencodeClient } from "../../opencode/client.js";
import { t } from "../../i18n/index.js";
import { logger } from "../../utils/logger.js";
import { extractMessageThreadIdFromContext, withMessageThreadId } from "../utils/message-thread.js";

export async function handleEditedMessage(ctx: Context): Promise<boolean> {
  if (!ctx.editedMessage?.message_id || !ctx.editedMessage.text) {
    return false;
  }

  const chatId = ctx.chat!.id;
  const topicId = extractMessageThreadIdFromContext(ctx) ?? null;
  const messageId = ctx.editedMessage.message_id;
  const editedText = ctx.editedMessage.text;

  const repo = getMessageJournalRepo();
  const row = repo.findByTgMessage(messageId, chatId, topicId);
  if (!row) {
    logger.debug(`[EditedMessage] Message not in journal: chatId=${chatId}, topicId=${topicId}, msgId=${messageId}`);
    return false;
  }

  const session = getCurrentSession();
  if (!session) {
    await ctx.reply(t("edit.no_session"), withMessageThreadId(undefined, topicId ?? undefined));
    return true;
  }

  const keyboard = new InlineKeyboard()
    .text(t("edit.fork_button"), `mj_fork_${row.oc_session_id}_${row.oc_message_id}`)
    .row()
    .text(t("edit.revert_button"), `mj_revert_${row.oc_session_id}_${row.oc_message_id}`);

  await ctx.reply(t("edit.fork_or_revert"), { reply_markup: keyboard });
  logger.info(`[EditedMessage] Prompted user for action: sessionId=${row.oc_session_id}, messageId=${row.oc_message_id}`);
  return true;
}
```

**Step 4: Add callback handlers for fork/revert**

In `bot/index.ts` callback section, add:

```typescript
// Handle message journal fork callback
if (callbackData.startsWith("mj_fork_")) {
  const [, , sessionId, messageId] = callbackData.split("_");
  await handleMessageJournalFork(ctx, sessionId, messageId);
  handled = true;
}

// Handle message journal revert callback  
if (callbackData.startsWith("mj_revert_")) {
  const [, , sessionId, messageId] = callbackData.split("_");
  await handleMessageJournalRevert(ctx, sessionId, messageId);
  handled = true;
}
```

Implement `handleMessageJournalFork` and `handleMessageJournalRevert` functions.

**Step 5:** Register `bot.on("edited_message", handleEditedMessage)` in index.ts, replacing or augmenting the existing `edited_message` handler.

**Step 6:** Run → PASS

**Step 7:** Commit.

---

### Task 16: Handle reaction monitoring

**Objective:** Log user reactions on messages.

**Files:**
- Modify: `src/bot/index.ts`

**Step 1: Add reaction handler**

Register `bot.on("message_reaction")` in index.ts:

```typescript
bot.on("message_reaction", async (ctx) => {
  const reaction = ctx.messageReaction;
  if (!reaction) return;

  const chatId = reaction.chat.id;
  const messageId = reaction.message_id;

  for (const r of reaction.new_reaction ?? []) {
    const emoji = "emoji" in r ? r.emoji : "unknown";
    const userId = reaction.user?.id ?? 0;

    getMessageReactionsRepo().insert({
      tg_chat_id: chatId,
      tg_topic_id: null, // reactions in non-forum chats
      tg_message_id: messageId,
      user_id: userId,
      emoji,
    });

    logger.debug(`[Reaction] User ${userId} reacted ${emoji} on msg ${messageId}`);
  }
});
```

**Note:** GrammY needs `message_reaction` in the allowed update types by default. Since `message_reaction` is NOT in `DEFAULT_UPDATE_TYPES`, it must be added via bot config. Check `src/config.ts` or `src/bot/index.ts` for bot initialization.

**Step 2:** Run `npm run build` — should compile.

---

### Task 17: Handle forum topic deletion → delete sessions

**Objective:** Detect `forum_topic_deleted` service message and delete associated sessions.

**Files:**
- Modify: `src/bot/index.ts`

**Step 1: Add handler**

```typescript
bot.on("message:forum_topic_deleted", async (ctx) => {
  const chatId = ctx.chat!.id;
  // Topic ID isn't directly in the message — extract from context if available
  // Recent bot API versions provide:
  const topicId = ctx.message?.message_thread_id;
  if (!topicId) return;

  logger.info(`[TopicDeleted] Forum topic deleted: chatId=${chatId}, topicId=${topicId}`);

  const journalRepo = getMessageJournalRepo();
  const rows = journalRepo.findByTgTopic(chatId, topicId);
  const sessionIds = [...new Set(rows.map(r => r.oc_session_id))];

  for (const sessionId of sessionIds) {
    try {
      // Get session directory from settings
      const sessionSessionInfo = rows.find(r => r.oc_session_id === sessionId);
      const directory = sessionSessionInfo?.oc_project ?? "";
      if (directory) {
        await opencodeClient.session.delete({ sessionID: sessionId, directory });
      }
      journalRepo.deleteByOcSession(sessionId);
      logger.info(`[TopicDeleted] Deleted session: ${sessionId}`);
    } catch (err) {
      logger.error(`[TopicDeleted] Failed to delete session ${sessionId}:`, err);
    }
  }
});
```

**Step 2:** Run `npm run build` — should compile.

---

### Task 18: Integration tests and verification

**Objective:** Run all tests, build, lint, and verify.

**Files:**
- All

**Steps:**

1. Run `npx vitest run` — all tests should pass.
2. Run `npm run build` — should compile.
3. Run `npm run lint` — should pass.
4. Verify with `npm test` — all tests should pass.

---

### Task 19: Update CHANGELOG.md

**Objective:** Document all changes.

---

## Summary of All Steps

| # | Task | TDD |
|---|------|-----|
| 1 | Add `message_journal` DDL | No |
| 2 | Add `session_shares` DDL | No |
| 3 | Add `message_reactions` DDL | No |
| 4 | Create `message-journal.ts` repository | Yes |
| 5 | Create `session-shares.ts` repository | Yes |
| 6 | Create `message-reactions.ts` repository | Yes |
| 7 | Register repos in `settings/manager.ts` | No |
| 8 | Add i18n keys | No |
| 9 | Add `/fork` command definition | No |
| 10 | Implement `/fork` command handler | Yes |
| 11 | Wire `/fork` in `bot/index.ts` | No |
| 12 | Fix `/share` with DB persistence | Yes |
| 13 | Record assistant messages to journal | No |
| 14 | Handle `message.removed` / `session.deleted` SSE | No |
| 15 | Handle `edited_message` fork/revert flow | Yes |
| 16 | Handle reaction monitoring | No |
| 17 | Handle forum topic deletion | No |
| 18 | Integration tests + verify | No |
| 19 | Update CHANGELOG.md | No |
