/**
 * VM Alarm Module — sends admin notifications instead of destroying VMs.
 *
 * ALL VM destruction paths MUST route through this module:
 *   - createAndStart cleanup (manager.ts:214-217)
 *   - destroy() / destroyHandle() (manager.ts:436-459, 659-661)
 *   - acquire() unhealthy/timeout rollback (lifecycle-manager.ts:75,108,183)
 *   - release() (lifecycle-manager.ts:199)
 *   - recover() unhealthy/destroy (lifecycle-manager.ts:252,262)
 *
 * Severity levels:
 *   CRITICAL — VM was about to be destroyed, admin MUST intervene
 *   WARN     — VM unhealthy, recovery attempted but not destructive
 *   DEGRADED — VM reached failure threshold, auto-recovery disabled
 *   INFO     — VM recreated successfully, admin notified for audit
 */

import { logger } from "../utils/logger.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AlarmSeverity = "CRITICAL" | "WARN" | "DEGRADED" | "INFO";

export interface VmAlarm {
  /** Alarm severity */
  severity: AlarmSeverity;
  /** User ID whose VM is affected */
  userId: number;
  /** VM domain name (opencode-tg-{userId}) */
  domainName?: string;
  /** What happened — human-readable, single line */
  reason: string;
  /** What the bot would have done WITHOUT the alarm guard */
  blockedAction: string;
  /** Call site — function name */
  caller: string;
  /** File:line reference */
  source: string;
  /** ISO timestamp */
  timestamp: string;
}

// ---------------------------------------------------------------------------
// Alarm sender — direct HTTP to Telegram Bot API (no grammY context needed)
// ---------------------------------------------------------------------------

let _botToken: string | null = null;
let _adminUserId: number | null = null;
let _alarmEnabled = true;

/** Overridable fetch function — exposed for testing. */
export let _fetchFn: typeof fetch = fetch;

export function setFetchForTesting(fn: typeof fetch): void {
  _fetchFn = fn;
}

export function configureAlarm(options: {
  botToken: string;
  adminUserId: number;
  enabled?: boolean;
}): void {
  _botToken = options.botToken;
  _adminUserId = options.adminUserId;
  _alarmEnabled = options.enabled ?? true;
  logger.info("[VmAlarm] Configured: admin=%d, enabled=%s", _adminUserId, _alarmEnabled);
}

function isConfigured(): boolean {
  return _alarmEnabled && !!_botToken && _adminUserId !== null && _adminUserId > 0;
}

async function sendTelegramMessage(text: string): Promise<boolean> {
  if (!isConfigured()) {
    logger.warn("[VmAlarm] Not configured — alarm NOT sent");
    return false;
  }

  try {
    const url = `https://api.telegram.org/bot${_botToken}/sendMessage`;
    const body = JSON.stringify({
      chat_id: _adminUserId!,
      text,
      parse_mode: "HTML",
      disable_web_page_preview: true,
    });

    const res = await _fetchFn(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) {
      const err = await res.text().catch(() => "");
      logger.error("[VmAlarm] Telegram API error: %d %s", res.status, err.slice(0, 200));
      return false;
    }

    logger.info("[VmAlarm] Alarm sent to admin userId=%d", _adminUserId);
    return true;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error("[VmAlarm] Failed to send alarm: %s", msg);
    return false;
  }
}

// ---------------------------------------------------------------------------
// Alarm formatting
// ---------------------------------------------------------------------------

const SEVERITY_EMOJI: Record<AlarmSeverity, string> = {
  CRITICAL: "🔴",
  WARN: "🟡",
  DEGRADED: "⚫",
  INFO: "🟢",
};

function formatAlarm(alarm: VmAlarm): string {
  const emoji = SEVERITY_EMOJI[alarm.severity];
  const lines = [
    `${emoji} <b>VM ALARM — ${alarm.severity}</b>`,
    "",
    `<b>User ID:</b> <code>${alarm.userId}</code>`,
  ];
  if (alarm.domainName) {
    lines.push(`<b>Domain:</b> <code>${alarm.domainName}</code>`);
  }
  lines.push(
    `\n<b>Что случилось:</b> ${alarm.reason}`,
    `\n<b>Заблокированное действие:</b> ${alarm.blockedAction}`,
    `\n<b>Вызвано из:</b> <code>${alarm.caller}</code> (${alarm.source})`,
    `\n<b>Время:</b> ${alarm.timestamp}`,
  );

  if (alarm.severity === "CRITICAL") {
    lines.push("\n⚠️ <b>ТРЕБУЕТСЯ ВМЕШАТЕЛЬСТВО АДМИНА</b>");
  }

  return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Fire a VM alarm to the admin. Non-blocking — fires and forgets.
 *
 * @returns true if alarm was sent successfully, false if not configured or failed
 */
export async function fireVmAlarm(alarm: VmAlarm): Promise<boolean> {
  // Always log locally first — even if Telegram send fails
  const text = formatAlarm(alarm);
  const logFn =
    alarm.severity === "CRITICAL"
      ? logger.error
      : alarm.severity === "DEGRADED"
        ? logger.error
        : logger.warn;

  logFn("[VmAlarm] %s | userId=%d | %s | caller=%s",
    alarm.severity, alarm.userId, alarm.reason, alarm.caller);

  return sendTelegramMessage(text);
}

/**
 * Fire-and-forget wrapper — does not await the result.
 * Use when the alarm must not block the caller (e.g. inside acquire/recover).
 */
export function fireVmAlarmBg(alarm: VmAlarm): void {
  fireVmAlarm(alarm).catch((err) => {
    logger.error("[VmAlarm] Background alarm failed: %s", err instanceof Error ? err.message : String(err));
  });
}
