import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CommandContext, Context } from "grammy";
import { t } from "../../../src/i18n/index.js";
import type { RuntimeModelCatalog } from "../../../src/model/types.js";

const mocked = vi.hoisted(() => ({
  getRuntimeModelCatalogMock: vi.fn(),
  providersMock: vi.fn(),
  loggerDebugMock: vi.fn(),
  loggerInfoMock: vi.fn(),
  loggerWarnMock: vi.fn(),
  loggerErrorMock: vi.fn(),
}));

vi.mock("../../../src/model/manager.js", () => ({
  getRuntimeModelCatalog: mocked.getRuntimeModelCatalogMock,
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: mocked.providersMock,
    },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: {
    debug: mocked.loggerDebugMock,
    info: mocked.loggerInfoMock,
    warn: mocked.loggerWarnMock,
    error: mocked.loggerErrorMock,
  },
}));

import { modelsCommand } from "../../../src/bot/commands/models.js";

function createCommandContext(): CommandContext<Context> {
  return {
    reply: vi.fn().mockResolvedValue(undefined),
  } as unknown as CommandContext<Context>;
}

function createCatalog(overrides?: Partial<RuntimeModelCatalog>): RuntimeModelCatalog {
  return {
    providers: [
      {
        providerID: "anthropic",
        models: [
          { providerID: "anthropic", modelID: "claude-sonnet-4" },
          { providerID: "anthropic", modelID: "claude-3.7" },
        ],
      },
      {
        providerID: "empty-provider",
        models: [],
      },
      {
        providerID: "openai",
        models: [{ providerID: "openai", modelID: "gpt-4.1" }],
      },
    ],
    ...overrides,
  };
}

function createLargeProvider(providerID: string, modelCount: number): RuntimeModelCatalog["providers"][number] {
  return {
    providerID,
    models: Array.from({ length: modelCount }, (_, index) => ({
      providerID,
      modelID: `${providerID}-model-${String(index + 1).padStart(3, "0")}-with-extra-length-for-chunking`,
    })),
  };
}

describe("bot/commands/models", () => {
  beforeEach(() => {
    mocked.getRuntimeModelCatalogMock.mockReset();
    mocked.providersMock.mockReset();
    mocked.loggerDebugMock.mockReset();
    mocked.loggerInfoMock.mockReset();
    mocked.loggerWarnMock.mockReset();
    mocked.loggerErrorMock.mockReset();
    mocked.providersMock.mockRejectedValue(
      new Error("/models should not query providers directly"),
    );
  });

  it("renders providers and models from the runtime-aware catalog", async () => {
    // Arrange: the command should render the manager catalog and keep the legacy text format.
    const ctx = createCommandContext();
    mocked.getRuntimeModelCatalogMock.mockResolvedValue(createCatalog());

    // Act: execute the command using only the runtime-aware catalog.
    await modelsCommand(ctx);

    // Assert: provider/model output comes from the catalog and never from direct provider queries.
    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocked.providersMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(
      "📋 Available models:\n\n" +
        "🔹 anthropic\n" +
        "  - claude-sonnet-4\n" +
        "  - claude-3.7\n\n" +
        "🔹 empty-provider\n" +
        "  ⚠️ No available models\n\n" +
        "🔹 openai\n" +
        "  - gpt-4.1\n\n" +
        t("legacy.models.env_hint") +
        "OPENCODE_MODEL_PROVIDER=<provider.id>\nOPENCODE_MODEL_ID=<model.id>",
    );
  });

  it("shows the empty-state message when the runtime catalog has no providers", async () => {
    // Arrange: an empty runtime-aware catalog should map to the existing empty-state reply.
    const ctx = createCommandContext();
    mocked.getRuntimeModelCatalogMock.mockResolvedValue({ providers: [] });

    // Act: execute the command with no providers available.
    await modelsCommand(ctx);

    // Assert: the command keeps the legacy empty-state and skips direct provider loading.
    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocked.providersMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("legacy.models.empty"));
  });

  it("shows the load-error message when the runtime catalog cannot be loaded", async () => {
    // Arrange: command failures should surface the existing load-error reply.
    const ctx = createCommandContext();
    mocked.getRuntimeModelCatalogMock.mockRejectedValueOnce(new Error("boom"));

    // Act: execute the command when the runtime-aware catalog load fails.
    await modelsCommand(ctx);

    // Assert: the command reports the legacy error-state and never falls back to direct queries.
    expect(mocked.getRuntimeModelCatalogMock).toHaveBeenCalledTimes(1);
    expect(mocked.providersMock).not.toHaveBeenCalled();
    expect(ctx.reply).toHaveBeenCalledWith(t("legacy.models.error"));
  });

  it("splits oversized runtime catalogs into multiple replies on provider boundaries", async () => {
    // Arrange: a large catalog should stay under Telegram's 4096-character message limit.
    const ctx = createCommandContext();
    mocked.getRuntimeModelCatalogMock.mockResolvedValue({
      providers: [createLargeProvider("provider-alpha", 55), createLargeProvider("provider-beta", 55)],
    });

    // Act: render a catalog that would overflow a single Telegram reply.
    await modelsCommand(ctx);

    // Assert: the command emits multiple bounded replies and keeps providers grouped when possible.
    expect(ctx.reply).toHaveBeenCalledTimes(2);

    const firstMessage = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const secondMessage = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as string;

    expect(firstMessage).toContain("🔹 provider-alpha\n");
    expect(firstMessage).not.toContain("🔹 provider-beta\n");
    expect(secondMessage).toContain("🔹 provider-beta\n");
    expect(firstMessage.length).toBeLessThanOrEqual(4096);
    expect(secondMessage.length).toBeLessThanOrEqual(4096);
    expect(firstMessage.startsWith(t("legacy.models.header"))).toBe(true);
    expect(secondMessage).toContain(t("legacy.models.env_hint"));
  });

  it("splits an oversized single-provider catalog on model-line boundaries", async () => {
    // Arrange: one provider can exceed Telegram's limit and still needs safe chunking.
    const ctx = createCommandContext();
    mocked.getRuntimeModelCatalogMock.mockResolvedValue({
      providers: [createLargeProvider("provider-solo", 120)],
    });

    // Act: render a single provider whose block is larger than one Telegram message.
    await modelsCommand(ctx);

    // Assert: the command keeps the provider header visible and splits only between model lines.
    expect(ctx.reply).toHaveBeenCalledTimes(2);

    const firstMessage = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as string;
    const secondMessage = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[1]?.[0] as string;

    expect(firstMessage).toContain("🔹 provider-solo\n");
    expect(secondMessage).toContain("🔹 provider-solo\n");
    expect(firstMessage.length).toBeLessThanOrEqual(4096);
    expect(secondMessage.length).toBeLessThanOrEqual(4096);
    expect(firstMessage).toContain("  - provider-solo-model-001-with-extra-length-for-chunking\n");
    expect(secondMessage).toContain("  - provider-solo-model-120-with-extra-length-for-chunking\n");
    expect(firstMessage).not.toContain("provider-solo-model-120-with-extra-length-for-chunking");
    expect(secondMessage).toContain(t("legacy.models.env_hint"));
  });
});
