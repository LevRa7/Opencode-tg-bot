# User Settings Model Variant Commands Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add `/model`, `/variant`, and `/settings` commands so users can set model/variant defaults directly and manage user-scoped language/message-visibility settings from an inline menu.

**Architecture:** Reuse existing model and variant selection handlers for menu-only command calls, and add thin command handlers for argument-based direct updates. Store `/settings` values in the existing `scopedUserSettings` map, and resolve user locale through i18n using the current Telegram conversation scope when available.

**Tech Stack:** TypeScript, Node.js, grammY commands/callbacks, Vitest, existing settings manager, existing model/variant managers, existing i18n locale modules.

---

## File Map

- Modify: `src/settings/manager.ts`
  - Add user-scoped fields and accessors for `locale`, `hideThinkingMessages`, `hideToolCallMessages`, and `hideToolFileMessages`.
- Modify: `src/i18n/index.ts`
  - Resolve user-scoped locale before falling back to runtime/env locale.
- Modify: `src/i18n/en.ts`, `src/i18n/ru.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/zh.ts`
  - Add command descriptions, settings menu labels, success messages, and validation errors.
- Modify: `src/bot/commands/definitions.ts`
  - Add `/model`, `/variant`, and `/settings` command definitions.
- Create: `src/bot/commands/model.ts`
  - Implement `/model` command with menu mode and direct `provider/model` mode.
- Create: `src/bot/commands/variant.ts`
  - Implement `/variant` command with menu mode and direct variant mode.
- Create: `src/bot/commands/settings.ts`
  - Implement `/settings` root menu and callbacks.
- Modify: `src/bot/index.ts`
  - Register commands and settings callbacks in the existing dispatcher.
- Modify: `CHANGELOG.md`, `PRODUCT.md`
  - Document user-visible commands and settings.

- Test: `tests/settings/manager.test.ts`
  - Cover user-scoped settings storage and locale isolation.
- Test: `tests/i18n/index.test.ts`
  - Cover user locale resolution and all new locale keys in every language.
- Create: `tests/bot/commands/model-command.test.ts`
  - Cover `/model` menu and direct argument behavior.
- Create: `tests/bot/commands/variant-command.test.ts`
  - Cover `/variant` menu and direct argument behavior.
- Create: `tests/bot/commands/settings.test.ts`
  - Cover `/settings` menu rendering, language selection, and toggle callbacks.
- Modify: `tests/bot/utils/command-sync.test.ts`
  - Verify command sync includes new command definitions.
- Modify: `tests/bot/index.callback-routing.test.ts`
  - Verify settings callbacks are wired into the central callback dispatcher.

## Task 1: Add User-Scoped Settings Accessors

**Files:**

- Modify: `src/settings/manager.ts`
- Test: `tests/settings/manager.test.ts`

- [ ] **Step 1: Write failing settings tests**

Add tests to `tests/settings/manager.test.ts` for these new exported functions:

```ts
getUserLocale;
setUserLocale;
getHideThinkingMessages;
setHideThinkingMessages;
getHideToolCallMessages;
setHideToolCallMessages;
getHideToolFileMessages;
setHideToolFileMessages;
```

Add this test shape inside the existing `settings/manager scoped state` describe block:

