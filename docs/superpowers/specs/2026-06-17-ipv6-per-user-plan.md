# IPv6 Per-User — План реализации (TDD)

> **Цель:** Каждый пользователь бота получает уникальный публичный IPv6 из диапазона VPS `2607:9d00:2000:1f6::/64`, маршрутизируемый через AmneziaWG-туннель к VM.

> **Принцип:** IPv4 VPS НЕ раскрывается пользователям. Пользователь видит только свой IPv6 и стандартный `baseUrl` бота (который использует внутренний IPv4 VM).

---

## Этап 0: Инфраструктура (ручная настройка, один раз)

Выполняется на VPS и домашнем сервере до начала кодинга.

### Task 0.1: Установка AmneziaWG и генерация ключей

**Цель:** Обе стороны имеют AmneziaWG и пару ключей.

**На VPS:**
```bash
# Установка (если нет)
apt-get install -y wireguard-tools
# Генерация ключей
awg genkey | tee /etc/amneziawg/vps-private.key | awg pubkey > /etc/amneziawg/vps-public.key
```

**На хосте:**
```bash
apt-get install -y wireguard-tools
awg genkey | tee /etc/amneziawg/home-private.key | awg pubkey > /etc/amneziawg/home-public.key
```

### Task 0.2: Конфигурация AmneziaWG на VPS

**Файл:** `/etc/amneziawg/awg0.conf`
```ini
[Interface]
PrivateKey = <vps-private>
Address = fd00::1/64
ListenPort = 51820

[Peer]
PublicKey = <home-public>
AllowedIPs = fd00::2/128, 2607:9d00:2000:1f6::/64
PersistentKeepalive = 25
```

**Запуск:** `systemctl enable --now awg-quick@awg0`

### Task 0.3: Конфигурация AmneziaWG на хосте

**Файл:** `/etc/amneziawg/awg0.conf`
```ini
[Interface]
PrivateKey = <home-private>
Address = fd00::2/64

[Peer]
PublicKey = <vps-public>
Endpoint = <vps-ipv4>:51820
AllowedIPs = fd00::1/128
PersistentKeepalive = 25
```

**Запуск:** `systemctl enable --now awg-quick@awg0`

### Task 0.4: Включение IPv6 forwarding

**Оба сервера:**
```bash
echo 'net.ipv6.conf.all.forwarding=1' >> /etc/sysctl.d/99-ipv6.conf
sysctl -p /etc/sysctl.d/99-ipv6.conf
```

### Task 0.5: ndppd на VPS

```bash
apt-get install -y ndppd
```

**Файл:** `/etc/ndppd.conf`
```
proxy eth0 {
  rule 2607:9d00:2000:1f6::/64 {
    static
  }
}
```

**Запуск:** `systemctl enable --now ndppd`

### Task 0.6: Маршрут /64 на VPS

```bash
ip -6 route add 2607:9d00:2000:1f6::/64 via fd00::2 dev awg0
```
Добавить в `/etc/amneziawg/awg0.conf` секцию `PostUp`.

### Task 0.7: Проверка туннеля

```bash
# С VPS
ping6 fd00::2          # должен отвечать хост
# С хоста
ping6 fd00::1          # должен отвечать VPS
```

---

## Этап 1: Генерация IPv6 (TDD)

### Task 1.1: Тест — generateIpv6ForUser возвращает адрес из правильной подсети

**Файл:** `tests/vm/manager.test.ts` (добавить describe блок)

Импортировать `generateIpv6ForUser` напрямую (функция будет экспортирована):
```typescript
import { generateIpv6ForUser } from "../../src/vm/manager.js";
```

```typescript
describe("generateIpv6ForUser", () => {
  it("returns an IPv6 in the correct /64 subnet", () => {
    const ipv6 = generateIpv6ForUser(1);
    expect(ipv6).toMatch(/^2607:9d00:2000:1f6:/);
  });

  it("returns deterministic address for same userId", () => {
    const a = generateIpv6ForUser(42);
    const b = generateIpv6ForUser(42);
    expect(a).toBe(b);
  });

  it("returns different addresses for different users", () => {
    const a = generateIpv6ForUser(1);
    const b = generateIpv6ForUser(2);
    expect(a).not.toBe(b);
  });

  it("never returns ::1 (reserved for gateway)", () => {
    for (let i = 0; i < 1000; i++) {
      const ipv6 = generateIpv6ForUser(i);
      expect(ipv6).not.toBe("2607:9d00:2000:1f6::1");
    }
  });
});
```

**Запуск:** `npx vitest run tests/vm/manager.test.ts` — FAIL (generateIpv6ForUser не существует)

