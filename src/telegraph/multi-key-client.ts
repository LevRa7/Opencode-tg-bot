import { logger } from "../utils/logger.js";
import { TelegraphKeyPool } from "./key-pool.js";
import { TelegraphClient, FloodWaitError, type CreatePageResult } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

export class MultiKeyClient implements TechnicalDetailsPublisher {
  constructor(
    private pool: TelegraphKeyPool,
    private bindingsRepo: {
      insert(params: { userId: number; path: string; keyId: number }): number;
      getByPath(path: string): { key_id: number; user_id: number } | undefined;
    },
    private config: { authorName: string; timeoutMs: number; maxChars: number },
    private userId = 0,
  ) {}

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    const safeTitle = request.title.length > 256 ? `${request.title.slice(0, 253)}...` : request.title;
    const result = await this.createPage(safeTitle, request.body);
    return result?.url ?? null;
  }

  async createPage(title: string, body: string): Promise<CreatePageResult | null> {
    const tryCount = this.pool.size || 1;

    for (let attempt = 0; attempt < tryCount; attempt++) {
      const entry = this.pool.selectKey();
      if (!entry) {
        logger.warn("[MultiKey] No available key in pool");
        return null;
      }

      try {
        const result = await entry.client.createPage(title, body);
        if (result) {
          this.bindingsRepo.insert({
            userId: this.userId,
            path: result.path,
            keyId: entry.keyId,
          });
          this.pool.markSuccess(entry.keyId);
          return result;
        }

        this.pool.markFailure(entry.keyId);
      } catch (error) {
        if (error instanceof FloodWaitError) {
          logger.warn(`[MultiKey] FloodWait on key ${entry.keyId}, trying next`);
          this.pool.markFloodWait(entry.keyId, error.waitMs);
          continue;
        }
        this.pool.markFailure(entry.keyId);
        logger.warn("[MultiKey] createPage error", { error });
      }
    }

    return null;
  }

  async editPage(path: string, title: string, body: string): Promise<boolean> {
    const binding = this.bindingsRepo.getByPath(path);
    if (!binding) {
      logger.warn(`[MultiKey] No binding for path ${path}, creating new page`);
      const result = await this.createPage(title, body);
      return result !== null;
    }

    const client = this.pool.getClient(binding.key_id);
    if (!client) {
      logger.warn(`[MultiKey] Key ${binding.key_id} not in pool for path ${path}, creating new page`);
      const result = await this.createPage(title, body);
      return result !== null;
    }

    try {
      const success = await client.editPage(path, title, body);
      if (success) {
        this.pool.markSuccess(binding.key_id);
      }
      return success;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        logger.warn(`[MultiKey] FloodWait on edit for key ${binding.key_id}, retrying once`);
        this.pool.markFloodWait(binding.key_id, error.waitMs);
        await new Promise(resolve => setTimeout(resolve, error.waitMs));
        try {
          const success = await client.editPage(path, title, body);
          if (success) this.pool.markSuccess(binding.key_id);
          return success;
        } catch (retryError) {
          logger.warn("[MultiKey] editPage retry failed", { error: retryError });
          return false;
        }
      }
      this.pool.markFailure(binding.key_id);
      logger.warn("[MultiKey] editPage error", { error });
      return false;
    }
  }

  async flush(): Promise<void> {}
  reset(): void {}
}
