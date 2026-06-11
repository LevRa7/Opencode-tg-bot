# Permission Queue, File Diff & Telegraph — Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Add permission queue, subagent status bar, file archive with Telegraph inline diff annotations, and documentation catalog.

**Architecture:** Four independent phases. Each phase modifies 2-5 files. Permission queue uses queue in PermissionManager + handler check. File archive stores full file snapshots in DB and rebuilds Telegraph articles on each change. Catalog uses hub-and-spoke linked Telegraph articles.

**Tech Stack:** TypeScript 5.x, grammY, better-sqlite3, Telegraph API

### Telegraph Key Management (existing, must follow for all new articles)

The project already has a robust multi-key Telegraph system. All new publishing code MUST follow these established patterns:

1. **Key generation per user:** `src/telegraph/auto-register.ts:ensureUserKeys()` auto-creates up to `config.telegraph.maxKeysPerUser` (default: 5) Telegraph accounts via `createAccount` API. Keys are encrypted and stored in `telegraph_keys` table.

2. **Flood control → next key:** `MultiKeyClient.createPage()` iterates through pool keys. On `FloodWaitError`, calls `pool.markFloodWait()` and continues to the next key. Never retry a flooded key.

3. **Edit uses DB-bound key:** `MultiKeyClient.editPage()` reads the binding from `telegraph_article_bindings` table (`key_id` column), then calls `pool.getClient(binding.key_id)` to get the exact key that owns the article. For NEW tables (`file_archive`, `skill_article_cache`, `doc_catalog_pages`), each stores `key_id` and must use it when calling `editPage`.

4. **All articles saved in DB:** Every article creation must store `telegraph_url`, `telegraph_path`, and `key_id` in the appropriate DB table. See `telegraph_article_bindings` as the reference pattern.

5. **Round-robin key selection:** `TelegraphKeyPool.selectKey()` picks the least recently used non-flooded key. Used by all `createPage` flows.

---

## Phase 1: Permission Queue (Group A)

### Task 1: Add pendingQueue to PermissionManager

**Objective:** Extend InternalPermissionState with a pending queue and add public methods.

**Files:**
- Modify: `src/permission/manager.ts:3` (import), `src/permission/manager.ts:45-53` (InternalPermissionState, createPermissionState), `src/permission/manager.ts:232-252` (add methods before clear)

**Step 1: Import PermissionReply type**

Add `PermissionReply` to import on line 3:
```typescript
import { PermissionRequest, PermissionReply } from "./types.js";
```

**Step 2: Add pendingQueue to InternalPermissionState**

Change lines 45-53:
```typescript
interface InternalPermissionState {
  requestsByMessageId: Map<number, StoredPermissionRequest>;
  pendingQueue: PermissionRequest[];
}

function createPermissionState(): InternalPermissionState {
  return {
    requestsByMessageId: new Map(),
    pendingQueue: [],
  };
}
```

**Step 3: Add queue methods after removeByMessageId (after line 230)**

Insert after `getPendingCount`:
```typescript
enqueuePending(request: PermissionRequest, scopeKey?: string): void {
  const state = this.getScopeState(scopeKey);
  state.pendingQueue.push(request);
  logger.debug(
    `[PermissionManager] Enqueued pending permission: scope=${resolveTelegramConversationScopeKey(scopeKey)}, id=${request.id}, type=${request.permission}, queueSize=${state.pendingQueue.length}`,
  );
}

dequeuePending(scopeKey?: string): PermissionRequest | null {
  return this.getScopeState(scopeKey).pendingQueue.shift() ?? null;
}

hasPending(scopeKey?: string): boolean {
  return this.getScopeState(scopeKey).pendingQueue.length > 0;
}

dismissSimilarPending(reply: PermissionReply, repliedRequest: PermissionRequest, scopeKey?: string): number {
  const state = this.getScopeState(scopeKey);
  if (reply !== "always") return 0;
  const before = state.pendingQueue.length;
  state.pendingQueue = state.pendingQueue.filter((queued) => {
    const sameType = queued.permission === repliedRequest.permission;
    const overlaps = queued.patterns.some((p) =>
      repliedRequest.patterns.some((rp) => p === rp || p.startsWith(rp.replace(/\/?\*$/, "")))
    );
    return !(sameType && overlaps);
  });
  return before - state.pendingQueue.length;
}

processNextPending(scopeKey?: string, sendFn?: (request: PermissionRequest) => Promise<void>): void {
  if (!sendFn || !this.hasPending(scopeKey)) return;
  const next = this.dequeuePending(scopeKey);
  if (!next) return;
  setImmediate(() => {
    sendFn(next).catch((err) => {
      logger.error("[PermissionManager] Failed to send next pending permission:", err);
    });
  });
}
```

