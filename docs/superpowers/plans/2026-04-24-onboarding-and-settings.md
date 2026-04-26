# Onboarding And Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a first-run onboarding flow and per-user settings so each Telegram user can choose their interface language, manage user-scoped feature toggles, set or generate their own OpenCode password, and see their own connection details in `/status`.

**Architecture:** Extend the existing conversation-scoped settings model in `src/settings/manager.ts` with dedicated per-user preference fields and a first-run completion marker. Put the first-run decision in the bot entry flow, store language and OpenCode account credentials per user, and keep `/status` as the single readout for the active user's connection and preference state. Keep all user-facing text localized through the existing i18n layer and expose feature toggles through explicit settings helpers instead of ad hoc globals.

**Tech Stack:** TypeScript 5.x, Node.js 20, grammY, Vitest, existing settings persistence, existing i18n module, existing logger, Telegram command handlers.

---

## File Structure Map

- `src/settings/manager.ts` - add onboarding state, language preference, feature toggle storage, and OpenCode credential helpers.
- `src/bot/commands/start.ts` - add the first-run onboarding branch before the existing welcome flow.
- `src/bot/commands/status.ts` - render the active user's language, credential mode, login, password, and endpoint details.
- `src/bot/commands/definitions.ts` - register any new user-facing settings command that ships with this phase.
- `src/bot/commands/help.ts` - mention new onboarding/settings commands in help text if they become public.
- `src/bot/index.ts` - wire onboarding callbacks and any settings callbacks into the bot update flow.
- `src/i18n/index.ts` - keep locale discovery as the source of truth for language selection.
- `src/i18n/en.ts` - add onboarding, settings, password, and status strings.
- `src/i18n/ru.ts` - add the same strings for Russian.
- `src/i18n/de.ts` - add the same strings for German.
- `src/i18n/es.ts` - add the same strings for Spanish.
- `src/i18n/fr.ts` - add the same strings for French.
- `src/i18n/zh.ts` - add the same strings for Chinese.
- `tests/settings/manager.test.ts` - cover persistence, defaults, and user isolation for the new settings.
- `tests/bot/commands/start.test.ts` - cover first-run onboarding routing.
- `tests/bot/commands/status.test.ts` - cover user-facing status output for connection and preference state.
- `tests/bot/commands/help.test.ts` - cover help text if new commands are exposed.
- `PRODUCT.md` - update the current feature list if onboarding/settings behavior is considered shipped in this branch.
- `CHANGELOG.md` - record the onboarding/settings flow once implemented.

---

## Task 1: Add per-user onboarding state and preference helpers to settings

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/settings/manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/settings/manager.test.ts`

- [ ] **Step 1: Add failing tests for onboarding state, language, toggles, and credentials**

```typescript
import { beforeEach, describe, expect, it } from "vitest";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";
import {
  __resetSettingsForTests,
  getUserFeatureToggles,
  getUserLanguage,
  getUserOpenCodeLogin,
  getUserOpenCodePassword,
  getUserOpenCodePasswordMode,
  hasCompletedOnboarding,
  markOnboardingCompleted,
  setUserFeatureToggle,
  setUserLanguage,
  setUserOpenCodeLogin,
  setUserOpenCodePassword,
  setUserOpenCodePasswordMode,
} from "../../src/settings/manager.js";

