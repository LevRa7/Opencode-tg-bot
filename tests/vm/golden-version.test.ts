import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const SRC_VM = path.resolve(import.meta.dirname, "../../src/vm");

describe("golden-version integration checks", () => {
  it("image-builder.ts contains the golden version stamp line", () => {
    const builderPath = path.join(SRC_VM, "image-builder.ts");
    const source = readFileSync(builderPath, "utf-8");

    // The version stamp writes /etc/opencode/golden-version with a UTC timestamp
    expect(source).toContain("/etc/opencode/golden-version");

    // Must use the date command with ISO 8601 UTC format
    expect(source).toContain("date -u +%Y-%m-%dT%H:%M:%SZ");

    // Must be placed AFTER all installs (after selinux-relabel) and BEFORE virt-sparsify
    // Use unique strings that appear exactly once
    const sparsifyIdx = source.indexOf("virt-sparsify --compress");
    const versionIdx = source.indexOf("/etc/opencode/golden-version");
    const selinuxIdx = source.indexOf("--selinux-relabel");

    expect(sparsifyIdx).toBeGreaterThan(-1);
    expect(versionIdx).toBeGreaterThan(-1);
    expect(selinuxIdx).toBeGreaterThan(-1);

    // Version stamp must come after selinux relabel (last customization step)
    expect(versionIdx).toBeGreaterThan(selinuxIdx);

    // Version stamp must come before virt-sparsify
    expect(versionIdx).toBeLessThan(sparsifyIdx);
  });

  it("types.ts exports GOLDEN_VERSION_FILE constant", async () => {
    const typesModule = await import("../../src/vm/types.js");
    expect(typesModule).toHaveProperty("GOLDEN_VERSION_FILE");
    expect(typesModule.GOLDEN_VERSION_FILE).toBe("/etc/opencode/golden-version");
  });

  it("GOLDEN_VERSION_FILE is imported and used by version-check.ts", () => {
    const vcPath = path.join(SRC_VM, "version-check.ts");
    const source = readFileSync(vcPath, "utf-8");

    expect(source).toContain("GOLDEN_VERSION_FILE");
    expect(source).toContain('from "./types.js"');
  });
});