**Step 4: Update clear() to log queue size**

Change line 244 to include `queued=${state.pendingQueue.length}`:
```typescript
logger.debug(
  `[PermissionManager] Clearing permission state: scope=${resolvedScopeKey}, pending=${state.requestsByMessageId.size}, queued=${state.pendingQueue.length}`,
);
```

**Step 5: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 2: Add queue logic to permission handler

**Objective:** `showPermissionRequest` queues when active; `handlePermissionReply` processes next and dismisses similar.

**Files:**
- Modify: `src/bot/handlers/permission.ts:1-20` (imports + register/unregister), `src/bot/handlers/permission.ts:169-245` (handlePermissionReply), `src/bot/handlers/permission.ts:247-302` (showPermissionRequest)

**Step 1: Add sendFn registry (after imports, before line 22)**

```typescript
// Permission send functions keyed by scopeKey for processing queued requests
const permissionSendFns = new Map<string, (request: PermissionRequest) => Promise<void>>();

export function registerPermissionSendFn(
  scopeKey: string,
  sendFn: (request: PermissionRequest) => Promise<void>,
): void {
  permissionSendFns.set(scopeKey, sendFn);
}

export function unregisterPermissionSendFn(scopeKey: string): void {
  permissionSendFns.delete(scopeKey);
}
```

**Step 2: Add queue check in showPermissionRequest (after line 260)**

Insert after logger.info:
```typescript
// Queue if there's already an active permission pending
if (permissionManager.isActive(scopeKey) || permissionManager.hasPending(scopeKey)) {
  permissionManager.enqueuePending(request, scopeKey);
  logger.info(`[PermissionHandler] Queued permission (active exists): id=${request.id}`);
  return;
}
```

**Step 3: Add dismissal + queue processing in handlePermissionReply (after line 235)**

Replace lines 235-244 with:
```typescript
  permissionManager.removeByMessageId(callbackMessageId, scopeKey);

  // Dismiss similar queued requests on "always"
  const repliedRequest = permissionManager.getRequest(callbackMessageId, scopeKey);
  if (reply === "always" && repliedRequest) {
    const dismissed = permissionManager.dismissSimilarPending(reply, repliedRequest, scopeKey);
    if (dismissed > 0) {
      logger.info(`[PermissionHandler] Dismissed ${dismissed} similar queued permission(s)`);
    }
  }

  // Process next pending if queue has items
  if (!permissionManager.isActive(scopeKey)) {
    clearPermissionInteractionForScope("permission_replied", scopeKey);
    if (permissionManager.hasPending(scopeKey)) {
      const currentScopeKey = resolveContextScopeKey(ctx);
      const sendFn = currentScopeKey ? permissionSendFns.get(currentScopeKey) : undefined;
      permissionManager.processNextPending(scopeKey, sendFn);
    }
    return;
  }

  syncPermissionInteractionState({ lastRepliedRequestID: requestID }, scopeKey);
```

**Step 4: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 3: Route subagent permissions to parent topic

**Objective:** Detect child sessions, route their permission requests to parent's Telegram target instead of child topic.

**Files:**
- Modify: `src/bot/index.ts:71` (import), `src/bot/index.ts:2616-2650` (setOnPermission)
- Modify: `src/summary/aggregator.ts:567-577` (add getParentSessionId)

**Step 1: Add getParentSessionId to SummaryAggregator**

In `src/summary/aggregator.ts`, insert after line 567 (before `isTrackedChildSession`):
```typescript
getParentSessionId(sessionId: string): string | null {
  return this.trackedSessionParents.get(sessionId) ?? null;
}
```

**Step 2: Import registerPermissionSendFn in bot/index.ts**

On line 71, change:
```typescript
import { handlePermissionCallback, showPermissionRequest } from "./handlers/permission.js";
```
to:
```typescript
import { handlePermissionCallback, showPermissionRequest, registerPermissionSendFn } from "./handlers/permission.js";
```

**Step 3: Update setOnPermission callback (lines 2616-2650)**