describe("settings onboarding state", () => {
  const scopeA = { userId: 101, chatId: 1000, messageThreadId: 10 };
  const scopeB = { userId: 202, chatId: 1000, messageThreadId: 10 };

  beforeEach(() => {
    __resetSettingsForTests();
  });

  it("defaults onboarding to incomplete and language to the configured locale", () => {
    expect(runWithTelegramConversationScope(scopeA, () => hasCompletedOnboarding())).toBe(false);
    expect(runWithTelegramConversationScope(scopeA, () => getUserLanguage())).toBe("en");
  });

  it("stores onboarding completion, language, toggles, and credentials per user", () => {
    runWithTelegramConversationScope(scopeA, () => {
      markOnboardingCompleted();
      setUserLanguage("ru");
      setUserFeatureToggle("show_agent_activity", true);
      setUserFeatureToggle("show_file_edits", false);
      setUserOpenCodeLogin("101");
      setUserOpenCodePasswordMode("manual");
      setUserOpenCodePassword("s3cr3t");
    });

    expect(runWithTelegramConversationScope(scopeA, () => hasCompletedOnboarding())).toBe(true);
    expect(runWithTelegramConversationScope(scopeA, () => getUserLanguage())).toBe("ru");
    expect(runWithTelegramConversationScope(scopeA, () => getUserFeatureToggles())).toEqual({
      show_agent_activity: true,
      show_file_edits: false,
    });
    expect(runWithTelegramConversationScope(scopeA, () => getUserOpenCodeLogin())).toBe("101");
    expect(runWithTelegramConversationScope(scopeA, () => getUserOpenCodePasswordMode())).toBe(
      "manual",
    );
    expect(runWithTelegramConversationScope(scopeA, () => getUserOpenCodePassword())).toBe(
      "s3cr3t",
    );
  });

  it("does not leak user settings across user scopes", () => {
    runWithTelegramConversationScope(scopeA, () => {
      markOnboardingCompleted();
      setUserLanguage("ru");
      setUserFeatureToggle("show_agent_activity", true);
      setUserOpenCodeLogin("101");
      setUserOpenCodePasswordMode("manual");
    });

    expect(runWithTelegramConversationScope(scopeB, () => hasCompletedOnboarding())).toBe(false);
    expect(runWithTelegramConversationScope(scopeB, () => getUserLanguage())).toBe("en");
    expect(runWithTelegramConversationScope(scopeB, () => getUserFeatureToggles())).toEqual({});
    expect(runWithTelegramConversationScope(scopeB, () => getUserOpenCodeLogin())).toBeUndefined();
    expect(runWithTelegramConversationScope(scopeB, () => getUserOpenCodePasswordMode())).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run: `npm test -- tests/settings/manager.test.ts`
Expected: FAIL because the new onboarding and preference helpers do not exist yet.

- [ ] **Step 3: Add the minimal settings implementation**

```typescript
// src/settings/manager.ts
export type UserOpenCodePasswordMode = "manual" | "generated";

export interface ScopedUserSettings {
  ttsEnabled?: boolean;
  messageStreamingEnabled?: boolean;
  thinkingClearMode?: boolean;
  onboardingCompleted?: boolean;
  language?: string;
  featureToggles?: Record<string, boolean>;
  opencodeLogin?: string;
  opencodePasswordMode?: UserOpenCodePasswordMode;
  opencodePassword?: string;
}

function cloneScopedUserSettings(
  settings: ScopedUserSettings | undefined,
): ScopedUserSettings | undefined {
  if (!settings) {
    return undefined;
  }

  return {
    ttsEnabled: settings.ttsEnabled,
    messageStreamingEnabled: settings.messageStreamingEnabled,
    thinkingClearMode: settings.thinkingClearMode,
    onboardingCompleted: settings.onboardingCompleted,
    language: settings.language,
    featureToggles: settings.featureToggles ? { ...settings.featureToggles } : undefined,
    opencodeLogin: settings.opencodeLogin,
    opencodePasswordMode: settings.opencodePasswordMode,
    opencodePassword: settings.opencodePassword,
  };
}

export function hasCompletedOnboarding(): boolean {
  return getScopedUserSettings()?.onboardingCompleted ?? false;
}

export function markOnboardingCompleted(): void {
  const scopedSettings = getOrCreateScopedUserSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.onboardingCompleted = true;
  void writeSettingsFile(currentSettings);
}

export function getUserLanguage(): string {
  return getScopedUserSettings()?.language ?? config.bot.locale ?? "en";
}

export function setUserLanguage(language: string): void {
  const scopedSettings = getOrCreateScopedUserSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.language = language;
  void writeSettingsFile(currentSettings);
}

export function getUserFeatureToggles(): Record<string, boolean> {
  return { ...(getScopedUserSettings()?.featureToggles ?? {}) };
}

export function setUserFeatureToggle(name: string, enabled: boolean): void {
  const scopedSettings = getOrCreateScopedUserSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.featureToggles = {
    ...(scopedSettings.featureToggles ?? {}),
    [name]: enabled,
  };
  void writeSettingsFile(currentSettings);
}

export function getUserOpenCodeLogin(): string | undefined {
  return getScopedUserSettings()?.opencodeLogin;
}

export function setUserOpenCodeLogin(login: string): void {
  const scopedSettings = getOrCreateScopedUserSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.opencodeLogin = login;
  void writeSettingsFile(currentSettings);
}

export function getUserOpenCodePasswordMode(): UserOpenCodePasswordMode | undefined {
  return getScopedUserSettings()?.opencodePasswordMode;
}

export function setUserOpenCodePasswordMode(mode: UserOpenCodePasswordMode): void {
  const scopedSettings = getOrCreateScopedUserSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.opencodePasswordMode = mode;
  void writeSettingsFile(currentSettings);
}

export function getUserOpenCodePassword(): string | undefined {
  return getScopedUserSettings()?.opencodePassword;
}

export function setUserOpenCodePassword(password: string): void {
  const scopedSettings = getOrCreateScopedUserSettings();
  if (!scopedSettings) {
    return;
  }

  scopedSettings.opencodePassword = password;
  void writeSettingsFile(currentSettings);
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test -- tests/settings/manager.test.ts`
Expected: PASS with the new onboarding and preference helpers green.

- [ ] **Step 5: Commit**

```bash
git add tests/settings/manager.test.ts src/settings/manager.ts
git commit -m "feat: add per-user onboarding state"
```

### Task 2: Add first-run language onboarding in `/start`

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/start.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/index.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/en.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/ru.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/de.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/es.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/fr.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/zh.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/start.test.ts`

- [ ] **Step 1: Add failing tests for onboarding branch and normal branch**

```typescript
import { beforeEach, describe, expect, it, vi } from "vitest";
import { startCommand } from "../../../src/bot/commands/start.js";

const settingsMock = vi.hoisted(() => ({
  hasCompletedOnboardingMock: vi.fn(),
  markOnboardingCompletedMock: vi.fn(),
  setUserLanguageMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  clearProject: vi.fn(),
  hasCompletedOnboarding: settingsMock.hasCompletedOnboardingMock,
  markOnboardingCompleted: settingsMock.markOnboardingCompletedMock,
  setUserLanguage: settingsMock.setUserLanguageMock,
}));

it("shows onboarding language choices when onboarding is incomplete", async () => {
  settingsMock.hasCompletedOnboardingMock.mockReturnValue(false);
  // Expect ctx.reply to receive the language-selection prompt and keyboard.
});

it("runs the existing welcome flow when onboarding is completed", async () => {
  settingsMock.hasCompletedOnboardingMock.mockReturnValue(true);
  // Expect the existing reset/welcome path to keep working.
});
```

- [ ] **Step 2: Run the start test to verify it fails**

Run: `npm test -- tests/bot/commands/start.test.ts`
Expected: FAIL because the onboarding branch and language selection handling do not exist yet.

- [ ] **Step 3: Implement the minimal onboarding branch in `/start`**

```typescript
// src/bot/commands/start.ts
import { getLocaleOptions, t } from "../../i18n/index.js";
import { hasCompletedOnboarding } from "../../settings/manager.js";

export async function startCommand(ctx: Context): Promise<void> {
  if (!hasCompletedOnboarding()) {
    const options = getLocaleOptions();
    await ctx.reply(
      t("onboarding.choose_language"),
      withMessageThreadId(
        {
          reply_markup: {
            inline_keyboard: options.map((option) => [
              { text: option.label, callback_data: `onboarding:language:${option.code}` },
            ]),
          },
        },
        extractMessageThreadIdFromContext(ctx),
      ),
    );
    return;
  }

  // keep the current reset + welcome path unchanged here
}
```

- [ ] **Step 4: Add callback handling for language choice and onboarding completion**

```typescript
// src/bot/index.ts
// Register a callback handler for onboarding:language:<code>
// On select:
// - call setUserLanguage(code)
// - call markOnboardingCompleted()
// - reply with a localized onboarding completion message
// - continue to the existing welcome flow
```

- [ ] **Step 5: Add the new onboarding strings**

```typescript
// src/i18n/en.ts
export const en = {
  // ...existing keys...
  "onboarding.choose_language": "Choose your interface language.",
  "onboarding.completed": "Onboarding completed.",
  "onboarding.language_selected": "Language saved: {language}",
};
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test -- tests/bot/commands/start.test.ts tests/bot/commands/help.test.ts`
Expected: PASS with first-run onboarding and existing welcome flow green.

- [ ] **Step 7: Commit**

```bash
git add src/bot/commands/start.ts src/bot/index.ts src/i18n/*.ts tests/bot/commands/start.test.ts
git commit -m "feat: add first-run language onboarding"
```

### Task 3: Show per-user language, toggles, and OpenCode credentials in `/status`

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/status.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/bot/commands/status.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/en.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/ru.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/de.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/es.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/fr.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/zh.ts`

- [ ] **Step 1: Add a failing status test for user-scoped account info**

```typescript
import { describe, expect, it, vi } from "vitest";
import { statusCommand } from "../../../src/bot/commands/status.js";

it("includes language, login, password mode, and endpoint in status", async () => {
  // Arrange settings mocks to return ru, login 101, manual password mode, and a concrete endpoint.
  // Expect the rendered status message to contain all four lines.
});
```

- [ ] **Step 2: Run the status test to verify it fails**

Run: `npm test -- tests/bot/commands/status.test.ts`
Expected: FAIL because the new status lines do not exist yet.

- [ ] **Step 3: Extend status rendering with user-scoped connection info**

```typescript
// src/bot/commands/status.ts
import {
  getUserFeatureToggles,
  getUserLanguage,
  getUserOpenCodeLogin,
  getUserOpenCodePasswordMode,
  getUserOpenCodePassword,
} from "../../settings/manager.js";

// Add the following lines when the data exists:
// - Language: {language}
// - OpenCode login: {login}
// - Password mode: {mode}
// - OpenCode password: {password or generated marker}
// - Endpoint: {baseUrl}:{port}
// - Feature toggles summary when any user toggle is enabled
```

- [ ] **Step 4: Add localized strings for the new status fields**

```typescript
// src/i18n/en.ts
export const en = {
  // ...existing keys...
  "status.line.user_language": "Language: {language}",
  "status.line.opencode_login": "OpenCode login: {login}",
  "status.line.opencode_password_mode": "Password mode: {mode}",
  "status.line.opencode_password": "OpenCode password: {password}",
  "status.line.opencode_endpoint": "Endpoint: {endpoint}",
  "status.line.feature_toggle": "{name}: {value}",
};
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/bot/commands/status.test.ts`
Expected: PASS with the new status lines green.

- [ ] **Step 6: Commit**

```bash
git add src/bot/commands/status.ts src/i18n/*.ts tests/bot/commands/status.test.ts
git commit -m "feat: show per-user connection settings in status"
```

### Task 4: Add password generation and manual/generated password flows

**Files:**
- Modify: `/home/me/MyProjects/opencode-tg/src/settings/manager.ts`
- Modify: `/home/me/MyProjects/opencode-tg/tests/settings/manager.test.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/bot/commands/status.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/en.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/ru.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/de.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/es.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/fr.ts`
- Modify: `/home/me/MyProjects/opencode-tg/src/i18n/zh.ts`

- [ ] **Step 1: Add failing tests for generated passwords**

```typescript
import { describe, expect, it } from "vitest";
import { generateUserOpenCodePassword } from "../../src/settings/manager.js";

it("generates a password long enough for a manual login replacement", () => {
  const password = generateUserOpenCodePassword();
  expect(password.length).toBeGreaterThanOrEqual(16);
});
```

- [ ] **Step 2: Run the settings test to verify it fails**

Run: `npm test -- tests/settings/manager.test.ts`
Expected: FAIL because the generator does not exist yet.

- [ ] **Step 3: Implement password generation and password mode defaults**

```typescript
// src/settings/manager.ts
import crypto from "node:crypto";

export function generateUserOpenCodePassword(): string {
  return crypto.randomBytes(18).toString("base64url");
}

export function getUserOpenCodePasswordMode(): UserOpenCodePasswordMode | undefined {
  return getScopedUserSettings()?.opencodePasswordMode ?? undefined;
}
```

- [ ] **Step 4: Update status text to distinguish manual and generated passwords**

```typescript
// src/bot/commands/status.ts
// Render password mode as either "manual" or "generated" and show the stored password only if the user explicitly chose to reveal it.
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm test -- tests/settings/manager.test.ts tests/bot/commands/status.test.ts`
Expected: PASS with password generation and mode tracking green.

- [ ] **Step 6: Commit**

```bash
git add src/settings/manager.ts src/bot/commands/status.ts tests/settings/manager.test.ts
git commit -m "feat: add per-user opencode password management"
```

## Validation Checklist

- [ ] `npm test -- tests/settings/manager.test.ts`
- [ ] `npm test -- tests/bot/commands/start.test.ts`
- [ ] `npm test -- tests/bot/commands/status.test.ts`
- [ ] `npm test -- tests/bot/commands/help.test.ts`
- [ ] `npm run lint`
- [ ] `npm run build`

## Dependencies And Ordering

1. Settings persistence comes first, because onboarding, language, feature toggles, and password data all need a stable storage model.
2. First-run routing comes second, because the user must choose a language before the rest of the UI can be localized correctly.
3. Status rendering comes next, because it is the read-only consumer of the settings model and is the quickest place to validate the data path.
4. Password generation follows once the persistence API and status display are stable.
5. Any future `/settings` or `/profile` command should only be added after these storage and status paths are proven by tests.

## Risks

- Mixing language preference with global locale fallback can produce inconsistent UI if the active locale source is unclear.
- Showing account credentials in `/status` increases sensitivity, so the final implementation must only reveal them to the owning user.
- Passwords must not be logged or echoed outside the explicit status flow.
- Feature toggles need a clear ownership model, or users will not know whether a switch is personal or global.

## Open Questions

- Which feature toggles should be exposed in the first release: service messages, thinking output, agent trace visibility, or something else?
- Should the onboarding flow finish after language selection, or should it force the user through login/password setup immediately?
- Should generated passwords be shown only once at creation time, or should `/status` always be able to reveal them?
- Do we want a dedicated `/settings` or `/profile` command in this phase, or keep everything inside onboarding and `/status` for now?
