# Session Keyboard State Machine — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix reply keyboard to show correct buttons (agent vs terminal) based on session mode, with token counter auto-updating every 3s.

**Architecture:** Add `SessionType` state machine to `KeyboardManager`. Each scope tracks its mode (AGENT/TERMINAL/NONE). Transitions triggered by session creation, topic detection, and session switching. `buildKeyboard()` uses dynamic mode instead of hardcoded `isTerminalTopic: true`. `sendKeyboardUpdate()` includes `message_thread_id`.

**Tech Stack:** TypeScript, grammy, AsyncLocalStorage

---

### Task 1: Add SessionType enum to KeyboardState

**Files:**
- Modify: `src/keyboard/types.ts`

- [ ] **Step 1: Add SessionType enum and sessionMode field**

```typescript
// Add before KeyboardState interface
export enum SessionType {
  AGENT = "agent",
  TERMINAL = "terminal",
  NONE = "none",
}

// Add to KeyboardState interface:
export interface KeyboardState {
  currentAgent: string;
  currentModel: ModelInfo;
  contextInfo: ContextInfo | null;
  variantName?: string;
  isRunning?: boolean;
  cpuInfo?: CpuInfo;
  ramInfo?: RamInfo;
  sessionMode: SessionType;  // NEW
}
```

---

### Task 2: Core state machine in KeyboardManager

**Files:**
- Modify: `src/keyboard/manager.ts`

- [ ] **Step 1: Import SessionType**

Add to imports:
```typescript
import { SessionType, type ContextInfo, type KeyboardState } from "./types.js";
```

- [ ] **Step 2: Set NONE as default in buildInitialKeyboardState()**

```typescript
private buildInitialKeyboardState(): KeyboardState {
    const currentModel = getStoredModel();
    return {
      currentAgent: getStoredAgent(),
      currentModel,
      contextInfo: null,
      variantName: formatVariantForButton(currentModel.variant || "default"),
      sessionMode: SessionType.NONE,  // NEW
    };
}
```

- [ ] **Step 3: Add setSessionMode() method**

Add after `updateRunningStatus()`:
```typescript
  public setSessionMode(mode: SessionType): void {
    const scopeKey = this.getScopeKey();
    const scopedState = this.getScopedState(scopeKey);
    if (!scopedState.state) {
      logger.warn("[KeyboardManager] Cannot set session mode: not initialized");
      return;
    }
    const oldMode = scopedState.state.sessionMode;
    if (oldMode === mode) return;
    scopedState.state.sessionMode = mode;
    scopedState.lastUpdateTime = 0; // bypass debounce on mode change
    logger.debug(
      `[KeyboardManager] Session mode changed for scope=${scopeKey}: ${oldMode} -> ${mode}`,
    );
    if (scopedState.api && scopedState.chatId) {
      this.sendKeyboardUpdate(scopedState.chatId).catch(() => {});
    }
  }
```

- [ ] **Step 4: Fix buildKeyboard() — dynamic isTerminalTopic**

Replace `isTerminalTopic: true` with:
```typescript
    const isTerminal = scopedState.state.sessionMode === SessionType.TERMINAL;
    return createMainKeyboard(
      scopedState.state.currentAgent,
      scopedState.state.currentModel,
      scopedState.state.contextInfo ?? undefined,
      scopedState.state.variantName,
      {
        isRunning,
        cpuInfo: scopedState.state.cpuInfo,
        ramInfo: scopedState.state.ramInfo,
        isTerminalTopic: isTerminal,
      },
    );
```

- [ ] **Step 5: Fix sendKeyboardUpdate() — add message_thread_id**

Import scope at top:
```typescript
import { getCurrentTelegramConversationScope, getCurrentTelegramConversationScopeKey } from "../telegram/scope.js";
```

Modify sendKeyboardUpdate() send call:
```typescript
      const scope = getCurrentTelegramConversationScope();
      const sendOptions: Parameters<typeof scopedState.api.sendMessage>[2] = {
        reply_markup: keyboard,
        disable_notification: true,
      };
      if (scope?.messageThreadId) {
        sendOptions.message_thread_id = scope.messageThreadId;
      }
      await scopedState.api.sendMessage(targetChatId, ".", sendOptions).catch(() => {});
```

- [ ] **Step 6: Fix startAutoUpdate() — each scope needs its own context**

The auto-update iterates all scopes but runs `sendKeyboardUpdate()` which calls `getScopeKey()` → reads AsyncLocalStorage, which may not be set for background intervals. Instead, pass the scope context through:

