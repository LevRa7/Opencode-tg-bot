import { describe, it, expect, vi, beforeEach } from "vitest";
import { VM_TIERS, type VmSpec } from "../../src/vm/types.js";

const { existsSyncMock, unlinkSyncMock } = vi.hoisted(() => ({
  existsSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: existsSyncMock,
    unlinkSync: unlinkSyncMock,
  };
});

vi.mock("../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

import { VmManager } from "../../src/vm/manager.js";

describe("VmManager", () => {
  let mgr: VmManager;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  describe("isAvailable", () => {
    it("returns true when virsh and qemu-img are found", async () => {
      const mockExecSync = vi.fn().mockReturnValue("/usr/bin/virsh");
      mgr = new VmManager(mockExecSync);
      const result = await mgr.isAvailable();
      expect(result).toBe(true);
    });

    it("returns false when virsh is not found", async () => {
      const mockExecSync = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes("virsh")) throw new Error("not found");
        return "/usr/bin/qemu-img";
      });
      mgr = new VmManager(mockExecSync);
      const result = await mgr.isAvailable();
      expect(result).toBe(false);
    });
  });

  describe("ensureBaseImage", () => {
    it("returns success when base image exists", async () => {
      existsSyncMock.mockReturnValue(true);
      const mgr = new VmManager(vi.fn());
      const result = await mgr.ensureBaseImage();
      expect(result.success).toBe(true);
    });

    it("returns error when base image is missing", async () => {
      existsSyncMock.mockReturnValue(false);
      const mgr = new VmManager(vi.fn());
      const result = await mgr.ensureBaseImage();
      expect(result.success).toBe(false);
      expect(result.error).toContain("not found");
    });
  });

  describe("isRunning", () => {
    it("returns true when virsh domstate reports running", async () => {
      const mockExec = vi.fn().mockReturnValue("running");
      const mgr = new VmManager(mockExec);
      const result = await mgr.isRunning(1);
      expect(result).toBe(true);
      expect(mockExec).toHaveBeenCalledWith("sudo virsh domstate opencode-tg-1", expect.any(Object));
    });

    it("returns false when virsh domstate reports shut off", async () => {
      const mockExec = vi.fn().mockReturnValue("shut off");
      const mgr = new VmManager(mockExec);
      const result = await mgr.isRunning(1);
      expect(result).toBe(false);
    });

    it("returns false when virsh domstate reports crashed", async () => {
      const mockExec = vi.fn().mockReturnValue("crashed");
      const mgr = new VmManager(mockExec);
      const result = await mgr.isRunning(1);
      expect(result).toBe(false);
    });
  });

  describe("getBridgeIp", () => {
    it("returns IP from net-dhcp-leases", async () => {
      const mockExec = vi.fn().mockReturnValue(
        " Name       MAC address          Protocol     Address\n" +
        " vnet0      52:54:00:ab:cd:ef    ipv4         192.168.122.100/24",
      );
      const mgr = new VmManager(mockExec);
      const result = await mgr.getBridgeIp(1, 0);
      expect(result).toBe("192.168.122.100");
    });

    it("returns null when virsh fails on every attempt", async () => {
      const mockExec = vi.fn().mockImplementation(() => {
        throw new Error("virsh error");
      });
      const mgr = new VmManager(mockExec);
      const result = await mgr.getBridgeIp(1, 0);
      expect(result).toBeNull();
    });
  });

  describe("stop", () => {
    it("returns success on graceful shutdown", async () => {
      const mockExec = vi.fn();
      const mgr = new VmManager(mockExec);
      const result = await mgr.stop(1);
      expect(result).toEqual({ success: true });
      expect(mockExec).toHaveBeenCalledWith(
        `sudo virsh shutdown opencode-tg-1 --mode acpi`,
        expect.objectContaining({ timeout: 30_000 }),
      );
    });

    it("force destroys when shutdown fails", async () => {
      const mockExec = vi.fn()
        .mockImplementationOnce(() => {
          throw new Error("shutdown failed");
        });
      const mgr = new VmManager(mockExec);
      const result = await mgr.stop(1);
      expect(result).toEqual({ success: true });
      expect(mockExec).toHaveBeenCalledWith(
        "sudo virsh destroy opencode-tg-1 --graceful",
        expect.any(Object),
      );
    });

    it("returns failure when both shutdown and destroy fail", async () => {
      const mockExec = vi.fn().mockImplementation(() => {
        throw new Error("all failed");
      });
      const mgr = new VmManager(mockExec);
      const result = await mgr.stop(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe("all failed");
    });
  });

  describe("destroy", () => {
    it("stops, undefines, and removes ISO", async () => {
      const mockExec = vi.fn().mockReturnValue("");
      const mgr = new VmManager(mockExec);
      const result = await mgr.destroy(1);
      expect(result).toEqual({ success: true });
      expect(mockExec).toHaveBeenCalledWith("sudo virsh shutdown opencode-tg-1 --mode acpi", expect.any(Object));
      expect(mockExec).toHaveBeenCalledWith(
        "sudo virsh undefine opencode-tg-1 --remove-all-storage",
        expect.any(Object),
      );
      expect(unlinkSyncMock).toHaveBeenCalledWith(
        expect.stringContaining("cloud-init-1.iso"),
      );
    });

    it("returns failure when undefine fails", async () => {
      const mockExec = vi.fn()
        .mockReturnValueOnce("") // shutdown succeeds
        .mockImplementationOnce(() => {
          throw new Error("undefine failed");
        });
      const mgr = new VmManager(mockExec);
      const result = await mgr.destroy(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe("undefine failed");
    });

    it("returns failure when stop fails", async () => {
      const mockExec = vi.fn().mockImplementation(() => {
        throw new Error("stop failed");
      });
      const mgr = new VmManager(mockExec);
      const result = await mgr.destroy(1);
      expect(result.success).toBe(false);
      expect(result.error).toBe("stop failed");
    });
  });

  describe("waitForHealth", () => {
    it("returns true on 200 OK", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: true, status: 200 });
      vi.stubGlobal("fetch", mockFetch);
      const mgr = new VmManager(vi.fn());
      const result = await mgr.waitForHealth("http://10.0.0.1:4096", "secret", 30_000, 0);
      expect(result).toBe(true);
      expect(mockFetch).toHaveBeenCalledWith(
        "http://10.0.0.1:4096/api/health",
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: expect.stringContaining("Basic"),
          }),
        }),
      );
    });

    it("returns false on non-200 response", async () => {
      const mockFetch = vi.fn().mockResolvedValue({ ok: false, status: 503 });
      vi.stubGlobal("fetch", mockFetch);
      const mgr = new VmManager(vi.fn());
      const result = await mgr.waitForHealth("http://10.0.0.1:4096", "secret", 1, 0);
      expect(result).toBe(false);
    });

    it("returns false when fetch throws", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);
      const mgr = new VmManager(vi.fn());
      const result = await mgr.waitForHealth("http://10.0.0.1:4096", "secret", 1, 0);
      expect(result).toBe(false);
    });

    it("returns false on timeout", async () => {
      const mockFetch = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
      vi.stubGlobal("fetch", mockFetch);
      const mgr = new VmManager(vi.fn());
      const result = await mgr.waitForHealth("http://10.0.0.1:4096", "secret", 1, 0);
      expect(result).toBe(false);
      expect(mockFetch).toHaveBeenCalled();
    });
  });

  describe("createAndStart", () => {
    const smallSpec: VmSpec = VM_TIERS.small;
    const imagesDir = "/home/me/vm-images";
    const baseImagePath = `${imagesDir}/opencode-golden.qcow2`;

    it("returns VmInfo with correct fields on success", async () => {
      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        // Return DHCP lease with valid IP for net-dhcp-leases
        if (String(cmd).includes("net-dhcp-leases")) {
          return " Name       MAC address          Protocol     Address\n" +
            " vnet0      52:54:00:ab:cd:ef    ipv4         192.168.122.100/24";
        }
        return "";
      });
      const mockWrite = vi.fn();
      const mockMkdir = vi.fn();
      const mgr = new VmManager(mockExec);

      const result = await mgr.createAndStart(1, smallSpec, {
        opencodePassword: "opencode-secret",
        sudoPassword: "sudo-secret",
        writeFileSync: mockWrite,
        mkdirSync: mockMkdir,
        dhcpRetryDelayMs: 0,
      });

      expect(result.userId).toBe(1);
      expect(result.tier).toBe("small");
      expect(result.domainName).toBe("opencode-tg-1");
      expect(result.qcow2Path).toBe(`${imagesDir}/opencode-tg-1.qcow2`);
      expect(result.cloudInitIsoPath).toBe(`${imagesDir}/cloud-init-1.iso`);
      expect(result.sudoPassword).toBe("sudo-secret");
      expect(result.bridgeIp).toBe("192.168.122.100");
      expect(result.baseUrl).toContain("4096");
      expect(result.startTime).toBeTruthy();

      // qemu-img create
      expect(mockExec).toHaveBeenCalledWith(
        `sudo qemu-img create -f qcow2 -b ${baseImagePath} -F qcow2 ${imagesDir}/opencode-tg-1.qcow2 20G`,
        expect.any(Object),
      );
      // virsh define
      expect(mockExec).toHaveBeenCalledWith(
        `sudo virsh define ${imagesDir}/opencode-tg-1.xml`,
        expect.any(Object),
      );
      // virsh start
      expect(mockExec).toHaveBeenCalledWith(
        "sudo virsh start opencode-tg-1",
        expect.any(Object),
      );

      // domain XML written
      expect(mockWrite).toHaveBeenCalledWith(
        `${imagesDir}/opencode-tg-1.xml`,
        expect.stringContaining("<domain"),
      );
    });

    it("throws when qemu-img create fails", async () => {
      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes("qemu-img")) throw new Error("disk full");
        return "";
      });
      const mgr = new VmManager(mockExec);

      await expect(
        mgr.createAndStart(1, smallSpec, {
          opencodePassword: "pw",
          sudoPassword: "sudo",
          writeFileSync: vi.fn(),
          mkdirSync: vi.fn(),
          dhcpRetryDelayMs: 0,
        }),
      ).rejects.toThrow("disk full");
    });

    it("throws when virsh define fails", async () => {
      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes("virsh define")) throw new Error("define failed");
        return "";
      });
      const mgr = new VmManager(mockExec);

      await expect(
        mgr.createAndStart(1, smallSpec, {
          opencodePassword: "pw",
          sudoPassword: "sudo",
          writeFileSync: vi.fn(),
          mkdirSync: vi.fn(),
          dhcpRetryDelayMs: 0,
        }),
      ).rejects.toThrow("define failed");
    });

    it("throws when virsh start fails", async () => {
      const mockExec = vi.fn().mockImplementation((cmd: string) => {
        if (cmd.includes("virsh start")) throw new Error("start failed");
        return "";
      });
      const mgr = new VmManager(mockExec);

      await expect(
        mgr.createAndStart(1, smallSpec, {
          opencodePassword: "pw",
          sudoPassword: "sudo",
          writeFileSync: vi.fn(),
          mkdirSync: vi.fn(),
          dhcpRetryDelayMs: 0,
        }),
      ).rejects.toThrow("start failed");
    });
  });
});
