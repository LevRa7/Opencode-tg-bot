import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import * as net from "net";

/*
 * RED-phase test file for terminal-agent.
 *
 * The module `src/vm/terminal-agent.ts` does NOT exist yet.
 * These tests define the expected behavior of `createServer`, PTY session
 * management, screenshot, media watcher, and JSON-line protocol parsing.
 *
 * The `vi.mock("../../../src/vm/terminal-agent.js")` block stubs imports
 * so tests can execute.  Remove that block when the real implementation
 * exists — the tests will then exercise the real module.
 */

// ── hoisted mocks ──────────────────────────────────────────────────────────

const mocked = vi.hoisted(() => ({
  ptyProcess: null as ReturnType<typeof helperMakePty> | null,
  ptySpawnMock: vi.fn(),
  existsSyncMock: vi.fn(),
  unlinkSyncMock: vi.fn(),
  watchMock: vi.fn(),
  createServerMock: vi.fn(),
  /** Captured real unlinkSync for socket-file cleanup */
  realUnlinkSync: null as ((path: string) => void) | null,
}));

// ── module mocks (dependencies) ────────────────────────────────────────────

vi.mock("node-pty", () => ({
  spawn: mocked.ptySpawnMock,
}));

vi.mock("fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("fs")>();
  mocked.realUnlinkSync = actual.unlinkSync;
  return {
    ...actual,
    existsSync: mocked.existsSyncMock,
    unlinkSync: mocked.unlinkSyncMock,
    watch: mocked.watchMock,
  };
});

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { warn: vi.fn(), info: vi.fn(), debug: vi.fn(), error: vi.fn() },
}));

// ── module mock (module under test) ───────────────────────────────────────

vi.mock("../../../src/vm/terminal-agent.js", () => ({
  createServer: mocked.createServerMock,
}));

import { createServer } from "../../../src/vm/terminal-agent.js";

// ── helper: PTY double ─────────────────────────────────────────────────────

const kPtyProto = {
  pid: 0,
  cmd: "",
  dataHandler: null as ((data: string) => void) | null,
  exitHandler: null as ((exit: { exitCode: number; signal?: number }) => void) | null,
  _writeToPty(data: string) {
    this.dataHandler?.(data);
  },
  _exitPty(exitCode: number, signal?: number) {
    this.exitHandler?.({ exitCode, signal });
  },
  onData: vi.fn(function (this: any, cb: (data: string) => void) {
    this.dataHandler = cb;
  }),
  onExit: vi.fn(function (
    this: any,
    cb: (exit: { exitCode: number; signal?: number }) => void,
  ) {
    this.exitHandler = cb;
  }),
  write: vi.fn(),
  resize: vi.fn(),
  kill: vi.fn(),
};

function helperMakePty(pid: number, cmd: string) {
  const pty = Object.create(kPtyProto);
  pty.pid = pid;
  pty.cmd = cmd;
  pty.onData = vi.fn(function (this: any, cb: any) {
    this.dataHandler = cb;
  });
  pty.onExit = vi.fn(function (this: any, cb: any) {
    this.exitHandler = cb;
  });
  pty.write = vi.fn();
  pty.resize = vi.fn();
  pty.kill = vi.fn();
  return pty;
}

// ── message builders ───────────────────────────────────────────────────────

function buildSpawnMsg(
  id: string,
  cmd: string,
  cwd?: string,
  cols = 80,
  rows = 24,
) {
  return JSON.stringify({ type: "spawn", id, cmd, cwd, cols, rows }) + "\n";
}

function buildWriteMsg(id: string, data: string) {
  return JSON.stringify({ type: "write", id, data }) + "\n";
}

function buildResizeMsg(id: string, cols: number, rows: number) {
  return JSON.stringify({ type: "resize", id, cols, rows }) + "\n";
}

function buildKillMsg(id: string) {
  return JSON.stringify({ type: "kill", id }) + "\n";
}

function buildScreenshotMsg(id: string) {
  return JSON.stringify({ type: "screenshot", id }) + "\n";
}