```ts
it("stores user settings independently from topic-scoped state", () => {
  runWithTelegramConversationScope(scopeA, () => {
    setUserLocale("ru");
    setHideThinkingMessages(true);
    setHideToolCallMessages(true);
    setHideToolFileMessages(false);
  });

  expect(
    runWithTelegramConversationScope(scopeAOtherTopic, () => ({
      locale: getUserLocale(),
      hideThinking: getHideThinkingMessages(),
      hideToolCalls: getHideToolCallMessages(),
      hideToolFiles: getHideToolFileMessages(),
    })),
  ).toEqual({
    locale: "ru",
    hideThinking: true,
    hideToolCalls: true,
    hideToolFiles: false,
  });

  expect(
    runWithTelegramConversationScope(scopeB, () => ({
      locale: getUserLocale(),
      hideThinking: getHideThinkingMessages(),
      hideToolCalls: getHideToolCallMessages(),
      hideToolFiles: getHideToolFileMessages(),
    })),
  ).toEqual({
    locale: undefined,
    hideThinking: false,
    hideToolCalls: false,
    hideToolFiles: false,
  });
});
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run:

```bash
npm test -- tests/settings/manager.test.ts
```

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Add storage fields and accessors**

In `src/settings/manager.ts`:

1. Import `Locale` from `../i18n/index.js` as a type.
2. Extend `ScopedUserSettings`:

```ts
locale?: Locale;
hideThinkingMessages?: boolean;
hideToolCallMessages?: boolean;
hideToolFileMessages?: boolean;
```

3. Update `isScopedUserSettingsEmpty()` so these fields count as non-empty.
4. Add accessors:

```ts
export function getUserLocale(): Locale | undefined {
  return getUserScopedSettings()?.locale;
}

export function setUserLocale(locale: Locale): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) return;
  scopedSettings.locale = locale;
  void writeSettingsFile(currentSettings);
}

export function getHideThinkingMessages(): boolean {
  return getUserScopedSettings()?.hideThinkingMessages ?? false;
}

export function setHideThinkingMessages(enabled: boolean): void {
  const scopedSettings = getOrCreateUserScopedSettings();
  if (!scopedSettings) return;
  scopedSettings.hideThinkingMessages = enabled;
  pruneUserScopedSettings();
  void writeSettingsFile(currentSettings);
}
```

Repeat the same pattern for `hideToolCallMessages` and `hideToolFileMessages`.

- [ ] **Step 4: Run the settings test to verify it passes**

Run:

```bash
npm test -- tests/settings/manager.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/settings/manager.ts tests/settings/manager.test.ts
git commit -m "feat: add user-scoped settings storage"
```

## Task 2: Resolve User-Scoped Locale in i18n

**Files:**

- Modify: `src/i18n/index.ts`
- Test: `tests/i18n/index.test.ts`

- [ ] **Step 1: Write failing i18n tests**

Add tests to `tests/i18n/index.test.ts`:

```ts
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";
import { __resetSettingsForTests, setUserLocale } from "../../src/settings/manager.js";
```

Add:

```ts
it("uses scoped user locale before env locale", () => {
  vi.stubEnv("BOT_LOCALE", "en");
  __resetSettingsForTests();

  const locale = runWithTelegramConversationScope(
    { userId: 777, chatId: 123, messageThreadId: 1 },
    () => {
      setUserLocale("ru");
      return getLocale();
    },
  );

  expect(locale).toBe("ru");
});
```

- [ ] **Step 2: Run the i18n test to verify it fails**

Run:

```bash
npm test -- tests/i18n/index.test.ts
```

Expected: FAIL because `getLocale()` does not read user-scoped locale yet.

- [ ] **Step 3: Implement user locale resolution**

In `src/i18n/index.ts`, import `getUserLocale` lazily inside `getLocale()` to avoid import-cycle hazards:

```ts
function getScopedUserLocale(): Locale | null {
  try {
    const settings = require("../settings/manager.js") as {
      getUserLocale: () => Locale | undefined;
    };
    return settings.getUserLocale() ?? null;
  } catch {
    return null;
  }
}
```

If direct `require` is not allowed in this ESM project, instead create a small locale resolver hook in `i18n/index.ts`:

```ts
let userLocaleResolver: (() => Locale | undefined) | null = null;

