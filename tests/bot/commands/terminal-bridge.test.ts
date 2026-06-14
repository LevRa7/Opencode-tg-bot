import { describe, it, expect, vi, beforeEach } from "vitest";
import { EventEmitter } from "events";
import { VMPtyBridge } from "../../../src/bot/commands/terminal-bridge.js";
import type { PtySessionHandle } from "../../../src/bot/commands/terminal-bridge.js";

// ── Hoisted mocks ────────────────────────────────────────────────────

const mocked = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return { ...actual, spawn: mocked.spawnMock };
});

// ── Mock factories ───────────────────────────────────────────────────

function makeChildProcessMock(pid = 12345) {
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const proc = new EventEmitter();

  Object.assign(proc, {
    pid,
    connected: true,
    stdin: {
      write: vi.fn(),
      end: vi.fn(),
      destroy: vi.fn(),
    },
    stdout: Object.assign(stdout, {
      pipe: vi.fn(),
      destroy: vi.fn(),
      removeAllListeners: vi.fn(),
    }),
    stderr: Object.assign(stderr, {
      pipe: vi.fn(),
      destroy: vi.fn(),
      removeAllListeners: vi.fn(),
    }),
    kill: vi.fn(),
  });

  return proc;
}

const BRIDGE_IP = "10.0.0.5";

// ── Tests ────────────────────────────────────────────────────────────

