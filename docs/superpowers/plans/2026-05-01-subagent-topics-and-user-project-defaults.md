# Subagent Topics and User Project Defaults Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-user subagent forum-topic routing with silent child-session delivery and timed topic deletion, while also making `/projects` persist the selected project as that user's default.

**Architecture:** Keep `src/summary/aggregator.ts` as the source of truth for subagent lifecycle data, then add a Telegram-specific subagent-topic service that can override session routing for child sessions only. Mirror the existing user-default agent/model pattern for project persistence so explicit `/projects` selections become per-user defaults, while internal project restores remain conversation-scoped.

**Tech Stack:** TypeScript, Node.js 20+, grammY Telegram API, existing settings/thread/session managers, Vitest

---

## File Structure

### Files to modify

- `src/settings/manager.ts`
  - Add user-scoped subagent topic settings.
  - Add user-scoped default project support.
  - Split project selection into persisted user-default vs conversation-only setters.
- `src/bot/commands/projects.ts`
  - Keep `/projects` as the user-facing entrypoint that persists the selected project as a user default.
- `src/bot/commands/settings.ts`
  - Add settings UI for subagent topic toggle and auto-delete timeout.
- `src/bot/index.ts`
  - Integrate subagent topic service into session routing, fallback rendering, and finalization/deletion lifecycle.
- `src/bot/handlers/question.ts`
  - Allow child-session question messages to target dedicated subagent topics silently.
- `src/bot/handlers/permission.ts`
  - Allow child-session permission messages to target dedicated subagent topics silently.
- `src/bot/utils/message-thread.ts`
  - Add a reusable helper that merges `message_thread_id` and `disable_notification` into Telegram send options.
- `src/bot/utils/telegram-text.ts`
  - Reuse the merged delivery-target helper for text sends so silent child-topic replies stay centralized.
- `src/thread/manager.ts`
  - Switch internal project restores from persisted `/projects` behavior to a conversation-scoped setter.
- `src/bot/handlers/prompt.ts`
  - Use the conversation-scoped project setter in automatic restoration paths so passive routing does not rewrite the user's default project.
- `src/i18n/en.ts`
- `src/i18n/ru.ts`
- `src/i18n/de.ts`
- `src/i18n/es.ts`
- `src/i18n/fr.ts`
- `src/i18n/zh.ts`
  - Add settings labels for subagent topics and timeout choices.
- `CHANGELOG.md`
  - Record the new topic-routing feature and `/projects` default-persistence change.
- `PRODUCT.md`
  - Update the product scope and configuration bullets for per-user subagent topic routing and per-user project defaults.

### Files to create

- `src/bot/subagent-topics/service.ts`
  - In-memory registry, topic creation/deletion, child-session binding, scope/target overrides, and fallback bookkeeping.
- `tests/bot/subagent-topics/service.test.ts`
  - Unit tests for eligibility, topic creation, binding, silent delivery target, and timed deletion.

### Tests to modify

- `tests/settings/manager.test.ts`
  - Cover user-default project behavior and user-scoped subagent topic settings.
- `tests/bot/commands/settings.test.ts`
  - Cover new settings rows and timeout callbacks.
- `tests/bot/commands/projects.handle-project-select.test.ts`
  - Confirm `/projects` still selects successfully while using the persisted setter.
- `tests/bot/handlers/question.test.ts`
  - Confirm child-topic question sends include `disable_notification: true` and thread routing.
- `tests/bot/handlers/permission.test.ts`
  - Confirm child-topic permission sends include `disable_notification: true` and thread routing.
- `tests/bot/index.local-file-follow-up.test.ts`
  - Cover forum-topic routing, fallback to current behavior, no duplicate child outputs, and timed deletion scheduling from the bot integration side.

---

### Task 1: Persist `/projects` as a user default without breaking passive routing

**Files:**

- Modify: `src/settings/manager.ts`
- Modify: `src/thread/manager.ts`
- Modify: `src/bot/handlers/prompt.ts`
- Modify: `src/bot/commands/projects.ts`
- Test: `tests/settings/manager.test.ts`
- Test: `tests/bot/commands/projects.handle-project-select.test.ts`

