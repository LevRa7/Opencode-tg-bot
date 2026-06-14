/**
 * Tests for handleTerminalTextInput — the extracted terminal text handler
 * that dispatches between PTY (persistent shell) and stateless spawn paths.
 *
 * SUT: handleTerminalTextInput (to be added to src/bot/commands/terminal.ts)
 *
 * Design note: The function encapsulates the terminal text handling logic
 * currently embedded in index.ts lines 4752–4804, extended with a PTY
 * fast-path. Extracting it makes the logic testable and allows adding
 * getPtySession / setPtySession without touching index.ts directly.
 *
 * Expected API (exports to add to terminal.ts):
 *
 *   async function handleTerminalTextInput(
 *     text: string,
 *     messageThreadId: number,
 *     ctx: TerminalTextContext,
 *   ): Promise<boolean>;
 *
 * RED PHASE: These tests WILL fail because handleTerminalTextInput does
 * not exist yet in terminal.ts. That is the expected TDD RED state —
 * implement the function to make these tests pass.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- types -----------------------------------------------------

interface PtyWriteMock {
  write: ReturnType<typeof vi.fn>;
}

/* eslint-disable @typescript-eslint/no-explicit-any */

// --- hoisted mocks ----------------------------------------------

const mocked = vi.hoisted(() => ({
  getPtySessionMock: vi.fn(),
  executeTerminalCommandMock: vi.fn(),
  stripMessageTagsMock: vi.fn((s: string) => s.trim()),
  keyboardManagerMock: {
    sendKeyboardUpdate: vi.fn().mockResolvedValue(undefined),
  },
}));

// --- module mocks -----------------------------------------------

vi.mock("../../src/bot/utils/strip-message-tags.js", () => ({
  stripMessageTags: mocked.stripMessageTagsMock,
}));

vi.mock("../../src/keyboard/manager.js", () => ({
  keyboardManager: mocked.keyboardManagerMock,
}));

// Partial mock of terminal.ts: replace getPtySession and
// executeTerminalCommand with test-controlled mocks, while keeping
// other exports (including handleTerminalTextInput) from the real module.
vi.mock("../../src/bot/commands/terminal.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getPtySession: mocked.getPtySessionMock,
    executeTerminalCommand: mocked.executeTerminalCommandMock,
  };
});

// --- SUT imports ------------------------------------------------
// handleTerminalTextInput comes from the real terminal module
// (via the vi.mock factory spread).  It will be undefined until
// the function is added to terminal.ts — this is the RED state.

import {
  handleTerminalTextInput as _raw,
  getPtySession as _getPtySession,
  setPtySession as _setPtySession,
} from "../../src/bot/commands/terminal.js";

// Typed convenience wrapper — throws clear error if not implemented yet.
const handleTerminalTextInput: (
  text: string,
  messageThreadId: number,
  ctx: TerminalTextCtx,
) => Promise<boolean> = _raw as any;

const getPtySession = _getPtySession as any as (id: number) => PtyWriteMock | undefined;
const setPtySession = _setPtySession as any as (id: number, s: PtyWriteMock) => void;

interface TerminalTextCtx {
  reply: (text: string, extra?: any) => Promise<{ message_id: number }>;
  api: {
    editMessageText: (
      chatId: number,
      messageId: number,
      text: string,
      extra?: any,
    ) => Promise<any>;
    editForumTopic: (
      chatId: number,
      messageThreadId: number,
      opts: { name: string },
    ) => Promise<any>;
  };
  chat: { id: number };
}

// --- helpers ----------------------------------------------------

const CHAT_ID = -1001234567890;
const TOPIC_ID = 5678;

function createTerminalCtx(overrides?: {
  chatId?: number;
  replyResolved?: unknown;
  editForumTopicResolved?: unknown;
}): TerminalTextCtx {
  return {
    chat: { id: overrides?.chatId ?? CHAT_ID },
    reply: vi.fn().mockResolvedValue(
      overrides?.replyResolved ?? { message_id: 1 },
    ),
    api: {
      editMessageText: vi.fn().mockResolvedValue(true),
      editForumTopic: vi
        .fn()
        .mockResolvedValue(overrides?.editForumTopicResolved ?? true),
    },
  };
}

function createPtySession(writeImpl?: (data: string) => void): PtyWriteMock {
  return {
    write: vi.fn((data: string) => {
      writeImpl?.(data);
    }),
  };
}

function call(
  text = "echo hello",
  topicId = TOPIC_ID,
  ctx = createTerminalCtx(),
): Promise<boolean> {
  return handleTerminalTextInput(text, topicId, ctx);
}