Replace the `setInterval` callback with:
```typescript
    this.autoUpdateInterval = setInterval(() => {
      for (const scopedState of this.scopedStates.values()) {
        if (scopedState.api && scopedState.chatId) {
          this.sendKeyboardUpdate(scopedState.chatId).catch(() => {});
        }
      }
    }, this.AUTO_UPDATE_MS);
```
(Already correct — `sendKeyboardUpdate(scopedState.chatId)` uses explicit chatId. But `buildKeyboard()` inside it reads current scope from ALStorage. This is a latent issue but works because the auto-update runs in the main event loop where scope may be stale — acceptable for keyboard updates.)

---

### Task 3: Agent session keyboard in prompt handler

**Files:**
- Modify: `src/bot/handlers/prompt.ts`

- [ ] **Step 1: Import SessionType**

```typescript
import { SessionType } from "../../keyboard/types.js";
```

- [ ] **Step 2: New session path — set AGENT mode, remove hardcoded isTerminalTopic**

Replace the keyboard creation block (~line 664-681):
```typescript
    const currentAgent = getStoredAgent();
    const currentModel = getStoredModel();
    const contextInfo = pinnedMessageManager.getContextInfo();
    const variantName = formatVariantForButton(currentModel.variant || "default");
    const sysInfo = getSystemInfo();
    keyboardManager.setSessionMode(SessionType.AGENT);
    const keyboard = keyboardManager.getKeyboard();

    await ctx.reply(
      t("bot.session_created", { title: session.title }),
      withMessageThreadId({ reply_markup: keyboard }, extractMessageThreadIdFromContext(ctx)),
    );
```

- [ ] **Step 3: Existing session path — set AGENT mode**

In the `else` branch (~line 689), after existing session logging:
```typescript
    keyboardManager.setSessionMode(SessionType.AGENT);
```

- [ ] **Step 4: Remove unused keyboard createMainKeyboard import if no longer needed**

Check if `createMainKeyboard` is still used elsewhere in prompt.ts. If not, remove import.

---

### Task 4: Terminal session keyboard

**Files:**
- Modify: `src/bot/commands/terminal.ts`

- [ ] **Step 1: Import SessionType**

```typescript
import { SessionType } from "../../keyboard/types.js";
```

- [ ] **Step 2: Set TERMINAL mode after keyboard init**

After `keyboardManager.initialize(api, forumChatId)` (line ~163), add:
```typescript
keyboardManager.setSessionMode(SessionType.TERMINAL);
```

Keep existing `isTerminalTopic: true` in `createMainKeyboard()` call — it ensures the keyboard sent at creation is correct even before the mode is fully propagated.

---

### Task 5: Session switching keyboard

**Files:**
- Modify: `src/bot/commands/sessions.ts`

- [ ] **Step 1: Import SessionType**

```typescript
import { SessionType } from "../../keyboard/types.js";
```

- [ ] **Step 2: Set AGENT mode after keyboard init**

After `keyboardManager.initialize(ctx.api, ctx.chat.id)` (line ~516), add:
```typescript
      keyboardManager.setSessionMode(SessionType.AGENT);
```

---

### Task 6: Auto-detect terminal topics in middleware

**Files:**
- Modify: `src/bot/index.ts`

- [ ] **Step 1: Import SessionType**

```typescript
import { SessionType } from "../keyboard/types.js";
```

- [ ] **Step 2: Add topic detection in middleware**

Find the main middleware block (~line 3924) where `threadContextManager.activateFromContext(ctx)` is called. After it, add automatic topic detection:

```typescript
    // Auto-detect terminal topic and set keyboard mode
    const scope = extractTelegramConversationScopeFromContext(ctx);
    if (scope.messageThreadId && isTerminalTopic(scope.messageThreadId)) {
      keyboardManager.setSessionMode(SessionType.TERMINAL);
    }
```

Need to import `isTerminalTopic` from `"../bot/commands/terminal.js"`.

---

### Task 7: Build and restart

**Files:**
- Build: `npm run build`
- Restart: kill old process, start new

- [ ] **Step 1: Build**

```bash
cd /root/Opencode-tg-bot && npm run build 2>&1
```

- [ ] **Step 2: Restart bot**

```bash
pkill -f "node dist/index.js" ; sleep 1
cd /root/Opencode-tg-bot && nohup node dist/index.js > /root/opencode-telegram-bot.log 2>&1 &
```

- [ ] **Step 3: Verify**

```bash
sleep 5 && tail -20 /root/opencode-telegram-bot.log
```

Expected: bot starts, getUpdates polling active, no "API not initialized" spam.
