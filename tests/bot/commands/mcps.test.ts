import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Context } from "grammy";
import {
  buildMcpServerDetailText,
  buildMcpServerListText,
  handleMcpsCallback,
  mcpsCommand,
} from "../../../src/bot/commands/mcps.js";
import { interactionManager } from "../../../src/interaction/manager.js";
import { t } from "../../../src/i18n/index.js";

const mocked = vi.hoisted(() => ({
  currentProject: {
    id: "project-1",
    worktree: "D:\\Projects\\Repo",
  } as { id: string; worktree: string } | null,
  mcpStatusMock: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getCurrentProject: vi.fn(() => mocked.currentProject),
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    mcp: {
      status: mocked.mcpStatusMock,
    },
  },
}));

function createCommandContext(messageId: number, messageThreadId?: number): Context {
  return {
    chat: { id: 777 },
    message:
      typeof messageThreadId === "number"
        ? ({ message_id: 50, message_thread_id: messageThreadId } as Context["message"])
        : undefined,
    reply: vi.fn().mockResolvedValue({ message_id: messageId }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

function createCallbackContext(data: string, messageId: number, messageThreadId?: number): Context {
  return {
    chat: { id: 777 },
    callbackQuery: {
      data,
      message: {
        message_id: messageId,
        ...(typeof messageThreadId === "number" ? { message_thread_id: messageThreadId } : {}),
      },
    } as Context["callbackQuery"],
    reply: vi.fn().mockResolvedValue({ message_id: 901 }),
    answerCallbackQuery: vi.fn().mockResolvedValue(undefined),
    deleteMessage: vi.fn().mockResolvedValue(undefined),
    editMessageText: vi.fn().mockResolvedValue(undefined),
  } as unknown as Context;
}

describe("bot/commands/mcps", () => {
  beforeEach(() => {
    interactionManager.clear("test_setup");
    mocked.currentProject = {
      id: "project-1",
      worktree: "D:\\Projects\\Repo",
    };
    mocked.mcpStatusMock.mockReset();
  });

  it("renders MCP servers with connection state", () => {
    expect(
      buildMcpServerListText([
        { id: "github", name: "GitHub", enabled: true, connected: true, status: "connected" },
        { id: "db", name: "Database", enabled: false, connected: false, status: "disabled" },
      ]),
    ).toContain("GitHub");
    expect(
      buildMcpServerListText([
        { id: "github", name: "GitHub", enabled: true, connected: true, status: "connected" },
      ]),
    ).toContain("connected");
  });

  it("renders MCP server details without leaking raw SDK payloads", () => {
    const text = buildMcpServerDetailText({
      id: "github",
      name: "GitHub",
      enabled: false,
      connected: false,
      status: "failed",
      command: "npx github-mcp",
      error: "needs auth",
      rawPayload: { secretToken: "do-not-render" },
      secretToken: "do-not-render",
    } as Parameters<typeof buildMcpServerDetailText>[0] & {
      rawPayload: { secretToken: string };
      secretToken: string;
    });

    expect(text).toContain("GitHub");
    expect(text).toContain("npx github-mcp");
    expect(text).toContain("disabled");
    expect(text).toContain("disconnected");
    expect(text).not.toContain("rawPayload");
    expect(text).not.toContain("secretToken");
    expect(text).not.toContain("do-not-render");
  });

  it("uses the existing project-not-selected reply in the active topic", async () => {
    mocked.currentProject = null;

    const ctx = createCommandContext(200, 42);
    await mcpsCommand(ctx as never);

    expect(ctx.reply).toHaveBeenCalledWith(t("bot.project_not_selected"), {
      message_thread_id: 42,
    });
  });

  it("shows MCP servers for the current thread project and starts custom interaction", async () => {
    mocked.mcpStatusMock.mockResolvedValue({
      data: {
        github: {
          status: "connected",
          type: "local",
          command: ["npx", "github-mcp"],
        },
        database: {
          status: "disabled",
          type: "remote",
          url: "https://example.test/mcp",
        },
      },
      error: null,
    });

    const ctx = createCommandContext(201, 42);
    await mcpsCommand(ctx as never);

    expect(mocked.mcpStatusMock).toHaveBeenCalledWith({ directory: "D:/Projects/Repo" });
    expect(ctx.reply).toHaveBeenCalledTimes(1);

    const [text, options] = (ctx.reply as ReturnType<typeof vi.fn>).mock.calls[0] as [
      string,
      { reply_markup: { inline_keyboard: Array<Array<{ callback_data?: string }>> }; message_thread_id?: number },
    ];

    expect(text).toContain("github");
    expect(options.message_thread_id).toBe(42);
    expect(options.reply_markup.inline_keyboard[0]?.[0]?.callback_data).toBe("mcps:select:0");
    expect(options.reply_markup.inline_keyboard[1]?.[0]?.callback_data).toBe("mcps:select:1");
    expect(options.reply_markup.inline_keyboard[2]?.[0]?.callback_data).toBe("mcps:cancel");

    const state = interactionManager.getSnapshot();
    expect(state?.kind).toBe("custom");
    expect(state?.expectedInput).toBe("callback");
    expect(state?.metadata.flow).toBe("mcps");
    expect(state?.metadata.stage).toBe("list");
    expect(state?.metadata.messageId).toBe(201);
  });

  it("transitions to detail view after selecting an MCP server", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 321,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [
          { id: "github", name: "github", enabled: true, connected: true, status: "connected" },
          { id: "db", name: "db", enabled: false, connected: false, status: "disabled" },
        ],
      },
    });

    const ctx = createCallbackContext("mcps:select:1", 321, 42);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      buildMcpServerDetailText({
        id: "db",
        name: "db",
        enabled: false,
        connected: false,
        status: "disabled",
      }),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("detail");
    expect(state?.metadata.selectedIndex).toBe(1);
  });

  it("returns from detail view to the list", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "detail",
        messageId: 322,
        projectDirectory: "D:\\Projects\\Repo",
        selectedIndex: 0,
        servers: [{ id: "github", name: "github", enabled: true, connected: true, status: "connected" }],
      },
    });

    const ctx = createCallbackContext("mcps:back", 322, 42);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.editMessageText).toHaveBeenCalledWith(
      buildMcpServerListText([
        { id: "github", name: "github", enabled: true, connected: true, status: "connected" },
      ]),
      expect.objectContaining({ reply_markup: expect.any(Object) }),
    );

    const state = interactionManager.getSnapshot();
    expect(state?.metadata.stage).toBe("list");
  });

  it("keeps callback validation replies scoped to the active topic", async () => {
    mocked.currentProject = null;
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 323,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [{ id: "github", name: "github", enabled: true, connected: true, status: "connected" }],
      },
    });

    const ctx = createCallbackContext("mcps:select:0", 323, 42);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.reply).toHaveBeenCalledWith(t("bot.project_not_selected"), {
      message_thread_id: 42,
    });
  });

  it("treats stale callbacks as inactive", async () => {
    interactionManager.start({
      kind: "custom",
      expectedInput: "callback",
      metadata: {
        flow: "mcps",
        stage: "list",
        messageId: 400,
        projectDirectory: "D:\\Projects\\Repo",
        servers: [{ id: "github", name: "github", enabled: true, connected: true, status: "connected" }],
      },
    });

    const ctx = createCallbackContext("mcps:cancel", 999, 42);
    const handled = await handleMcpsCallback(ctx);

    expect(handled).toBe(true);
    expect(ctx.answerCallbackQuery).toHaveBeenCalledWith({
      text: t("mcps.inactive_callback"),
      show_alert: true,
    });
  });
});
