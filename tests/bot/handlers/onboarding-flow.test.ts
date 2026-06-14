import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  setUserDeployTargetMock: vi.fn(),
  setUserVmSpecTierMock: vi.fn(),
  getVmRuntimeInfoMock: vi.fn(),
  setUserLocaleMock: vi.fn(),
  ensureRuntimeMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  setUserDeployTarget: mocked.setUserDeployTargetMock,
  setUserVmSpecTier: mocked.setUserVmSpecTierMock,
  getVmRuntimeInfo: mocked.getVmRuntimeInfoMock,
  setUserLocale: mocked.setUserLocaleMock,
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    ensureRuntime: mocked.ensureRuntimeMock,
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 6931112349 },
    opencode: { apiUrl: "http://localhost:4096", password: "pass", username: "opencode" },
    server: { logLevel: "info" },
  },
}));

import {
  handleOnboardingCallback,
  showDeployTargetSelection,
  showLanguageSelection,
} from "../../../src/bot/handlers/onboarding-flow.js";

function mockCtx(overrides: Partial<any> = {}): any {
  return {
    from: { id: 123, username: "test" },
    reply: vi.fn(),
    editMessageText: vi.fn(),
    answerCallbackQuery: vi.fn(),
    ...overrides,
  };
}

describe("onboarding-flow", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("showLanguageSelection", () => {
    it("should send language selection keyboard", async () => {
      const ctx = mockCtx();

      await showLanguageSelection(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const [text, options] = ctx.reply.mock.calls[0];
      expect(text).toContain("Choose language:");
      expect(options.reply_markup.inline_keyboard).toHaveLength(6);
      expect(options.reply_markup.inline_keyboard[0][0].text).toBe("🇬🇧 English");
      expect(options.reply_markup.inline_keyboard[0][0].callback_data).toBe("onboarding:lang:en");
      expect(options.reply_markup.inline_keyboard[1][0].text).toBe("🇩🇪 Deutsch");
      expect(options.reply_markup.inline_keyboard[5][0].text).toContain("中文");
    });
  });

  describe("showDeployTargetSelection", () => {
    it("should send deploy target selection with VM tiers and Docker", async () => {
      const ctx = mockCtx();

      await showDeployTargetSelection(ctx);

      expect(ctx.reply).toHaveBeenCalledTimes(1);
      const [text, options] = ctx.reply.mock.calls[0];
      expect(text).toBe("Select server configuration:");
      const keyboard = options.reply_markup.inline_keyboard;
      // 4 VM tiers + 1 Docker row = 5 rows (6 for admin)
      expect(keyboard.length).toBeGreaterThanOrEqual(5);
      // Check VM tier callbacks
      expect(keyboard[0][0].callback_data).toBe("onboarding:vm:small");
      expect(keyboard[1][0].callback_data).toBe("onboarding:vm:medium");
      expect(keyboard[2][0].callback_data).toBe("onboarding:vm:large");
      expect(keyboard[3][0].callback_data).toBe("onboarding:vm:xlarge");
      // Check Docker callback (last row)
      const lastRow = keyboard[keyboard.length - 1];
      expect(lastRow[0].callback_data).toBe("onboarding:docker");
      expect(lastRow[0].text).toContain("Docker");
    });

    it("should include Host option for admin", async () => {
      const ctx = mockCtx({ from: { id: 6931112349, username: "admin" } });

      await showDeployTargetSelection(ctx);

      const [, options] = ctx.reply.mock.calls[0];
      const keyboard = options.reply_markup.inline_keyboard;
      // Admin gets 4 VM + 1 Host + 1 Docker = 6 rows
      expect(keyboard).toHaveLength(6);
      expect(keyboard[4][0].callback_data).toBe("onboarding:host");
      expect(keyboard[4][0].text).toContain("Host");
      expect(keyboard[5][0].callback_data).toBe("onboarding:docker");
    });
  });

  describe("handleOnboardingCallback", () => {
    it("should return false for non-matching data", async () => {
      const ctx = mockCtx({ callbackQuery: { data: "something:else" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(false);
    });

    it("should return false when callbackQuery data is undefined", async () => {
      const ctx = mockCtx();

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(false);
    });

    it("should return false when ctx.from is undefined", async () => {
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:lang:ru" }, from: undefined });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(false);
    });

    it("should handle language selection (ru) and proceed to deploy target", async () => {
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:lang:ru" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserLocaleMock).toHaveBeenCalledWith("ru");
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith("✅ 🇷🇺 Русский");
      // After language selection, should show deploy target selection
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle language selection (en) and proceed to deploy target", async () => {
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:lang:en" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserLocaleMock).toHaveBeenCalledWith("en");
      expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({ text: "English" });
      expect(ctx.editMessageText).toHaveBeenCalledWith("✅ 🇬🇧 English");
      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should handle Docker selection successfully", async () => {
      mocked.ensureRuntimeMock.mockResolvedValue({ success: true });
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:docker" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserDeployTargetMock).toHaveBeenCalledWith(123, "docker");
      expect(ctx.answerCallbackQuery).toHaveBeenCalled();
      expect(ctx.editMessageText).toHaveBeenCalledWith("✅ Docker. Creating container...");
      expect(mocked.ensureRuntimeMock).toHaveBeenCalled();
    });

    it("should handle Docker selection with error", async () => {
      mocked.ensureRuntimeMock.mockResolvedValue({ success: false, error: "Docker failed" });
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:docker" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserDeployTargetMock).toHaveBeenCalledWith(123, "docker");
      expect(ctx.reply).toHaveBeenCalledWith("❌ Error: Docker failed");
    });

    it("should handle VM tier selection successfully", async () => {
      mocked.ensureRuntimeMock.mockResolvedValue({ success: true });
      mocked.getVmRuntimeInfoMock.mockReturnValue({
        baseUrl: "http://192.168.1.100:4096",
      });
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:vm:small" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserDeployTargetMock).toHaveBeenCalledWith(123, "vm");
      expect(mocked.setUserVmSpecTierMock).toHaveBeenCalledWith(123, "small");
      expect(ctx.editMessageText).toHaveBeenCalled();
      const editCall = ctx.editMessageText.mock.calls[0][0];
      expect(editCall).toContain("Basic");
      expect(editCall).toContain("4GB");
      expect(mocked.ensureRuntimeMock).toHaveBeenCalled();
    });

    it("should handle VM tier selection with error", async () => {
      mocked.ensureRuntimeMock.mockResolvedValue({ success: false, error: "VM creation failed" });
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:vm:medium" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserDeployTargetMock).toHaveBeenCalledWith(123, "vm");
      expect(mocked.setUserVmSpecTierMock).toHaveBeenCalledWith(123, "medium");
      expect(ctx.reply).toHaveBeenCalledWith("❌ Error: VM creation failed");
    });

    it("should return false for unknown VM tier", async () => {
      const ctx = mockCtx({ callbackQuery: { data: "onboarding:vm:unknown" } });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(false);
    });

    it("should handle Host selection for admin", async () => {
      const ctx = mockCtx({
        from: { id: 6931112349 },
        callbackQuery: { data: "onboarding:host" },
      });

      const result = await handleOnboardingCallback(ctx);

      expect(result).toBe(true);
      expect(mocked.setUserDeployTargetMock).toHaveBeenCalledWith(6931112349, "docker");
      expect(ctx.editMessageText).toHaveBeenCalledWith("✅ Docker. Creating container...");
    });
  });
});