- [ ] **Step 1: Write the failing settings tests for user-default projects**

Add these tests to `tests/settings/manager.test.ts` next to the existing user-default agent/model coverage:

```ts
it("uses the user default project across new topics without leaking across users", () => {
  runWithTelegramConversationScope(scopeA, () => {
    setCurrentProject({ id: "project-a", worktree: "/repo-a" });
  });

  expect(runWithTelegramConversationScope(scopeAOtherTopic, () => getCurrentProject())).toEqual({
    id: "project-a",
    worktree: "/repo-a",
  });

  expect(runWithTelegramConversationScope(scopeB, () => getCurrentProject())).toBeUndefined();
});

it("does not rewrite the stored user default project when a conversation-only project is restored", () => {
  runWithTelegramConversationScope(scopeA, () => {
    setCurrentProject({ id: "project-a", worktree: "/repo-a" });
  });

  runWithTelegramConversationScope(scopeAOtherTopic, () => {
    setConversationCurrentProject({ id: "project-b", worktree: "/repo-b" });
  });

  expect(runWithTelegramConversationScope(scopeAMainThread, () => getCurrentProject())).toEqual({
    id: "project-a",
    worktree: "/repo-a",
  });
});
```

- [ ] **Step 2: Run the focused settings test file and verify the new cases fail**

Run:

```bash
npx vitest run tests/settings/manager.test.ts
```

Expected: FAIL with TypeScript/runtime errors similar to `setConversationCurrentProject is not defined` or assertion failures where `getCurrentProject()` stays topic-scoped instead of falling back to a user default.

- [ ] **Step 3: Implement user-default project support and conversation-only project setters**

Update `src/settings/manager.ts` to mirror the existing agent/model pattern for projects. The new code should look like this shape:

```ts
export interface ScopedUserSettings {
  ttsEnabled?: boolean;
  messageStreamingEnabled?: boolean;
  thinkingClearMode?: boolean;
  locale?: Locale;
  hideThinkingMessages?: boolean;
  hideToolCallMessages?: boolean;
  hideToolFileMessages?: boolean;
  defaultAgent?: string;
  defaultModel?: ModelInfo;
  defaultProject?: ProjectInfo;
  subagentTopicsEnabled?: boolean;
  subagentTopicAutoDeleteMinutes?: number;
}

function getUserDefaultProject(): ProjectInfo | undefined {
  return cloneProjectInfo(getUserScopedSettings()?.defaultProject);
}

function setUserDefaultProject(projectInfo: ProjectInfo): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.defaultProject = cloneProjectInfo(projectInfo);
}

export function getCurrentProject(): ProjectInfo | undefined {
  if (isMainThreadGlobalDefaultScope()) {
    return getUserDefaultProject();
  }

  const scopedSettings = getConversationScopedSettings();
  if (scopedSettings?.currentProject) {
    return cloneProjectInfo(scopedSettings.currentProject);
  }

  const userDefaultProject = getUserDefaultProject();
  if (userDefaultProject) {
    return userDefaultProject;
  }

  if (getActiveConversationScopeKey()) {
    return undefined;
  }

  return cloneProjectInfo(currentSettings.currentProject);
}

export function setCurrentProject(projectInfo: ProjectInfo): void {
  setCurrentProjectSelection(projectInfo, { persistAsUserDefault: true });
}

export function setConversationCurrentProject(projectInfo: ProjectInfo): void {
  setCurrentProjectSelection(projectInfo, { persistAsUserDefault: false });
}
```

Then finish the shared setter exactly like the model logic and update passive call sites:

```ts
function setCurrentProjectSelection(
  projectInfo: ProjectInfo,
  options: DefaultSelectionOptions,
): void {
  if (isMainThreadGlobalDefaultScope()) {
    if (options.persistAsUserDefault) {
      setUserDefaultProject(projectInfo);
    }
    currentSettings.currentProject = cloneProjectInfo(projectInfo);
    void writeSettingsFile(currentSettings);
    return;
  }

  const scopedSettings = getOrCreateConversationScopedSettings();
  if (scopedSettings) {
    scopedSettings.currentProject = cloneProjectInfo(projectInfo);
    if (options.persistAsUserDefault) {
      setUserDefaultProject(projectInfo);
    }
  } else {
    currentSettings.currentProject = cloneProjectInfo(projectInfo);
  }

  void writeSettingsFile(currentSettings);
}
```

