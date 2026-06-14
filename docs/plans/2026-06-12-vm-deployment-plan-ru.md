# План реализации: VM-развёртывание tenant workspace

**Цель:** Добавить виртуальные машины QEMU/KVM как альтернативу Docker-контейнерам для tenant workspace, с интерактивным выбором характеристик.

**Архитектура:** Новый модуль `src/vm/` управляет жизненным циклом VM через virsh CLI. ProcessManager получает ветку `kind: "vm"`. Прокси opencodeClient добавляет vm-маршрут. Обработчик бота показывает inline-меню выбора тарифа при первом запуске. Ноль изменений в Docker-коде.

**Стек:** TypeScript 5.x, grammY, libvirt/virsh CLI, qemu-img, cloud-localds, SQLite (settings.db)

**Спека:** `docs/superpowers/specs/2026-06-12-vm-deployment-design-ru.md`

---

## Фаза 1: Типы и интерфейсы

### Задача 1.1: VmSpec, VmInfo, VM_TIERS

**Файл:** Создать `src/vm/types.ts`

Константы тарифов:
```typescript
export const VM_TIERS = {
  small:  { tier: "small",  ramMb: 2048,  vcpus: 1, diskGb: 20,  label: "Базовый" },
  medium: { tier: "medium", ramMb: 4096,  vcpus: 2, diskGb: 50,  label: "Стандартный" },
  large:  { tier: "large",  ramMb: 8192,  vcpus: 4, diskGb: 100, label: "Продвинутый" },
  xlarge: { tier: "xlarge", ramMb: 16384, vcpus: 8, diskGb: 250, label: "Максимальный" },
};
```

Типы: `VmSpecTier`, `VmSpec`, `VmInfo`, `VmOperationResult`, `VM_DEFAULTS` (пути, таймауты, порты).

### Задача 1.2: Добавить "vm" в ProcessRuntimeInfo.kind

**Файл:** `src/process/types.ts`, строка 16

Было: `kind: "host" | "tenant"`
Стало: `kind: "host" | "tenant" | "vm"`

Также добавить `needsVmSpec?: boolean` в `ProcessOperationResult`.

---

## Фаза 2: Settings / SQLite

### Задача 2.1: deployTarget в TenantRuntimeInfo

**Файл:** `src/settings/manager.ts`, после строки 100

Добавить поле: `deployTarget?: "docker" | "vm"`

### Задача 2.2: Пользовательские настройки deployTarget и vmSpecTier

**Файл:** `src/settings/manager.ts`

Добавить функции (используют существующий `user_preferences` репозиторий):
- `getUserDeployTarget(userId)` → `"docker" | "vm" | undefined`
- `setUserDeployTarget(userId, target)`
- `getUserVmSpecTier(userId)` → `VmSpecTier | undefined`
- `setUserVmSpecTier(userId, tier)`

### Задача 2.3: Таблица vm_runtimes

**Файлы:**
- `src/settings/db.ts` — новый `CREATE TABLE vm_runtimes (user_id INTEGER PRIMARY KEY, data TEXT NOT NULL)`
- `src/settings/repositories/vm-runtimes.ts` — новый репозиторий с CRUD (по образцу `runtime.ts`)
- `src/settings/repositories/types.ts` — добавить `VmRuntimeRow`
- `src/settings/manager.ts` — функции `getVmRuntimeInfo`, `setVmRuntimeInfo`, `clearVmRuntimeInfo`

---

## Фаза 3: Модуль VmManager

### Задача 3.1: Скелет VmManager

**Файл:** Создать `src/vm/manager.ts`

Класс `VmManager` с методами-заглушками:
- `isAvailable()` — проверить наличие virsh/qemu-img
- `ensureBaseImage()` — проверить golden image
- `createAndStart(userId, spec)` — клон qcow2 + cloud-init + virsh start
- `generateSudoPassword()` — случайный пароль (crypto.randomBytes)
- `stop(userId)` — virsh shutdown/destroy
- `destroy(userId)` — virsh undefine + удалить файлы
- `isRunning(userId)` — virsh domstate
- `waitForHealth(baseUrl, password)` — HTTP health-check
- `getBridgeIp(userId)` — virsh domifaddr

### Задача 3.2: isAvailable()

Проверка через `which virsh` и `which qemu-img`. Если нет — VM-развёртывание недоступно.

