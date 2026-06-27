# Memory Port: Hermes → OpenCode-TG

> **For Hermes:** Execute task-by-task.

**Goal:** Полноценный слой памяти как в Hermes: автоинжекция контекста, автосинк после хода, memory tools для модели, background review.

**Architecture:** Три компонента: (1) MCP-сервер на Python с инструментами памяти, (2) Middleware в боте на TypeScript для автоинжекции/синка, (3) AGENTS.md + cloud-init для файлов в VM.

**Tech Stack:** Python (MCP server via `mcp` package), TypeScript (bot middleware), SQLite (openCode DB), kaeru (external memory).

**Файловая раскладка:**
```
~/MyProjects/opencode-tg/.worktrees/terminal-agent/
├── mcp-servers/memory/           # ← НОВОЕ: MCP сервер
│   ├── server.py                 # stdio MCP, инструменты памяти
│   ├── memory_store.py           # чтение/запись MEMORY.md, USER.md
│   └── pyproject.toml            # deps: mcp, httpx
├── src/memory/                   # ← НОВОЕ: Bot middleware
│   ├── inject.ts                 # автоинжекция контекста в промпт
│   ├── sync.ts                   # автосинк после ответа
│   ├── nudge.ts                  # memory/skill nudge (счётчик ходов)
│   └── background-review.ts      # spawn background review
├── docker/AGENTS.md              # ← ИЗМЕНИТЬ: добавить memory-инструкции
└── src/vm/cloud-init.ts          # ← ИЗМЕНИТЬ: создать MEMORY.md, USER.md, skills/
```

---

### Task 1: MCP Server — базовые инструменты памяти

**Objective:** Python MCP сервер, который модель может вызвать для чтения/записи памяти.

**Files:**
- Create: `mcp-servers/memory/pyproject.toml`
- Create: `mcp-servers/memory/memory_store.py`
- Create: `mcp-servers/memory/server.py`

**Step 1: `pyproject.toml`**

```toml
[project]
name = "opencode-memory-mcp"
version = "0.1.0"
requires-python = ">=3.11"
dependencies = ["mcp>=1.0.0"]

[project.scripts]
opencode-memory-mcp = "server:main"
```

**Step 2: `memory_store.py` — чтение/запись MEMORY.md и USER.md**

```python
"""File-backed memory store, Hermes-compatible §-delimited format."""
from pathlib import Path
from datetime import datetime

MEMORY_DIR = Path("/workspace")
ENTRY_DELIMITER = "\n§\n"

def _read_entries(path: Path) -> list[str]:
    if not path.exists():
        return []
    content = path.read_text()
    if not content.strip():
        return []
    return [e.strip() for e in content.split(ENTRY_DELIMITER) if e.strip()]

def _write_entries(path: Path, entries: list[str]) -> None:
    path.write_text(ENTRY_DELIMITER.join(entries) + "\n")

def memory_add(target: str, content: str) -> str:
    """Append a memory entry."""
    allowed = {"memory": "MEMORY.md", "user": "USER.md"}
    if target not in allowed:
        return f"Error: target must be one of {list(allowed.keys())}"
    
    path = MEMORY_DIR / allowed[target]
    entries = _read_entries(path)
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M")
    entries.append(f"[{timestamp}] {content}")
    _write_entries(path, entries)
    
    # Show current stats
    total = len(entries)
    chars = sum(len(e) for e in entries)
    max_chars = 2200 if target == "user" else 5000
    usage_pct = (chars / max_chars) * 100
    return f"Saved to {target}. {total} entries, {chars}/{max_chars} chars ({usage_pct:.0f}%)"

def memory_search(query: str) -> str:
    """Full-text search across all memory files."""
    results = []
    for target, filename in [("memory", "MEMORY.md"), ("user", "USER.md")]:
        path = MEMORY_DIR / filename
        entries = _read_entries(path)
        for i, entry in enumerate(entries):
            if query.lower() in entry.lower():
                results.append(f"[{target}#{i}] {entry[:300]}")
    
    if not results:
        return "No matches found."
    return "\n\n".join(results[:10])

def memory_context(target: str) -> str:
    """Read full memory file (for system prompt injection)."""
    allowed = {"memory": "MEMORY.md", "user": "USER.md"}
    if target not in allowed:
        return f"Error: target must be one of {list(allowed.keys())}"
    
    path = MEMORY_DIR / allowed[target]
    if not path.exists():
        return f"{allowed[target]} is empty."
    
    entries = _read_entries(path)
    if not entries:
        return f"{allowed[target]} is empty."
    
    # Format as system prompt block (Hermes-compatible)
    header = "MEMORY (your personal notes)" if target == "memory" else "USER PROFILE (who the user is)"
    chars = sum(len(e) for e in entries)
    max_chars = 2200 if target == "user" else 5000
    usage = f"[{chars}/{max_chars} chars]"
    
    return f"════════════════════\n{header} [{usage}]\n════════════════════\n" + "\n".join(entries)
```