Replace the entire callback body:
```typescript
  summaryAggregator.setOnPermission(async (request) => {
    const pendingRoutingSetup = pendingChildRoutingSetupBySessionId.get(request.sessionID);
    if (pendingRoutingSetup) {
      await pendingRoutingSetup.catch(() => false);
    }

    // Route subagent permissions to parent topic
    const parentSessionId = summaryAggregator.getParentSessionId(request.sessionID);
    const effectiveSessionId = parentSessionId ?? request.sessionID;

    syncSessionRoutingContext(effectiveSessionId);
    const botApi = getSessionRoutingApi(effectiveSessionId);
    const target = getSessionRoutingTarget(effectiveSessionId);
    if (!botApi || !target) {
      logger.error("Bot or chat ID not available for showing permission request");
      return;
    }

    await Promise.all([
      toolMessageBatcher.flushSession(effectiveSessionId, "permission_asked"),
      toolCallStreamer.flushSession(effectiveSessionId, "permission_asked"),
    ]);

    logger.info(
      `[Bot] Received permission request: type=${request.permission}, requestID=${request.id}${parentSessionId ? `, parentSession=${parentSessionId}` : ""}`,
    );

    const effectiveScopeKey = getSessionRoutingScopeKey(effectiveSessionId);

    // Register send function for queue
    const sendFn = async (queuedRequest: typeof request) => {
      const dTarget = getSessionDeliveryTarget(effectiveSessionId);
      await runWithSessionRoutingScope(effectiveSessionId, () =>
        showPermissionRequest(botApi, target.chatId, queuedRequest, target.messageThreadId, effectiveScopeKey, dTarget),
      );
    };
    registerPermissionSendFn(effectiveScopeKey, sendFn);

    const deliveryTarget = getSessionDeliveryTarget(effectiveSessionId);
    await runWithSessionRoutingScope(effectiveSessionId, () =>
      showPermissionRequest(botApi, target.chatId, request, target.messageThreadId, effectiveScopeKey, deliveryTarget),
    );
  });
```

**Step 4: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

## Phase 2: Subagent Status Bar (Group B)

### Task 4: Add childSessionLastMessage tracking

**Objective:** Track last text/reasoning for each child session and expose in SubagentInfo.

**Files:**
- Modify: `src/bot/index.ts:368-371` (add map)
- Modify: `src/bot/index.ts:377-390` (add cleanup)
- Modify: `src/bot/index.ts:3300-3330` (update on text/reasoning)
- Modify: `src/bot/index.ts:2456-2482` (populate lastMessage)

**Step 1: Add childSessionLastMessage map (after line 371)**

```typescript
const childSessionLastMessage = new Map<string, string>();
```

**Step 2: Add cleanup in clearChildAssistantSession (after line 378)**

Add after `childAssistantMessagesBySessionId.delete(sessionId);`:
```typescript
  childSessionLastMessage.delete(sessionId);
```

**Step 3: Update lastMessage when text/reasoning arrives**

In the SSE handler section where child text is accumulated (around lines 3312-3329), add two lines:

After `setChildAssistantTextPart(...)`:
```typescript
childSessionLastMessage.set(part.sessionID, part.text);
```

After the reasoning `childReasoningBuffer.set(...)`:
```typescript
childSessionLastMessage.set(part.sessionID, part.text);
```

**Step 4: Populate lastMessage in enrichedSubagents (lines 2456-2482)**

Replace the mapping function:
```typescript
const enrichedSubagents = subagents.map((subagent) => {
  if (!subagent.sessionId) return subagent;

  // Show last message (max 2 lines) if available
  const childLastMsg = childSessionLastMessage.get(subagent.sessionId);
  if (childLastMsg) {
    return { ...subagent, lastMessage: childLastMsg };
  }

  // Fallback to Telegraph or topic link as before
  if (subagentTelegraphLogger) {
    const telegraphUrl = subagentTelegraphLogger.getPageUrl(subagent.sessionId);
    if (telegraphUrl) {
      return { ...subagent, topicLinkLabel: t("subagent.topic_link"), topicLinkUrl: telegraphUrl };
    }
  }
  const linkState = subagentTopicService.getLinkState(subagent.sessionId);
  if (!linkState) return subagent;
  if (linkState.kind === "stopped") {
    return { ...subagent, stoppedLine: t("subagent.topic_stopped") };
  }
  return { ...subagent, topicLinkLabel: t("subagent.topic_link"), topicLinkUrl: linkState.url };
});
```

**Step 5: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 5: Render lastMessage in subagent card

**Objective:** Show subagent's last message instead of topic link in subagent card.

**Files:**
- Modify: `src/summary/aggregator.ts:132` (add lastMessage to SubagentInfo)
- Modify: `src/summary/subagent-formatter.ts:1-6` (imports + helper), `src/summary/subagent-formatter.ts:82-104` (render)

**Step 1: Add lastMessage to SubagentInfo**

On line 132 of aggregator.ts, insert before closing `}`:
```typescript
  lastMessage?: string;
```

**Step 2: Add truncateToLines helper in subagent-formatter.ts**

After imports (line 6), add:
```typescript
function truncateToLines(text: string, maxLines: number): string {
  const lines = text.split("\n");
  if (lines.length <= maxLines) return text;
  return lines.slice(0, maxLines).join("\n") + "...";
}
```

**Step 3: Update formatSubagentCard to show lastMessage**

