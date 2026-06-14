import { describe, it, expect, vi, beforeEach } from "vitest";
import { executeTerminalCommand, terminalTopicIds, terminalProcesses, loadTerminalTopics, isTerminalTopic, isTerminalRunning, killTerminalProcess } from "../../../src/bot/commands/terminal.js";

const mocked = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  getVmRuntimeInfoMock: vi.fn(),
  sshManagerIsActiveMock: vi.fn(),
  sshManagerExecMock: vi.fn(),
  execSyncMock: vi.fn(),
}));

vi.mock("child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("child_process")>();
  return {
    ...actual,
    spawn: mocked.spawnMock,
    execSync: mocked.execSyncMock,
  };
});

vi.mock("../../../src/settings/manager.js", () => ({
  getVmRuntimeInfo: mocked.getVmRuntimeInfoMock,
  getUserDeployTarget: vi.fn(),
  getCurrentProject: vi.fn(),
  setConversationCurrentProject: vi.fn(),
  getOrCreateServerPassword: vi.fn(),
}));

vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    isSshActive: mocked.sshManagerIsActiveMock,
    executeRemoteCommand: mocked.sshManagerExecMock,
  },
}));

vi.mock("../../../src/config.js", () => ({
  config: {
    telegram: { adminUserId: 6931112349 },
    opencode: { apiUrl: "http://localhost:4096", password: "pass", username: "opencode" },
    server: { logLevel: "info" },
  },
}));

vi.mock("../../../src/utils/logger.js", () => ({
  logger: { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}));

vi.mock("../../../src/i18n/index.js", () => ({
  t: (key: string) => key,
  getLocale: () => "en",
}));

vi.mock("../../../src/session/manager.js", () => ({
  setCurrentSession: vi.fn(),
  getCurrentSession: vi.fn(),
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: { sendKeyboardUpdate: vi.fn(() => Promise.resolve()) },
  SessionType: {},
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: { sendKeyboardUpdate: vi.fn(() => Promise.resolve()) },
  SessionType: {},
}));

vi.mock("../../../src/opencode/client.js", () => ({
  opencodeClient: {
    session: {
      create: vi.fn(),
    },
  },
}));

vi.mock("../../../src/process/manager.js", () => ({
  processManager: {
    ensureRuntime: vi.fn(),
  },
}));

vi.mock("../../../src/thread/manager.js", () => ({
  threadContextManager: {
    findForumChatIdForUser: vi.fn(),
    bindProjectToActiveContext: vi.fn(),
  },
}));

vi.mock("../../../src/project/manager.js", () => ({
  getDefaultProject: vi.fn(),
}));

vi.mock("../../../src/attach/service.js", () => ({
  attachSessionForScope: vi.fn(),
}));

vi.mock("../../../src/interaction/cleanup.js", () => ({
  clearAllInteractionState: vi.fn(),
}));

vi.mock("../../runtime/scoped-runtime-reset.js", () => ({
  clearScopedSessionRuntime: vi.fn(),
}));

vi.mock("../../agent/manager.js", () => ({
  getStoredAgent: vi.fn(),
}));

vi.mock("../../model/manager.js", () => ({
  getStoredModel: vi.fn(),
}));

vi.mock("../utils/keyboard.js", () => ({
  createMainKeyboard: vi.fn(),
}));

vi.mock("../../utils/system-info.js", () => ({
  getSystemInfo: vi.fn(),
}));

vi.mock("../handlers/permission.js", () => ({
  showPermissionRequest: vi.fn(),
}));

vi.mock("../handlers/question.js", () => ({
  showCurrentQuestion: vi.fn(),
}));

vi.mock("../../telegram/scope.js", () => ({
  getCurrentTelegramConversationScope: vi.fn(),
}));

vi.mock("../../../src/settings/manager.js", () => ({
  getVmRuntimeInfo: mocked.getVmRuntimeInfoMock,
  getUserDeployTarget: vi.fn(),
  getCurrentProject: vi.fn(),
  setConversationCurrentProject: vi.fn(),
  getOrCreateServerPassword: vi.fn(),
}));

vi.mock("../../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    isSshActive: mocked.sshManagerIsActiveMock,
    executeRemoteCommand: mocked.sshManagerExecMock,
  },
}));

vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: { sendKeyboardUpdate: vi.fn(() => Promise.resolve()) },
  SessionType: {},
}));

// Also mock for the "km" alias import
vi.mock("../../../src/keyboard/manager.js", () => ({
  keyboardManager: { sendKeyboardUpdate: vi.fn(() => Promise.resolve()) },
  SessionType: {},
}));

vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error("no file")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// Create a mock ChildProcess that is both a class and has on()
function createMockChild() {
  const listeners: Record<string, Array<(...args: any[]) => void>> = {};
  const mockChild: any = {
    stdout: { on: vi.fn() },
    stderr: { on: vi.fn() },
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!listeners[event]) listeners[event] = [];
      listeners[event].push(fn);
      return mockChild;
    }),
    kill: vi.fn(),
    _emit: (event: string, ...args: any[]) => {
      listeners[event]?.forEach((fn) => fn(...args));
    },
  };
  return mockChild;
}