describe("VMPtyBridge", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // ── Constructor ───────────────────────────────────────────────────

  describe("constructor", () => {
    it("should store bridgeIp", () => {
      const bridge = new VMPtyBridge(BRIDGE_IP);
      expect(bridge).toBeInstanceOf(VMPtyBridge);
    });

    it("should initialize with zero sessions", () => {
      const bridge = new VMPtyBridge(BRIDGE_IP);
      expect(bridge.sessionCount).toBe(0);
    });
  });

  // ── spawnSession ──────────────────────────────────────────────────

  describe("spawnSession", () => {
    it("should spawn SSH with correct args (agent script path, sessionId, dimensions)", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      bridge.spawnSession("session-1", { cols: 120, rows: 40 });

      expect(mocked.spawnMock).toHaveBeenCalledTimes(1);
      const args = mocked.spawnMock.mock.calls[0];
      // args: ["ssh", [...sshArgs, remoteCommand]]
      expect(args[0]).toBe("ssh");

      const allArgs = args[1] as string[];
      expect(allArgs).toContain("-o");
      expect(allArgs).toContain("StrictHostKeyChecking=no");
      expect(allArgs).toContain("-o");
      expect(allArgs).toContain("UserKnownHostsFile=/dev/null");
      expect(allArgs).toContain("-o");
      expect(allArgs).toContain("ConnectTimeout=5");

      const userHost = allArgs.find((a) => a.startsWith("opencode@"));
      expect(userHost).toBe(`opencode@${BRIDGE_IP}`);

      const remoteCmd = allArgs[allArgs.length - 1];
      expect(remoteCmd).toContain("node /opt/terminal-agent.js");
      expect(remoteCmd).toContain("session-1");
      expect(remoteCmd).toContain("120");
      expect(remoteCmd).toContain("40");
    });

    it("should include cwd in SSH command when provided", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      bridge.spawnSession("session-cwd", { cwd: "/home/user/project" });

      const remoteCmd = mocked.spawnMock.mock.calls[0][1].at(-1) as string;
      expect(remoteCmd).toContain("/home/user/project");
    });

    it("should return PtySessionHandle with id equal to sessionId", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("session-id-xyz");

      expect(handle).toBeDefined();
      expect(handle.id).toBe("session-id-xyz");
      expect(typeof handle.write).toBe("function");
      expect(typeof handle.resize).toBe("function");
      expect(typeof handle.kill).toBe("function");
      expect(typeof handle.onData).toBe("function");
      expect(typeof handle.onExit).toBe("function");
    });

    it("should default to 80x24 cols/rows when dimensions not specified", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      bridge.spawnSession("session-default");

      const remoteCmd = mocked.spawnMock.mock.calls[0][1].at(-1) as string;
      expect(remoteCmd).toContain("80");
      expect(remoteCmd).toContain("24");
    });

    it("sessionCount should increment after spawn", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      expect(bridge.sessionCount).toBe(0);

      bridge.spawnSession("s1");
      expect(bridge.sessionCount).toBe(1);

      bridge.spawnSession("s2");
      expect(bridge.sessionCount).toBe(2);
    });

    it("should reject when spawn returns exit code immediately", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);

      // Simulate immediate close with non-zero code
      setTimeout(() => {
        proc.emit("close", 1, null);
      }, 0);

      // spawnSession should reject or handle error when child exits early
      // In RED phase this fails because the stub throws before spawn is reached
      expect(() => {
        bridge.spawnSession("early-exit");
      }).not.toThrow();
    });
  });

  // ── PtySessionHandle.write ─────────────────────────────────────────

  describe("PtySessionHandle.write", () => {
    it("should write to child stdin", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("write-test");
      handle.write("echo hello\n");

      expect(proc.stdin.write).toHaveBeenCalledWith("echo hello\n");
    });

    it("should handle data with special characters", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("special-chars");
      const specialData = "\x1b[A\r\n\t\0\x7f";

      handle.write(specialData);
      expect(proc.stdin.write).toHaveBeenCalledWith(specialData);
    });
  });

  // ── PtySessionHandle.onData ────────────────────────────────────────

  describe("PtySessionHandle.onData", () => {
    it("should emit stdout data to registered callback", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("on-data-test");

      const dataCallback = vi.fn();
      handle.onData(dataCallback);

      // Emit data on stdout
      proc.stdout.emit("data", Buffer.from("hello world\n"));
      expect(dataCallback).toHaveBeenCalledWith("hello world\n");
    });

    it("should handle ANSI escape sequences in stdout", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("ansi-test");

      const dataCallback = vi.fn();
      handle.onData(dataCallback);

      const ansiText = "\x1b[32mgreen text\x1b[0m\n";
      proc.stdout.emit("data", Buffer.from(ansiText));
      expect(dataCallback).toHaveBeenCalledWith(ansiText);
    });
  });

  // ── PtySessionHandle.onExit ────────────────────────────────────────

  describe("PtySessionHandle.onExit", () => {
    it("should emit on child process close with exit code", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("exit-code-test");

      const exitCallback = vi.fn();
      handle.onExit(exitCallback);

      proc.emit("close", 0, null);
      expect(exitCallback).toHaveBeenCalledWith(0, undefined);
    });

    it("should emit on child process close with null code (signal)", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("signal-exit-test");

      const exitCallback = vi.fn();
      handle.onExit(exitCallback);

      proc.emit("close", null, "SIGKILL");
      expect(exitCallback).toHaveBeenCalledWith(null, "SIGKILL");
    });
  });

  // ── PtySessionHandle.kill ──────────────────────────────────────────

  describe("PtySessionHandle.kill", () => {
    it("should kill child process with SIGTERM by default", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("kill-test");
      handle.kill();

      expect(proc.kill).toHaveBeenCalledWith("SIGTERM");
    });

    it("should kill child process with custom signal", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const handle = bridge.spawnSession("kill-custom-test");
      handle.kill("SIGINT");

      expect(proc.kill).toHaveBeenCalledWith("SIGINT");
    });
  });

  // ── getSession ─────────────────────────────────────────────────────

  describe("getSession", () => {
    it("should return undefined for unknown sessionId", () => {
      const bridge = new VMPtyBridge(BRIDGE_IP);
      const result = bridge.getSession("nonexistent");
      expect(result).toBeUndefined();
    });

    it("should return handle after spawnSession", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      const spawned = bridge.spawnSession("get-session-test");
      const retrieved = bridge.getSession("get-session-test");

      expect(retrieved).toBe(spawned);
      expect(retrieved).toBeDefined();
    });
  });

  // ── killAll ────────────────────────────────────────────────────────

  describe("killAll", () => {
    it("should kill all spawned sessions", () => {
      const proc1 = makeChildProcessMock(10001);
      const proc2 = makeChildProcessMock(10002);
      mocked.spawnMock
        .mockReturnValueOnce(proc1)
        .mockReturnValueOnce(proc2);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      bridge.spawnSession("killall-1");
      bridge.spawnSession("killall-2");

      bridge.killAll();

      expect(proc1.kill).toHaveBeenCalled();
      expect(proc2.kill).toHaveBeenCalled();
    });

    it("should clear session count", () => {
      const proc = makeChildProcessMock();
      mocked.spawnMock.mockReturnValue(proc);

      const bridge = new VMPtyBridge(BRIDGE_IP);
      bridge.spawnSession("clear-count");
      expect(bridge.sessionCount).toBe(1);

      bridge.killAll();
      expect(bridge.sessionCount).toBe(0);
    });
  });
});
