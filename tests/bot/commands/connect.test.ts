import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";

vi.mock("../../../src/i18n/index.js", () => ({
  t: vi.fn((key: string) => key),
  getLocale: vi.fn(() => "en"),
  getDateLocale: vi.fn(() => "en-US"),
  SUPPORTED_LOCALES: ["en", "ru"],
  resolveSupportedLocale: vi.fn(() => "en"),
  normalizeLocale: vi.fn(() => "en"),
  getLocaleOptions: vi.fn(() => []),
  setLocaleOverride: vi.fn(),
  setUserLocaleResolver: vi.fn(),
}));

const mocked = vi.hoisted(() => ({
  currentProject: null as { id: string; worktree: string } | null,
  providerListMock: vi.fn(),
  providerAuthMock: vi.fn(),
  providerOauthAuthorizeMock: vi.fn(),
  providerOauthCallbackMock: vi.fn(),
  authSetMock: vi.fn(),
  currentOpencodeRoute: {
    runtimeKey: "host",
    baseUrl: "http://localhost:4096",
    kind: "host" as const,
  },
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    provider: {
      list: mocked.providerListMock,
      auth: mocked.providerAuthMock,
      oauth: {
        authorize: mocked.providerOauthAuthorizeMock,
        callback: mocked.providerOauthCallbackMock,
      },
    },
    auth: { set: mocked.authSetMock },
  },
  getCurrentOpencodeRoute: vi.fn(() => mocked.currentOpencodeRoute),
  getHostOpencodeClient: vi.fn(),
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    stop: vi.fn().mockResolvedValue(undefined),
    start: vi.fn().mockResolvedValue(undefined),
    restartTenantRuntimes: vi.fn().mockResolvedValue(undefined),
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/bot/handlers/inline-menu.js", () => ({
  clearActiveInlineMenu: vi.fn(),
}));

vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    bootstrapRemoteServer: vi.fn(),
    isSshActive: vi.fn(() => false),
    disconnect: vi.fn(),
    getLocalPort: vi.fn(),
    loadCredentials: vi.fn(),
  },
}));

vi.mock("node:child_process", () => ({ execSync: vi.fn() }));

async function fresh() {
  vi.resetModules();
  return await import("../../../src/bot/commands/connect.js");
}

function basicCtx(overrides: Partial<Context> = {}): Context {
  return {
    chat: { id: 777 },
    from: { id: 111, is_bot: false, first_name: "T" },
    message: { message_id: 42 } as any,
    reply: vi.fn().mockResolvedValue({ message_id: 100 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 200 }),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    } as any,
    ...overrides,
  } as unknown as Context;
}

function cbCtx(data: string, messageId = 50): Context {
  return {
    chat: { id: 777 },
    from: { id: 111, is_bot: false, first_name: "T" },
    callbackQuery: { data, message: { message_id: messageId } } as any,
    reply: vi.fn().mockResolvedValue({ message_id: 101 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    api: {
      sendMessage: vi.fn().mockResolvedValue({ message_id: 201 }),
      editMessageReplyMarkup: vi.fn().mockResolvedValue(undefined),
    } as any,
  } as unknown as Context;
}

describe("connectCommand", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.currentProject = { id: "p", worktree: "/tmp/p" };
  });

  it("shows providers", async () => {
    const { connectCommand } = await fresh();
    mocked.providerListMock.mockResolvedValue({ data: { all: [{ id: "x", name: "X" }] }, error: undefined });
    mocked.providerAuthMock.mockResolvedValue({ data: {}, error: undefined });
    const ctx = basicCtx();
    await connectCommand(ctx);
    expect((ctx.reply as any).mock.calls[0][0]).toBe("connect.select");
  });

  it("empty providers", async () => {
    const { connectCommand } = await fresh();
    mocked.providerListMock.mockResolvedValue({ data: { all: [] }, error: undefined });
    mocked.providerAuthMock.mockResolvedValue({ data: {}, error: undefined });
    const ctx = basicCtx();
    await connectCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("connect.empty");
  });

  it("error", async () => {
    const { connectCommand } = await fresh();
    mocked.providerListMock.mockRejectedValue(new Error("fail"));
    const ctx = basicCtx();
    await connectCommand(ctx);
    expect(ctx.reply).toHaveBeenCalledWith("connect.error");
  });
});

