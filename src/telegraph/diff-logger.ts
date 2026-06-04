import { logger } from "../utils/logger.js";
import type { TelegraphClient } from "./telegraph-client.js";
import type { TelegraphKeyPool } from "./key-pool.js";

interface DiffLogEntry {
  filePath: string;
  telegraphUrl: string | null;
  telegraphPath: string | null;
  sessionFiles: Map<string, string | null>;
}

export class FileDiffLogger {
  private entries = new Map<string, DiffLogEntry>();
  private mutexes = new Map<string, Promise<void>>();
  private readonly maxMutexEntries = 500;

  constructor(private readonly keyPool: TelegraphKeyPool) {}

  async logDiff(
    userId: number,
    sessionId: string,
    filePath: string,
    diffContent: string,
    otherEditedFiles: Array<{ path: string; url: string }> = [],
  ): Promise<string | null> {
    return this.withMutex(filePath, async () => {
      const truncated = diffContent.length > 102400
        ? diffContent.slice(0, 102380) + "\n[truncated]"
        : diffContent;

      const entry = this.entries.get(filePath);

      if (entry?.telegraphPath) {
        const key = this.keyPool.selectKey();
        if (!key) return entry.telegraphUrl;

        const prepended = truncated + "\n\n---\n\n" + "existing";
        // In real impl: fetch page content, prepend, editPage
        return entry.telegraphUrl;
      }

      return await this.createPage(userId, sessionId, filePath, truncated, otherEditedFiles);
    });
  }

  private async withMutex<T>(key: string, fn: () => Promise<T>): Promise<T> {
    // LRU eviction for mutex map
    if (this.mutexes.size >= this.maxMutexEntries) {
      const firstKey = this.mutexes.keys().next().value;
      if (firstKey) this.mutexes.delete(firstKey);
    }

    const prev = this.mutexes.get(key) ?? Promise.resolve();
    let release: () => void;
    const next = new Promise<void>((resolve) => { release = resolve; });
    this.mutexes.set(key, prev.then(() => undefined));

    try {
      await prev;
      return await fn();
    } finally {
      release!();
    }
  }

  private async createPage(
    userId: number,
    sessionId: string,
    filePath: string,
    content: string,
    otherFiles: Array<{ path: string; url: string }>,
  ): Promise<string | null> {
    const key = this.keyPool.selectKey();
    if (!key) return null;

    const title = `📝 Session: ${sessionId} | Files: ${filePath}`;
    try {
      const result = await key.client.createPage(title, content);
      if (result) {
        this.entries.set(filePath, {
          filePath,
          telegraphUrl: result.url,
          telegraphPath: result.path,
          sessionFiles: new Map(otherFiles.map(f => [f.path, f.url])),
        });
        return result.url;
      }
      this.keyPool.markFailure(key.keyId);
    } catch {
      this.keyPool.markFailure(key.keyId);
    }
    return null;
  }

  getTelegraphUrl(filePath: string): string | null {
    return this.entries.get(filePath)?.telegraphUrl ?? null;
  }

  reset(): void {
    this.entries.clear();
    this.mutexes.clear();
  }
}
