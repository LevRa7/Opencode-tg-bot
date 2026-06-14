/**
 * Tests for handleTerminalTextInput — terminal text handler entry point.
 *
 * SUT: handleTerminalTextInput (to be added to src/bot/commands/terminal.ts)
 *
 * RED PHASE: These tests WILL fail because handleTerminalTextInput,
 * getPtySession, and setPtySession do NOT exist yet in terminal.ts.
 * This is the expected TDD RED state.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/* eslint-disable @typescript-eslint/no-explicit-any */

// ---------------------------------------------------------------------------
// types
// ---------------------------------------------------------------------------

interface PtyWriteMock {
  write: ReturnType<typeof vi.fn>;
}

interface TerminalTextCtx {
  reply: (text: string, extra?: any) => Promise<{ message_id: number }>;
  api: {
    editMessageText: (chatId: number, messageId: number, text: string, extra?: any) => Promise<any>;
    editForumTopic: (chatId: number, messageThreadId: number, opts: { name: string }) => Promise<any>;
  };
  chat: { id: number };
}

// ---------------------------------------------------------------------------
// hoisted mocks
// ---------------------------------------------------------------------------

const mocked = vi.hoisted(() => ({
  getPtySessionMock: vi.fn(),
  setPtySessionMock: vi.fn(),
  executeTerminalCommandMock: vi.fn(),
  isTerminalTopicMock: vi.fn(),
}));

// ---------------------------------------------------------------------------
// module mocks
// ---------------------------------------------------------------------------

vi.mock("../../src/bot/commands/terminal.js", async (importOriginal) => {
  const actual = await importOriginal<Record<string, unknown>>();
  return {
    ...actual,
    getPtySession: mocked.getPtySessionMock,
    setPtySession: mocked.setPtySessionMock,
    executeTerminalCommand: mocked.executeTerminalCommandMock,
    isTerminalTopic: mocked.isTerminalTopicMock,
  };
});

// ---------------------------------------------------------------------------
// SUT import — will be undefined until function is added to terminal.ts (RED)
// ---------------------------------------------------------------------------

import { handleTerminalTextInput as _raw } from "../../src/bot/commands/terminal.js";

const handleTerminalTextInput = _raw as unknown as (
  text: string,
  messageThreadId: number,
  userId: number,
  ctx: TerminalTextCtx,
) => Promise<boolean>;

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

const CHAT_ID = -1001234567890;
const TOPIC_ID = 5678;
const USER_ID = 9999;

