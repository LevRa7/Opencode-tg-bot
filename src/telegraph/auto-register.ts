import { logger } from "../utils/logger.js";
import { encryptToken } from "./token-encryption.js";
import type { TelegraphConfig } from "./types.js";

// Minimal structural type for the Telegraph keys repository: only the methods
// ensureUserKeys actually uses. Avoids importing the concrete repo factory here
// and keeps this module decoupled from the settings layer.
interface TelegraphKeysRepo {
  countByUser(userId: number): number;
  insert(params: { user_id: number; token_encrypted: string; author_name?: string; created_at: number }): number;
}

// Shape of the telegra.ph createAccount JSON response we rely on.
interface TelegraphResponse {
  ok: boolean;
  result?: { access_token?: string };
}

const CREATE_ACCOUNT_URL = "https://api.telegra.ph/createAccount";
const COOLDOWN_MS = 30 * 60 * 1000;

let lastFailureTime = 0;

export async function ensureUserKeys(
  keysRepo: TelegraphKeysRepo,
  userId: number,
  config: TelegraphConfig,
  encryptionKey: Buffer,
  maxKeysPerUser: number,
): Promise<void> {
  const existingCount = keysRepo.countByUser(userId);
  const needed = maxKeysPerUser - existingCount;
  if (needed <= 0) return;

  if (lastFailureTime > 0 && Date.now() - lastFailureTime < COOLDOWN_MS) {
    const remaining = Math.round((COOLDOWN_MS - (Date.now() - lastFailureTime)) / 60000);
    logger.debug(`[AutoRegister] Cooling down, ${remaining}min until next attempt`);
    return;
  }

  const pid = process.pid;
  logger.info(`[AutoRegister] Creating ${needed} Telegraph accounts for user ${userId} (pid=${pid})`);

  let created = 0;

  for (let i = 0; i < needed; i++) {
    const index = existingCount + i + 1;
    const shortName = `opencode_tg_${userId}_${index}`;

    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), config.timeoutMs);

      const params = new URLSearchParams();
      params.set("short_name", shortName);
      params.set("author_name", config.authorName);

      const response = await fetch(CREATE_ACCOUNT_URL, {
        method: "POST",
        body: params,
        signal: controller.signal,
      });

      clearTimeout(timer);

      if (!response.ok) {
        logger.warn(`[AutoRegister] createAccount failed for ${shortName}: HTTP ${response.status}`);
        continue;
      }

      const data = (await response.json()) as TelegraphResponse;

      if (!data.ok || !data.result?.access_token) {
        logger.warn(`[AutoRegister] createAccount API error for ${shortName}`);
        continue;
      }

      const encrypted = encryptToken(data.result.access_token, encryptionKey);

      keysRepo.insert({
        user_id: userId,
        token_encrypted: encrypted,
        author_name: config.authorName,
        created_at: Date.now(),
      });

      logger.info(`[AutoRegister] Created Telegraph account ${shortName}`);
      created++;
    } catch (error) {
      logger.warn(`[AutoRegister] Failed to create account ${shortName}`, {
        error,
      });
    }
  }

  if (created === 0) {
    lastFailureTime = Date.now();
    logger.warn("[AutoRegister] All attempts failed, cooling down for %d minutes", Math.round(COOLDOWN_MS / 60000));
  }
}