### Task 1.2: Реализация generateIpv6ForUser

**Файл:** `src/vm/manager.ts`

Добавить функцию после `generateIpForUser`. **Экспортировать** для тестирования:

```typescript
/** Deterministic IPv6 from VPS /64 range: 2607:9d00:2000:1f6::<hash%2^64>
 *  Address ::1 is reserved for gateway. User addresses start from ::2. */
export function generateIpv6ForUser(userId: number): string {
  const h = knuthHash(userId);
  const host = BigInt(h >>> 0) % ((1n << 64n) - 2n) + 2n;
  const hex = host.toString(16).padStart(16, "0");
  return `2607:9d00:2000:1f6::${hex}`;
}
```

**Запуск:** `npx vitest run tests/vm/manager.test.ts` — все тесты `generateIpv6ForUser` PASS (4/4)

---

## Этап 2: IPv6 в типах и менеджере (TDD)

### Task 2.1: Добавить ipv6 в VmInfo

**Файл:** `src/vm/types.ts`

```typescript
export interface VmInfo {
  // ... existing fields ...
  ipv6?: string;
}
```

**Запуск:** `npx tsc --noEmit` — без ошибок

### Task 2.2: Тест — createAndStart включает ipv6 в результат

**Файл:** `tests/vm/manager.test.ts` — дополнить существующий тест `returns VmInfo with correct fields on success`

Добавить проверку:
```typescript
expect(result.ipv6).toMatch(/^2607:9d00:2000:1f6:/);
```

**Запуск:** `npx vitest run tests/vm/manager.test.ts` — FAIL (ipv6 не заполняется)

### Task 2.3: Реализация — заполняем ipv6 в createAndStart

**Файл:** `src/vm/manager.ts`

В `createAndStart`, в return-объект добавить:
```typescript
return {
  // ... existing fields ...
  ipv6: generateIpv6ForUser(userId),
};
```

**Запуск:** `npx vitest run tests/vm/manager.test.ts` — PASS

---

## Этап 3: Маршрутизация IPv6 до VM (TDD)

### Task 3.1: Тест — addVmIpv6Route и removeVmIpv6Route вызывают ip route

**Файл:** `tests/vm/manager.test.ts`

```typescript
describe("IPv6 routing", () => {
  it("addVmIpv6Route adds ipv6 route via vnet interface", async () => {
    const mockExec = vi.fn();
    const mgr = new VmManager(mockExec);
    await mgr.addVmIpv6Route("opencode-tg-1", "2607:9d00:2000:1f6::abcd");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("sudo ip -6 route add 2607:9d00:2000:1f6::abcd/128 dev"),
      expect.any(Object),
    );
  });

  it("removeVmIpv6Route removes ipv6 route", async () => {
    const mockExec = vi.fn();
    const mgr = new VmManager(mockExec);
    await mgr.removeVmIpv6Route("opencode-tg-1");
    expect(mockExec).toHaveBeenCalledWith(
      expect.stringContaining("sudo ip -6 route del"),
      expect.any(Object),
    );
  });

  it("addVmIpv6Route does not throw on failure", async () => {
    const mockExec = vi.fn().mockImplementation(() => { throw new Error("no vnet"); });
    const mgr = new VmManager(mockExec);
    await expect(mgr.addVmIpv6Route("no-such-vm", "::1")).resolves.toBeUndefined();
  });
});
```

**Запуск:** `npx vitest run tests/vm/manager.test.ts` — FAIL (методы не существуют)

### Task 3.2: Реализация addVmIpv6Route / removeVmIpv6Route

**Файл:** `src/vm/manager.ts`

```typescript
async addVmIpv6Route(domainName: string, ipv6: string): Promise<void> {
  try {
    // Find vnet interface for this domain
    const vnetMatch = this.execSyncFn(
      `sudo virsh domiflist ${domainName}`,
      { encoding: "utf-8" },
    ) as string;
    const vnet = vnetMatch.split("\n").find(l => l.includes("vnet"));
    if (!vnet) return;
    const iface = vnet.trim().split(/\s+/)[0];
    this.execSyncFn(`sudo ip -6 route add ${ipv6}/128 dev ${iface}`, { stdio: "ignore" });
  } catch { /* non-fatal */ }
}

async removeVmIpv6Route(domainName: string): Promise<void> {
  try {
    // Use domain XML to find the IPv6 (or just try to find the route)
    const vnetMatch = this.execSyncFn(
      `sudo virsh domiflist ${domainName}`,
      { encoding: "utf-8" },
    ) as string;
    const vnet = vnetMatch.split("\n").find(l => l.includes("vnet"));
    if (!vnet) return;
    const iface = vnet.trim().split(/\s+/)[0];
    // Get routes for this interface and delete the /128 one
    this.execSyncFn(`sudo ip -6 route del $(ip -6 route show dev ${iface} | grep "/128" | awk "{print \\$1}") 2>/dev/null || true`, { stdio: "ignore" });
  } catch { /* non-fatal */ }
}
```

