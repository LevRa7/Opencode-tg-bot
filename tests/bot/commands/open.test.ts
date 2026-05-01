import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import { getTenantRuntimeInfo } from "../../../src/settings/manager.js";
import { getCurrentTelegramConversationScope, getCurrentTelegramConversationScopeKey } from "../../../src/telegram/scope.js";

const mocked = vi.hoisted(() => ({
  scanDirectoryMock: vi.fn(),
  pathToDisplayPathMock: vi.fn((p: string) => p.replace("/home/user", "~")),
  buildEntryLabelMock: vi.fn((entry: { name: string }) => `📁 ${entry.name}`),
  buildTreeHeaderMock: vi.fn(
    (display: string, _count: number, page: number, totalPages: number) => {
      let h = `📂 ${display}`;
      if (totalPages > 1) h += `  (${page + 1}/${totalPages})`;
      return h;
    },
  ),
  isScanErrorMock: vi.fn(
    (result: unknown) => typeof result === "object" && result !== null && "error" in result,
  ),
  getTenantBrowserRootsMock: vi.fn(() => ["/home/user"]),
  isWithinAllowedTenantRootMock: vi.fn(() => true),
  isAllowedTenantRootMock: vi.fn(() => false),
  ensureActiveInlineMenuMock: vi.fn().mockResolvedValue(true),
  isForegroundBusyMock: vi.fn(() => false),
  replyBusyBlockedMock: vi.fn().mockResolvedValue(undefined),
  upsertSessionDirectoryMock: vi.fn().mockResolvedValue(undefined),
  getProjectByWorktreeMock: vi.fn().mockResolvedValue({
    id: "proj-1",
    worktree: "/home/user/my-project",
    name: "my-project",
  }),
  switchToProjectMock: vi.fn().mockResolvedValue({ keyboard: [[{ text: "mock" }]] }),
  interactionStartMock: vi.fn(),
}));

vi.mock("../../../src/bot/utils/file-tree.js", () => ({
  pathToDisplayPath: mocked.pathToDisplayPathMock,
  scanDirectory: mocked.scanDirectoryMock,
  buildEntryLabel: mocked.buildEntryLabelMock,
  buildTreeHeader: mocked.buildTreeHeaderMock,
  isScanError: mocked.isScanErrorMock,
  MAX_ENTRIES_PER_PAGE: 8,
}));

vi.mock("../../../src/bot/utils/browser-roots.js", () => ({
  // Old exports (kept for compatibility)
  getBrowserRoots: mocked.getTenantBrowserRootsMock,
  isWithinAllowedRoot: mocked.isWithinAllowedTenantRootMock,
  isAllowedRoot: mocked.isAllowedTenantRootMock,
  // New tenant-aware exports
  getTenantBrowserRoots: mocked.getTenantBrowserRootsMock,
  isWithinAllowedTenantRoot: mocked.isWithinAllowedTenantRootMock,
  isAllowedTenantRoot: mocked.isAllowedTenantRootMock,
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  appendInlineMenuCancelButton: vi.fn((kb: unknown) => kb),
  ensureActiveInlineMenu: mocked.ensureActiveInlineMenuMock,
}));

vi.mock("../../../src/interaction/manager.js", () => ({
  interactionManager: {
    start: mocked.interactionStartMock,
    getSnapshot: vi.fn(() => null),
    clear: vi.fn(),
  },
}));

vi.mock("../../../src/bot/utils/busy-guard.js", () => ({
  isForegroundBusy: mocked.isForegroundBusyMock,
  replyBusyBlocked: mocked.replyBusyBlockedMock,
}));