**Тест:** мок execSync → virsh найден/не найден.

### Задача 3.3: ensureBaseImage()

Проверка `existsSync("/var/lib/libvirt/images/opencode-base.qcow2")`.

**Тест:** файл есть/нет.

### Задача 3.4: Генератор cloud-init ISO с sudo-паролем

**Файл:** Создать `src/vm/cloud-init.ts`

Ключевые функции:
```typescript
import { randomBytes } from "crypto";
import { execSync } from "child_process";

export function generateSudoPassword(): string {
  return randomBytes(12).toString("base64url").slice(0, 16);
}

export function hashPassword(password: string): string {
  return execSync(`mkpasswd -m sha-512 "${password}"`, { encoding: "utf-8" }).trim();
}

export function generateCloudInitIso(
  userId: number,
  spec: VmSpec,
  opencodePassword: string,
  sudoPassword: string,
  outputPath: string,
): void {
  const hostname = `opencode-tg-${userId}`;
  const hashedSudoPw = hashPassword(sudoPassword);

  const userData = `#cloud-config
hostname: ${hostname}
manage_etc_hosts: true
users:
  - name: opencode
    gecos: OpenCode User
    sudo: ALL=(ALL) NOPASSWD:ALL
    shell: /bin/bash
    lock_passwd: false
    passwd: ${hashedSudoPw}
ssh_pwauth: true
package_update: true
write_files:
  - path: /etc/opencode/env
    content: |
      OPENCODE_SERVER_PASSWORD=${opencodePassword}
      TG_ID=${userId}
    permissions: '0600'
  - path: /home/opencode/.sudo
    content: ${sudoPassword}
    owner: 'opencode:opencode'
    permissions: '0600'
  - path: /workspace/AGENTS.md
    content: |
      # AGENTS.md
      ## Sudo access
      For system operations requiring sudo, read the password from \`/home/opencode/.sudo\`.
      Example: \`cat /home/opencode/.sudo | sudo -S <command>\`
    permissions: '0644'
runcmd:
  - systemctl enable opencode
  - systemctl start opencode
`;
  // ... запись user-data и meta-data, запуск cloud-localds
}
```

**Тест:** мок execSync, проверка содержимого user-data.

### Задача 3.5: createAndStart()

Алгоритм:
1. `generateSudoPassword()` — случайный пароль
2. `qemu-img create -f qcow2 -b base.qcow2 opencode-tg-{id}.qcow2 {size}G`
3. `generateCloudInitIso(userId, spec, opencodePw, sudoPw, isoPath)`
4. `virsh define domain.xml`
5. `virsh start opencode-tg-{id}`
6. Ожидание bridge IP через `virsh domifaddr`
7. Сохранить sudoPassword в возвращаемом VmInfo (для AGENTS.md)
8. Возврат `VmInfo`

**VmInfo расширяется полем `sudoPassword?: string`.**

**Domain XML:** включает virtio-mem.

**Тест:** мок всех команд, проверка VmInfo.sudoPassword.

### Задача 3.6: Остальные методы

- `stop()`: virsh shutdown → virsh destroy (force)
- `destroy()`: stop + virsh undefine --remove-all-storage
- `isRunning()`: virsh domstate === "running"
- `waitForHealth()`: HTTP GET /global/health с Basic auth
- `getBridgeIp()`: virsh domifaddr с 3 ретраями по 5с

**Тесты:** для каждого метода.

---

## Фаза 4: Интеграция в ProcessManager

### Задача 4.1: Ветка vm в ProcessManager

**Файл:** `src/process/manager.ts`

Добавить:
- Поле `vmManager` (импорт из `src/vm/manager.js`)
- `getDeployTarget(userId)` → читает из `getUserDeployTarget`
- `ensureVmRuntime(userId)`:
  - Проверяет, не запущена ли уже VM → health-check → вернуть success
  - Если нет tier → вернуть `{ success: false, needsVmSpec: true }`
  - Проверяет base image
  - Вызывает `vmManager.createAndStart`
  - Сохраняет VmInfo в SQLite
  - Ждёт health → успех/ошибка
- Обновить `ensureRuntime()`: если deployTarget === "vm" → ensureVmRuntime
- Обновить `getCurrentRuntimeInfo()`: vm → возвращать kind="vm" с baseUrl VM
- Обновить `stop()`, `isRunning()`, `getPID()`, `getUptime()`: делегировать vmManager

---

## Фаза 5: Интеграция в opencodeClient

### Задача 5.1: vm-маршрут в прокси

**Файл:** `src/opencode/client.ts`

В `getCurrentOpencodeRoute()` добавить vm-ветку (после SSH, перед admin):
```typescript
if (deployTarget === "vm") {
  const vmInfo = getVmRuntimeInfo(scope.userId);
  return {
    runtimeKey: `vm:${userId}:${vmInfo.domainName}`,
    baseUrl: vmInfo.baseUrl,
    kind: "vm",
    password: vmPassword,
  };
}
```

В `ensureCurrentOpencodeRouteReady()` добавить vm-путь:
```typescript
if (deployTarget === "vm") {
  const result = await processManager.ensureRuntime();
  if (result.needsVmSpec) throw new NeedsDeployTargetError("vm_spec_required", userId);
}
```

Добавить класс `NeedsDeployTargetError` (экспортируется).

---

## Фаза 6: Обработчик бота — onboarding (язык → конфигурация)

### Задача 6.1: Inline-меню выбора языка и конфигурации

**Файлы:**
- Создать `src/bot/handlers/onboarding-flow.ts`
- Изменить `src/bot/handlers/prompt.ts`

**Новый файл `onboarding-flow.ts` — два inline-меню:**

```typescript
// Меню 1: выбор языка (если locale не установлен)
export async function showLanguageSelection(ctx: Context): Promise<void> {
  await ctx.reply("Выберите язык / Choose language:", {
    reply_markup: {
      inline_keyboard: [
        [{ text: "🇷🇺 Русский", callback_data: "onboarding:lang:ru" }],
        [{ text: "🇬🇧 English", callback_data: "onboarding:lang:en" }],
      ],
    },
  });
}