**Запуск:** `npx vitest run tests/vm/manager.test.ts` — PASS

### Task 3.3: Вызов addVmIpv6Route в createAndStart

**Файл:** `src/vm/manager.ts`

После `this.execSyncFn('sudo virsh start ${domainName}')` добавить:
```typescript
// Add IPv6 route to VM
const ipv6 = generateIpv6ForUser(userId);
await this.addVmIpv6Route(domainName, ipv6);
```

### Task 3.4: Вызов removeVmIpv6Route при остановке

**Файл:** `src/vm/manager.ts` — метод `stop()`

После успешной остановки добавить:
```typescript
await this.removeVmIpv6Route(domainName);
```

### Task 3.5: Тест — createAndStart вызывает addVmIpv6Route

**Файл:** `tests/vm/manager.test.ts` — в существующем тесте success:

```typescript
expect(mockExec).toHaveBeenCalledWith(
  expect.stringContaining("sudo ip -6 route add"),
  expect.any(Object),
);
```

---

## Этап 4: Интеграция с ботом (без раскрытия IPv4 VPS)

### Task 4.1: Показ IPv6 в запросе доступа админу

**Файл:** `src/bot/middleware/auth.ts` — `buildAccessRequestText`

Добавить IPv6 к информации о VM (уже есть `pending.tier`):
```typescript
if (pending) {
  const { VM_TIERS } = await import("../../vm/types.js");
  const spec = VM_TIERS[pending.tier];
  lines.push(`\n📋 VM: ${spec.ramMb / 1024}GB / ${spec.vcpus} vCPU / ${spec.diskGb}GB (${pending.tier})`);
  // IPv6: generated but not exposing VPS address
  const ipv6 = pending.ipv6 ?? "determined after approval";
  lines.push(`🌐 IPv6: ${ipv6}`);
}
```

### Task 4.2: Сохранение IPv6 в pendingVmDeployments

**Файл:** `src/bot/handlers/onboarding-flow.ts`

В `handleOnboardingCallback` при выборе VM-тира:
```typescript
pendingVmDeployments.set(userId, {
  tier,
  chatId: ctx.chat!.id,
  username: ctx.from?.username,
  messageThreadId: ctx.message?.message_thread_id,
  ipv6: generateIpv6ForUser(userId),  // NEW
});
```

Импортировать `generateIpv6ForUser` из `vm/manager.js`.

### Task 4.3: Показ IPv6 пользователю после одобрения

**Файл:** `src/bot/middleware/auth.ts` — `handleAccessApprovalCallback`

В сообщении пользователю добавить IPv6:
```typescript
const vmMsg = result.success
  ? t("vm.onboarding.vm_ready", { ipv6: generateIpv6ForUser(userId) })
  : t("vm.onboarding.vm_failed", { error: result.error || "unknown error" });
```

**Важно:** не показываем IPv4 VPS (192.129.148.93). Пользователь видит только свой IPv6 и `baseUrl` (внутренний IPv4 VM через NAT/локальную сеть).

### Task 4.4: Обновление i18n

**Файлы:** `src/i18n/en.ts`, `ru.ts` (и другие локали)

Добавить плейсхолдер `{ipv6}` в `vm.onboarding.vm_ready`.

---

## Этап 5: Проверка end-to-end

### Task 5.1: Ручная проверка

1. Снести тестового пользователя
2. Пользователь проходит onboarding, выбирает VM
3. Админ видит IPv6 в запросе
4. Админ одобряет
5. Пользователь получает сообщение с IPv6
6. `ping6 <ipv6>` с VPS — доходит до VM
7. `curl -6 http://[<ipv6>]:4096/api/health` — возвращает 401

### Task 5.2: Проверка отсутствия утечки IPv4 VPS

- Сообщения пользователю не содержат `192.129.148.93`
- Сообщения админу не содержат `192.129.148.93`
- Логи не раскрывают IPv4 VPS пользователям

---

## Последовательность коммитов

1. `feat(ipv6): add generateIpv6ForUser with deterministic addressing`
2. `feat(ipv6): add ipv6 field to VmInfo, populate in createAndStart`
3. `feat(ipv6): add/remove IPv6 routes for VMs`
4. `feat(ipv6): show IPv6 in access request and approval, no VPS IPv4 leak`
5. `i18n(ipv6): add ipv6 placeholder to vm_ready message`
