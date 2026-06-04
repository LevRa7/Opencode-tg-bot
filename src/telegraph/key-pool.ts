import { logger } from "../utils/logger.js";
import type { TelegraphClient } from "./telegraph-client.js";
import type { TechnicalDetailsPublishRequest } from "./types.js";

export interface TelegraphKeyEntry {
  client: TelegraphClient;
  keyId: number;
  lastUsedAt: number;
  floodWaitUntil: number;
  consecutiveFailures: number;
}

export class TelegraphKeyPool {
  private keys: TelegraphKeyEntry[] = [];
  private currentIndex = 0;
  private consecutiveFailures = 0;

  constructor(private readonly cooldownMs: number = 5000) {}

  addKey(client: TelegraphClient, keyId: number): void {
    this.keys.push({
      client,
      keyId,
      lastUsedAt: 0,
      floodWaitUntil: 0,
      consecutiveFailures: 0,
    });
  }

  selectKey(): TelegraphKeyEntry | null {
    const now = Date.now();
    const startIndex = this.currentIndex;

    for (let i = 0; i < this.keys.length; i++) {
      const idx = (startIndex + i) % this.keys.length;
      const key = this.keys[idx];
      if (key.floodWaitUntil > now) continue;
      if (now - key.lastUsedAt < this.cooldownMs) continue;
      if (key.consecutiveFailures >= 3 && now - key.lastUsedAt < 60000) continue;

      this.currentIndex = (idx + 1) % this.keys.length;
      key.lastUsedAt = now;
      return key;
    }

    return null;
  }

  markSuccess(keyId: number): void {
    const key = this.keys.find(k => k.keyId === keyId);
    if (key) key.consecutiveFailures = 0;
    this.consecutiveFailures = 0;
  }

  markFailure(keyId: number): void {
    const key = this.keys.find(k => k.keyId === keyId);
    if (key) key.consecutiveFailures++;
    this.consecutiveFailures++;
  }

  markFloodWait(keyId: number, waitMs: number): void {
    const key = this.keys.find(k => k.keyId === keyId);
    if (key) {
      key.floodWaitUntil = Date.now() + waitMs;
      key.consecutiveFailures++;
    }
    this.consecutiveFailures++;
  }

  isCircuitOpen(): boolean {
    return this.consecutiveFailures >= 15;
  }

  get size(): number { return this.keys.length; }

  reset(): void {
    this.keys = [];
    this.currentIndex = 0;
    this.consecutiveFailures = 0;
  }
}
