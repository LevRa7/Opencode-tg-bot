import type Database from "better-sqlite3";

export type VmStateStatus = "provisioning" | "healthy" | "unhealthy" | "destroyed" | "degraded";

export interface VmStateRecord {
  vmId: string;
  userId: number;
  environmentType: string;
  specTier: string;
  assignedIpv4: string;
  assignedMac: string;
  domainName: string;
  passwordHash: string;
  version: number;
  createdAt: string;
  updatedAt: string;
  status: VmStateStatus;
  failureCount: number;
}

export interface VmStatePersistence {
  save(record: VmStateRecord): void;
  getByUserId(userId: number): VmStateRecord | undefined;
  getByVmId(vmId: string): VmStateRecord | undefined;
  listActive(): VmStateRecord[];
  listDegraded(): VmStateRecord[];
  listDestroyed(): VmStateRecord[];
  markDestroyed(vmId: string): boolean;
  updateIfCurrent(vmId: string, expectedVersion: number, patch: Partial<VmStateRecord>): boolean;
  deleteByUserId(userId: number): boolean;
  incrementFailureCount(vmId: string): number;
  resetFailureCount(vmId: string): void;
}

interface VmStateDbRow {
  vm_id: string;
  user_id: number;
  environment_type: string;
  spec_tier: string;
  assigned_ipv4: string | null;
  assigned_mac: string | null;
  domain_name: string | null;
  password_hash: string | null;
  version: number;
  created_at: string;
  updated_at: string;
  status: string;
  failure_count: number;
}

function toRecord(row: VmStateDbRow): VmStateRecord {
  return {
    vmId: row.vm_id,
    userId: row.user_id,
    environmentType: row.environment_type,
    specTier: row.spec_tier,
    assignedIpv4: row.assigned_ipv4 ?? "",
    assignedMac: row.assigned_mac ?? "",
    domainName: row.domain_name ?? "",
    passwordHash: row.password_hash ?? "",
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status as VmStateStatus,
    failureCount: row.failure_count ?? 0,
  };
}

export function createVmStatePersistence(db: Database.Database): VmStatePersistence {
  const MAX_RETRIES = 5;
  const getByUserIdStmt = db.prepare("SELECT * FROM vm_states WHERE user_id = ?");
  const getByVmIdStmt = db.prepare("SELECT * FROM vm_states WHERE vm_id = ?");
  const listActiveStmt = db.prepare("SELECT * FROM vm_states WHERE status != 'destroyed' AND status != 'degraded'");
  const listDegradedStmt = db.prepare("SELECT * FROM vm_states WHERE status = 'degraded'");
  const listDestroyedStmt = db.prepare("SELECT * FROM vm_states WHERE status = 'destroyed'");
  const upsertStmt = db.prepare(`
    INSERT INTO vm_states (vm_id, user_id, environment_type, spec_tier, assigned_ipv4, assigned_mac, domain_name, password_hash, version, created_at, updated_at, status, failure_count)
    VALUES (@vmId, @userId, @environmentType, @specTier, @assignedIpv4, @assignedMac, @domainName, @passwordHash, @version, @createdAt, @updatedAt, @status, @failureCount)
    ON CONFLICT(vm_id) DO UPDATE SET
      user_id = @userId,
      environment_type = @environmentType,
      spec_tier = @specTier,
      assigned_ipv4 = @assignedIpv4,
      assigned_mac = @assignedMac,
      domain_name = @domainName,
      password_hash = @passwordHash,
      version = version + 1,
      updated_at = @updatedAt,
      status = @status,
      failure_count = @failureCount
  `);
  const updateFieldsStmt = db.prepare(`
    UPDATE vm_states SET
      status = COALESCE(@status, status),
      version = version + 1,
      updated_at = @updatedAt,
      assigned_ipv4 = COALESCE(@assignedIpv4, assigned_ipv4),
      assigned_mac = COALESCE(@assignedMac, assigned_mac),
      password_hash = COALESCE(@passwordHash, password_hash)
    WHERE vm_id = @vmId AND version = @expectedVersion
  `);
  const markDestroyedStmt = db.prepare(
    "UPDATE vm_states SET status = 'destroyed', version = version + 1, updated_at = @updatedAt WHERE vm_id = @vmId",
  );
  const deleteByUserIdStmt = db.prepare("DELETE FROM vm_states WHERE user_id = ?");
  const incrementFailureCountStmt = db.prepare(
    "UPDATE vm_states SET failure_count = failure_count + 1, version = version + 1, updated_at = @updatedAt, status = CASE WHEN failure_count + 1 >= @maxRetries THEN 'degraded' ELSE status END WHERE vm_id = @vmId",
  );
  const resetFailureCountStmt = db.prepare(
    "UPDATE vm_states SET failure_count = 0, version = version + 1, updated_at = @updatedAt WHERE vm_id = @vmId",
  );

  return {
    save(record: VmStateRecord): void {
      upsertStmt.run({
        vmId: record.vmId,
        userId: record.userId,
        environmentType: record.environmentType,
        specTier: record.specTier,
        assignedIpv4: record.assignedIpv4,
        assignedMac: record.assignedMac,
        domainName: record.domainName,
        passwordHash: record.passwordHash,
        version: record.version,
        createdAt: record.createdAt,
        updatedAt: new Date().toISOString(),
        status: record.status,
        failureCount: record.failureCount ?? 0,
      });
    },

    getByUserId(userId: number): VmStateRecord | undefined {
      const row = getByUserIdStmt.get(userId) as VmStateDbRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    getByVmId(vmId: string): VmStateRecord | undefined {
      const row = getByVmIdStmt.get(vmId) as VmStateDbRow | undefined;
      return row ? toRecord(row) : undefined;
    },

    listActive(): VmStateRecord[] {
      return (listActiveStmt.all() as VmStateDbRow[]).map(toRecord);
    },

    listDegraded(): VmStateRecord[] {
      return (listDegradedStmt.all() as VmStateDbRow[]).map(toRecord);
    },

    listDestroyed(): VmStateRecord[] {
      return (listDestroyedStmt.all() as VmStateDbRow[]).map(toRecord);
    },

    markDestroyed(vmId: string): boolean {
      const result = markDestroyedStmt.run({ vmId, updatedAt: new Date().toISOString() });
      return result.changes > 0;
    },

    updateIfCurrent(vmId: string, expectedVersion: number, patch: Partial<VmStateRecord>): boolean {
      const result = updateFieldsStmt.run({
        vmId,
        expectedVersion,
        updatedAt: new Date().toISOString(),
        status: patch.status ?? null,
        assignedIpv4: patch.assignedIpv4 ?? null,
        assignedMac: patch.assignedMac ?? null,
        passwordHash: patch.passwordHash ?? null,
      });
      return result.changes > 0;
    },

    deleteByUserId(userId: number): boolean {
      const result = deleteByUserIdStmt.run(userId);
      return result.changes > 0;
    },

    incrementFailureCount(vmId: string): number {
      const result = incrementFailureCountStmt.run({ vmId, maxRetries: MAX_RETRIES, updatedAt: new Date().toISOString() });
      return result.changes;
    },

    resetFailureCount(vmId: string): void {
      resetFailureCountStmt.run({ vmId, updatedAt: new Date().toISOString() });
    },
  };
}