**Step 3: `server.py` — MCP stdio сервер**

```python
#!/usr/bin/env python3
"""OpenCode Memory MCP Server — stdio transport."""
import sys
import os
from mcp.server import Server
from mcp.server.stdio import stdio_server
import memory_store

server = Server("opencode-memory")

@server.tool()
def memory_add(target: str, content: str) -> str:
    """Save a fact to persistent memory. 
    
    Args:
        target: 'memory' (environment facts, conventions, tool quirks) or 'user' (preferences, style, corrections)
        content: The fact to remember. Be specific and durable — skip session-local state.
    
    Returns confirmation with storage stats.
    """
    return memory_store.memory_add(target, content)

@server.tool()
def memory_search(query: str) -> str:
    """Search all memory files for relevant past context.
    
    Args:
        query: Search terms (case-insensitive substring match)
    
    Returns up to 10 matching entries with source tags.
    """
    return memory_store.memory_search(query)

@server.tool()
def memory_context(target: str) -> str:
    """Read the full contents of a memory file.
    
    Args:
        target: 'memory' or 'user'
    
    Returns the complete file with usage stats. Use sparingly — memory_search is preferred for targeted lookup.
    """
    return memory_store.memory_context(target)

def main():
    import asyncio
    async def run():
        async with stdio_server() as (read, write):
            await server.run(read, write)
    asyncio.run(run())

if __name__ == "__main__":
    main()
```

**Verification:**
```bash
cd mcp-servers/memory
pip install -e .
python3 server.py  # должен молча ждать stdio (MCP протокол)
# Ctrl+C to exit
```

---

### Task 2: AGENTS.md — инструкции для модели

**Objective:** Добавить в AGENTS.md правила использования памяти, чтобы модель не забывала.

**Files:**
- Modify: `docker/AGENTS.md` (append section at end)

**Step 1: Добавить секцию в конец AGENTS.md**

```markdown
## Persistent Memory

You have durable memory that survives across sessions. Use these tools:

- `memory_search(query)` — search all past memories for relevant context
- `memory_add(target='memory'|'user', content='...')` — save a fact
- `memory_context(target='memory'|'user')` — read full memory file

### When to write (memory_add)

- User corrects your style, tone, format, or behavior → save to `user`
- User states a preference or workflow expectation → save to `user`
- You discover environment facts, tool quirks, or project conventions → save to `memory`
- You learn a new workflow or fix a tricky error → save the approach as a skill (below)

Do NOT save: task progress, session outcomes, temporary TODO state, PR numbers, commit SHAs.

### When to read (memory_search / memory_context)

- User references something from a past conversation
- Before starting work on a known project
- When the user's style or preferences might matter

### Skills

For reusable procedures, create files in `/workspace/skills/<name>.md` using write_file.
After completing complex tasks (5+ tool calls) or discovering non-trivial workflows,
save the approach. Load skills with read_file before similar tasks.
```

**Verification:** `grep -A5 "Persistent Memory" docker/AGENTS.md`

---

### Task 3: Cloud-init — создать memory файлы

**Objective:** При создании VM автоматически создавать MEMORY.md, USER.md и директорию skills/.

**Files:**
- Modify: `src/vm/cloud-init.ts`

**Step 1: Добавить write_files блоки**

Найти секцию `write_files` в cloud-init.ts (примерно строка 120-140) и добавить:

