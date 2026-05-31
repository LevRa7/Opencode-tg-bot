import type Database from "better-sqlite3";
import type { ApprovedUserRow, AccessRequestRow } from "./types.js";

export interface AccessControlRepository {
  getApprovedUserIds(): number[];
  addApprovedUser(userId: number): void;
  removeApprovedUser(userId: number): void;
  isApproved(userId: number): boolean;
  setApprovedUserIds(userIds: number[]): void;
  getAccessRequests(): AccessRequestRow[];
  addAccessRequest(request: Omit<AccessRequestRow, "id">): void;
  setAccessRequests(requests: AccessRequestRow[]): void;
  deleteAllAccessRequests(): void;
}

export function createAccessControlRepository(db: Database.Database): AccessControlRepository {
  const getAllApprovedStmt = db.prepare("SELECT user_id FROM approved_users");
  const addApprovedStmt = db.prepare("INSERT OR IGNORE INTO approved_users (user_id) VALUES (?)");
  const removeApprovedStmt = db.prepare("DELETE FROM approved_users WHERE user_id = ?");
  const isApprovedStmt = db.prepare("SELECT 1 FROM approved_users WHERE user_id = ?");
  const deleteAllApprovedStmt = db.prepare("DELETE FROM approved_users");
  const getAllRequestsStmt = db.prepare("SELECT * FROM access_requests");
  const deleteAllRequestsStmt = db.prepare("DELETE FROM access_requests");

  return {
    getApprovedUserIds(): number[] {
      return (getAllApprovedStmt.all() as Pick<ApprovedUserRow, "user_id">[]).map((r) => r.user_id);
    },
    addApprovedUser(userId: number): void {
      addApprovedStmt.run(userId);
    },
    removeApprovedUser(userId: number): void {
      removeApprovedStmt.run(userId);
    },
    isApproved(userId: number): boolean {
      return isApprovedStmt.get(userId) !== undefined;
    },
    setApprovedUserIds(userIds: number[]): void {
      const runInTx = db.transaction((ids: number[]) => {
        deleteAllApprovedStmt.run();
        for (const id of ids) addApprovedStmt.run(id);
      });
      runInTx(userIds);
    },
    getAccessRequests(): AccessRequestRow[] {
      return getAllRequestsStmt.all() as AccessRequestRow[];
    },
    addAccessRequest(request: Omit<AccessRequestRow, "id">): void {
      db.prepare(
        "INSERT INTO access_requests (user_id, first_name, last_name, username, requested_at) VALUES (?,?,?,?,?)",
      ).run(request.user_id, request.first_name, request.last_name, request.username, request.requested_at);
    },
    setAccessRequests(requests: AccessRequestRow[]): void {
      const runInTx = db.transaction((reqs: AccessRequestRow[]) => {
        deleteAllRequestsStmt.run();
        const insert = db.prepare(
          "INSERT INTO access_requests (id, user_id, first_name, last_name, username, requested_at) VALUES (?,?,?,?,?,?)",
        );
        for (const r of reqs) insert.run(r.id, r.user_id, r.first_name, r.last_name, r.username, r.requested_at);
      });
      runInTx(requests);
    },
    deleteAllAccessRequests(): void {
      deleteAllRequestsStmt.run();
    },
  };
}
