import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  configMock,
  providersMock,
  runtimeKeyState,
  getCurrentModelMock,
  setCurrentModelMock,
  setCurrentModelState,
  getCurrentModelState,
  resetCurrentModelState,
  loggerInfoMock,
  loggerWarnMock,
  loggerErrorMock,
  loggerDebugMock,
} = vi.hoisted(() => {
  let currentModel: { providerID: string; modelID: string; variant?: string } | undefined;
  const runtimeKeyState = { value: "host" };

  const getCurrentModelMock = vi.fn(() => currentModel);
  const setCurrentModelMock = vi.fn(
    (modelInfo: { providerID: string; modelID: string; variant?: string }) => {
      currentModel = modelInfo;
    },
  );

  return {
    configMock: {
      opencode: {
        model: {
          provider: "opencode",
          modelId: "big-pickle",
        },
      },
    },
    providersMock: vi.fn(),
    runtimeKeyState,
    getCurrentModelMock,
    setCurrentModelMock,
    setCurrentModelState: (modelInfo?: {
      providerID: string;
      modelID: string;
      variant?: string;
    }) => {
      currentModel = modelInfo;
    },
    getCurrentModelState: () => currentModel,
    resetCurrentModelState: () => {
      currentModel = undefined;
      getCurrentModelMock.mockClear();
      setCurrentModelMock.mockClear();
    },
    loggerInfoMock: vi.fn(),
    loggerWarnMock: vi.fn(),
    loggerErrorMock: vi.fn(),
    loggerDebugMock: vi.fn(),
  };
});

vi.mock("../../src/config.js", () => ({
  config: configMock,
}));

vi.mock("../../src/opencode/client.js", () => ({
  opencodeClient: {
    config: {
      providers: providersMock,
    },
  },
  getCurrentOpencodeRuntimeKey: vi.fn(() => runtimeKeyState.value),
}));

vi.mock("../../src/settings/manager.js", () => ({
  getOrCreateServerPassword: vi.fn(() => "test-pw-" + Math.random().toString(36).slice(2, 8)),
  getCurrentModel: getCurrentModelMock,
  setCurrentModel: setCurrentModelMock,
}));

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    info: loggerInfoMock,
    warn: loggerWarnMock,
    error: loggerErrorMock,
    debug: loggerDebugMock,
  },
}));

import {
  __resetModelCatalogCacheForTests,
  getRuntimeModelCatalog,
  reconcileStoredModelSelection,
} from "../../src/model/manager.js";

function createProvidersResponse(modelsByProvider: Record<string, string[]>) {
  return {
    data: {
      providers: Object.entries(modelsByProvider).map(([providerID, modelIDs]) => ({
        id: providerID,
        models: Object.fromEntries(modelIDs.map((modelID) => [modelID, { id: modelID }])),
      })),
    },
    error: null,
  };
}

describe("model/manager", () => {
  beforeEach(() => {
    vi.useRealTimers();
    resetCurrentModelState();
    __resetModelCatalogCacheForTests();

    runtimeKeyState.value = "host";
    loggerInfoMock.mockReset();
    loggerWarnMock.mockReset();
    loggerErrorMock.mockReset();
    loggerDebugMock.mockReset();

    providersMock.mockReset();
    providersMock.mockResolvedValue(
      createProvidersResponse({
        openai: ["gpt-4o", "gpt-4.1"],
        anthropic: ["claude-sonnet"],
        opencode: ["big-pickle"],
      }),
    );
  });

  describe("getRuntimeModelCatalog", () => {
    it("returns sorted providers and models from the current runtime API", async () => {
      providersMock.mockResolvedValueOnce(
        createProvidersResponse({
          openai: ["gpt-4o", "gpt-4.1"],
          anthropic: ["claude-sonnet"],
        }),
      );

      const result = await getRuntimeModelCatalog();

      expect(result).toEqual({
        providers: [
          {
            providerID: "anthropic",
            models: [{ providerID: "anthropic", modelID: "claude-sonnet" }],
          },
          {
            providerID: "openai",
            models: [
              { providerID: "openai", modelID: "gpt-4.1" },
              { providerID: "openai", modelID: "gpt-4o" },
            ],
          },
        ],
      });
    });

    it("keeps separate caches for different runtime keys", async () => {
      runtimeKeyState.value = "host";
      providersMock.mockResolvedValueOnce(createProvidersResponse({ openai: ["gpt-4o"] }));
      const hostCatalog = await getRuntimeModelCatalog();

      runtimeKeyState.value = "tenant:42";
      providersMock.mockResolvedValueOnce(createProvidersResponse({ google: ["gemini-pro"] }));
      const tenantCatalog = await getRuntimeModelCatalog();

      expect(hostCatalog.providers).toEqual([
        {
          providerID: "openai",
          models: [{ providerID: "openai", modelID: "gpt-4o" }],
        },
      ]);
      expect(tenantCatalog.providers).toEqual([
        {
          providerID: "google",
          models: [{ providerID: "google", modelID: "gemini-pro" }],
        },
      ]);
      expect(providersMock).toHaveBeenCalledTimes(2);
    });

    it("falls back to stale cache when refresh fails for the same runtime", async () => {
      vi.useFakeTimers();
      const startTime = new Date("2026-01-01T00:00:00.000Z");
      vi.setSystemTime(startTime);

      providersMock.mockResolvedValueOnce(createProvidersResponse({ openai: ["gpt-4o"] }));
      const first = await getRuntimeModelCatalog();

      providersMock.mockResolvedValueOnce({ data: null, error: new Error("upstream unavailable") });
      vi.setSystemTime(new Date(startTime.getTime() + 11 * 60 * 1000));

      const second = await getRuntimeModelCatalog();

      expect(second).toEqual(first);
      expect(providersMock).toHaveBeenCalledTimes(2);
    });
  });

  describe("reconcileStoredModelSelection", () => {
    it("falls back to the env default when the stored model is unavailable", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "retired", variant: "high" });

      await reconcileStoredModelSelection();

      expect(getCurrentModelState()).toEqual({
        providerID: "opencode",
        modelID: "big-pickle",
        variant: "default",
      });
      expect(setCurrentModelMock).toHaveBeenCalledTimes(1);
    });

    it("keeps the stored model when it is still available", async () => {
      setCurrentModelState({ providerID: "openai", modelID: "gpt-4o", variant: "high" });

      await reconcileStoredModelSelection();

      expect(getCurrentModelState()).toEqual({
        providerID: "openai",
        modelID: "gpt-4o",
        variant: "high",
      });
      expect(setCurrentModelMock).not.toHaveBeenCalled();
    });

    it("keeps the stored model when both it and the env default are unavailable", async () => {
      providersMock.mockResolvedValueOnce(
        createProvidersResponse({
          openai: ["gpt-4o"],
          anthropic: ["claude-sonnet"],
        }),
      );
      setCurrentModelState({ providerID: "openai", modelID: "retired", variant: "high" });

      await reconcileStoredModelSelection();

      expect(getCurrentModelState()).toEqual({
        providerID: "openai",
        modelID: "retired",
        variant: "high",
      });
      expect(setCurrentModelMock).not.toHaveBeenCalled();
      expect(loggerWarnMock).toHaveBeenCalledWith(
        expect.stringContaining(
          "Stored model openai/retired is unavailable and env default model opencode/big-pickle is unavailable",
        ),
      );
    });
  });
});