// --- tests ------------------------------------------------------

describe("handleTerminalTextInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPtySessionMock.mockReset();
    mocked.executeTerminalCommandMock.mockReset();
    mocked.stripMessageTagsMock.mockRestore();
    mocked.stripMessageTagsMock.mockImplementation((s: string) => s.trim());
  });

  afterEach(() => {
    mocked.stripMessageTagsMock.mockRestore();
  });

  // ── PTY path (session exists) ────────────────────────────────────

  describe("PTY path — getPtySession returns a session", () => {
    let pty: PtyWriteMock;

    beforeEach(() => {
      pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);
    });

    it("should write text to the PTY session with trailing newline", async () => {
      await call("ls -la");
      expect(mocked.getPtySessionMock).toHaveBeenCalledWith(TOPIC_ID);
      expect(pty.write).toHaveBeenCalledWith("ls -la\n");
    });

    it("should append \\n to the text before writing to PTY", async () => {
      await call("pwd");
      expect(pty.write).toHaveBeenCalledWith("pwd\n");
    });

    it("should edit the forum topic name to the cleaned command text", async () => {
      mocked.stripMessageTagsMock.mockReturnValue("npm run build");
      const ctx = createTerminalCtx();

      await call("npm run build", TOPIC_ID, ctx);

      expect(mocked.stripMessageTagsMock).toHaveBeenCalledWith("npm run build");
      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: "npm run build",
      });
    });

    it("should truncate forum topic name at 128 characters", async () => {
      const longCmd = "a".repeat(200);
      const expected = "a".repeat(125) + "...";
      mocked.stripMessageTagsMock.mockReturnValue(longCmd);
      const ctx = createTerminalCtx();

      await call(longCmd, TOPIC_ID, ctx);

      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: expected,
      });
    });

    it("should reply with an acknowledgement containing the command", async () => {
      const ctx = createTerminalCtx({ replyResolved: { message_id: 42 } });

      await call("git status", TOPIC_ID, ctx);

      expect(ctx.reply).toHaveBeenCalled();
      const replyArg = (ctx.reply as any).mock.calls[0]?.[0] ?? "";
      expect(replyArg).toContain("git status");
    });

    it("should NOT call executeTerminalCommand when PTY session exists", async () => {
      await call("whoami");
      expect(mocked.executeTerminalCommandMock).not.toHaveBeenCalled();
    });

    it("should return true when PTY session exists", async () => {
      const result = await call("echo ok");
      expect(result).toBe(true);
    });
  });

  // ── Fallback path (no PTY session) ───────────────────────────────

  describe("Fallback path — getPtySession returns undefined/null", () => {
    it("should call executeTerminalCommand when getPtySession returns undefined", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });

      await call("echo fallback");

      expect(mocked.executeTerminalCommandMock).toHaveBeenCalledWith(
        "echo fallback",
        TOPIC_ID,
        expect.any(Function),
        undefined,
      );
    });

    it("should call executeTerminalCommand when getPtySession returns null", async () => {
      mocked.getPtySessionMock.mockReturnValue(null);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });

      await call("echo null-case");

      expect(mocked.executeTerminalCommandMock).toHaveBeenCalledWith(
        "echo null-case",
        TOPIC_ID,
        expect.any(Function),
        undefined,
      );
    });

    it("should edit the forum topic name in fallback path", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });
      mocked.stripMessageTagsMock.mockReturnValue("echo renamed");
      const ctx = createTerminalCtx();

      await call("echo renamed", TOPIC_ID, ctx);

      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: "echo renamed",
      });
    });

    it("should post a status message with the command", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });
      const ctx = createTerminalCtx({ replyResolved: { message_id: 99 } });

      await call("make build", TOPIC_ID, ctx);

      expect(ctx.reply).toHaveBeenCalled();
    });

    it("should stream output via the onChunk callback", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      let capturedChunk: ((text: string) => void) | undefined;
      mocked.executeTerminalCommandMock.mockImplementation(
        (_cmd: string, _tid: number, onChunk: (text: string) => void) => {
          capturedChunk = onChunk;
          return Promise.resolve({ code: 0 });
        },
      );

      await call("make build");

      expect(capturedChunk).toBeDefined();
      expect(() => capturedChunk!("compiling...\n")).not.toThrow();
    });

    it("should return true for fallback path", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });

      const result = await call("ls");
      expect(result).toBe(true);
    });
  });

  // ── Error handling ───────────────────────────────────────────────

  describe("error handling", () => {
    it("should handle PTY write failure gracefully without throwing", async () => {
      const pty = createPtySession(() => {
        throw new Error("PTY write failed: pipe broken");
      });
      mocked.getPtySessionMock.mockReturnValue(pty);

      await expect(
        call("echo boom", TOPIC_ID, createTerminalCtx()),
      ).resolves.not.toThrow();
    });

    it("should still write to PTY even if forum topic rename fails", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);
      const ctx = createTerminalCtx({
        editForumTopicResolved: Promise.reject(new Error("API error")),
      });

      await expect(call("ls", TOPIC_ID, ctx)).resolves.toBe(true);
      expect(pty.write).toHaveBeenCalledWith("ls\n");
    });

    it("should return true even when executeTerminalCommand rejects", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockRejectedValue(
        new Error("spawn failed"),
      );

      await expect(
        call("bad-command", TOPIC_ID, createTerminalCtx()),
      ).resolves.toBe(true);
    });
  });

  // ── Edge cases ────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle empty string command", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);

      await expect(
        call("", TOPIC_ID, createTerminalCtx()),
      ).resolves.toBe(true);
    });

    it("should handle multiline commands in a single message", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);

      await call("line1\nline2\nline3");

      expect(pty.write).toHaveBeenCalledWith("line1\nline2\nline3\n");
    });

    it("should handle special characters in the command", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);
      const cmd = 'echo "hello world" && ls -la | grep file';

      await call(cmd);

      expect(pty.write).toHaveBeenCalledWith(cmd + "\n");
    });

    it("should handle very long commands", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);
      const cmd = "echo " + "x".repeat(4000);

      await call(cmd);

      expect(pty.write).toHaveBeenCalledWith(cmd + "\n");
    });
  });
});

