import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Hoisted mocks for modules that updateVm() depends on
// ---------------------------------------------------------------------------
const { injectViaSshMock, injectViaGuestfishMock, readGoldenVersionMock } = vi.hoisted(() => ({
  injectViaSshMock: vi.fn(),
  injectViaGuestfishMock: vi.fn(),
  readGoldenVersionMock: vi.fn(),
}));

vi.mock("../../src/vm/ssh-inject.js", () => ({
  injectViaSsh: injectViaSshMock,
  DEFAULT_SSH_FIXES: ["ssh-fix-1", "ssh-fix-2", "ssh-fix-3"],
}));

vi.mock("../../src/vm/guestfish-inject.js", () => ({
  injectViaGuestfish: injectViaGuestfishMock,
  DEFAULT_GUESTFISH_FIXES: ["gf-fix-1", "gf-fix-2"],
}));

vi.mock("../../src/vm/version-check.js", () => ({
  readGoldenVersion: readGoldenVersionMock,
}));

// ---------------------------------------------------------------------------
// Import after mocks are registered
// ---------------------------------------------------------------------------
import { VmManager } from "../../src/vm/manager.js";

describe("updateVm", () => {
  const imagesDir = "/home/me/vm-images";
  const userId = 42;
  const domainName = "opencode-tg-42";
  const qcow2Path = `${imagesDir}/${domainName}.qcow2`;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  // -----------------------------------------------------------------------
  // Helper: create a VmManager with a programmable mock execSync function
  // -----------------------------------------------------------------------
  function createManager(execImpl?: (cmd: string) => string | void) {
    const mockExec = vi.fn().mockImplementation((cmd: string) => {
      if (execImpl) {
        const result = execImpl(cmd);
        if (result !== undefined) return result;
      }
      // Default: succeed silently
      return "";
    });
    return new VmManager(mockExec);
  }

  // -----------------------------------------------------------------------
  // 1. SSH success path (running VM, SSH works)
  // -----------------------------------------------------------------------
  it("SSH success path — running VM, SSH injection works", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-01T00:00:00Z")  // versionBefore
      .mockResolvedValueOnce("2025-06-01T00:00:00Z"); // versionAfter

    injectViaSshMock.mockResolvedValue({ success: true });

    const execCalls: string[] = [];
    const mgr = createManager((cmd: string) => {
      execCalls.push(cmd);
      // dominfo succeeds — VM exists
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      // virsh list --name shows the VM
      if (cmd.includes("virsh list --name")) return "opencode-tg-42\n";
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result).toEqual({
      success: true,
      method: "ssh",
      versionBefore: "2025-01-01T00:00:00Z",
      versionAfter: "2025-06-01T00:00:00Z",
    });

    // Should NOT have shutdown or called guestfish
    expect(injectViaGuestfishMock).not.toHaveBeenCalled();
    expect(execCalls).not.toContain(
      expect.stringContaining("virsh shutdown")
    );
    expect(execCalls).not.toContain(
      expect.stringContaining("virsh start")
    );

    // Should have called SSH inject
    expect(injectViaSshMock).toHaveBeenCalledTimes(1);
    // SSH called with (ip, password, DEFAULT_SSH_FIXES)
    const sshCall = injectViaSshMock.mock.calls[0];
    expect(sshCall[0]).toMatch(/^192\.168\.123\.\d{1,3}$/); // deterministic IP
    expect(sshCall[1]).toBeTruthy(); // password is derived
    expect(sshCall[2]).toEqual(["ssh-fix-1", "ssh-fix-2", "ssh-fix-3"]);

    // Version check called twice
    expect(readGoldenVersionMock).toHaveBeenCalledTimes(2);
    expect(readGoldenVersionMock).toHaveBeenNthCalledWith(1, qcow2Path);
    expect(readGoldenVersionMock).toHaveBeenNthCalledWith(2, qcow2Path);
  });

  // -----------------------------------------------------------------------
  // 2. SSH fail → shutdown → guestfish → start (running VM, SSH broken)
  // -----------------------------------------------------------------------
  it("SSH fail triggers shutdown → guestfish → start sequence", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-01T00:00:00Z")
      .mockResolvedValueOnce("2025-06-01T00:00:00Z");

    injectViaSshMock.mockResolvedValue({
      success: false,
      error: "Connection refused",
    });
    injectViaGuestfishMock.mockResolvedValue({ success: true });

    const execCalls: string[] = [];
    // Track how many times virsh list was called to simulate shutdown
    let listCallCount = 0;
    const mgr = createManager((cmd: string) => {
      execCalls.push(cmd);
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      // First two virsh list calls show VM running, third shows it stopped
      if (cmd.includes("virsh list --name")) {
        listCallCount++;
        if (listCallCount <= 2) return "opencode-tg-42\n";
        return ""; // empty = VM stopped
      }
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result).toEqual({
      success: true,
      method: "guestfish",
      versionBefore: "2025-01-01T00:00:00Z",
      versionAfter: "2025-06-01T00:00:00Z",
    });

    // SSH should have been attempted
    expect(injectViaSshMock).toHaveBeenCalledTimes(1);

    // Guestfish should have been called (fallback)
    expect(injectViaGuestfishMock).toHaveBeenCalledTimes(1);
    expect(injectViaGuestfishMock).toHaveBeenCalledWith(
      qcow2Path,
      ["gf-fix-1", "gf-fix-2"],
    );

    // Verify command order: shutdown → poll → guestfish → start
    const shutdownIdx = execCalls.findIndex(c => c.includes("virsh shutdown"));
    const startIdx = execCalls.findIndex(c => c.includes("virsh start"));
    expect(shutdownIdx).toBeGreaterThan(-1);
    expect(startIdx).toBeGreaterThan(shutdownIdx);

    // shutdown command should use --mode acpi
    expect(execCalls).toContain(
      `sudo virsh shutdown ${domainName} --mode acpi`
    );

    // start command
    expect(execCalls).toContain(`sudo virsh start ${domainName}`);
  });

  // -----------------------------------------------------------------------
  // 3. Not running → guestfish directly (no SSH, no shutdown/start)
  // -----------------------------------------------------------------------
  it("not running VM uses guestfish directly (no SSH, no shutdown/start)", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-01T00:00:00Z")
      .mockResolvedValueOnce("2025-06-01T00:00:00Z");

    injectViaGuestfishMock.mockResolvedValue({ success: true });

    const execCalls: string[] = [];
    const mgr = createManager((cmd: string) => {
      execCalls.push(cmd);
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: shut off";
      // virsh list --name returns empty = not running
      if (cmd.includes("virsh list --name")) return "";
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result).toEqual({
      success: true,
      method: "guestfish",
      versionBefore: "2025-01-01T00:00:00Z",
      versionAfter: "2025-06-01T00:00:00Z",
    });

    // Should NOT attempt SSH at all
    expect(injectViaSshMock).not.toHaveBeenCalled();

    // Should call guestfish directly
    expect(injectViaGuestfishMock).toHaveBeenCalledTimes(1);

    // Should NOT shutdown or start
    expect(execCalls).not.toContain(
      expect.stringContaining("virsh shutdown")
    );
    expect(execCalls).not.toContain(
      expect.stringContaining("virsh start")
    );
  });

  // -----------------------------------------------------------------------
  // 4. VM not found
  // -----------------------------------------------------------------------
  it("returns error when VM does not exist", async () => {
    const mgr = createManager((cmd: string) => {
      if (cmd.includes("dominfo")) throw new Error("Domain not found");
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result).toEqual({
      success: false,
      error: "VM not found",
      method: undefined,
      versionBefore: undefined,
      versionAfter: undefined,
    });

    // No version checks, no injects
    expect(readGoldenVersionMock).not.toHaveBeenCalled();
    expect(injectViaSshMock).not.toHaveBeenCalled();
    expect(injectViaGuestfishMock).not.toHaveBeenCalled();
  });

  // -----------------------------------------------------------------------
  // 5. Version before/after tracking
  // -----------------------------------------------------------------------
  it("tracks versionBefore and versionAfter correctly", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2024-12-01T10:00:00Z") // versionBefore
      .mockResolvedValueOnce("2025-06-30T12:00:00Z"); // versionAfter

    injectViaSshMock.mockResolvedValue({ success: true });

    const mgr = createManager((cmd: string) => {
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      if (cmd.includes("virsh list --name")) return "opencode-tg-42\n";
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result.versionBefore).toBe("2024-12-01T10:00:00Z");
    expect(result.versionAfter).toBe("2025-06-30T12:00:00Z");
    expect(result.success).toBe(true);
  });

  // -----------------------------------------------------------------------
  // 6. Guestfish fallback preserves versionBefore when SSH fails
  // -----------------------------------------------------------------------
  it("preserves versionBefore when SSH fails and guestfish fallback succeeds", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-15T08:00:00Z")
      .mockResolvedValueOnce("2025-06-30T12:00:00Z");

    injectViaSshMock.mockResolvedValue({ success: false, error: "timeout" });
    injectViaGuestfishMock.mockResolvedValue({ success: true });

    let listCalls = 0;
    const mgr = createManager((cmd: string) => {
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      if (cmd.includes("virsh list --name")) {
        listCalls++;
        return listCalls === 1 ? "opencode-tg-42\n" : "";
      }
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result.success).toBe(true);
    expect(result.method).toBe("guestfish");
    expect(result.versionBefore).toBe("2025-01-15T08:00:00Z");
    expect(result.versionAfter).toBe("2025-06-30T12:00:00Z");
  });

  // -----------------------------------------------------------------------
  // 7. Handles skipped update (version already current)
  // -----------------------------------------------------------------------
  it("handles case where versionBefore equals versionAfter (already up to date)", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-06-30T12:00:00Z")
      .mockResolvedValueOnce("2025-06-30T12:00:00Z");

    injectViaSshMock.mockResolvedValue({ success: true });

    const mgr = createManager((cmd: string) => {
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      if (cmd.includes("virsh list --name")) return "opencode-tg-42\n";
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result.success).toBe(true);
    expect(result.method).toBe("ssh");
    expect(result.versionBefore).toBe("2025-06-30T12:00:00Z");
    expect(result.versionAfter).toBe("2025-06-30T12:00:00Z");
  });

  // -----------------------------------------------------------------------
  // 8. Guestfish inject failure returns error
  // -----------------------------------------------------------------------
  it("returns error when guestfish injection fails on a stopped VM", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-01T00:00:00Z")
      .mockResolvedValueOnce("2025-01-01T00:00:00Z");

    injectViaGuestfishMock.mockResolvedValue({
      success: false,
      error: "virt-customize failed: disk locked",
    });

    const mgr = createManager((cmd: string) => {
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: shut off";
      if (cmd.includes("virsh list --name")) return "";
      return "";
    });

    const result = await mgr.updateVm(userId);

    expect(result.success).toBe(false);
    expect(result.method).toBe("guestfish");
    expect(result.error).toContain("guestfish");
    expect(result.error).toContain("disk locked");
    expect(result.versionBefore).toBe("2025-01-01T00:00:00Z");
  });

  // -----------------------------------------------------------------------
  // 9. Uses sudo virsh commands (verifies sudo prefix)
  // -----------------------------------------------------------------------
  it("uses sudo prefix for all virsh commands", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-01T00:00:00Z")
      .mockResolvedValueOnce("2025-06-01T00:00:00Z");

    injectViaSshMock.mockResolvedValue({ success: true });

    const execCalls: string[] = [];
    const mgr = createManager((cmd: string) => {
      execCalls.push(cmd);
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      if (cmd.includes("virsh list --name")) return "opencode-tg-42\n";
      return "";
    });

    await mgr.updateVm(userId);

    for (const call of execCalls) {
      if (call.includes("virsh")) {
        expect(call).toMatch(/^sudo virsh/);
      }
    }
  });

  // -----------------------------------------------------------------------
  // 10. Password is derived with "medium" tier
  // -----------------------------------------------------------------------
  it("derives password with 'medium' tier", async () => {
    readGoldenVersionMock
      .mockResolvedValueOnce("2025-01-01T00:00:00Z")
      .mockResolvedValueOnce("2025-06-01T00:00:00Z");

    injectViaSshMock.mockResolvedValue({ success: true });

    const mgr = createManager((cmd: string) => {
      if (cmd.includes("dominfo")) return "Id: 1\nName: opencode-tg-42\nState: running";
      if (cmd.includes("virsh list --name")) return "opencode-tg-42\n";
      return "";
    });

    await mgr.updateVm(userId);

    const sshCall = injectViaSshMock.mock.calls[0];
    const password = sshCall[1] as string;

    // Password from derivePassword(userId, "medium") is deterministic
    expect(password).toBeTruthy();
    expect(password.length).toBe(16); // base64url slice(0,16)

    // Same user + same tier = same password
    const { derivePassword } = await import("../../src/vm/types.js");
    const expectedPassword = derivePassword(userId, "medium");
    expect(password).toBe(expectedPassword);
  });
});
