import type Database from "better-sqlite3";
import { logger } from "../utils/logger.js";

const POOL_DDL = `
CREATE TABLE IF NOT EXISTS ip_allocations (
  ipv4          TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL,
  vm_id         TEXT NOT NULL,
  assigned_at   TEXT NOT NULL,
  UNIQUE(user_id)
);
`;

export interface IpAllocationRecord {
  ipv4: string;
  userId: number;
  vmId: string;
  assignedAt: string;
}

export interface NetworkPoolAllocator {
  allocate(userId: number, vmId: string): string;
  release(userId: number): boolean;
  releaseByVmId(vmId: string): boolean;
  getAllocations(): IpAllocationRecord[];
  getByUserId(userId: number): IpAllocationRecord | undefined;
  getPoolSize(): number;
}

export function createNetworkPoolAllocator(
  db: Database.Database,
  baseIp = "10.100.0",
  startOctet = 10,
  endOctet = 250,
): NetworkPoolAllocator {
  db.exec(POOL_DDL);

  const allocateStmt = db.prepare(
    "INSERT OR IGNORE INTO ip_allocations (ipv4, user_id, vm_id, assigned_at) VALUES (?, ?, ?, ?)",
  );
  const releaseStmt = db.prepare("DELETE FROM ip_allocations WHERE user_id = ?");
  const releaseByVmIdStmt = db.prepare("DELETE FROM ip_allocations WHERE vm_id = ?");
  const getAllStmt = db.prepare("SELECT * FROM ip_allocations");
  const getByUserIdStmt = db.prepare("SELECT * FROM ip_allocations WHERE user_id = ?");
  const getUsedOctetsStmt = db.prepare(
    "SELECT ipv4 FROM ip_allocations WHERE ipv4 LIKE ? || '%'",
  );

  function toIpv4(octet: number): string {
    return `${baseIp}.${octet}`;
  }

  function allocate(userId: number, vmId: string): string {
    const usedRows = getUsedOctetsStmt.all(baseIp) as { ipv4: string }[];
    const usedOctets = new Set(
      usedRows.map((r) => {
        const parts = r.ipv4.split(".");
        return parseInt(parts[3], 10);
      }),
    );

    for (let octet = startOctet; octet <= endOctet; octet++) {
      if (!usedOctets.has(octet)) {
        const ipv4 = toIpv4(octet);
        const result = allocateStmt.run(ipv4, userId, vmId, new Date().toISOString());
        if (result.changes > 0) {
          logger.info("[Pool] Allocated %s to userId=%d", ipv4, userId);
          return ipv4;
        }
        // UNIQUE(user_id) constraint — this user already has an IP.
        // This shouldn't happen if we release first, but handle gracefully.
        const existing = getByUserIdStmt.get(userId) as { ipv4: string } | undefined;
        if (existing) {
          logger.warn("[Pool] User %d already has IP %s, returning existing", userId, existing.ipv4);
          return existing.ipv4;
        }
      }
    }

    throw new Error(`No IP addresses available in pool ${baseIp}.${startOctet}–${endOctet}`);
  }

  function release(userId: number): boolean {
    const result = releaseStmt.run(userId);
    if (result.changes > 0) {
      logger.info("[Pool] Released IP for userId=%d", userId);
    }
    return result.changes > 0;
  }

  function releaseByVmId(vmId: string): boolean {
    const result = releaseByVmIdStmt.run(vmId);
    if (result.changes > 0) {
      logger.info("[Pool] Released IP for vmId=%s", vmId);
    }
    return result.changes > 0;
  }

  function toRecord(row: { ipv4: string; user_id: number; vm_id: string; assigned_at: string }): IpAllocationRecord {
    return { ipv4: row.ipv4, userId: row.user_id, vmId: row.vm_id, assignedAt: row.assigned_at };
  }

  function getAllocations(): IpAllocationRecord[] {
    return (getAllStmt.all() as { ipv4: string; user_id: number; vm_id: string; assigned_at: string }[]).map(toRecord);
  }

  function getByUserId(userId: number): IpAllocationRecord | undefined {
    const row = getByUserIdStmt.get(userId) as { ipv4: string; user_id: number; vm_id: string; assigned_at: string } | undefined;
    return row ? toRecord(row) : undefined;
  }

  function getPoolSize(): number {
    return endOctet - startOctet + 1;
  }

  return { allocate, release, releaseByVmId, getAllocations, getByUserId, getPoolSize };
}