describe("handleProviderAuth", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.currentProject = { id: "p", worktree: "/tmp/p" };
  });

  it("API only → API key flow", async () => {
    const { handleProviderAuth } = await fresh();
    mocked.providerAuthMock.mockResolvedValue({ data: { azure: [{ type: "api", label: "K" }] }, error: undefined });
    const ctx = cbCtx("provider:auth:azure");
    await handleProviderAuth(ctx, "azure");
    expect(ctx.reply).toHaveBeenCalledWith("connect.enter_key");
  });

  it("OAuth only → URL + polling", async () => {
    const { handleProviderAuth } = await fresh();
    mocked.providerAuthMock.mockResolvedValue({ data: { openai: [{ type: "oauth", label: "B" }] }, error: undefined });
    mocked.providerOauthAuthorizeMock.mockResolvedValue({
      data: { url: "https://example.com/auth", method: "auto", instructions: "Enter code: 123" },
      error: undefined,
    });
    const ctx = cbCtx("provider:auth:openai");
    await handleProviderAuth(ctx, "openai");
    const calls = (ctx.reply as any).mock.calls.map((c: any[]) => c[0]);
    // Auth URL + instructions are combined in one message when instructions present
    expect(calls.some((c: string) => c.startsWith("connect.auth_url"))).toBe(true);
    expect(calls).toContain("connect.oauth_polling");
  });

  it("multiple methods → selection", async () => {
    const { handleProviderAuth } = await fresh();
    mocked.providerAuthMock.mockResolvedValue({
      data: { openai: [{ type: "oauth", label: "O" }, { type: "api", label: "K" }] },
      error: undefined,
    });
    const ctx = cbCtx("provider:auth:openai");
    await handleProviderAuth(ctx, "openai");
    expect((ctx.reply as any).mock.calls[0][0]).toBe("connect.choose_method");
  });
});

describe("handleProviderInput (API key only)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.currentProject = { id: "p", worktree: "/tmp/p" };
  });

  it("submits API key", async () => {
    const { handleProviderAuth, handleProviderInput } = await fresh();
    mocked.providerAuthMock.mockResolvedValue({ data: { azure: [{ type: "api", label: "K" }] }, error: undefined });
    await handleProviderAuth(cbCtx("provider:auth:azure"), "azure");

    mocked.authSetMock.mockResolvedValue({ data: true, error: undefined });
    const ctx = basicCtx();
    await handleProviderInput(ctx, "sk-key");
    expect(mocked.authSetMock).toHaveBeenCalledWith({
      providerID: "azure", directory: "/tmp/p", auth: { type: "api", key: "sk-key" },
    });
    expect(ctx.reply).toHaveBeenCalledWith("connect.authorized");
  });

  it("no prompt → ignored", async () => {
    const { handleProviderInput } = await fresh();
    const ctx = basicCtx();
    await handleProviderInput(ctx, "text");
    expect(mocked.authSetMock).not.toHaveBeenCalled();
  });

  it("OAuth parses code and responds immediately with oauth_checking", async () => {
    const { handleProviderAuth, handleProviderInput, isAnyProviderPrompt } = await fresh();
    mocked.providerAuthMock.mockResolvedValue({ data: { openai: [{ type: "oauth", label: "B" }] }, error: undefined });
    mocked.providerOauthAuthorizeMock.mockResolvedValue({
      data: { url: "https://example.com/auth", method: "auto" },
      error: undefined,
    });
    await handleProviderAuth(cbCtx("provider:auth:openai"), "openai");

    // Callback fires in background — respond immediately
    mocked.providerOauthCallbackMock.mockResolvedValue({ data: true, error: undefined });
    const ctx = basicCtx();
    await handleProviderInput(ctx, "http://localhost:1455/auth/callback?code=ABC123");

    // Immediate response
    expect(ctx.reply).toHaveBeenCalledWith("connect.oauth_checking");
    expect(isAnyProviderPrompt(111)).toBe(false);

    // Callback should be called in background
    await vi.waitFor(() => {
      expect(mocked.providerOauthCallbackMock).toHaveBeenCalled();
    });
  });
});

describe("isAnyProviderPrompt", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.currentProject = { id: "p", worktree: "/tmp/p" };
  });

  it("false by default", async () => {
    const { isAnyProviderPrompt } = await fresh();
    expect(isAnyProviderPrompt(999)).toBe(false);
  });

  it("true for API key, false after submission", async () => {
    const { handleProviderAuth, handleProviderInput, isAnyProviderPrompt } = await fresh();
    mocked.providerAuthMock.mockResolvedValue({ data: { azure: [{ type: "api", label: "K" }] }, error: undefined });
    await handleProviderAuth(cbCtx("provider:auth:azure"), "azure");
    expect(isAnyProviderPrompt(111)).toBe(true);

    mocked.authSetMock.mockResolvedValue({ data: true, error: undefined });
    await handleProviderInput(basicCtx(), "key");
    expect(isAnyProviderPrompt(111)).toBe(false);
  });
});
