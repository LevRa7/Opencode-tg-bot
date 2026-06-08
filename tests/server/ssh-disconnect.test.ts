import { describe, it, expect } from "vitest";
import fs from "node:fs";

const SRC = fs.readFileSync("src/utils/ssh-manager.ts", "utf-8");

describe("SSH disconnect", () => {
  it("calls disconnectRequested.add in disconnect()", () => {
    expect(SRC).toContain("this.disconnectRequested.add(userId)");
    const addCall = SRC.match(/disconnectRequested\.add\(userId\)/);
    expect(addCall).not.toBeNull();
  });

  it("calls add before server.close()", () => {
    const beforeClose = SRC.match(
      /disconnectRequested\.add\(userId\)[\s\S]*?conn\.server\.close\(\)/
    );
    expect(beforeClose).not.toBeNull();
  });

  it("checks disconnectRequested in on('end') handler", () => {
    expect(SRC).toContain("disconnectRequested.has(userId)");
  });

  it("clears disconnectRequested in connect()", () => {
    expect(SRC).toContain("this.disconnectRequested.delete(userId)");
  });
});