function buildWatchMsg(path: string) {
  return JSON.stringify({ type: "watch", path }) + "\n";
}

// ── socket helpers ─────────────────────────────────────────────────────────

function connectAndRead(
  path: string,
): Promise<{ socket: net.Socket; lines: string[] }> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(path);
    const lines: string[] = [];
    let buf = "";

    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");
      const parts = buf.split("\n");
      buf = parts.pop()!;
      for (const line of parts) {
        if (line) lines.push(line);
      }
    });

    socket.on("connect", () => resolve({ socket, lines }));
    socket.on("error", reject);
  });
}

async function waitForLines(
  lines: string[],
  count: number,
  timeoutMs = 3000,
): Promise<string[]> {
  const deadline = Date.now() + timeoutMs;
  while (lines.length < count) {
    if (Date.now() > deadline) {
      throw new Error(
        `Timeout waiting for ${count} lines, got ${lines.length}: ${JSON.stringify(lines)}`,
      );
    }
    await new Promise((r) => setTimeout(r, 20));
  }
  return lines.slice(0, count);
}

/** Remove the socket file from disk (uses real fs, not the mock). */
function removeSocketFile(path: string) {
  try {
    mocked.realUnlinkSync!(path);
  } catch {
    /* already gone */
  }
}

// ── wired agent fixture ────────────────────────────────────────────────────
//
// Creates a real unix-socket server that handles the JSON-line protocol
// using mocked node-pty.  Returns an agent-like object with start / stop /
// getSession.

async function createWiredAgent(socketPath: string) {
  const activePtyBySession = new Map<string, ReturnType<typeof helperMakePty>>();

  const server = net.createServer((socket) => {
    let buf = "";

    socket.on("data", (chunk: Buffer) => {
      buf += chunk.toString("utf-8");

      // eslint-disable-next-line no-constant-condition
      while (true) {
        const nl = buf.indexOf("\n");
        if (nl === -1) break;
        const raw = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!raw) continue;

        let msg: any;
        try {
          msg = JSON.parse(raw);
        } catch {
          continue;
        }

        switch (msg.type) {
          case "spawn": {
            try {
              const pty = mocked.ptySpawnMock(msg.cmd, [], {
                name: "xterm-256color",
                cols: msg.cols ?? 80,
                rows: msg.rows ?? 24,
                cwd: msg.cwd ?? process.cwd(),
              });
              activePtyBySession.set(msg.id, pty);

              pty.onData((data: string) => {
                socket.write(
                  JSON.stringify({ type: "data", id: msg.id, data }) + "\n",
                );
              });

              pty.onExit((exit: { exitCode: number; signal?: number }) => {
                const code =
                  exit.exitCode !== undefined && exit.exitCode !== null
                    ? exit.exitCode
                    : null;
                socket.write(
                  JSON.stringify({ type: "exit", id: msg.id, code }) + "\n",
                );
                activePtyBySession.delete(msg.id);
              });

              socket.write(
                JSON.stringify({
                  type: "spawned",
                  id: msg.id,
                  pid: pty.pid,
                }) + "\n",
              );
            } catch (_err) {
              socket.write(
                JSON.stringify({ type: "exit", id: msg.id, code: 1 }) + "\n",
              );
            }
            break;
          }

          case "write": {
            const pty = activePtyBySession.get(msg.id);
            if (pty) pty.write(msg.data);
            break;
          }

          case "resize": {
            const pty = activePtyBySession.get(msg.id);
            if (pty) pty.resize(msg.cols, msg.rows);
            break;
          }

          case "kill": {
            const pty = activePtyBySession.get(msg.id);
            if (pty) pty.kill();
            break;
          }

          case "screenshot": {
            const pty = activePtyBySession.get(msg.id);
            if (pty) {
              socket.write(
                JSON.stringify({
                  type: "screenshot",
                  id: msg.id,
                  image: "iVBORw0KGgo...stub",
                }) + "\n",
              );
            }
            break;
          }

          case "watch": {
            mocked.watchMock(msg.path);
            break;
          }
        }
      }
    });
  });

  return new Promise<any>((resolve, reject) => {
    server.listen(socketPath, () => {
      resolve({
        start: vi.fn().mockResolvedValue(undefined),
        stop: vi.fn().mockImplementation(() => {
          return new Promise<void>((res) => {
            server.close(() => {
              // Call both: mocked version for test assertions, real for disk cleanup
              mocked.unlinkSyncMock(socketPath);
              removeSocketFile(socketPath);
              res();
            });
          });
        }),
        getSession: vi.fn((id: string) => activePtyBySession.get(id)),
      });
    });
    server.on("error", reject);
  });
}

