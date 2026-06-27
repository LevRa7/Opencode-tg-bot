import { describe, expect, it, beforeEach, afterEach, vi } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";

const ACTIVE_SESSIONS_FILE = "/tmp/tg-active-sessions.json";

async function loadTracker(): Promise<
  typeof import("../../src/active-session/tracker.js")
> {
  return import("../../src/active-session/tracker.js");
}

describe("Active Session Tracker", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "test-worktree-"));
    vi.useRealTimers();
  });

  afterEach(() => {
    try {
      if (fs.existsSync(ACTIVE_SESSIONS_FILE)) {
        fs.unlinkSync(ACTIVE_SESSIONS_FILE);
      }
    } catch { /* ignore */ }
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch { /* ignore */ }
  });

  describe("getActiveSessionForDirectory", () => {
    it("returns null when no entry exists for directory", async () => {
      const { getActiveSessionForDirectory } = await loadTracker();
      const result = getActiveSessionForDirectory("/nonexistent/dir");
      expect(result).toBeNull();
    });
  });

  describe("recordActiveSession", () => {
    it("records and retrieves an active session entry", async () => {
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree = path.join(tmpDir, "project-a");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-abc", -1001234567890, 100);

      const entry = getActiveSessionForDirectory(worktree);
      expect(entry).not.toBeNull();
      expect(entry!.sessionId).toBe("session-abc");
      expect(entry!.chatId).toBe(-1001234567890);
      expect(entry!.messageThreadId).toBe(100);
      expect(typeof entry!.timestamp).toBe("number");
    });

    it("returns entry for exact directory path match", async () => {
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree = path.join(tmpDir, "project-b");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-def", -2009876543210, 200);

      const entry = getActiveSessionForDirectory(worktree);
      expect(entry!.sessionId).toBe("session-def");
      expect(entry!.chatId).toBe(-2009876543210);
      expect(entry!.messageThreadId).toBe(200);
    });

    it("returns null for a different directory", async () => {
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree1 = path.join(tmpDir, "project-1");
      const worktree2 = path.join(tmpDir, "project-2");
      fs.mkdirSync(worktree1, { recursive: true });
      fs.mkdirSync(worktree2, { recursive: true });

      recordActiveSession(worktree1, "session-1", -1001, 1);

      const entry = getActiveSessionForDirectory(worktree2);
      expect(entry).toBeNull();
    });

    it("returns null when entry is stale (> 5 min)", async () => {
      vi.useFakeTimers();
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree = path.join(tmpDir, "project-stale");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-stale", -1001, 1);

      // Verify fresh entry is returned
      let entry = getActiveSessionForDirectory(worktree);
      expect(entry).not.toBeNull();

      // Advance past TTL
      vi.advanceTimersByTime(6 * 60 * 1000); // 6 min

      entry = getActiveSessionForDirectory(worktree);
      expect(entry).toBeNull();
    });

    it("overwrites previous entry for the same directory", async () => {
      vi.useFakeTimers();
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree = path.join(tmpDir, "project-overwrite");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-1", -1001, 10);
      vi.advanceTimersByTime(10);
      recordActiveSession(worktree, "session-2", -2002, 20);

      const entry = getActiveSessionForDirectory(worktree);
      expect(entry!.sessionId).toBe("session-2");
      expect(entry!.chatId).toBe(-2002);
      expect(entry!.messageThreadId).toBe(20);
    });

    it("supports multiple directories independently", async () => {
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const dirA = path.join(tmpDir, "project-a");
      const dirB = path.join(tmpDir, "project-b");
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      recordActiveSession(dirA, "session-a", -1000, 100);
      recordActiveSession(dirB, "session-b", -2000, 200);

      const entryA = getActiveSessionForDirectory(dirA);
      const entryB = getActiveSessionForDirectory(dirB);

      expect(entryA!.sessionId).toBe("session-a");
      expect(entryA!.messageThreadId).toBe(100);
      expect(entryB!.sessionId).toBe("session-b");
      expect(entryB!.messageThreadId).toBe(200);
    });

    it("handles null messageThreadId", async () => {
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree = path.join(tmpDir, "project-nonforum");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-no-thread", -100500, null);

      const entry = getActiveSessionForDirectory(worktree);
      expect(entry).not.toBeNull();
      expect(entry!.sessionId).toBe("session-no-thread");
      expect(entry!.messageThreadId).toBeNull();
    });

    it(    "normalizes directory path to absolute", async () => {
      const { recordActiveSession, getActiveSessionForDirectory } = await loadTracker();

      const worktree = path.join(tmpDir, "project-norm");
      fs.mkdirSync(worktree, { recursive: true });

      // Record with a trailing slash path that resolve normalizes
      recordActiveSession(worktree + "/", "session-norm", -100600, 600);

      // Query with the same resolved path
      const resolved = path.resolve(worktree + "/");
      const entry = getActiveSessionForDirectory(resolved);
      expect(entry).not.toBeNull();
      expect(entry!.sessionId).toBe("session-norm");
    });
  });

  describe("findActiveSessionById", () => {
    it("returns null when store is empty", async () => {
      const { findActiveSessionById } = await loadTracker();
      expect(findActiveSessionById("any-session")).toBeNull();
    });

    it("returns entry when sessionId matches", async () => {
      const { recordActiveSession, findActiveSessionById } = await loadTracker();

      const worktree = path.join(tmpDir, "project-find");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-find", -100123, 42);

      const entry = findActiveSessionById("session-find");
      expect(entry).not.toBeNull();
      expect(entry!.sessionId).toBe("session-find");
      expect(entry!.chatId).toBe(-100123);
      expect(entry!.messageThreadId).toBe(42);
    });

    it("returns null when sessionId does not exist", async () => {
      const { recordActiveSession, findActiveSessionById } = await loadTracker();

      const worktree = path.join(tmpDir, "project-miss");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-exists", -1001, 1);

      expect(findActiveSessionById("session-other")).toBeNull();
    });

    it("finds session across any directory", async () => {
      const { recordActiveSession, findActiveSessionById } = await loadTracker();

      const dirA = path.join(tmpDir, "project-a");
      const dirB = path.join(tmpDir, "project-b");
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      recordActiveSession(dirA, "session-a", -1000, 10);
      recordActiveSession(dirB, "session-b", -2000, 20);

      const entry = findActiveSessionById("session-a");
      expect(entry).not.toBeNull();
      expect(entry!.chatId).toBe(-1000);
    });

    it("returns null for stale entries (> 5 min)", async () => {
      vi.useFakeTimers();
      const { recordActiveSession, findActiveSessionById } = await loadTracker();

      const worktree = path.join(tmpDir, "project-stale-find");
      fs.mkdirSync(worktree, { recursive: true });

      recordActiveSession(worktree, "session-stale", -1001, 1);

      // Fresh entry is found
      expect(findActiveSessionById("session-stale")).not.toBeNull();

      // Advance past TTL
      vi.advanceTimersByTime(6 * 60 * 1000);

      expect(findActiveSessionById("session-stale")).toBeNull();
    });

    it("prefers fresh entry over stale one for same sessionId", async () => {
      vi.useFakeTimers();
      const { recordActiveSession, findActiveSessionById } = await loadTracker();

      const dirA = path.join(tmpDir, "project-old");
      const dirB = path.join(tmpDir, "project-fresh");
      fs.mkdirSync(dirA, { recursive: true });
      fs.mkdirSync(dirB, { recursive: true });

      // Record old entry
      recordActiveSession(dirA, "session-shared", -1001, 10);

      // Advance past TTL for old entry
      vi.advanceTimersByTime(6 * 60 * 1000);

      // Record fresh entry with same sessionId
      recordActiveSession(dirB, "session-shared", -2002, 20);

      const entry = findActiveSessionById("session-shared");
      expect(entry).not.toBeNull();
      expect(entry!.chatId).toBe(-2002);
      expect(entry!.messageThreadId).toBe(20);
    });
  });
});
