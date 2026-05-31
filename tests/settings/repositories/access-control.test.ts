import Database from "better-sqlite3";
import { beforeEach, describe, expect, it } from "vitest";
import { createAccessControlRepository } from "../../../src/settings/repositories/access-control.js";

const DDL = `
CREATE TABLE IF NOT EXISTS approved_users (user_id INTEGER PRIMARY KEY);
CREATE TABLE IF NOT EXISTS access_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL,
    first_name TEXT, last_name TEXT, username TEXT, requested_at TEXT NOT NULL
);
`;

describe("AccessControlRepository", () => {
  let db: Database.Database;
  beforeEach(() => { db = new Database(":memory:"); db.exec(DDL); });

  describe("approved_users", () => {
    it("adds approved user", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123);
      expect(repo.getApprovedUserIds()).toEqual([123]);
    });
    it("removes approved user", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123); repo.addApprovedUser(456);
      repo.removeApprovedUser(123);
      expect(repo.getApprovedUserIds()).toEqual([456]);
    });
    it("isApproved returns correct values", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123);
      expect(repo.isApproved(123)).toBe(true);
      expect(repo.isApproved(999)).toBe(false);
    });
    it("sets all approved users at once", () => {
      const repo = createAccessControlRepository(db);
      repo.setApprovedUserIds([111, 222, 333]);
      expect(repo.getApprovedUserIds()).toEqual([111, 222, 333]);
    });
    it("adding duplicate does not error", () => {
      const repo = createAccessControlRepository(db);
      repo.addApprovedUser(123); repo.addApprovedUser(123);
      expect(repo.getApprovedUserIds()).toEqual([123]);
    });
  });

  describe("access_requests", () => {
    it("adds and retrieves access requests", () => {
      const repo = createAccessControlRepository(db);
      repo.addAccessRequest({ user_id: 123, first_name: "John", last_name: null, username: "johnny", requested_at: "2026-05-31T00:00:00Z" });
      const requests = repo.getAccessRequests();
      expect(requests).toHaveLength(1);
      expect(requests[0].user_id).toBe(123);
    });
    it("sets all access requests at once", () => {
      const repo = createAccessControlRepository(db);
      repo.setAccessRequests([
        { id: 1, user_id: 123, first_name: "A", last_name: null, username: null, requested_at: "2026-01-01T00:00:00Z" },
        { id: 2, user_id: 456, first_name: "B", last_name: null, username: null, requested_at: "2026-01-02T00:00:00Z" },
      ]);
      expect(repo.getAccessRequests()).toHaveLength(2);
    });
    it("deletes all access requests", () => {
      const repo = createAccessControlRepository(db);
      repo.addAccessRequest({ user_id: 123, first_name: "X", last_name: null, username: null, requested_at: "2026-01-01T00:00:00Z" });
      repo.deleteAllAccessRequests();
      expect(repo.getAccessRequests()).toHaveLength(0);
    });
  });
});