vi.mock("../../../src/session/cache-manager.js", () => ({
  upsertSessionDirectory: mocked.upsertSessionDirectoryMock,
  __resetSessionDirectoryCacheForTests: vi.fn(),
  syncSessionDirectoryCache: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("../../../src/project/manager.js", () => ({
  getProjectByWorktree: mocked.getProjectByWorktreeMock,
}));

vi.mock("../../../src/bot/utils/switch-project.js", () => ({
  switchToProject: mocked.switchToProjectMock,
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/i18n/index.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../src/i18n/index.js")>();
  return {
    ...actual,
    t: (key: string, params?: Record<string, unknown>) => {
      if (key === "open.selected") {
        return `Selected ${params?.project || "~"}`;
      }
      return key;
    },
  };
});

vi.mock("../../../src/settings/manager.js");
vi.mock("../../../src/telegram/scope.js", () => ({
  getCurrentTelegramConversationScope: vi.fn(),
  getCurrentTelegramConversationScopeKey: vi.fn(() => "global"),
  buildTelegramConversationScopeKey: vi.fn(),
  extractTelegramConversationScopeFromContext: vi.fn(),
  GLOBAL_TELEGRAM_SCOPE_KEY: "global",
  runWithTelegramConversationScope: vi.fn(),
  resolveTelegramConversationScopeKey: vi.fn(),
  extractMessageThreadIdFromContext: vi.fn(),
  isForumChat: vi.fn(),
  ConversationContextKey: {},
}));



import {
  openCommand,
  handleOpenCallback,
  clearOpenPathIndex,
} from "../../../src/bot/commands/open.js";
import {
  clearScopeOpenPathIndex,
  encodeScopedPathReference,
  decodeScopedPathReference,
} from "../../../src/bot/runtime/scope-open-state.js";
import { getCurrentTelegramConversationScopeKey } from "../../../src/telegram/scope.js";

// --- Context factories ---

function createCommandContext(): Context {
  return {
    chat: { id: 123 },
    reply: vi.fn().mockResolvedValue({ message_id: 42 }),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number = 42): Context {
  return {
    chat: { id: 123 },
    callbackQuery: {
      data,
      message: { message_id: messageId },
    } as Context["callbackQuery"],
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    reply: vi.fn().mockResolvedValue(undefined),
    api: {},
  } as unknown as Context;
}

// --- Test data helpers ---

function makeScanResult(
  entries: Array<{ name: string; fullPath: string }>,
  currentPath: string,
  hasParent: boolean = true,
  page: number = 0,
) {
  return {
    entries,
    totalCount: entries.length,
    page,
    currentPath,
    displayPath: currentPath.replace("/home/user", "~"),
    hasParent,
    parentPath: hasParent ? currentPath.replace(/\/[^/]+$/, "") || "/" : null,
  };
}

// --- Tests ---

describe("open command", () => {
  beforeEach(() => {
    clearOpenPathIndex();
    clearScopeOpenPathIndex("global");
    // Reset hoisted mocks that need custom return values
    mocked.scanDirectoryMock.mockReset();
    mocked.getTenantBrowserRootsMock.mockReset().mockReturnValue(["/home/user"]);
    mocked.isWithinAllowedTenantRootMock.mockReset().mockReturnValue(true);
    mocked.isAllowedTenantRootMock.mockReset().mockReturnValue(false);
    mocked.ensureActiveInlineMenuMock.mockReset().mockResolvedValue(true);
    mocked.isForegroundBusyMock.mockReset().mockReturnValue(false);
    mocked.getProjectByWorktreeMock.mockReset().mockResolvedValue({
      id: "proj-1",
      worktree: "/home/user/my-project",
      name: "my-project",
    });
    mocked.switchToProjectMock.mockReset().mockResolvedValue({ keyboard: [[{ text: "mock" }]] });
    mocked.upsertSessionDirectoryMock.mockReset().mockResolvedValue(undefined);
    mocked.interactionStartMock.mockReset();
  });

  describe("openCommand", () => {
    it("should show directory browser on success", async () => {
      const entries = [
        { name: "projects", fullPath: "/home/user/projects" },
        { name: "documents", fullPath: "/home/user/documents" },
      ];
      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult(entries, "/home/user"));

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/user", 0);
      expect(ctx.reply).toHaveBeenCalledTimes(1);
      // Verify interaction was registered
      expect(mocked.interactionStartMock).toHaveBeenCalledWith(
        expect.objectContaining({
          kind: "inline",
          expectedInput: "callback",
          metadata: expect.objectContaining({ menuKind: "open" }),
        }),
      );
    });

    it("should block when foreground is busy", async () => {
      mocked.isForegroundBusyMock.mockReturnValue(true);

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
      expect(mocked.scanDirectoryMock).not.toHaveBeenCalled();
    });

    it("should show error message when scanDirectory returns error", async () => {
      mocked.scanDirectoryMock.mockResolvedValue({ error: "Permission denied", code: "EACCES" });

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(t("open.scan_error", { error: "Permission denied" }));
    });

    it("should handle unexpected errors gracefully", async () => {
      mocked.scanDirectoryMock.mockRejectedValue(new Error("unexpected"));

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      expect(ctx.reply).toHaveBeenCalledWith(t("open.open_error"));
    });
  });

  describe("handleOpenCallback", () => {
    it("should return false for non-open callback data", async () => {
      const ctx = createCallbackContext("project:abc");
      const result = await handleOpenCallback(ctx);
      expect(result).toBe(false);
    });

    it("should return false when callback data is undefined", async () => {
      const ctx = { callbackQuery: {} } as unknown as Context;
      const result = await handleOpenCallback(ctx);
      expect(result).toBe(false);
    });

    it("should block when foreground is busy", async () => {
      mocked.isForegroundBusyMock.mockReturnValue(true);
      const ctx = createCallbackContext("open:roots");

      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.replyBusyBlockedMock).toHaveBeenCalledWith(ctx);
    });

    it("should return true when ensureActiveInlineMenu returns false (stale menu)", async () => {
      mocked.ensureActiveInlineMenuMock.mockResolvedValue(false);
      const ctx = createCallbackContext("open:roots");

      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      // Should NOT call editMessageText or navigateTo
      expect(ctx.editMessageText).not.toHaveBeenCalled();
    });

    it("should show root selection on open:roots callback", async () => {
      mocked.getTenantBrowserRootsMock.mockReturnValue(["/home/user", "/opt/repos"]);

      const ctx = createCallbackContext("open:roots");
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
      expect(ctx.editMessageText).toHaveBeenCalled();
    });

    it("should deny navigation to path outside allowed roots", async () => {
      mocked.isWithinAllowedTenantRootMock.mockReturnValue(false);

      const ctx = createCallbackContext("open:nav:/etc/passwd");
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("open.access_denied"),
      });
      expect(mocked.scanDirectoryMock).not.toHaveBeenCalled();
    });

    it("should navigate into subdirectory on open:nav: callback", async () => {
      const targetPath = "/home/user/projects";
      mocked.scanDirectoryMock.mockResolvedValue(
        makeScanResult([{ name: "my-app", fullPath: "/home/user/projects/my-app" }], targetPath),
      );

      const ctx = createCallbackContext(`open:nav:${targetPath}`);
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(targetPath, 0);
      expect(ctx.editMessageText).toHaveBeenCalled();
    });

    it("should navigate up to parent on open:nav: with parent path", async () => {
      const parentPath = "/home/user";
      mocked.scanDirectoryMock.mockResolvedValue(
        makeScanResult([{ name: "projects", fullPath: "/home/user/projects" }], parentPath),
      );

      const ctx = createCallbackContext(`open:nav:${parentPath}`);
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(parentPath, 0);
    });

    it("should handle pagination callback", async () => {
      const currentPath = "/home/user";
      mocked.scanDirectoryMock.mockResolvedValue(
        makeScanResult([{ name: "z-dir", fullPath: "/home/user/z-dir" }], currentPath),
      );

      const ctx = createCallbackContext(`open:pg:${currentPath}|1`);
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(currentPath, 1);
    });

    it("should select directory as project on open:sel: callback", async () => {
      const dirPath = "/home/user/my-project";

      const ctx = createCallbackContext(`open:sel:${dirPath}`);
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      // Verify full selection flow: upsert first so getProjectByWorktree can
      // find the directory, then switch.
      expect(mocked.upsertSessionDirectoryMock).toHaveBeenCalledWith(dirPath, expect.any(Number));
      expect(mocked.getProjectByWorktreeMock).toHaveBeenCalledWith(dirPath);
      expect(mocked.switchToProjectMock).toHaveBeenCalledWith(
        ctx,
        expect.objectContaining({ id: "proj-1", worktree: "/home/user/my-project" }),
        "open_project_selected",
      );
      const upsertOrder = mocked.upsertSessionDirectoryMock.mock.invocationCallOrder[0];
      const getProjectOrder = mocked.getProjectByWorktreeMock.mock.invocationCallOrder[0];
      expect(upsertOrder).toBeLessThan(getProjectOrder);

      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith();
      expect(ctx.reply).toHaveBeenCalledWith(
        expect.stringContaining("~"),
        expect.objectContaining({ reply_markup: expect.anything() }),
      );
      expect(ctx.deleteMessage).toHaveBeenCalled();
    });

    it("should show error on select failure", async () => {
      mocked.getProjectByWorktreeMock.mockRejectedValue(new Error("not found"));

      const ctx = createCallbackContext("open:sel:/home/user/bad-dir");
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
        text: t("callback.processing_error"),
      });
      expect(ctx.reply).toHaveBeenCalledWith(t("open.select_error"));
    });

    it("should show error when navigation scan fails", async () => {
      mocked.scanDirectoryMock.mockResolvedValue({ error: "Permission denied", code: "EACCES" });

      const ctx = createCallbackContext("open:nav:/root/forbidden");
      const result = await handleOpenCallback(ctx);

      expect(result).toBe(true);
      // Navigation error is shown as callback query answer
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "Permission denied" });
    });
  });

  describe("clearOpenPathIndex", () => {
    it("should invalidate previously encoded indexed paths", async () => {
      // Use a very long path to force index encoding (> 64 bytes with prefix)
      const longPath = "/home/user/" + "a".repeat(60);
      const entries = [{ name: "a".repeat(60), fullPath: longPath }];
      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult(entries, "/home/user"));

      // openCommand builds keyboard with encoded paths
      const ctx = createCommandContext();
      await openCommand(ctx as never);

      // Extract callback_data from the keyboard built by ctx.reply
      const replyCall = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const keyboard = replyCall[1]?.reply_markup;
      const firstRow = keyboard?.inline_keyboard?.[0];
      const callbackData = firstRow?.[0]?.callback_data as string;

      // Verify it uses indexed encoding (contains #)
      expect(callbackData).toMatch(/open:nav:#\d+/);

      // Now clear the index
      clearOpenPathIndex();

      // Trying to handle the now-stale callback should not navigate
      // (decodePathFromCallback returns null for unknown index)
      const navCtx = createCallbackContext(callbackData);
      const result = await handleOpenCallback(navCtx);

      // Should return false because the indexed path can't be resolved
      // and no other prefix matches
      expect(result).toBe(false);
    });
  });

  describe("path encoding (indirect via keyboard inspection)", () => {
    it("should encode short paths directly in callback_data", async () => {
      const shortPath = "/home/user/proj";
      const entries = [{ name: "proj", fullPath: shortPath }];
      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult(entries, "/home/user"));

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      const replyCall = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const keyboard = replyCall[1]?.reply_markup;
      const firstRow = keyboard?.inline_keyboard?.[0];
      const callbackData = firstRow?.[0]?.callback_data as string;

      // Short path should be encoded directly (no # index)
      expect(callbackData).toBe(`open:nav:${shortPath}`);
    });

    it("should encode long paths with index in callback_data", async () => {
      const longPath = "/home/user/" + "x".repeat(60);
      const entries = [{ name: "x".repeat(60), fullPath: longPath }];
      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult(entries, "/home/user"));

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      const replyCall = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const keyboard = replyCall[1]?.reply_markup;
      const firstRow = keyboard?.inline_keyboard?.[0];
      const callbackData = firstRow?.[0]?.callback_data as string;

      // Long path should use indexed encoding
      expect(callbackData).toMatch(/^open:nav:#\d+$/);
      expect(callbackData).not.toContain(longPath);
    });

    it("should round-trip indexed path through navigate callback", async () => {
      const longPath = "/home/user/" + "y".repeat(60);
      const entries = [{ name: "y".repeat(60), fullPath: longPath }];
      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult(entries, "/home/user"));

      // Build keyboard to get encoded callback_data
      const cmdCtx = createCommandContext();
      await openCommand(cmdCtx as never);

      const replyCall = (cmdCtx.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const callbackData = replyCall[1]?.reply_markup?.inline_keyboard?.[0]?.[0]
        ?.callback_data as string;
      expect(callbackData).toMatch(/^open:nav:#\d+$/);

      // Now feed the encoded callback_data back into handleOpenCallback
      mocked.scanDirectoryMock.mockReset();
      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult([], longPath));

      const navCtx = createCallbackContext(callbackData);
      const result = await handleOpenCallback(navCtx);

      expect(result).toBe(true);
      // Prove the path was decoded correctly — scanDirectory received the original long path
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(longPath, 0);
    });
  });

  describe("topic scope isolation for path encoding", () => {
    beforeEach(() => {
      clearOpenPathIndex();
      vi.mocked(getCurrentTelegramConversationScopeKey).mockReturnValue("global");
    });

    it("should keep path references isolated per scope", async () => {
      const longPathA = "/home/user/" + "a".repeat(60);
      const longPathB = "/home/user/" + "b".repeat(60);

      vi.mocked(getCurrentTelegramConversationScopeKey).mockReturnValue("topic-a");
      mocked.scanDirectoryMock.mockResolvedValueOnce(
        makeScanResult([{ name: "a".repeat(60), fullPath: longPathA }], "/home/user"),
      );
      const ctxA = createCommandContext();
      await openCommand(ctxA as never);
      const replyA = (ctxA.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const callbackA = replyA[1]?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data as string;
      expect(callbackA).toMatch(/^open:nav:#\d+$/);

      vi.mocked(getCurrentTelegramConversationScopeKey).mockReturnValue("topic-b");
      mocked.scanDirectoryMock.mockResolvedValueOnce(
        makeScanResult([{ name: "b".repeat(60), fullPath: longPathB }], "/home/user"),
      );
      const ctxB = createCommandContext();
      await openCommand(ctxB as never);
      const replyB = (ctxB.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const callbackB = replyB[1]?.reply_markup?.inline_keyboard?.[0]?.[0]?.callback_data as string;
      expect(callbackB).toMatch(/^open:nav:#\d+$/);

      // topic A's callback still navigates to longPathA
      mocked.scanDirectoryMock.mockReset();
      mocked.scanDirectoryMock.mockResolvedValueOnce(makeScanResult([], longPathA));
      vi.mocked(getCurrentTelegramConversationScopeKey).mockReturnValue("topic-a");
      const navA = createCallbackContext(callbackA);
      expect(await handleOpenCallback(navA)).toBe(true);
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(longPathA, 0);
    });
  });

  describe("tenant isolation", () => {
    beforeEach(() => {
      vi.mocked(getCurrentTelegramConversationScope).mockReturnValue({
        userId: 123,
        chatId: 456,
        messageThreadId: undefined,
      });
    });

    it("should use tenant workspace when tenant runtime exists", async () => {
      vi.mocked(getTenantRuntimeInfo).mockReturnValue({
        userId: 123,
        chatId: 456,
        port: 4096,
        baseUrl: "http://localhost:4096",
        tenantId: "tenant-abc",
      });
      vi.stubEnv("WORKSPACES_ROOT", "/home/me/Workspaces");

      // Mock file system scan
      mocked.scanDirectoryMock.mockResolvedValue({
        entries: [],
        totalCount: 0,
        page: 0,
        currentPath: "/home/me/Workspaces/tenant-abc/workspace",
        displayPath: "/home/me/Workspaces/tenant-abc/workspace",
        hasParent: false,
      });

      mocked.getTenantBrowserRootsMock.mockReturnValue(["/home/me/Workspaces/tenant-abc/workspace"]);

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      expect(mocked.getTenantBrowserRootsMock).toHaveBeenCalled();
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith("/home/me/Workspaces/tenant-abc/workspace", 0);
    });

    it("should fall back to global roots when no tenant runtime", async () => {
      vi.mocked(getTenantRuntimeInfo).mockReturnValue(undefined);
      vi.stubEnv("OPEN_BROWSER_ROOTS", "/home/user/projects");

      mocked.getTenantBrowserRootsMock.mockReturnValue(["/home/user/projects"]);

      const ctx = createCommandContext();
      await openCommand(ctx as never);

      expect(mocked.getTenantBrowserRootsMock).toHaveBeenCalled();
      // Should use global roots
    });
  });

  describe("topic isolation", () => {
    beforeEach(() => {
      clearScopeOpenPathIndex("scope-a");
      clearScopeOpenPathIndex("scope-b");
      clearScopeOpenPathIndex("global");
    });

    it("should not invalidate one topic's encoded paths when another topic clears its index", async () => {
      const longPathA = "/home/user/" + "a".repeat(60);
      const longPathB = "/home/user/" + "b".repeat(60);
      const entriesA = [{ name: "a".repeat(60), fullPath: longPathA }];
      const entriesB = [{ name: "b".repeat(60), fullPath: longPathB }];

      vi.mocked(getCurrentTelegramConversationScopeKey).mockReturnValue("scope-a");
      mocked.scanDirectoryMock.mockResolvedValue(
        makeScanResult(entriesA, "/home/user"),
      );
      const ctxA = createCommandContext();
      await openCommand(ctxA as never);
      const replyCallA = (ctxA.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const callbackA = replyCallA[1]?.reply_markup?.inline_keyboard?.[0]?.[0]
        ?.callback_data as string;
      expect(callbackA).toMatch(/open:nav:#\d+/);

      vi.mocked(getCurrentTelegramConversationScopeKey).mockReturnValue("scope-b");
      mocked.scanDirectoryMock.mockResolvedValue(
        makeScanResult(entriesB, "/home/user"),
      );
      const ctxB = createCommandContext();
      await openCommand(ctxB as never);
      const replyCallB = (ctxB.reply as ReturnType<typeof vi.fn>).mock.calls[0];
      const callbackB = replyCallB[1]?.reply_markup?.inline_keyboard?.[0]?.[0]
        ?.callback_data as string;
      expect(callbackB).toMatch(/open:nav:#\d+/);

      clearScopeOpenPathIndex("scope-a");

      const navCtxA = createCallbackContext(callbackA);
      const resultA = await handleOpenCallback(navCtxA);
      expect(resultA).toBe(false);

      mocked.scanDirectoryMock.mockResolvedValue(makeScanResult([], longPathB));
      const navCtxB = createCallbackContext(callbackB);
      const resultB = await handleOpenCallback(navCtxB);
      expect(resultB).toBe(true);
      expect(mocked.scanDirectoryMock).toHaveBeenCalledWith(longPathB, 0);
    });
  });
});
