import { describe, it, expect, beforeAll, afterAll } from "vitest";
import Database from "better-sqlite3";
import { createSubdomainsRepository } from "../../src/settings/repositories/subdomains.js";

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