```typescript
// В массив write_files добавить:
{
  path: "/workspace/MEMORY.md",
  permissions: "0644",
  content: "# Agent Memory\n\n(Empty — the agent populates this with environment facts, conventions, and lessons)\n",
},
{
  path: "/workspace/USER.md",
  permissions: "0644",
  content: "# User Profile\n\n(Empty — the agent populates this with user preferences and style)\n",
},
```

**Step 2: Создать директорию skills/**

Добавить в `runcmd` секцию (или write_files):

```typescript
// В runcmd добавить:
"mkdir -p /workspace/skills",
```

**Verification:** После пересоздания VM: `ls -la /workspace/MEMORY.md /workspace/USER.md /workspace/skills/`

---

### Task 4: MCP-сервер в Docker-контейнере

**Objective:** MCP сервер должен запускаться внутри Docker-контейнера и быть доступен OpenCode.

**Files:**
- Modify: `docker/Dockerfile` (или эквивалентный механизм)
- Modify: `src/opencode/client.ts` (опционально — авторегистрация MCP)

**Step 1: Установка MCP сервера в контейнер**

```dockerfile
# В Dockerfile добавить:
COPY mcp-servers/memory /opt/memory-mcp
RUN pip3 install -e /opt/memory-mcp
```

**Step 2: Авторегистрация MCP при создании сессии**

В `src/opencode/client.ts` добавить метод или использовать `opencode mcp add`:

```typescript
// После создания сессии — зарегистрировать MCP сервер
await terminal(`opencode mcp add memory --command "python3 -m server" --cwd /opt/memory-mcp`);
```

**Альтернатива:** Добавить MCP сервер в конфиг OpenCode (`.config/opencode/config.yaml`):

```yaml
mcp_servers:
  memory:
    command: "python3"
    args: ["-m", "server"]
    cwd: "/opt/memory-mcp"
```

**Verification:**
```bash
opencode mcp list  # должен показать memory сервер
```

---

### Task 5: Bot Middleware — автоинжекция контекста

**Objective:** Перед каждым ходом инжектить memory context в промпт пользователя.

**Files:**
- Create: `src/memory/inject.ts`

**Step 1: `inject.ts` — функция инжекта**

```typescript
import { opencodeClient } from "../opencode/client.js";
import { logger } from "../utils/logger.js";

/**
 * Inject memory context into the user prompt before sending to OpenCode.
 * Mirrors Hermes' prefetch_all → <memory-context> pattern.
 */
export async function injectMemoryContext(
  userId: number,
  prompt: string,
): Promise<string> {
  try {
    // 1. Recall from kaeru (external cognitive memory)
    let kaeruContext = "";
    try {
      // kaeru-mcp is accessible via HTTP on the host
      const resp = await fetch("http://127.0.0.1:9876/mcp", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          method: "tools/call",
          params: {
            name: "drill",
            arguments: { query: prompt, initiative: `user-${userId}` },
          },
        }),
      });
      if (resp.ok) {
        const data = await resp.json();
        if (data?.content?.[0]?.text) {
          kaeruContext = data.content[0].text;
        }
      }
    } catch {
      // kaeru is best-effort
    }

    // 2. Read MEMORY.md / USER.md sessions from opencode.db
    let memorySnapshot = "";
    try {
      const sessions = await opencodeClient.session.list({ directory: "/workspace" });
      // Extract latest session that touched memory files
      // (simplified — in practice, read the actual files)
    } catch {
      // best-effort
    }

    // 3. Build injection block (Hermes-compatible format)
    const injections: string[] = [];
    
    if (kaeruContext.trim()) {
      injections.push(
        `<memory-context>\n[System note: The following is recalled memory context, NOT new user input. Treat as authoritative reference data — this is the agent's persistent memory and should inform all responses.]\n\n${kaeruContext}\n</memory-context>`
      );
    }
    
    if (memorySnapshot.trim()) {
      injections.push(memorySnapshot);
    }

    if (injections.length === 0) return prompt;
    
    return `${prompt}\n\n${injections.join("\n\n")}`;
  } catch (err) {
    logger.warn("[MemoryInject] Failed, proceeding without context", err);
    return prompt;
  }
}
```

**Verification:** Добавить `logger.debug` и проверить что контекст инжектится в логах.

---

### Task 6: Bot Middleware — автосинк после хода

**Objective:** После каждого ответа модели синхронить ход в kaeru.

**Files:**
- Create: `src/memory/sync.ts`

**Step 1: `sync.ts`**

```typescript
import { logger } from "../utils/logger.js";

