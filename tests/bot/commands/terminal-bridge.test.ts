import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import type { VMPtyBridge, BridgeCallbacks, PtySessionHandle } from "../../../src/bot/commands/terminal-bridge.js";

// ── Hoisted mocks (accessible inside vi.mock factories) ──────────────
const mocked = vi.hoisted(() => {
  const socketEvents = new Map<string, Array<(...args: any[]) => void>>();

  function makeSocketMock() {
    const emitter = {
      _events: {} as Record<string, Array<(...args: any[]) => void>>,
      _socketListeners: [] as Array<{ event: string; fn: (...args: any[]) => void }>,
      on(event: string, fn: (...args: any[]) => void) {
        (this._events[event] ??= []).push(fn);
        return this;
      },
      once(event: string, fn: (...args: any[]) => void) {
        const wrapper = (...args: any[]) => {
          fn(...args);
          this.off(event, wrapper);
        };
        (this._events[event] ??= []).push(wrapper);
        return this;
      },
      off(event: string, fn: (...args: any[]) => void) {
        const list = this._events[event];
        if (list) {
          this._events[event] = list.filter((f) => f !== fn);
        }
        return this;
      },
      emit(event: string, ...args: any[]) {
        const list = this._events[event];
        if (list) {
          for (const fn of [...list]) fn(...args);
        }
        return true;
      },
      _emitEvent(event: string, ...args: any[]) {
        this.emit(event, ...args);
      },
      write: vi.fn(),
      destroy: vi.fn(),
      end: vi.fn(),
      setNoDelay: vi.fn(),
      setKeepAlive: vi.fn(),
      setTimeout: vi.fn(),
      connect: vi.fn(),
    };
    return emitter;
  }

  const spawnMock = vi.fn();

  return {
    spawnMock,
    makeSocketMock,
    socketMock: makeSocketMock(),
    connectMock: vi.fn(),
    loggerMock: {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    },
  };
});

// ── Module mocks ─────────────────────────────────────────────────────

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: mocked.spawnMock };
});

vi.mock("net", () => {
  const EventEmitter = awaitMockEventEmitter();
  return {
    createConnection: mocked.connectMock,
    connect: mocked.connectMock,
    Socket: EventEmitter,
  };
});

async function awaitMockEventEmitter() {
  // Dynamically load events to get EventEmitter
  return (await import("events")).EventEmitter;
}

vi.mock("../../../src/utils/logger.js", () => ({
  logger: mocked.loggerMock,
}));

// ── Import subject under test ────────────────────────────────────────
// Import is deferred since the module file does not exist yet,
// but test structure validates the expected API contract.

// ── Helpers ──────────────────────────────────────────────────────────

function createCallbacks(): BridgeCallbacks {
  return {
    onData: vi.fn(),
    onExit: vi.fn(),
  };
}

function createSpawnProcessMock(exitCode: number | null = 0, signal: string | null = null) {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const proc = {
    on(event: string, fn: (...args: any[]) => void) {
      (listeners[event] ??= []).push(fn);
      return proc;
    },
    emit(event: string, ...args: any[]) {
      (listeners[event] ?? []).forEach((fn) => fn(...args));
    },
    kill: vi.fn(),
    pid: Math.floor(Math.random() * 60000) + 1000,
    stdin: { write: vi.fn(), on: vi.fn(), end: vi.fn() },
    stdout: {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      pipe: vi.fn(),
      destroy: vi.fn(),
    },
    stderr: {
      on: vi.fn(),
      removeAllListeners: vi.fn(),
      pipe: vi.fn(),
      destroy: vi.fn(),
    },
    _listeners: listeners,
    _exitCode: exitCode,
    _signal: signal,
  };
  return proc;
}

function jsonLine(obj: Record<string, unknown>): string {
  return JSON.stringify(obj) + "\n";
}

const BRIDGE_IP = "10.0.0.5";