// ── Forum topic rename contract ─────────────────────────────────

describe("forum topic rename behavior", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPtySessionMock.mockReturnValue(createPtySession());
    mocked.stripMessageTagsMock.mockRestore();
  });

  afterEach(() => {
    mocked.stripMessageTagsMock.mockRestore();
  });

  it("should rename forum topic to command text (PTY path)", async () => {
    mocked.stripMessageTagsMock.mockReturnValue("git diff HEAD");
    const ctx = createTerminalCtx();

    await handleTerminalTextInput("git diff HEAD", TOPIC_ID, ctx);

    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
      name: "git diff HEAD",
    });
  });

  it("should NOT truncate names of exactly 128 characters", async () => {
    const cmd128 = "x".repeat(128);
    mocked.stripMessageTagsMock.mockReturnValue(cmd128);
    const ctx = createTerminalCtx();

    await handleTerminalTextInput(cmd128, TOPIC_ID, ctx);

    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
      name: cmd128,
    });
  });

  it("should truncate names longer than 128 chars to 125 + '...'", async () => {
    const cmd129 = "x".repeat(129);
    mocked.stripMessageTagsMock.mockReturnValue(cmd129);
    const ctx = createTerminalCtx();

    await handleTerminalTextInput(cmd129, TOPIC_ID, ctx);

    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
      name: "x".repeat(125) + "...",
    });
  });

  it("should swallow rename errors and still write to PTY", async () => {
    const pty = createPtySession();
    mocked.getPtySessionMock.mockReturnValue(pty);
    const ctx = createTerminalCtx({
      editForumTopicResolved: Promise.reject(new Error("Bot blocked")),
    });

    await expect(
      handleTerminalTextInput("uptime", TOPIC_ID, ctx),
    ).resolves.toBe(true);
    expect(pty.write).toHaveBeenCalledWith("uptime\n");
  });

  it("should also rename in fallback (non-PTY) path", async () => {
    mocked.getPtySessionMock.mockReturnValue(undefined);
    mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });
    mocked.stripMessageTagsMock.mockReturnValue("npm test");
    const ctx = createTerminalCtx();

    await handleTerminalTextInput("npm test", TOPIC_ID, ctx);

    expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
      name: "npm test",
    });
  });
});

// ── Return value contract ───────────────────────────────────────

describe("handleTerminalTextInput return value", () => {
  it("should always return true on the PTY happy path", async () => {
    mocked.getPtySessionMock.mockReturnValue(createPtySession());

    const result = await handleTerminalTextInput(
      "echo x",
      TOPIC_ID,
      createTerminalCtx(),
    );

    expect(result).toBe(true);
  });

  it("should always return true on the spawn happy path", async () => {
    mocked.getPtySessionMock.mockReturnValue(undefined);
    mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });

    const result = await handleTerminalTextInput(
      "echo x",
      TOPIC_ID,
      createTerminalCtx(),
    );

    expect(result).toBe(true);
  });
});