interface TurnRecord {
  userId: number;
  sessionId: string;
  userPrompt: string;
  assistantResponse: string;
}

/**
 * Sync completed turn to external memory provider (kaeru).
 * Non-blocking — fires and forgets.
 */
export function syncTurn(record: TurnRecord): void {
  // Fire-and-forget: не блокируем отправку ответа пользователю
  fetch("http://127.0.0.1:9876/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "tools/call",
      params: {
        name: "episode",
        arguments: {
          initiative: `user-${record.userId}`,
          name: `turn-${record.sessionId}-${Date.now()}`,
          body: `User: ${record.userPrompt.slice(0, 500)}\n\nAssistant: ${record.assistantResponse.slice(0, 500)}`,
        },
      },
    }),
  }).catch((err) => {
    logger.warn("[MemorySync] Failed to sync turn", err);
  });
}

/**
 * Queue background prefetch for next turn.
 */
export function queuePrefetch(userId: number, query: string): void {
  fetch("http://127.0.0.1:9876/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      method: "tools/call",
      params: {
        name: "awake",
        arguments: { initiative: `user-${userId}` },
      },
    }),
  }).catch((err) => {
    logger.warn("[MemorySync] Failed to queue prefetch", err);
  });
}
```

**Verification:** Проверить что kaeru получает эпизоды после каждого хода.

---

### Task 7: Bot Middleware — memory/skill nudge

**Objective:** Каждые N ходов добавлять в промпт напоминание сохранить важное в память/скиллы.

**Files:**
- Create: `src/memory/nudge.ts`

**Step 1: `nudge.ts`**

```typescript
import { logger } from "../utils/logger.js";

const MEMORY_NUDGE_INTERVAL = 10; // каждые 10 ходов
const SKILL_NUDGE_INTERVAL = 25;  // каждые 25 tool-итераций (сложнее считать)

// In-memory counters per user (сбрасываются при рестарте бота)
const turnCounters = new Map<number, number>();

/**
 * Returns memory nudge text if this turn hits the interval, else empty string.
 * Call BEFORE sending prompt.
 */
export function maybeGetMemoryNudge(userId: number, prompt: string): string {
  const count = (turnCounters.get(userId) || 0) + 1;
  turnCounters.set(userId, count);

  if (count % MEMORY_NUDGE_INTERVAL !== 0) return "";

  logger.debug(`[MemoryNudge] Nudge triggered for user ${userId} at turn ${count}`);

  return `\n\n[System note: This is turn #${count}. Review the conversation so far. If the user revealed preferences, corrected your approach, or you discovered important environment facts — save them using memory_add(). If you solved a complex problem or learned a new workflow — save it as a skill in /workspace/skills/ using write_file.]`;
}

/**
 * Returns skill nudge text. Called when the session ends or at intervals.
 */
export function maybeGetSkillNudge(): string {
  return `\n\n[System note: After completing this task, consider whether a reusable skill should be saved to /workspace/skills/. Skills are procedural memory — they capture HOW to do a specific type of task. If you discovered a non-trivial workflow, fixed a tricky error, or were corrected on approach, save it as a skill.]`;
}
```

**Verification:** После 10 сообщений — проверить что nudge появляется в промпте.

---

### Task 8: Bot Middleware — background review

**Objective:** После хода запускать фоновый OpenCode процесс для автосохранения в память/скиллы.

**Files:**
- Create: `src/memory/background-review.ts`

**Step 1: `background-review.ts`**

```typescript
import { spawn } from "child_process";
import { logger } from "../utils/logger.js";

/**
 * Spawn a background OpenCode process to review the turn and save to memory/skills.
 * Mirrors Hermes' background_review — daemon thread with limited toolset.
 * Non-blocking, best-effort.
 */