And switch passive project restores to the non-persisting setter:

```ts
// src/thread/manager.ts
import { setConversationCurrentProject } from "../settings/manager.js";

if (boundProject && projectChanged) {
  setConversationCurrentProject(cloneProject(boundProject));
}

// src/bot/handlers/prompt.ts
setConversationCurrentProject(defaultProject);
```

Keep `/projects` on `setCurrentProject(selectedProject)` so explicit user selection persists.

- [ ] **Step 4: Re-run the focused project/default tests and verify they pass**

Run:

```bash
npx vitest run tests/settings/manager.test.ts tests/bot/commands/projects.handle-project-select.test.ts
```

Expected: PASS for the new user-default project cases and the existing `/projects` callback behavior.

- [ ] **Step 5: Commit the project-default slice if commits are requested for the execution session**

```bash
git add src/settings/manager.ts src/thread/manager.ts src/bot/handlers/prompt.ts src/bot/commands/projects.ts tests/settings/manager.test.ts tests/bot/commands/projects.handle-project-select.test.ts
git commit -m "feat: persist user project defaults"
```

### Task 2: Add user-scoped subagent topic settings and Telegram settings UI

**Files:**

- Modify: `src/settings/manager.ts`
- Modify: `src/bot/commands/settings.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/de.ts`
- Modify: `src/i18n/es.ts`
- Modify: `src/i18n/fr.ts`
- Modify: `src/i18n/zh.ts`
- Test: `tests/settings/manager.test.ts`
- Test: `tests/bot/commands/settings.test.ts`

- [ ] **Step 1: Write failing tests for the new subagent-topic user settings**

Add a persistence test in `tests/settings/manager.test.ts`:

```ts
it("stores subagent topic preferences per user across topics", () => {
  runWithTelegramConversationScope(scopeA, () => {
    setSubagentTopicsEnabled(true);
    setSubagentTopicAutoDeleteMinutes(15);
  });

  expect(
    runWithTelegramConversationScope(scopeAOtherTopic, () => ({
      enabled: getSubagentTopicsEnabled(),
      timeout: getSubagentTopicAutoDeleteMinutes(),
    })),
  ).toEqual({ enabled: true, timeout: 15 });

  expect(
    runWithTelegramConversationScope(scopeB, () => ({
      enabled: getSubagentTopicsEnabled(),
      timeout: getSubagentTopicAutoDeleteMinutes(),
    })),
  ).toEqual({ enabled: false, timeout: 10 });
});
```

Add a settings-menu test in `tests/bot/commands/settings.test.ts`:

```ts
expect(rows.map((row) => row[0]?.callback_data)).toEqual([
  "settings:language",
  "settings:toggle:hide_thinking",
  "settings:toggle:hide_tool_calls",
  "settings:toggle:hide_tool_files",
  "settings:toggle:subagent_topics",
  "settings:subagent_timeout",
  "inline:cancel:settings",
]);
```

- [ ] **Step 2: Run the focused settings/UI tests and verify they fail**

Run:

```bash
npx vitest run tests/settings/manager.test.ts tests/bot/commands/settings.test.ts
```

Expected: FAIL because the settings manager exports and new callback rows do not exist yet.

- [ ] **Step 3: Implement the settings manager accessors and the `/settings` menu rows**

Add these helpers in `src/settings/manager.ts`:

```ts
const DEFAULT_SUBAGENT_TOPIC_AUTO_DELETE_MINUTES = 10;

export function getSubagentTopicsEnabled(): boolean {
  return getUserScopedSettings()?.subagentTopicsEnabled ?? false;
}

export function setSubagentTopicsEnabled(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.subagentTopicsEnabled = enabled;
  pruneUserScopedSettings();
  void writeSettingsFile(currentSettings);
}

export function getSubagentTopicAutoDeleteMinutes(): number {
  const value = getUserScopedSettings()?.subagentTopicAutoDeleteMinutes;
  return typeof value === "number" && Number.isInteger(value) && value > 0
    ? value
    : DEFAULT_SUBAGENT_TOPIC_AUTO_DELETE_MINUTES;
}

export function setSubagentTopicAutoDeleteMinutes(minutes: number): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.subagentTopicAutoDeleteMinutes = Math.max(1, Math.trunc(minutes));
  pruneUserScopedSettings();
  void writeSettingsFile(currentSettings);
}
```

