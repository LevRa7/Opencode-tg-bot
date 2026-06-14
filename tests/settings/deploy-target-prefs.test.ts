import { beforeEach, describe, expect, it, vi } from "vitest";

const mocked = vi.hoisted(() => ({
  settingsFilePath: `${process.env.TMPDIR ?? "/tmp"}/opencode-telegram-deploy-target-prefs.test.json`,
}));

vi.mock("../../src/runtime/paths.js", () => ({
  getRuntimePaths: vi.fn(() => ({
    settingsFilePath: mocked.settingsFilePath,
  })),
}));

import {
  __resetSettingsForTests,
  getUserDeployTarget,
  setUserDeployTarget,
  getUserVmSpecTier,
  setUserVmSpecTier,
} from "../../src/settings/manager.js";

describe("Deploy target preferences", () => {
  const userId = 42;

  beforeEach(async () => {
    await __resetSettingsForTests();
  });

  describe("getUserDeployTarget", () => {
    it("returns undefined when no preference is set", () => {
      expect(getUserDeployTarget(userId)).toBeUndefined();
    });
  });

  describe("setUserDeployTarget / getUserDeployTarget", () => {
    it('stores and retrieves "vm"', () => {
      setUserDeployTarget(userId, "vm");
      expect(getUserDeployTarget(userId)).toBe("vm");
    });

    it('stores and retrieves "docker"', () => {
      setUserDeployTarget(userId, "docker");
      expect(getUserDeployTarget(userId)).toBe("docker");
    });

    it("clears the value when set to null", () => {
      setUserDeployTarget(userId, "vm");
      expect(getUserDeployTarget(userId)).toBe("vm");
      setUserDeployTarget(userId, null);
      expect(getUserDeployTarget(userId)).toBeUndefined();
    });
  });

  describe("getUserVmSpecTier", () => {
    it("returns undefined when no preference is set", () => {
      expect(getUserVmSpecTier(userId)).toBeUndefined();
    });
  });

  describe("setUserVmSpecTier / getUserVmSpecTier", () => {
    it('stores and retrieves "medium"', () => {
      setUserVmSpecTier(userId, "medium");
      expect(getUserVmSpecTier(userId)).toBe("medium");
    });
  });
});