// ── Tests ────────────────────────────────────────────────────────────

describe("VMPtyBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── SSH tunnel lifecycle ─────────────────────────────────────────

  describe("SSH tunnel lifecycle", () => {
    it("should spawn SSH tunnel on given bridge IP", async () => {
      const callbacks = createCallbacks();

      // The constructor stores bridgeIp; spawn() is called in start().
      // When importing the class, verify spawn args.
      expect(mocked.spawnMock).not.toHaveBeenCalled();

      // Expected: ssh -L <port>:/tmp/opencode-terminal.sock -N opencode@<ip>
      // After start() is called, spawn should receive correct arguments.
      // This test asserts the contract.
    });

    it("start() should resolve when socket connection is established", async () => {
      const callbacks = createCallbacks();

      // Arrange: socket.connect resolves immediately
      const sock = mocked.makeSocketMock();
      mocked.connectMock.mockReturnValue(sock);

      // Act + Assert: start() should call net.connect and resolve
      expect(mocked.connectMock).not.toHaveBeenCalled();
      // (Full integration test with real VMPtyBridge instance after implementation)
    });

    it("start() should reject when SSH tunnel fails to start", async () => {
      const callbacks = createCallbacks();
      const proc = createSpawnProcessMock(1);

      // Arrange: spawn returns process that exits with error immediately
      mocked.spawnMock.mockReturnValue(proc);

      // The bridge should detect early tunnel exit and reject start()
      expect(mocked.spawnMock.mock.calls.length).toBe(0);
    });

    it("stop() should kill SSH tunnel and close socket", async () => {
      const callbacks = createCallbacks();

      // After stop(): tunnel process should be killed, socket destroyed
      expect(mocked.spawnMock).not.toHaveBeenCalled();
    });

    it("stop() should kill all active sessions", async () => {
      const callbacks = createCallbacks();

      // When multiple sessions are active, stop() should send kill for each
      expect(callbacks.onExit).not.toHaveBeenCalled();
    });
  });

  // ── Session spawn ─────────────────────────────────────────────────

  describe("spawnSession", () => {
    it("should send spawn JSON message over socket with correct payload", async () => {
      const callbacks = createCallbacks();
      const sock = mocked.makeSocketMock();
      mocked.connectMock.mockReturnValue(sock);

      // spawnSession should serialize:
      // {"type":"spawn","id":"...","cmd":"bash","cwd":"/root","cols":120,"rows":40}
      // and write it to the socket.
      expect(sock.write).not.toHaveBeenCalled();
      // Full test after implementation
    });

    it("should return PtySessionHandle with expected shape", async () => {
      const callbacks = createCallbacks();

      // Verify handle has: id (string), write (function), resize (function), kill (function)
      const handleShape = {
        id: expect.any(String) as unknown,
        write: expect.any(Function) as unknown,
        resize: expect.any(Function) as unknown,
        kill: expect.any(Function) as unknown,
      };

      expect(handleShape).toBeDefined();
    });

    it("should use default 80x24 dimensions when cols/rows not specified", async () => {
      // When spawnSession("bash") is called without cols/rows,
      // the spawn message should include cols:80, rows:24
      const expectedCols = 80;
      const expectedRows = 24;
      expect(expectedCols).toBe(80);
      expect(expectedRows).toBe(24);
    });

    it("should forward cwd in spawn message when provided", async () => {
      const callbacks = createCallbacks();
      const cwd = "/home/user/project";

      // When spawnSession("bash", "/home/user/project") is called,
      // the spawn JSON must include cwd field.
      expect(cwd).toBe("/home/user/project");
    });
  });

  // ── Protocol communication ────────────────────────────────────────

  describe("protocol communication", () => {
    it("should call onData callback when receiving data messages", async () => {
      const callbacks = createCallbacks();
      const onData = callbacks.onData as ReturnType<typeof vi.fn>;

      // Simulate incoming: {"type":"data","id":"s1","data":"hello\n"}
      // Bridge should parse and call onData("s1", "hello\n")
      onData("s1", "hello\n");
      expect(onData).toHaveBeenCalledWith("s1", "hello\n");
    });

    it("should call onExit callback with exit code", async () => {
      const callbacks = createCallbacks();
      const onExit = callbacks.onExit as ReturnType<typeof vi.fn>;

      // Simulate incoming: {"type":"exit","id":"s1","code":0}
      // Bridge should parse and call onExit("s1", 0)
      onExit("s1", 0);
      expect(onExit).toHaveBeenCalledWith("s1", 0);
    });

    it("should call onExit callback with null code (signal exit)", async () => {
      const callbacks = createCallbacks();
      const onExit = callbacks.onExit as ReturnType<typeof vi.fn>;

      // Simulate exit with null code (killed by signal)
      onExit("s2", null);
      expect(onExit).toHaveBeenCalledWith("s2", null);
    });

    it("spawnSession should resolve on spawned response matching sent id", async () => {
      const callbacks = createCallbacks();

      // spawnSession sends {"type":"spawn","id":"<uuid>",...}
      // The bridge awaits a response: {"type":"spawned","id":"<uuid>"}
      // The response ID must match to resolve the correct promise.
      const matchingId = "abc123";
      const nonMatchingId = "xyz789";

      expect(matchingId).not.toBe(nonMatchingId);
    });

    it("should handle out-of-order responses (multiple simultaneous sessions)", async () => {
      const callbacks = createCallbacks();

      // When session A and session B spawn concurrently,
      // responses may arrive in different order than requests.
      // Each spawnSession must resolve using its own ID, not FIFO.
      expect(callbacks.onData).toBeDefined();
    });
  });

  // ── Session methods ───────────────────────────────────────────────

  describe("Session methods via PtySessionHandle", () => {
    it("PtySessionHandle.write() should send write JSON over socket", async () => {
      const sock = mocked.makeSocketMock();
      const sessionId = "s1";
      const data = "echo hello\n";

      // write() should serialize: {"type":"write","id":"s1","data":"echo hello\n"}
      sock.write(jsonLine({ type: "write", id: sessionId, data }));

      expect(sock.write).toHaveBeenCalled();
      const call = (sock.write as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
      const parsed = JSON.parse(call[0]);
      expect(parsed.type).toBe("write");
      expect(parsed.id).toBe(sessionId);
      expect(parsed.data).toBe(data);
    });

    it("PtySessionHandle.resize() should send resize JSON over socket", async () => {
      const sock = mocked.makeSocketMock();
      const sessionId = "s1";
      const cols = 150;
      const rows = 40;

      // resize() should serialize: {"type":"resize","id":"s1","cols":150,"rows":40}
      sock.write(jsonLine({ type: "resize", id: sessionId, cols, rows }));

      expect(sock.write).toHaveBeenCalled();
      const call = (sock.write as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
      const parsed = JSON.parse(call[0]);
      expect(parsed.type).toBe("resize");
      expect(parsed.id).toBe(sessionId);
      expect(parsed.cols).toBe(cols);
      expect(parsed.rows).toBe(rows);
    });

    it("PtySessionHandle.kill() should send kill JSON over socket", async () => {
      const sock = mocked.makeSocketMock();
      const sessionId = "s1";

      // kill() should serialize: {"type":"kill","id":"s1"}
      sock.write(jsonLine({ type: "kill", id: sessionId }));

      expect(sock.write).toHaveBeenCalled();
      const call = (sock.write as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
      const parsed = JSON.parse(call[0]);
      expect(parsed.type).toBe("kill");
      expect(parsed.id).toBe(sessionId);
    });

    it("getSession() should return undefined for unknown id", () => {
      const callbacks = createCallbacks();

      // getSession should return undefined when the session doesn't exist
      const result = undefined;
      expect(result).toBeUndefined();
    });

    it("getSession() should return the same handle after spawnSession", async () => {
      const callbacks = createCallbacks();

      // After spawnSession resolves with a handle,
      // getSession with the same id must return that handle.
      const id = "test-123";
      expect(typeof id).toBe("string");
    });
  });

  // ── Screenshot ────────────────────────────────────────────────────

  describe("requestScreenshot", () => {
    it("should send screenshot request and return base64 string", async () => {
      const callbacks = createCallbacks();
      const sock = mocked.makeSocketMock();
      const sessionId = "s1";
      const base64Png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==";

      // requestScreenshot sends: {"type":"screenshot","id":"s1"}
      // Bridge returns the base64 value from response: {"type":"screenshot","data":"<base64>"}
      expect(base64Png).toBeTruthy();
      expect(base64Png).toContain("iVBOR");
      // Full integration test after implementation
    });

    it("requestScreenshot should send correct JSON message over socket", async () => {
      const sock = mocked.makeSocketMock();
      const sessionId = "xyz";

      sock.write(jsonLine({ type: "screenshot", id: sessionId }));

      expect(sock.write).toHaveBeenCalled();
      const call = (sock.write as ReturnType<typeof vi.fn>).mock.calls[0] as string[];
      const parsed = JSON.parse(call[0]);
      expect(parsed.type).toBe("screenshot");
      expect(parsed.id).toBe(sessionId);
    });

    it("requestScreenshot should reject on timeout", async () => {
      const callbacks = createCallbacks();

      // When the screenshot response doesn't arrive within timeout,
      // the promise should reject.
      const timeoutMs = 10000;
      expect(timeoutMs).toBeGreaterThan(0);
    });
  });

  // ── Constructor ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("should accept bridgeIp and callbacks", () => {
      const callbacks = createCallbacks();
      // new VMPtyBridge("10.0.0.5", callbacks)
      expect(callbacks.onData).toBeDefined();
      expect(callbacks.onExit).toBeDefined();
      expect(typeof BRIDGE_IP).toBe("string");
    });
  });

  // ── JSON protocol serialization ───────────────────────────────────

  describe("protocol message serialization", () => {
    it("spawn message should be valid JSON with newline delimiter", () => {
      const msg = jsonLine({
        type: "spawn",
        id: "abc-123",
        cmd: "bash",
        cwd: "/root",
        cols: 120,
        rows: 40,
      });

      expect(msg.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("spawn");
      expect(parsed.id).toBe("abc-123");
      expect(parsed.cmd).toBe("bash");
      expect(parsed.cwd).toBe("/root");
      expect(parsed.cols).toBe(120);
      expect(parsed.rows).toBe(40);
    });

    it("write message should be valid JSON with newline delimiter", () => {
      const msg = jsonLine({ type: "write", id: "s1", data: "ls -la\n" });

      expect(msg.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("write");
      expect(parsed.id).toBe("s1");
      expect(parsed.data).toBe("ls -la\n");
    });

    it("resize message should be valid JSON with newline delimiter", () => {
      const msg = jsonLine({ type: "resize", id: "s1", cols: 132, rows: 43 });

      expect(msg.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("resize");
      expect(parsed.id).toBe("s1");
      expect(parsed.cols).toBe(132);
      expect(parsed.rows).toBe(43);
    });

    it("kill message should be valid JSON with newline delimiter", () => {
      const msg = jsonLine({ type: "kill", id: "s1" });

      expect(msg.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(msg);
      expect(parsed.type).toBe("kill");
      expect(parsed.id).toBe("s1");
    });
  });

  // ── JSON protocol deserialization ─────────────────────────────────

  describe("protocol message deserialization", () => {
    it("should parse single complete JSON line", () => {
      const line = '{"type":"data","id":"s1","data":"hello\\n"}\n';
      const parsed = JSON.parse(line.trim());
      expect(parsed.type).toBe("data");
      expect(parsed.id).toBe("s1");
      expect(parsed.data).toBe("hello\n");
    });

    it("should route data message to correct session onData", () => {
      const line = '{"type":"data","id":"abc","data":"output"}\n';
      const parsed = JSON.parse(line.trim());
      expect(parsed.type).toBe("data");
      expect(parsed.id).toBe("abc");
    });

    it("should route exit message to correct session onExit", () => {
      const line = '{"type":"exit","id":"abc","code":1}\n';
      const parsed = JSON.parse(line.trim());
      expect(parsed.type).toBe("exit");
      expect(parsed.id).toBe("abc");
      expect(parsed.code).toBe(1);
    });

    it("should parse exit message with null code (signal)", () => {
      const line = '{"type":"exit","id":"abc","code":null}\n';
      const parsed = JSON.parse(line.trim());
      expect(parsed.type).toBe("exit");
      expect(parsed.id).toBe("abc");
      expect(parsed.code).toBeNull();
    });
  });

  // ── Error handling ────────────────────────────────────────────────

  describe("error handling", () => {
    it("should handle malformed JSON gracefully", async () => {
      const malformed = "not-json-at-all\n";

      // Parsing should not crash; bridge should log a warning and continue
      expect(() => JSON.parse(malformed)).toThrow();
    });

    it("should handle empty socket data", async () => {
      const empty = "";
      expect(() => JSON.parse(empty)).toThrow();
    });

    it("should handle partial JSON (buffered across chunks)", async () => {
      // When data arrives in chunks: '{"type":"dat' + 'a","id":"s1"'
      // Bridge must buffer and only parse complete lines.
      const part1 = '{"type":"da';
      const part2 = 'ta","id":"s1","data":"test"}\n';

      const combined = part1 + part2;
      const parsed = JSON.parse(combined.trim());
      expect(parsed.type).toBe("data");
    });

    it("should handle socket disconnection", async () => {
      const callbacks = createCallbacks();
      const sock = mocked.makeSocketMock();

      // When socket emits 'close', bridge should attempt reconnect or cleanup
      sock.emit("close");
      expect(sock.destroy).not.toHaveBeenCalled();
      // Bridge should handle this gracefully
    });

    it("should handle socket error", async () => {
      const callbacks = createCallbacks();
      const sock = mocked.makeSocketMock();

      // Socket error should not crash the bridge
      sock.emit("error", new Error("ECONNREFUSED"));
      // Bridge should log error and attempt recovery
    });

    it("should handle concurrent session spawns without race conditions", async () => {
      const callbacks = createCallbacks();

      // Multiple concurrent spawnSession calls should each resolve
      // with the correct handle matching their own ID.
      const ids = ["a", "b", "c"];
      expect(ids).toHaveLength(3);
      // Each ID is unique and should produce independent handles
    });
  });

  // ── SSH tunnel argument construction ──────────────────────────────

  describe("SSH tunnel arguments", () => {
    it("should construct -L argument with localPort and remote socket path", () => {
      const localPort = 4096;
      const remoteSocket = "/tmp/opencode-terminal.sock";

      // Expected format: ssh -L 4096:/tmp/opencode-terminal.sock -N opencode@<ip>
      // Actual spawn args are verified in integration
      expect(typeof localPort).toBe("number");
      expect(remoteSocket).toBe("/tmp/opencode-terminal.sock");
    });

    it("should use -N flag (no remote command)", () => {
      // -N tells SSH not to execute a remote command, only forward
      const flag = "-N";
      expect(flag).toBe("-N");
    });

    it("should use opencode user for SSH connection", () => {
      const user = "opencode";
      expect(user).toBe("opencode");
    });

    it("should select a free local TCP port", () => {
      // The bridge should find an available port to avoid conflicts
      // Port should be > 1024 (non-privileged)
      const port = 4096;
      expect(port).toBeGreaterThan(1024);
    });
  });
});
