import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import os from "node:os";
import path from "node:path";
import { realpath } from "node:fs/promises";

import { getTenantRuntimeInfo } from "../../../src/settings/manager.js";
import { getCurrentTelegramConversationScope } from "../../../src/telegram/scope.js";

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/settings/manager.js");
vi.mock("../../../src/telegram/scope.js");
vi.mock("node:fs/promises");

import {
  initBrowserRoots,
  getBrowserRoots,
  isWithinAllowedRoot,
  isAllowedRoot,
  __resetBrowserRootsForTests,
  getTenantBrowserRoots,
  isWithinAllowedTenantRoot,
  isWithinAllowedTenantRootSafe,
  isAllowedTenantRoot,
} from "../../../src/bot/utils/browser-roots.js";

describe("browser-roots", () => {
  const originalPlatform = process.platform;

  beforeEach(() => {
    __resetBrowserRootsForTests();
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: originalPlatform });
    __resetBrowserRootsForTests();
  });

  describe("initBrowserRoots", () => {
    it("should default to home directory when no env value is provided", () => {
      initBrowserRoots(undefined);
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(path.resolve(os.homedir()));
    });

    it("should default to home directory for empty string", () => {
      initBrowserRoots("");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(1);
    });

    it("should parse comma-separated paths", () => {
      initBrowserRoots("/home/user/projects,/opt/repos");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(2);
      expect(roots[0]).toBe(path.resolve("/home/user/projects"));
      expect(roots[1]).toBe(path.resolve("/opt/repos"));
    });

    it("should trim whitespace from entries", () => {
      initBrowserRoots("  /home/user/projects , /opt/repos  ");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(2);
    });

    it("should skip empty entries after splitting", () => {
      initBrowserRoots("/home/user/projects,,/opt/repos,");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(2);
    });

    it("should resolve relative paths", () => {
      initBrowserRoots("./relative-dir");
      const roots = getBrowserRoots();
      expect(roots[0]).toBe(path.resolve("./relative-dir"));
    });

    it("should expand ~ to home directory", () => {
      initBrowserRoots("~/projects");
      const roots = getBrowserRoots();
      expect(roots[0]).toBe(path.resolve(path.join(os.homedir(), "projects")));
    });

    it("should expand bare ~ to home directory", () => {
      initBrowserRoots("~");
      const roots = getBrowserRoots();
      expect(roots[0]).toBe(path.resolve(os.homedir()));
    });

    it("should expand ~ in multiple comma-separated entries", () => {
      initBrowserRoots("~/projects,~/work,/opt/repos");
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(3);
      expect(roots[0]).toBe(path.resolve(path.join(os.homedir(), "projects")));
      expect(roots[1]).toBe(path.resolve(path.join(os.homedir(), "work")));
      expect(roots[2]).toBe(path.resolve("/opt/repos"));
    });

    it("should not expand ~ in the middle of a path", () => {
      initBrowserRoots("/home/~user/projects");
      const roots = getBrowserRoots();
      expect(roots[0]).toBe(path.resolve("/home/~user/projects"));
    });
  });

  describe("getBrowserRoots (lazy init)", () => {
    it("should lazily initialize from env when never explicitly called", () => {
      // Set env before calling getBrowserRoots
      process.env.OPEN_BROWSER_ROOTS = "/tmp/test-root";
      const roots = getBrowserRoots();
      expect(roots).toHaveLength(1);
      expect(roots[0]).toBe(path.resolve("/tmp/test-root"));
      delete process.env.OPEN_BROWSER_ROOTS;
    });
  });

  describe("isWithinAllowedRoot", () => {
    it("should return true for exact root path", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/projects")).toBe(true);
    });

    it("should return true for path inside root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/projects/my-app")).toBe(true);
    });

    it("should return true for deeply nested path inside root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/projects/a/b/c/d")).toBe(true);
    });

    it("should return false for path outside root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user/documents")).toBe(false);
    });

    it("should return false for parent of root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isWithinAllowedRoot("/home/user")).toBe(false);
    });

    it("should return false for path that shares a prefix but is not a descendant", () => {
      initBrowserRoots("/home/user/projects");
      // /home/user/projects-backup is NOT inside /home/user/projects
      expect(isWithinAllowedRoot("/home/user/projects-backup")).toBe(false);
    });

    it("should work with multiple roots", () => {
      initBrowserRoots("/home/user/projects,/opt/repos");
      expect(isWithinAllowedRoot("/home/user/projects/app")).toBe(true);
      expect(isWithinAllowedRoot("/opt/repos/lib")).toBe(true);
      expect(isWithinAllowedRoot("/etc/config")).toBe(false);
    });

    it("should match case-insensitively on Windows", () => {
      Object.defineProperty(process, "platform", { value: "win32" });
      __resetBrowserRootsForTests();
      // Use forward-slash paths so path.resolve works on all test platforms
      initBrowserRoots("/home/User/Projects");
      expect(isWithinAllowedRoot("/home/user/projects/my-app")).toBe(true);
      expect(isWithinAllowedRoot("/HOME/USER/PROJECTS")).toBe(true);
    });

    it("should match case-sensitively on non-Windows", () => {
      Object.defineProperty(process, "platform", { value: "linux" });
      __resetBrowserRootsForTests();
      initBrowserRoots("/home/User/Projects");
      expect(isWithinAllowedRoot("/home/User/Projects/app")).toBe(true);
      expect(isWithinAllowedRoot("/home/user/projects/app")).toBe(false);
    });
  });

  describe("isAllowedRoot", () => {
    it("should return true for exact root match", () => {
      initBrowserRoots("/home/user/projects,/opt/repos");
      expect(isAllowedRoot("/home/user/projects")).toBe(true);
      expect(isAllowedRoot("/opt/repos")).toBe(true);
    });

    it("should return false for child of root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isAllowedRoot("/home/user/projects/child")).toBe(false);
    });

    it("should return false for parent of root", () => {
      initBrowserRoots("/home/user/projects");
      expect(isAllowedRoot("/home/user")).toBe(false);
    });
  });

  describe("getTenantBrowserRoots", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      __resetBrowserRootsForTests();
      vi.stubEnv("WORKSPACES_ROOT", "/home/me/Workspaces");
    });

    it("should return tenant workspace path when tenant runtime exists", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });

      const roots = getTenantBrowserRoots();
      expect(roots).toEqual(["/home/me/Workspaces/tenant-abc/workspace"]);
    });

    it("should fall back to global roots when no tenant runtime", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue(undefined);
      vi.stubEnv("OPEN_BROWSER_ROOTS", "/home/user/projects");

      const roots = getTenantBrowserRoots();
      expect(roots).toEqual(["/home/user/projects"]);
    });

    it("should fall back to global roots when tenantId missing", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "",
      });
      vi.stubEnv("OPEN_BROWSER_ROOTS", "/home/user/projects");

      const roots = getTenantBrowserRoots();
      expect(roots).toEqual(["/home/user/projects"]);
    });
  });

  describe("isWithinAllowedTenantRoot", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      __resetBrowserRootsForTests();
      vi.stubEnv("WORKSPACES_ROOT", "/home/me/Workspaces");
    });

    it("should allow paths within tenant workspace", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });

      expect(isWithinAllowedTenantRoot("/home/me/Workspaces/tenant-abc/workspace")).toBe(true);
      expect(isWithinAllowedTenantRoot("/home/me/Workspaces/tenant-abc/workspace/project")).toBe(true);
      expect(isWithinAllowedTenantRoot("/home/me/Workspaces/tenant-abc/workspace/deep/nested")).toBe(true);
    });

    it("should reject paths outside tenant workspace", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });

      expect(isWithinAllowedTenantRoot("/home/me/Workspaces")).toBe(false);
      expect(isWithinAllowedTenantRoot("/home/me/Workspaces/other-tenant/workspace")).toBe(false);
      expect(isWithinAllowedTenantRoot("/tmp")).toBe(false);
    });

    it("should fall back to global root checks when no tenant runtime", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue(undefined);
      vi.stubEnv("OPEN_BROWSER_ROOTS", "/home/user/projects");

      expect(isWithinAllowedTenantRoot("/home/user/projects")).toBe(true);
      expect(isWithinAllowedTenantRoot("/home/user/projects/subdir")).toBe(true);
      expect(isWithinAllowedTenantRoot("/tmp")).toBe(false);
    });
  });

  describe("isAllowedTenantRoot", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      __resetBrowserRootsForTests();
      vi.stubEnv("WORKSPACES_ROOT", "/home/me/Workspaces");
    });

    it("should return true for exact tenant workspace path", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });

      expect(isAllowedTenantRoot("/home/me/Workspaces/tenant-abc/workspace")).toBe(true);
    });

    it("should return false for subdirectories of tenant workspace", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });

      expect(isAllowedTenantRoot("/home/me/Workspaces/tenant-abc/workspace/project")).toBe(false);
    });

    it("should fall back to global root check when no tenant runtime", () => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue(undefined);
      vi.stubEnv("OPEN_BROWSER_ROOTS", "/home/user/projects");

      expect(isAllowedTenantRoot("/home/user/projects")).toBe(true);
      expect(isAllowedTenantRoot("/home/user/projects/subdir")).toBe(false);
    });
  });

  describe("isWithinAllowedTenantRootSafe", () => {
    beforeEach(() => {
      vi.resetAllMocks();
      __resetBrowserRootsForTests();
      vi.stubEnv("WORKSPACES_ROOT", "/home/me/Workspaces");
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });
    });

    it("should allow symlinks within tenant workspace", async () => {
      vi.mocked(realpath).mockResolvedValue("/home/me/Workspaces/tenant-abc/workspace/project");
      const result = await isWithinAllowedTenantRootSafe("/symlink/path");
      expect(result).toBe(true);
    });

    it("should reject symlinks outside tenant workspace", async () => {
      vi.mocked(realpath).mockResolvedValue("/tmp/outside");
      const result = await isWithinAllowedTenantRootSafe("/symlink/path");
      expect(result).toBe(false);
    });

    it("should fall back to path when realpath fails", async () => {
      vi.mocked(realpath).mockRejectedValue(new Error("ENOENT"));
      const result = await isWithinAllowedTenantRootSafe("/home/me/Workspaces/tenant-abc/workspace/project");
      expect(result).toBe(true);
    });
  });
});
