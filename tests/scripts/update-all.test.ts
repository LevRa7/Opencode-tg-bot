import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Hoist mock functions
const { mockExecSync, mockUpdateVm } = vi.hoisted(() => ({
  mockExecSync: vi.fn(),
  mockUpdateVm: vi.fn(),
}));

// Mock child_process — execSync used by the script for virsh listing
vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, execSync: mockExecSync };
});

// Mock vm/manager — the script dynamically imports vmManager from here
// From tests/scripts/update-all.test.ts, ../../src/vm/manager.js = src/vm/manager.js
vi.mock("../../src/vm/manager.js", () => ({
  vmManager: { updateVm: mockUpdateVm },
  VmManager: class {},
}));

import { runUpdateAll } from "../../scripts/update-all.js";

describe("runUpdateAll", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockExecSync.mockReturnValue("opencode-tg-1\nopencode-tg-42\nopencode-tg-100\n");
    mockUpdateVm.mockResolvedValue({ success: true, method: "ssh" });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  // -----------------------------------------------------------------------
  // VM listing & parsing
  // -----------------------------------------------------------------------

  it("lists VMs via virsh and greps for opencode-tg", async () => {
    const result = await runUpdateAll({ dryRun: false });

    expect(mockExecSync).toHaveBeenCalledWith(
      "virsh list --all --name | grep opencode-tg",
      expect.any(Object),
    );
    expect(mockUpdateVm).toHaveBeenCalledTimes(3);
    expect(result.total).toBe(3);
  });

  it("parses userId from domain name opencode-tg-{userId}", async () => {
    mockExecSync.mockReturnValue("opencode-tg-42\n");

    await runUpdateAll({ dryRun: false });

    expect(mockUpdateVm).toHaveBeenCalledTimes(1);
    expect(mockUpdateVm).toHaveBeenCalledWith(42);
  });

  it("handles empty VM list (no VMs)", async () => {
    mockExecSync.mockReturnValue("");

    const result = await runUpdateAll({ dryRun: false });

    expect(mockUpdateVm).not.toHaveBeenCalled();
    expect(result.total).toBe(0);
    expect(result.results).toHaveLength(0);
  });

  it("handles virsh command failure", async () => {
    mockExecSync.mockImplementation(() => {
      throw new Error("virsh: command not found");
    });

    await expect(runUpdateAll({ dryRun: false })).rejects.toThrow(
      "virsh: command not found",
    );
  });

  it("skips non-matching lines", async () => {
    mockExecSync.mockReturnValue(
      "some-other-vm\nopencode-tg-1\nunrelated\nopencode-tg-2\n",
    );

    await runUpdateAll({ dryRun: false });

    expect(mockUpdateVm).toHaveBeenCalledTimes(2);
    expect(mockUpdateVm).toHaveBeenCalledWith(1);
    expect(mockUpdateVm).toHaveBeenCalledWith(2);
  });

  it("skips lines where userId is not a valid number", async () => {
    mockExecSync.mockReturnValue("opencode-tg-\nopencode-tg-abc\nopencode-tg-1\n");

    await runUpdateAll({ dryRun: false });

    expect(mockUpdateVm).toHaveBeenCalledTimes(1);
    expect(mockUpdateVm).toHaveBeenCalledWith(1);
  });

  // -----------------------------------------------------------------------
  // --dry-run mode
  // -----------------------------------------------------------------------

  it("in dry-run mode, does not call updateVm", async () => {
    const result = await runUpdateAll({ dryRun: true });

    expect(mockUpdateVm).not.toHaveBeenCalled();
    expect(result.dryRun).toBe(true);
    for (const r of result.results) {
      expect(r.method).toBe("skipped (dry-run)");
    }
  });

  it("dry-run still lists all VMs", async () => {
    mockExecSync.mockReturnValue("opencode-tg-1\nopencode-tg-2\nopencode-tg-3\n");

    const result = await runUpdateAll({ dryRun: true });

    expect(mockUpdateVm).not.toHaveBeenCalled();
    expect(result.total).toBe(3);
    expect(result.results).toHaveLength(3);
  });

  // -----------------------------------------------------------------------
  // Real mode (non-dry-run)
  // -----------------------------------------------------------------------

  it("collects successful results", async () => {
    mockExecSync.mockReturnValue("opencode-tg-1\nopencode-tg-2\n");
    mockUpdateVm
      .mockResolvedValueOnce({ success: true, method: "ssh" })
      .mockResolvedValueOnce({ success: true, method: "guestfish" });

    const result = await runUpdateAll({ dryRun: false });

    expect(result.successes).toBe(2);
    expect(result.failures).toBe(0);
    expect(result.results[0].method).toBe("ssh");
    expect(result.results[1].method).toBe("guestfish");
  });

  it("collects failed results", async () => {
    mockExecSync.mockReturnValue("opencode-tg-1\nopencode-tg-2\n");
    mockUpdateVm
      .mockResolvedValueOnce({ success: true, method: "ssh" })
      .mockResolvedValueOnce({ success: false, method: "guestfish", error: "disk full" });

    const result = await runUpdateAll({ dryRun: false });

    expect(result.successes).toBe(1);
    expect(result.failures).toBe(1);
    expect(result.results[1].error).toBe("disk full");
    expect(result.results[1].success).toBe(false);
  });

  it("handles updateVm throwing (not returning error result)", async () => {
    mockExecSync.mockReturnValue("opencode-tg-1\n");
    mockUpdateVm.mockRejectedValue(new Error("crash"));

    const result = await runUpdateAll({ dryRun: false });

    expect(result.successes).toBe(0);
    expect(result.failures).toBe(1);
    expect(result.results[0].error).toBe("crash");
    expect(result.results[0].success).toBe(false);
  });

  // -----------------------------------------------------------------------
  // Result structure
  // -----------------------------------------------------------------------

  it("returns structured result with correct counts", async () => {
    mockExecSync.mockReturnValue(
      "opencode-tg-1\nopencode-tg-2\nopencode-tg-3\nopencode-tg-4\n",
    );
    mockUpdateVm
      .mockResolvedValueOnce({ success: true, method: "ssh" })
      .mockResolvedValueOnce({ success: true, method: "guestfish" })
      .mockResolvedValueOnce({ success: false, method: "ssh", error: "timeout" })
      .mockRejectedValueOnce(new Error("boom"));

    const result = await runUpdateAll({ dryRun: false });

    expect(result.total).toBe(4);
    expect(result.successes).toBe(2);
    expect(result.failures).toBe(2);
    expect(result.dryRun).toBe(false);
    expect(result.results).toHaveLength(4);
    expect(result.results[0]).toEqual({
      userId: 1,
      success: true,
      method: "ssh",
    });
    expect(result.results[2]).toEqual({
      userId: 3,
      success: false,
      method: "ssh",
      error: "timeout",
    });
    expect(result.results[3]).toEqual({
      userId: 4,
      success: false,
      method: "error",
      error: "boom",
    });
  });

  it("processes VMs sequentially (not concurrently)", async () => {
    mockExecSync.mockReturnValue("opencode-tg-1\nopencode-tg-2\n");

    const callOrder: number[] = [];
    mockUpdateVm.mockImplementation((userId: number) => {
      callOrder.push(userId);
      return Promise.resolve({ success: true, method: "ssh" });
    });

    await runUpdateAll({ dryRun: false });

    expect(callOrder).toEqual([1, 2]);
  });
});