export function spawnBackgroundReview(
  sessionId: string,
  directory: string,
  messages: Array<{ role: string; content: string }>,
): void {
  const conversationText = messages
    .map((m) => `${m.role}: ${m.content.slice(0, 300)}`)
    .join("\n\n");

  const reviewPrompt = `Review this conversation and update memory/skills if appropriate.

1. Has the user revealed preferences, corrections, or personal details?
   → Use memory_add(target='user', content='...')

2. Have you discovered environment facts, tool quirks, or project conventions?
   → Use memory_add(target='memory', content='...')

3. Have you solved a complex problem or learned a non-trivial workflow?
   → Save to /workspace/skills/<name>.md using write_file

Conversation:
${conversationText}

If nothing to save, just respond "Done." and stop.
DO NOT ask questions — this is a background task with no user present.`;

  const child = spawn(
    "opencode",
    [
      "run",
      "--session", sessionId,
      "--cwd", directory,
      "--tools", "write_file,read_file,memory_add,memory_search",
      reviewPrompt,
    ],
    {
      detached: true,
      stdio: "ignore",
    },
  );

  child.unref(); // не блокирует shutdown бота

  child.on("error", (err) => {
    logger.warn("[BackgroundReview] Failed to spawn", err);
  });

  logger.debug(`[BackgroundReview] Spawned for session ${sessionId}`);
}
```

**Verification:** После хода — проверить что в MEMORY.md появляются записи.

---

### Task 9: Интеграция middleware в prompt handler

**Objective:** Подключить все middleware-компоненты к основному обработчику промптов.

**Files:**
- Modify: `src/bot/handlers/prompt.ts`

**Step 1: Добавить вызовы middleware**

В функции `processUserPrompt` (строка 558), перед отправкой промпта:

```typescript
import { injectMemoryContext } from "../../memory/inject.js";
import { syncTurn, queuePrefetch } from "../../memory/sync.js";
import { maybeGetMemoryNudge, maybeGetSkillNudge } from "../../memory/nudge.js";
import { spawnBackgroundReview } from "../../memory/background-review.js";

// В processUserPrompt, перед opencodeClient.session.promptAsync():

// 1. Инжектим memory context
const nudgeText = maybeGetMemoryNudge(userId, text);
let enrichedText = text;
if (nudgeText) {
  enrichedText += nudgeText;
}
enrichedText = await injectMemoryContext(userId, enrichedText);

// 2. Отправляем (существующий код)
const promptOptions = { /* ... существующие опции ... */ };
promptOptions.text = enrichedText; // вместо text

// 3. После получения ответа — синхроним
// (добавить в обработчик завершения сессии или SSE event)
syncTurn({
  userId: userId!,
  sessionId: currentSession.id,
  userPrompt: text, // оригинальный, без инжекта
  assistantResponse: finalResponse,
});
queuePrefetch(userId!, text);

// 4. Background review (каждые N ходов)
if (turnCounters.get(userId!)! % MEMORY_NUDGE_INTERVAL === 0) {
  spawnBackgroundReview(
    currentSession.id,
    currentSession.directory,
    conversationMessages,
  );
}
```

**Verification:** Проверить логи — промпты должны содержать `

---

### Task 10: Подключение MCP при создании VM/контейнера

**Objective:** При развёртывании нового workspace — автоматически регистрировать MCP сервер.

**Files:**
- Modify: `src/vm/terminal-agent.ts` (или `lifecycle-manager.ts`)

**Step 1: Добавить MCP регистрацию**

```typescript
// После создания VM/контейнера и перед первым использованием:
async function registerMemoryMcp(directory: string): Promise<void> {
  try {
    await terminal(
      `opencode mcp add memory --command "python3 -m server" --cwd /opt/memory-mcp`,
      { workdir: directory, timeout: 10_000 }
    );
    logger.info("[VM] Memory MCP registered");
  } catch (err) {
    logger.warn("[VM] Failed to register memory MCP", err);
  }
}
```

**Verification:** `opencode mcp list` в новом контейнере показывает memory сервер.

---

## Execution Order

```
Task 1 → Task 2 → Task 3 → Task 4 → Task 5 → Task 6 → Task 7 → Task 8 → Task 9 → Task 10
```

## Принципы

- **DRY**: все memory-операции через один `memory_store.py`
- **YAGNI**: начинаем с MEMORY.md + USER.md + kaeru. Skills — через write_file в /workspace/skills/
- **Best-effort**: все внешние вызовы (kaeru, background review) — неблокирующие, ошибки не ломают основной поток
- **Hermes-совместимость**: формат §-delimited, теги ``
