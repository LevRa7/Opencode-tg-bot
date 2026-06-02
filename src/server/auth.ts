import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "../config.js";
import { getApprovedTelegramUserIds } from "../settings/manager.js";

const INIT_DATA_EXPIRY_SEC = 86400; // 24 hours

export interface ParsedInitData {
  query_id?: string;
  user: {
    id: number;
    first_name: string;
    last_name?: string;
    username?: string;
    language_code?: string;
  };
  auth_date: number;
  hash: string;
}

export function parseInitData(initData: string): ParsedInitData | null {
  try {
    const params = new URLSearchParams(initData);
    const userRaw = params.get("user");
    if (!userRaw) return null;
    const user = JSON.parse(userRaw);
    if (!user || typeof user.id !== "number") return null;

    const authDate = Number(params.get("auth_date"));
    if (!authDate || !Number.isFinite(authDate)) return null;

    const hash = params.get("hash");
    if (!hash) return null;

    return {
      query_id: params.get("query_id") ?? undefined,
      user,
      auth_date: authDate,
      hash,
    };
  } catch {
    return null;
  }
}

function verifyHmac(dataCheckString: string, hash: string): boolean {
  const secretKey = createHmac("sha256", "WebAppData")
    .update(config.telegram.token)
    .digest();
  const computedHash = createHmac("sha256", secretKey)
    .update(dataCheckString)
    .digest("hex");
  try {
    return timingSafeEqual(Buffer.from(computedHash), Buffer.from(hash));
  } catch {
    return false;
  }
}

export function validateInitData(initData: string): ParsedInitData | null {
  const parsed = parseInitData(initData);
  if (!parsed) return null;

  const nowSec = Math.floor(Date.now() / 1000);
  if (nowSec - parsed.auth_date > INIT_DATA_EXPIRY_SEC) return null;

  const params = new URLSearchParams(initData);
  const entries: [string, string][] = [];
  for (const [k, v] of params.entries()) {
    if (k !== "hash") entries.push([k, v]);
  }
  entries.sort(([a], [b]) => a.localeCompare(b));
  const dataCheckString = entries.map(([k, v]) => `${k}=${v}`).join("\n");

  if (!verifyHmac(dataCheckString, parsed.hash)) return null;

  return parsed;
}

export function isUserAuthorized(userId: number): boolean {
  if (userId === config.telegram.adminUserId) return true;
  const approved = new Set<number>([
    ...config.telegram.allowedUserIds,
    ...getApprovedTelegramUserIds(),
    config.telegram.adminUserId,
  ]);
  return approved.has(userId);
}
