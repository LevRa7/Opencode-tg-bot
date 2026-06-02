import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSubdomainsRepository } from "../../src/settings/repositories/subdomains.js";
import type { SubdomainsRepository } from "../../src/settings/repositories/subdomains.js";
import { SubdomainManager } from "../../src/server/subdomain-manager.js";
import type { SubdomainRow } from "../../src/server/types.js";

let db: Database.Database;
let repo: ReturnType<typeof createSubdomainsRepository>;

beforeAll(() => {
  db = new Database(":memory:");
  db.exec(`
    CREATE TABLE IF NOT EXISTS subdomains (
      user_id INTEGER PRIMARY KEY, username TEXT NOT NULL,
      subdomain TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL,
      kind TEXT NOT NULL, ssh_connection_id TEXT, hostname TEXT, created_at TEXT NOT NULL
    )
  `);
  repo = createSubdomainsRepository(db);
});

afterAll(() => db.close());

describe("SubdomainsRepository", () => {
  it("should insert and retrieve a subdomain", () => {
    repo.upsert(123, {
      username: "lev", subdomain: "lev", password_hash: "hash123",
      kind: "host", created_at: "2026-01-01T00:00:00Z",
    });
    const row = repo.getByUserId(123);
    expect(row).toBeDefined();
    expect(row!.username).toBe("lev");
    expect(row!.subdomain).toBe("lev");
  });

  it("should look up by subdomain string", () => {
    const row = repo.getBySubdomain("lev");
    expect(row).toBeDefined();
    expect(row!.user_id).toBe(123);
  });

  it("should return undefined for unknown subdomain", () => {
    expect(repo.getBySubdomain("nonexistent")).toBeUndefined();
  });

  it("should update existing subdomain", () => {
    repo.upsert(123, { kind: "ssh-host", hostname: "vps" });
    const row = repo.getByUserId(123);
    expect(row!.kind).toBe("ssh-host");
    expect(row!.hostname).toBe("vps");
  });
});

function mockRepo(rows: SubdomainRow[] = []): SubdomainsRepository {
  const store = new Map<string, SubdomainRow>(rows.map((r) => [r.subdomain, r]));
  return {
    getByUserId: vi.fn((id: number) => {
      for (const r of store.values()) {
        if (r.user_id === id) return r;
      }
      return undefined;
    }),
    getBySubdomain: vi.fn((s: string) => store.get(s)),
    upsert: vi.fn((userId: number, fields: any) => {
      store.set(fields.subdomain as string, { user_id: userId, ...fields } as SubdomainRow);
    }),
    deleteByUserId: vi.fn(),
  };
}

describe("SubdomainManager", () => {
  describe("ensureSubdomain", () => {
    it("should create a new subdomain with generated password", () => {
      const repo = mockRepo();
      const mgr = new SubdomainManager(repo);
      const result = mgr.ensureSubdomain(123, "lev", "host");
      expect(result.subdomain).toBe("lev");
      expect(result.username).toBe("lev");
      expect(result.password).toBeDefined();
      expect(result.password!.length).toBeGreaterThanOrEqual(12);
      expect(result.kind).toBe("host");
    });

    it("should return existing subdomain without regenerating", () => {
      const repo = mockRepo([{
        user_id: 123, username: "lev", subdomain: "lev",
        password_hash: "oldhash", kind: "host", created_at: "2026-01-01",
        ssh_connection_id: null, hostname: null,
      }]);
      const mgr = new SubdomainManager(repo);
      const result = mgr.ensureSubdomain(123, "lev", "host");
      expect(result.subdomain).toBe("lev");
      expect(result.password).toBeUndefined(); // existing has no plain password
    });

    it("should use tg{id} as username when no @username", () => {
      const repo = mockRepo();
      const mgr = new SubdomainManager(repo);
      const result = mgr.ensureSubdomain(456, undefined, "host");
      expect(result.username).toBe("tg456");
      expect(result.subdomain).toBe("tg456");
    });
  });

  describe("resolveSubdomain", () => {
    it("should resolve primary subdomain", () => {
      const repo = mockRepo([{
        user_id: 123, username: "lev", subdomain: "lev",
        password_hash: "hash", kind: "host", created_at: "2026-01-01",
        ssh_connection_id: null, hostname: null,
      }]);
      const mgr = new SubdomainManager(repo);
      const result = mgr.resolveSubdomain("lev");
      expect(result).toBeDefined();
      expect(result!.userId).toBe(123);
      expect(result!.kind).toBe("host");
    });

    it("should resolve SSH subdomain with hostname", () => {
      const repo = mockRepo([{
        user_id: 123, username: "lev", subdomain: "vps.lev",
        password_hash: "hash", kind: "ssh-host", hostname: "vps",
        ssh_connection_id: "conn1", created_at: "2026-01-01",
      }]);
      const mgr = new SubdomainManager(repo);
      const result = mgr.resolveSubdomain("vps.lev");
      expect(result).toBeDefined();
      expect(result!.kind).toBe("ssh-host");
    });

    it("should return null for unknown subdomain", () => {
      const repo = mockRepo([]);
      const mgr = new SubdomainManager(repo);
      expect(mgr.resolveSubdomain("unknown")).toBeNull();
    });
  });

  describe("regeneratePassword", () => {
    it("should generate new password and update hash", () => {
      const repo = mockRepo([{
        user_id: 123, username: "lev", subdomain: "lev",
        password_hash: "oldhash", kind: "host", created_at: "2026-01-01",
        ssh_connection_id: null, hostname: null,
      }]);
      const mgr = new SubdomainManager(repo);
      const newPw = mgr.regeneratePassword(123);
      expect(newPw).toBeDefined();
      expect(newPw!.length).toBeGreaterThanOrEqual(12);
      // verify upsert was called
      expect(repo.upsert).toHaveBeenCalled();
    });

    it("should return null for missing user", () => {
      const repo = mockRepo([]);
      const mgr = new SubdomainManager(repo);
      expect(mgr.regeneratePassword(999)).toBeNull();
    });
  });

  describe("ensureSshSubdomain", () => {
    it("should create SSH subdomain with hostname prefix", () => {
      const repo = mockRepo();
      const mgr = new SubdomainManager(repo);
      const result = mgr.ensureSshSubdomain(789, "ivan", "myserver", "ssh-host", "conn-abc");
      expect(result.subdomain).toBe("myserver.ivan");
      expect(result.kind).toBe("ssh-host");
      expect(result.hostname).toBe("myserver");
      expect(result.password).toBeDefined();
    });
  });
});
