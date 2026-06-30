/**
 * Golden Version Check Utility
 * Reads the golden version stamp from a QEMU qcow2 image using virt-customize.
 */
import { execSync } from "child_process";
import { GOLDEN_VERSION_FILE } from "./types.js";

/**
 * Parse virt-customize output to extract the golden version string.
 * Looks for an ISO 8601 UTC timestamp (YYYY-MM-DDTHH:MM:SSZ) in the output lines.
 * Exported for testability.
 */
export function parseVersionOutput(stdout: string): string | null {
  const lines = stdout.split("\n");
  for (const line of lines) {
    const trimmed = line.trim();
    // Match ISO 8601 UTC: YYYY-MM-DDTHH:MM:SSZ
    if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/.test(trimmed)) {
      return trimmed;
    }
  }
  return null;
}

/**
 * Reads the golden version from a VM disk image.
 * Uses virt-customize to cat the version file from the offline image.
 *
 * @param qcow2Path - Path to the qcow2 disk image
 * @returns The version string (ISO 8601 UTC), or null if not found
 */
export async function readGoldenVersion(qcow2Path: string): Promise<string | null> {
  const cmd = [
    "virt-customize",
    `-a "${qcow2Path}"`,
    `--run-command "cat ${GOLDEN_VERSION_FILE} 2>/dev/null || echo ''"`,
  ].join(" ");

  try {
    const stdout = execSync(cmd, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    return parseVersionOutput(stdout);
  } catch {
    return null;
  }
}
