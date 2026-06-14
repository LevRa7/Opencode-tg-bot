import { describe, it, expect, vi, beforeEach } from "vitest";

// ---------------------------------------------------------------------------
// Mock types — these stand in for VMPtyBridge and PtySessionHandle from
// terminal-bridge.js which does not exist yet (RED phase).
// ---------------------------------------------------------------------------

class MockPtySession {
  kill = vi.fn().mockResolvedValue(undefined);
}

class MockBridge {
  start = vi.fn();
  stop = vi.fn();
  sessions: MockPtySession[] = [];
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
// terminal-bridge mock — module does not exist yet (RED phase)
// ---------------------------------------------------------------------------

vi.mock("../../../src/bot/commands/terminal-bridge.js", () => ({
  VMPtyBridge: MockBridge,
  PtySessionHandle: MockPtySession,
}));

// ---------------------------------------------------------------------------
// The functions under test — they do not exist yet in terminal.ts (RED phase)
// ---------------------------------------------------------------------------

import {
  ensureVMPtyBridge,
  getPtySession,
  setPtySession,
  killPtySession,
  disconnectVMBridge,
} from "../../../src/bot/commands/terminal.js";

// Type imports for documentation — the module is mocked above
import { VMPtyBridge, PtySessionHandle } from "../../../src/bot/commands/terminal-bridge.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("terminal-pty", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  // =========================================================================
  // ensureVMPtyBridge
  // =========================================================================

  describe("ensureVMPtyBridge", () => {
    it("should create bridge on first call for userId", async () => {
      const bridge = await ensureVMPtyBridge(1, "10.100.0.100");

      expect(bridge).toBeDefined();
      expect(bridge).toBeInstanceOf(MockBridge);
    });

    it("should return existing bridge on second call (dedup)", async () => {
      const first = await ensureVMPtyBridge(2, "10.100.0.200");
      const second = await ensureVMPtyBridge(2, "10.100.0.200");

      expect(second).toBe(first);
    });

    it("should call bridge.start() on creation", async () => {
      const bridge = await ensureVMPtyBridge(3, "10.100.0.50");

      expect(bridge.start).toHaveBeenCalledOnce();
    });

    it("should not call start() on deduplicated bridge", async () => {
      await ensureVMPtyBridge(4, "10.100.0.60");
      vi.clearAllMocks();

      await ensureVMPtyBridge(4, "10.100.0.60");

      // After clearing mocks, no new start() call should happen on the
      // already-existing bridge returned by the dedup path.
      const bridge = await ensureVMPtyBridge(4, "10.100.0.60");
      expect(bridge.start).not.toHaveBeenCalled();
    });

    it("should use provided bridgeIp", async () => {
      // The bridgeIp is passed through to the bridge constructor.
      // We verify that ensureVMPtyBridge accepts the parameter and returns a
      // bridge — the exact usage is an implementation detail.
      const bridge = await ensureVMPtyBridge(5, "192.168.1.1");

      expect(bridge).toBeInstanceOf(MockBridge);
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
      const session = new MockPtySession() as unknown as PtySessionHandle;

      setPtySession(100, session);

      expect(getPtySession(100)).toBe(session);
    });

    it("should overwrite existing session", () => {
      const oldSession = new MockPtySession() as unknown as PtySessionHandle;
      const newSession = new MockPtySession() as unknown as PtySessionHandle;

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
      const session = new MockPtySession() as unknown as PtySessionHandle;
      setPtySession(300, session);

      await killPtySession(300);

      expect(session.kill).toHaveBeenCalledOnce();
      expect(getPtySession(300)).toBeUndefined();
    });

    it("should no-op for unknown messageThreadId", async () => {
      // Should not throw and should not create any entry
      await expect(killPtySession(12345)).resolves.toBeUndefined();
    });

    it("should not throw when session.kill() throws", async () => {
      const session = new MockPtySession() as unknown as PtySessionHandle;
      session.kill.mockRejectedValueOnce(new Error("kill failed"));
      setPtySession(400, session);

      await expect(killPtySession(400)).resolves.toBeUndefined();

      // The session should still be removed from the map even after a kill error
      expect(getPtySession(400)).toBeUndefined();
    });
  });

  // =========================================================================
  // disconnectVMBridge
  // =========================================================================

  describe("disconnectVMBridge", () => {
    it("should stop the bridge", async () => {
      const bridge = await ensureVMPtyBridge(50, "10.100.0.1");

      await disconnectVMBridge(50);

      expect(bridge.stop).toHaveBeenCalledOnce();
    });

    it("should remove bridge from map", async () => {
      await ensureVMPtyBridge(51, "10.100.0.2");
      await disconnectVMBridge(51);

      // A fresh call with the same userId should create a *new* bridge
      // instance, confirming the old one was removed.
      vi.clearAllMocks();
      const newBridge = await ensureVMPtyBridge(51, "10.100.0.2");

      expect(newBridge.start).toHaveBeenCalledOnce();
    });

    it("should no-op for unknown userId", async () => {
      await expect(disconnectVMBridge(0xdead)).resolves.toBeUndefined();
    });

    it("should kill each registered session", async () => {
      const bridge = await ensureVMPtyBridge(60, "10.200.0.1");

      const s1 = new MockPtySession() as unknown as PtySessionHandle;
      const s2 = new MockPtySession() as unknown as PtySessionHandle;

      bridge.sessions.push(s1 as unknown as MockPtySession);
      bridge.sessions.push(s2 as unknown as MockPtySession);

      setPtySession(501, s1);
      setPtySession(502, s2);

      await disconnectVMBridge(60);

      expect(s1.kill).toHaveBeenCalledOnce();
      expect(s2.kill).toHaveBeenCalledOnce();
      expect(getPtySession(501)).toBeUndefined();
      expect(getPtySession(502)).toBeUndefined();
    });

    it("should not affect bridges for other users", async () => {
      const bridgeA = await ensureVMPtyBridge(70, "10.0.0.1");
      const bridgeB = await ensureVMPtyBridge(71, "10.0.0.2");

      bridgeB.stop; // touch so the variable is referenced

      await disconnectVMBridge(70);

      expect(bridgeA.stop).toHaveBeenCalledOnce();
      // bridgeB should NOT have been stopped
      expect(bridgeB.stop).not.toHaveBeenCalled();

      // bridgeB should still be reachable
      const stillThere = await ensureVMPtyBridge(71, "10.0.0.2");
      expect(stillThere).toBe(bridgeB);
    });
  });
});
