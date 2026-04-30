import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  showModelSelectionMenuMock: vi.fn(),
  getRuntimeModelCatalogMock: vi.fn(),
  selectModelMock: vi.fn(),
  bindModelToActiveContextMock: vi.fn(),
  keyboardInitializeMock: vi.fn(),
  keyboardUpdateModelMock: vi.fn(),
  keyboardUpdateContextMock: vi.fn(),
  refreshContextLimitMock: vi.fn(),
  getContextInfoMock: vi.fn(),
  getContextLimitMock: vi.fn(),
  getStoredAgentMock: vi.fn(),
  createMainKeyboardMock: vi.fn(),
  formatVariantForButtonMock: vi.fn(),
}));

vi.mock("../../../src/bot/handlers/model.js", () => ({
  showModelSelectionMenu: mocked.showModelSelectionMenuMock,
}));

vi.mock("../../../src/model/manager.js", () => ({
  getRuntimeModelCatalog: mocked.getRuntimeModelCatalogMock,
  selectModel: mocked.selectModelMock,
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    bindModelToActiveContext: mocked.bindModelToActiveContextMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: {
    initialize: mocked.keyboardInitializeMock,
    updateModel: mocked.keyboardUpdateModelMock,
    updateContext: mocked.keyboardUpdateContextMock,
  },
}));

vi.mock("../../../src/pinned/manager.js", () => ({
  pinnedMessageManager: {
    refreshContextLimit: mocked.refreshContextLimitMock,
    getContextInfo: mocked.getContextInfoMock,
    getContextLimit: mocked.getContextLimitMock,
  },
}));

vi.mock("../../../src/agent/manager.js", () => ({
  getStoredAgent: mocked.getStoredAgentMock,
}));

vi.mock("../../../src/bot/utils/keyboard.js", () => ({
  createMainKeyboard: mocked.createMainKeyboardMock,
}));

vi.mock("../../../src/variant/manager.js", () => ({
  formatVariantForButton: mocked.formatVariantForButtonMock,
}));

import { modelCommand } from "../../../src/bot/commands/model.js";

function createCommandContext(match: string): CommandContext<Context> {
  return {
    match,
    chat: { id: 123 },
    api: { sendMessage: vi.fn() },
    reply: vi.fn().mockResolvedValue({ message_id: 10 }),
  } as unknown as CommandContext<Context>;
}

describe("bot/commands/model", () => {
  beforeEach(() => {
    mocked.showModelSelectionMenuMock.mockReset().mockResolvedValue(undefined);
    mocked.getRuntimeModelCatalogMock.mockReset().mockResolvedValue({
      providers: [
        {
          providerID: "cliproxyapi",
          models: [{ providerID: "cliproxyapi", modelID: "gpt-5.5" }],
        },
      ],
    });
    mocked.selectModelMock.mockReset();
    mocked.bindModelToActiveContextMock.mockReset();
    mocked.keyboardInitializeMock.mockReset();
    mocked.keyboardUpdateModelMock.mockReset();
    mocked.keyboardUpdateContextMock.mockReset();
    mocked.refreshContextLimitMock.mockReset().mockResolvedValue(undefined);
    mocked.getContextInfoMock.mockReset().mockReturnValue({ tokensUsed: 42, tokensLimit: 1000 });
    mocked.getContextLimitMock.mockReset().mockReturnValue(1000);
    mocked.getStoredAgentMock.mockReset().mockReturnValue("build");
    mocked.createMainKeyboardMock.mockReset().mockReturnValue({ keyboard: "model" });
    mocked.formatVariantForButtonMock.mockReset().mockReturnValue("Default");
  });

  it("shows the model selection menu when no argument is provided", async () => {
    const ctx = createCommandContext("");

    await modelCommand(ctx);

    expect(mocked.showModelSelectionMenuMock).toHaveBeenCalledWith(ctx);
    expect(mocked.getRuntimeModelCatalogMock).not.toHaveBeenCalled();
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(ctx.reply).not.toHaveBeenCalled();
  });

  it("sets a known model as the user default and active thread model", async () => {
    const ctx = createCommandContext("cliproxyapi/gpt-5.5");
    const modelInfo = { providerID: "cliproxyapi", modelID: "gpt-5.5", variant: "default" };

    await modelCommand(ctx);

    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocked.selectModelMock).toHaveBeenCalledWith(modelInfo);
    expect(mocked.bindModelToActiveContextMock).toHaveBeenCalledWith(modelInfo);
    expect(mocked.keyboardInitializeMock).toHaveBeenCalledWith(ctx.api, 123);
    expect(mocked.keyboardUpdateModelMock).toHaveBeenCalledWith(modelInfo);
    expect(mocked.keyboardUpdateContextMock).toHaveBeenCalledWith(42, 1000);
    expect(mocked.createMainKeyboardMock).toHaveBeenCalledWith(
      "build",
      modelInfo,
      { tokensUsed: 42, tokensLimit: 1000 },
      "Default",
    );
    expect(ctx.reply).toHaveBeenCalledWith(t("model.command.changed", { name: "cliproxyapi / gpt-5.5" }), {
      reply_markup: { keyboard: "model" },
    });
  });

  it("replies with usage and changes nothing when the model format is invalid", async () => {
    const ctx = createCommandContext("cliproxyapi");

    await modelCommand(ctx);

    expect(ctx.reply).toHaveBeenCalledWith(t("model.command.usage"));
    expect(mocked.getRuntimeModelCatalogMock).not.toHaveBeenCalled();
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(mocked.bindModelToActiveContextMock).not.toHaveBeenCalled();
    expect(mocked.keyboardUpdateModelMock).not.toHaveBeenCalled();
  });

  it("replies with not found and changes nothing when the model is absent from the runtime catalog", async () => {
    const ctx = createCommandContext("cliproxyapi/unknown");

    await modelCommand(ctx);

    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(ctx.reply).toHaveBeenCalledWith(
      t("model.command.not_found", { name: "cliproxyapi/unknown" }),
    );
    expect(mocked.selectModelMock).not.toHaveBeenCalled();
    expect(mocked.bindModelToActiveContextMock).not.toHaveBeenCalled();
    expect(mocked.keyboardUpdateModelMock).not.toHaveBeenCalled();
  });
});