Then expand `src/bot/commands/settings.ts` with one toggle row and one timeout submenu. Use a finite set of values to keep the UI simple:

```ts
type ToggleSettingId = "hide_thinking" | "hide_tool_calls" | "hide_tool_files" | "subagent_topics";

const SUBAGENT_TIMEOUT_VALUES = [5, 10, 15, 30, 60] as const;
const SETTINGS_CALLBACK_SUBAGENT_TIMEOUT = `${SETTINGS_CALLBACK_PREFIX}subagent_timeout`;
const SETTINGS_CALLBACK_SUBAGENT_TIMEOUT_PREFIX = `${SETTINGS_CALLBACK_SUBAGENT_TIMEOUT}:`;

function buildSettingsRootKeyboard(state: SettingsRenderState): InlineKeyboard {
  return (
    new InlineKeyboard()
      // existing rows
      .text(
        t(
          "settings.subagent_topics",
          { state: formatToggleState(state.subagentTopicsEnabled, state.locale) },
          state.locale,
        ),
        `${SETTINGS_CALLBACK_TOGGLE_PREFIX}subagent_topics`,
      )
      .row()
      .text(
        t(
          "settings.subagent_topic_timeout",
          { value: String(state.subagentTopicAutoDeleteMinutes) },
          state.locale,
        ),
        SETTINGS_CALLBACK_SUBAGENT_TIMEOUT,
      )
  );
}
```

Add matching localized keys in every `src/i18n/*.ts` file, for example in `src/i18n/en.ts`:

```ts
"settings.subagent_topics": "{state} Subagent topics",
"settings.subagent_topic_timeout": "Delete subagent topics after {value}m",
"settings.subagent_topic_timeout.title": "Choose subagent topic retention",
```

- [ ] **Step 4: Re-run the focused settings tests and verify they pass**

Run:

```bash
npx vitest run tests/settings/manager.test.ts tests/bot/commands/settings.test.ts
```

Expected: PASS for the new per-user subagent-topic settings and the updated settings-menu layout.

- [ ] **Step 5: Commit the settings/UI slice if commits are requested for the execution session**

```bash
git add src/settings/manager.ts src/bot/commands/settings.ts src/i18n/en.ts src/i18n/ru.ts src/i18n/de.ts src/i18n/es.ts src/i18n/fr.ts src/i18n/zh.ts tests/settings/manager.test.ts tests/bot/commands/settings.test.ts
git commit -m "feat: add subagent topic user settings"
```

### Task 3: Build the subagent topic service and cover topic lifecycle rules in unit tests

**Files:**

- Create: `src/bot/subagent-topics/service.ts`
- Modify: `src/bot/utils/message-thread.ts`
- Test: `tests/bot/subagent-topics/service.test.ts`

- [ ] **Step 1: Write failing unit tests for topic eligibility, binding, and deletion scheduling**

Create `tests/bot/subagent-topics/service.test.ts` with focused service tests like these:

```ts
it("creates a dedicated topic for an eligible forum subagent and exposes a silent delivery target", async () => {
  const service = new SubagentTopicService({
    createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 42 }),
    deleteForumTopic: vi.fn().mockResolvedValue(true),
    setTimer: vi.fn((_, ms) => ({ ms })),
    clearTimer: vi.fn(),
  });

  await service.syncSubagent({
    userId: 777,
    chatId: 100,
    parentSessionId: "root-1",
    scope: { userId: 777, chatId: 100, messageThreadId: 1 },
    fallbackTarget: { chatId: 100, messageThreadId: 1 },
    enabled: true,
    isForumChat: true,
    autoDeleteMinutes: 10,
    subagent: {
      cardId: "card-1",
      sessionId: "child-1",
      parentSessionId: "root-1",
      agent: "explore",
      description: "Inspect repo",
      prompt: "Inspect repo",
      status: "running",
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      cost: 0,
      updatedAt: Date.now(),
    },
  });

  expect(service.getTargetForSession("child-1")).toEqual({
    chatId: 100,
    messageThreadId: 42,
    disableNotification: true,
  });
});

it("falls back without creating a topic outside forum chats", async () => {
  const service = new SubagentTopicService(/* same fake deps */);

  await service.syncSubagent({
    userId: 777,
    chatId: 100,
    parentSessionId: "root-1",
    scope: { userId: 777, chatId: 100, messageThreadId: 0 },
    fallbackTarget: { chatId: 100, messageThreadId: 0 },
    enabled: true,
    isForumChat: false,
    autoDeleteMinutes: 10,
    subagent: { ...runningSubagent, cardId: "card-2", sessionId: "child-2" },
  });

  expect(service.getTargetForSession("child-2")).toBeNull();
});

it("schedules topic deletion only after the child session final delivery is marked complete", async () => {
  const deleteForumTopic = vi.fn().mockResolvedValue(true);
  const setTimer = vi.fn((handler: () => void, _ms: number) => {
    handler();
    return { id: "timer-1" };
  });

  const service = new SubagentTopicService({
    createForumTopic: vi.fn().mockResolvedValue({ message_thread_id: 52 }),
    deleteForumTopic,
    setTimer,
    clearTimer: vi.fn(),
  });

  await service.syncSubagent(/* eligible running child */);
  service.markFinalResponseDelivered("child-1", {
    terminalStatus: "completed",
    autoDeleteMinutes: 15,
  });

  expect(setTimer).toHaveBeenCalledWith(expect.any(Function), 15 * 60 * 1000);
  expect(deleteForumTopic).toHaveBeenCalledWith(100, 52);
});
```

- [ ] **Step 2: Run the new service test file and verify it fails**

Run:

```bash
npx vitest run tests/bot/subagent-topics/service.test.ts
```

Expected: FAIL because `SubagentTopicService` does not exist yet.

- [ ] **Step 3: Implement the service and a reusable delivery-target option helper**

Create `src/bot/subagent-topics/service.ts` with a runtime-only registry and explicit dependencies so it stays unit-testable:

```ts
export interface SubagentTopicDeliveryTarget {
  chatId: number;
  messageThreadId: number;
  disableNotification: true;
}

export class SubagentTopicService {
  private readonly bindingsByCardId = new Map<string, SubagentTopicBinding>();
  private readonly bindingsBySessionId = new Map<string, SubagentTopicBinding>();

  constructor(private readonly deps: SubagentTopicServiceDeps) {}

  async syncSubagent(input: SyncSubagentInput): Promise<"dedicated" | "fallback"> {
    if (!input.enabled || !input.isForumChat || !input.subagent.sessionId) {
      return "fallback";
    }

    const existing = this.bindingsBySessionId.get(input.subagent.sessionId);
    if (existing) {
      return "dedicated";
    }

    const topic = await this.deps.createForumTopic(input.chatId, {
      name: buildSubagentTopicTitle(input.subagent),
      icon_color: 0x6fb9f0,
    });

    const binding: SubagentTopicBinding = {
      userId: input.userId,
      chatId: input.chatId,
      parentSessionId: input.parentSessionId,
      childSessionId: input.subagent.sessionId,
      subagentCardId: input.subagent.cardId,
      topicThreadId: topic.message_thread_id,
      scope: {
        userId: input.scope.userId,
        chatId: input.scope.chatId,
        messageThreadId: topic.message_thread_id,
      },
      terminalStatus: null,
      deleteTimer: null,
    };

    this.bindingsByCardId.set(binding.subagentCardId, binding);
    this.bindingsBySessionId.set(binding.childSessionId, binding);
    return "dedicated";
  }

  getTargetForSession(sessionId: string): SubagentTopicDeliveryTarget | null {
    const binding = this.bindingsBySessionId.get(sessionId);
    if (!binding) {
      return null;
    }

    return {
      chatId: binding.chatId,
      messageThreadId: binding.topicThreadId,
      disableNotification: true,
    };
  }
}
```

