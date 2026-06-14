/**
 * RED-phase test file for terminal-agent (SSH pipe architecture).
 *
 * The module `src/vm/terminal-agent.ts` exists as a stub that throws
 * "Not implemented" for every exported function. These tests import the
 * real module (no module mock) and define the expected behavior.
 *
 * All tests will FAIL because the stubs throw — that is the expected
 * TDD RED state. Implement the functions to make these tests pass.
 *
 * Architecture: stateless module (one session at a time).
 *   createSession → spawns bash via node-pty, returns TerminalAgentSession
 *   getSession    → returns current session or null
 *   destroySession → kills PTY, clears state
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── hoisted mocks ──────────────────────────────────────────────────────────

const mocked = vi.hoisted(() => ({
  ptySpawnMock: vi.fn(),
  existsSyncMock: vi.fn(),
}));

// ── dependency mocks ───────────────────────────────────────────────────────

vi.mock("node-pty", () => ({
  spawn: mocked.ptySpawnMock,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  return {
    ...actual,
    existsSync: mocked.existsSyncMock,
  };
});

vi.mock("../../src/utils/logger.js", () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

// ── import from real module (no vi.mock for the module under test) ─────────

import {
  createSession,
  getSession,
  destroySession,
  type TerminalAgentSession,
} from "../../src/vm/terminal-agent.js";

// ── mock PTY factory ───────────────────────────────────────────────────────

function makeMockPty(overrides?: { pid?: number }) {
  const dataCallbacks: Array<(data: string) => void> = [];
  const exitCallbacks: Array<(code: number | null, signal?: string) => void> = [];

  const pty = {
    pid: overrides?.pid ?? Math.floor(Math.random() * 9000) + 1000,
    onData: vi.fn((cb: (data: string) => void) => {
      dataCallbacks.push(cb);
    }),
    onExit: vi.fn((cb: (code: number | null, signal?: string) => void) => {
      exitCallbacks.push(cb);
    }),
    write: vi.fn(),
    resize: vi.fn(),
    kill: vi.fn(),
    /** Trigger all registered onData callbacks — for test use only */
    _emitData(data: string) {
      for (const cb of dataCallbacks) cb(data);
    },
    /** Trigger all registered onExit callbacks — for test use only */
    _emitExit(code: number | null, signal?: string) {
      for (const cb of exitCallbacks) cb(code, signal);
    },
  };

  return pty;
}

// ── helpers ────────────────────────────────────────────────────────────────

function setupPty(pid?: number) {
  const pty = makeMockPty({ pid });
  mocked.ptySpawnMock.mockReturnValue(pty);
  return pty;
}

// ── setup / teardown ───────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  mocked.existsSyncMock.mockReturnValue(true);
  // Ensure clean state between tests — destroy any leftover session
  try {
    destroySession();
  } catch {
    // Stub throws — that's fine in RED phase
  }
});

afterEach(() => {
  try {
    destroySession();
  } catch {
    // Stub throws — that's fine in RED phase
  }
});

// ═══════════════════════════════════════════════════════════════════════════
// Tests
// ═══════════════════════════════════════════════════════════════════════════

