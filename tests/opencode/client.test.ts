import { beforeEach, describe, expect, it, vi } from "vitest";
import { runWithTelegramConversationScope } from "../../src/telegram/scope.js";

const mocked = vi.hoisted(() => ({
  createOpencodeClientMock: vi.fn((options: unknown) => ({
    options,
    marker: Symbol("client"),
    global: { health: vi.fn() },
  })),
}));

vi.mock("@opencode-ai/sdk/v2", () => ({
  createOpencodeClient: mocked.createOpencodeClientMock,
}));

import {
  __resetOpencodeClientRegistryForTests,
  getOpencodeClient,
  opencodeClient,
} from "../../src/opencode/client.js";

describe("opencode/client", () => {
  beforeEach(() => {
    __resetOpencodeClientRegistryForTests();
    mocked.createOpencodeClientMock.mockClear();
  });

  it("reuses the same client inside one telegram scope", () => {
    const scope = { userId: 1, chatId: 100, messageThreadId: 10 };

    const [clientA, clientB] = runWithTelegramConversationScope(scope, () => [
      getOpencodeClient(),
      getOpencodeClient(),
    ]);

    expect(clientA).toBe(clientB);
    expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(1);
  });

  it("creates separate clients for different telegram scopes", () => {
    const scopeA = { userId: 1, chatId: 100, messageThreadId: 10 };
    const scopeB = { userId: 2, chatId: 100, messageThreadId: 10 };

    const clientA = runWithTelegramConversationScope(scopeA, () => getOpencodeClient());
    const clientB = runWithTelegramConversationScope(scopeB, () => getOpencodeClient());

    expect(clientA).not.toBe(clientB);
    expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(2);
  });

  it("routes proxy access through the active telegram scope", () => {
    const scopeA = { userId: 1, chatId: 100, messageThreadId: 10 };
    const scopeB = { userId: 2, chatId: 100, messageThreadId: 10 };

    const clientAMarker = runWithTelegramConversationScope(
      scopeA,
      () => (opencodeClient as unknown as { marker: symbol }).marker,
    );
    const clientBMarker = runWithTelegramConversationScope(
      scopeB,
      () => (opencodeClient as unknown as { marker: symbol }).marker,
    );

    expect(clientAMarker).not.toBe(clientBMarker);
    expect(mocked.createOpencodeClientMock).toHaveBeenCalledTimes(2);
  });
});