Also add a generic options helper in `src/bot/utils/message-thread.ts`:

```ts
export interface TelegramDeliveryTarget extends TelegramThreadTarget {
  disableNotification?: boolean;
}

export function withTelegramDeliveryTarget<T extends object>(
  options: T | undefined,
  target: TelegramDeliveryTarget | null | undefined,
): T & { message_thread_id?: number; disable_notification?: true } {
  const withThread = withMessageThreadId(options, target?.messageThreadId);
  if (!target?.disableNotification) {
    return withThread;
  }

  return {
    ...withThread,
    disable_notification: true,
  };
}
```

- [ ] **Step 4: Re-run the service tests and verify they pass**

Run:

```bash
npx vitest run tests/bot/subagent-topics/service.test.ts
```

Expected: PASS for eligibility, silent target resolution, and delete scheduling.

- [ ] **Step 5: Commit the service slice if commits are requested for the execution session**

```bash
git add src/bot/subagent-topics/service.ts src/bot/utils/message-thread.ts tests/bot/subagent-topics/service.test.ts
git commit -m "feat: add subagent topic routing service"
```

### Task 4: Integrate child-session topic routing into the bot delivery pipeline

**Files:**

- Modify: `src/bot/index.ts`
- Modify: `src/bot/utils/telegram-text.ts`
- Modify: `src/bot/handlers/question.ts`
- Modify: `src/bot/handlers/permission.ts`
- Modify: `tests/bot/handlers/question.test.ts`
- Modify: `tests/bot/handlers/permission.test.ts`
- Modify: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write failing integration tests for forum routing, fallback routing, and silent child-session sends**

Add one bot-integration test in `tests/bot/index.local-file-follow-up.test.ts` with the same event-emission style already used there:

```ts
it("routes child-session output into a dedicated forum topic and keeps parent output in the parent thread", async () => {
  const bot = createBot() as unknown as FakeBot;
  const promptHandler = bot.onHandlers
    .filter((entry) => entry.event === "message:text")
    .at(-1)?.handler;

  await promptHandler({
    message: { text: "run subagent", chat: { id: 123, is_forum: true }, message_thread_id: 7 },
    chat: { id: 123, type: "supergroup", is_forum: true },
    from: { id: 777 },
    api: bot.api,
    reply: vi.fn().mockResolvedValue({ message_id: 99 }),
  });

  emit(subtaskPartEvent("root-session", "child-session", "Inspect repo", "explore"));
  emit(childAssistantTextEvent("child-session", "subagent result"));
  emit(parentAssistantTextEvent("root-session", "parent result"));

  await vi.waitFor(() => {
    expect(createForumTopicMock).toHaveBeenCalled();
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      expect.stringContaining("subagent result"),
      expect.objectContaining({ message_thread_id: 42, disable_notification: true }),
    );
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      expect.stringContaining("parent result"),
      expect.objectContaining({ message_thread_id: 7 }),
    );
  });
});
```

Add focused handler tests for question and permission silent delivery:

```ts
expect(api.sendMessage).toHaveBeenCalledWith(
  123,
  "1/1 Q1\n\nPick one",
  expect.objectContaining({ message_thread_id: 42, disable_notification: true }),
);

expect(sendMessageMock.mock.calls[0]?.[2]).toEqual(
  expect.objectContaining({ message_thread_id: 42, disable_notification: true }),
);
```

- [ ] **Step 2: Run the focused integration/handler tests and verify they fail**

Run:

```bash
npx vitest run tests/bot/index.local-file-follow-up.test.ts tests/bot/handlers/question.test.ts tests/bot/handlers/permission.test.ts
```

Expected: FAIL because no subagent-topic routing override exists and question/permission handlers do not accept silent topic options yet.

- [ ] **Step 3: Wire the service into routing lookup, fallback rendering, and child-session handler sends**

In `src/bot/index.ts`, create and consult the service before the default routing path:

```ts
const subagentTopicService = new SubagentTopicService({
  createForumTopic: (chatId, payload) => activeBotInstance!.api.createForumTopic(chatId, payload),
  deleteForumTopic: (chatId, threadId) => activeBotInstance!.api.deleteForumTopic(chatId, threadId),
  setTimer: (handler, ms) => setTimeout(handler, ms),
  clearTimer: (timer) => clearTimeout(timer),
});

function getSessionRoutingTarget(sessionId: string) {
  return (
    subagentTopicService.getTargetForSession(sessionId) ??
    resolveAttachedSessionTarget(sessionId) ??
    getSessionRoutingContext(sessionId)?.target
  );
}

function getSessionRoutingScope(sessionId: string): TelegramConversationScope | null {
  return (
    subagentTopicService.getScopeForSession(sessionId) ??
    getSessionRoutingContext(sessionId)?.scope ??
    attachManager.getScopeForSession(sessionId) ??
    threadContextManager.getSessionScope(sessionId)
  );
}
```

Inside `summaryAggregator.setOnSubagent(...)`, sync eligible subagents before rendering fallback cards:

```ts
const routingScope = getSessionRoutingScope(sessionId);
const routingTarget = getSessionRoutingTarget(sessionId);

const fallbackSubagents: typeof subagents = [];
for (const subagent of subagents) {
  const dedicated = await subagentTopicService.syncSubagent({
    userId: routingScope?.userId ?? 0,
    chatId: routingTarget?.chatId ?? 0,
    parentSessionId: sessionId,
    scope: routingScope,
    fallbackTarget: routingTarget,
    enabled: await getSubagentTopicsEnabledForSession(sessionId),
    isForumChat: (routingScope?.messageThreadId ?? 0) > 0,
    autoDeleteMinutes: await getSubagentTopicAutoDeleteMinutesForSession(sessionId),
    subagent,
  });

  if (dedicated === "fallback") {
    fallbackSubagents.push(subagent);
  }
}

if (fallbackSubagents.length > 0) {
  const renderedCards = await renderSubagentCards(fallbackSubagents);
  // keep existing parent-thread publication flow
}
```

Then update question and permission handlers to accept silent topic options and use the helper:

```ts
// src/bot/handlers/question.ts
export async function showCurrentQuestion(
  bot: Context["api"],
  chatId: number,
  messageThreadId?: number,
  scopeKey?: string,
  options?: { disableNotification?: boolean },
): Promise<void> {
  const message = await bot.sendMessage(
    chatId,
    text,
    withTelegramDeliveryTarget(keyboard ? { reply_markup: keyboard } : undefined, {
      chatId,
      messageThreadId,
      disableNotification: options?.disableNotification,
    }),
  );
}
```

Apply the same pattern in `src/bot/handlers/permission.ts`, and pass `disableNotification: target.disableNotification === true` from `src/bot/index.ts` when routing child sessions.

- [ ] **Step 4: Re-run the focused routing tests and verify they pass**

Run:

```bash
npx vitest run tests/bot/index.local-file-follow-up.test.ts tests/bot/handlers/question.test.ts tests/bot/handlers/permission.test.ts
```

Expected: PASS for dedicated-topic routing, non-duplicated parent/child delivery, and silent child-session question/permission sends.

- [ ] **Step 5: Commit the routing-integration slice if commits are requested for the execution session**

```bash
git add src/bot/index.ts src/bot/utils/telegram-text.ts src/bot/handlers/question.ts src/bot/handlers/permission.ts tests/bot/index.local-file-follow-up.test.ts tests/bot/handlers/question.test.ts tests/bot/handlers/permission.test.ts
git commit -m "feat: route child sessions into silent subagent topics"
```

### Task 5: Finalize timed topic deletion, docs, and full verification

**Files:**

- Modify: `src/bot/index.ts`
- Modify: `CHANGELOG.md`
- Modify: `PRODUCT.md`
- Optionally modify: `README.md`

- [ ] **Step 1: Add a failing bot test that deletion is scheduled only after final child delivery**

Extend `tests/bot/index.local-file-follow-up.test.ts` with a terminal-lifecycle case:

```ts
it("schedules dedicated topic deletion after the child final answer is delivered", async () => {
  vi.useFakeTimers();

  await startForumPromptFlow();
  emit(subtaskPartEvent("root-session", "child-session", "Inspect repo", "explore"));
  emit(childAssistantTextEvent("child-session", "done"));
  emit(childAssistantCompletedEvent("child-session"));
  emit(childSessionIdleEvent("child-session"));

  await vi.waitFor(() =>
    expect(sendMessageMock).toHaveBeenCalledWith(
      123,
      expect.stringContaining("done"),
      expect.objectContaining({ message_thread_id: 42, disable_notification: true }),
    ),
  );

  vi.advanceTimersByTime(10 * 60 * 1000);
  expect(deleteForumTopicMock).toHaveBeenCalledWith(123, 42);
});
```

- [ ] **Step 2: Run the lifecycle test and verify it fails before the final deletion hook is wired**

Run:

```bash
npx vitest run tests/bot/index.local-file-follow-up.test.ts
```

Expected: FAIL because the bot integration has not yet called `markFinalResponseDelivered(...)` when child-session final delivery completes.

- [ ] **Step 3: Hook final child-session delivery into deletion scheduling and update docs**

In `src/bot/index.ts`, after successful final child-session delivery, notify the service:

```ts
await finalizeAssistantResponse(/* existing args */);

subagentTopicService.markFinalResponseDelivered(sessionId, {
  terminalStatus: completedRun.result === "error" ? "error" : "completed",
  autoDeleteMinutes: await getSubagentTopicAutoDeleteMinutesForSession(sessionId),
});
```

Then document the feature and the related `/projects` behavior.

Add a `CHANGELOG.md` entry like:

```md
- Added per-user subagent forum-topic routing with silent child-session delivery and timed topic deletion, plus user-default project persistence for `/projects` selections.
  - Why: forum users need isolated subagent observability without chat-noise, and project selections should behave like other user defaults instead of resetting in each new topic.
  - Affects: `src/bot/index.ts`, `src/bot/subagent-topics/service.ts`, `src/settings/manager.ts`, `src/bot/commands/settings.ts`, `src/bot/commands/projects.ts`, `tests/bot/index.local-file-follow-up.test.ts`, `tests/settings/manager.test.ts`
```

Update `PRODUCT.md` so the feature list explicitly mentions:

```md
- Optional per-user subagent topic routing in Telegram forum chats with automatic silent delivery and timed topic cleanup.
- Project selection from `/projects` persists as a per-user default across new topics.
```

- [ ] **Step 4: Run the full project verification commands**

Run:

```bash
npm run build
npm run lint
npm test
```

Expected:

```text
build: TypeScript compilation succeeds
lint: ESLint exits with code 0
test: Vitest exits with all tests passing
```

After the local checks pass, run the required post-implementation review agents in parallel with these prompts:

```text
Security review focus: authz around topic creation/deletion, Telegram trust boundaries, input-to-title formatting, logging leaks, and any child-session route mix-ups that could leak one user's activity into another topic.
```

```text
Architecture review focus: whether child-session routing remains isolated, whether `SubagentTopicService` keeps Telegram concerns separate from summary aggregation, and whether project-default persistence avoids leaking passive restores into user-default state.
```

- [ ] **Step 5: Commit the verified feature if commits are requested for the execution session**

```bash
git add src/bot/index.ts CHANGELOG.md PRODUCT.md README.md tests/bot/index.local-file-follow-up.test.ts
git commit -m "feat: isolate subagent delivery in forum topics"
```

## Self-Review

- Spec coverage check:
  - per-user enable/disable -> Task 2
  - per-user auto-delete timeout -> Task 2 + Task 5
  - forum-only dedicated topics with fallback -> Task 3 + Task 4
  - full child-session routing -> Task 4
  - silent subagent messages -> Task 3 + Task 4
  - deletion after final response -> Task 5
  - `/projects` user-default persistence -> Task 1
- Placeholder scan:
  - no `TODO`, `TBD`, or "similar to above" placeholders remain
  - all commands, files, and test targets are concrete
- Type consistency check:
  - `setConversationCurrentProject` is introduced before later tasks depend on it
  - `SubagentTopicService`, `getTargetForSession`, and `markFinalResponseDelivered` names remain consistent across tasks
  - `withTelegramDeliveryTarget` is the shared helper name used by later routing tasks