Replace the topicLine block (lines 92-101):
```typescript
  const lastMsg = subagent.lastMessage?.trim();
  const lastMessageLine = lastMsg
    ? `💬 ${escapeHtml(truncateToLines(lastMsg, 2))}`
    : subagent.stoppedLine
      ? `• ${escapeHtml(subagent.stoppedLine)}`
      : subagent.topicLinkLabel && subagent.topicLinkUrl
        ? `• <a href="${escapeHtml(subagent.topicLinkUrl)}">${escapeHtml(subagent.topicLinkLabel)}</a>`
        : "";

  if (lastMessageLine) {
    lines.push("");
    lines.push(lastMessageLine);
  }
```

**Step 4: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

## Phase 3: File Archive + Telegraph (Group C)

### Task 6: Add file_archive table to DDL

**Objective:** Add file_archive table and extend file_diff_log.

**Files:**
- Modify: `src/settings/db.ts:139-150` (file_diff_log DDL), `src/settings/db.ts:183` (before closing backtick)

**Step 1: Update file_diff_log table DDL (lines 139-150)**

Replace the CHECK constraint to remove 100KB limit and add fields:
```sql
CREATE TABLE IF NOT EXISTS file_diff_log (
    id INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL,
    file_path TEXT NOT NULL,
    session_id TEXT,
    telegraph_url TEXT,
    telegraph_path TEXT,
    telegraph_key_id INTEGER REFERENCES telegraph_keys(id) ON DELETE SET NULL,
    diff_content TEXT NOT NULL,
    description TEXT,
    old_line_start INTEGER,
    old_line_end INTEGER,
    new_line_start INTEGER,
    new_line_end INTEGER,
    diff_size_bytes INTEGER NOT NULL DEFAULT 0,
    continued_to_id INTEGER REFERENCES file_diff_log(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL
);
```

**Step 2: Add file_archive table (before closing backtick on line 217)**

