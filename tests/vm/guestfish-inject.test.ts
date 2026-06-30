import { describe, it, expect, vi, beforeEach } from "vitest";

// Use vi.hoisted() so the mock function is available when vi.mock() is hoisted
const { mockExecImpl } = vi.hoisted(() => {
  return { mockExecImpl: vi.fn() };
});

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    exec: mockExecImpl,
  };
});

import { injectViaGuestfish, DEFAULT_GUESTFISH_FIXES } from "../../src/vm/guestfish-inject.js";

describe("injectViaGuestfish", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // Helper: make every exec call succeed with given stdout
  function mockExecSuccess(stdout: string) {
    mockExecImpl.mockImplementation(
      (_cmd: string, optsOrCb: any, maybeCb?: any) => {
        // Support both exec(cmd, callback) and exec(cmd, opts, callback)
        const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
        if (cb) cb(null, stdout, "");
      },
    );
  }

  // Helper: make every exec call fail with given error
  function mockExecFailure(errorMsg: string, stderr = "") {
    mockExecImpl.mockImplementation(
      (_cmd: string, optsOrCb: any, maybeCb?: any) => {
        const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
        if (cb) cb(new Error(errorMsg), "", stderr);
      },
    );
  }

  // Helper: first exec succeeds (virt-customize), second exec fails (chown)
  function mockExecSuccessThenChownFail(chownErrorMsg: string) {
    let callCount = 0;
    mockExecImpl.mockImplementation(
      (_cmd: string, optsOrCb: any, maybeCb?: any) => {
        const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
        callCount++;
        if (callCount === 1) {
          // virt-customize succeeds
          if (cb) cb(null, "customize ok", "");
        } else {
          // chown fails
          if (cb) cb(new Error(chownErrorMsg), "", "");
        }
      },
    );
  }

  // --- Command construction tests ---

  it("builds correct sudo virt-customize command for a single command", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = ["echo hello"];

    mockExecSuccess("ok");

    const result = await injectViaGuestfish(qcow2Path, commands);

    expect(result.success).toBe(true);
    // Expect 2 exec calls: virt-customize + chown
    expect(mockExecImpl).toHaveBeenCalledTimes(2);

    const actualCmd: string = mockExecImpl.mock.calls[0][0] as string;
    expect(actualCmd).toContain("sudo virt-customize");
    expect(actualCmd).toContain(`-a ${qcow2Path}`);
    expect(actualCmd).toContain("--run-command");
    expect(actualCmd).toContain("echo hello");

    // Verify the --run-command value is properly quoted
    const hasQuote = actualCmd.includes("--run-command '") || actualCmd.includes('--run-command "');
    expect(hasQuote).toBe(true);
  });

  it("builds --run-command flag per command for multiple commands", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = [
      "sed -i 's/foo/bar/' /etc/ssh/sshd_config",
      "mkdir -p /workspace",
      "systemctl restart sshd",
    ];

    mockExecSuccess("ok");

    await injectViaGuestfish(qcow2Path, commands);

    const actualCmd: string = mockExecImpl.mock.calls[0][0] as string;

    const runCommandCount = (actualCmd.match(/--run-command/g) || []).length;
    expect(runCommandCount).toBe(3);

    expect(actualCmd).toContain("sed");
    expect(actualCmd).toContain("mkdir");
    expect(actualCmd).toContain("systemctl");
  });

  it("returns success: true and output on exit code 0", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = ["echo hello"];

    mockExecSuccess("customize output 123");

    const result = await injectViaGuestfish(qcow2Path, commands);

    expect(result.success).toBe(true);
    expect(result.output).toContain("customize output 123");
    expect(result.error).toBeUndefined();
  });

  // --- Error handling tests ---

  it("handles empty commands array gracefully", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands: string[] = [];

    mockExecSuccess("nothing to do");

    const result = await injectViaGuestfish(qcow2Path, commands);

    expect(result).toBeDefined();
    expect(result.success).toBe(true);
    const actualCmd: string = mockExecImpl.mock.calls[0][0] as string;
    expect(actualCmd).toContain(`-a ${qcow2Path}`);
  });

  it("returns success: false with error when exec fails", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = ["invalid-command-that-fails"];

    mockExecFailure("virt-customize: command failed", "error: command not found");

    const result = await injectViaGuestfish(qcow2Path, commands);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("virt-customize");
    // Only one exec call: virt-customize failed, so chown was never called
    expect(mockExecImpl).toHaveBeenCalledTimes(1);
  });

  it("handles killed/timeout exec errors", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = ["sleep 100"];

    mockExecImpl.mockImplementation(
      (_cmd: string, optsOrCb: any, maybeCb?: any) => {
        const cb = typeof optsOrCb === "function" ? optsOrCb : maybeCb;
        const err = Object.assign(new Error("ETIMEDOUT"), { killed: true });
        if (cb) cb(err, "", "timeout");
      },
    );

    const result = await injectViaGuestfish(qcow2Path, commands);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
  });

  it("passes the timeout option to child_process.exec", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = ["echo test"];
    const customTimeout = 30_000;

    mockExecSuccess("ok");

    await injectViaGuestfish(qcow2Path, commands, { timeout: customTimeout });

    // First call: virt-customize should get the custom timeout
    const execOptions = mockExecImpl.mock.calls[0][1] as { timeout?: number } | undefined;
    expect(execOptions?.timeout).toBe(customTimeout);
  });

  it("uses default timeout of 120000ms when no timeout option is provided", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = ["echo test"];

    mockExecSuccess("ok");

    await injectViaGuestfish(qcow2Path, commands);

    const execOptions = mockExecImpl.mock.calls[0][1] as { timeout?: number } | undefined;
    expect(execOptions?.timeout).toBe(120_000);
  });

  it("properly quotes commands containing single quotes", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";
    const commands = [
      "sed -i 's/^[[:space:]]*PasswordAuthentication no/PasswordAuthentication yes/' /etc/ssh/sshd_config",
    ];

    mockExecSuccess("ok");

    await injectViaGuestfish(qcow2Path, commands);

    const actualCmd: string = mockExecImpl.mock.calls[0][0] as string;

    expect(actualCmd).toContain("PasswordAuthentication");
    expect(actualCmd).toContain("sshd_config");
  });

  // --- chown tests ---

  it("calls sudo chown to restore libvirt-qemu ownership after successful virt-customize", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";

    mockExecSuccess("ok");

    await injectViaGuestfish(qcow2Path, ["echo hello"]);

    // Verify two exec calls
    expect(mockExecImpl).toHaveBeenCalledTimes(2);

    // First call: sudo virt-customize
    const customizeCmd: string = mockExecImpl.mock.calls[0][0] as string;
    expect(customizeCmd).toContain("sudo virt-customize");
    expect(customizeCmd).toContain(`-a ${qcow2Path}`);

    // Second call: sudo chown
    const chownCmd: string = mockExecImpl.mock.calls[1][0] as string;
    expect(chownCmd).toBe(`sudo chown libvirt-qemu:libvirt-qemu ${qcow2Path}`);

    // Verify chown gets its own timeout
    const chownOpts = mockExecImpl.mock.calls[1][1] as { timeout?: number } | undefined;
    expect(chownOpts?.timeout).toBe(5000);
  });

  it("returns error when chown fails after successful virt-customize", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";

    mockExecSuccessThenChownFail("chown: permission denied");

    const result = await injectViaGuestfish(qcow2Path, ["echo hello"]);

    expect(result.success).toBe(false);
    expect(result.error).toBeDefined();
    expect(result.error).toContain("chown failed");
    expect(result.error).toContain("permission denied");

    // Both exec calls should have been made
    expect(mockExecImpl).toHaveBeenCalledTimes(2);
  });

  // --- DEFAULT_GUESTFISH_FIXES constant ---

  it("DEFAULT_GUESTFISH_FIXES contains SSH fix and skills symlink commands", () => {
    expect(Array.isArray(DEFAULT_GUESTFISH_FIXES)).toBe(true);
    expect(DEFAULT_GUESTFISH_FIXES.length).toBeGreaterThanOrEqual(2);

    const sshFix = DEFAULT_GUESTFISH_FIXES.find((cmd: string) => cmd.includes("PasswordAuthentication"));
    const symlinkFix = DEFAULT_GUESTFISH_FIXES.find((cmd: string) => cmd.includes("workspace/skills"));

    expect(sshFix).toBeDefined();
    expect(symlinkFix).toBeDefined();

    expect(sshFix).toContain("[[:space:]]*");

    expect(symlinkFix).toContain("rm -rf");
    expect(symlinkFix).toContain("ln -sfT");
    expect(symlinkFix).toContain("mkdir -p /workspace/skills");
  });

  it("injectViaGuestfish with DEFAULT_GUESTFISH_FIXES builds correct command", async () => {
    const qcow2Path = "/tmp/test-vm.qcow2";

    mockExecSuccess("customized");

    const result = await injectViaGuestfish(qcow2Path, DEFAULT_GUESTFISH_FIXES);

    expect(result.success).toBe(true);

    const actualCmd: string = mockExecImpl.mock.calls[0][0] as string;
    expect(actualCmd).toContain("sudo virt-customize");
    expect(actualCmd).toContain(`-a ${qcow2Path}`);

    expect(actualCmd).toContain("PasswordAuthentication");
    expect(actualCmd).toContain("workspace/skills");

    const runCommandCount = (actualCmd.match(/--run-command/g) || []).length;
    expect(runCommandCount).toBe(2);
  });
});
