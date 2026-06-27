const TELEGRAM_TOPIC_NAME_MAX_LENGTH = 128;

/**
 * Returns true if the topic should be renamed to the desired name.
 * Checks both that the desired name is non-empty and differs from current.
 */
export function topicNameNeedsRename(
  currentName: string | undefined,
  desiredName: string | undefined,
): boolean {
  if (!desiredName || desiredName.trim().length === 0) return false;
  if (currentName === undefined) return true;
  return currentName !== desiredName;
}

/**
 * Truncates a topic name to Telegram's 128-character limit.
 * Names >128 chars become first 125 chars + "...".
 */
export function truncateTopicName(name: string): string {
  if (name.length <= TELEGRAM_TOPIC_NAME_MAX_LENGTH) return name;
  return name.slice(0, TELEGRAM_TOPIC_NAME_MAX_LENGTH - 3) + "...";
}

/**
 * Thread-safe deduplication guard for forum topic renames.
 *
 * Fixes race condition: `tryAcquire()` sets the dedup marker **immediately**
 * (before any async task is launched), so concurrent SSE events see the
 * updated state and skip duplicate `editForumTopic` calls.
 *
 * Usage:
 * ```ts
 * const guard = createTopicRenameGuard();
 * if (guard.tryAcquire(sessionId, name)) {
 *   safeBackgroundTask(async () => {
 *     await botApi.editForumTopic(...);
 *   });
 * }
 * ```
 */
export interface TopicRenameGuard {
  /**
   * Atomically checks whether the given session+name combination should
   * trigger a rename. Returns `true` on first call (or when name changed),
   * `false` on subsequent calls with the same name.
   *
   * Sets the dedup marker **immediately** — the caller is responsible for
   * launching the async task after this returns true.
   */
  tryAcquire(sessionId: string, name: string): boolean;

  /** Returns the last name acquired for the session (undefined if never). */
  getLastAcquired(sessionId: string): string | undefined;

  /** Clears the guard for a specific session (e.g. on API failure). */
  clear(sessionId: string): void;

  /** Clears all tracked sessions (e.g. on bot shutdown). */
  clearAll(): void;
}

export function createTopicRenameGuard(): TopicRenameGuard {
  const lastSetName = new Map<string, string>();

  return {
    tryAcquire(sessionId: string, name: string): boolean {
      if (!name || name.trim().length === 0) return false;
      const last = lastSetName.get(sessionId);
      if (last === name) return false;
      lastSetName.set(sessionId, name);
      return true;
    },

    getLastAcquired(sessionId: string): string | undefined {
      return lastSetName.get(sessionId);
    },

    clear(sessionId: string): void {
      lastSetName.delete(sessionId);
    },

    clearAll(): void {
      lastSetName.clear();
    },
  };
}
