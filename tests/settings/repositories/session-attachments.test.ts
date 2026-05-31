import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createSessionAttachmentsRepository } from "../../../src/settings/repositories/session-attachments.js";

const DDL = `
CREATE TABLE IF NOT EXISTS attached_sessions (scope_key TEXT PRIMARY KEY, session TEXT);
CREATE TABLE IF NOT EXISTS session_directory_cache (scope_key TEXT PRIMARY KEY, data TEXT NOT NULL);
`;

describe("SessionAttachmentsRepository", () => {
  let db: Database.Database;
  beforeEach(() => {
    db = new Database(":memory:");
    db.exec(DDL);
  });

  describe("attached_sessions", () => {
    it("returns empty object when empty", () => {
      const repo = createSessionAttachmentsRepository(db);
      expect(repo.getAttachedSessions()).toEqual({});
    });

    it("sets and retrieves all", () => {
      const repo = createSessionAttachmentsRepository(db);
      const sessions = {
        "1:2:3": {
          scope_key: "1:2:3",
          session: JSON.stringify({ id: "s1", title: "T", directory: "/tmp" }),
        },
        "4:5:6": {
          scope_key: "4:5:6",
          session: JSON.stringify({ id: "s2", title: "U", directory: "/tmp" }),
        },
      };
      repo.setAttachedSessions(sessions);
      const result = repo.getAttachedSessions();
      expect(Object.keys(result)).toHaveLength(2);
      expect(JSON.parse(result["1:2:3"].session!)).toEqual({
        id: "s1",
        title: "T",
        directory: "/tmp",
      });
    });

    it("replaces existing on set", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setAttachedSessions({ "1:2:3": { scope_key: "1:2:3", session: "x" } });
      repo.setAttachedSessions({ "4:5:6": { scope_key: "4:5:6", session: "y" } });
      expect(Object.keys(repo.getAttachedSessions())).toEqual(["4:5:6"]);
    });
  });

  describe("session_directory_cache", () => {
    it("returns undefined for non-existent", () => {
      const repo = createSessionAttachmentsRepository(db);
      expect(repo.getSessionDirectoryCache("1:2:3")).toBeUndefined();
    });

    it("sets and retrieves JSON data", () => {
      const repo = createSessionAttachmentsRepository(db);
      const data = JSON.stringify({ version: 1, directories: [{ worktree: "/tmp", lastUpdated: 1000 }] });
      repo.setSessionDirectoryCache("1:2:3", data);
      expect(repo.getSessionDirectoryCache("1:2:3")).toBe(data);
    });

    it("updates existing", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setSessionDirectoryCache("1:2:3", "old");
      repo.setSessionDirectoryCache("1:2:3", "new");
      expect(repo.getSessionDirectoryCache("1:2:3")).toBe("new");
    });

    it("clears", () => {
      const repo = createSessionAttachmentsRepository(db);
      repo.setSessionDirectoryCache("1:2:3", "data");
      repo.clearSessionDirectoryCache("1:2:3");
      expect(repo.getSessionDirectoryCache("1:2:3")).toBeUndefined();
    });
  });
});
