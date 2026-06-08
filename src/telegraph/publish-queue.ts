import { logger } from "../utils/logger.js";
import { FloodWaitError } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest, TechnicalDetailsPublisher } from "./types.js";

export interface PublishQueueConfig {
  maxQueueSize: number;
  minIntervalMs: number;
  staleTtlMs: number;
  circuitBreakerThreshold: number;
  circuitBreakerCooldownMs: number;
}

interface QueueItem {
  request: TechnicalDetailsPublishRequest;
  enqueuedAt: number;
  resolve: (url: string | null) => void;
}

const DEFAULT_CONFIG: PublishQueueConfig = {
  maxQueueSize: 40,
  minIntervalMs: 5000,
  staleTtlMs: 60_000,
  circuitBreakerThreshold: 5,
  circuitBreakerCooldownMs: 300_000,
};

/**
 * Sequential queue for creating individual Telegraph pages.
 * Each publish() call creates a SEPARATE page with its own URL.
 * Enforces minimum interval between API calls to avoid FLOOD_WAIT.
 */
export class TelegraphPublishQueue implements TechnicalDetailsPublisher {
  private readonly queue: QueueItem[] = [];
  private readonly config: PublishQueueConfig;
  private readonly client: TechnicalDetailsPublisher;

  private processing = false;
  private lastRequestAt = 0;
  private consecutiveFailures = 0;
  private cooldownUntil = 0;
  private disposed = false;

  constructor(client: TechnicalDetailsPublisher, config?: Partial<PublishQueueConfig>) {
    this.client = client;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  async publish(request: TechnicalDetailsPublishRequest): Promise<string | null> {
    if (this.disposed) return null;

    if (this.isCircuitOpen()) {
      logger.debug("[PublishQueue] Circuit breaker open, skipping request");
      return null;
    }

    while (this.queue.length >= this.config.maxQueueSize) {
      const dropped = this.queue.shift();
      if (dropped) {
        dropped.resolve(null);
        logger.debug("[PublishQueue] Queue overflow, dropped oldest request");
      }
    }

    return new Promise<string | null>((resolve) => {
      this.queue.push({ request, enqueuedAt: Date.now(), resolve });
      this.scheduleProcessing();
    });
  }

  async flush(): Promise<void> {
    // Flush triggers immediate processing of all queued items
  }

  reset(): void {
    this.drainQueue();
  }

  dispose(): void {
    this.disposed = true;
    this.drainQueue();
  }

  get queueLength(): number {
    return this.queue.length;
  }

  get isOpen(): boolean {
    return this.isCircuitOpen();
  }

  private isCircuitOpen(): boolean {
    if (this.cooldownUntil === 0) return false;
    if (Date.now() >= this.cooldownUntil) {
      this.cooldownUntil = 0;
      this.consecutiveFailures = 0;
      logger.info("[PublishQueue] Circuit breaker closed, resuming");
      return false;
    }
    return true;
  }

  private scheduleProcessing(): void {
    if (this.processing || this.disposed) return;
    this.processing = true;
    void this.processLoop();
  }

  private async processLoop(): Promise<void> {
    while (this.queue.length > 0 && !this.disposed) {
      if (this.isCircuitOpen()) {
        this.drainQueue();
        break;
      }

      const elapsed = Date.now() - this.lastRequestAt;
      if (elapsed < this.config.minIntervalMs) {
        await sleep(this.config.minIntervalMs - elapsed);
      }

      // Remove stale items
      while (this.queue.length > 0) {
        const front = this.queue[0]!;
        if (Date.now() - front.enqueuedAt > this.config.staleTtlMs) {
          this.queue.shift();
          front.resolve(null);
          logger.debug("[PublishQueue] Dropped stale request");
        } else {
          break;
        }
      }

      if (this.queue.length === 0) break;

      const item = this.queue.shift()!;
      const url = await this.executePublish(item);
      item.resolve(url);
    }
    this.processing = false;
  }

  private async executePublish(item: QueueItem): Promise<string | null> {
    this.lastRequestAt = Date.now();

    try {
      const url = await this.client.publish(item.request);

      if (url !== null) {
        if (this.consecutiveFailures > 0) {
          logger.info(`[PublishQueue] Recovered after ${this.consecutiveFailures} failures`);
        }
        this.consecutiveFailures = 0;
        return url;
      }

      this.consecutiveFailures++;
      this.checkCircuitBreaker();
      return null;
    } catch (error) {
      if (error instanceof FloodWaitError) {
        this.consecutiveFailures++;
        const cooldown = Math.max(error.waitMs, this.config.circuitBreakerCooldownMs);
        this.cooldownUntil = Date.now() + cooldown;
        logger.warn(
          `[PublishQueue] FLOOD_WAIT (${error.waitMs}ms), pausing until ${new Date(this.cooldownUntil).toISOString()}`,
        );
        this.drainQueue();
        return null;
      }

      this.consecutiveFailures++;
      this.checkCircuitBreaker();
      logger.warn("[PublishQueue] Unexpected error during publish", { error });
      return null;
    }
  }

  private checkCircuitBreaker(): void {
    if (this.consecutiveFailures >= this.config.circuitBreakerThreshold) {
      this.cooldownUntil = Date.now() + this.config.circuitBreakerCooldownMs;
      logger.warn(
        `[PublishQueue] Circuit breaker opened after ${this.consecutiveFailures} failures. ` +
          `Cooldown until ${new Date(this.cooldownUntil).toISOString()}`,
      );
      this.drainQueue();
    }
  }

  private drainQueue(): void {
    while (this.queue.length > 0) {
      const item = this.queue.shift();
      item?.resolve(null);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