// Меню 2: выбор конфигурации системы
export async function showDeployTargetSelection(ctx: Context): Promise<void> {
  const tiers = Object.entries(VM_TIERS);
  const keyboard = tiers.map(([key, spec]) => [{
    text: `${spec.label}: ${spec.ramMb / 1024}GB RAM / ${spec.vcpus} vCPU / ${spec.diskGb}GB SSD`,
    callback_data: `onboarding:vm:${key}`,
  }]);
  keyboard.push([{
    text: "🐳 Docker (без виртуализации)",
    callback_data: "onboarding:docker",
  }]);

  await ctx.reply("Выберите конфигурацию сервера:", {
    reply_markup: { inline_keyboard: keyboard },
  });
}
```

**Callback handler — `handleOnboardingCallback`:**

```typescript
export async function handleOnboardingCallback(ctx: Context): Promise<boolean> {
  const data = ctx.callbackQuery?.data;
  const userId = ctx.from?.id;
  if (!data || !userId) return false;

  // Язык
  if (data.startsWith("onboarding:lang:")) {
    const locale = data.slice("onboarding:lang:".length) as Locale;
    setUserLocale(locale);
    await ctx.answerCallbackQuery({ text: locale === "ru" ? "Русский" : "English" });
    await ctx.editMessageText(
      locale === "ru" ? "✅ Язык: Русский" : "✅ Language: English"
    );
    // Переход к выбору конфигурации
    await showDeployTargetSelection(ctx);
    return true;
  }

  // Docker
  if (data === "onboarding:docker") {
    setUserDeployTarget(userId, "docker");
    await ctx.answerCallbackQuery();
    await ctx.editMessageText("✅ Docker. Создаю контейнер...");
    const result = await processManager.ensureRuntime();
    if (result.success) {
      await ctx.reply("✅ Сервер готов. Можете отправлять запросы.");
    } else {
      await ctx.reply(`❌ Ошибка: ${result.error}`);
    }
    return true;
  }

  // VM tier
  const vmMatch = data.match(/^onboarding:vm:(.+)$/);
  if (vmMatch) {
    const tier = vmMatch[1] as VmSpecTier;
    const spec = VM_TIERS[tier];
    if (!spec) return false;

    setUserDeployTarget(userId, "vm");
    setUserVmSpecTier(userId, tier);

    await ctx.answerCallbackQuery();
    await ctx.editMessageText(
      `✅ ${spec.label} (${spec.ramMb / 1024}GB / ${spec.vcpus} vCPU / ${spec.diskGb}GB). Создаю виртуальный сервер...`
    );

    const result = await processManager.ensureRuntime();
    if (result.success) {
      const vmInfo = getVmRuntimeInfo(userId);
      const msg = [
        "✅ Сервер готов!",
        `Адрес: ${vmInfo?.baseUrl}`,
        vmInfo?.sudoPassword
          ? `Sudo пароль: <code>${vmInfo.sudoPassword}</code>`
          : "",
      ].filter(Boolean).join("\n");
      await ctx.reply(msg, { parse_mode: "HTML" });
    } else {
      await ctx.reply(`❌ Ошибка: ${result.error}`);
    }
    return true;
  }

  return false;
}
```

**Интеграция в prompt.ts:**
- В `onError` обработчике safeBackgroundTask: ловить `NeedsDeployTargetError`
- Проверить `getUserLocale(userId)`:
  - Если не установлен → `showLanguageSelection(ctx)`
  - Если установлен → `showDeployTargetSelection(ctx)`

**Регистрация в bot/index.ts:**
- `bot.on("callback_query:data")` — роутинг handler должен обрабатывать `onboarding:lang:*`, `onboarding:vm:*`, `onboarding:docker` до того как упадёт в общий fallback.
- Использовать существующий `handleOnboardingCallback` или заменить его новым из `onboarding-flow.ts`.

**VmLInfo.sudoPassword:**
- Добавить поле `sudoPassword?: string` в `VmInfo` (src/vm/types.ts)
- В `createAndStart()`: сохранить сгенерированный пароль в VmInfo
- В `ensureVmRuntime()`: сохранить VmInfo с паролем в SQLite

---

## Фаза 7: Проверка и документирование

### Задача 7.1: Сборка и линтер

```bash
npx tsc --noEmit
npm run lint
npm run build
```

Ожидание: всё PASS.

### Задача 7.2: Полный прогон тестов

```bash
npm test
```

Ожидание: существующие тесты PASS, новые VM-тесты PASS.

### Задача 7.3: Интеграционные тесты ProcessManager + VM

**Файл:** Создать `tests/process/manager-vm.test.ts`

Сценарии:
1. deployTarget="vm", нет tier → returns needsVmSpec: true
2. deployTarget="vm", есть tier, нет base image → returns error
3. deployTarget="vm", есть tier, VM создана → returns success
4. deployTarget="vm", VM уже запущена → returns success сразу
5. deployTarget="vm", VM мертва → чистит и пересоздаёт

Использовать те же мок-паттерны что в `manager.test.ts`.

### Задача 7.4: CHANGELOG.md

```markdown
### Добавлено
- VM-развёртывание tenant workspace (QEMU/KVM + libvirt)
- Интерактивный выбор тарифа VM через inline-меню Telegram (4 тарифа)
- virtio-mem для динамического выделения памяти
- qcow2 backing files для тонкого выделения диска
```

### Задача 7.5: PRODUCT.md

Отметить чекбокс: `[x] VM-based tenant workspace deployment`

---

## Сводка: файлы

| Файл | Действие |
|------|----------|
| `src/vm/types.ts` | Создать |
| `src/vm/manager.ts` | Создать |
| `src/vm/cloud-init.ts` | Создать |
| `src/process/types.ts` | Изменить (+"vm", +needsVmSpec) |
| `src/process/manager.ts` | Изменить (+vm-ветка, ~100 строк) |
| `src/settings/manager.ts` | Изменить (+deployTarget, +vm CRUD) |
| `src/settings/repositories/vm-runtimes.ts` | Создать |
| `src/settings/repositories/types.ts` | Изменить (+VmRuntimeRow) |
| `src/settings/db.ts` | Изменить (+таблица) |
| `src/opencode/client.ts` | Изменить (+vm route, +NeedsDeployTargetError) |
| `src/bot/handlers/vm-spec-selection.ts` | Создать |
| `src/bot/handlers/prompt.ts` | Изменить (+ловля ошибки) |
| `tests/vm/manager.test.ts` | Создать |
| `tests/process/manager-vm.test.ts` | Создать |
| `PRODUCT.md` | Изменить |
| `CHANGELOG.md` | Изменить |

**Итого:** 8 новых файлов, 8 изменяемых, ~500 строк нового кода, ~200 строк тестов.
