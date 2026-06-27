import { describe, it, expect, beforeEach } from "vitest";
import {
  createTopicRenameGuard,
  topicNameNeedsRename,
  truncateTopicName,
} from "../../../src/bot/utils/topic-rename-guard.js";

// ============================================================
// Unit tests for topic rename deduplication and no-op logic
// ============================================================

describe("topicNameNeedsRename", () => {
  it("returns true when current and desired names differ", () => {
    expect(topicNameNeedsRename("Old Name", "New Name")).toBe(true);
  });

  it("returns false when names are identical", () => {
    expect(topicNameNeedsRename("Same Name", "Same Name")).toBe(false);
  });

  it("returns true when current name is undefined (no current topic)", () => {
    expect(topicNameNeedsRename(undefined, "New Name")).toBe(true);
  });

  it("returns false when desired name is empty", () => {
    expect(topicNameNeedsRename("Old", "")).toBe(false);
  });

  it("returns false when desired name is only whitespace", () => {
    expect(topicNameNeedsRename("Old", "   ")).toBe(false);
  });

  it("handles undefined desired name", () => {
    expect(topicNameNeedsRename("Old", undefined)).toBe(false);
  });

  it("returns false when both are undefined", () => {
    expect(topicNameNeedsRename(undefined, undefined)).toBe(false);
  });

  it("is case-sensitive (Telegram topic names are case-sensitive)", () => {
    expect(topicNameNeedsRename("Name", "name")).toBe(true);
  });

  it("returns true when trailing whitespace differs", () => {
    expect(topicNameNeedsRename("Name", "Name ")).toBe(true);
  });
});

describe("createTopicRenameGuard", () => {
  let guard: ReturnType<typeof createTopicRenameGuard>;

  beforeEach(() => {
    guard = createTopicRenameGuard();
  });

  describe("tryAcquire", () => {
    it("returns true on first call with new name (should rename)", () => {
      expect(guard.tryAcquire("session-1", "My Session")).toBe(true);
    });

    it("returns false when same name already acquired (dedup)", () => {
      guard.tryAcquire("session-1", "My Session");
      expect(guard.tryAcquire("session-1", "My Session")).toBe(false);
    });

    it("returns true when name changes (legitimate rename)", () => {
      guard.tryAcquire("session-1", "Original Name");
      expect(guard.tryAcquire("session-1", "Updated Name")).toBe(true);
    });

    it("returns false after successful rename with new name (dedup second call with new name)", () => {
      guard.tryAcquire("session-1", "Original");
      guard.tryAcquire("session-1", "Updated");
      expect(guard.tryAcquire("session-1", "Updated")).toBe(false);
    });

    it("returns false for empty desired name (no-op)", () => {
      expect(guard.tryAcquire("session-1", "")).toBe(false);
    });

    it("returns false for whitespace-only desired name (no-op)", () => {
      expect(guard.tryAcquire("session-1", "   ")).toBe(false);
    });

    it("is independent across different session IDs", () => {
      expect(guard.tryAcquire("session-A", "Title A")).toBe(true);
      expect(guard.tryAcquire("session-B", "Title B")).toBe(true);
      // Both are independent — session-A still returns false for same name
      expect(guard.tryAcquire("session-A", "Title A")).toBe(false);
      expect(guard.tryAcquire("session-B", "Title A")); // different session, same name — ok
    });

    it("memory effect survives across many sessions", () => {
      for (let i = 0; i < 100; i++) {
        expect(guard.tryAcquire(`sess-${i}`, `Title ${i}`)).toBe(true);
      }
      // First session should be blocked
      expect(guard.tryAcquire("sess-0", "Title 0")).toBe(false);
      // 50th session should be blocked for its own name
      expect(guard.tryAcquire("sess-50", "Title 50")).toBe(false);
    });
  });

  describe("tryAcquire — race-condition protection", () => {
    it("records name BEFORE caller launches async task (immediate set)", () => {
      // Simulates two concurrent SSE events arriving before the async
      // editForumTopic task executes.
      // tryAcquire #1: sets guard immediately
      expect(guard.tryAcquire("session-1", "Session Title")).toBe(true);
      // tryAcquire #2: guard already set, returns false
      expect(guard.tryAcquire("session-1", "Session Title")).toBe(false);
    });
  });

  describe("clear", () => {
    it("removes the guard for a session so next calls start fresh", () => {
      guard.tryAcquire("session-1", "Title");
      guard.clear("session-1");
      expect(guard.tryAcquire("session-1", "Title")).toBe(true);
    });

    it("is a no-op for unknown session", () => {
      expect(() => guard.clear("unknown-session")).not.toThrow();
    });

    it("does not affect other sessions", () => {
      guard.tryAcquire("session-A", "A");
      guard.tryAcquire("session-B", "B");
      guard.clear("session-A");
      expect(guard.tryAcquire("session-A", "A")).toBe(true);
      expect(guard.tryAcquire("session-B", "B")).toBe(false); // still blocked
    });
  });

  describe("getLastAcquired", () => {
    it("returns undefined for unknown session", () => {
      expect(guard.getLastAcquired("unknown")).toBeUndefined();
    });

    it("returns the last acquired name", () => {
      guard.tryAcquire("session-1", "First");
      expect(guard.getLastAcquired("session-1")).toBe("First");
      guard.tryAcquire("session-1", "Second");
      expect(guard.getLastAcquired("session-1")).toBe("Second");
    });
  });

  describe("clearAll", () => {
    it("clears all tracked sessions", () => {
      guard.tryAcquire("sess-A", "A");
      guard.tryAcquire("sess-B", "B");
      guard.clearAll();
      expect(guard.tryAcquire("sess-A", "A")).toBe(true);
      expect(guard.tryAcquire("sess-B", "B")).toBe(true);
    });
  });
});

describe("truncateTopicName", () => {
  it("returns short names as-is", () => {
    expect(truncateTopicName("Short")).toBe("Short");
  });

  it("truncates names longer than 128 characters", () => {
    const longName = "A".repeat(200);
    expect(truncateTopicName(longName)).toBe("A".repeat(125) + "...");
  });

  it("keeps exact 128-length names", () => {
    const exact = "A".repeat(128);
    expect(truncateTopicName(exact)).toBe(exact);
  });

  it("keeps exact 127-length names", () => {
    const exact = "A".repeat(127);
    expect(truncateTopicName(exact)).toBe(exact);
  });

  it("handles empty string", () => {
    expect(truncateTopicName("")).toBe("");
  });

  it("truncates 129-length name", () => {
    const name = "A".repeat(129);
    expect(truncateTopicName(name)).toBe("A".repeat(125) + "...");
  });
});