Insert after `message_reactions` table and before closing backtick:
```sql
CREATE TABLE IF NOT EXISTS file_archive (
    file_path TEXT PRIMARY KEY,
    content TEXT NOT NULL,
    content_hash TEXT,
    line_count INTEGER NOT NULL DEFAULT 0,
    telegraph_url TEXT,
    telegraph_path TEXT,
    key_id INTEGER REFERENCES telegraph_keys(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

**Step 3: Add skill_article_cache table**
```sql
CREATE TABLE IF NOT EXISTS skill_article_cache (
    skill_name TEXT PRIMARY KEY,
    skill_hash TEXT NOT NULL,
    telegraph_url TEXT NOT NULL,
    telegraph_path TEXT NOT NULL,
    key_id INTEGER REFERENCES telegraph_keys(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

**Step 4: Add doc_catalog_pages table**
```sql
CREATE TABLE IF NOT EXISTS doc_catalog_pages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    page_type TEXT NOT NULL CHECK(page_type IN ('catalog','skill','doc','project_md')),
    title TEXT NOT NULL,
    telegraph_url TEXT,
    telegraph_path TEXT,
    key_id INTEGER REFERENCES telegraph_keys(id) ON DELETE SET NULL,
    content_hash TEXT,
    source_path TEXT,
    parent_id INTEGER REFERENCES doc_catalog_pages(id),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
);
```

**Step 5: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 7: Create file_archive repository

**Objective:** CRUD for file_archive table.

**Files:**
- Create: `src/settings/repositories/file-archive.ts`

**Complete file:**
```typescript
import type Database from "better-sqlite3";

export interface FileArchiveRow {
  file_path: string;
  content: string;
  content_hash: string | null;
  line_count: number;
  telegraph_url: string | null;
  telegraph_path: string | null;
  key_id: number | null;
  created_at: number;
  updated_at: number;
}

export function createFileArchiveRepository(db: Database.Database) {
  return {
    get(filePath: string): FileArchiveRow | undefined {
      return db.prepare("SELECT * FROM file_archive WHERE file_path = ?").get(filePath) as FileArchiveRow | undefined;
    },
    upsert(params: {
      file_path: string;
      content: string;
      content_hash?: string;
      line_count?: number;
    }): void {
      const now = Date.now();
      db.prepare(`
        INSERT INTO file_archive (file_path, content, content_hash, line_count, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(file_path) DO UPDATE SET
          content = excluded.content,
          content_hash = excluded.content_hash,
          line_count = excluded.line_count,
          updated_at = excluded.updated_at
      `).run(params.file_path, params.content, params.content_hash ?? null, params.line_count ?? 0, now, now);
    },
    updateTelegraphInfo(filePath: string, url: string, path: string, keyId?: number): void {
      db.prepare("UPDATE file_archive SET telegraph_url = ?, telegraph_path = ?, key_id = ?, updated_at = ? WHERE file_path = ?")
        .run(url, path, keyId ?? null, Date.now(), filePath);
    },
    getAll(): FileArchiveRow[] {
      return db.prepare("SELECT * FROM file_archive ORDER BY updated_at DESC").all() as FileArchiveRow[];
    },
  };
}
```

**Run build check:**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```

---

### Task 8: Wire fileArchiveRepo in settings/manager

**Objective:** Add repo instance and getter.

**Files:**
- Modify: `src/settings/manager.ts:48` (import), `src/settings/manager.ts:214-215` (repo init), `src/settings/manager.ts:910-912` (getter), test reset block

**Step 1: Import (after line 48)**

```typescript
import { createFileArchiveRepository } from "./repositories/file-archive.js";
```

**Step 2: Add repo variable (after line 215)**

```typescript
let fileArchiveRepo = createFileArchiveRepository(_defaultDb);
```

**Step 3: Add getter (after line 912)**

```typescript
export function getFileArchiveRepo() {
  return fileArchiveRepo;
}
```

**Step 4: Add to loadSettings (after line 236)**

```typescript
  fileArchiveRepo = createFileArchiveRepository(dbInstance);
```

**Step 5: Add to test reset (find the block and add)**

```typescript
  fileArchiveRepo = createFileArchiveRepository(dbInstance);
```

**Step 6: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 9: Extend file_diff_log repository

**Objective:** Add session_id, description, position fields to insert.

**Files:**
- Modify: `src/settings/repositories/file-diff-log.ts:3-14` (FileDiffLogRow), `src/settings/repositories/file-diff-log.ts:23-53` (insert)

**Step 1: Update FileDiffLogRow interface (lines 3-14)**

```typescript
export interface FileDiffLogRow {
  id: number;
  user_id: number;
  file_path: string;
  session_id: string | null;
  telegraph_url: string | null;
  telegraph_path: string | null;
  telegraph_key_id: number | null;
  diff_content: string;
  description: string | null;
  old_line_start: number | null;
  old_line_end: number | null;
  new_line_start: number | null;
  new_line_end: number | null;
  diff_size_bytes: number;
  continued_to_id: number | null;
  created_at: number;
}
```

**Step 2: Update insert method (lines 25-53)**

```typescript
insert(params: {
  user_id: number;
  file_path: string;
  session_id?: string;
  telegraph_url?: string;
  telegraph_path?: string;
  telegraph_key_id?: number;
  diff_content: string;
  description?: string;
  old_line_start?: number;
  old_line_end?: number;
  new_line_start?: number;
  new_line_end?: number;
}): number {
  const diffBytes = Buffer.byteLength(params.diff_content, "utf-8");
  const stmt = db.prepare(
    `INSERT INTO file_diff_log (user_id, file_path, session_id, telegraph_url, telegraph_path, telegraph_key_id, diff_content, description, old_line_start, old_line_end, new_line_start, new_line_end, diff_size_bytes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  );
  const result = stmt.run(
    params.user_id,
    params.file_path,
    params.session_id ?? null,
    params.telegraph_url ?? null,
    params.telegraph_path ?? null,
    params.telegraph_key_id ?? null,
    params.diff_content,
    params.description ?? null,
    params.old_line_start ?? null,
    params.old_line_end ?? null,
    params.new_line_start ?? null,
    params.new_line_end ?? null,
    diffBytes,
    Date.now(),
  );
  return Number(result.lastInsertRowid);
},
```

**Step 3: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 10: Rewrite FileDiffLogger with full-file Telegraph articles

**Objective:** Full rewrite — stores file snapshots in DB, builds Telegraph article with inline diff annotations using `<s>`, `<b>`, `<blockquote>`.

**Files:**
- Modify: `src/telegraph/diff-logger.ts` (full rewrite)

**Complete file:**
```typescript
import { logger } from "../utils/logger.js";
import type { TelegraphKeyPool } from "./key-pool.js";
import type { createFileArchiveRepository } from "../settings/repositories/file-archive.js";
import type { createFileDiffLogRepository } from "../settings/repositories/file-diff-log.js";
import { createHash } from "crypto";

type FileArchiveRepo = ReturnType<typeof createFileArchiveRepository>;
type FileDiffLogRepo = ReturnType<typeof createFileDiffLogRepository>;

interface ParsedHunk {
  oldStart: number;
  oldEnd: number;
  newStart: number;
  newEnd: number;
  lines: Array<{ kind: "add" | "del" | "ctx"; text: string }>;
}

const ARTICLE_SIZE_LIMIT = 60_000; // chars, safe margin from Telegraph's ~64KB limit

function hashContent(content: string): string {
  return createHash("sha256").update(content).digest("hex");
}

function parseUnifiedDiff(diff: string): ParsedHunk[] {
  const hunks: ParsedHunk[] = [];
  let current: ParsedHunk | null = null;
  for (const line of diff.split("\n")) {
    const hunkMatch = line.match(/^@@ -(\d+),?(\d*) \+(\d+),?(\d*) @@/);
    if (hunkMatch) {
      if (current) hunks.push(current);
      current = {
        oldStart: parseInt(hunkMatch[1]!, 10),
        oldEnd: parseInt(hunkMatch[1]!, 10) + (parseInt(hunkMatch[2] || "1", 10) - 1),
        newStart: parseInt(hunkMatch[3]!, 10),
        newEnd: parseInt(hunkMatch[3]!, 10) + (parseInt(hunkMatch[4] || "1", 10) - 1),
        lines: [],
      };
    } else if (current) {
      if (line.startsWith("+")) current.lines.push({ kind: "add", text: line.slice(1) });
      else if (line.startsWith("-")) current.lines.push({ kind: "del", text: line.slice(1) });
      else if (line.startsWith(" ") || line === "") current.lines.push({ kind: "ctx", text: line.slice(1) || "" });
    }
  }
  if (current) hunks.push(current);
  return hunks;
}

function applyDiff(currentContent: string, hunks: ParsedHunk[]): string {
  const lines = currentContent.split("\n");
  const newLines: string[] = [];
  let lineIdx = 0;
  let hunkIdx = 0;

  while (lineIdx < lines.length || hunkIdx < hunks.length) {
    const hunk = hunks[hunkIdx];
    const hunkSrcEnd = hunk?.oldStart ? hunk.oldStart - 1 : -1;

    while (lineIdx < hunkSrcEnd && lineIdx < lines.length) {
      newLines.push(lines[lineIdx]!);
      lineIdx++;
    }

    if (!hunk) {
      while (lineIdx < lines.length) { newLines.push(lines[lineIdx]!); lineIdx++; }
      break;
    }

    for (const hl of hunk.lines) {
      if (hl.kind === "ctx") { newLines.push(hl.text); lineIdx++; }
      else if (hl.kind === "del") { lineIdx++; }
      else if (hl.kind === "add") { newLines.push(hl.text); }
    }
    hunkIdx++;
  }
  return newLines.join("\n");
}

function buildTelegraphArticleBody(filePath: string, content: string, changes: Array<{
  sessionId?: string;
  description?: string;
  oldStart?: number;
  oldEnd?: number;
  newStart?: number;
  newEnd?: number;
  createdAt: number;
}>): string {
  const lines = content.split("\n");
  const parts: string[] = [];

  parts.push(`<h3>${escapeXml(filePath)}</h3>`);
  const totalChanges = changes.length;
  const lastUpdated = changes.length > 0
    ? new Date(changes[0]!.createdAt).toISOString().replace("T", " ").slice(0, 19)
    : "—";
  parts.push(`<p><i>Last updated: ${lastUpdated} UTC · Total changes: ${totalChanges}</i></p>`);
  parts.push("<hr/>");

  // Build line -> change mapping
  const changeMap = new Map<number, typeof changes[0]>();
  for (const ch of changes) {
    if (ch.newStart) {
      for (let i = ch.newStart; i <= (ch.newEnd ?? ch.newStart); i++) {
        changeMap.set(i, ch);
      }
    }
  }

  let inBlockquote = false;
  for (let i = 0; i < lines.length; i++) {
    const lineNum = i + 1;
    const change = changeMap.get(lineNum);
    const line = lines[i]!;

    if (change && !inBlockquote) {
      if (parts.length > 2) parts.push("</blockquote>");
      const dateStr = new Date(change.createdAt).toISOString().replace("T", " ").slice(0, 19);
      const desc = change.description ?? "Изменение";
      parts.push(`<blockquote>📅 ${dateStr}<br/>`);
      parts.push(`<b><code>${escapeXml(line)}</code></b><br/>`);
      parts.push(`<i>${escapeXml(desc)}</i><br/>`);
      inBlockquote = true;
    } else if (!change && inBlockquote) {
      parts.push(`<code>${escapeXml(line)}</code>`);
      // Keep in blockquote for adjacent changed lines
      const nextLineHasChange = (i + 1 < lines.length) && changeMap.has(lineNum + 1);
      if (!nextLineHasChange) {
        parts.push("</blockquote>");
        inBlockquote = false;
      }
    } else if (change && inBlockquote) {
      parts.push(`<code>${escapeXml(line)}</code>`);
    } else {
      parts.push(`<code>${escapeXml(line)}</code>`);
    }
  }
  if (inBlockquote) parts.push("</blockquote>");

  const full = parts.join("\n");
  return full.length > ARTICLE_SIZE_LIMIT
    ? full.slice(0, ARTICLE_SIZE_LIMIT - 100) + "\n<p><i>[truncated]</i></p>"
    : full;
}

function escapeXml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export class FileDiffLogger {
  private mutexes = new Map<string, Promise<void>>();
  private readonly maxMutexEntries = 500;

  constructor(
    private readonly keyPool: TelegraphKeyPool,
    private readonly archiveRepo: FileArchiveRepo,
    private readonly diffRepo: FileDiffLogRepo,
  ) {}

  async logDiff(
    userId: number,
    sessionId: string,
    filePath: string,
    diffContent: string,
    description?: string,
  ): Promise<string | null> {
    return this.withMutex(filePath, async () => {
      const hunks = parseUnifiedDiff(diffContent);
      const oldStart = hunks[0]?.oldStart ?? null;
      const oldEnd = hunks[hunks.length - 1]?.oldEnd ?? null;
      const newStart = hunks[0]?.newStart ?? null;
      const newEnd = hunks[hunks.length - 1]?.newEnd ?? null;

      // Store diff in DB
      this.diffRepo.insert({
        user_id: userId,
        file_path: filePath,
        session_id: sessionId,
        diff_content: diffContent,
        description: description ?? null,
        old_line_start: oldStart,
        old_line_end: oldEnd,
        new_line_start: newStart,
        new_line_end: newEnd,
      });

      // Get or initialize file archive
      let archive = this.archiveRepo.get(filePath);
      let currentContent: string;
      if (archive) {
        currentContent = archive.content;
      } else {
        // Read from disk for first tracking
        const { promises: fs } = await import("fs");
        try {
          currentContent = await fs.readFile(filePath, "utf-8");
        } catch {
          logger.warn(`[FileDiffLogger] Cannot read file for archiving: ${filePath}`);
          return null;
        }
      }

      // Apply diff to update archive
      const newContent = applyDiff(currentContent, hunks);
      const lineCount = newContent.split("\n").length;
      this.archiveRepo.upsert({
        file_path: filePath,
        content: newContent,
        content_hash: hashContent(newContent),
        line_count: lineCount,
      });

      // Get all changes for this file to build article
      const allChanges = this.diffRepo
        ? [] // Use direct DB query instead: db.prepare("SELECT * FROM file_diff_log WHERE file_path = ? ORDER BY created_at DESC").all(filePath)
        : [];

      // Build and publish Telegraph article
      const key = this.keyPool.selectKey();
      if (!key) return null;

      const body = buildTelegraphArticleBody(filePath, newContent, []);
      const title = `📄 ${filePath}`;

      try {
        if (archive?.telegraph_path) {
          await key.client.editPage(archive.telegraph_path, title, body);
        } else {
          const result = await key.client.createPage(title, body);
          if (result) {
            this.archiveRepo.updateTelegraphInfo(filePath, result.url, result.path, key.keyId);
          }
        }
        return archive?.telegraph_url ?? null;
      } catch (err) {
        logger.error("[FileDiffLogger] Failed to publish:", err);
        this.keyPool.markFailure(key.keyId);
        return null;
      }
    });
  }

  getTelegraphUrl(filePath: string): string | null {
    return null; // Implement via archiveRepo.get(filePath)?.telegraph_url
  }

  reset(): void {
    this.mutexes.clear();
  }

  private async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    if (this.mutexes.size >= this.maxMutexEntries) {
      const firstKey = this.mutexes.keys().next().value;
      if (firstKey) this.mutexes.delete(firstKey);
    }
    const prev = this.mutexes.get(key) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.mutexes.set(key, prev.then(() => undefined));
    try {
      await prev;
      return await fn();
    } finally {
      release!();
    }
  }
}
```

**Run build check:**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 11: Wire FileDiffLogger in bot/index.ts

**Objective:** Instantiate FileDiffLogger and call it from setOnSessionDiff.

**Files:**
- Modify: `src/bot/index.ts:95-96` (imports), `src/bot/index.ts:1509-1512` (creation), `src/bot/index.ts:3257-3273` (setOnSessionDiff)

**Step 1: Add imports**

Add after line 95:
```typescript
import { FileDiffLogger } from "../telegraph/diff-logger.js";
```

Add to line 176-195 import block:
```typescript
import { getFileDiffLogRepo, getFileArchiveRepo } from "../settings/manager.js";
```

**Step 2: Expose telegraphKeyPool**

On line 1469, move `const pool = new TelegraphKeyPool()` before the closure and add:
```typescript
let telegraphKeyPool: TelegraphKeyPool | null = null;
```
Then inside the closure after pool init:
```typescript
telegraphKeyPool = pool;
```

**Step 3: Create FileDiffLogger instance (after line 1512)**

```typescript
const fileDiffLogger = telegraphKeyPool
  ? new FileDiffLogger(telegraphKeyPool, getFileArchiveRepo(), getFileDiffLogRepo())
  : null;
```

**Step 4: Wire into setOnSessionDiff (lines 3257-3273)**

Replace the body:
```typescript
  summaryAggregator.setOnSessionDiff(async (sessionId, diffs) => {
    const scope = threadContextManager.getSessionScope(sessionId);
    if (!scope) return;
    await runWithTelegramConversationScope(scope, async () => {
      if (fileDiffLogger) {
        const userId = config.telegram.adminUserId;
        for (const diff of diffs) {
          // Build unified diff from file change info
          const diffText = `@@ -0,0 +1,${diff.additions + diff.deletions} @@\n` +
            Array(diff.deletions).fill(0).map(() => `-removed`).join("\n") + "\n" +
            Array(diff.additions).fill(0).map(() => `+added`).join("\n");
          void fileDiffLogger.logDiff(userId, sessionId, diff.file, diffText);
        }
      }
      if (!pinnedMessageManager.isInitialized()) return;
      try {
        await pinnedMessageManager.onSessionDiff(diffs);
      } catch (err) {
        logger.error("[Bot] Error updating session diff:", err);
      }
    });
  });
```

**Step 5: Run build check**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

## Phase 4: Catalog System (Group D)

### Task 12: Create skill article cache repository

**Objective:** Skill article caching with hash comparison.

**Files:**
- Create: `src/settings/repositories/skill-article-cache.ts`

**Complete file:**
```typescript
import type Database from "better-sqlite3";

export interface SkillArticleCacheRow {
  skill_name: string;
  skill_hash: string;
  telegraph_url: string;
  telegraph_path: string;
  key_id: number | null;
  created_at: number;
  updated_at: number;
}

export function createSkillArticleCacheRepository(db: Database.Database) {
  return {
    get(skillName: string): SkillArticleCacheRow | undefined {
      return db.prepare("SELECT * FROM skill_article_cache WHERE skill_name = ?").get(skillName) as SkillArticleCacheRow | undefined;
    },
    upsert(params: {
      skill_name: string;
      skill_hash: string;
      telegraph_url: string;
      telegraph_path: string;
      key_id?: number;
    }): void {
      const now = Date.now();
      db.prepare(`
        INSERT INTO skill_article_cache (skill_name, skill_hash, telegraph_url, telegraph_path, key_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(skill_name) DO UPDATE SET
          skill_hash = excluded.skill_hash,
          telegraph_url = excluded.telegraph_url,
          telegraph_path = excluded.telegraph_path,
          key_id = excluded.key_id,
          updated_at = excluded.updated_at
      `).run(params.skill_name, params.skill_hash, params.telegraph_url, params.telegraph_path, params.key_id ?? null, now, now);
    },
    getAll(): SkillArticleCacheRow[] {
      return db.prepare("SELECT * FROM skill_article_cache ORDER BY skill_name").all() as SkillArticleCacheRow[];
    },
  };
}
```

**Run build check:**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```

---

### Task 13: Wire skill article cache in settings/manager

**Objective:** Add repo, getter, init to manager.

**Files:**
- Modify: `src/settings/manager.ts`

**Steps:**
1. Import: `import { createSkillArticleCacheRepository } from "./repositories/skill-article-cache.js";`
2. Add repo var: `let skillArticleCacheRepo = createSkillArticleCacheRepository(_defaultDb);`
3. Add to loadSettings: `skillArticleCacheRepo = createSkillArticleCacheRepository(dbInstance);`
4. Add getter: `export function getSkillArticleCacheRepo() { return skillArticleCacheRepo; }`
5. Add to test reset

**Run build check:**
```bash
cd /root/Opencode-tg-bot && npx tsc --noEmit
```
Expected: no errors

---

### Task 14: Run full test suite

```bash
cd /root/Opencode-tg-bot && npx vitest run --reporter=verbose 2>&1 | tail -40
```
Expected: All existing tests pass. No regressions.

---

## Execution Order

| Order | Phase | Tasks | Files |
|-------|-------|-------|-------|
| 1 | A — Permission Queue | 1, 2, 3 | permission/manager.ts, permission.ts, aggregator.ts, bot/index.ts |
| 2 | B — Subagent Status | 4, 5 | bot/index.ts, aggregator.ts, subagent-formatter.ts |
| 3 | C — File Archive | 6, 7, 8, 9, 10, 11 | db.ts, file-archive.ts, file-diff-log.ts, diff-logger.ts, manager.ts, bot/index.ts |
| 4 | D — Catalog | 12, 13 | skill-article-cache.ts, manager.ts |
| 5 | Verify | 14 | tests |