export function setUserLocaleResolverForRuntime(resolver: (() => Locale | undefined) | null): void {
  userLocaleResolver = resolver;
}
```

Then register it from bot startup after settings import. Prefer the hook if TypeScript rejects `require`.

Update `getLocale()` priority:

1. runtime override
2. user-scoped locale
3. `BOT_LOCALE`

- [ ] **Step 4: Run the i18n test to verify it passes**

Run:

```bash
npm test -- tests/i18n/index.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/index.ts tests/i18n/index.test.ts
git commit -m "feat: resolve user locale from scoped settings"
```

## Task 3: Add Locale Keys in Every Language

**Files:**

- Modify: `src/i18n/en.ts`, `src/i18n/ru.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/zh.ts`
- Test: `tests/i18n/index.test.ts`

- [ ] **Step 1: Write failing locale key coverage**

Extend `COMMAND_LOCALIZATION_KEYS` in `tests/i18n/index.test.ts` with:

```ts
"cmd.description.model",
"cmd.description.variant",
"cmd.description.settings",
"model.command.usage",
"model.command.not_found",
"model.command.changed",
"variant.command.usage",
"variant.command.model_required",
"variant.command.not_found",
"variant.command.changed",
"settings.title",
"settings.language",
"settings.language.title",
"settings.hide_thinking_messages",
"settings.hide_tool_call_messages",
"settings.hide_tool_file_messages",
"settings.state.on",
"settings.state.off",
"settings.updated_callback",
"settings.language_updated_callback",
"settings.error_callback",
```

- [ ] **Step 2: Run i18n tests to verify they fail**

Run:

```bash
npm test -- tests/i18n/index.test.ts
```

Expected: FAIL because the new keys are missing.

- [ ] **Step 3: Add English keys first**

In `src/i18n/en.ts`, add:

```ts
"cmd.description.model": "Select or set default model",
"cmd.description.variant": "Select or set default variant",
"cmd.description.settings": "User settings",
"model.command.usage": "Usage: /model provider/model\nExample: /model cliproxyapi/gpt-5.5",
"model.command.not_found": "Model not found: {name}",
"model.command.changed": "✅ Model set to {name}",
"variant.command.usage": "Usage: /variant variant-id\nExample: /variant high",
"variant.command.model_required": "Select a model before changing variant.",
"variant.command.not_found": "Variant not found or disabled: {name}",
"variant.command.changed": "✅ Variant set to {name}",
"settings.title": "⚙️ User settings",
"settings.language": "Language: {value}",
"settings.language.title": "🌐 Choose language",
"settings.hide_thinking_messages": "Hide thinking messages: {state}",
"settings.hide_tool_call_messages": "Hide tool call messages: {state}",
"settings.hide_tool_file_messages": "Hide tool file messages: {state}",
"settings.state.on": "on",
"settings.state.off": "off",
"settings.updated_callback": "Updated",
"settings.language_updated_callback": "Language updated",
"settings.error_callback": "Failed to update settings",
```

- [ ] **Step 4: Add translated keys to the other five locale files**

Add equivalent translations in:

- `src/i18n/ru.ts`
- `src/i18n/de.ts`
- `src/i18n/es.ts`
- `src/i18n/fr.ts`
- `src/i18n/zh.ts`

Use concise native translations; preserve placeholders `{name}`, `{value}`, and `{state}` exactly.

- [ ] **Step 5: Run i18n tests**

Run:

```bash
npm test -- tests/i18n/index.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/*.ts tests/i18n/index.test.ts
git commit -m "feat: localize user settings commands"
```

## Task 4: Implement `/model` Command

**Files:**

- Create: `src/bot/commands/model.ts`
- Modify: `src/bot/index.ts`
- Modify: `src/bot/commands/definitions.ts`
- Test: `tests/bot/commands/model-command.test.ts`

- [ ] **Step 1: Write failing `/model` tests**

Create `tests/bot/commands/model-command.test.ts` with mocks for:

- `getRuntimeModelCatalog`
- `selectModel`
- `showModelSelectionMenu`
- `createMainKeyboard`
- `threadContextManager.bindModelToActiveContext`
- `keyboardManager.updateModel`

Cover:

```ts
it("opens model menu when called without arguments", async () => {
  const ctx = createCommandContext("");
  await modelCommand(ctx);
  expect(showModelSelectionMenuMock).toHaveBeenCalledWith(ctx);
});

it("applies provider/model argument as user default and current scope", async () => {
  getRuntimeModelCatalogMock.mockResolvedValue({
    providers: [
      { providerID: "cliproxyapi", models: [{ providerID: "cliproxyapi", modelID: "gpt-5.5" }] },
    ],
  });

  const ctx = createCommandContext("cliproxyapi/gpt-5.5");
  await modelCommand(ctx);

  expect(selectModelMock).toHaveBeenCalledWith("cliproxyapi", "gpt-5.5");
  expect(threadBindModelMock).toHaveBeenCalledWith({
    providerID: "cliproxyapi",
    modelID: "gpt-5.5",
  });
  expect(ctx.reply).toHaveBeenCalledWith(
    t("model.command.changed", { name: "cliproxyapi / gpt-5.5" }),
    expect.objectContaining({ reply_markup: expect.any(Object) }),
  );
});
```

Also cover invalid format and unknown model.

- [ ] **Step 2: Run the new command test to verify it fails**

Run:

```bash
npm test -- tests/bot/commands/model-command.test.ts
```

Expected: FAIL because `src/bot/commands/model.ts` does not exist.

- [ ] **Step 3: Implement command handler**

Create `src/bot/commands/model.ts`:

```ts
import type { CommandContext, Context } from "grammy";
import { getRuntimeModelCatalog, selectModel } from "../../model/manager.js";
import { formatModelForDisplay } from "../../model/types.js";
import { threadContextManager } from "../../thread/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { t } from "../../i18n/index.js";
import { showModelSelectionMenu } from "../handlers/model.js";

export async function modelCommand(ctx: CommandContext<Context>): Promise<void> {
  const rawArg = ctx.match?.toString().trim() ?? "";
  if (!rawArg) {
    await showModelSelectionMenu(ctx);
    return;
  }

  const separatorIndex = rawArg.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === rawArg.length - 1) {
    await ctx.reply(t("model.command.usage"));
    return;
  }

  const providerID = rawArg.slice(0, separatorIndex).trim();
  const modelID = rawArg.slice(separatorIndex + 1).trim();
  const catalog = await getRuntimeModelCatalog();
  const found = catalog.providers.some(
    (provider) =>
      provider.providerID === providerID &&
      provider.models.some((model) => model.modelID === modelID),
  );

  if (!found) {
    await ctx.reply(t("model.command.not_found", { name: rawArg }));
    return;
  }

  const selected = { providerID, modelID };
  selectModel(providerID, modelID);
  threadContextManager.bindModelToActiveContext(selected);
  keyboardManager.updateModel(selected);

  await ctx.reply(
    t("model.command.changed", { name: formatModelForDisplay(providerID, modelID) }),
    {
      reply_markup: createMainKeyboard(undefined, selected),
    },
  );
}
```

Adjust imports if `selectModel()` is async or returns current model in this codebase.

- [ ] **Step 4: Register command**

In `src/bot/index.ts`, import `modelCommand` and add:

```ts
bot.command("model", modelCommand);
```

In `src/bot/commands/definitions.ts`, add:

```ts
{ command: "model", descriptionKey: "cmd.description.model" },
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/bot/commands/model-command.test.ts tests/bot/utils/command-sync.test.ts
```

Expected: PASS after updating command sync expectations if needed.

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/model.ts src/bot/index.ts src/bot/commands/definitions.ts tests/bot/commands/model-command.test.ts tests/bot/utils/command-sync.test.ts
git commit -m "feat: add model command"
```

## Task 5: Implement `/variant` Command

**Files:**

- Create: `src/bot/commands/variant.ts`
- Modify: `src/bot/index.ts`
- Modify: `src/bot/commands/definitions.ts`
- Test: `tests/bot/commands/variant-command.test.ts`

- [ ] **Step 1: Write failing `/variant` tests**

Create `tests/bot/commands/variant-command.test.ts` with mocks for:

- `showVariantSelectionMenu`
- `getStoredModel`
- `getAvailableVariants`
- `setCurrentVariant`
- `threadContextManager.bindModelToActiveContext`
- `keyboardManager.updateModel`
- `keyboardManager.updateVariant`

Cover:

```ts
it("opens variant menu when called without arguments", async () => {
  const ctx = createCommandContext("");
  await variantCommand(ctx);
  expect(showVariantSelectionMenuMock).toHaveBeenCalledWith(ctx);
});

it("applies a valid variant argument", async () => {
  getStoredModelMock.mockReturnValue({
    providerID: "cliproxyapi",
    modelID: "gpt-5.5",
    variant: "default",
  });
  getAvailableVariantsMock.mockResolvedValue([{ id: "high", disabled: false }]);

  const ctx = createCommandContext("high");
  await variantCommand(ctx);

  expect(setCurrentVariantMock).toHaveBeenCalledWith("high");
  expect(ctx.reply).toHaveBeenCalledWith(
    t("variant.command.changed", { name: "High" }),
    expect.objectContaining({ reply_markup: expect.any(Object) }),
  );
});
```

Also cover missing model and disabled/unknown variant.

- [ ] **Step 2: Run the new command test to verify it fails**

Run:

```bash
npm test -- tests/bot/commands/variant-command.test.ts
```

Expected: FAIL because `src/bot/commands/variant.ts` does not exist.

- [ ] **Step 3: Implement command handler**

Create `src/bot/commands/variant.ts`:

```ts
import type { CommandContext, Context } from "grammy";
import { getStoredModel } from "../../model/manager.js";
import { keyboardManager } from "../../keyboard/manager.js";
import { threadContextManager } from "../../thread/manager.js";
import {
  formatVariantForDisplay,
  formatVariantForButton,
  getAvailableVariants,
  setCurrentVariant,
} from "../../variant/manager.js";
import { createMainKeyboard } from "../utils/keyboard.js";
import { t } from "../../i18n/index.js";
import { showVariantSelectionMenu } from "../handlers/variant.js";

export async function variantCommand(ctx: CommandContext<Context>): Promise<void> {
  const variantId = ctx.match?.toString().trim() ?? "";
  if (!variantId) {
    await showVariantSelectionMenu(ctx);
    return;
  }

  const currentModel = getStoredModel();
  if (!currentModel.providerID || !currentModel.modelID) {
    await ctx.reply(t("variant.command.model_required"));
    return;
  }

  const variants = await getAvailableVariants(currentModel.providerID, currentModel.modelID);
  const variant = variants.find((entry) => entry.id === variantId && !entry.disabled);
  if (!variant) {
    await ctx.reply(t("variant.command.not_found", { name: variantId }));
    return;
  }

  setCurrentVariant(variantId);
  const updatedModel = getStoredModel();
  threadContextManager.bindModelToActiveContext(updatedModel);
  keyboardManager.updateModel(updatedModel);
  keyboardManager.updateVariant(variantId);

  await ctx.reply(t("variant.command.changed", { name: formatVariantForDisplay(variantId) }), {
    reply_markup: createMainKeyboard(
      undefined,
      updatedModel,
      undefined,
      formatVariantForButton(variantId),
    ),
  });
}
```

- [ ] **Step 4: Register command**

In `src/bot/index.ts`, import `variantCommand` and add:

```ts
bot.command("variant", variantCommand);
```

In `src/bot/commands/definitions.ts`, add:

```ts
{ command: "variant", descriptionKey: "cmd.description.variant" },
```

- [ ] **Step 5: Run tests**

Run:

```bash
npm test -- tests/bot/commands/variant-command.test.ts tests/bot/utils/command-sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/variant.ts src/bot/index.ts src/bot/commands/definitions.ts tests/bot/commands/variant-command.test.ts tests/bot/utils/command-sync.test.ts
git commit -m "feat: add variant command"
```

## Task 6: Implement `/settings` Menu and Callbacks

**Files:**

- Create: `src/bot/commands/settings.ts`
- Modify: `src/bot/index.ts`
- Modify: `src/bot/commands/definitions.ts`
- Test: `tests/bot/commands/settings.test.ts`
- Test: `tests/bot/index.callback-routing.test.ts`

- [ ] **Step 1: Write failing settings command tests**

Create `tests/bot/commands/settings.test.ts` covering:

```ts
it("opens the root settings menu", async () => {
  const ctx = createContext();
  await settingsCommand(ctx);
  expect(ctx.reply).toHaveBeenCalledWith(
    t("settings.title"),
    expect.objectContaining({ reply_markup: expect.any(Object) }),
  );
});

it("updates language and redraws root menu", async () => {
  const ctx = createCallbackContext("settings:language:ru");
  const handled = await handleSettingsCallback(ctx);
  expect(handled).toBe(true);
  expect(setUserLocaleMock).toHaveBeenCalledWith("ru");
  expect(ctx.editMessageText).toHaveBeenCalledWith(
    t("settings.title", undefined, "ru"),
    expect.objectContaining({ reply_markup: expect.any(Object) }),
  );
});

it("toggles hide thinking messages", async () => {
  getHideThinkingMessagesMock.mockReturnValue(false);
  const ctx = createCallbackContext("settings:toggle:hide_thinking");
  await handleSettingsCallback(ctx);
  expect(setHideThinkingMessagesMock).toHaveBeenCalledWith(true);
});
```

Also add tests for `hide_tool_calls` and `hide_tool_files`.

- [ ] **Step 2: Run the new settings tests to verify they fail**

Run:

```bash
npm test -- tests/bot/commands/settings.test.ts
```

Expected: FAIL because `src/bot/commands/settings.ts` does not exist.

- [ ] **Step 3: Implement settings command module**

Create `src/bot/commands/settings.ts` exporting:

```ts
export const SETTINGS_CALLBACK_PREFIX = "settings:";
export async function settingsCommand(ctx: CommandContext<Context>): Promise<void>;
export async function handleSettingsCallback(ctx: Context): Promise<boolean>;
```

Implement callbacks:

- `settings:language` opens language submenu
- `settings:language:<locale>` stores locale, answers callback, redraws root menu in selected locale
- `settings:toggle:hide_thinking` toggles `hideThinkingMessages`
- `settings:toggle:hide_tool_calls` toggles `hideToolCallMessages`
- `settings:toggle:hide_tool_files` toggles `hideToolFileMessages`

Use `getLocaleOptions()` for language list and `resolveSupportedLocale()` for callback validation.

- [ ] **Step 4: Register command and callback**

In `src/bot/index.ts`:

1. Import `settingsCommand` and `handleSettingsCallback`.
2. Add:

```ts
bot.command("settings", settingsCommand);
```

3. In the central `callback_query:data` dispatcher, call `handleSettingsCallback(ctx)` near other menu handlers and include it in the unknown-callback guard.

In `src/bot/commands/definitions.ts`, add:

```ts
{ command: "settings", descriptionKey: "cmd.description.settings" },
```

- [ ] **Step 5: Run settings tests and callback-routing tests**

Run:

```bash
npm test -- tests/bot/commands/settings.test.ts tests/bot/index.callback-routing.test.ts tests/bot/utils/command-sync.test.ts
```

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/settings.ts src/bot/index.ts src/bot/commands/definitions.ts tests/bot/commands/settings.test.ts tests/bot/index.callback-routing.test.ts tests/bot/utils/command-sync.test.ts
git commit -m "feat: add user settings menu"
```

## Task 7: Wire Visibility Settings Into Message Rendering Defaults

**Files:**

- Modify: `src/bot/index.ts`
- Test: `tests/bot/index.local-file-follow-up.test.ts`

- [ ] **Step 1: Write failing visibility behavior tests**

Add focused tests to `tests/bot/index.local-file-follow-up.test.ts` near the existing event-routing tests.

Test thinking suppression by mocking `getHideThinkingMessages()` to return `true`, triggering `summaryAggregator.setOnThinking`, and asserting no thinking placeholder/tool message is queued for that session.

Test tool-call suppression by mocking `getHideToolCallMessages()` to return `true`, triggering `summaryAggregator.setOnTool` with a non-file, non-task tool call, and asserting `toolCallStreamer.replaceByPrefix` is not called.

Test tool-file suppression by mocking `getHideToolFileMessages()` to return `true`, triggering `summaryAggregator.setOnToolFile`, and asserting `toolMessageBatcher.enqueueFile` is not called.

- [ ] **Step 2: Run focused tests to verify they fail**

Run:

```bash
npm test -- tests/bot/index.local-file-follow-up.test.ts
```

Expected: FAIL because `src/bot/index.ts` currently checks only `config.bot.hideThinkingMessages` and `config.bot.hideToolCallMessages`, and does not consult user-scoped visibility settings.

- [ ] **Step 3: Implement minimal user-default integration**

In `src/bot/index.ts`, import:

```ts
import {
  getHideThinkingMessages,
  getHideToolCallMessages,
  getHideToolFileMessages,
} from "../settings/manager.js";
```

Replace the visibility checks at these existing decision points:

- partial reasoning stream around line 937: use `const hideThinkingMessages = config.bot.hideThinkingMessages || getHideThinkingMessages();` and check `!hideThinkingMessages`
- tool notification around line 1212: use `const hideToolCallMessages = config.bot.hideToolCallMessages || getHideToolCallMessages();` and check `hideToolCallMessages`
- subagent notification around line 1247: check `config.bot.hideToolCallMessages || getHideToolCallMessages()`
- tool file delivery around line 1276: before `toolCallStreamer.breakSession(...)`, return when `config.bot.hideToolFileMessages || getHideToolFileMessages()`
- thinking start around line 1377: use `const hideThinkingMessages = config.bot.hideThinkingMessages || getHideThinkingMessages();`, check `!hideThinkingMessages`, and pass `hideThinkingMessages` into `deliverThinkingMessage()`

Do not change unrelated rendering or queue behavior.

- [ ] **Step 4: Run focused tests**

Run:

```bash
npm test -- tests/bot/index.local-file-follow-up.test.ts
```

Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/bot/index.ts tests/bot/index.local-file-follow-up.test.ts
git commit -m "feat: apply user message visibility defaults"
```

## Task 8: Docs, Product Notes, and Full Verification

**Files:**

- Modify: `CHANGELOG.md`
- Modify: `PRODUCT.md`

- [ ] **Step 1: Update docs**

Add a `[Unreleased]` changelog entry:

```md
- Added `/model`, `/variant`, and `/settings` commands for user-scoped defaults, direct model/variant updates, language selection, and message visibility preferences.
```

Update `PRODUCT.md` command/settings section to mention the new commands and user-scoped defaults.

- [ ] **Step 2: Run focused tests**

Run:

```bash
npm test -- tests/settings/manager.test.ts tests/i18n/index.test.ts tests/bot/commands/model-command.test.ts tests/bot/commands/variant-command.test.ts tests/bot/commands/settings.test.ts tests/bot/index.callback-routing.test.ts tests/bot/utils/command-sync.test.ts
```

Expected: PASS.

- [ ] **Step 3: Run quality checks**

Run:

```bash
npm run lint
npm run build
npm test
```

Expected: all PASS.

- [ ] **Step 4: Commit**

```bash
git add CHANGELOG.md PRODUCT.md
git commit -m "docs: document user settings commands"
```

## Self-Review

- Spec coverage: commands, parameter behavior, settings menu, language submenu, visibility toggles, storage semantics, localization, validation, and tests are covered.
- Placeholder scan: no `TBD` or future placeholders remain. Task 7 names the exact visibility decision file and concrete branches to change.
- Type consistency: planned names are consistent across tasks: `modelCommand`, `variantCommand`, `settingsCommand`, `handleSettingsCallback`, `getUserLocale`, `setUserLocale`, and the three hide-setting accessors.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-29-user-settings-model-variant-commands.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