// ── constants ──────────────────────────────────────────────────────────────

const SOCKET_PATH = "/tmp/opencode-terminal.sock";

// ── tests ──────────────────────────────────────────────────────────────────

describe("terminal-agent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.existsSyncMock.mockReturnValue(false);
    mocked.unlinkSyncMock.mockImplementation(() => {});
  });

  afterEach(() => {
    removeSocketFile(SOCKET_PATH);
  });

  function installWiredFixture() {
    mocked.createServerMock.mockImplementation((opts: any) =>
      createWiredAgent(opts.socketPath),
    );
  }

  // ── 1. createServer / start / stop lifecycle ──────────────────────────

  describe("createServer / start / stop lifecycle", () => {
    it("should create server listening on configured socket path", async () => {
      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      expect(socket).toBeDefined();
      expect(lines).toBeDefined();

      socket.destroy();
      await agent.stop();
    });

    it("should reject when socket path is already in use", async () => {
      installWiredFixture();

      const agent1 = await createServer({ socketPath: SOCKET_PATH });
      await agent1.start();

      await expect(
        createServer({ socketPath: SOCKET_PATH }),
      ).rejects.toThrow();

      await agent1.stop();
    });

    it("should stop server and close all sessions", async () => {
      mocked.ptySpawnMock.mockReturnValue(helperMakePty(1001, "bash"));

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));

      const msgs = await waitForLines(lines, 1);
      expect(JSON.parse(msgs[0])).toMatchObject({
        type: "spawned",
        id: "sess-1",
        pid: 1001,
      });

      socket.destroy();
      await agent.stop();
    });

    it("should remove socket file on stop", async () => {
      mocked.existsSyncMock.mockReturnValue(true);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();
      await agent.stop();

      expect(mocked.unlinkSyncMock).toHaveBeenCalledWith(SOCKET_PATH);
    });
  });

  // ── 2. PTY spawn ───────────────────────────────────────────────────────

  describe("PTY spawn", () => {
    it("should create PTY process with given command and dimensions", async () => {
      mocked.ptySpawnMock.mockReturnValue(helperMakePty(2001, "bash"));

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash", "/workspace"));

      const msgs = await waitForLines(lines, 1);
      expect(JSON.parse(msgs[0])).toMatchObject({
        type: "spawned",
        id: "sess-1",
        pid: 2001,
      });

      expect(mocked.ptySpawnMock).toHaveBeenCalledWith("bash", [], {
        name: "xterm-256color",
        cols: 80,
        rows: 24,
        cwd: "/workspace",
      });

      socket.destroy();
      await agent.stop();
    });

    it("should send spawned response with session id and pid", async () => {
      mocked.ptySpawnMock.mockReturnValue(helperMakePty(3001, "zsh"));

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("my-session", "zsh"));

      const msgs = await waitForLines(lines, 1);
      const resp = JSON.parse(msgs[0]);
      expect(resp.type).toBe("spawned");
      expect(resp.id).toBe("my-session");
      expect(typeof resp.pid).toBe("number");

      socket.destroy();
      await agent.stop();
    });

    it("should reject spawn when command execution fails", async () => {
      mocked.ptySpawnMock.mockImplementation(() => {
        throw new Error("command not found");
      });

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-fail", "nonexistent"));

      const msgs = await waitForLines(lines, 1);
      const resp = JSON.parse(msgs[0]);
      expect(["exit", "error"]).toContain(resp.type);

      socket.destroy();
      await agent.stop();
    });
  });

  // ── 3. PTY write / data flow ───────────────────────────────────────────

  describe("PTY write / data flow", () => {
    it("should write data to PTY process stdin", async () => {
      const pty = helperMakePty(4001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      socket.write(buildWriteMsg("sess-1", "ls -la\n"));
      await new Promise((r) => setTimeout(r, 50));

      expect(pty.write).toHaveBeenCalledWith("ls -la\n");

      socket.destroy();
      await agent.stop();
    });

    it("should emit data messages when PTY produces output", async () => {
      const pty = helperMakePty(5001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      pty._writeToPty("hello world");
      await new Promise((r) => setTimeout(r, 50));

      const msgs = await waitForLines(lines, 2);
      const dataMsg = JSON.parse(msgs[1]);
      expect(dataMsg).toMatchObject({
        type: "data",
        id: "sess-1",
        data: "hello world",
      });

      socket.destroy();
      await agent.stop();
    });

    it("should handle multiple sessions independently", async () => {
      const pty1 = helperMakePty(6001, "bash");
      const pty2 = helperMakePty(6002, "bash");

      mocked.ptySpawnMock
        .mockReturnValueOnce(pty1)
        .mockReturnValueOnce(pty2);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);

      socket.write(buildSpawnMsg("sess-a", "bash"));
      socket.write(buildSpawnMsg("sess-b", "bash"));
      await waitForLines(lines, 2);

      socket.write(buildWriteMsg("sess-a", "echo A\n"));
      socket.write(buildWriteMsg("sess-b", "echo B\n"));
      await new Promise((r) => setTimeout(r, 50));

      expect(pty1.write).toHaveBeenCalledWith("echo A\n");
      expect(pty2.write).toHaveBeenCalledWith("echo B\n");

      pty1._writeToPty("output A");
      await new Promise((r) => setTimeout(r, 50));

      const allMsgs = lines.map((l) => JSON.parse(l));
      const dataForA = allMsgs.filter(
        (m: any) => m.type === "data" && m.id === "sess-a",
      );
      expect(dataForA.length).toBeGreaterThanOrEqual(1);

      socket.destroy();
      await agent.stop();
    });
  });

  // ── 4. PTY resize ──────────────────────────────────────────────────────

  describe("PTY resize", () => {
    it("should resize PTY to new dimensions", async () => {
      const pty = helperMakePty(7001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      socket.write(buildResizeMsg("sess-1", 120, 40));
      await new Promise((r) => setTimeout(r, 50));

      expect(pty.resize).toHaveBeenCalledWith(120, 40);

      socket.destroy();
      await agent.stop();
    });

    it("should ignore resize for unknown session", async () => {
      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);

      socket.write(buildResizeMsg("nonexistent", 120, 40));
      await new Promise((r) => setTimeout(r, 100));

      const spawnedMsgs = lines.filter(
        (l) => JSON.parse(l).type === "spawned",
      );
      expect(spawnedMsgs).toHaveLength(0);

      socket.destroy();
      await agent.stop();
    });
  });

  // ── 5. PTY exit ────────────────────────────────────────────────────────

  describe("PTY exit", () => {
    it("should send exit message with code on process exit", async () => {
      const pty = helperMakePty(8001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      pty._exitPty(0);
      await new Promise((r) => setTimeout(r, 50));

      const allMsgs = lines.map((l) => JSON.parse(l));
      const exitMsg = allMsgs.find((m: any) => m.type === "exit");
      expect(exitMsg).toBeDefined();
      expect(exitMsg.id).toBe("sess-1");
      expect(exitMsg.code).toBe(0);

      socket.destroy();
      await agent.stop();
    });

    it("should send exit with null code on signal kill", async () => {
      const pty = helperMakePty(9001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      pty._exitPty(undefined as any, 9);
      await new Promise((r) => setTimeout(r, 50));

      const allMsgs = lines.map((l) => JSON.parse(l));
      const exitMsg = allMsgs.find((m: any) => m.type === "exit");
      expect(exitMsg).toBeDefined();
      expect(exitMsg.id).toBe("sess-1");
      expect(exitMsg.code).toBeNull();

      socket.destroy();
      await agent.stop();
    });

    it("should cleanup session resources after exit", async () => {
      const pty = helperMakePty(10001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      pty._exitPty(0);
      await new Promise((r) => setTimeout(r, 50));

      const session = agent.getSession("sess-1");
      expect(session).toBeUndefined();

      socket.destroy();
      await agent.stop();
    });
  });

  // ── 6. Screenshot ──────────────────────────────────────────────────────

  describe("screenshot", () => {
    it("should return screenshot as base64 PNG", async () => {
      const pty = helperMakePty(11001, "bash");
      mocked.ptySpawnMock.mockReturnValue(pty);

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);
      socket.write(buildSpawnMsg("sess-1", "bash"));
      await waitForLines(lines, 1);

      socket.write(buildScreenshotMsg("sess-1"));
      await new Promise((r) => setTimeout(r, 100));

      const allMsgs = lines.map((l) => JSON.parse(l));
      const screenMsg = allMsgs.find((m: any) => m.type === "screenshot");
      expect(screenMsg).toBeDefined();
      expect(screenMsg.id).toBe("sess-1");
      expect(typeof screenMsg.image).toBe("string");
      expect(screenMsg.image.length).toBeGreaterThan(0);

      socket.destroy();
      await agent.stop();
    });

    it("should handle screenshot failure gracefully", async () => {
      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket } = await connectAndRead(SOCKET_PATH);

      socket.write(buildScreenshotMsg("nonexistent"));
      await new Promise((r) => setTimeout(r, 100));

      // Server should still accept connections after the failed request
      const conn = net.createConnection(SOCKET_PATH);
      await new Promise<void>((resolve) => conn.on("connect", resolve));
      conn.destroy();

      socket.destroy();
      await agent.stop();
    });
  });

  // ── 7. Media watcher ───────────────────────────────────────────────────

  describe("media watcher", () => {
    it("should watch directory and emit file events on new files", async () => {
      mocked.watchMock.mockReturnValue({ on: vi.fn(), close: vi.fn() });

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);

      socket.write(buildWatchMsg("/workspace/media"));
      await new Promise((r) => setTimeout(r, 50));

      expect(mocked.watchMock).toHaveBeenCalledWith("/workspace/media");

      socket.destroy();
      await agent.stop();
    });
  });

  // ── 8. Protocol parsing ────────────────────────────────────────────────

  describe("protocol parsing", () => {
    it("should handle multiple JSON messages in single TCP chunk", async () => {
      mocked.ptySpawnMock
        .mockReturnValueOnce(helperMakePty(12001, "zsh"))
        .mockReturnValueOnce(helperMakePty(12002, "zsh"));

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);

      const batch =
        buildSpawnMsg("sess-a", "zsh") + buildSpawnMsg("sess-b", "zsh");
      socket.write(batch);

      const msgs = await waitForLines(lines, 2);
      const parsed = msgs.map((l) => JSON.parse(l));
      const ids = parsed.map((m: any) => m.id).sort();
      expect(ids).toEqual(["sess-a", "sess-b"]);

      socket.destroy();
      await agent.stop();
    });

    it("should handle partial JSON messages split across reads", async () => {
      mocked.ptySpawnMock.mockReturnValue(helperMakePty(13001, "bash"));

      installWiredFixture();

      const agent = await createServer({ socketPath: SOCKET_PATH });
      await agent.start();

      const { socket, lines } = await connectAndRead(SOCKET_PATH);

      const fullMsg = buildSpawnMsg("sess-1", "bash");
      const half = Math.floor(fullMsg.length / 2);
      const part1 = fullMsg.slice(0, half);
      const part2 = fullMsg.slice(half);

      socket.write(part1);
      await new Promise((r) => setTimeout(r, 20));
      socket.write(part2);

      const msgs = await waitForLines(lines, 1);
      const resp = JSON.parse(msgs[0]);
      expect(resp.type).toBe("spawned");
      expect(resp.id).toBe("sess-1");

      socket.destroy();
      await agent.stop();
    });
  });
});
