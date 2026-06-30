import { describe, it, expect } from "vitest";
import { parseVersionOutput, readGoldenVersion } from "../../src/vm/version-check.js";

describe("parseVersionOutput", () => {
  it("extracts ISO 8601 timestamp from a single line", () => {
    const version = "2026-06-30T12:00:00Z";
    expect(parseVersionOutput(version + "\n")).toBe(version);
  });

  it("returns null when no ISO timestamp is present", () => {
    expect(
      parseVersionOutput("[  0.0] Some virt-customize log output\n[  5.0] Done\n")
    ).toBeNull();
  });

  it("finds ISO timestamp among other log output lines", () => {
    const version = "2026-06-30T12:00:00Z";
    const output =
      "[  0.0] Examining the guest...\n[ 12.0] Setting up...\n" +
      version +
      "\n[ 15.0] Finishing off\n";
    expect(parseVersionOutput(output)).toBe(version);
  });

  it("returns null when output is empty", () => {
    expect(parseVersionOutput("")).toBeNull();
  });

  it("returns null when output is only whitespace lines", () => {
    expect(parseVersionOutput("   \n  \n  ")).toBeNull();
  });

  it("preserves version strings with colons and hyphens", () => {
    const version = "2026-06-30T23:59:59Z";
    expect(parseVersionOutput(version + "\n")).toBe(version);
  });

  it("trims whitespace around version on the same line", () => {
    const version = "2026-06-30T12:00:00Z";
    expect(parseVersionOutput("  " + version + "  \n")).toBe(version);
  });

  it("rejects timestamps without trailing Z (not UTC)", () => {
    expect(parseVersionOutput("2026-06-30T12:00:00\n")).toBeNull();
  });

  it("rejects strings that don't match ISO 8601 UTC format", () => {
    // Missing Z suffix
    expect(parseVersionOutput("2026-06-30T12:00:00\n")).toBeNull();
    // Missing seconds
    expect(parseVersionOutput("2026-06-30T12:00Z\n")).toBeNull();
    // Wrong date separator
    expect(parseVersionOutput("2026/06/30T12:00:00Z\n")).toBeNull();
    // Missing time part
    expect(parseVersionOutput("2026-06-30\n")).toBeNull();
    // Plain text
    expect(parseVersionOutput("not-a-timestamp\n")).toBeNull();
  });

  it("returns the first valid timestamp when multiple are present", () => {
    const first = "2026-01-15T10:30:00Z";
    const second = "2026-06-30T12:00:00Z";
    expect(parseVersionOutput(first + "\n" + second + "\n")).toBe(first);
  });
});

describe("readGoldenVersion", () => {
  it("is a function that accepts a qcow2 path", () => {
    expect(typeof readGoldenVersion).toBe("function");
    expect(readGoldenVersion.length).toBe(1); // one parameter
  });

  it("returns a Promise<string | null>", () => {
    const result = readGoldenVersion("/nonexistent/path.qcow2");
    expect(result).toBeInstanceOf(Promise);
  });
});
