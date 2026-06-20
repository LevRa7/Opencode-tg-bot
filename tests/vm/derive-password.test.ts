import { describe, expect, it } from "vitest";
import { derivePassword } from "../../src/vm/types.js";

describe("derivePassword", () => {
  it("returns same password for same inputs", () => {
    const pw1 = derivePassword(42, "small");
    const pw2 = derivePassword(42, "small");
    expect(pw1).toBe(pw2);
    expect(pw1.length).toBeGreaterThanOrEqual(8);
  });

  it("returns different passwords for different users", () => {
    const pw1 = derivePassword(1, "small");
    const pw2 = derivePassword(2, "small");
    expect(pw1).not.toBe(pw2);
  });

  it("returns different passwords for different tiers", () => {
    const pw1 = derivePassword(42, "small");
    const pw2 = derivePassword(42, "large");
    expect(pw1).not.toBe(pw2);
  });

  it("does not contain URL-unsafe characters", () => {
    const pw = derivePassword(12345, "medium");
    expect(pw).not.toMatch(/[+/=]/);
  });

  it("is exactly 16 characters", () => {
    const pw = derivePassword(999, "xlarge");
    expect(pw.length).toBe(16);
  });
});
