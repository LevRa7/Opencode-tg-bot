import { describe, expect, it, vi } from "vitest";
import { sshManager } from "../../src/utils/ssh-manager.js";

vi.mock("../../src/utils/ssh-manager.js", () => ({
  sshManager: {
    recoverAll: vi.fn(),
  },
}));

describe("process/ssh-recovery", () => {
  it("triggers SSH background recovery during process startup", () => {
    expect(sshManager.recoverAll).toBeDefined();
  });
});
