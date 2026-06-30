import { describe, it, expect, vi, beforeEach } from "vitest";

// vi.hoisted is required so the mock factory below can reference the spy:
// vitest hoists vi.mock() above other statements, so a plain const would be
// in the temporal dead zone when the factory runs at import time.
const { mockExecAsync } = vi.hoisted(() => ({
  mockExecAsync: vi.fn(),
}));

// Partially mock node:child_process — preserve execSync etc. for other modules
vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    exec: vi.fn(),
  };
});

// Partially mock node:util — replace promisify so we control execAsync
vi.mock("node:util", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:util")>();
  return {
    ...actual,
    promisify: vi.fn(() => mockExecAsync),
  };
});

import { injectViaSsh, DEFAULT_SSH_FIXES } from "../../src/vm/ssh-inject.js";

describe("injectViaSsh", () => {
  beforeEach(() => {
    mockExecAsync.mockReset();
  });

  it("executes a single command successfully", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "ok\n" });

    const result = await injectViaSsh("192.168.1.1", "password", ["echo hello"]);

    expect(result).toEqual({ success: true });
    expect(mockExecAsync).toHaveBeenCalledTimes(1);
    const cmd = mockExecAsync.mock.calls[0][0] as string;
    expect(cmd).toContain("sshpass");
    expect(cmd).toContain("-p password");
    expect(cmd).toContain('"echo hello"');
  });

  it("executes multiple commands all succeeding", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "ok\n" });

    const result = await injectViaSsh("192.168.1.1", "password", [
      "cmd1",
      "cmd2",
      "cmd3",
    ]);

    expect(result).toEqual({ success: true });
    expect(mockExecAsync).toHaveBeenCalledTimes(3);
  });

  it("stops on first failure and returns the failing command", async () => {
    mockExecAsync
      .mockResolvedValueOnce({ stdout: "ok\n" })
      .mockRejectedValueOnce(new Error("Connection refused"));

    const result = await injectViaSsh("192.168.1.1", "password", [
      "cmd1",
      "cmd2",
      "cmd3",
    ]);

    expect(result).toEqual({
      success: false,
      error: "Connection refused",
      command: "cmd2",
    });
    expect(mockExecAsync).toHaveBeenCalledTimes(2);
  });

  it("handles empty commands array gracefully", async () => {
    const result = await injectViaSsh("192.168.1.1", "password", []);

    expect(result).toEqual({ success: true });
    expect(mockExecAsync).not.toHaveBeenCalled();
  });

  it("returns error and command on timeout", async () => {
    mockExecAsync.mockRejectedValue(new Error("ETIMEDOUT"));

    const result = await injectViaSsh(
      "192.168.1.1",
      "password",
      ["long-running-cmd"],
      { timeout: 1000 },
    );

    expect(result).toEqual({
      success: false,
      error: "ETIMEDOUT",
      command: "long-running-cmd",
    });
  });

  it("uses default port 22 and user opencode", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "ok\n" });

    await injectViaSsh("192.168.1.1", "password", ["cmd1"]);

    const cmd = mockExecAsync.mock.calls[0][0] as string;
    expect(cmd).toContain("-p 22");
    expect(cmd).toContain("opencode@192.168.1.1");
  });

  it("uses custom port and user when provided", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "ok\n" });

    await injectViaSsh("192.168.1.1", "password", ["cmd1"], {
      port: 2222,
      user: "admin",
    });

    const cmd = mockExecAsync.mock.calls[0][0] as string;
    expect(cmd).toContain("-p 2222");
    expect(cmd).toContain("admin@192.168.1.1");
  });

  it("passes the timeout option to execAsync", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "ok\n" });

    await injectViaSsh("192.168.1.1", "password", ["cmd1"], { timeout: 5000 });

    const opts = mockExecAsync.mock.calls[0][1];
    expect(opts).toEqual({ timeout: 5000 });
  });

  it("uses default timeout of 15000 when not specified", async () => {
    mockExecAsync.mockResolvedValue({ stdout: "ok\n" });

    await injectViaSsh("192.168.1.1", "password", ["cmd1"]);

    const opts = mockExecAsync.mock.calls[0][1];
    expect(opts).toEqual({ timeout: 15000 });
  });

  it("handles non-Error rejection objects", async () => {
    mockExecAsync.mockRejectedValue("Killed");

    const result = await injectViaSsh("192.168.1.1", "password", ["cmd1"]);

    expect(result).toEqual({
      success: false,
      error: "Killed",
      command: "cmd1",
    });
  });
});

describe("DEFAULT_SSH_FIXES", () => {
  it("is an array of 3 commands", () => {
    expect(DEFAULT_SSH_FIXES).toHaveLength(3);
  });

  it("includes sed command to enable PasswordAuthentication", () => {
    expect(DEFAULT_SSH_FIXES[0]).toContain("PasswordAuthentication yes");
    expect(DEFAULT_SSH_FIXES[0]).toContain("/etc/ssh/sshd_config");
    expect(DEFAULT_SSH_FIXES[0]).toContain("[[:space:]]");
  });

  it("includes sshd restart command", () => {
    expect(DEFAULT_SSH_FIXES[1]).toContain("systemctl restart sshd");
    expect(DEFAULT_SSH_FIXES[1]).toContain("systemctl restart ssh");
  });

  it("includes skills symlink command", () => {
    expect(DEFAULT_SSH_FIXES[2]).toContain("mkdir -p /workspace/skills");
    expect(DEFAULT_SSH_FIXES[2]).toContain("ln -sfT");
  });
});
