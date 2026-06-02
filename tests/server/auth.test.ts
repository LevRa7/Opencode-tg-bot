import { describe, it, expect, vi } from "vitest";
import { createHmac } from "node:crypto";

const BOT_TOKEN = "123456:ABC-DEF";

function createTestInitData(userId: number): string {
  const fields = new URLSearchParams();
  fields.set("query_id", "query123");
  fields.set("user", JSON.stringify({ id: userId, first_name: "Test" }));
  fields.set("auth_date", String(Math.floor(Date.now() / 1000)));

  const dataCheckString = Array.from(fields.entries())
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");

  const secret = createHmac("sha256", "WebAppData").update(BOT_TOKEN).digest();
  const hash = createHmac("sha256", secret).update(dataCheckString).digest("hex");
  fields.set("hash", hash);

  return fields.toString();
}

vi.mock("../../src/config.js", () => {
  const token = "123456:ABC-DEF";
  return {
    config: {
      telegram: {
        token,
        adminUserId: 777,
        allowedUserIds: [],
      },
      server: { logLevel: "error" },
    },
  };
});

vi.mock("../../src/settings/manager.js", () => ({
  getApprovedTelegramUserIds: vi.fn(() => []),
  getSubdomainsRepository: vi.fn(() => ({
    getByUserId: vi.fn(() => null),
    getBySubdomain: vi.fn(() => ({ user_id: 777, username: "test", subdomain: "test", password_hash: "hash", kind: "host", created_at: "2026", ssh_connection_id: null, hostname: null })),
    upsert: vi.fn(),
    deleteByUserId: vi.fn(),
  })),
}));

import { parseInitData, validateInitData, isUserAuthorized } from "../../src/server/auth.js";

describe("parseInitData", () => {
  it("parses valid initData", () => {
    const result = parseInitData(createTestInitData(123));
    expect(result).toBeDefined();
    expect(result!.user.id).toBe(123);
  });

  it("returns null for empty string", () => {
    expect(parseInitData("")).toBeNull();
  });

  it("returns null for garbage", () => {
    expect(parseInitData("???")).toBeNull();
  });
});

describe("validateInitData", () => {
  it("validates legitimate initData", () => {
    const result = validateInitData(createTestInitData(456));
    expect(result).toBeDefined();
  });

  it("rejects tampered initData", () => {
    const original = createTestInitData(789);
    const params = new URLSearchParams(original);
    params.set("user", JSON.stringify({ id: 999, first_name: "Test" }));
    const tampered = params.toString();
    expect(validateInitData(tampered)).toBeNull();
  });
});

describe("isUserAuthorized", () => {
  it("authorizes admin user", () => {
    expect(isUserAuthorized(777)).toBe(true);
  });

  it("denies unauthorized user", () => {
    expect(isUserAuthorized(999)).toBe(false);
  });
});
