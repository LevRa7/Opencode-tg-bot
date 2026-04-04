import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const localTmpDir = path.join(repoRoot, ".tmp", "vitest");

await mkdir(localTmpDir, { recursive: true });

process.env.TMPDIR = localTmpDir;

const vitestEntrypoint = path.join(repoRoot, "node_modules", "vitest", "vitest.mjs");
const args = process.argv.slice(2);

await import(`${pathToFileUrl(vitestEntrypoint)}?${Date.now()}`);

function pathToFileUrl(filePath) {
  const normalizedPath = path.resolve(filePath);
  const url = new URL(`file://${normalizedPath}`);
  if (args.length > 0) {
    process.argv = [process.execPath, vitestEntrypoint, ...args];
  } else {
    process.argv = [process.execPath, vitestEntrypoint];
  }
  return url.href;
}