function createTerminalCtx(overrides?: {
  chatId?: number;
  replyResolved?: unknown;
  editForumTopicResolved?: unknown;
}): TerminalTextCtx {
  return {
    chat: { id: overrides?.chatId ?? CHAT_ID },
    reply: vi.fn().mockResolvedValue(overrides?.replyResolved ?? { message_id: 1 }),
    api: {
      editMessageText: vi.fn().mockResolvedValue(true),
      editForumTopic: vi.fn().mockResolvedValue(overrides?.editForumTopicResolved ?? true),
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

async function call(
  text: string,
  topicId = TOPIC_ID,
  userId = USER_ID,
  ctx = createTerminalCtx(),
): Promise<boolean> {
  return handleTerminalTextInput(text, topicId, userId, ctx);
}

// ---------------------------------------------------------------------------
// tests
// ---------------------------------------------------------------------------

describe("handleTerminalTextInput", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.getPtySessionMock.mockReset();
    mocked.setPtySessionMock.mockReset();
    mocked.executeTerminalCommandMock.mockReset();
    mocked.isTerminalTopicMock.mockReset();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  // ── PTY path (session exists) ────────────────────────────────────────

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

    it("should rename the forum topic to the truncated command text", async () => {
      const ctx = createTerminalCtx();
      const cmd = "npm run build";

      await call(cmd, TOPIC_ID, USER_ID, ctx);

      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: cmd,
      });
    });

    it("should truncate forum topic name longer than 128 characters", async () => {
      const longCmd = "a".repeat(200);
      const expected = "a".repeat(125) + "...";
      const ctx = createTerminalCtx();

      await call(longCmd, TOPIC_ID, USER_ID, ctx);

      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: expected,
      });
    });

    it("should NOT truncate names of exactly 128 characters", async () => {
      const cmd128 = "x".repeat(128);
      const ctx = createTerminalCtx();

      await call(cmd128, TOPIC_ID, USER_ID, ctx);

      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: cmd128,
      });
    });

    it("should reply with a status message containing the command", async () => {
      const ctx = createTerminalCtx({ replyResolved: { message_id: 42 } });

      await call("git status", TOPIC_ID, USER_ID, ctx);

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

  // ── Fallback path (no PTY session) ───────────────────────────────────

  describe("Fallback path — getPtySession returns undefined/null", () => {
    it("should call executeTerminalCommand when getPtySession returns undefined", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });

      await call("echo fallback");

      expect(mocked.executeTerminalCommandMock).toHaveBeenCalledWith(
        "echo fallback",
        TOPIC_ID,
        expect.any(Function),
        USER_ID,
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
        USER_ID,
      );
    });

    it("should rename the forum topic in fallback path", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });
      const ctx = createTerminalCtx();

      await call("echo renamed", TOPIC_ID, USER_ID, ctx);

      expect(ctx.api.editForumTopic).toHaveBeenCalledWith(CHAT_ID, TOPIC_ID, {
        name: "echo renamed",
      });
    });

    it("should post a status message with the command", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });
      const ctx = createTerminalCtx({ replyResolved: { message_id: 99 } });

      await call("make build", TOPIC_ID, USER_ID, ctx);

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

  // ── Control characters ───────────────────────────────────────────────

  describe("control characters", () => {
    it("^C should send \\x03 to PTY and NOT call executeTerminalCommand", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);

      await call("^C");

      expect(pty.write).toHaveBeenCalledWith("\x03\n");
      expect(mocked.executeTerminalCommandMock).not.toHaveBeenCalled();
    });

    it("^D should send \\x04 to PTY and NOT call executeTerminalCommand", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);

      await call("^D");

      expect(pty.write).toHaveBeenCalledWith("\x04\n");
      expect(mocked.executeTerminalCommandMock).not.toHaveBeenCalled();
    });
  });

  // ── Error handling ───────────────────────────────────────────────────

  describe("error handling", () => {
    it("should handle PTY write failure gracefully without throwing", async () => {
      const pty = createPtySession(() => {
        throw new Error("PTY write failed: pipe broken");
      });
      mocked.getPtySessionMock.mockReturnValue(pty);

      await expect(
        call("echo boom", TOPIC_ID, USER_ID, createTerminalCtx()),
      ).resolves.not.toThrow();
    });

    it("should still write to PTY even if forum topic rename fails", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);
      const ctx = createTerminalCtx({
        editForumTopicResolved: Promise.reject(new Error("Telegram API error")),
      });

      await expect(call("ls", TOPIC_ID, USER_ID, ctx)).resolves.toBe(true);
      expect(pty.write).toHaveBeenCalledWith("ls\n");
    });

    it("should return true even when executeTerminalCommand rejects", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockRejectedValue(new Error("spawn failed"));

      await expect(
        call("bad-command", TOPIC_ID, USER_ID, createTerminalCtx()),
      ).resolves.toBe(true);
    });
  });

  // ── Edge cases ───────────────────────────────────────────────────────

  describe("edge cases", () => {
    it("should handle empty string command", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);

      await expect(
        call("", TOPIC_ID, USER_ID, createTerminalCtx()),
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

    it("should handle very long commands in PTY path", async () => {
      const pty = createPtySession();
      mocked.getPtySessionMock.mockReturnValue(pty);
      const cmd = "echo " + "x".repeat(4000);

      await call(cmd);

      expect(pty.write).toHaveBeenCalledWith(cmd + "\n");
    });
  });

  // ── Return value contract ────────────────────────────────────────────

  describe("return value contract", () => {
    it("should always return true on the PTY happy path", async () => {
      mocked.getPtySessionMock.mockReturnValue(createPtySession());

      const result = await call("echo x");

      expect(result).toBe(true);
    });

    it("should always return true on the spawn happy path", async () => {
      mocked.getPtySessionMock.mockReturnValue(undefined);
      mocked.executeTerminalCommandMock.mockResolvedValue({ code: 0 });

      const result = await call("echo x");

      expect(result).toBe(true);
    });
  });
});
