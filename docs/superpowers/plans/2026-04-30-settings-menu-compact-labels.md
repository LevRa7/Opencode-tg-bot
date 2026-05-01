# Settings Menu Compact Labels Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make `/settings` labels compact and clearer by adding language flags, replacing long toggle labels with `X/✅` semantics, and using an explicit localized close label.

**Architecture:** Keep the existing `/settings` callback/storage behavior unchanged and update only presentation helpers, locale option labels, localized strings, and settings menu tests. Reuse the existing cancel callback path; only the visible button text changes.

**Tech Stack:** TypeScript, grammY inline keyboards, existing i18n locale modules, Vitest.

---

## File Map

- Modify: `src/i18n/index.ts`
  - Add flag metadata to locale options or otherwise expose flag + language labels.
- Modify: `src/bot/commands/settings.ts`
  - Render the compact root labels and language labels with flags.
- Modify: `src/i18n/en.ts`, `src/i18n/ru.ts`, `src/i18n/de.ts`, `src/i18n/es.ts`, `src/i18n/fr.ts`, `src/i18n/zh.ts`
  - Add/update compact settings labels and close button text.
- Modify: `tests/bot/commands/settings.test.ts`
  - Update expectations for compact labels, flags, and close label.
- Modify: `tests/i18n/index.test.ts` only if locale option shape changes require explicit coverage.

## Task 1: Compact `/settings` Labels, Flags, and Close Text

**Files:**

- Modify: `src/i18n/index.ts`
- Modify: `src/bot/commands/settings.ts`
- Modify: `src/i18n/en.ts`
- Modify: `src/i18n/ru.ts`
- Modify: `src/i18n/de.ts`
- Modify: `src/i18n/es.ts`
- Modify: `src/i18n/fr.ts`
- Modify: `src/i18n/zh.ts`
- Modify: `tests/bot/commands/settings.test.ts`
- Modify: `tests/i18n/index.test.ts` if needed

- [ ] **Step 1: Write the failing settings-menu tests**

Update `tests/bot/commands/settings.test.ts` expectations:

1. Root menu language row should expect a flag and globe prefix. Example for English:

```ts
expect(rows[0]?.[0]?.text).toBe("🌐 🇬🇧 English");
```

2. Compact toggle labels should use `X` for hidden and `✅` for shown. Replace current expectations with:

```ts
expect(rows[1]?.[0]?.text).toBe("✅ Thinking");
```

and locale-specific equivalents after toggles flip:

```ts
expect(getInlineRows(options)[1]?.[0]?.text).toBe("X Thinking");
```

Use the actual current locale for localized assertions where needed.

3. Language submenu options should include flags:

```ts
expect(rows[0]?.[0]).toMatchObject({ text: "🇬🇧 English", callback_data: "settings:language:en" });
expect(rows.some((row) => row[0]?.text === "🇷🇺 Русский")).toBe(true);
```

4. Bottom close button should expect the new localized close wording instead of `inline.button.cancel`.

For Russian stored-locale case:

```ts
expect(rows[rows.length - 1]?.[0]?.text).toBe(t("settings.close", undefined, "ru"));
```

- [ ] **Step 2: Run the settings tests to verify they fail**

Run:

```bash
npm test -- tests/bot/commands/settings.test.ts
```

Expected: FAIL because current labels are long, language labels have no flags, and the close button still uses cancel wording.

- [ ] **Step 3: Add locale flags and compact rendering support**

In `src/i18n/index.ts`:

1. Extend `LocaleDefinition` and `LocaleOption`:

```ts
flag: string;
```

2. Add flags:

```ts
en -> "🇬🇧"
de -> "🇩🇪"
es -> "🇪🇸"
fr -> "🇫🇷"
ru -> "🇷🇺"
zh -> "🇨🇳"
```

3. Make `getLocaleOptions()` return `{ code, label, flag }`.

In `src/bot/commands/settings.ts`:

1. Replace `getLocaleLabel()` with a helper that returns flag + label.

```ts
function getLocaleLabel(locale: Locale): string {
  const option = getLocaleOptions().find((entry) => entry.code === locale);
  return option ? `${option.flag} ${option.label}` : locale;
}
```

2. Update the root language row to render:

```ts
`🌐 ${state.languageLabel}`;
```

either directly or via `t("settings.language", ...)` if you keep a translatable template.

3. Update the language submenu rows to use `flag + label`.

4. Keep callback payloads unchanged.

- [ ] **Step 4: Add compact localized labels**

In each locale file, replace/add settings keys so button text can stay short:

English examples:

```ts
"settings.language": "🌐 {value}",
"settings.hide_thinking_messages": "{state} Thinking",
"settings.hide_tool_call_messages": "{state} Tools",
"settings.hide_tool_file_messages": "{state} File changes",
"settings.state.on": "✅",
"settings.state.off": "X",
"settings.close": "Close",
```

Russian examples:

```ts
"settings.language": "🌐 {value}",
"settings.hide_thinking_messages": "{state} Мышление",
"settings.hide_tool_call_messages": "{state} Инструменты",
"settings.hide_tool_file_messages": "{state} Изменения файлов",
"settings.state.on": "✅",
"settings.state.off": "X",
"settings.close": "Закрыть",
```

Translate the three compact nouns and close label appropriately in `de`, `es`, `fr`, and `zh`.

Do not change callback text keys like `settings.updated_callback` unless needed.

- [ ] **Step 5: Point the bottom button at the new close text**

In `src/bot/commands/settings.ts`, update the close/cancel row rendering to use `t("settings.close", undefined, locale)` while keeping the same callback behavior and callback id.

If the existing helper `appendInlineMenuCancelButton()` hardcodes `inline.button.cancel`, stop using it for this menu and add the final row manually:

```ts
keyboard.row().text(t("settings.close", undefined, locale), "inline:cancel:settings");
```

Only do this for `/settings`; do not change shared cancel behavior globally.

- [ ] **Step 6: Run focused tests**

Run:

```bash
npm test -- tests/bot/commands/settings.test.ts
```

Expected: PASS.

- [ ] **Step 7: Run supporting checks**

Run:

```bash
npm test -- tests/i18n/index.test.ts tests/bot/commands/settings.test.ts
npm run build
```

Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add src/i18n/index.ts src/bot/commands/settings.ts src/i18n/en.ts src/i18n/ru.ts src/i18n/de.ts src/i18n/es.ts src/i18n/fr.ts src/i18n/zh.ts tests/bot/commands/settings.test.ts tests/i18n/index.test.ts
git commit -m "feat: compact settings menu labels"
```

## Self-Review

- Spec coverage: flags in root/submenu, compact `X/✅` toggles, and localized close label are all covered.
- Placeholder scan: no unresolved placeholders remain.
- Type consistency: `LocaleOption` growth is explicitly covered in both implementation and tests.

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-30-settings-menu-compact-labels.md`. Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration

**2. Inline Execution** - Execute tasks in this session using executing-plans, batch execution with checkpoints

**Which approach?**