describe("terminal-agent (SSH pipe)", () => {
  // ── 1. createSession ─────────────────────────────────────────────────

  describe("createSession", () => {
    it("should create PTY with bash and given dimensions", () => {
      const pty = setupPty(5001);

      const session = createSession({ sessionId: "sess-1", cols: 120, rows: 40 });

      expect(mocked.ptySpawnMock).toHaveBeenCalledWith("bash", [], {
        name: "xterm-256color",
        cols: 120,
        rows: 40,
        cwd: process.cwd(),
      });
      expect(session.id).toBe("sess-1");
      expect(session.pty).toBe(pty);
    });

    it("should default cols=80 rows=24 when not provided", () => {
      setupPty(5002);

      createSession({ sessionId: "sess-2" });

      expect(mocked.ptySpawnMock).toHaveBeenCalledWith("bash", [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: process.cwd(),
      });
    });

    it("should use cwd when provided", () => {
      setupPty(5003);

      createSession({ sessionId: "sess-3", cwd: "/workspace/project" });

      expect(mocked.ptySpawnMock).toHaveBeenCalledWith("bash", [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: "/workspace/project",
      });
    });

    it("should forward PTY onData to registered callback", () => {
      const pty = setupPty(5004);
      const session = createSession({ sessionId: "sess-4" });

      const onData = vi.fn();
      session.onData(onData);

      // Workaround: since the session.pty is the mock, we can call
      // _emitData directly. In a real implementation, the module
      // would wire node-pty onData → session callbacks.
      pty._emitData("hello from pty");

      expect(onData).toHaveBeenCalledWith("hello from pty");
    });

    it("should handle data writes to PTY stdin", () => {
      const pty = setupPty(5005);
      const session = createSession({ sessionId: "sess-5" });

      session.write("ls -la\n");

      expect(pty.write).toHaveBeenCalledWith("ls -la\n");
    });
  });

  // ── 2. getSession ────────────────────────────────────────────────────

  describe("getSession", () => {
    it("should return null when no session created", () => {
      // In RED phase this will throw "Not implemented" from the stub.
      // Once implemented, it should return null after cleanup.
      const sess = getSession();
      expect(sess).toBeNull();
    });

    it("should return session after createSession", () => {
      setupPty(6001);
      const session = createSession({ sessionId: "sess-6" });

      const retrieved = getSession();
      expect(retrieved).toBe(session);
    });

    it("should return null after destroySession", () => {
      setupPty(6002);
      createSession({ sessionId: "sess-7" });

      destroySession();

      const retrieved = getSession();
      expect(retrieved).toBeNull();
    });
  });

  // ── 3. destroySession ────────────────────────────────────────────────

  describe("destroySession", () => {
    it("should kill PTY process", () => {
      const pty = setupPty(7001);
      createSession({ sessionId: "sess-8" });

      destroySession();

      expect(pty.kill).toHaveBeenCalled();
    });

    it("should clear session reference", () => {
      setupPty(7002);
      createSession({ sessionId: "sess-9" });

      destroySession();

      expect(getSession()).toBeNull();
    });

    it("should be safe to call when no session (no-op)", () => {
      // No session exists — destroySession should not throw
      expect(() => destroySession()).not.toThrow();
    });
  });

  // ── 4. Session.onData ────────────────────────────────────────────────

  describe("Session.onData", () => {
    it("should register data callback and receive PTY output", () => {
      const pty = setupPty(8001);
      const session = createSession({ sessionId: "sess-10" });

      const received: string[] = [];
      session.onData((data) => received.push(data));

      pty._emitData("line 1\n");
      pty._emitData("line 2\n");

      expect(received).toEqual(["line 1\n", "line 2\n"]);
    });

    it("should support multiple callbacks", () => {
      const pty = setupPty(8002);
      const session = createSession({ sessionId: "sess-11" });

      const cb1 = vi.fn();
      const cb2 = vi.fn();
      session.onData(cb1);
      session.onData(cb2);

      pty._emitData("output");

      expect(cb1).toHaveBeenCalledWith("output");
      expect(cb2).toHaveBeenCalledWith("output");
    });
  });

  // ── 5. Session.onExit ────────────────────────────────────────────────

  describe("Session.onExit", () => {
    it("should register exit callback and receive exit code", () => {
      const pty = setupPty(9001);
      const session = createSession({ sessionId: "sess-12" });

      const onExit = vi.fn();
      session.onExit(onExit);

      pty._emitExit(0);

      expect(onExit).toHaveBeenCalledWith(0, undefined);
    });

    it("should receive null exit code on signal", () => {
      const pty = setupPty(9002);
      const session = createSession({ sessionId: "sess-13" });

      const onExit = vi.fn();
      session.onExit(onExit);

      pty._emitExit(null, "SIGKILL");

      expect(onExit).toHaveBeenCalledWith(null, "SIGKILL");
    });
  });

  // ── 6. Session.write ─────────────────────────────────────────────────

  describe("Session.write", () => {
    it("should write data to PTY process", () => {
      const pty = setupPty(10001);
      const session = createSession({ sessionId: "sess-14" });

      session.write("echo hello\n");

      expect(pty.write).toHaveBeenCalledWith("echo hello\n");
    });
  });

  // ── 7. Session.kill ──────────────────────────────────────────────────

  describe("Session.kill", () => {
    it("should kill with given signal", () => {
      const pty = setupPty(11001);
      const session = createSession({ sessionId: "sess-15" });

      session.kill("SIGINT");

      expect(pty.kill).toHaveBeenCalledWith("SIGINT");
    });

    it("should default to SIGTERM", () => {
      const pty = setupPty(11002);
      const session = createSession({ sessionId: "sess-16" });

      session.kill();

      expect(pty.kill).toHaveBeenCalledWith("SIGTERM");
    });
  });

  // ── 8. Session.resize ────────────────────────────────────────────────

  describe("Session.resize", () => {
    it("should resize PTY to new cols/rows", () => {
      const pty = setupPty(12001);
      const session = createSession({ sessionId: "sess-17" });

      session.resize(160, 50);

      expect(pty.resize).toHaveBeenCalledWith(160, 50);
    });
  });
});