describe("terminal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    terminalProcesses.clear();
    terminalTopicIds.clear();
  });

  describe("executeTerminalCommand", () => {
    it("spawns locally when no VM and no SSH", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue(undefined);
      mocked.sshManagerIsActiveMock.mockReturnValue(false);

      const mockChild = createMockChild();
      mocked.spawnMock.mockReturnValue(mockChild);

      const chunks: string[] = [];
      const promise = executeTerminalCommand("echo hello", 123, (chunk) => chunks.push(chunk), 1);

      expect(mocked.spawnMock).toHaveBeenCalledWith("echo hello", [], {
        shell: true,
        timeout: 30_000,
      });

      // Simulate output
      mockChild.stdout.on.mock.calls[0][1]("hello\n");
      mockChild._emit("close", 0);

      const result = await promise;
      expect(result).toEqual({ code: 0 });
      expect(chunks).toEqual(["hello\n"]);
    });

    it("routes to SSH for VM users", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue({ bridgeIp: "10.100.0.123" });
      mocked.sshManagerIsActiveMock.mockReturnValue(false);

      const mockChild = createMockChild();
      mocked.spawnMock.mockReturnValue(mockChild);

      const promise = executeTerminalCommand("ls", 123, () => {}, 1);

      expect(mocked.spawnMock).toHaveBeenCalledWith(
        'ssh -o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null -o ConnectTimeout=5 opencode@10.100.0.123 "cd /workspace && ls" 2>/dev/null',
        [],
        { shell: true, timeout: 30_000 },
      );

      mockChild._emit("close", 0);
      await promise;
    });

    it("routes to sshManager for SSH users", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue(undefined);
      mocked.sshManagerIsActiveMock.mockReturnValue(true);
      mocked.sshManagerExecMock.mockResolvedValue("output");

      const chunks: string[] = [];
      const result = await executeTerminalCommand("ls", 123, (chunk) => chunks.push(chunk), 1);

      expect(mocked.sshManagerExecMock).toHaveBeenCalledWith(1, "ls");
      expect(result).toEqual({ code: 0 });
      expect(chunks).toEqual(["output"]);
    });

    it("VM route takes priority over SSH", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue({ bridgeIp: "10.100.0.123" });
      mocked.sshManagerIsActiveMock.mockReturnValue(true);

      const mockChild = createMockChild();
      mocked.spawnMock.mockReturnValue(mockChild);

      const promise = executeTerminalCommand("pwd", 123, () => {}, 1);

      // Should use VM SSH, not sshManager
      expect(mocked.spawnMock).toHaveBeenCalled();
      expect(mocked.sshManagerExecMock).not.toHaveBeenCalled();

      mockChild._emit("close", 0);
      await promise;
    });

    it("falls back to local spawn when userId is undefined", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue(undefined);

      const mockChild = createMockChild();
      mocked.spawnMock.mockReturnValue(mockChild);

      const promise = executeTerminalCommand("date", 123, () => {});

      expect(mocked.spawnMock).toHaveBeenCalledWith("date", [], {
        shell: true,
        timeout: 30_000,
      });

      mockChild._emit("close", 0);
      await promise;
    });

    it("handles spawn errors gracefully", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue(undefined);
      mocked.sshManagerIsActiveMock.mockReturnValue(false);

      const mockChild = createMockChild();
      mocked.spawnMock.mockReturnValue(mockChild);

      const chunks: string[] = [];
      const promise = executeTerminalCommand("badcmd", 123, (chunk) => chunks.push(chunk), 1);

      mockChild._emit("error", new Error("spawn failed"));

      const result = await promise;
      expect(result).toEqual({ code: null });
      expect(chunks).toContain("\nError: spawn failed");
    });

    it("handles SSH manager errors gracefully", async () => {
      mocked.getVmRuntimeInfoMock.mockReturnValue(undefined);
      mocked.sshManagerIsActiveMock.mockReturnValue(true);
      mocked.sshManagerExecMock.mockRejectedValue(new Error("SSH error"));

      const chunks: string[] = [];
      const result = await executeTerminalCommand("fail", 123, (chunk) => chunks.push(chunk), 1);

      expect(result).toEqual({ code: null });
      expect(chunks).toContain("\nError: SSH error");
    });
  });

  describe("terminal topic management", () => {
    it("isTerminalTopic returns true for registered topics", () => {
      terminalTopicIds.add(42);
      expect(isTerminalTopic(42)).toBe(true);
      expect(isTerminalTopic(99)).toBe(false);
      expect(isTerminalTopic(undefined)).toBe(false);
    });

    it("isTerminalRunning returns true when process exists", () => {
      expect(isTerminalRunning(123)).toBe(false);
      const mockChild = createMockChild();
      terminalProcesses.set(123, mockChild as any);
      expect(isTerminalRunning(123)).toBe(true);
    });

    it("killTerminalProcess sends SIGTERM and removes from map", () => {
      const mockChild = createMockChild();
      terminalProcesses.set(456, mockChild as any);

      const result = killTerminalProcess(456);
      expect(result).toBe(true);
      expect(mockChild.kill).toHaveBeenCalledWith("SIGTERM");
      expect(terminalProcesses.has(456)).toBe(false);
    });

    it("killTerminalProcess returns false for unknown id", () => {
      expect(killTerminalProcess(999)).toBe(false);
    });
  });
});
