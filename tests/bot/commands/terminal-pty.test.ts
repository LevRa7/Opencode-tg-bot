import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock types — stand in for VMPtyBridge and PtySessionHandle
// ---------------------------------------------------------------------------

class MockPtySession {
  id: string;
  kill = vi.fn();

  constructor(id: string) {
    this.id = id;
  }
}

// ---------------------------------------------------------------------------
// Hoisted mocks — same pattern as terminal.test.ts for dependency isolation
// ---------------------------------------------------------------------------

const mocked = vi.hoisted(() => ({
  spawnMock: vi.fn(),
  getVmRuntimeInfoMock: vi.fn(),
  sshManagerIsActiveMock: vi.fn(),
  sshManagerExecMock: vi.fn(),
  execSyncMock: vi.fn(),
  MockBridge: vi.fn(),
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

vi.mock("fs", () => ({
  promises: {
    readFile: vi.fn().mockRejectedValue(new Error("no file")),
    writeFile: vi.fn().mockResolvedValue(undefined),
    mkdir: vi.fn().mockResolvedValue(undefined),
  },
}));

// ---------------------------------------------------------------------------
// terminal-bridge mock — constructor-based VMPtyBridge (no start/stop)
// ---------------------------------------------------------------------------

vi.mock("../../../src/bot/commands/terminal-bridge.js", () => ({
  VMPtyBridge: mocked.MockBridge,
}));

// ---------------------------------------------------------------------------
// Functions under test — do not exist yet in terminal.ts (RED phase)
// This import will fail because terminal.ts does not export these functions.
// ---------------------------------------------------------------------------

import {
  ensureVMPtyBridge,
  getPtySession,
  setPtySession,
  killPtySession,
  disconnectVMBridge,
} from "../../../src/bot/commands/terminal.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("terminal-pty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocked.MockBridge.mockClear();
  });

  // =========================================================================
  // ensureVMPtyBridge
  // =========================================================================

  describe("ensureVMPtyBridge", () => {
    it("should create bridge on first call for userId", async () => {
      const bridge = await ensureVMPtyBridge(1, "10.100.0.100");

      expect(bridge).toBeDefined();
      expect(mocked.MockBridge).toHaveBeenCalledWith("10.100.0.100");
    });

    it("should return existing bridge on second call (singleton per userId)", async () => {
      const first = await ensureVMPtyBridge(2, "10.100.0.200");
      const second = await ensureVMPtyBridge(2, "10.100.0.200");

      expect(second).toBe(first);
    });

    it("should use provided bridgeIp", async () => {
      await ensureVMPtyBridge(5, "192.168.1.1");

      expect(mocked.MockBridge).toHaveBeenCalledWith("192.168.1.1");
    });

    it("should isolate bridges per userId", async () => {
      const bridgeA = await ensureVMPtyBridge(10, "10.0.0.1");
      const bridgeB = await ensureVMPtyBridge(20, "10.0.0.2");

      expect(bridgeA).not.toBe(bridgeB);
    });
  });

  // =========================================================================
  // getPtySession / setPtySession
  // =========================================================================

  describe("getPtySession / setPtySession", () => {
    it("should return undefined for unknown messageThreadId", () => {
      expect(getPtySession(99999)).toBeUndefined();
    });

    it("should return stored session after setPtySession", () => {
      const session = new MockPtySession("s1");

      setPtySession(100, session);

      expect(getPtySession(100)).toBe(session);
    });

    it("should overwrite existing session", () => {
      const oldSession = new MockPtySession("old");
      const newSession = new MockPtySession("new");

      setPtySession(200, oldSession);
      setPtySession(200, newSession);

      expect(getPtySession(200)).toBe(newSession);
      expect(getPtySession(200)).not.toBe(oldSession);
    });
  });

  // =========================================================================
  // killPtySession
  // =========================================================================

  describe("killPtySession", () => {
    it("should call session.kill() and remove from map", async () => {
      const session = new MockPtySession("to-kill");
      setPtySession(300, session);

      await killPtySession(300);

      expect(session.kill).toHaveBeenCalledOnce();
      expect(getPtySession(300)).toBeUndefined();
    });

    it("should no-op for unknown messageThreadId", async () => {
      await expect(killPtySession(12345)).resolves.toBeUndefined();
    });
  });

  // =========================================================================
  // disconnectVMBridge
  // =========================================================================

  describe("disconnectVMBridge", () => {
    it("should remove bridge from map so next ensure creates a new one", async () => {
      await ensureVMPtyBridge(51, "10.100.0.2");
      await disconnectVMBridge(51);

      vi.clearAllMocks();
      await ensureVMPtyBridge(51, "10.100.0.2");

      // A new bridge was constructed after the old was disconnected
      expect(mocked.MockBridge).toHaveBeenCalledTimes(1);
    });

    it("should no-op for unknown userId", async () => {
      await expect(disconnectVMBridge(0xdead)).resolves.toBeUndefined();
    });

    it("should kill and remove all registered sessions for the userId", async () => {
      await ensureVMPtyBridge(60, "10.200.0.1");

      const s1 = new MockPtySession("s1");
      const s2 = new MockPtySession("s2");

      setPtySession(501, s1);
      setPtySession(502, s2);

      await disconnectVMBridge(60);

      expect(getPtySession(501)).toBeUndefined();
      expect(getPtySession(502)).toBeUndefined();
    });

    it("should not affect bridges for other users", async () => {
      const bridgeA = await ensureVMPtyBridge(70, "10.0.0.1");
      const bridgeB = await ensureVMPtyBridge(71, "10.0.0.2");

      await disconnectVMBridge(70);

      // bridgeB should still be reachable (not removed)
      const stillThere = await ensureVMPtyBridge(71, "10.0.0.2");
      expect(stillThere).toBe(bridgeB);
    });
  });
});
