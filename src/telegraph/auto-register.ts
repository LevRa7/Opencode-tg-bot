import { logger } from "../utils/logger.js";
import { encryptToken } from "./token-encryption.js";

const CREATE_ACCOUNT_URL = "https://api.telegra.ph/createAccount";

export async function ensureUserKeys(
  keysRepo: {
    countByUser(userId: number): number;
    insert(params: {
      user_id: number;
      token_encrypted: string;
      author_name?: string;
      created_at: number;
    }): number;
    getAllByUser(
      userId: number,
    ): Array<{ id: number; token_encrypted: string; is_active: number }>;
  },
  userId: number,
  config: { authorName: string; timeoutMs: number },
  encryptionKey: Buffer,
  maxKeysPerUser: number,
): Promise<void> {
  const existingCount = keysRepo.countByUser(userId);
  const needed = maxKeysPerUser - existingCount;
  if (needed <= 0) return;

  logger.info(
    `[AutoRegister] Creating ${needed} Telegraph accounts for user ${userId}`,
  );

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
        logger.warn(
          `[AutoRegister] createAccount failed for ${shortName}: HTTP ${response.status}`,
        );
        continue;
      }

      const data = (await response.json()) as {
        ok: boolean;
        result?: { access_token: string };
      };
      if (!data.ok || !data.result?.access_token) {
        logger.warn(
          `[AutoRegister] createAccount API error for ${shortName}`,
        );
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
    } catch (error) {
      logger.warn(`[AutoRegister] Failed to create account ${shortName}`, {
        error,
      });
    }
  }
}
