import { describe, it, expect, vi } from "vitest";

const { mockSsh } = vi.hoisted(() => ({
  mockSsh: {
    isSshActive: vi.fn(() => false),
    getLocalPort: vi.fn(() => undefined),
    getActiveConnection: vi.fn(() => undefined),
    isBootstrapInProgress: vi.fn(() => false),
  },
}));

vi.mock("../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 777 },
    opencode: { apiUrl: "http://localhost:4096", username: "opencode", password: "test" },
    server: { logLevel: "error" },
  },
}));

vi.mock("../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "admin-pass"),
  getTenantRuntimeInfo: vi.fn(() => null),
  getSubdomainsRepository: vi.fn(() => ({
    getBySubdomain: vi.fn((s: string) => {
      if (s === "levra7") return {
        user_id: 777, username: "levra7", subdomain: "levra7",
        kind: "host", created_at: "2026-01-01",
        hostname: null, ssh_connection_id: null,
      };
      if (s === "tenant") return {
        user_id: 888, username: "tenant", subdomain: "tenant",
        kind: "tenant", created_at: "2026-01-01",
        hostname: null, ssh_connection_id: null,
      };
      return null;
    }),
    getByUserId: vi.fn(),
    upsert: vi.fn(),
    deleteByUserId: vi.fn(),
  })),
}));

vi.mock("../../src/utils/ssh-manager.js", () => ({ sshManager: mockSsh }));

import { rewriteApiUrl, rewriteWsPath } from "../../src/server/api-url-rewrite.js";

describe("rewriteApiUrl", () => {
  it("should strip /api/ prefix", () => {
    expect(rewriteApiUrl("/api/session")).toBe("/session");
  });

  it("should strip /api/ from global health endpoint", () => {
    expect(rewriteApiUrl("/api/global/health")).toBe("/global/health");
  });

  it("should strip /api/ from config endpoint", () => {
    expect(rewriteApiUrl("/api/config")).toBe("/config");
  });

  it("should strip /api/ from project endpoint", () => {
    expect(rewriteApiUrl("/api/project")).toBe("/project");
  });

  it("should strip /api/ from session with id", () => {
    expect(rewriteApiUrl("/api/session/ses_123")).toBe("/session/ses_123");
  });

  it("should strip /api/ from SSE event endpoint", () => {
    expect(rewriteApiUrl("/api/global/event")).toBe("/global/event");
  });

  it("should return unchanged url for non-/api/ paths", () => {
    expect(rewriteApiUrl("/session")).toBe("/session");
  });

  it("should return unchanged url for /index.html", () => {
    expect(rewriteApiUrl("/index.html")).toBe("/index.html");
  });

  it("should return unchanged url for root", () => {
    expect(rewriteApiUrl("/")).toBe("/");
  });

  it("should strip /api/ with trailing query string", () => {
    expect(rewriteApiUrl("/api/session?limit=10")).toBe("/session?limit=10");
  });
});

describe("rewriteWsPath", () => {
  it("should strip /api/ prefix and /ws suffix", () => {
    expect(rewriteWsPath("/api/global/event/ws")).toBe("/global/event");
  });

  it("should strip /api/ prefix and /ws suffix for terminal WS", () => {
    expect(rewriteWsPath("/api/terminal/ws")).toBe("/terminal");
  });

  it("should strip only /api/ when no /ws suffix", () => {
    expect(rewriteWsPath("/api/global/event")).toBe("/global/event");
  });

  it("should strip only /ws when no /api/ prefix", () => {
    expect(rewriteWsPath("/global/event/ws")).toBe("/global/event");
  });

  it("should return unchanged for non-matching path", () => {
    expect(rewriteWsPath("/global/event")).toBe("/global/event");
  });

  it("should strip both prefix and suffix for deeply nested paths", () => {
    expect(rewriteWsPath("/api/some/deep/path/ws")).toBe("/some/deep/path");
  });
});
