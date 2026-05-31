import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const mocked = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn((options: unknown) => ({
    options,
    marker: Symbol("client"),
    global: { health: vi.fn().mockResolvedValue({ data: { healthy: true }, error: null }) },
  })),
  ensureRuntimeMock: vi.fn().mockResolvedValue({ success: true }),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: mocked.createOpencodeClientMock,
}));

vi.mock("../../src/process/manager.js", () => ({
  processManager: {
    ensureRuntime: mocked.ensureRuntimeMock,
  },
}));

import {
  __resetOpencodeClientRegistryForTests,
  getOpencodeClientForCurrentScope,
  opencodeClient,
} from "../../src/opencode/client.js";
import { __resetSettingsForTests, setTenantRuntimeInfo } from "../../src/settings/manager.js";

describe("opencode/client", () => {
  beforeEach(async () => {
    __resetOpencodeClientRegistryForTests();
    await __resetSettingsForTests();
    mocked.createOpencodeClientMock.mockClear();
    mocked.ensureRuntimeMock.mockClear();
    mocked.ensureRuntimeMock.mockResolvedValue({ success: true });
  });

  it("reuses the same client inside one telegram scope", () => {
    const scope = { userId: 1, chatId: 100, messageThreadId: 10 };

    const [clientA, clientB] = runWithTelegramConversationScope(scope, () => [
      getOpencodeClientForCurrentScope(),
      getOpencodeClientForCurrentScope(),
    ]);

    expect(clientA).toBe(clientB);
    expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(1);
  });

  it("creates separate clients for different runtime base urls", async () => {
    const scopeA = { userId: 1, chatId: 100, messageThreadId: 10 };
    const scopeB = { userId: 2, chatId: 100, messageThreadId: 10 };

    await setTenantRuntimeInfo(1, {
      userId: 1,
      chatId: 100,
      tenantId: "tg-1",
      baseUrl: "http://127.0.0.1:4101",
    });
    await setTenantRuntimeInfo(2, {
      userId: 2,
      chatId: 100,
      tenantId: "tg-2",
      baseUrl: "http://127.0.0.1:4102",
    });

    const clientA = runWithTelegramConversationScope(scopeA, () => getOpencodeClientForCurrentScope());
    const clientB = runWithTelegramConversationScope(scopeB, () => getOpencodeClientForCurrentScope());

    expect(clientA).not.toBe(clientB);
    expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(2);
  });

  it("routes proxy calls through the active telegram scope", async () => {
    const scopeA = { userId: 1, chatId: 100, messageThreadId: 10 };
    const scopeB = { userId: 2, chatId: 100, messageThreadId: 10 };

    await setTenantRuntimeInfo(1, {
      userId: 1,
      chatId: 100,
      tenantId: "tg-1",
      baseUrl: "http://127.0.0.1:4101",
    });
    await setTenantRuntimeInfo(2, {
      userId: 2,
      chatId: 100,
      tenantId: "tg-2",
      baseUrl: "http://127.0.0.1:4102",
    });

    await runWithTelegramConversationScope(scopeA, () => opencodeClient.global.health());
    await runWithTelegramConversationScope(scopeB, () => opencodeClient.global.health());

    expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(2);
    expect(mocked.createOpencodeClientMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ baseUrl: "http://127.0.0.1:4101" }),
    );
    expect(mocked.createOpencodeClientMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ baseUrl: "http://127.0.0.1:4102" }),
    );
  });
});
